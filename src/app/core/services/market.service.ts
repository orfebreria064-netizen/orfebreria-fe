import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { unwrap } from '../../shared/utils/db';

/** Tipo de cambio de un día: automático (KAMBISTA = paralelo, SUNAT = oficial) o corregido por la empresa (MANUAL). */
export interface ExchangeRate {
  rate_date: string;
  buy: number;
  sell: number;
  source: 'KAMBISTA' | 'SUNAT' | 'MANUAL';
  sunat_buy?: number | null;
  sunat_sell?: number | null;
  org_id?: string | null;
}

export interface MarketToday {
  date: string;
  exchange: ExchangeRate | null;
  sunat: { rate_date: string; buy: number; sell: number } | null;
  gold: { price_date: string; usd_oz: number; pen_g_24k: number | null; fetched_at: string } | null;
  /** Precios de venta del oro registrados por la empresa (Materiales > Precios del día). */
  company_gold: { name: string; purity: string | null; unit: string; price: number; price_date: string }[];
}

export const RATE_SOURCE_LABELS: Record<ExchangeRate['source'], string> = {
  KAMBISTA: 'Paralelo (Kambista)',
  SUNAT: 'Oficial (SUNAT)',
  MANUAL: 'Registrado por la empresa',
};

/** Tipo de cambio diario y precio del oro (0018_tipo_cambio_precio_oro.sql). */
@Injectable({ providedIn: 'root' })
export class MarketService {
  private readonly db = inject(SupabaseService).client;

  async today(): Promise<MarketToday> {
    return unwrap(await this.db.rpc('market_today')) as MarketToday;
  }

  /** Registros automáticos y de la empresa entre dos fechas (incluye el último anterior a `from`). */
  async rates(from: string, to: string): Promise<{ auto: ExchangeRate[]; manual: ExchangeRate[] }> {
    const [inRange, before] = await Promise.all([
      this.db.from('exchange_rates').select('*').gte('rate_date', from).lte('rate_date', to).order('rate_date'),
      this.db.from('exchange_rates').select('*').is('org_id', null).lt('rate_date', from).order('rate_date', { ascending: false }).limit(1),
    ]);
    const rows = [...(unwrap(before) as ExchangeRate[]), ...(unwrap(inRange) as ExchangeRate[])];
    return { auto: rows.filter((r) => !r.org_id), manual: rows.filter((r) => !!r.org_id) };
  }

  async save(date: string, buy: number, sell: number): Promise<void> {
    unwrap(await this.db.rpc('save_exchange_rate', { p_date: date, p_buy: buy, p_sell: sell }));
  }

  async remove(date: string): Promise<void> {
    unwrap(await this.db.rpc('delete_exchange_rate', { p_date: date }));
  }

  /** Consulta ahora las fuentes externas (Kambista, SUNAT, oro). */
  async refresh(): Promise<{ errors: string[] }> {
    return unwrap(await this.db.rpc('refresh_market_rates_now')) as { errors: string[] };
  }
}
