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
   - **Proyecto ya en uso:** ejecute en orden las migraciones de [`supabase/migrations/`](supabase/migrations/) que falten.
     La [`0022_sin_saas.sql`](supabase/migrations/0022_sin_saas.sql) retira la plataforma SaaS (planes, suscripciones,
     solicitudes de acceso y superadministrador) que agregaron las migraciones 0009 a 0014.
2. Cree el primer usuario: en una base vacía, cree un usuario en *Authentication → Users → Add user* (o con
   «Invite user»). **El primer usuario crea la organización y queda como ADMIN.**
   Después de él, el alta es **solo por invitación** (ver *Usuarios*).
3. (Opcional) Ejecute [`supabase/seed.sql`](supabase/seed.sql) en el SQL Editor para cargar los datos demo:
   5 clientes, 5 cotizaciones, 8 pedidos en distintos estados, 6 materiales, pagos, etapas y entregas. Los pedidos
   demo quedan asignados al ADMIN.

`supabase/migrations/` es la fuente del esquema. `schema.sql` se regenera con `npm run db:schema`.

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
   supabase functions deploy daily-statements
   # Respaldo de correo para daily-statements (opcional)
   supabase secrets set RESEND_API_KEY=re_xxx MAIL_FROM="Aurum <avisos@su-dominio.pe>"
   ```

### 2. Frontend

```bash
npm install
npm start           # http://localhost:4200
npm run build       # build de producción en dist/
```

La URL y la clave **publishable (anon)** de Supabase están en `src/environments/`. Esa clave es pública por diseño:
la seguridad la aplica RLS. **Nunca** coloque la `service_role` key en el frontend.

## Usuarios

La app es para **una sola orfebrería**. Sus datos están en una organización y RLS los filtra por `org_id`.
No hay planes ni suscripción mensual (se retiraron en la migración 0022).

El **ADMIN** invita a su personal en *Configuración → Usuarios*. La persona recibe un correo para crear su
contraseña (`/activar-cuenta`); si el correo no sale, el ADMIN obtiene el enlace para compartirlo por WhatsApp.
No hay límite de usuarios. Desactivar un usuario le quita el acceso sin borrar su historial.

## Roles

| Rol | Acceso |
|---|---|
| ADMIN | Todo, incluida la configuración y la reapertura de pedidos cerrados o cancelados |
| GERENTE | Dashboard, clientes, cotizaciones, pedidos, producción, materiales, pagos (con anulación), entregas y reportes |
| VENDEDOR | Clientes, cotizaciones, pedidos, pagos y entregas |
| SUPERVISOR | Pedidos, producción y control de calidad, materiales y entregas |
| ORFEBRE | Solo los pedidos asignados (a él o a una de sus etapas) y su producción |

## Reportes

Menú **Reportes** (ADMIN y GERENTE). Cada reporte tiene filtros, totales y exportación a **Excel** (ExcelJS) y **PDF**
(jsPDF); ambas librerías se cargan solo al exportar. Los datos vienen de funciones `report_*`
([`0010_reports.sql`](supabase/migrations/0010_reports.sql)) que respetan RLS y rechazan a otros roles.

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

- Retiro de la plataforma SaaS (0022, 2026-11-03): ensayo con rollback y aplicación en el proyecto Supabase;
  verificado el acceso de un ADMIN a pedidos, clientes e invitaciones con RLS activo.

**Pendiente de probar en el proyecto Supabase real:** la UI navegando contra la API, la subida de archivos a Storage,
el envío de emails de Auth y las Edge Functions (`send-invitation`, `daily-statements`). Esas partes no se
pudieron ejecutar en local.

## Fuera del alcance (la arquitectura lo permite)

Cobro con pasarela (Culqi, Izipay, Mercado Pago), facturación electrónica SUNAT, POS, compras,
WhatsApp automatizado.
