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
2. Arranque la app (paso 2) y entre en **Solicitar acceso** para registrar su usuario.
   **El primer usuario registrado queda como ADMIN activo.** Los siguientes quedan pendientes hasta que un ADMIN
   los active y les asigne rol en *Configuración → Usuarios*.
   > El proyecto tiene la confirmación de email activada: confirme el correo antes de iniciar sesión, o desactívela
   > en *Authentication → Providers → Email* mientras prueba.
3. (Opcional) Ejecute [`supabase/seed.sql`](supabase/seed.sql) en el SQL Editor para cargar los datos demo:
   5 clientes, 5 cotizaciones, 8 pedidos en distintos estados, 6 materiales, pagos, etapas y entregas. Los pedidos
   demo quedan asignados al ADMIN.

`supabase/migrations/` es la fuente del esquema. `schema.sql` se regenera con `npm run db:schema`.

### 2. Frontend

```bash
npm install
npm start           # http://localhost:4200
npm run build       # build de producción en dist/
```

La URL y la clave **publishable (anon)** de Supabase están en `src/environments/`. Esa clave es pública por diseño:
la seguridad la aplica RLS. **Nunca** coloque la `service_role` key en el frontend.

## Roles

| Rol | Acceso |
|---|---|
| ADMIN | Todo, incluida la configuración y la reapertura de pedidos cerrados o cancelados |
| GERENTE | Dashboard, clientes, cotizaciones, pedidos, producción, materiales, pagos (con anulación) y entregas |
| VENDEDOR | Clientes, cotizaciones, pedidos, pagos y entregas |
| SUPERVISOR | Pedidos, producción y control de calidad, materiales y entregas |
| ORFEBRE | Solo los pedidos asignados (a él o a una de sus etapas) y su producción |

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

**Pendiente de probar en el proyecto Supabase real:** la UI navegando contra la API, la subida de archivos a Storage
y el envío de emails de Auth. Esas partes no se pudieron ejecutar en local.

## Fuera del alcance del MVP (la arquitectura lo permite)

SaaS multiempresa (las tablas ya tienen `org_id` y RLS por organización), invitación de usuarios (Edge Function
con `service_role`), facturación electrónica SUNAT, POS, compras, WhatsApp automatizado.
