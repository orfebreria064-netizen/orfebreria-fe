-- =====================================================================
-- 0018_tipo_cambio_precio_oro.sql
--   * Tipo de cambio por día (USD/PEN), compra y venta:
--       - Automático (org_id null): TC paralelo de Kambista, con el oficial
--         de SUNAT como referencia (y respaldo si Kambista no responde).
--       - Manual (org_id de la empresa): corrige el automático de ese día
--         solo para esa empresa.
--     Rige el registro de la fecha más reciente <= al día consultado; en la
--     misma fecha, el manual gana al automático.
--   * Precio internacional del oro (US$/onza troy) y su equivalente en S/
--     por gramo de oro 24K, al TC de venta del día.
--   * pg_cron consulta las fuentes varias veces al día (hora de Lima) con la
--     extensión http (síncrona); ADMIN/GERENTE pueden forzar la consulta.
-- =====================================================================

create extension if not exists http with schema extensions;

-- ---------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------
create table public.exchange_rates (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid references public.organizations (id) on delete cascade,   -- null = automático
  rate_date   date not null,
  buy         numeric(8, 4) not null check (buy > 0),
  sell        numeric(8, 4) not null check (sell > 0),
  source      text not null check (source in ('KAMBISTA', 'SUNAT', 'MANUAL')),
  sunat_buy   numeric(8, 4) check (sunat_buy is null or sunat_buy > 0),
  sunat_sell  numeric(8, 4) check (sunat_sell is null or sunat_sell > 0),
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint exchange_rates_manual check ((org_id is null) = (source <> 'MANUAL'))
);
create unique index exchange_rates_auto_uidx on public.exchange_rates (rate_date) where org_id is null;
create unique index exchange_rates_org_uidx on public.exchange_rates (org_id, rate_date) where org_id is not null;
create trigger exchange_rates_updated_at before update on public.exchange_rates
  for each row execute function public.set_updated_at();

create table public.gold_prices (
  price_date  date primary key,
  usd_oz      numeric(12, 2) not null check (usd_oz > 0),       -- US$ por onza troy
  pen_g_24k   numeric(10, 2) check (pen_g_24k is null or pen_g_24k > 0),   -- S/ por gramo 24K
  source      text not null default 'GOLD-API',
  fetched_at  timestamptz not null default now()
);

alter table public.exchange_rates enable row level security;
alter table public.gold_prices    enable row level security;

-- Escritura solo vía funciones.
create policy exchange_rates_select on public.exchange_rates for select to authenticated
  using (org_id is null or org_id = public.current_org_id());
create policy gold_prices_select on public.gold_prices for select to authenticated
  using (true);

-- ---------------------------------------------------------------------
-- Consulta de fuentes externas (pg_cron y botón "Actualizar ahora")
-- ---------------------------------------------------------------------
create or replace function public.refresh_market_rates()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_date       date := (now() at time zone 'America/Lima')::date;
  v_res        extensions.http_response;
  v_body       jsonb;
  v_buy        numeric;
  v_sell       numeric;
  v_sunat_buy  numeric;
  v_sunat_sell numeric;
  v_usd_oz     numeric;
  v_rate_sell  numeric;
  v_errors     text[] := '{}';
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '15');

  -- TC paralelo (Kambista)
  begin
    v_res := extensions.http_get('https://api.kambista.com/v1/exchange/calculates?originCurrency=USD&destinationCurrency=PEN&amount=1&active=S');
    if v_res.status = 200 then
      v_body := v_res.content::jsonb;
      v_buy  := nullif(v_body #>> '{tc,bid}', '')::numeric;
      v_sell := nullif(v_body #>> '{tc,ask}', '')::numeric;
    else
      v_errors := v_errors || ('Kambista HTTP ' || v_res.status);
    end if;
  exception when others then
    v_errors := v_errors || ('Kambista: ' || sqlerrm);
  end;

  -- TC oficial (SUNAT)
  begin
    v_res := extensions.http_get('https://api.apis.net.pe/v1/tipo-cambio-sunat');
    if v_res.status = 200 then
      v_body := v_res.content::jsonb;
      v_sunat_buy  := nullif(v_body ->> 'compra', '')::numeric;
      v_sunat_sell := nullif(v_body ->> 'venta', '')::numeric;
    else
      v_errors := v_errors || ('SUNAT HTTP ' || v_res.status);
    end if;
  exception when others then
    v_errors := v_errors || ('SUNAT: ' || sqlerrm);
  end;

  if coalesce(v_buy, 0) > 0 and coalesce(v_sell, 0) > 0 then
    insert into public.exchange_rates (rate_date, buy, sell, source, sunat_buy, sunat_sell)
    values (v_date, v_buy, v_sell, 'KAMBISTA', v_sunat_buy, v_sunat_sell)
    on conflict (rate_date) where org_id is null
    do update set buy = excluded.buy, sell = excluded.sell, source = excluded.source,
                  sunat_buy = coalesce(excluded.sunat_buy, exchange_rates.sunat_buy),
                  sunat_sell = coalesce(excluded.sunat_sell, exchange_rates.sunat_sell);
  elsif coalesce(v_sunat_buy, 0) > 0 and coalesce(v_sunat_sell, 0) > 0 then
    -- Sin paralelo: se registra el oficial, sin pisar un paralelo ya obtenido hoy.
    insert into public.exchange_rates (rate_date, buy, sell, source, sunat_buy, sunat_sell)
    values (v_date, v_sunat_buy, v_sunat_sell, 'SUNAT', v_sunat_buy, v_sunat_sell)
    on conflict (rate_date) where org_id is null
    do update set sunat_buy = excluded.sunat_buy, sunat_sell = excluded.sunat_sell,
                  buy  = case when exchange_rates.source = 'SUNAT' then excluded.buy else exchange_rates.buy end,
                  sell = case when exchange_rates.source = 'SUNAT' then excluded.sell else exchange_rates.sell end;
  end if;

  -- Oro internacional (gold-api.com, US$ por onza troy)
  begin
    v_res := extensions.http_get('https://api.gold-api.com/price/XAU');
    if v_res.status = 200 then
      v_usd_oz := nullif(v_res.content::jsonb ->> 'price', '')::numeric;
    else
      v_errors := v_errors || ('Oro HTTP ' || v_res.status);
    end if;
  exception when others then
    v_errors := v_errors || ('Oro: ' || sqlerrm);
  end;

  if coalesce(v_usd_oz, 0) > 0 then
    select sell into v_rate_sell from public.exchange_rates
     where org_id is null and rate_date <= v_date order by rate_date desc limit 1;
    insert into public.gold_prices (price_date, usd_oz, pen_g_24k, fetched_at)
    values (v_date, round(v_usd_oz, 2), round(v_usd_oz / 31.1034768 * v_rate_sell, 2), now())
    on conflict (price_date)
    do update set usd_oz = excluded.usd_oz, pen_g_24k = excluded.pen_g_24k, fetched_at = now();
  end if;

  return jsonb_build_object('date', v_date, 'buy', v_buy, 'sell', v_sell,
                            'sunat_buy', v_sunat_buy, 'sunat_sell', v_sunat_sell,
                            'gold_usd_oz', v_usd_oz, 'errors', to_jsonb(v_errors));
end;
$$;

-- Botón "Actualizar ahora" (ADMIN o GERENTE de una empresa, o superadministrador)
create or replace function public.refresh_market_rates_now()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.has_role('ADMIN', 'GERENTE') or public.is_platform_admin()) then
    raise exception 'Solo un administrador o gerente puede actualizar el tipo de cambio.';
  end if;
  return public.refresh_market_rates();
end;
$$;

-- ---------------------------------------------------------------------
-- Tipo de cambio manual de la empresa
-- ---------------------------------------------------------------------
create or replace function public.save_exchange_rate(p_date date, p_buy numeric, p_sell numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
begin
  if v_org is null or not public.has_role('ADMIN', 'GERENTE') then
    raise exception 'Solo un administrador o gerente puede registrar el tipo de cambio.';
  end if;
  if p_date is null or p_date > (now() at time zone 'America/Lima')::date then
    raise exception 'Indique una fecha que no sea futura.';
  end if;
  if coalesce(p_buy, 0) <= 0 or coalesce(p_sell, 0) <= 0 then
    raise exception 'La compra y la venta deben ser mayores que cero.';
  end if;
  if p_buy > p_sell then
    raise exception 'La compra no puede ser mayor que la venta.';
  end if;

  insert into public.exchange_rates (org_id, rate_date, buy, sell, source, created_by)
  values (v_org, p_date, p_buy, p_sell, 'MANUAL', auth.uid())
  on conflict (org_id, rate_date) where org_id is not null
  do update set buy = excluded.buy, sell = excluded.sell, created_by = excluded.created_by;
end;
$$;

-- Quita la corrección manual de un día: vuelve a regir el automático.
create or replace function public.delete_exchange_rate(p_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
begin
  if v_org is null or not public.has_role('ADMIN', 'GERENTE') then
    raise exception 'Solo un administrador o gerente puede modificar el tipo de cambio.';
  end if;
  delete from public.exchange_rates where org_id = v_org and rate_date = p_date;
end;
$$;

-- TC vigente para la empresa en una fecha (para convertir montos en reportes)
create or replace function public.exchange_rate_on(p_date date default null)
returns table (rate_date date, buy numeric, sell numeric, source text)
language sql
stable
set search_path = public
as $$
  select e.rate_date, e.buy, e.sell, e.source
    from public.exchange_rates e
   where (e.org_id is null or e.org_id = public.current_org_id())
     and e.rate_date <= coalesce(p_date, (now() at time zone 'America/Lima')::date)
   order by e.rate_date desc, (e.org_id is null)
   limit 1;
$$;

-- Indicadores del día para el dashboard: TC, oro internacional y precio del oro de la empresa
create or replace function public.market_today()
returns jsonb
language sql
stable
set search_path = public
as $$
  with today as (select (now() at time zone 'America/Lima')::date as d)
  select jsonb_build_object(
    'date', (select d from today),
    'exchange', (select to_jsonb(x) from public.exchange_rate_on(null) x),
    'sunat', (select jsonb_build_object('rate_date', e.rate_date, 'buy', e.sunat_buy, 'sell', e.sunat_sell)
                from public.exchange_rates e
               where e.org_id is null and e.sunat_sell is not null
               order by e.rate_date desc limit 1),
    'gold', (select jsonb_build_object('price_date', g.price_date, 'usd_oz', g.usd_oz, 'pen_g_24k', g.pen_g_24k,
                                       'fetched_at', g.fetched_at)
               from public.gold_prices g order by g.price_date desc limit 1),
    'company_gold', (select coalesce(jsonb_agg(jsonb_build_object(
                                      'name', c.name, 'purity', c.purity, 'unit', c.unit,
                                      'price', c.price, 'price_date', c.price_date)
                                    order by c.name), '[]'::jsonb)
                       from public.material_prices_current() c
                      where c.type = 'ORO' and c.price is not null));
$$;

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
revoke execute on function public.refresh_market_rates() from public, anon, authenticated;
grant execute on function public.refresh_market_rates() to service_role;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.refresh_market_rates_now()',
    'public.save_exchange_rate(date, numeric, numeric)',
    'public.delete_exchange_rate(date)',
    'public.exchange_rate_on(date)',
    'public.market_today()'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- Tarea programada: 8:05, 11:05, 14:05 y 17:05 (Lima = UTC-5)
-- ---------------------------------------------------------------------
select cron.unschedule(jobid) from cron.job where jobname = 'tipo-cambio-oro';
select cron.schedule('tipo-cambio-oro', '5 13,16,19,22 * * *', $cron$ select public.refresh_market_rates(); $cron$);

-- Primer registro al aplicar la migración
select public.refresh_market_rates();
