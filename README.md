# Aurum: gestión para orfebrería (MVP)

Sistema web para talleres de joyería y orfebrería. Cubre el ciclo completo de un trabajo:
**cliente → cotización → pedido → producción → materiales → pagos → entrega → cierre**, con trazabilidad.

**Stack:** Angular 21 (standalone, signals, zoneless, lazy loading) · PrimeNG 21 · Chart.js · Angular CDK
· Supabase (PostgreSQL, Auth, Storage, RLS). No hay backend propio.

La arquitectura, el modelo entidad-relación, la matriz RLS y las rutas están en [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md).

## Puesta en marcha

### 1. Base de datos (una sola vez)

1. Abra **Supabase → SQL Editor** del proyecto y ejecute el contenido completo de [`supabase/schema.sql`](supabase/schema.sql).
   El archivo crea las tablas, triggers, funciones, políticas RLS y el bucket privado `orders`.
   - **Proyecto ya en uso (migraciones 0001–0008 aplicadas):** ejecute solo
     [`supabase/migrations/0009_saas_platform.sql`](supabase/migrations/0009_saas_platform.sql). Las empresas existentes
     quedan con el plan **Empresa activo por 1 año**, y el primer ADMIN de la primera empresa pasa a ser
     **superadministrador de la plataforma**.
   - **Proyecto con 0009 aplicada:** ejecute solo [`supabase/migrations/0010_reports.sql`](supabase/migrations/0010_reports.sql)
     (funciones de reportes, solo lectura).
2. Cree el primer usuario: en una base vacía, cree un usuario en *Authentication → Users → Add user* (o con
   «Invite user»). **El primer usuario crea la organización inicial y queda como ADMIN y superadministrador.**
   Después de él, el alta es **solo por invitación** (ver *Plataforma SaaS*).
3. (Opcional) Ejecute [`supabase/seed.sql`](supabase/seed.sql) en el SQL Editor para cargar los datos demo:
   5 clientes, 5 cotizaciones, 8 pedidos en distintos estados, 6 materiales, pagos, etapas y entregas. Los pedidos
   demo quedan asignados al ADMIN.

`supabase/migrations/` es la fuente del esquema. `schema.sql` se regenera con `npm run db:schema`.

Para cambiar o agregar superadministradores:

```sql
insert into public.platform_admins (user_id) select id from auth.users where email = 'usted@correo.pe';
```

### Configuración de Supabase para la nube

En el panel del proyecto:

1. **Authentication → Sign In / Providers → Email**: desactive **Allow new users to sign up**. Las invitaciones
   siguen funcionando, porque usan la API de administración. La base de datos ya rechaza registros sin invitación;
   esto evita que se intenten.
2. **Authentication → URL Configuration**: *Site URL* = la URL pública de la app. En *Redirect URLs* agregue
   `https://SU-DOMINIO/activar-cuenta` (y `http://localhost:4200/activar-cuenta` para pruebas).
3. **Authentication → Emails → SMTP**: configure un SMTP propio (p. ej. Resend). El SMTP incluido en Supabase
   solo admite unos pocos correos por hora, lo cual no alcanza para invitaciones reales.
4. **Edge Functions** (requiere [Supabase CLI](https://supabase.com/docs/guides/cli)):

   ```bash
   supabase login
   supabase link --project-ref ynxnxdgzsykhobfujyio
   supabase functions deploy send-invitation
   supabase functions deploy subscription-reminders --no-verify-jwt
   supabase secrets set RESEND_API_KEY=re_xxx MAIL_FROM="Aurum <avisos@su-dominio.pe>" \
     APP_URL=https://su-dominio.pe CRON_SECRET=$(openssl rand -hex 24)
   ```

5. **Avisos diarios de vencimiento**: active las extensiones `pg_cron` y `pg_net` (*Database → Extensions*) y
   programe la función en el SQL Editor:

   ```sql
   select cron.schedule('avisos-suscripcion', '0 13 * * *',  -- 08:00 hora de Lima
     $$ select net.http_post(
          url := 'https://ynxnxdgzsykhobfujyio.supabase.co/functions/v1/subscription-reminders',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'EL_MISMO_CRON_SECRET')
        ) $$);
   ```

6. Edite [`src/app/core/config/platform.ts`](src/app/core/config/platform.ts) con su correo, WhatsApp e
   instrucciones de pago reales. Las empresas los ven en *Mi plan* y en los avisos.

### 2. Frontend

```bash
npm install
npm start           # http://localhost:4200
npm run build       # build de producción en dist/
```

La URL y la clave **publishable (anon)** de Supabase están en `src/environments/`. Esa clave es pública por diseño:
la seguridad la aplica RLS. **Nunca** coloque la `service_role` key en el frontend.

## Plataforma SaaS (multiempresa)

Cada orfebrería es una **organización** con sus datos aislados por RLS. Usted, como **superadministrador**, gestiona
todas desde **Plataforma** (menú lateral, solo visible para usted).

**Alta de una empresa**

1. La empresa llena **Solicitar acceso** (`/solicitar-acceso`): empresa, RUC, contacto y plan de interés.
2. Usted la **aprueba** en *Plataforma → Solicitudes*, elige el plan y los días de prueba (14 por defecto). Esto crea
   la empresa con sus catálogos iniciales y envía al dueño un correo para crear su contraseña (`/activar-cuenta`).
3. El dueño entra como **ADMIN** de su empresa e invita a su personal en *Configuración → Usuarios*, hasta el límite
   de su plan.

**Planes** (editables en *Plataforma → Planes*)

| Plan | Usuarios | Mensual | Anual |
|---|---|---|---|
| Básico | 3 | S/ 79 | S/ 790 |
| Taller | 8 | S/ 149 | S/ 1 490 |
| Empresa | 20 (+ S/ 15 por usuario extra) | S/ 299 | S/ 2 990 |

Ocupan cupo los usuarios **activos** y las **invitaciones pendientes**; desactivar un usuario libera su cupo.

**Vencimiento**

| Estado | Cuándo | Efecto |
|---|---|---|
| Prueba / Activa | hasta la fecha de vencimiento | uso normal; aviso en pantalla 7 días antes |
| En gracia | 5 días después de vencer (solo planes pagados) | uso normal con aviso |
| Vencida | después de la gracia | **solo lectura**: puede consultar y exportar, no registrar |
| Suspendida / Cancelada | la pone usted manualmente | sin acceso a los datos (no se borran) |

**Pagos:** las empresas pagan por Yape, Plin o transferencia y envían la constancia. Usted registra el pago en
*Plataforma → Empresas → Pago*. Si la empresa está vigente o en gracia, el nuevo periodo continúa desde el
vencimiento; si está vencida o en prueba, empieza en la fecha de pago. 12 meses usan el precio anual.

Todo lo anterior lo exige **la base de datos** (triggers y RLS), no solo la interfaz: un plan vencido bloquea las
escrituras incluso desde las funciones RPC, y el límite de usuarios se valida al invitar y al activar.

## Roles

| Rol | Acceso |
|---|---|
| Superadministrador | Panel *Plataforma*: empresas, solicitudes, pagos de suscripción y planes. Es independiente del rol en su propia empresa |
| ADMIN | Todo, incluida la configuración y la reapertura de pedidos cerrados o cancelados |
| GERENTE | Dashboard, clientes, cotizaciones, pedidos, producción, materiales, pagos (con anulación), entregas y reportes |
| VENDEDOR | Clientes, cotizaciones, pedidos, pagos y entregas |
| SUPERVISOR | Pedidos, producción y control de calidad, materiales y entregas |
| ORFEBRE | Solo los pedidos asignados (a él o a una de sus etapas) y su producción |

## Reportes

Menú **Reportes** (ADMIN y GERENTE). Cada reporte tiene filtros, totales y exportación a **Excel** (ExcelJS) y **PDF**
(jsPDF); ambas librerías se cargan solo al exportar. Los datos vienen de funciones `report_*`
([`0010_reports.sql`](supabase/migrations/0010_reports.sql)) que respetan RLS y rechazan a otros roles. Funcionan
también con el plan vencido (solo lectura).

| Reporte | Contenido |
|---|---|
| Ventas por periodo | Pedidos no cancelados por fecha de creación: IGV, total, cobrado y saldo; filtros por servicio, cliente y responsable |
| Cuentas por cobrar | Saldos por antigüedad (por vencer, 0–30, 31–60, 61–90, +90 días) contados desde la entrega o la fecha comprometida |
| Cobranza / caja | Pagos por periodo y método, adelantos y anulaciones con su motivo |
| Atrasados y por entregar | Pedidos activos vencidos o con entrega en los próximos 7, 15 o 30 días |
| Stock valorizado | Stock, mínimo, costo de referencia, valor y alerta de bajo mínimo |
| Material de clientes | Material recibido de clientes con saldo en custodia, incluso en pedidos ya entregados |

## Reglas de negocio garantizadas por la base de datos

- Numeración correlativa sin duplicados: `COT-2026-000001`, `PED-…`, `ENT-…`
- Totales, IGV, monto pagado, saldo y estado de pago calculados en PostgreSQL
- Convertir una cotización solo si está aprobada, una sola vez (se copian cliente, ítems, precios y observaciones)
- Una sola etapa actual por pedido; avance (%) según etapas completadas; estado del pedido derivado de la producción
- Al terminar las etapas de trabajo, el pedido pasa a *Control de calidad*; al completar el control, a *Listo para entregar*
- La entrega exige control de calidad aprobado y conformidad, y registra la fecha real
- Cerrar exige producción completa, control de calidad aprobado y entrega registrada (el saldo solo genera alerta)
- Un pedido cerrado o cancelado solo lo modifica un ADMIN
- Stock con validación de suficiencia; el material del cliente lleva su propio saldo por pedido
- Un pago mayor al saldo requiere confirmación explícita; los pagos se anulan, no se borran
- La auditoría (`order_history`) la escriben solo los triggers: nadie puede insertar ni editar historial

## Verificación realizada

- `ng build` (desarrollo y producción) sin errores ni advertencias tras cada fase.
- Migraciones + seed aplicados sobre PostgreSQL 18 local, con un stub de los esquemas `auth`/`storage` de Supabase.
- Pruebas de RLS por rol (anon, ADMIN, VENDEDOR, ORFEBRE, usuario inactivo) y el flujo de aceptación completo
  de 20 pasos ejecutado como usuarios reales con RLS activo.

- Plataforma SaaS (0009): solicitud anónima, aprobación solo por superadmin, alta por invitación y rechazo de
  registros sin invitación, aislamiento entre empresas, límite de usuarios (al invitar, al activar y al invitar
  administrador), prueba → gracia → vencida (solo lectura, también vía RPC y Storage) → suspendida (sin acceso),
  cálculo de periodos al registrar pagos (vencida, vigente y en gracia), permisos de las RPC (anon, empresa,
  superadmin, service_role) y la consulta de avisos de vencimiento.

**Pendiente de probar en el proyecto Supabase real:** la UI navegando contra la API, la subida de archivos a Storage,
el envío de emails de Auth y las Edge Functions (`send-invitation`, `subscription-reminders`). Esas partes no se
pudieron ejecutar en local.

## Fuera del alcance (la arquitectura lo permite)

Cobro automático con pasarela (Culqi, Izipay, Mercado Pago), facturación electrónica SUNAT de las suscripciones,
POS, compras, WhatsApp automatizado.
