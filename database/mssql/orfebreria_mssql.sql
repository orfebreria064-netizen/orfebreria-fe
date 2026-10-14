/* =====================================================================
   Orfebrería Aurum — Esquema para SQL Server (2017 o superior)
   Base de datos destino: db_acfa96_orfebreria

   Contenido:
     1. Tablas, índices y vistas (esquema dbo)
     2. Funciones de apoyo (dbo.fn_*)
     3. Procedimientos internos (dbo.usp_int_*): reglas de negocio
     4. Procedimientos públicos (api.usp_*): los que llama la API
     5. Rol orfebreria_api con permiso EXECUTE solo sobre el esquema api

   Seguridad: no hay RLS. Cada procedimiento público recibe @user_id
   (el usuario autenticado por la API) y valida empresa, estado del plan,
   rol y sucursal. La API debe conectarse con un usuario que solo tenga
   el rol orfebreria_api (sin acceso directo a tablas).

   Errores (THROW):
     50001 sesión no válida (usuario inactivo / empresa suspendida)  -> 401
     50002 plan vencido: modo solo lectura                            -> 402/403
     50003 sin permisos para la acción                                -> 403
     50004 registro no encontrado o sin permisos                      -> 404
     50000 regla de negocio (mensaje listo para mostrar al usuario)   -> 400/409

   Contraseñas: la API calcula el hash (BCrypt/PBKDF2) y lo envía; la base
   nunca recibe la contraseña en claro. Los tokens de invitación y de
   recuperación los genera la base, se devuelven una sola vez y se guarda
   solo su SHA-256.

   Fechas: los timestamps se guardan como DATETIMEOFFSET en hora de Lima
   (SA Pacific Standard Time); las fechas de negocio son DATE de Lima.

   El script es re-ejecutable: crea las tablas que falten y actualiza
   funciones y procedimientos (CREATE OR ALTER).
   ===================================================================== */

USE [db_acfa96_orfebreria];
GO
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
GO

-- Detiene el script si no se está en la base correcta o la compatibilidad
-- es menor a 130 (OPENJSON y STRING_SPLIT la necesitan).
IF DB_NAME() <> N'db_acfa96_orfebreria'
BEGIN
  RAISERROR (N'Ejecute este script en la base db_acfa96_orfebreria.', 16, 1);
  SET NOEXEC ON;
END
ELSE IF (SELECT compatibility_level FROM sys.databases WHERE name = DB_NAME()) < 130
BEGIN
  RAISERROR (N'La base necesita nivel de compatibilidad 130 o superior (ALTER DATABASE CURRENT SET COMPATIBILITY_LEVEL = 140).', 16, 1);
  SET NOEXEC ON;
END
GO

IF SCHEMA_ID(N'api') IS NULL EXEC (N'CREATE SCHEMA api AUTHORIZATION dbo');
GO

/* =====================================================================
   1. TABLAS
   ===================================================================== */

-- ---------------------------------------------------------------------
-- Usuarios (credenciales). El perfil de empresa está en profiles.
-- ---------------------------------------------------------------------
IF OBJECT_ID(N'dbo.users', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.users (
    id                   UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_users PRIMARY KEY DEFAULT NEWID(),
    email                NVARCHAR(254)    NOT NULL,
    password_hash        NVARCHAR(500)    NULL,          -- null hasta que defina su contraseña
    full_name            NVARCHAR(150)    NULL,
    failed_logins        INT              NOT NULL DEFAULT 0,
    locked_until         DATETIMEOFFSET(3) NULL,
    last_login_at        DATETIMEOFFSET(3) NULL,
    password_changed_at  DATETIMEOFFSET(3) NULL,
    created_at           DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT UQ_users_email UNIQUE (email),
    CONSTRAINT CK_users_email CHECK (email LIKE N'%_@_%._%' AND email NOT LIKE N'% %')
  );
END
GO

-- ---------------------------------------------------------------------
-- Organizaciones (tenant)
-- ---------------------------------------------------------------------
IF OBJECT_ID(N'dbo.organizations', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.organizations (
    id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_organizations PRIMARY KEY DEFAULT NEWID(),
    name        NVARCHAR(150)    NOT NULL CONSTRAINT CK_organizations_name CHECK (LEN(LTRIM(name)) > 0),
    created_at  DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET()
  );
END
GO

-- ---------------------------------------------------------------------
-- Planes y suscripciones
-- ---------------------------------------------------------------------
IF OBJECT_ID(N'dbo.plans', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.plans (
    code              NVARCHAR(20)   NOT NULL CONSTRAINT PK_plans PRIMARY KEY,
    name              NVARCHAR(100)  NOT NULL,
    max_users         INT            NOT NULL CONSTRAINT CK_plans_max_users CHECK (max_users > 0),
    max_branches      INT            NULL CONSTRAINT CK_plans_max_branches CHECK (max_branches IS NULL OR max_branches > 0),
    price_month       DECIMAL(10, 2) NOT NULL CONSTRAINT CK_plans_price_month CHECK (price_month >= 0),
    price_year        DECIMAL(10, 2) NOT NULL CONSTRAINT CK_plans_price_year CHECK (price_year >= 0),
    -- Precio mensual por usuario adicional; null = el plan no admite usuarios extra.
    extra_user_price  DECIMAL(10, 2) NULL CONSTRAINT CK_plans_extra CHECK (extra_user_price IS NULL OR extra_user_price >= 0),
    position          INT            NOT NULL DEFAULT 0,
    active            BIT            NOT NULL DEFAULT 1
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.plans)
  INSERT INTO dbo.plans (code, name, max_users, max_branches, price_month, price_year, extra_user_price, position) VALUES
    (N'BASICO',  N'Básico',  3,  1,    79,  790,  NULL, 1),
    (N'TALLER',  N'Taller',  8,  3,    149, 1490, NULL, 2),
    (N'EMPRESA', N'Empresa', 20, NULL, 299, 2990, 15,   3);
GO

IF OBJECT_ID(N'dbo.subscriptions', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.subscriptions (
    org_id              UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_subscriptions PRIMARY KEY
                        CONSTRAINT FK_subscriptions_org REFERENCES dbo.organizations (id),
    plan_code           NVARCHAR(20)     NOT NULL CONSTRAINT FK_subscriptions_plan REFERENCES dbo.plans (code),
    status              NVARCHAR(20)     NOT NULL DEFAULT N'TRIAL'
                        CONSTRAINT CK_subscriptions_status CHECK (status IN (N'TRIAL', N'ACTIVE', N'SUSPENDED', N'CANCELLED')),
    extra_users         INT              NOT NULL DEFAULT 0 CONSTRAINT CK_subscriptions_extra CHECK (extra_users >= 0),
    current_period_end  DATE             NOT NULL,
    grace_days          INT              NOT NULL DEFAULT 5 CONSTRAINT CK_subscriptions_grace CHECK (grace_days BETWEEN 0 AND 60),
    notes               NVARCHAR(1000)   NULL,
    created_at          DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    updated_at          DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET()
  );
END
GO

-- Superadministradores de la plataforma (separados de los roles de empresa)
IF OBJECT_ID(N'dbo.platform_admins', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.platform_admins (
    user_id     UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_platform_admins PRIMARY KEY
                CONSTRAINT FK_platform_admins_user REFERENCES dbo.users (id) ON DELETE CASCADE,
    created_at  DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET()
  );
END
GO

-- ---------------------------------------------------------------------
-- Configuración por organización
-- ---------------------------------------------------------------------
IF OBJECT_ID(N'dbo.settings', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.settings (
    org_id               UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_settings PRIMARY KEY
                         CONSTRAINT FK_settings_org REFERENCES dbo.organizations (id),
    company_name         NVARCHAR(200)  NOT NULL DEFAULT N'Mi Orfebrería',
    tax_id               NVARCHAR(20)   NULL,
    address              NVARCHAR(300)  NULL,
    phone                NVARCHAR(30)   NULL,
    email                NVARCHAR(254)  NULL,
    currency             NVARCHAR(3)    NOT NULL DEFAULT N'PEN',
    tax_rate             DECIMAL(5, 2)  NOT NULL DEFAULT 18 CONSTRAINT CK_settings_tax CHECK (tax_rate >= 0 AND tax_rate <= 100),
    quote_validity_days  INT            NOT NULL DEFAULT 15 CONSTRAINT CK_settings_validity CHECK (quote_validity_days > 0),
    default_terms        NVARCHAR(2000) NULL DEFAULT N'Adelanto mínimo del 50% para iniciar el trabajo. Saldo contra entrega.',
    updated_at           DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET()
  );
END
GO

-- ---------------------------------------------------------------------
-- Sucursales
-- ---------------------------------------------------------------------
IF OBJECT_ID(N'dbo.branches', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.branches (
    id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_branches PRIMARY KEY DEFAULT NEWID(),
    org_id      UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_branches_org REFERENCES dbo.organizations (id),
    code        NVARCHAR(6)      NOT NULL,     -- abreviatura: PRI, LIM, AQP...
    name        NVARCHAR(100)    NOT NULL CONSTRAINT CK_branches_name CHECK (LEN(LTRIM(name)) > 0),
    address     NVARCHAR(300)    NULL,
    phone       NVARCHAR(30)     NULL,
    is_main     BIT              NOT NULL DEFAULT 0,
    active      BIT              NOT NULL DEFAULT 1,
    created_at  DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    updated_at  DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT UQ_branches_code UNIQUE (org_id, code),
    CONSTRAINT UQ_branches_name UNIQUE (org_id, name),
    CONSTRAINT CK_branches_code CHECK (LEN(code) BETWEEN 2 AND 6 AND code COLLATE Latin1_General_BIN NOT LIKE N'%[^A-Z0-9]%'),
    CONSTRAINT CK_branches_main_active CHECK (is_main = 0 OR active = 1)
  );
  -- Regla: una sola sucursal principal por empresa
  CREATE UNIQUE INDEX UX_branches_one_main ON dbo.branches (org_id) WHERE is_main = 1;
END
GO

-- ---------------------------------------------------------------------
-- Perfiles (usuario dentro de una empresa) y sus sucursales
-- ---------------------------------------------------------------------
IF OBJECT_ID(N'dbo.profiles', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.profiles (
    id                 UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_profiles PRIMARY KEY
                       CONSTRAINT FK_profiles_user REFERENCES dbo.users (id) ON DELETE CASCADE,
    org_id             UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_profiles_org REFERENCES dbo.organizations (id),
    full_name          NVARCHAR(150)    NOT NULL,
    email              NVARCHAR(254)    NOT NULL,
    phone              NVARCHAR(30)     NULL,
    role               NVARCHAR(20)     NOT NULL DEFAULT N'VENDEDOR'
                       CONSTRAINT CK_profiles_role CHECK (role IN (N'ADMIN', N'GERENTE', N'VENDEDOR', N'ORFEBRE', N'SUPERVISOR')),
    active             BIT              NOT NULL DEFAULT 0,
    default_branch_id  UNIQUEIDENTIFIER NULL CONSTRAINT FK_profiles_branch REFERENCES dbo.branches (id),
    created_at         DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    updated_at         DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET()
  );
  CREATE INDEX IX_profiles_org ON dbo.profiles (org_id);
END
GO

-- ADMIN y GERENTE ven todas las sucursales sin asignación.
IF OBJECT_ID(N'dbo.user_branches', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.user_branches (
    org_id      UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_user_branches_org REFERENCES dbo.organizations (id),
    user_id     UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_user_branches_user REFERENCES dbo.profiles (id) ON DELETE CASCADE,
    branch_id   UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_user_branches_branch REFERENCES dbo.branches (id),
    created_at  DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT PK_user_branches PRIMARY KEY (user_id, branch_id)
  );
  CREATE INDEX IX_user_branches_branch ON dbo.user_branches (branch_id);
END
GO

-- ---------------------------------------------------------------------
-- Numeración correlativa por empresa: COT-2026-000001, PED-..., ENT-...
-- ---------------------------------------------------------------------
IF OBJECT_ID(N'dbo.document_sequences', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.document_sequences (
    org_id      UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_docseq_org REFERENCES dbo.organizations (id),
    doc_type    NVARCHAR(3)      NOT NULL CONSTRAINT CK_docseq_type CHECK (doc_type IN (N'COT', N'PED', N'ENT')),
    year        INT              NOT NULL,
    last_value  INT              NOT NULL DEFAULT 0,
    CONSTRAINT PK_document_sequences PRIMARY KEY (org_id, doc_type, year)
  );
END
GO

-- ---------------------------------------------------------------------
-- Catálogos: tipos de servicio y plantilla de etapas de producción
-- ---------------------------------------------------------------------
IF OBJECT_ID(N'dbo.service_types', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.service_types (
    id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_service_types PRIMARY KEY DEFAULT NEWID(),
    org_id      UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_service_types_org REFERENCES dbo.organizations (id),
    code        NVARCHAR(30)     NOT NULL,
    name        NVARCHAR(100)    NOT NULL CONSTRAINT CK_service_types_name CHECK (LEN(LTRIM(name)) > 0),
    position    INT              NOT NULL DEFAULT 0,
    active      BIT              NOT NULL DEFAULT 1,
    created_at  DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT UQ_service_types_code UNIQUE (org_id, code)
  );
END
GO

IF OBJECT_ID(N'dbo.production_stages', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.production_stages (
    id                UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_production_stages PRIMARY KEY DEFAULT NEWID(),
    org_id            UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_production_stages_org REFERENCES dbo.organizations (id),
    name              NVARCHAR(100)    NOT NULL CONSTRAINT CK_production_stages_name CHECK (LEN(LTRIM(name)) > 0),
    position          INT              NOT NULL,
    is_quality_check  BIT              NOT NULL DEFAULT 0,
    active            BIT              NOT NULL DEFAULT 1,
    created_at        DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET()
  );
  CREATE INDEX IX_production_stages_org ON dbo.production_stages (org_id, position);
END
GO

-- ---------------------------------------------------------------------
-- Clientes (compartidos por todas las sucursales de la empresa)
-- ---------------------------------------------------------------------
IF OBJECT_ID(N'dbo.customers', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.customers (
    id               UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_customers PRIMARY KEY DEFAULT NEWID(),
    org_id           UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_customers_org REFERENCES dbo.organizations (id),
    person_type      NVARCHAR(10)     NOT NULL DEFAULT N'NATURAL'
                     CONSTRAINT CK_customers_person_type CHECK (person_type IN (N'NATURAL', N'EMPRESA')),
    first_name       NVARCHAR(100)    NULL,
    last_name        NVARCHAR(100)    NULL,
    business_name    NVARCHAR(200)    NULL,
    document_type    NVARCHAR(10)     NOT NULL DEFAULT N'DNI'
                     CONSTRAINT CK_customers_document_type CHECK (document_type IN (N'DNI', N'RUC', N'CE', N'PASAPORTE', N'OTRO')),
    document_number  NVARCHAR(20)     NULL,
    phone            NVARCHAR(30)     NULL,
    whatsapp         NVARCHAR(30)     NULL,
    email            NVARCHAR(254)    NULL,
    address          NVARCHAR(300)    NULL,
    city             NVARCHAR(100)    NULL,
    notes            NVARCHAR(2000)   NULL,
    active           BIT              NOT NULL DEFAULT 1,
    full_name        AS CAST(CASE WHEN person_type = N'EMPRESA' THEN ISNULL(business_name, N'')
                                  ELSE LTRIM(RTRIM(CONCAT(first_name, N' ', last_name))) END AS NVARCHAR(201)) PERSISTED,
    created_by       UNIQUEIDENTIFIER NULL CONSTRAINT FK_customers_created_by REFERENCES dbo.profiles (id),
    created_at       DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    updated_at       DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT CK_customers_name_required CHECK (
      (person_type = N'NATURAL' AND LEN(LTRIM(ISNULL(first_name, N''))) > 0)
      OR (person_type = N'EMPRESA' AND LEN(LTRIM(ISNULL(business_name, N''))) > 0)),
    CONSTRAINT CK_customers_email CHECK (email IS NULL OR (email LIKE N'%_@_%._%' AND email NOT LIKE N'% %'))
  );
  CREATE UNIQUE INDEX UX_customers_document ON dbo.customers (org_id, document_type, document_number)
    WHERE document_number IS NOT NULL AND document_number <> N'';
  CREATE INDEX IX_customers_org_name ON dbo.customers (org_id, full_name);
END
GO

IF OBJECT_ID(N'dbo.customer_contacts', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.customer_contacts (
    id           UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_customer_contacts PRIMARY KEY DEFAULT NEWID(),
    org_id       UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_customer_contacts_org REFERENCES dbo.organizations (id),
    customer_id  UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_customer_contacts_customer REFERENCES dbo.customers (id) ON DELETE CASCADE,
    name         NVARCHAR(150)    NOT NULL CONSTRAINT CK_customer_contacts_name CHECK (LEN(LTRIM(name)) > 0),
    position     NVARCHAR(100)    NULL,
    phone        NVARCHAR(30)     NULL,
    email        NVARCHAR(254)    NULL,
    notes        NVARCHAR(1000)   NULL,
    created_at   DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET()
  );
  CREATE INDEX IX_customer_contacts_customer ON dbo.customer_contacts (customer_id);
END
GO

-- ---------------------------------------------------------------------
-- Materiales. stock = total consolidado de la empresa; el detalle por
-- sucursal está en material_stock. Solo cambian mediante movimientos.
-- ---------------------------------------------------------------------
IF OBJECT_ID(N'dbo.materials', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.materials (
    id              UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_materials PRIMARY KEY DEFAULT NEWID(),
    org_id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_materials_org REFERENCES dbo.organizations (id),
    name            NVARCHAR(150)    NOT NULL CONSTRAINT CK_materials_name CHECK (LEN(LTRIM(name)) > 0),
    type            NVARCHAR(30)     NOT NULL CONSTRAINT CK_materials_type
                    CHECK (type IN (N'ORO', N'PLATA', N'PLATINO', N'PIEDRA_PRECIOSA', N'PIEDRA_SEMIPRECIOSA', N'OTRO')),
    purity          NVARCHAR(20)     NULL,                  -- ley: 18K, 14K, 925, 950...
    unit            NVARCHAR(5)      NOT NULL DEFAULT N'g' CONSTRAINT CK_materials_unit CHECK (unit IN (N'g', N'ct', N'und')),
    stock           DECIMAL(14, 3)   NOT NULL DEFAULT 0 CONSTRAINT CK_materials_stock CHECK (stock >= 0),
    min_stock       DECIMAL(14, 3)   NOT NULL DEFAULT 0 CONSTRAINT CK_materials_min_stock CHECK (min_stock >= 0),
    reference_cost  DECIMAL(12, 2)   NOT NULL DEFAULT 0 CONSTRAINT CK_materials_cost CHECK (reference_cost >= 0),
    active          BIT              NOT NULL DEFAULT 1,
    created_at      DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    updated_at      DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT UQ_materials_name UNIQUE (org_id, name)
  );
  CREATE INDEX IX_materials_org_type ON dbo.materials (org_id, type);
END
GO

IF OBJECT_ID(N'dbo.material_stock', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.material_stock (
    org_id       UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_material_stock_org REFERENCES dbo.organizations (id),
    material_id  UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_material_stock_material REFERENCES dbo.materials (id) ON DELETE CASCADE,
    branch_id    UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_material_stock_branch REFERENCES dbo.branches (id),
    stock        DECIMAL(14, 3)   NOT NULL DEFAULT 0 CONSTRAINT CK_material_stock_stock CHECK (stock >= 0),
    min_stock    DECIMAL(14, 3)   NOT NULL DEFAULT 0 CONSTRAINT CK_material_stock_min CHECK (min_stock >= 0),
    updated_at   DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT PK_material_stock PRIMARY KEY (material_id, branch_id)
  );
  CREATE INDEX IX_material_stock_branch ON dbo.material_stock (branch_id);
END
GO

-- ---------------------------------------------------------------------
-- Cotizaciones
-- ---------------------------------------------------------------------
IF OBJECT_ID(N'dbo.quotations', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.quotations (
    id                UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_quotations PRIMARY KEY DEFAULT NEWID(),
    org_id            UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_quotations_org REFERENCES dbo.organizations (id),
    branch_id         UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_quotations_branch REFERENCES dbo.branches (id),
    number            NVARCHAR(30)     NOT NULL,
    customer_id       UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_quotations_customer REFERENCES dbo.customers (id),
    service_type_id   UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_quotations_service REFERENCES dbo.service_types (id),
    status            NVARCHAR(20)     NOT NULL DEFAULT N'BORRADOR'
                      CONSTRAINT CK_quotations_status CHECK (status IN (N'BORRADOR', N'ENVIADA', N'APROBADA', N'RECHAZADA', N'VENCIDA', N'CANCELADA')),
    issue_date        DATE             NOT NULL,
    expiry_date       DATE             NOT NULL,
    title             NVARCHAR(200)    NOT NULL CONSTRAINT CK_quotations_title CHECK (LEN(LTRIM(title)) > 0),
    main_material     NVARCHAR(100)    NULL,
    estimated_weight  DECIMAL(10, 2)   NULL CONSTRAINT CK_quotations_weight CHECK (estimated_weight IS NULL OR estimated_weight > 0),
    stone             NVARCHAR(100)    NULL,
    size              NVARCHAR(50)     NULL,
    notes             NVARCHAR(2000)   NULL,
    terms             NVARCHAR(2000)   NULL,
    subtotal          DECIMAL(12, 2)   NOT NULL DEFAULT 0,
    discount_total    DECIMAL(12, 2)   NOT NULL DEFAULT 0,
    tax_rate          DECIMAL(5, 2)    NOT NULL DEFAULT 18 CONSTRAINT CK_quotations_tax CHECK (tax_rate >= 0 AND tax_rate <= 100),
    tax_amount        DECIMAL(12, 2)   NOT NULL DEFAULT 0,
    total             DECIMAL(12, 2)   NOT NULL DEFAULT 0,
    approved_at       DATETIMEOFFSET(3) NULL,
    approved_by       UNIQUEIDENTIFIER NULL CONSTRAINT FK_quotations_approved_by REFERENCES dbo.profiles (id),
    order_id          UNIQUEIDENTIFIER NULL,          -- FK a orders al final
    created_by        UNIQUEIDENTIFIER NULL CONSTRAINT FK_quotations_created_by REFERENCES dbo.profiles (id),
    created_at        DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    updated_at        DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT UQ_quotations_number UNIQUE (org_id, number),
    CONSTRAINT CK_quotations_dates CHECK (expiry_date >= issue_date)
  );
  CREATE INDEX IX_quotations_org_status ON dbo.quotations (org_id, status);
  CREATE INDEX IX_quotations_branch ON dbo.quotations (branch_id, status);
  CREATE INDEX IX_quotations_customer ON dbo.quotations (customer_id);
END
GO

IF OBJECT_ID(N'dbo.quotation_items', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.quotation_items (
    id             UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_quotation_items PRIMARY KEY DEFAULT NEWID(),
    org_id         UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_quotation_items_org REFERENCES dbo.organizations (id),
    quotation_id   UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_quotation_items_quotation REFERENCES dbo.quotations (id) ON DELETE CASCADE,
    position       INT              NOT NULL DEFAULT 0,
    description    NVARCHAR(500)    NOT NULL CONSTRAINT CK_quotation_items_desc CHECK (LEN(LTRIM(description)) > 0),
    detail         NVARCHAR(1000)   NULL,
    material_id    UNIQUEIDENTIFIER NULL CONSTRAINT FK_quotation_items_material REFERENCES dbo.materials (id),
    material_name  NVARCHAR(150)    NULL,
    quantity       DECIMAL(12, 3)   NOT NULL CONSTRAINT CK_quotation_items_qty CHECK (quantity > 0),
    unit           NVARCHAR(10)     NOT NULL DEFAULT N'und',
    unit_price     DECIMAL(12, 2)   NOT NULL CONSTRAINT CK_quotation_items_price CHECK (unit_price >= 0),
    discount       DECIMAL(12, 2)   NOT NULL DEFAULT 0 CONSTRAINT CK_quotation_items_disc CHECK (discount >= 0),
    subtotal       AS CAST(ROUND(quantity * unit_price - discount, 2) AS DECIMAL(12, 2)) PERSISTED,
    CONSTRAINT CK_quotation_items_discount CHECK (discount <= ROUND(quantity * unit_price, 2))
  );
  CREATE INDEX IX_quotation_items_quotation ON dbo.quotation_items (quotation_id, position);
END
GO

-- ---------------------------------------------------------------------
-- Pedidos / órdenes de trabajo
-- ---------------------------------------------------------------------
IF OBJECT_ID(N'dbo.orders', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.orders (
    id                  UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_orders PRIMARY KEY DEFAULT NEWID(),
    org_id              UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_orders_org REFERENCES dbo.organizations (id),
    branch_id           UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_orders_branch REFERENCES dbo.branches (id),
    number              NVARCHAR(30)     NOT NULL,
    customer_id         UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_orders_customer REFERENCES dbo.customers (id),
    quotation_id        UNIQUEIDENTIFIER NULL CONSTRAINT FK_orders_quotation REFERENCES dbo.quotations (id),
    service_type_id     UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_orders_service REFERENCES dbo.service_types (id),
    status              NVARCHAR(20)     NOT NULL DEFAULT N'SOLICITUD'
                        CONSTRAINT CK_orders_status CHECK (status IN (N'SOLICITUD', N'COTIZADO', N'APROBADO', N'DISENO', N'PRODUCCION',
                                                                      N'CONTROL_CALIDAD', N'LISTO_ENTREGA', N'ENTREGADO', N'CERRADO',
                                                                      N'PAUSADO', N'CANCELADO')),
    priority            NVARCHAR(10)     NOT NULL DEFAULT N'MEDIA'
                        CONSTRAINT CK_orders_priority CHECK (priority IN (N'BAJA', N'MEDIA', N'ALTA', N'URGENTE')),
    title               NVARCHAR(200)    NOT NULL CONSTRAINT CK_orders_title CHECK (LEN(LTRIM(title)) > 0),
    description         NVARCHAR(MAX)    NULL,
    main_material       NVARCHAR(100)    NULL,
    estimated_weight    DECIMAL(10, 2)   NULL CONSTRAINT CK_orders_weight CHECK (estimated_weight IS NULL OR estimated_weight > 0),
    stone               NVARCHAR(100)    NULL,
    size                NVARCHAR(50)     NULL,
    notes               NVARCHAR(2000)   NULL,
    assigned_to         UNIQUEIDENTIFIER NULL CONSTRAINT FK_orders_assigned REFERENCES dbo.profiles (id),
    start_date          DATE             NOT NULL,
    due_date            DATE             NULL,
    delivered_at        DATETIMEOFFSET(3) NULL,
    closed_at           DATETIMEOFFSET(3) NULL,
    subtotal            DECIMAL(12, 2)   NOT NULL DEFAULT 0,
    discount_total      DECIMAL(12, 2)   NOT NULL DEFAULT 0,
    tax_rate            DECIMAL(5, 2)    NOT NULL DEFAULT 18 CONSTRAINT CK_orders_tax CHECK (tax_rate >= 0 AND tax_rate <= 100),
    tax_amount          DECIMAL(12, 2)   NOT NULL DEFAULT 0,
    total               DECIMAL(12, 2)   NOT NULL DEFAULT 0,
    amount_paid         DECIMAL(12, 2)   NOT NULL DEFAULT 0,
    balance             AS CAST(total - amount_paid AS DECIMAL(12, 2)) PERSISTED,
    payment_status      AS CAST(CASE WHEN amount_paid <= 0 THEN N'PENDIENTE'
                                     WHEN amount_paid >= total THEN N'PAGADO'
                                     ELSE N'PARCIAL' END AS NVARCHAR(10)) PERSISTED,
    progress            INT              NOT NULL DEFAULT 0 CONSTRAINT CK_orders_progress CHECK (progress BETWEEN 0 AND 100),
    current_stage_name  NVARCHAR(100)    NULL,
    qc_approved         BIT              NOT NULL DEFAULT 0,
    qc_approved_at      DATETIMEOFFSET(3) NULL,
    qc_approved_by      UNIQUEIDENTIFIER NULL CONSTRAINT FK_orders_qc_by REFERENCES dbo.profiles (id),
    created_by          UNIQUEIDENTIFIER NULL CONSTRAINT FK_orders_created_by REFERENCES dbo.profiles (id),
    created_at          DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    updated_at          DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT UQ_orders_number UNIQUE (org_id, number),
    CONSTRAINT CK_orders_dates CHECK (due_date IS NULL OR due_date >= start_date)
  );
  CREATE INDEX IX_orders_org_status ON dbo.orders (org_id, status);
  CREATE INDEX IX_orders_branch ON dbo.orders (branch_id, status);
  CREATE INDEX IX_orders_customer ON dbo.orders (customer_id);
  CREATE INDEX IX_orders_assigned ON dbo.orders (assigned_to);
  CREATE INDEX IX_orders_due ON dbo.orders (org_id, due_date);
  CREATE UNIQUE INDEX UX_orders_quotation ON dbo.orders (quotation_id) WHERE quotation_id IS NOT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_quotations_order')
  ALTER TABLE dbo.quotations ADD CONSTRAINT FK_quotations_order FOREIGN KEY (order_id) REFERENCES dbo.orders (id);
GO

IF OBJECT_ID(N'dbo.order_items', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.order_items (
    id             UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_order_items PRIMARY KEY DEFAULT NEWID(),
    org_id         UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_order_items_org REFERENCES dbo.organizations (id),
    order_id       UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_order_items_order REFERENCES dbo.orders (id) ON DELETE CASCADE,
    position       INT              NOT NULL DEFAULT 0,
    description    NVARCHAR(500)    NOT NULL CONSTRAINT CK_order_items_desc CHECK (LEN(LTRIM(description)) > 0),
    detail         NVARCHAR(1000)   NULL,
    material_id    UNIQUEIDENTIFIER NULL CONSTRAINT FK_order_items_material REFERENCES dbo.materials (id),
    material_name  NVARCHAR(150)    NULL,
    quantity       DECIMAL(12, 3)   NOT NULL CONSTRAINT CK_order_items_qty CHECK (quantity > 0),
    unit           NVARCHAR(10)     NOT NULL DEFAULT N'und',
    unit_price     DECIMAL(12, 2)   NOT NULL CONSTRAINT CK_order_items_price CHECK (unit_price >= 0),
    discount       DECIMAL(12, 2)   NOT NULL DEFAULT 0 CONSTRAINT CK_order_items_disc CHECK (discount >= 0),
    subtotal       AS CAST(ROUND(quantity * unit_price - discount, 2) AS DECIMAL(12, 2)) PERSISTED,
    CONSTRAINT CK_order_items_discount CHECK (discount <= ROUND(quantity * unit_price, 2))
  );
  CREATE INDEX IX_order_items_order ON dbo.order_items (order_id, position);
END
GO

IF OBJECT_ID(N'dbo.order_production_stages', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.order_production_stages (
    id                UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_order_production_stages PRIMARY KEY DEFAULT NEWID(),
    org_id            UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_ops_org REFERENCES dbo.organizations (id),
    order_id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_ops_order REFERENCES dbo.orders (id) ON DELETE CASCADE,
    stage_id          UNIQUEIDENTIFIER NULL CONSTRAINT FK_ops_stage REFERENCES dbo.production_stages (id),
    name              NVARCHAR(100)    NOT NULL,
    position          INT              NOT NULL,
    is_quality_check  BIT              NOT NULL DEFAULT 0,
    assigned_to       UNIQUEIDENTIFIER NULL CONSTRAINT FK_ops_assigned REFERENCES dbo.profiles (id),
    status            NVARCHAR(20)     NOT NULL DEFAULT N'PENDIENTE'
                      CONSTRAINT CK_ops_status CHECK (status IN (N'PENDIENTE', N'EN_PROCESO', N'COMPLETADO', N'BLOQUEADO')),
    is_current        BIT              NOT NULL DEFAULT 0,
    started_at        DATETIMEOFFSET(3) NULL,
    completed_at      DATETIMEOFFSET(3) NULL,
    notes             NVARCHAR(1000)   NULL,
    created_at        DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    updated_at        DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET()
  );
  CREATE INDEX IX_ops_order ON dbo.order_production_stages (order_id, position);
  CREATE INDEX IX_ops_assigned ON dbo.order_production_stages (assigned_to);
  -- Regla: solo una etapa actual por pedido
  CREATE UNIQUE INDEX UX_ops_one_current ON dbo.order_production_stages (order_id) WHERE is_current = 1;
END
GO

IF OBJECT_ID(N'dbo.order_history', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.order_history (
    id           UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_order_history PRIMARY KEY DEFAULT NEWID(),
    org_id       UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_order_history_org REFERENCES dbo.organizations (id),
    order_id     UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_order_history_order REFERENCES dbo.orders (id) ON DELETE CASCADE,
    event_type   NVARCHAR(20)     NOT NULL CONSTRAINT CK_order_history_type
                 CHECK (event_type IN (N'CREACION', N'MODIFICACION', N'ESTADO', N'RESPONSABLE', N'PRODUCCION',
                                       N'PAGO', N'MATERIAL', N'ARCHIVO', N'ENTREGA', N'CIERRE')),
    description  NVARCHAR(2000)   NOT NULL,
    old_value    NVARCHAR(500)    NULL,
    new_value    NVARCHAR(500)    NULL,
    actor_id     UNIQUEIDENTIFIER NULL,
    actor_name   NVARCHAR(150)    NOT NULL,
    created_at   DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET()
  );
  CREATE INDEX IX_order_history_order ON dbo.order_history (order_id, created_at DESC);
END
GO

-- ---------------------------------------------------------------------
-- Movimientos de material (inmutables: las correcciones son AJUSTE)
--   EMPRESA -> afecta el stock de la sucursal y el consolidado
--   CLIENTE -> material entregado por el cliente para un pedido
-- ---------------------------------------------------------------------
IF OBJECT_ID(N'dbo.material_movements', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.material_movements (
    id                     UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_material_movements PRIMARY KEY DEFAULT NEWID(),
    org_id                 UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_mm_org REFERENCES dbo.organizations (id),
    branch_id              UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_mm_branch REFERENCES dbo.branches (id),
    material_id            UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_mm_material REFERENCES dbo.materials (id),
    order_id               UNIQUEIDENTIFIER NULL CONSTRAINT FK_mm_order REFERENCES dbo.orders (id),
    movement_type          NVARCHAR(20)     NOT NULL CONSTRAINT CK_mm_type
                           CHECK (movement_type IN (N'ENTRADA', N'SALIDA', N'AJUSTE', N'CONSUMO', N'DEVOLUCION',
                                                    N'TRASLADO_SALIDA', N'TRASLADO_ENTRADA')),
    ownership              NVARCHAR(10)     NOT NULL DEFAULT N'EMPRESA' CONSTRAINT CK_mm_ownership CHECK (ownership IN (N'EMPRESA', N'CLIENTE')),
    quantity               DECIMAL(14, 3)   NOT NULL CONSTRAINT CK_mm_qty_nonzero CHECK (quantity <> 0),
    unit_cost              DECIMAL(12, 2)   NULL CONSTRAINT CK_mm_cost CHECK (unit_cost IS NULL OR unit_cost >= 0),
    movement_date          DATE             NOT NULL,
    notes                  NVARCHAR(1000)   NULL,
    stock_after            DECIMAL(14, 3)   NULL,                   -- saldo de la sucursal
    transfer_id            UNIQUEIDENTIFIER NULL,
    counterpart_branch_id  UNIQUEIDENTIFIER NULL CONSTRAINT FK_mm_counterpart REFERENCES dbo.branches (id),
    created_by             UNIQUEIDENTIFIER NULL CONSTRAINT FK_mm_created_by REFERENCES dbo.profiles (id),
    created_at             DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT CK_mm_positive_qty CHECK (movement_type = N'AJUSTE' OR quantity > 0),
    CONSTRAINT CK_mm_consumption_needs_order CHECK (movement_type <> N'CONSUMO' OR order_id IS NOT NULL),
    CONSTRAINT CK_mm_client_needs_order CHECK (ownership <> N'CLIENTE' OR order_id IS NOT NULL),
    CONSTRAINT CK_mm_client_types CHECK (ownership <> N'CLIENTE' OR movement_type IN (N'ENTRADA', N'CONSUMO', N'DEVOLUCION')),
    CONSTRAINT CK_mm_transfer_fields CHECK (
      (movement_type IN (N'TRASLADO_SALIDA', N'TRASLADO_ENTRADA') AND transfer_id IS NOT NULL AND counterpart_branch_id IS NOT NULL)
      OR (movement_type NOT IN (N'TRASLADO_SALIDA', N'TRASLADO_ENTRADA') AND transfer_id IS NULL AND counterpart_branch_id IS NULL)),
    CONSTRAINT CK_mm_transfer_company CHECK (
      movement_type NOT IN (N'TRASLADO_SALIDA', N'TRASLADO_ENTRADA') OR (ownership = N'EMPRESA' AND order_id IS NULL)),
    CONSTRAINT CK_mm_transfer_branches CHECK (counterpart_branch_id IS NULL OR counterpart_branch_id <> branch_id)
  );
  CREATE INDEX IX_mm_material ON dbo.material_movements (material_id, movement_date DESC);
  CREATE INDEX IX_mm_order ON dbo.material_movements (order_id);
  CREATE INDEX IX_mm_branch ON dbo.material_movements (branch_id, movement_date DESC);
  CREATE INDEX IX_mm_transfer ON dbo.material_movements (transfer_id) WHERE transfer_id IS NOT NULL;
END
GO

-- ---------------------------------------------------------------------
-- Pagos (no se eliminan: se anulan)
-- ---------------------------------------------------------------------
IF OBJECT_ID(N'dbo.payments', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.payments (
    id                     UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_payments PRIMARY KEY DEFAULT NEWID(),
    org_id                 UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_payments_org REFERENCES dbo.organizations (id),
    branch_id              UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_payments_branch REFERENCES dbo.branches (id),  -- donde se cobró
    order_id               UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_payments_order REFERENCES dbo.orders (id),
    payment_date           DATE             NOT NULL,
    amount                 DECIMAL(12, 2)   NOT NULL CONSTRAINT CK_payments_amount CHECK (amount > 0),
    method                 NVARCHAR(20)     NOT NULL CONSTRAINT CK_payments_method
                           CHECK (method IN (N'EFECTIVO', N'YAPE', N'PLIN', N'TRANSFERENCIA', N'TARJETA', N'OTRO')),
    reference              NVARCHAR(100)    NULL,
    notes                  NVARCHAR(1000)   NULL,
    is_advance             BIT              NOT NULL DEFAULT 0,
    overpayment_confirmed  BIT              NOT NULL DEFAULT 0,
    voided                 BIT              NOT NULL DEFAULT 0,
    voided_at              DATETIMEOFFSET(3) NULL,
    voided_by              UNIQUEIDENTIFIER NULL CONSTRAINT FK_payments_voided_by REFERENCES dbo.profiles (id),
    void_reason            NVARCHAR(500)    NULL,
    created_by             UNIQUEIDENTIFIER NULL CONSTRAINT FK_payments_created_by REFERENCES dbo.profiles (id),
    created_at             DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET()
  );
  CREATE INDEX IX_payments_order ON dbo.payments (order_id);
  CREATE INDEX IX_payments_org_date ON dbo.payments (org_id, payment_date);
  CREATE INDEX IX_payments_branch_date ON dbo.payments (branch_id, payment_date);
END
GO

-- ---------------------------------------------------------------------
-- Entregas
-- ---------------------------------------------------------------------
IF OBJECT_ID(N'dbo.deliveries', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.deliveries (
    id                UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_deliveries PRIMARY KEY DEFAULT NEWID(),
    org_id            UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_deliveries_org REFERENCES dbo.organizations (id),
    branch_id         UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_deliveries_branch REFERENCES dbo.branches (id),
    number            NVARCHAR(30)     NOT NULL,
    order_id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_deliveries_order REFERENCES dbo.orders (id),
    customer_id       UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_deliveries_customer REFERENCES dbo.customers (id),
    status            NVARCHAR(20)     NOT NULL DEFAULT N'PENDIENTE'
                      CONSTRAINT CK_deliveries_status CHECK (status IN (N'PENDIENTE', N'LISTA', N'ENTREGADA', N'NO_ENTREGADA')),
    scheduled_date    DATE             NOT NULL,
    delivered_at      DATETIMEOFFSET(3) NULL,
    responsible_id    UNIQUEIDENTIFIER NULL CONSTRAINT FK_deliveries_responsible REFERENCES dbo.profiles (id),
    received_by       NVARCHAR(150)    NULL,
    conformity        BIT              NULL,
    conformity_notes  NVARCHAR(1000)   NULL,
    signature_path    NVARCHAR(500)    NULL,
    notes             NVARCHAR(1000)   NULL,
    created_by        UNIQUEIDENTIFIER NULL CONSTRAINT FK_deliveries_created_by REFERENCES dbo.profiles (id),
    created_at        DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    updated_at        DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT UQ_deliveries_number UNIQUE (org_id, number)
  );
  CREATE INDEX IX_deliveries_order ON dbo.deliveries (order_id);
  CREATE INDEX IX_deliveries_org_status ON dbo.deliveries (org_id, status, scheduled_date);
  CREATE INDEX IX_deliveries_branch ON dbo.deliveries (branch_id, status, scheduled_date);
END
GO

-- ---------------------------------------------------------------------
-- Archivos adjuntos (metadata; el archivo lo guarda la API)
-- ---------------------------------------------------------------------
IF OBJECT_ID(N'dbo.attachments', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.attachments (
    id            UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_attachments PRIMARY KEY DEFAULT NEWID(),
    org_id        UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_attachments_org REFERENCES dbo.organizations (id),
    order_id      UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_attachments_order REFERENCES dbo.orders (id),
    category      NVARCHAR(20)     NOT NULL DEFAULT N'FOTO'
                  CONSTRAINT CK_attachments_category CHECK (category IN (N'FOTO', N'DISENO', N'BOCETO', N'DOCUMENTO', N'EVIDENCIA')),
    file_name     NVARCHAR(255)    NOT NULL,
    storage_path  NVARCHAR(500)    NOT NULL CONSTRAINT UQ_attachments_path UNIQUE,
    mime_type     NVARCHAR(100)    NULL,
    size_bytes    BIGINT           NULL,
    description   NVARCHAR(500)    NULL,
    uploaded_by   UNIQUEIDENTIFIER NULL CONSTRAINT FK_attachments_uploaded_by REFERENCES dbo.profiles (id),
    created_at    DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    deleted_at    DATETIMEOFFSET(3) NULL,
    deleted_by    UNIQUEIDENTIFIER NULL CONSTRAINT FK_attachments_deleted_by REFERENCES dbo.profiles (id)
  );
  CREATE INDEX IX_attachments_order ON dbo.attachments (order_id) WHERE deleted_at IS NULL;
END
GO

-- ---------------------------------------------------------------------
-- Plataforma SaaS: pagos de suscripción, solicitudes, invitaciones
-- ---------------------------------------------------------------------
IF OBJECT_ID(N'dbo.subscription_payments', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.subscription_payments (
    id            UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_subscription_payments PRIMARY KEY DEFAULT NEWID(),
    org_id        UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_subscription_payments_org REFERENCES dbo.organizations (id),
    plan_code     NVARCHAR(20)     NOT NULL CONSTRAINT FK_subscription_payments_plan REFERENCES dbo.plans (code),
    amount        DECIMAL(10, 2)   NOT NULL CONSTRAINT CK_subscription_payments_amount CHECK (amount > 0),
    method        NVARCHAR(20)     NOT NULL CONSTRAINT CK_subscription_payments_method
                  CHECK (method IN (N'YAPE', N'PLIN', N'TRANSFERENCIA', N'EFECTIVO', N'TARJETA', N'OTRO')),
    reference     NVARCHAR(100)    NULL,
    months        INT              NOT NULL CONSTRAINT CK_subscription_payments_months CHECK (months BETWEEN 1 AND 36),
    paid_at       DATE             NOT NULL,
    period_start  DATE             NOT NULL,
    period_end    DATE             NOT NULL,
    created_by    UNIQUEIDENTIFIER NULL CONSTRAINT FK_subscription_payments_by REFERENCES dbo.users (id),
    created_at    DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT CK_subscription_payments_period CHECK (period_end >= period_start)
  );
  CREATE INDEX IX_subscription_payments_org ON dbo.subscription_payments (org_id, paid_at DESC);
END
GO

IF OBJECT_ID(N'dbo.access_requests', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.access_requests (
    id             UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_access_requests PRIMARY KEY DEFAULT NEWID(),
    company_name   NVARCHAR(120)    NOT NULL CONSTRAINT CK_access_requests_company CHECK (LEN(LTRIM(company_name)) BETWEEN 2 AND 120),
    tax_id         NVARCHAR(11)     NULL CONSTRAINT CK_access_requests_tax
                   CHECK (tax_id IS NULL OR (LEN(tax_id) = 11 AND tax_id NOT LIKE N'%[^0-9]%' AND LEFT(tax_id, 2) IN (N'10', N'15', N'17', N'20'))),
    contact_name   NVARCHAR(120)    NOT NULL CONSTRAINT CK_access_requests_contact CHECK (LEN(LTRIM(contact_name)) BETWEEN 3 AND 120),
    email          NVARCHAR(254)    NOT NULL CONSTRAINT CK_access_requests_email CHECK (email LIKE N'%_@_%._%' AND email NOT LIKE N'% %'),
    phone          NVARCHAR(30)     NULL,
    plan_code      NVARCHAR(20)     NULL CONSTRAINT FK_access_requests_plan REFERENCES dbo.plans (code),
    message        NVARCHAR(1000)   NULL,
    status         NVARCHAR(10)     NOT NULL DEFAULT N'PENDING'
                   CONSTRAINT CK_access_requests_status CHECK (status IN (N'PENDING', N'APPROVED', N'REJECTED')),
    org_id         UNIQUEIDENTIFIER NULL CONSTRAINT FK_access_requests_org REFERENCES dbo.organizations (id),
    reject_reason  NVARCHAR(500)    NULL,
    reviewed_by    UNIQUEIDENTIFIER NULL CONSTRAINT FK_access_requests_reviewer REFERENCES dbo.users (id),
    reviewed_at    DATETIMEOFFSET(3) NULL,
    created_at     DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET()
  );
  CREATE UNIQUE INDEX UX_access_requests_pending_email ON dbo.access_requests (email) WHERE status = N'PENDING';
END
GO

-- Invitaciones: única vía para crear usuarios (además del primer arranque).
IF OBJECT_ID(N'dbo.invitations', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.invitations (
    id           UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_invitations PRIMARY KEY DEFAULT NEWID(),
    org_id       UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_invitations_org REFERENCES dbo.organizations (id),
    email        NVARCHAR(254)    NOT NULL CONSTRAINT CK_invitations_email CHECK (email LIKE N'%_@_%._%' AND email NOT LIKE N'% %'),
    full_name    NVARCHAR(150)    NULL,
    role         NVARCHAR(20)     NOT NULL CONSTRAINT CK_invitations_role
                 CHECK (role IN (N'ADMIN', N'GERENTE', N'VENDEDOR', N'ORFEBRE', N'SUPERVISOR')),
    branch_ids   NVARCHAR(MAX)    NULL CONSTRAINT CK_invitations_branch_ids CHECK (branch_ids IS NULL OR ISJSON(branch_ids) = 1),
    status       NVARCHAR(10)     NOT NULL DEFAULT N'PENDING'
                 CONSTRAINT CK_invitations_status CHECK (status IN (N'PENDING', N'ACCEPTED', N'REVOKED')),
    token_hash   VARBINARY(32)    NOT NULL,
    expires_at   DATETIMEOFFSET(3) NOT NULL,
    invited_by   UNIQUEIDENTIFIER NULL CONSTRAINT FK_invitations_by REFERENCES dbo.users (id),
    created_at   DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    accepted_at  DATETIMEOFFSET(3) NULL,
    CONSTRAINT UQ_invitations_token UNIQUE (token_hash)
  );
  CREATE UNIQUE INDEX UX_invitations_pending_email ON dbo.invitations (email) WHERE status = N'PENDING';
  CREATE INDEX IX_invitations_org ON dbo.invitations (org_id, created_at DESC);
END
GO

IF OBJECT_ID(N'dbo.password_reset_tokens', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.password_reset_tokens (
    id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_password_reset_tokens PRIMARY KEY DEFAULT NEWID(),
    user_id     UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_password_reset_user REFERENCES dbo.users (id) ON DELETE CASCADE,
    token_hash  VARBINARY(32)    NOT NULL CONSTRAINT UQ_password_reset_token UNIQUE,
    expires_at  DATETIMEOFFSET(3) NOT NULL,
    used_at     DATETIMEOFFSET(3) NULL,
    created_at  DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET()
  );
  CREATE INDEX IX_password_reset_user ON dbo.password_reset_tokens (user_id);
END
GO

-- ---------------------------------------------------------------------
-- Vista: saldo de material del cliente por pedido
-- ---------------------------------------------------------------------
CREATE OR ALTER VIEW dbo.order_client_materials
AS
SELECT mm.order_id,
       mm.material_id,
       m.name   AS material_name,
       m.purity,
       m.unit,
       SUM(CASE WHEN mm.movement_type = N'ENTRADA' THEN mm.quantity ELSE 0 END)    AS received,
       SUM(CASE WHEN mm.movement_type = N'CONSUMO' THEN mm.quantity ELSE 0 END)    AS used,
       SUM(CASE WHEN mm.movement_type = N'DEVOLUCION' THEN mm.quantity ELSE 0 END) AS returned,
       SUM(CASE WHEN mm.movement_type = N'ENTRADA' THEN mm.quantity
                WHEN mm.movement_type IN (N'CONSUMO', N'DEVOLUCION') THEN -mm.quantity
                ELSE 0 END)                                                       AS balance
  FROM dbo.material_movements mm
  JOIN dbo.materials m ON m.id = mm.material_id
 WHERE mm.ownership = N'CLIENTE'
 GROUP BY mm.order_id, mm.material_id, m.name, m.purity, m.unit;
GO


/* =====================================================================
   2. FUNCIONES DE APOYO
   ===================================================================== */

-- Fecha y hora de Lima
CREATE OR ALTER FUNCTION dbo.fn_now()
RETURNS DATETIMEOFFSET(3)
AS
BEGIN
  RETURN CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'SA Pacific Standard Time' AS DATETIMEOFFSET(3));
END
GO

CREATE OR ALTER FUNCTION dbo.fn_today()
RETURNS DATE
AS
BEGIN
  RETURN CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'SA Pacific Standard Time' AS DATE);
END
GO

-- Fecha de Lima de un timestamp
CREATE OR ALTER FUNCTION dbo.fn_local_date(@ts DATETIMEOFFSET(3))
RETURNS DATE
AS
BEGIN
  RETURN CAST(@ts AT TIME ZONE 'SA Pacific Standard Time' AS DATE);
END
GO

-- Etiquetas en español (mensajes de auditoría)
CREATE OR ALTER FUNCTION dbo.fn_order_status_label(@status NVARCHAR(20))
RETURNS NVARCHAR(40)
AS
BEGIN
  RETURN CASE @status
    WHEN N'SOLICITUD' THEN N'Solicitud'
    WHEN N'COTIZADO' THEN N'Cotizado'
    WHEN N'APROBADO' THEN N'Aprobado'
    WHEN N'DISENO' THEN N'Diseño'
    WHEN N'PRODUCCION' THEN N'Producción'
    WHEN N'CONTROL_CALIDAD' THEN N'Control de calidad'
    WHEN N'LISTO_ENTREGA' THEN N'Listo para entregar'
    WHEN N'ENTREGADO' THEN N'Entregado'
    WHEN N'CERRADO' THEN N'Cerrado'
    WHEN N'PAUSADO' THEN N'Pausado'
    WHEN N'CANCELADO' THEN N'Cancelado'
    ELSE @status END;
END
GO

CREATE OR ALTER FUNCTION dbo.fn_stage_status_label(@status NVARCHAR(20))
RETURNS NVARCHAR(40)
AS
BEGIN
  RETURN CASE @status
    WHEN N'PENDIENTE' THEN N'Pendiente'
    WHEN N'EN_PROCESO' THEN N'En proceso'
    WHEN N'COMPLETADO' THEN N'Completado'
    WHEN N'BLOQUEADO' THEN N'Bloqueado'
    ELSE @status END;
END
GO

CREATE OR ALTER FUNCTION dbo.fn_format_money(@amount DECIMAL(14, 2))
RETURNS NVARCHAR(40)
AS
BEGIN
  RETURN N'S/ ' + FORMAT(@amount, 'N2', 'en-US');
END
GO

CREATE OR ALTER FUNCTION dbo.fn_format_qty(@qty DECIMAL(14, 3), @decimals INT)
RETURNS NVARCHAR(40)
AS
BEGIN
  RETURN FORMAT(@qty, CONCAT('N', @decimals), 'en-US');
END
GO

-- Nombre para auditoría ('Sistema' si no hay usuario)
CREATE OR ALTER FUNCTION dbo.fn_user_name(@user_id UNIQUEIDENTIFIER)
RETURNS NVARCHAR(150)
AS
BEGIN
  RETURN ISNULL((SELECT full_name FROM dbo.profiles WHERE id = @user_id), N'Sistema');
END
GO

CREATE OR ALTER FUNCTION dbo.fn_is_platform_admin(@user_id UNIQUEIDENTIFIER)
RETURNS BIT
AS
BEGIN
  RETURN CASE WHEN EXISTS (SELECT 1 FROM dbo.platform_admins WHERE user_id = @user_id) THEN 1 ELSE 0 END;
END
GO

-- ---------------------------------------------------------------------
-- Suscripción: TRIAL | ACTIVE | GRACE | EXPIRED | SUSPENDED | CANCELLED
-- ---------------------------------------------------------------------
CREATE OR ALTER FUNCTION dbo.fn_org_access_state(@org_id UNIQUEIDENTIFIER)
RETURNS NVARCHAR(20)
AS
BEGIN
  DECLARE @state NVARCHAR(20), @today DATE = dbo.fn_today();
  SELECT @state = CASE
           WHEN s.status IN (N'SUSPENDED', N'CANCELLED') THEN s.status
           WHEN @today <= s.current_period_end THEN s.status
           WHEN s.status = N'ACTIVE' AND @today <= DATEADD(DAY, s.grace_days, s.current_period_end) THEN N'GRACE'
           ELSE N'EXPIRED' END
    FROM dbo.subscriptions s WHERE s.org_id = @org_id;
  RETURN ISNULL(@state, N'EXPIRED');
END
GO

CREATE OR ALTER FUNCTION dbo.fn_org_can_write(@org_id UNIQUEIDENTIFIER)
RETURNS BIT
AS
BEGIN
  RETURN CASE WHEN dbo.fn_org_access_state(@org_id) IN (N'TRIAL', N'ACTIVE', N'GRACE') THEN 1 ELSE 0 END;
END
GO

CREATE OR ALTER FUNCTION dbo.fn_org_seat_limit(@org_id UNIQUEIDENTIFIER)
RETURNS INT
AS
BEGIN
  RETURN (SELECT p.max_users + s.extra_users
            FROM dbo.subscriptions s JOIN dbo.plans p ON p.code = s.plan_code
           WHERE s.org_id = @org_id);
END
GO

-- Cupos usados: usuarios activos + invitaciones pendientes
CREATE OR ALTER FUNCTION dbo.fn_org_seats_used(@org_id UNIQUEIDENTIFIER, @exclude_email NVARCHAR(254))
RETURNS INT
AS
BEGIN
  RETURN (SELECT COUNT(*) FROM dbo.profiles
           WHERE org_id = @org_id AND active = 1 AND (@exclude_email IS NULL OR email <> @exclude_email))
       + (SELECT COUNT(*) FROM dbo.invitations
           WHERE org_id = @org_id AND status = N'PENDING' AND (@exclude_email IS NULL OR email <> @exclude_email));
END
GO

CREATE OR ALTER FUNCTION dbo.fn_org_branch_limit(@org_id UNIQUEIDENTIFIER)
RETURNS INT
AS
BEGIN
  RETURN (SELECT p.max_branches
            FROM dbo.subscriptions s JOIN dbo.plans p ON p.code = s.plan_code
           WHERE s.org_id = @org_id);
END
GO

CREATE OR ALTER FUNCTION dbo.fn_org_branches_used(@org_id UNIQUEIDENTIFIER)
RETURNS INT
AS
BEGIN
  RETURN (SELECT COUNT(*) FROM dbo.branches WHERE org_id = @org_id AND active = 1);
END
GO

-- ---------------------------------------------------------------------
-- Visibilidad (equivalente a las políticas RLS de PostgreSQL)
-- ---------------------------------------------------------------------

-- Sucursales visibles: ADMIN y GERENTE todas; el resto, las asignadas.
-- Incluye inactivas, por el histórico.
CREATE OR ALTER FUNCTION dbo.fn_user_branch_ids(@user_id UNIQUEIDENTIFIER)
RETURNS TABLE
AS
RETURN
  SELECT b.id AS branch_id
    FROM dbo.profiles p
    JOIN dbo.branches b ON b.org_id = p.org_id
   WHERE p.id = @user_id AND p.active = 1
     AND (p.role IN (N'ADMIN', N'GERENTE')
          OR EXISTS (SELECT 1 FROM dbo.user_branches ub WHERE ub.user_id = @user_id AND ub.branch_id = b.id));
GO

-- Pedidos visibles (@order_id = NULL: todos los visibles).
--   ADMIN, GERENTE, VENDEDOR, SUPERVISOR: pedidos de sus sucursales
--   ORFEBRE: pedidos asignados a él o con una etapa suya, de cualquier sucursal
CREATE OR ALTER FUNCTION dbo.fn_visible_orders(@user_id UNIQUEIDENTIFIER, @order_id UNIQUEIDENTIFIER)
RETURNS TABLE
AS
RETURN
  SELECT o.id
    FROM dbo.orders o
    JOIN dbo.profiles p ON p.id = @user_id AND p.active = 1 AND p.org_id = o.org_id
   WHERE (@order_id IS NULL OR o.id = @order_id)
     AND (
       (p.role IN (N'ADMIN', N'GERENTE', N'VENDEDOR', N'SUPERVISOR')
         AND o.branch_id IN (SELECT branch_id FROM dbo.fn_user_branch_ids(@user_id)))
       OR (p.role = N'ORFEBRE' AND (
             o.assigned_to = @user_id
             OR EXISTS (SELECT 1 FROM dbo.order_production_stages s
                         WHERE s.order_id = o.id AND s.assigned_to = @user_id)))
     );
GO

-- Sucursal por defecto: la preferida del usuario, la primera asignada o la principal.
CREATE OR ALTER FUNCTION dbo.fn_default_branch_id(@user_id UNIQUEIDENTIFIER, @org_id UNIQUEIDENTIFIER)
RETURNS UNIQUEIDENTIFIER
AS
BEGIN
  RETURN COALESCE(
    (SELECT b.id FROM dbo.profiles p
       JOIN dbo.branches b ON b.id = p.default_branch_id
      WHERE p.id = @user_id AND b.org_id = @org_id AND b.active = 1),
    (SELECT TOP (1) b.id FROM dbo.user_branches ub
       JOIN dbo.branches b ON b.id = ub.branch_id
      WHERE ub.user_id = @user_id AND b.org_id = @org_id AND b.active = 1
      ORDER BY b.is_main DESC, b.name),
    (SELECT id FROM dbo.branches WHERE org_id = @org_id AND is_main = 1));
END
GO


/* =====================================================================
   3. PROCEDIMIENTOS INTERNOS (dbo.usp_int_*)
   No manejan transacciones: los llama un procedimiento público dentro
   de la suya. La API no tiene permiso sobre ellos.
   ===================================================================== */

-- ---------------------------------------------------------------------
-- Contexto de seguridad: valida el usuario y devuelve empresa y rol.
--   @roles  lista separada por comas ('ADMIN,GERENTE'); NULL = cualquiera
--   @write  1 = la operación escribe (bloquea con el plan vencido)
-- ---------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.usp_int_ctx
  @user_id  UNIQUEIDENTIFIER,
  @roles    NVARCHAR(200) = NULL,
  @write    BIT = 0,
  @org_id   UNIQUEIDENTIFIER OUTPUT,
  @role     NVARCHAR(20) OUTPUT
AS
BEGIN
  SET NOCOUNT ON;
  SELECT @org_id = NULL, @role = NULL;

  SELECT @org_id = p.org_id, @role = p.role
    FROM dbo.profiles p
    JOIN dbo.subscriptions s ON s.org_id = p.org_id
   WHERE p.id = @user_id AND p.active = 1 AND s.status NOT IN (N'SUSPENDED', N'CANCELLED');

  IF @org_id IS NULL
    THROW 50001, N'Sesión no válida: el usuario está inactivo o la empresa está suspendida.', 1;

  IF @roles IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM STRING_SPLIT(@roles, N',') WHERE LTRIM(RTRIM(value)) = @role)
    THROW 50003, N'No tiene permisos para realizar esta acción.', 1;

  IF @write = 1 AND dbo.fn_org_can_write(@org_id) = 0
    THROW 50002, N'El plan de su empresa está vencido: el sistema está en modo solo lectura. Regularice el pago para seguir registrando información.', 1;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_int_assert_platform_admin
  @user_id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  IF dbo.fn_is_platform_admin(@user_id) = 0
    THROW 50003, N'Solo el administrador de la plataforma puede realizar esta acción.', 1;
END
GO

-- ---------------------------------------------------------------------
-- Numeración correlativa. Debe ejecutarse dentro de una transacción:
-- el bloqueo UPDLOCK/HOLDLOCK impide que dos usuarios obtengan el mismo número.
-- ---------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.usp_int_next_document_number
  @org_id    UNIQUEIDENTIFIER,
  @doc_type  NVARCHAR(3),
  @number    NVARCHAR(30) OUTPUT
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @year INT = YEAR(dbo.fn_today()), @value INT;

  IF NOT EXISTS (SELECT 1 FROM dbo.document_sequences WITH (UPDLOCK, HOLDLOCK)
                  WHERE org_id = @org_id AND doc_type = @doc_type AND year = @year)
    INSERT INTO dbo.document_sequences (org_id, doc_type, year, last_value) VALUES (@org_id, @doc_type, @year, 0);

  UPDATE dbo.document_sequences
     SET @value = last_value = last_value + 1
   WHERE org_id = @org_id AND doc_type = @doc_type AND year = @year;

  SET @number = CONCAT(@doc_type, N'-', @year, N'-', RIGHT(CONCAT(N'000000', @value), 6));
END
GO

-- Auditoría del pedido
CREATE OR ALTER PROCEDURE dbo.usp_int_log_order_event
  @order_id     UNIQUEIDENTIFIER,
  @user_id      UNIQUEIDENTIFIER,
  @event_type   NVARCHAR(20),
  @description  NVARCHAR(2000),
  @old_value    NVARCHAR(500) = NULL,
  @new_value    NVARCHAR(500) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.order_history (org_id, order_id, event_type, description, old_value, new_value, actor_id, actor_name, created_at)
  SELECT o.org_id, o.id, @event_type, @description, @old_value, @new_value, @user_id, dbo.fn_user_name(@user_id), dbo.fn_now()
    FROM dbo.orders o WHERE o.id = @order_id;
END
GO

-- El pedido debe ser visible para el usuario
CREATE OR ALTER PROCEDURE dbo.usp_int_assert_order_visible
  @user_id   UNIQUEIDENTIFIER,
  @order_id  UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM dbo.fn_visible_orders(@user_id, @order_id))
    THROW 50004, N'Pedido no encontrado o sin permisos.', 1;
END
GO

-- Pedido cerrado o cancelado: solo un ADMIN (o el sistema, @user_id NULL) lo modifica
CREATE OR ALTER PROCEDURE dbo.usp_int_assert_order_editable
  @order_id  UNIQUEIDENTIFIER,
  @user_id   UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @status NVARCHAR(20), @number NVARCHAR(30), @msg NVARCHAR(2048);
  SELECT @status = status, @number = number FROM dbo.orders WHERE id = @order_id;
  IF @status IN (N'CERRADO', N'CANCELADO') AND @user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM dbo.profiles WHERE id = @user_id AND role = N'ADMIN')
  BEGIN
    SET @msg = CONCAT(N'El pedido ', @number, N' está ', LOWER(dbo.fn_order_status_label(@status)),
                      N'; solo un administrador puede modificarlo.');
    THROW 50000, @msg, 1;
  END
END
GO

-- Totales del pedido a partir de sus ítems
CREATE OR ALTER PROCEDURE dbo.usp_int_recalc_order_totals
  @order_id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE o
     SET subtotal = t.gross,
         discount_total = t.disc,
         tax_amount = x.tax,
         total = t.gross - t.disc + x.tax
    FROM dbo.orders o
   CROSS APPLY (SELECT ISNULL(ROUND(SUM(i.quantity * i.unit_price), 2), 0) AS gross, ISNULL(SUM(i.discount), 0) AS disc
                  FROM dbo.order_items i WHERE i.order_id = o.id) t
   CROSS APPLY (SELECT ROUND((t.gross - t.disc) * o.tax_rate / 100, 2) AS tax) x
   WHERE o.id = @order_id;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_int_recalc_quotation_totals
  @quotation_id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE q
     SET subtotal = t.gross,
         discount_total = t.disc,
         tax_amount = x.tax,
         total = t.gross - t.disc + x.tax
    FROM dbo.quotations q
   CROSS APPLY (SELECT ISNULL(ROUND(SUM(i.quantity * i.unit_price), 2), 0) AS gross, ISNULL(SUM(i.discount), 0) AS disc
                  FROM dbo.quotation_items i WHERE i.quotation_id = q.id) t
   CROSS APPLY (SELECT ROUND((t.gross - t.disc) * q.tax_rate / 100, 2) AS tax) x
   WHERE q.id = @quotation_id;
END
GO

-- ---------------------------------------------------------------------
-- Sucursal de un registro nuevo: la indicada o la por defecto del usuario.
-- Debe pertenecer a la empresa, estar activa y ser accesible.
-- ---------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.usp_int_resolve_branch
  @user_id    UNIQUEIDENTIFIER,
  @org_id     UNIQUEIDENTIFIER,
  @branch_id  UNIQUEIDENTIFIER OUTPUT
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @b_org UNIQUEIDENTIFIER, @active BIT, @name NVARCHAR(100), @msg NVARCHAR(2048);

  IF @branch_id IS NULL SET @branch_id = dbo.fn_default_branch_id(@user_id, @org_id);

  SELECT @b_org = org_id, @active = active, @name = name FROM dbo.branches WHERE id = @branch_id;
  IF @b_org IS NULL OR @b_org <> @org_id
    THROW 50000, N'La sucursal indicada no pertenece a la empresa.', 1;
  IF @active = 0
  BEGIN
    SET @msg = CONCAT(N'La sucursal ', @name, N' está inactiva.');
    THROW 50000, @msg, 1;
  END
  IF NOT EXISTS (SELECT 1 FROM dbo.fn_user_branch_ids(@user_id) WHERE branch_id = @branch_id)
  BEGIN
    SET @msg = CONCAT(N'No tiene acceso a la sucursal ', @name, N'.');
    THROW 50003, @msg, 1;
  END
END
GO

-- ---------------------------------------------------------------------
-- Registra un movimiento de material y actualiza el stock por sucursal
-- y el consolidado. Bloquear el material serializa sus movimientos.
-- ---------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.usp_int_apply_material_movement
  @user_id                UNIQUEIDENTIFIER,
  @org_id                 UNIQUEIDENTIFIER,
  @branch_id              UNIQUEIDENTIFIER,
  @material_id            UNIQUEIDENTIFIER,
  @order_id               UNIQUEIDENTIFIER,
  @movement_type          NVARCHAR(20),
  @ownership              NVARCHAR(10),
  @quantity               DECIMAL(14, 3),
  @unit_cost              DECIMAL(12, 2),
  @movement_date          DATE,
  @notes                  NVARCHAR(1000),
  @transfer_id            UNIQUEIDENTIFIER = NULL,
  @counterpart_branch_id  UNIQUEIDENTIFIER = NULL,
  @movement_id            UNIQUEIDENTIFIER OUTPUT
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @stock DECIMAL(14, 3), @name NVARCHAR(150), @unit NVARCHAR(5), @delta DECIMAL(14, 3),
          @branch_stock DECIMAL(14, 3), @branch_name NVARCHAR(100), @client_balance DECIMAL(14, 3),
          @stock_after DECIMAL(14, 3), @msg NVARCHAR(2048), @now DATETIMEOFFSET(3) = dbo.fn_now();

  IF @order_id IS NOT NULL
    EXEC dbo.usp_int_assert_order_editable @order_id, @user_id;

  SELECT @stock = stock, @name = name, @unit = unit
    FROM dbo.materials WITH (UPDLOCK, ROWLOCK)
   WHERE id = @material_id AND org_id = @org_id;
  IF @name IS NULL
    THROW 50004, N'Material no encontrado.', 1;

  IF @ownership = N'EMPRESA'
  BEGIN
    SET @delta = CASE WHEN @movement_type IN (N'ENTRADA', N'DEVOLUCION', N'AJUSTE', N'TRASLADO_ENTRADA')
                      THEN @quantity ELSE -@quantity END;

    SELECT @branch_stock = stock FROM dbo.material_stock
     WHERE material_id = @material_id AND branch_id = @branch_id;
    SET @branch_stock = ISNULL(@branch_stock, 0);

    IF @branch_stock + @delta < 0
    BEGIN
      SELECT @branch_name = name FROM dbo.branches WHERE id = @branch_id;
      SET @msg = CONCAT(N'Stock insuficiente de ', @name, N' en ', @branch_name, N': disponible ',
                        dbo.fn_format_qty(@branch_stock, 3), N' ', @unit, N', requerido ',
                        dbo.fn_format_qty(ABS(@delta), 3), N' ', @unit, N'.');
      THROW 50000, @msg, 1;
    END

    SET @stock_after = @branch_stock + @delta;
    UPDATE dbo.material_stock SET stock = @stock_after, updated_at = @now
     WHERE material_id = @material_id AND branch_id = @branch_id;
    IF @@ROWCOUNT = 0
      INSERT INTO dbo.material_stock (org_id, material_id, branch_id, stock, updated_at)
      VALUES (@org_id, @material_id, @branch_id, @stock_after, @now);

    UPDATE dbo.materials SET stock = @stock + @delta, updated_at = @now WHERE id = @material_id;
  END
  ELSE IF @movement_type IN (N'CONSUMO', N'DEVOLUCION')
  BEGIN
    SELECT @client_balance = balance FROM dbo.order_client_materials
     WHERE order_id = @order_id AND material_id = @material_id;
    IF ISNULL(@client_balance, 0) < @quantity
    BEGIN
      SET @msg = CONCAT(N'El saldo de ', @name, N' entregado por el cliente es ',
                        dbo.fn_format_qty(ISNULL(@client_balance, 0), 3), N' ', @unit, N'; no alcanza para ',
                        dbo.fn_format_qty(@quantity, 3), N'.');
      THROW 50000, @msg, 1;
    END
  END

  SET @movement_id = NEWID();
  INSERT INTO dbo.material_movements (id, org_id, branch_id, material_id, order_id, movement_type, ownership, quantity,
                                      unit_cost, movement_date, notes, stock_after, transfer_id, counterpart_branch_id,
                                      created_by, created_at)
  VALUES (@movement_id, @org_id, @branch_id, @material_id, @order_id, @movement_type, @ownership, @quantity,
          @unit_cost, ISNULL(@movement_date, dbo.fn_today()), @notes, @stock_after, @transfer_id, @counterpart_branch_id,
          @user_id, @now);

  IF @order_id IS NOT NULL
  BEGIN
    SET @msg = CONCAT(dbo.fn_user_name(@user_id), N' registró ',
                      CASE @movement_type WHEN N'ENTRADA' THEN N'la recepción' WHEN N'CONSUMO' THEN N'el consumo'
                                          WHEN N'DEVOLUCION' THEN N'la devolución' WHEN N'SALIDA' THEN N'la salida'
                                          ELSE N'un ajuste' END,
                      N' de ', dbo.fn_format_qty(@quantity, 2), N' ', @unit, N' de ', @name,
                      CASE WHEN @ownership = N'CLIENTE' THEN N' (material del cliente)' ELSE N'' END, N'.');
    EXEC dbo.usp_int_log_order_event @order_id, @user_id, N'MATERIAL', @msg;
  END
END
GO

-- ---------------------------------------------------------------------
-- Cambio de estado del pedido con sus reglas (ex orders_before_write)
-- ---------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.usp_int_order_set_status
  @user_id   UNIQUEIDENTIFIER,
  @order_id  UNIQUEIDENTIFIER,
  @status    NVARCHAR(20)
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @old NVARCHAR(20), @number NVARCHAR(30), @qc BIT, @pending INT, @msg NVARCHAR(2048),
          @now DATETIMEOFFSET(3) = dbo.fn_now(), @has_delivery BIT;

  SELECT @old = status, @number = number, @qc = qc_approved
    FROM dbo.orders WITH (UPDLOCK, ROWLOCK) WHERE id = @order_id;
  IF @old IS NULL THROW 50004, N'Pedido no encontrado.', 1;
  IF @status NOT IN (N'SOLICITUD', N'COTIZADO', N'APROBADO', N'DISENO', N'PRODUCCION', N'CONTROL_CALIDAD',
                     N'LISTO_ENTREGA', N'ENTREGADO', N'CERRADO', N'PAUSADO', N'CANCELADO')
    THROW 50000, N'Estado de pedido no válido.', 1;
  IF @old = @status RETURN;

  EXEC dbo.usp_int_assert_order_editable @order_id, @user_id;

  SELECT @pending = COUNT(*) FROM dbo.order_production_stages WHERE order_id = @order_id AND status <> N'COMPLETADO';
  SET @has_delivery = CASE WHEN EXISTS (SELECT 1 FROM dbo.deliveries WHERE order_id = @order_id AND status = N'ENTREGADA') THEN 1 ELSE 0 END;

  IF @status = N'LISTO_ENTREGA' AND @pending > 0
  BEGIN
    SET @msg = CONCAT(N'No se puede pasar a "Listo para entregar": hay ', @pending, N' etapa(s) de producción sin completar.');
    THROW 50000, @msg, 1;
  END
  IF @status = N'ENTREGADO' AND @has_delivery = 0
    THROW 50000, N'Para marcar el pedido como entregado registre primero la entrega.', 1;
  IF @status = N'CERRADO'
  BEGIN
    IF @pending > 0 THROW 50000, N'No se puede cerrar: la producción no está completada.', 1;
    IF @qc = 0 THROW 50000, N'No se puede cerrar: el control de calidad no está aprobado.', 1;
    IF @has_delivery = 0 THROW 50000, N'No se puede cerrar: no hay una entrega registrada.', 1;
  END

  UPDATE dbo.orders
     SET status = @status,
         qc_approved = CASE WHEN @status = N'LISTO_ENTREGA' THEN 1 ELSE qc_approved END,
         qc_approved_at = CASE WHEN @status = N'LISTO_ENTREGA' THEN ISNULL(qc_approved_at, @now) ELSE qc_approved_at END,
         qc_approved_by = CASE WHEN @status = N'LISTO_ENTREGA' THEN ISNULL(qc_approved_by, @user_id) ELSE qc_approved_by END,
         delivered_at = CASE WHEN @status = N'ENTREGADO' THEN ISNULL(delivered_at, @now) ELSE delivered_at END,
         closed_at = CASE WHEN @status = N'CERRADO' THEN @now WHEN @old = N'CERRADO' THEN NULL ELSE closed_at END,
         updated_at = @now
   WHERE id = @order_id;

  SET @msg = CONCAT(dbo.fn_user_name(@user_id), N' cambió el pedido ', @number, N' de ',
                    dbo.fn_order_status_label(@old), N' a ', dbo.fn_order_status_label(@status), N'.');
  DECLARE @event NVARCHAR(20) = CASE WHEN @status = N'CERRADO' THEN N'CIERRE' ELSE N'ESTADO' END;
  EXEC dbo.usp_int_log_order_event @order_id, @user_id, @event, @msg, @old, @status;
END
GO

-- ---------------------------------------------------------------------
-- Producción: etapa actual, avance, control de calidad y estado del pedido
-- ---------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.usp_int_sync_order_production
  @order_id  UNIQUEIDENTIFIER,
  @user_id   UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @status NVARCHAR(20), @number NVARCHAR(30), @total INT, @done INT, @started INT, @work_pending INT,
          @cur_id UNIQUEIDENTIFIER, @cur_name NVARCHAR(100), @cur_pos INT, @min_pos INT,
          @new_status NVARCHAR(20), @progress INT, @msg NVARCHAR(2048), @now DATETIMEOFFSET(3) = dbo.fn_now();

  SELECT @status = status, @number = number FROM dbo.orders WHERE id = @order_id;
  IF @status IS NULL RETURN;

  SELECT @total = COUNT(*),
         @done = SUM(CASE WHEN status = N'COMPLETADO' THEN 1 ELSE 0 END),
         @started = SUM(CASE WHEN status IN (N'EN_PROCESO', N'COMPLETADO') THEN 1 ELSE 0 END),
         @work_pending = SUM(CASE WHEN status <> N'COMPLETADO' AND is_quality_check = 0 THEN 1 ELSE 0 END),
         @min_pos = MIN(position)
    FROM dbo.order_production_stages WHERE order_id = @order_id;
  SELECT @done = ISNULL(@done, 0), @started = ISNULL(@started, 0), @work_pending = ISNULL(@work_pending, 0);

  SELECT TOP (1) @cur_id = id, @cur_name = name, @cur_pos = position
    FROM dbo.order_production_stages
   WHERE order_id = @order_id AND status <> N'COMPLETADO'
   ORDER BY position, created_at;

  -- Regla 9: solo una etapa actual
  UPDATE dbo.order_production_stages SET is_current = 0
   WHERE order_id = @order_id AND is_current = 1 AND (@cur_id IS NULL OR id <> @cur_id);
  IF @cur_id IS NOT NULL
    UPDATE dbo.order_production_stages SET is_current = 1 WHERE id = @cur_id AND is_current = 0;

  -- Estado del pedido derivado de la producción
  SET @new_status = @status;
  IF @status IN (N'APROBADO', N'DISENO', N'PRODUCCION', N'CONTROL_CALIDAD', N'LISTO_ENTREGA') AND @total > 0
  BEGIN
    IF @done = @total SET @new_status = N'LISTO_ENTREGA';           -- todo completado (incluye control de calidad)
    ELSE IF @work_pending = 0 SET @new_status = N'CONTROL_CALIDAD';  -- regla 10
    ELSE IF @started > 0
      SET @new_status = CASE WHEN @cur_pos = @min_pos AND @cur_name LIKE N'dise%' THEN N'DISENO' ELSE N'PRODUCCION' END;
  END

  SET @progress = CASE WHEN @total = 0 THEN 0 ELSE CAST(ROUND(@done * 100.0 / @total, 0) AS INT) END;

  UPDATE dbo.orders
     SET progress = @progress,
         current_stage_name = @cur_name,
         status = @new_status,
         qc_approved = CASE WHEN @new_status = N'LISTO_ENTREGA' THEN 1
                            WHEN @total > 0 AND @done < @total THEN 0 ELSE qc_approved END,
         qc_approved_at = CASE WHEN @new_status = N'LISTO_ENTREGA' THEN ISNULL(qc_approved_at, @now)
                               WHEN @total > 0 AND @done < @total THEN NULL ELSE qc_approved_at END,
         qc_approved_by = CASE WHEN @new_status = N'LISTO_ENTREGA' THEN ISNULL(qc_approved_by, @user_id)
                               WHEN @total > 0 AND @done < @total THEN NULL ELSE qc_approved_by END,
         updated_at = @now
   WHERE id = @order_id;

  IF @new_status <> @status
  BEGIN
    SET @msg = CONCAT(dbo.fn_user_name(@user_id), N' cambió el pedido ', @number, N' de ',
                      dbo.fn_order_status_label(@status), N' a ', dbo.fn_order_status_label(@new_status), N'.');
    EXEC dbo.usp_int_log_order_event @order_id, @user_id, N'ESTADO', @msg, @status, @new_status;
  END
END
GO

-- Copia la plantilla de etapas al pedido
CREATE OR ALTER PROCEDURE dbo.usp_int_create_order_stages
  @order_id  UNIQUEIDENTIFIER,
  @user_id   UNIQUEIDENTIFIER,
  @count     INT OUTPUT
AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM dbo.order_production_stages WHERE order_id = @order_id)
    THROW 50000, N'El pedido ya tiene etapas de producción.', 1;

  INSERT INTO dbo.order_production_stages (org_id, order_id, stage_id, name, position, is_quality_check)
  SELECT o.org_id, o.id, ps.id, ps.name, ps.position, ps.is_quality_check
    FROM dbo.orders o
    JOIN dbo.production_stages ps ON ps.org_id = o.org_id AND ps.active = 1
   WHERE o.id = @order_id;
  SET @count = @@ROWCOUNT;

  IF @count = 0
    THROW 50000, N'No hay etapas de producción configuradas.', 1;

  EXEC dbo.usp_int_sync_order_production @order_id, @user_id;
END
GO

-- ---------------------------------------------------------------------
-- Alta de empresa: organización, configuración, catálogos, suscripción
-- y sucursal principal.
-- ---------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.usp_int_create_org
  @name        NVARCHAR(150),
  @tax_id      NVARCHAR(20),
  @phone       NVARCHAR(30),
  @email       NVARCHAR(254),
  @plan_code   NVARCHAR(20),
  @status      NVARCHAR(20),
  @period_end  DATE,
  @org_id      UNIQUEIDENTIFIER OUTPUT
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @now DATETIMEOFFSET(3) = dbo.fn_now();
  SET @org_id = NEWID();

  INSERT INTO dbo.organizations (id, name, created_at) VALUES (@org_id, @name, @now);
  INSERT INTO dbo.settings (org_id, company_name, tax_id, phone, email, updated_at)
  VALUES (@org_id, @name, @tax_id, @phone, @email, @now);

  INSERT INTO dbo.service_types (org_id, code, name, position) VALUES
    (@org_id, N'VENTA',        N'Venta de joya',             1),
    (@org_id, N'FABRICACION',  N'Fabricación personalizada', 2),
    (@org_id, N'REPARACION',   N'Reparación',                3),
    (@org_id, N'MODIFICACION', N'Modificación',              4),
    (@org_id, N'OTRO',         N'Otro',                      5);

  INSERT INTO dbo.production_stages (org_id, name, position, is_quality_check) VALUES
    (@org_id, N'Diseño',             1, 0),
    (@org_id, N'Fundición',          2, 0),
    (@org_id, N'Tallado',            3, 0),
    (@org_id, N'Engaste',            4, 0),
    (@org_id, N'Pulido',             5, 0),
    (@org_id, N'Acabado',            6, 0),
    (@org_id, N'Control de calidad', 7, 1);

  INSERT INTO dbo.subscriptions (org_id, plan_code, status, current_period_end, created_at, updated_at)
  VALUES (@org_id, @plan_code, @status, @period_end, @now, @now);

  INSERT INTO dbo.branches (org_id, code, name, phone, is_main, created_at, updated_at)
  VALUES (@org_id, N'PRI', N'Principal', @phone, 1, @now, @now);
END
GO

-- Genera un token aleatorio (hex) y su SHA-256
CREATE OR ALTER PROCEDURE dbo.usp_int_new_token
  @token       NVARCHAR(64) OUTPUT,
  @token_hash  VARBINARY(32) OUTPUT
AS
BEGIN
  SET NOCOUNT ON;
  SET @token = LOWER(CONVERT(NVARCHAR(64), CRYPT_GEN_RANDOM(32), 2));
  SET @token_hash = HASHBYTES('SHA2_256', @token);
END
GO

-- Crea una invitación pendiente (revoca otra pendiente del mismo correo)
CREATE OR ALTER PROCEDURE dbo.usp_int_create_invitation
  @org_id      UNIQUEIDENTIFIER,
  @email       NVARCHAR(254),
  @full_name   NVARCHAR(150),
  @role        NVARCHAR(20),
  @branch_ids  NVARCHAR(MAX),
  @invited_by  UNIQUEIDENTIFIER,
  @id          UNIQUEIDENTIFIER OUTPUT,
  @token       NVARCHAR(64) OUTPUT
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @hash VARBINARY(32), @now DATETIMEOFFSET(3) = dbo.fn_now();
  EXEC dbo.usp_int_new_token @token OUTPUT, @hash OUTPUT;

  UPDATE dbo.invitations SET status = N'REVOKED' WHERE email = @email AND status = N'PENDING';

  SET @id = NEWID();
  INSERT INTO dbo.invitations (id, org_id, email, full_name, role, branch_ids, token_hash, expires_at, invited_by, created_at)
  VALUES (@id, @org_id, @email, NULLIF(LTRIM(RTRIM(@full_name)), N''), @role, @branch_ids, @hash,
          DATEADD(DAY, 7, @now), @invited_by, @now);
END
GO


/* =====================================================================
   4. PROCEDIMIENTOS PÚBLICOS (api.usp_*)
   Patrón: SET XACT_ABORT ON + transacción + THROW. Los de lectura no
   abren transacción. @user_id = usuario autenticado por la API.
   ===================================================================== */

/* ---------------------------------------------------------------------
   4.1 Autenticación
   --------------------------------------------------------------------- */

-- Datos para el login. La API compara el hash; luego llama a usp_auth_login_result.
CREATE OR ALTER PROCEDURE api.usp_auth_get_login
  @email NVARCHAR(254)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT u.id AS user_id, u.email, u.password_hash, u.locked_until,
         p.full_name, p.role, p.active, p.org_id,
         CASE WHEN p.org_id IS NULL THEN NULL ELSE dbo.fn_org_access_state(p.org_id) END AS org_state,
         dbo.fn_is_platform_admin(u.id) AS is_platform_admin
    FROM dbo.users u
    LEFT JOIN dbo.profiles p ON p.id = u.id
   WHERE u.email = LOWER(LTRIM(RTRIM(@email)));
END
GO

-- Resultado del intento de login: 5 fallos seguidos bloquean 15 minutos.
CREATE OR ALTER PROCEDURE api.usp_auth_login_result
  @user_id  UNIQUEIDENTIFIER,
  @success  BIT
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @now DATETIMEOFFSET(3) = dbo.fn_now();
  IF @success = 1
    UPDATE dbo.users SET failed_logins = 0, locked_until = NULL, last_login_at = @now WHERE id = @user_id;
  ELSE
    UPDATE dbo.users
       SET failed_logins = failed_logins + 1,
           locked_until = CASE WHEN failed_logins + 1 >= 5 THEN DATEADD(MINUTE, 15, @now) ELSE locked_until END
     WHERE id = @user_id;
END
GO

-- Instalación vacía: el primer usuario crea la empresa y es superadministrador.
CREATE OR ALTER PROCEDURE api.usp_auth_setup_first_user
  @email          NVARCHAR(254),
  @full_name      NVARCHAR(150),
  @password_hash  NVARCHAR(500),
  @company_name   NVARCHAR(150) = N'Mi Orfebrería'
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @org_id UNIQUEIDENTIFIER, @user_id UNIQUEIDENTIFIER = NEWID(), @now DATETIMEOFFSET(3) = dbo.fn_now(),
            @mail NVARCHAR(254) = LOWER(LTRIM(RTRIM(@email))), @end DATE = DATEADD(YEAR, 1, dbo.fn_today());

    IF EXISTS (SELECT 1 FROM dbo.organizations WITH (UPDLOCK, HOLDLOCK))
      THROW 50000, N'El sistema ya fue configurado. El registro es solo por invitación.', 1;

    EXEC dbo.usp_int_create_org @company_name, NULL, NULL, @mail, N'EMPRESA', N'ACTIVE', @end, @org_id OUTPUT;

    INSERT INTO dbo.users (id, email, password_hash, full_name, password_changed_at, created_at)
    VALUES (@user_id, @mail, @password_hash, @full_name, @now, @now);
    INSERT INTO dbo.profiles (id, org_id, full_name, email, role, active, created_at, updated_at)
    VALUES (@user_id, @org_id, @full_name, @mail, N'ADMIN', 1, @now, @now);
    INSERT INTO dbo.user_branches (org_id, user_id, branch_id)
    SELECT @org_id, @user_id, id FROM dbo.branches WHERE org_id = @org_id AND is_main = 1;
    INSERT INTO dbo.platform_admins (user_id) VALUES (@user_id);

    COMMIT;
    SELECT @user_id AS user_id, @org_id AS org_id;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

-- Datos de la invitación para la pantalla "definir contraseña"
CREATE OR ALTER PROCEDURE api.usp_auth_get_invitation
  @token NVARCHAR(64)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT i.id, i.email, i.full_name, i.role, i.expires_at, s.company_name
    FROM dbo.invitations i
    JOIN dbo.settings s ON s.org_id = i.org_id
   WHERE i.token_hash = HASHBYTES('SHA2_256', CAST(LOWER(@token) AS NVARCHAR(64)))
     AND i.status = N'PENDING' AND i.expires_at > dbo.fn_now();
END
GO

-- Acepta la invitación: crea el usuario, su perfil activo y sus sucursales.
CREATE OR ALTER PROCEDURE api.usp_auth_accept_invitation
  @token          NVARCHAR(64),
  @password_hash  NVARCHAR(500),
  @full_name      NVARCHAR(150) = NULL
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @inv_id UNIQUEIDENTIFIER, @org_id UNIQUEIDENTIFIER, @email NVARCHAR(254), @name NVARCHAR(150),
            @role NVARCHAR(20), @branch_ids NVARCHAR(MAX), @user_id UNIQUEIDENTIFIER, @limit INT,
            @now DATETIMEOFFSET(3) = dbo.fn_now(), @msg NVARCHAR(2048);

    SELECT @inv_id = id, @org_id = org_id, @email = email, @name = full_name, @role = role, @branch_ids = branch_ids
      FROM dbo.invitations WITH (UPDLOCK)
     WHERE token_hash = HASHBYTES('SHA2_256', CAST(LOWER(@token) AS NVARCHAR(64)))
       AND status = N'PENDING' AND expires_at > @now;
    IF @inv_id IS NULL
      THROW 50004, N'La invitación no existe, ya fue usada o venció. Pida una nueva al administrador.', 1;
    IF EXISTS (SELECT 1 FROM dbo.profiles WHERE email = @email)
      THROW 50000, N'Ese correo ya tiene una cuenta en el sistema.', 1;

    -- Límite del plan (la propia invitación ya ocupaba un cupo)
    SET @limit = dbo.fn_org_seat_limit(@org_id);
    IF @limit IS NOT NULL AND dbo.fn_org_seats_used(@org_id, @email) >= @limit
    BEGIN
      SET @msg = CONCAT(N'Se alcanzó el límite de ', @limit, N' usuarios activos del plan. Contacte al administrador.');
      THROW 50000, @msg, 1;
    END

    SET @name = COALESCE(NULLIF(LTRIM(RTRIM(@full_name)), N''), @name, LEFT(@email, CHARINDEX(N'@', @email) - 1));
    SELECT @user_id = id FROM dbo.users WHERE email = @email;
    IF @user_id IS NULL
    BEGIN
      SET @user_id = NEWID();
      INSERT INTO dbo.users (id, email, password_hash, full_name, password_changed_at, created_at)
      VALUES (@user_id, @email, @password_hash, @name, @now, @now);
    END
    ELSE
      UPDATE dbo.users SET password_hash = @password_hash, full_name = @name, password_changed_at = @now,
                           failed_logins = 0, locked_until = NULL
       WHERE id = @user_id;

    INSERT INTO dbo.profiles (id, org_id, full_name, email, role, active, created_at, updated_at)
    VALUES (@user_id, @org_id, @name, @email, @role, 1, @now, @now);

    INSERT INTO dbo.user_branches (org_id, user_id, branch_id)
    SELECT @org_id, @user_id, b.id
      FROM dbo.branches b
     WHERE b.org_id = @org_id
       AND ((@branch_ids IS NULL AND b.is_main = 1)
            OR b.id IN (SELECT TRY_CAST(value AS UNIQUEIDENTIFIER) FROM OPENJSON(@branch_ids)));
    IF @@ROWCOUNT = 0
      INSERT INTO dbo.user_branches (org_id, user_id, branch_id)
      SELECT @org_id, @user_id, id FROM dbo.branches WHERE org_id = @org_id AND is_main = 1;

    UPDATE dbo.invitations SET status = N'ACCEPTED', accepted_at = @now WHERE id = @inv_id;

    COMMIT;
    SELECT @user_id AS user_id, @org_id AS org_id, @email AS email;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

-- Recuperación de contraseña: devuelve el token (1 hora) para que la API envíe el correo.
-- Si el correo no existe no devuelve filas (la API responde igual, sin revelar nada).
CREATE OR ALTER PROCEDURE api.usp_auth_request_password_reset
  @email NVARCHAR(254)
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  DECLARE @user_id UNIQUEIDENTIFIER, @name NVARCHAR(150), @token NVARCHAR(64), @hash VARBINARY(32),
          @now DATETIMEOFFSET(3) = dbo.fn_now();
  SELECT @user_id = u.id, @name = COALESCE(p.full_name, u.full_name)
    FROM dbo.users u LEFT JOIN dbo.profiles p ON p.id = u.id
   WHERE u.email = LOWER(LTRIM(RTRIM(@email)));
  IF @user_id IS NULL RETURN;

  EXEC dbo.usp_int_new_token @token OUTPUT, @hash OUTPUT;
  BEGIN TRAN;
    UPDATE dbo.password_reset_tokens SET used_at = @now WHERE user_id = @user_id AND used_at IS NULL;
    INSERT INTO dbo.password_reset_tokens (user_id, token_hash, expires_at, created_at)
    VALUES (@user_id, @hash, DATEADD(HOUR, 1, @now), @now);
  COMMIT;
  SELECT @user_id AS user_id, LOWER(LTRIM(RTRIM(@email))) AS email, @name AS full_name, @token AS token;
END
GO

CREATE OR ALTER PROCEDURE api.usp_auth_reset_password
  @token          NVARCHAR(64),
  @password_hash  NVARCHAR(500)
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @id UNIQUEIDENTIFIER, @user_id UNIQUEIDENTIFIER, @now DATETIMEOFFSET(3) = dbo.fn_now();
    SELECT @id = id, @user_id = user_id FROM dbo.password_reset_tokens WITH (UPDLOCK)
     WHERE token_hash = HASHBYTES('SHA2_256', CAST(LOWER(@token) AS NVARCHAR(64)))
       AND used_at IS NULL AND expires_at > @now;
    IF @id IS NULL
      THROW 50004, N'El enlace no es válido o ya venció. Solicite uno nuevo.', 1;

    UPDATE dbo.password_reset_tokens SET used_at = @now WHERE id = @id;
    UPDATE dbo.users SET password_hash = @password_hash, password_changed_at = @now, failed_logins = 0, locked_until = NULL
     WHERE id = @user_id;
    COMMIT;
    SELECT @user_id AS user_id;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

-- Cambio de contraseña con sesión (la API valida antes la contraseña actual)
CREATE OR ALTER PROCEDURE api.usp_auth_change_password
  @user_id        UNIQUEIDENTIFIER,
  @password_hash  NVARCHAR(500)
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.users SET password_hash = @password_hash, password_changed_at = dbo.fn_now() WHERE id = @user_id;
  IF @@ROWCOUNT = 0 THROW 50004, N'Usuario no encontrado.', 1;
END
GO

/* ---------------------------------------------------------------------
   4.2 Sesión: perfil, plan y sucursales del usuario
   Funciona aun con la empresa suspendida (para mostrar el aviso).
   --------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE api.usp_me_get
  @user_id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  -- 1) Perfil
  SELECT p.id, p.org_id, p.full_name, p.email, p.phone, p.role, p.active, p.default_branch_id,
         dbo.fn_is_platform_admin(p.id) AS is_platform_admin, s.company_name
    FROM dbo.profiles p JOIN dbo.settings s ON s.org_id = p.org_id
   WHERE p.id = @user_id;

  -- 2) Suscripción (ex my_subscription)
  SELECT s.org_id, s.plan_code, pl.name AS plan_name, pl.max_users, s.extra_users,
         pl.max_users + s.extra_users AS seat_limit, dbo.fn_org_seats_used(s.org_id, NULL) AS seats_used,
         pl.max_branches, dbo.fn_org_branches_used(s.org_id) AS branches_used,
         s.status, dbo.fn_org_access_state(s.org_id) AS state, s.current_period_end,
         DATEADD(DAY, s.grace_days, s.current_period_end) AS grace_end,
         DATEDIFF(DAY, dbo.fn_today(), s.current_period_end) AS days_left
    FROM dbo.profiles p
    JOIN dbo.subscriptions s ON s.org_id = p.org_id
    JOIN dbo.plans pl ON pl.code = s.plan_code
   WHERE p.id = @user_id;

  -- 3) Sucursales visibles
  SELECT b.id, b.code, b.name, b.is_main, b.active
    FROM dbo.branches b
   WHERE b.id IN (SELECT branch_id FROM dbo.fn_user_branch_ids(@user_id))
   ORDER BY b.is_main DESC, b.name;
END
GO

CREATE OR ALTER PROCEDURE api.usp_profile_update_self
  @user_id            UNIQUEIDENTIFIER,
  @full_name          NVARCHAR(150),
  @phone              NVARCHAR(30) = NULL,
  @default_branch_id  UNIQUEIDENTIFIER = NULL
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20);
    EXEC dbo.usp_int_ctx @user_id, NULL, 0, @org_id OUTPUT, @role OUTPUT;
    IF LEN(LTRIM(ISNULL(@full_name, N''))) = 0 THROW 50000, N'Indique su nombre.', 1;
    IF @default_branch_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.fn_user_branch_ids(@user_id) WHERE branch_id = @default_branch_id)
      THROW 50003, N'No tiene acceso a esa sucursal.', 1;

    UPDATE dbo.profiles
       SET full_name = LTRIM(RTRIM(@full_name)), phone = NULLIF(LTRIM(RTRIM(@phone)), N''),
           default_branch_id = @default_branch_id, updated_at = dbo.fn_now()
     WHERE id = @user_id;
    UPDATE dbo.users SET full_name = LTRIM(RTRIM(@full_name)) WHERE id = @user_id;
    COMMIT;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

/* ---------------------------------------------------------------------
   4.3 Usuarios e invitaciones de la empresa
   --------------------------------------------------------------------- */

-- Todos los usuarios de la empresa (selectores de responsable). Las sucursales como "PRI,AQP".
CREATE OR ALTER PROCEDURE api.usp_users_list
  @user_id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20);
  EXEC dbo.usp_int_ctx @user_id, NULL, 0, @org_id OUTPUT, @role OUTPUT;

  SELECT p.id, p.full_name, p.email, p.phone, p.role, p.active, p.default_branch_id, p.created_at,
         (SELECT STRING_AGG(b.code, N',') WITHIN GROUP (ORDER BY b.code)
            FROM dbo.user_branches ub JOIN dbo.branches b ON b.id = ub.branch_id
           WHERE ub.user_id = p.id) AS branch_codes,
         (SELECT ub.branch_id AS id FROM dbo.user_branches ub WHERE ub.user_id = p.id FOR JSON PATH) AS branch_ids
    FROM dbo.profiles p
   WHERE p.org_id = @org_id
   ORDER BY p.active DESC, p.full_name;
END
GO

-- El ADMIN cambia rol o estado de un usuario
CREATE OR ALTER PROCEDURE api.usp_user_update
  @user_id         UNIQUEIDENTIFIER,
  @target_user_id  UNIQUEIDENTIFIER,
  @role            NVARCHAR(20),
  @active          BIT
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @org_id UNIQUEIDENTIFIER, @my_role NVARCHAR(20), @was_active BIT, @email NVARCHAR(254), @limit INT,
            @msg NVARCHAR(2048);
    EXEC dbo.usp_int_ctx @user_id, N'ADMIN', 1, @org_id OUTPUT, @my_role OUTPUT;

    SELECT @was_active = active, @email = email FROM dbo.profiles WITH (UPDLOCK)
     WHERE id = @target_user_id AND org_id = @org_id;
    IF @email IS NULL THROW 50004, N'Usuario no encontrado.', 1;
    IF @target_user_id = @user_id AND (@role <> N'ADMIN' OR @active = 0)
      THROW 50000, N'No puede quitarse a sí mismo el rol de administrador.', 1;

    IF @active = 1 AND @was_active = 0
    BEGIN
      SET @limit = dbo.fn_org_seat_limit(@org_id);
      IF @limit IS NOT NULL AND dbo.fn_org_seats_used(@org_id, @email) >= @limit
      BEGIN
        SET @msg = CONCAT(N'Se alcanzó el límite de ', @limit, N' usuarios activos del plan. Desactive un usuario o mejore el plan.');
        THROW 50000, @msg, 1;
      END
    END

    UPDATE dbo.profiles SET role = @role, active = @active, updated_at = dbo.fn_now() WHERE id = @target_user_id;
    COMMIT;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

-- El ADMIN define las sucursales de un usuario. @branch_ids: JSON '["uuid","uuid"]'
CREATE OR ALTER PROCEDURE api.usp_user_set_branches
  @user_id         UNIQUEIDENTIFIER,
  @target_user_id  UNIQUEIDENTIFIER,
  @branch_ids      NVARCHAR(MAX)
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20);
    DECLARE @ids TABLE (id UNIQUEIDENTIFIER PRIMARY KEY);
    EXEC dbo.usp_int_ctx @user_id, N'ADMIN', 1, @org_id OUTPUT, @role OUTPUT;

    IF NOT EXISTS (SELECT 1 FROM dbo.profiles WHERE id = @target_user_id AND org_id = @org_id)
      THROW 50004, N'Usuario no encontrado.', 1;
    IF ISJSON(ISNULL(@branch_ids, N'[]')) = 0 THROW 50000, N'Lista de sucursales no válida.', 1;

    INSERT INTO @ids (id)
    SELECT DISTINCT TRY_CAST(value AS UNIQUEIDENTIFIER) FROM OPENJSON(ISNULL(@branch_ids, N'[]'))
     WHERE TRY_CAST(value AS UNIQUEIDENTIFIER) IS NOT NULL;
    IF EXISTS (SELECT 1 FROM @ids i WHERE NOT EXISTS (SELECT 1 FROM dbo.branches b WHERE b.id = i.id AND b.org_id = @org_id))
      THROW 50000, N'Una de las sucursales indicadas no pertenece a la empresa.', 1;

    DELETE FROM dbo.user_branches WHERE user_id = @target_user_id AND branch_id NOT IN (SELECT id FROM @ids);
    INSERT INTO dbo.user_branches (org_id, user_id, branch_id)
    SELECT @org_id, @target_user_id, i.id FROM @ids i
     WHERE NOT EXISTS (SELECT 1 FROM dbo.user_branches ub WHERE ub.user_id = @target_user_id AND ub.branch_id = i.id);

    UPDATE dbo.profiles SET default_branch_id = NULL
     WHERE id = @target_user_id AND default_branch_id IS NOT NULL AND default_branch_id NOT IN (SELECT id FROM @ids);
    COMMIT;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

-- El ADMIN invita a un usuario (reserva un cupo). Devuelve el token para el correo.
CREATE OR ALTER PROCEDURE api.usp_invitation_create
  @user_id     UNIQUEIDENTIFIER,
  @email       NVARCHAR(254),
  @full_name   NVARCHAR(150),
  @role        NVARCHAR(20),
  @branch_ids  NVARCHAR(MAX) = NULL      -- JSON '["uuid", ...]'; NULL = sucursal principal
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @org_id UNIQUEIDENTIFIER, @my_role NVARCHAR(20), @mail NVARCHAR(254) = LOWER(LTRIM(RTRIM(@email))),
            @limit INT, @id UNIQUEIDENTIFIER, @token NVARCHAR(64), @msg NVARCHAR(2048);
    EXEC dbo.usp_int_ctx @user_id, N'ADMIN', 1, @org_id OUTPUT, @my_role OUTPUT;

    IF EXISTS (SELECT 1 FROM dbo.profiles WHERE email = @mail)
      THROW 50000, N'Ese correo ya tiene una cuenta en el sistema.', 1;
    IF @branch_ids IS NOT NULL AND (ISJSON(@branch_ids) = 0 OR EXISTS (
         SELECT 1 FROM OPENJSON(@branch_ids) j
          WHERE NOT EXISTS (SELECT 1 FROM dbo.branches b
                             WHERE b.id = TRY_CAST(j.value AS UNIQUEIDENTIFIER) AND b.org_id = @org_id AND b.active = 1)))
      THROW 50000, N'Una de las sucursales indicadas no existe o está inactiva.', 1;
    IF @branch_ids IS NOT NULL AND NOT EXISTS (SELECT 1 FROM OPENJSON(@branch_ids)) SET @branch_ids = NULL;

    UPDATE dbo.invitations SET status = N'REVOKED' WHERE org_id = @org_id AND email = @mail AND status = N'PENDING';
    SET @limit = dbo.fn_org_seat_limit(@org_id);
    IF dbo.fn_org_seats_used(@org_id, NULL) >= @limit
    BEGIN
      SET @msg = CONCAT(N'Se alcanzó el límite de ', @limit, N' usuarios del plan. Desactive un usuario o mejore el plan.');
      THROW 50000, @msg, 1;
    END

    EXEC dbo.usp_int_create_invitation @org_id, @mail, @full_name, @role, @branch_ids, @user_id, @id OUTPUT, @token OUTPUT;
    COMMIT;
    SELECT i.id, i.email, i.full_name, i.role, i.expires_at, @token AS token, s.company_name
      FROM dbo.invitations i JOIN dbo.settings s ON s.org_id = i.org_id WHERE i.id = @id;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

-- Reenvío: nuevo token y 7 días más
CREATE OR ALTER PROCEDURE api.usp_invitation_renew
  @user_id        UNIQUEIDENTIFIER,
  @invitation_id  UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20), @token NVARCHAR(64), @hash VARBINARY(32);
    IF dbo.fn_is_platform_admin(@user_id) = 0
      EXEC dbo.usp_int_ctx @user_id, N'ADMIN', 1, @org_id OUTPUT, @role OUTPUT;

    EXEC dbo.usp_int_new_token @token OUTPUT, @hash OUTPUT;
    UPDATE dbo.invitations SET token_hash = @hash, expires_at = DATEADD(DAY, 7, dbo.fn_now())
     WHERE id = @invitation_id AND status = N'PENDING' AND (@org_id IS NULL OR org_id = @org_id);
    IF @@ROWCOUNT = 0 THROW 50004, N'Invitación no encontrada o ya usada.', 1;
    COMMIT;
    SELECT i.id, i.email, i.full_name, i.role, i.expires_at, @token AS token, s.company_name
      FROM dbo.invitations i JOIN dbo.settings s ON s.org_id = i.org_id WHERE i.id = @invitation_id;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

CREATE OR ALTER PROCEDURE api.usp_invitation_revoke
  @user_id        UNIQUEIDENTIFIER,
  @invitation_id  UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20);
  IF dbo.fn_is_platform_admin(@user_id) = 0
    EXEC dbo.usp_int_ctx @user_id, N'ADMIN', 0, @org_id OUTPUT, @role OUTPUT;
  UPDATE dbo.invitations SET status = N'REVOKED'
   WHERE id = @invitation_id AND status = N'PENDING' AND (@org_id IS NULL OR org_id = @org_id);
END
GO

CREATE OR ALTER PROCEDURE api.usp_invitations_list
  @user_id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20);
  EXEC dbo.usp_int_ctx @user_id, N'ADMIN', 0, @org_id OUTPUT, @role OUTPUT;
  SELECT id, email, full_name, role, branch_ids, status, expires_at,
         CAST(CASE WHEN status = N'PENDING' AND expires_at <= dbo.fn_now() THEN 1 ELSE 0 END AS BIT) AS expired,
         created_at, accepted_at
    FROM dbo.invitations WHERE org_id = @org_id ORDER BY created_at DESC;
END
GO

/* ---------------------------------------------------------------------
   4.4 Configuración y catálogos
   --------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE api.usp_settings_get
  @user_id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20);
  EXEC dbo.usp_int_ctx @user_id, NULL, 0, @org_id OUTPUT, @role OUTPUT;
  SELECT org_id, company_name, tax_id, address, phone, email, currency, tax_rate, quote_validity_days,
         default_terms, updated_at
    FROM dbo.settings WHERE org_id = @org_id;
END
GO

CREATE OR ALTER PROCEDURE api.usp_settings_update
  @user_id              UNIQUEIDENTIFIER,
  @company_name         NVARCHAR(200),
  @tax_id               NVARCHAR(20),
  @address              NVARCHAR(300),
  @phone                NVARCHAR(30),
  @email                NVARCHAR(254),
  @currency             NVARCHAR(3),
  @tax_rate             DECIMAL(5, 2),
  @quote_validity_days  INT,
  @default_terms        NVARCHAR(2000)
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20);
    EXEC dbo.usp_int_ctx @user_id, N'ADMIN', 1, @org_id OUTPUT, @role OUTPUT;
    IF LEN(LTRIM(ISNULL(@company_name, N''))) = 0 THROW 50000, N'Indique el nombre de la empresa.', 1;

    UPDATE dbo.settings
       SET company_name = LTRIM(RTRIM(@company_name)), tax_id = NULLIF(LTRIM(RTRIM(@tax_id)), N''),
           address = NULLIF(LTRIM(RTRIM(@address)), N''), phone = NULLIF(LTRIM(RTRIM(@phone)), N''),
           email = NULLIF(LTRIM(RTRIM(@email)), N''), currency = ISNULL(@currency, currency),
           tax_rate = ISNULL(@tax_rate, tax_rate), quote_validity_days = ISNULL(@quote_validity_days, quote_validity_days),
           default_terms = @default_terms, updated_at = dbo.fn_now()
     WHERE org_id = @org_id;
    UPDATE dbo.organizations SET name = LTRIM(RTRIM(@company_name)) WHERE id = @org_id;
    COMMIT;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

CREATE OR ALTER PROCEDURE api.usp_service_types_list
  @user_id           UNIQUEIDENTIFIER,
  @include_inactive  BIT = 0
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20);
  EXEC dbo.usp_int_ctx @user_id, NULL, 0, @org_id OUTPUT, @role OUTPUT;
  SELECT id, code, name, position, active FROM dbo.service_types
   WHERE org_id = @org_id AND (@include_inactive = 1 OR active = 1)
   ORDER BY position, name;
END
GO

CREATE OR ALTER PROCEDURE api.usp_service_type_save
  @user_id   UNIQUEIDENTIFIER,
  @id        UNIQUEIDENTIFIER = NULL,
  @code      NVARCHAR(30),
  @name      NVARCHAR(100),
  @position  INT = 0,
  @active    BIT = 1
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20);
    EXEC dbo.usp_int_ctx @user_id, N'ADMIN', 1, @org_id OUTPUT, @role OUTPUT;
    SET @code = UPPER(LTRIM(RTRIM(@code)));
    IF EXISTS (SELECT 1 FROM dbo.service_types WHERE org_id = @org_id AND code = @code AND (@id IS NULL OR id <> @id))
      THROW 50000, N'Ya existe un tipo de servicio con ese código.', 1;

    IF @id IS NULL
    BEGIN
      SET @id = NEWID();
      INSERT INTO dbo.service_types (id, org_id, code, name, position, active)
      VALUES (@id, @org_id, @code, LTRIM(RTRIM(@name)), ISNULL(@position, 0), ISNULL(@active, 1));
    END
    ELSE
    BEGIN
      UPDATE dbo.service_types SET code = @code, name = LTRIM(RTRIM(@name)), position = ISNULL(@position, 0),
                                   active = ISNULL(@active, 1)
       WHERE id = @id AND org_id = @org_id;
      IF @@ROWCOUNT = 0 THROW 50004, N'Tipo de servicio no encontrado.', 1;
    END
    COMMIT;
    SELECT @id AS id;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

CREATE OR ALTER PROCEDURE api.usp_production_stages_list
  @user_id           UNIQUEIDENTIFIER,
  @include_inactive  BIT = 0
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20);
  EXEC dbo.usp_int_ctx @user_id, NULL, 0, @org_id OUTPUT, @role OUTPUT;
  SELECT id, name, position, is_quality_check, active FROM dbo.production_stages
   WHERE org_id = @org_id AND (@include_inactive = 1 OR active = 1)
   ORDER BY position;
END
GO

CREATE OR ALTER PROCEDURE api.usp_production_stage_save
  @user_id           UNIQUEIDENTIFIER,
  @id                UNIQUEIDENTIFIER = NULL,
  @name              NVARCHAR(100),
  @position          INT,
  @is_quality_check  BIT = 0,
  @active            BIT = 1
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20);
    EXEC dbo.usp_int_ctx @user_id, N'ADMIN', 1, @org_id OUTPUT, @role OUTPUT;
    IF @id IS NULL
    BEGIN
      SET @id = NEWID();
      INSERT INTO dbo.production_stages (id, org_id, name, position, is_quality_check, active)
      VALUES (@id, @org_id, LTRIM(RTRIM(@name)), @position, ISNULL(@is_quality_check, 0), ISNULL(@active, 1));
    END
    ELSE
    BEGIN
      UPDATE dbo.production_stages SET name = LTRIM(RTRIM(@name)), position = @position,
                                       is_quality_check = ISNULL(@is_quality_check, 0), active = ISNULL(@active, 1)
       WHERE id = @id AND org_id = @org_id;
      IF @@ROWCOUNT = 0 THROW 50004, N'Etapa no encontrada.', 1;
    END
    COMMIT;
    SELECT @id AS id;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

/* ---------------------------------------------------------------------
   4.5 Sucursales
   --------------------------------------------------------------------- */

-- Todos ven la lista de sucursales de la empresa (selectores y traslados).
CREATE OR ALTER PROCEDURE api.usp_branches_list
  @user_id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20);
  EXEC dbo.usp_int_ctx @user_id, NULL, 0, @org_id OUTPUT, @role OUTPUT;
  SELECT b.id, b.code, b.name, b.address, b.phone, b.is_main, b.active,
         CAST(CASE WHEN b.id IN (SELECT branch_id FROM dbo.fn_user_branch_ids(@user_id)) THEN 1 ELSE 0 END AS BIT) AS has_access,
         b.created_at
    FROM dbo.branches b
   WHERE b.org_id = @org_id
   ORDER BY b.is_main DESC, b.name;
END
GO

CREATE OR ALTER PROCEDURE api.usp_branch_save
  @user_id  UNIQUEIDENTIFIER,
  @id       UNIQUEIDENTIFIER = NULL,
  @code     NVARCHAR(6),
  @name     NVARCHAR(100),
  @address  NVARCHAR(300) = NULL,
  @phone    NVARCHAR(30) = NULL,
  @active   BIT = 1
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20), @was_active BIT, @is_main BIT, @limit INT,
            @msg NVARCHAR(2048), @now DATETIMEOFFSET(3) = dbo.fn_now();
    EXEC dbo.usp_int_ctx @user_id, N'ADMIN', 1, @org_id OUTPUT, @role OUTPUT;

    SET @code = UPPER(LTRIM(RTRIM(@code)));
    SET @name = LTRIM(RTRIM(@name));
    SET @active = ISNULL(@active, 1);
    IF EXISTS (SELECT 1 FROM dbo.branches WHERE org_id = @org_id AND (code = @code OR name = @name) AND (@id IS NULL OR id <> @id))
      THROW 50000, N'Ya existe una sucursal con ese código o nombre.', 1;

    IF @id IS NOT NULL
    BEGIN
      SELECT @was_active = active, @is_main = is_main FROM dbo.branches WITH (UPDLOCK) WHERE id = @id AND org_id = @org_id;
      IF @was_active IS NULL THROW 50004, N'Sucursal no encontrada.', 1;
      IF @is_main = 1 AND @active = 0 THROW 50000, N'La sucursal principal no se puede desactivar.', 1;
      IF @was_active = 1 AND @active = 0
      BEGIN
        IF EXISTS (SELECT 1 FROM dbo.material_stock WHERE branch_id = @id AND stock > 0)
        BEGIN
          SET @msg = CONCAT(N'La sucursal ', @name, N' todavía tiene stock de materiales. Trasládelo antes de desactivarla.');
          THROW 50000, @msg, 1;
        END
        IF EXISTS (SELECT 1 FROM dbo.orders WHERE branch_id = @id AND status NOT IN (N'ENTREGADO', N'CERRADO', N'CANCELADO'))
        BEGIN
          SET @msg = CONCAT(N'La sucursal ', @name, N' tiene pedidos en curso. Termínelos o muévalos antes de desactivarla.');
          THROW 50000, @msg, 1;
        END
      END
    END

    -- Límite del plan: sucursales activas
    IF @active = 1 AND (@id IS NULL OR @was_active = 0)
    BEGIN
      SET @limit = dbo.fn_org_branch_limit(@org_id);
      IF @limit IS NOT NULL AND dbo.fn_org_branches_used(@org_id) >= @limit
      BEGIN
        SET @msg = CONCAT(N'Su plan permite ', @limit, N' sucursal(es) activa(s). Desactive una o mejore el plan.');
        THROW 50000, @msg, 1;
      END
    END

    IF @id IS NULL
    BEGIN
      SET @id = NEWID();
      INSERT INTO dbo.branches (id, org_id, code, name, address, phone, is_main, active, created_at, updated_at)
      VALUES (@id, @org_id, @code, @name, NULLIF(LTRIM(RTRIM(@address)), N''), NULLIF(LTRIM(RTRIM(@phone)), N''),
              CASE WHEN EXISTS (SELECT 1 FROM dbo.branches WHERE org_id = @org_id AND is_main = 1) THEN 0 ELSE 1 END,
              @active, @now, @now);
    END
    ELSE
      UPDATE dbo.branches
         SET code = @code, name = @name, address = NULLIF(LTRIM(RTRIM(@address)), N''),
             phone = NULLIF(LTRIM(RTRIM(@phone)), N''), active = @active, updated_at = @now
       WHERE id = @id;
    COMMIT;
    SELECT @id AS id;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

CREATE OR ALTER PROCEDURE api.usp_branch_set_main
  @user_id    UNIQUEIDENTIFIER,
  @branch_id  UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20), @now DATETIMEOFFSET(3) = dbo.fn_now();
    EXEC dbo.usp_int_ctx @user_id, N'ADMIN', 1, @org_id OUTPUT, @role OUTPUT;
    IF NOT EXISTS (SELECT 1 FROM dbo.branches WHERE id = @branch_id AND org_id = @org_id AND active = 1)
      THROW 50000, N'La sucursal no existe o está inactiva.', 1;
    UPDATE dbo.branches SET is_main = 0, updated_at = @now WHERE org_id = @org_id AND is_main = 1 AND id <> @branch_id;
    UPDATE dbo.branches SET is_main = 1, updated_at = @now WHERE id = @branch_id;
    COMMIT;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO


/* ---------------------------------------------------------------------
   4.6 Clientes
   ADMIN, GERENTE, VENDEDOR y SUPERVISOR ven todos los clientes; el
   ORFEBRE solo los de sus pedidos. Escriben ADMIN, GERENTE y VENDEDOR.
   --------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE api.usp_customers_list
  @user_id           UNIQUEIDENTIFIER,
  @search            NVARCHAR(100) = NULL,
  @include_inactive  BIT = 0
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20), @q NVARCHAR(102) = N'%' + NULLIF(LTRIM(RTRIM(@search)), N'') + N'%';
  EXEC dbo.usp_int_ctx @user_id, NULL, 0, @org_id OUTPUT, @role OUTPUT;

  SELECT c.id, c.person_type, c.first_name, c.last_name, c.business_name, c.full_name, c.document_type,
         c.document_number, c.phone, c.whatsapp, c.email, c.address, c.city, c.notes, c.active, c.created_at, c.updated_at
    FROM dbo.customers c
   WHERE c.org_id = @org_id
     AND (@include_inactive = 1 OR c.active = 1)
     AND (@q IS NULL OR c.full_name LIKE @q OR c.document_number LIKE @q OR c.phone LIKE @q OR c.email LIKE @q)
     AND (@role <> N'ORFEBRE' OR EXISTS (SELECT 1 FROM dbo.orders o
                                          JOIN dbo.fn_visible_orders(@user_id, NULL) v ON v.id = o.id
                                         WHERE o.customer_id = c.id))
   ORDER BY c.full_name;
END
GO

-- Ficha 360°: 1) cliente  2) resumen  3) contactos  4) pedidos visibles
CREATE OR ALTER PROCEDURE api.usp_customer_get
  @user_id  UNIQUEIDENTIFIER,
  @id       UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20);
  EXEC dbo.usp_int_ctx @user_id, NULL, 0, @org_id OUTPUT, @role OUTPUT;

  IF NOT EXISTS (SELECT 1 FROM dbo.customers c WHERE c.id = @id AND c.org_id = @org_id
                   AND (@role <> N'ORFEBRE' OR EXISTS (SELECT 1 FROM dbo.orders o JOIN dbo.fn_visible_orders(@user_id, NULL) v ON v.id = o.id
                                                        WHERE o.customer_id = c.id)))
    THROW 50004, N'Cliente no encontrado o sin permisos.', 1;

  SELECT c.* FROM dbo.customers c WHERE c.id = @id;

  SELECT COUNT(CASE WHEN o.status <> N'CANCELADO' THEN 1 END) AS orders_count,
         ISNULL(SUM(CASE WHEN o.status <> N'CANCELADO' THEN o.total END), 0) AS total_purchased,
         ISNULL(SUM(CASE WHEN o.status <> N'CANCELADO' THEN o.balance END), 0) AS balance,
         MAX(o.created_at) AS last_order_at
    FROM dbo.orders o
    JOIN dbo.fn_visible_orders(@user_id, NULL) v ON v.id = o.id
   WHERE o.customer_id = @id;

  SELECT id, name, position, phone, email, notes, created_at
    FROM dbo.customer_contacts
   WHERE customer_id = @id AND @role <> N'ORFEBRE'
   ORDER BY name;

  SELECT o.id, o.number, o.title, o.status, o.priority, o.total, o.balance, o.payment_status, o.due_date,
         o.created_at, b.name AS branch_name
    FROM dbo.orders o
    JOIN dbo.fn_visible_orders(@user_id, NULL) v ON v.id = o.id
    JOIN dbo.branches b ON b.id = o.branch_id
   WHERE o.customer_id = @id
   ORDER BY o.created_at DESC;
END
GO

CREATE OR ALTER PROCEDURE api.usp_customer_save
  @user_id          UNIQUEIDENTIFIER,
  @id               UNIQUEIDENTIFIER = NULL,
  @person_type      NVARCHAR(10),
  @first_name       NVARCHAR(100) = NULL,
  @last_name        NVARCHAR(100) = NULL,
  @business_name    NVARCHAR(200) = NULL,
  @document_type    NVARCHAR(10) = N'DNI',
  @document_number  NVARCHAR(20) = NULL,
  @phone            NVARCHAR(30) = NULL,
  @whatsapp         NVARCHAR(30) = NULL,
  @email            NVARCHAR(254) = NULL,
  @address          NVARCHAR(300) = NULL,
  @city             NVARCHAR(100) = NULL,
  @notes            NVARCHAR(2000) = NULL,
  @active           BIT = 1
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20), @now DATETIMEOFFSET(3) = dbo.fn_now();
    EXEC dbo.usp_int_ctx @user_id, N'ADMIN,GERENTE,VENDEDOR', 1, @org_id OUTPUT, @role OUTPUT;

    SET @document_number = NULLIF(LTRIM(RTRIM(@document_number)), N'');
    IF @document_number IS NOT NULL AND EXISTS (
         SELECT 1 FROM dbo.customers WHERE org_id = @org_id AND document_type = @document_type
            AND document_number = @document_number AND (@id IS NULL OR id <> @id))
      THROW 50000, N'Ya existe un cliente con ese documento.', 1;

    IF @id IS NULL
    BEGIN
      SET @id = NEWID();
      INSERT INTO dbo.customers (id, org_id, person_type, first_name, last_name, business_name, document_type, document_number,
                                 phone, whatsapp, email, address, city, notes, active, created_by, created_at, updated_at)
      VALUES (@id, @org_id, @person_type, NULLIF(LTRIM(RTRIM(@first_name)), N''), NULLIF(LTRIM(RTRIM(@last_name)), N''),
              NULLIF(LTRIM(RTRIM(@business_name)), N''), ISNULL(@document_type, N'DNI'), @document_number,
              NULLIF(LTRIM(RTRIM(@phone)), N''), NULLIF(LTRIM(RTRIM(@whatsapp)), N''), NULLIF(LOWER(LTRIM(RTRIM(@email))), N''),
              NULLIF(LTRIM(RTRIM(@address)), N''), NULLIF(LTRIM(RTRIM(@city)), N''), NULLIF(LTRIM(RTRIM(@notes)), N''),
              ISNULL(@active, 1), @user_id, @now, @now);
    END
    ELSE
    BEGIN
      UPDATE dbo.customers
         SET person_type = @person_type, first_name = NULLIF(LTRIM(RTRIM(@first_name)), N''),
             last_name = NULLIF(LTRIM(RTRIM(@last_name)), N''), business_name = NULLIF(LTRIM(RTRIM(@business_name)), N''),
             document_type = ISNULL(@document_type, N'DNI'), document_number = @document_number,
             phone = NULLIF(LTRIM(RTRIM(@phone)), N''), whatsapp = NULLIF(LTRIM(RTRIM(@whatsapp)), N''),
             email = NULLIF(LOWER(LTRIM(RTRIM(@email))), N''), address = NULLIF(LTRIM(RTRIM(@address)), N''),
             city = NULLIF(LTRIM(RTRIM(@city)), N''), notes = NULLIF(LTRIM(RTRIM(@notes)), N''),
             active = ISNULL(@active, 1), updated_at = @now
       WHERE id = @id AND org_id = @org_id;
      IF @@ROWCOUNT = 0 THROW 50004, N'Cliente no encontrado.', 1;
    END
    COMMIT;
    SELECT @id AS id;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

CREATE OR ALTER PROCEDURE api.usp_customer_contact_save
  @user_id      UNIQUEIDENTIFIER,
  @id           UNIQUEIDENTIFIER = NULL,
  @customer_id  UNIQUEIDENTIFIER,
  @name         NVARCHAR(150),
  @position     NVARCHAR(100) = NULL,
  @phone        NVARCHAR(30) = NULL,
  @email        NVARCHAR(254) = NULL,
  @notes        NVARCHAR(1000) = NULL
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20);
    EXEC dbo.usp_int_ctx @user_id, N'ADMIN,GERENTE,VENDEDOR', 1, @org_id OUTPUT, @role OUTPUT;
    IF NOT EXISTS (SELECT 1 FROM dbo.customers WHERE id = @customer_id AND org_id = @org_id)
      THROW 50004, N'Cliente no encontrado.', 1;

    IF @id IS NULL
    BEGIN
      SET @id = NEWID();
      INSERT INTO dbo.customer_contacts (id, org_id, customer_id, name, position, phone, email, notes)
      VALUES (@id, @org_id, @customer_id, LTRIM(RTRIM(@name)), @position, @phone, @email, @notes);
    END
    ELSE
    BEGIN
      UPDATE dbo.customer_contacts SET name = LTRIM(RTRIM(@name)), position = @position, phone = @phone, email = @email, notes = @notes
       WHERE id = @id AND customer_id = @customer_id AND org_id = @org_id;
      IF @@ROWCOUNT = 0 THROW 50004, N'Contacto no encontrado.', 1;
    END
    COMMIT;
    SELECT @id AS id;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

CREATE OR ALTER PROCEDURE api.usp_customer_contact_delete
  @user_id  UNIQUEIDENTIFIER,
  @id       UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20);
  EXEC dbo.usp_int_ctx @user_id, N'ADMIN,GERENTE,VENDEDOR', 1, @org_id OUTPUT, @role OUTPUT;
  DELETE FROM dbo.customer_contacts WHERE id = @id AND org_id = @org_id;
END
GO

/* ---------------------------------------------------------------------
   4.7 Materiales, stock por sucursal y movimientos
   --------------------------------------------------------------------- */

-- Sin @branch_id: stock consolidado. Con @branch_id: stock y mínimo de esa sucursal.
CREATE OR ALTER PROCEDURE api.usp_materials_list
  @user_id           UNIQUEIDENTIFIER,
  @branch_id         UNIQUEIDENTIFIER = NULL,
  @include_inactive  BIT = 0
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20);
  EXEC dbo.usp_int_ctx @user_id, NULL, 0, @org_id OUTPUT, @role OUTPUT;
  IF @branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.fn_user_branch_ids(@user_id) WHERE branch_id = @branch_id)
    THROW 50003, N'No tiene acceso a esa sucursal.', 1;

  SELECT m.id, m.name, m.type, m.purity, m.unit, m.reference_cost, m.active, m.created_at, m.updated_at,
         m.stock AS total_stock, m.min_stock AS total_min_stock,
         x.stock, x.min_stock,
         CAST(CASE WHEN m.active = 1 AND x.stock <= x.min_stock THEN 1 ELSE 0 END AS BIT) AS below_min
    FROM dbo.materials m
    LEFT JOIN dbo.material_stock ms ON ms.material_id = m.id AND ms.branch_id = @branch_id
   CROSS APPLY (SELECT CASE WHEN @branch_id IS NULL THEN m.stock ELSE ISNULL(ms.stock, 0) END AS stock,
                       CASE WHEN @branch_id IS NULL THEN m.min_stock ELSE ISNULL(ms.min_stock, 0) END AS min_stock) x
   WHERE m.org_id = @org_id AND (@include_inactive = 1 OR m.active = 1)
   ORDER BY m.type, m.name;
END
GO

-- Stock de un material en cada sucursal visible
CREATE OR ALTER PROCEDURE api.usp_material_stock_by_branch
  @user_id      UNIQUEIDENTIFIER,
  @material_id  UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20);
  EXEC dbo.usp_int_ctx @user_id, NULL, 0, @org_id OUTPUT, @role OUTPUT;
  SELECT b.id AS branch_id, b.code, b.name AS branch_name, b.active,
         ISNULL(ms.stock, 0) AS stock, ISNULL(ms.min_stock, 0) AS min_stock
    FROM dbo.branches b
    JOIN dbo.fn_user_branch_ids(@user_id) ub ON ub.branch_id = b.id
    LEFT JOIN dbo.material_stock ms ON ms.branch_id = b.id AND ms.material_id = @material_id
   WHERE b.org_id = @org_id
   ORDER BY b.is_main DESC, b.name;
END
GO

-- Alta/edición. En el alta, @initial_stock se registra como ENTRADA en @branch_id.
CREATE OR ALTER PROCEDURE api.usp_material_save
  @user_id         UNIQUEIDENTIFIER,
  @id              UNIQUEIDENTIFIER = NULL,
  @name            NVARCHAR(150),
  @type            NVARCHAR(30),
  @purity          NVARCHAR(20) = NULL,
  @unit            NVARCHAR(5) = N'g',
  @min_stock       DECIMAL(14, 3) = 0,
  @reference_cost  DECIMAL(12, 2) = 0,
  @active          BIT = 1,
  @initial_stock   DECIMAL(14, 3) = 0,
  @branch_id       UNIQUEIDENTIFIER = NULL
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20), @mov UNIQUEIDENTIFIER, @now DATETIMEOFFSET(3) = dbo.fn_now();
    EXEC dbo.usp_int_ctx @user_id, N'ADMIN,GERENTE', 1, @org_id OUTPUT, @role OUTPUT;
    SET @name = LTRIM(RTRIM(@name));
    IF EXISTS (SELECT 1 FROM dbo.materials WHERE org_id = @org_id AND name = @name AND (@id IS NULL OR id <> @id))
      THROW 50000, N'Ya existe un material con ese nombre.', 1;

    IF @id IS NULL
    BEGIN
      SET @id = NEWID();
      INSERT INTO dbo.materials (id, org_id, name, type, purity, unit, min_stock, reference_cost, active, created_at, updated_at)
      VALUES (@id, @org_id, @name, @type, NULLIF(LTRIM(RTRIM(@purity)), N''), ISNULL(@unit, N'g'), ISNULL(@min_stock, 0),
              ISNULL(@reference_cost, 0), ISNULL(@active, 1), @now, @now);
      IF ISNULL(@initial_stock, 0) > 0
      BEGIN
        EXEC dbo.usp_int_resolve_branch @user_id, @org_id, @branch_id OUTPUT;
        EXEC dbo.usp_int_apply_material_movement @user_id, @org_id, @branch_id, @id, NULL, N'ENTRADA', N'EMPRESA',
             @initial_stock, @reference_cost, NULL, N'Stock inicial', NULL, NULL, @mov OUTPUT;
      END
    END
    ELSE
    BEGIN
      UPDATE dbo.materials
         SET name = @name, type = @type, purity = NULLIF(LTRIM(RTRIM(@purity)), N''), unit = ISNULL(@unit, unit),
             min_stock = ISNULL(@min_stock, 0), reference_cost = ISNULL(@reference_cost, 0), active = ISNULL(@active, 1),
             updated_at = @now
       WHERE id = @id AND org_id = @org_id;
      IF @@ROWCOUNT = 0 THROW 50004, N'Material no encontrado.', 1;
    END
    COMMIT;
    SELECT @id AS id;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

-- Movimiento de material (entrada, salida, ajuste, consumo, devolución).
--   Con pedido: lo registra quien pueda ver el pedido; la sucursal es la del pedido.
--   Sin pedido: ADMIN, GERENTE o SUPERVISOR en una sucursal accesible.
CREATE OR ALTER PROCEDURE api.usp_material_movement_register
  @user_id        UNIQUEIDENTIFIER,
  @material_id    UNIQUEIDENTIFIER,
  @movement_type  NVARCHAR(20),
  @quantity       DECIMAL(14, 3),
  @ownership      NVARCHAR(10) = N'EMPRESA',
  @order_id       UNIQUEIDENTIFIER = NULL,
  @branch_id      UNIQUEIDENTIFIER = NULL,
  @unit_cost      DECIMAL(12, 2) = NULL,
  @movement_date  DATE = NULL,
  @notes          NVARCHAR(1000) = NULL
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20), @order_branch UNIQUEIDENTIFIER, @id UNIQUEIDENTIFIER;
    EXEC dbo.usp_int_ctx @user_id, NULL, 1, @org_id OUTPUT, @role OUTPUT;

    IF @movement_type IN (N'TRASLADO_SALIDA', N'TRASLADO_ENTRADA')
      THROW 50000, N'Los traslados entre sucursales se registran con la opción «Trasladar».', 1;

    IF @order_id IS NOT NULL
    BEGIN
      EXEC dbo.usp_int_assert_order_visible @user_id, @order_id;
      SELECT @order_branch = branch_id FROM dbo.orders WHERE id = @order_id;
      IF @branch_id IS NULL OR @branch_id = @order_branch
        SET @branch_id = @order_branch;                        -- heredada del pedido: no se revalida
      ELSE
        EXEC dbo.usp_int_resolve_branch @user_id, @org_id, @branch_id OUTPUT;
    END
    ELSE
    BEGIN
      IF @role NOT IN (N'ADMIN', N'GERENTE', N'SUPERVISOR')
        THROW 50003, N'No tiene permisos para registrar movimientos de material.', 1;
      EXEC dbo.usp_int_resolve_branch @user_id, @org_id, @branch_id OUTPUT;
    END

    EXEC dbo.usp_int_apply_material_movement @user_id, @org_id, @branch_id, @material_id, @order_id, @movement_type,
         @ownership, @quantity, @unit_cost, @movement_date, @notes, NULL, NULL, @id OUTPUT;
    COMMIT;
    SELECT id, stock_after FROM dbo.material_movements WHERE id = @id;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

-- Traslado entre sucursales: salida en origen + entrada en destino, enlazados por transfer_id.
CREATE OR ALTER PROCEDURE api.usp_material_transfer
  @user_id         UNIQUEIDENTIFIER,
  @material_id     UNIQUEIDENTIFIER,
  @from_branch_id  UNIQUEIDENTIFIER,
  @to_branch_id    UNIQUEIDENTIFIER,
  @quantity        DECIMAL(14, 3),
  @notes           NVARCHAR(1000) = NULL
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20), @transfer UNIQUEIDENTIFIER = NEWID(), @m1 UNIQUEIDENTIFIER, @m2 UNIQUEIDENTIFIER;
    EXEC dbo.usp_int_ctx @user_id, N'ADMIN,GERENTE,SUPERVISOR', 1, @org_id OUTPUT, @role OUTPUT;

    IF ISNULL(@quantity, 0) <= 0 THROW 50000, N'La cantidad a trasladar debe ser mayor que cero.', 1;
    IF @from_branch_id = @to_branch_id THROW 50000, N'La sucursal de origen y la de destino deben ser distintas.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.fn_user_branch_ids(@user_id) WHERE branch_id = @from_branch_id)
      THROW 50003, N'No tiene acceso a la sucursal de origen.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.branches WHERE id = @from_branch_id AND org_id = @org_id AND active = 1)
      THROW 50000, N'La sucursal de origen está inactiva.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.branches WHERE id = @to_branch_id AND org_id = @org_id AND active = 1)
      THROW 50000, N'La sucursal de destino no existe o está inactiva.', 1;

    SET @notes = NULLIF(LTRIM(RTRIM(@notes)), N'');
    EXEC dbo.usp_int_apply_material_movement @user_id, @org_id, @from_branch_id, @material_id, NULL, N'TRASLADO_SALIDA',
         N'EMPRESA', @quantity, NULL, NULL, @notes, @transfer, @to_branch_id, @m1 OUTPUT;
    EXEC dbo.usp_int_apply_material_movement @user_id, @org_id, @to_branch_id, @material_id, NULL, N'TRASLADO_ENTRADA',
         N'EMPRESA', @quantity, NULL, NULL, @notes, @transfer, @from_branch_id, @m2 OUTPUT;
    COMMIT;
    SELECT @transfer AS transfer_id;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

CREATE OR ALTER PROCEDURE api.usp_material_set_branch_min_stock
  @user_id      UNIQUEIDENTIFIER,
  @material_id  UNIQUEIDENTIFIER,
  @branch_id    UNIQUEIDENTIFIER,
  @min_stock    DECIMAL(14, 3)
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20), @now DATETIMEOFFSET(3) = dbo.fn_now();
    EXEC dbo.usp_int_ctx @user_id, N'ADMIN,GERENTE', 1, @org_id OUTPUT, @role OUTPUT;
    IF ISNULL(@min_stock, -1) < 0 THROW 50000, N'El stock mínimo no puede ser negativo.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.materials WHERE id = @material_id AND org_id = @org_id)
       OR NOT EXISTS (SELECT 1 FROM dbo.branches WHERE id = @branch_id AND org_id = @org_id)
      THROW 50004, N'Material o sucursal no encontrados.', 1;

    UPDATE dbo.material_stock SET min_stock = @min_stock, updated_at = @now
     WHERE material_id = @material_id AND branch_id = @branch_id;
    IF @@ROWCOUNT = 0
      INSERT INTO dbo.material_stock (org_id, material_id, branch_id, min_stock, updated_at)
      VALUES (@org_id, @material_id, @branch_id, @min_stock, @now);
    COMMIT;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

-- Kárdex de un material (filtrable por sucursal y fechas)
CREATE OR ALTER PROCEDURE api.usp_material_kardex
  @user_id      UNIQUEIDENTIFIER,
  @material_id  UNIQUEIDENTIFIER,
  @branch_id    UNIQUEIDENTIFIER = NULL,
  @from         DATE = NULL,
  @to           DATE = NULL
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20);
  EXEC dbo.usp_int_ctx @user_id, NULL, 0, @org_id OUTPUT, @role OUTPUT;

  SELECT mm.id, mm.movement_date, mm.movement_type, mm.ownership, mm.quantity, mm.unit_cost, mm.stock_after, mm.notes,
         mm.branch_id, b.code AS branch_code, b.name AS branch_name,
         mm.counterpart_branch_id, cb.name AS counterpart_branch_name, mm.transfer_id,
         mm.order_id, o.number AS order_number, p.full_name AS created_by_name, mm.created_at
    FROM dbo.material_movements mm
    JOIN dbo.branches b ON b.id = mm.branch_id
    LEFT JOIN dbo.branches cb ON cb.id = mm.counterpart_branch_id
    LEFT JOIN dbo.orders o ON o.id = mm.order_id
    LEFT JOIN dbo.profiles p ON p.id = mm.created_by
   WHERE mm.material_id = @material_id AND mm.org_id = @org_id
     AND (@branch_id IS NULL OR mm.branch_id = @branch_id)
     AND (@from IS NULL OR mm.movement_date >= @from)
     AND (@to IS NULL OR mm.movement_date <= @to)
     AND ((@role IN (N'ADMIN', N'GERENTE', N'SUPERVISOR') AND mm.branch_id IN (SELECT branch_id FROM dbo.fn_user_branch_ids(@user_id)))
          OR (mm.order_id IS NOT NULL AND mm.order_id IN (SELECT id FROM dbo.fn_visible_orders(@user_id, NULL))))
   ORDER BY mm.movement_date DESC, mm.created_at DESC;
END
GO

-- Saldo de material del cliente en un pedido
CREATE OR ALTER PROCEDURE api.usp_order_client_materials
  @user_id   UNIQUEIDENTIFIER,
  @order_id  UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20);
  EXEC dbo.usp_int_ctx @user_id, NULL, 0, @org_id OUTPUT, @role OUTPUT;
  EXEC dbo.usp_int_assert_order_visible @user_id, @order_id;
  SELECT order_id, material_id, material_name, purity, unit, received, used, returned, balance
    FROM dbo.order_client_materials WHERE order_id = @order_id ORDER BY material_name;
END
GO


/* ---------------------------------------------------------------------
   4.8 Cotizaciones (ADMIN, GERENTE, VENDEDOR en sus sucursales)
   @header e @items en JSON, igual que las RPC de Supabase:
     header: {"branch_id","customer_id","service_type_id","issue_date","expiry_date","title",
              "main_material","estimated_weight","stone","size","notes","terms","tax_rate"}
     items:  [{"description","detail","material_id","material_name","quantity","unit","unit_price","discount"}]
   --------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE api.usp_quotations_list
  @user_id      UNIQUEIDENTIFIER,
  @status       NVARCHAR(20) = NULL,
  @branch_id    UNIQUEIDENTIFIER = NULL,
  @customer_id  UNIQUEIDENTIFIER = NULL,
  @search       NVARCHAR(100) = NULL,
  @from         DATE = NULL,
  @to           DATE = NULL
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20), @q NVARCHAR(102) = N'%' + NULLIF(LTRIM(RTRIM(@search)), N'') + N'%';
  EXEC dbo.usp_int_ctx @user_id, N'ADMIN,GERENTE,VENDEDOR', 0, @org_id OUTPUT, @role OUTPUT;

  SELECT q.id, q.number, q.status, q.issue_date, q.expiry_date, q.title, q.total, q.order_id,
         q.customer_id, c.full_name AS customer_name, q.service_type_id, st.name AS service_name,
         q.branch_id, b.name AS branch_name, q.created_at, q.updated_at
    FROM dbo.quotations q
    JOIN dbo.customers c ON c.id = q.customer_id
    JOIN dbo.service_types st ON st.id = q.service_type_id
    JOIN dbo.branches b ON b.id = q.branch_id
   WHERE q.org_id = @org_id
     AND q.branch_id IN (SELECT branch_id FROM dbo.fn_user_branch_ids(@user_id))
     AND (@status IS NULL OR q.status = @status)
     AND (@branch_id IS NULL OR q.branch_id = @branch_id)
     AND (@customer_id IS NULL OR q.customer_id = @customer_id)
     AND (@from IS NULL OR q.issue_date >= @from)
     AND (@to IS NULL OR q.issue_date <= @to)
     AND (@q IS NULL OR q.number LIKE @q OR q.title LIKE @q OR c.full_name LIKE @q)
   ORDER BY q.created_at DESC;
END
GO

-- 1) cabecera  2) ítems
CREATE OR ALTER PROCEDURE api.usp_quotation_get
  @user_id  UNIQUEIDENTIFIER,
  @id       UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20);
  EXEC dbo.usp_int_ctx @user_id, N'ADMIN,GERENTE,VENDEDOR', 0, @org_id OUTPUT, @role OUTPUT;
  IF NOT EXISTS (SELECT 1 FROM dbo.quotations WHERE id = @id AND org_id = @org_id
                   AND branch_id IN (SELECT branch_id FROM dbo.fn_user_branch_ids(@user_id)))
    THROW 50004, N'Cotización no encontrada o sin permisos.', 1;

  SELECT q.*, c.full_name AS customer_name, c.document_type AS customer_document_type,
         c.document_number AS customer_document_number, c.phone AS customer_phone, c.email AS customer_email,
         st.name AS service_name, b.name AS branch_name, o.number AS order_number, ap.full_name AS approved_by_name
    FROM dbo.quotations q
    JOIN dbo.customers c ON c.id = q.customer_id
    JOIN dbo.service_types st ON st.id = q.service_type_id
    JOIN dbo.branches b ON b.id = q.branch_id
    LEFT JOIN dbo.orders o ON o.id = q.order_id
    LEFT JOIN dbo.profiles ap ON ap.id = q.approved_by
   WHERE q.id = @id;

  SELECT id, position, description, detail, material_id, material_name, quantity, unit, unit_price, discount, subtotal
    FROM dbo.quotation_items WHERE quotation_id = @id ORDER BY position;
END
GO

CREATE OR ALTER PROCEDURE api.usp_quotation_save
  @user_id  UNIQUEIDENTIFIER,
  @id       UNIQUEIDENTIFIER = NULL,
  @header   NVARCHAR(MAX),
  @items    NVARCHAR(MAX)
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20), @now DATETIMEOFFSET(3) = dbo.fn_now(), @today DATE = dbo.fn_today(),
            @number NVARCHAR(30), @old_status NVARCHAR(20), @old_branch UNIQUEIDENTIFIER,
            @branch_id UNIQUEIDENTIFIER, @customer_id UNIQUEIDENTIFIER, @service_type_id UNIQUEIDENTIFIER,
            @issue_date DATE, @expiry_date DATE, @title NVARCHAR(200), @main_material NVARCHAR(100),
            @estimated_weight DECIMAL(10, 2), @stone NVARCHAR(100), @size NVARCHAR(50), @notes NVARCHAR(2000),
            @terms NVARCHAR(2000), @tax_rate DECIMAL(5, 2), @validity INT, @default_tax DECIMAL(5, 2);
    EXEC dbo.usp_int_ctx @user_id, N'ADMIN,GERENTE,VENDEDOR', 1, @org_id OUTPUT, @role OUTPUT;

    IF ISJSON(@header) = 0 THROW 50000, N'Cabecera no válida.', 1;
    IF ISJSON(@items) = 0 OR NOT EXISTS (SELECT 1 FROM OPENJSON(@items))
      THROW 50000, N'La cotización debe tener al menos un ítem.', 1;

    SELECT @branch_id = TRY_CAST(NULLIF(h.branch_id, N'') AS UNIQUEIDENTIFIER),
           @customer_id = TRY_CAST(NULLIF(h.customer_id, N'') AS UNIQUEIDENTIFIER),
           @service_type_id = TRY_CAST(NULLIF(h.service_type_id, N'') AS UNIQUEIDENTIFIER),
           @issue_date = TRY_CAST(NULLIF(h.issue_date, N'') AS DATE),
           @expiry_date = TRY_CAST(NULLIF(h.expiry_date, N'') AS DATE),
           @title = LTRIM(RTRIM(h.title)), @main_material = NULLIF(h.main_material, N''),
           @estimated_weight = h.estimated_weight, @stone = NULLIF(h.stone, N''), @size = NULLIF(h.size, N''),
           @notes = NULLIF(h.notes, N''), @terms = NULLIF(h.terms, N''), @tax_rate = h.tax_rate
      FROM OPENJSON(@header) WITH (
        branch_id NVARCHAR(50), customer_id NVARCHAR(50), service_type_id NVARCHAR(50), issue_date NVARCHAR(30),
        expiry_date NVARCHAR(30), title NVARCHAR(200), main_material NVARCHAR(100), estimated_weight DECIMAL(10, 2),
        stone NVARCHAR(100), size NVARCHAR(50), notes NVARCHAR(2000), terms NVARCHAR(2000), tax_rate DECIMAL(5, 2)) h;

    IF NOT EXISTS (SELECT 1 FROM dbo.customers WHERE id = @customer_id AND org_id = @org_id)
      THROW 50000, N'Seleccione un cliente válido.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.service_types WHERE id = @service_type_id AND org_id = @org_id)
      THROW 50000, N'Seleccione un tipo de servicio válido.', 1;
    IF EXISTS (SELECT 1 FROM OPENJSON(@items) WITH (material_id NVARCHAR(50)) j
                WHERE NULLIF(j.material_id, N'') IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM dbo.materials m
                                   WHERE m.id = TRY_CAST(j.material_id AS UNIQUEIDENTIFIER) AND m.org_id = @org_id))
      THROW 50000, N'Uno de los materiales de los ítems no existe.', 1;

    SELECT @validity = quote_validity_days, @default_tax = tax_rate FROM dbo.settings WHERE org_id = @org_id;

    IF @id IS NULL
    BEGIN
      EXEC dbo.usp_int_resolve_branch @user_id, @org_id, @branch_id OUTPUT;
      EXEC dbo.usp_int_next_document_number @org_id, N'COT', @number OUTPUT;
      SET @issue_date = ISNULL(@issue_date, @today);
      SET @id = NEWID();
      INSERT INTO dbo.quotations (id, org_id, branch_id, number, customer_id, service_type_id, issue_date, expiry_date, title,
                                  main_material, estimated_weight, stone, size, notes, terms, tax_rate, created_by,
                                  created_at, updated_at)
      VALUES (@id, @org_id, @branch_id, @number, @customer_id, @service_type_id, @issue_date,
              ISNULL(@expiry_date, DATEADD(DAY, ISNULL(@validity, 15), @issue_date)), @title, @main_material,
              @estimated_weight, @stone, @size, @notes, @terms, COALESCE(@tax_rate, @default_tax, 18), @user_id, @now, @now);
    END
    ELSE
    BEGIN
      SELECT @old_status = status, @old_branch = branch_id FROM dbo.quotations WITH (UPDLOCK)
       WHERE id = @id AND org_id = @org_id AND branch_id IN (SELECT branch_id FROM dbo.fn_user_branch_ids(@user_id));
      IF @old_status IS NULL THROW 50004, N'Cotización no encontrada o sin permisos.', 1;
      IF @old_status NOT IN (N'BORRADOR', N'ENVIADA')
        THROW 50000, N'Solo se pueden editar cotizaciones en estado Borrador o Enviada.', 1;
      IF @branch_id IS NULL SET @branch_id = @old_branch;
      ELSE IF @branch_id <> @old_branch EXEC dbo.usp_int_resolve_branch @user_id, @org_id, @branch_id OUTPUT;

      UPDATE dbo.quotations
         SET branch_id = @branch_id, customer_id = @customer_id, service_type_id = @service_type_id,
             issue_date = ISNULL(@issue_date, issue_date), expiry_date = ISNULL(@expiry_date, expiry_date),
             title = @title, main_material = @main_material, estimated_weight = @estimated_weight, stone = @stone,
             size = @size, notes = @notes, terms = @terms, tax_rate = ISNULL(@tax_rate, tax_rate), updated_at = @now
       WHERE id = @id;
      DELETE FROM dbo.quotation_items WHERE quotation_id = @id;
    END

    INSERT INTO dbo.quotation_items (org_id, quotation_id, position, description, detail, material_id, material_name,
                                     quantity, unit, unit_price, discount)
    SELECT @org_id, @id, CAST(a.[key] AS INT), LTRIM(RTRIM(j.description)), NULLIF(j.detail, N''),
           TRY_CAST(NULLIF(j.material_id, N'') AS UNIQUEIDENTIFIER), NULLIF(j.material_name, N''),
           j.quantity, ISNULL(NULLIF(j.unit, N''), N'und'), j.unit_price, ISNULL(j.discount, 0)
      FROM OPENJSON(@items) a
     CROSS APPLY OPENJSON(a.value) WITH (
        description NVARCHAR(500), detail NVARCHAR(1000), material_id NVARCHAR(50), material_name NVARCHAR(150),
        quantity DECIMAL(12, 3), unit NVARCHAR(10), unit_price DECIMAL(12, 2), discount DECIMAL(12, 2)) j;

    EXEC dbo.usp_int_recalc_quotation_totals @id;
    COMMIT;
    SELECT @id AS id;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

CREATE OR ALTER PROCEDURE api.usp_quotation_change_status
  @user_id  UNIQUEIDENTIFIER,
  @id       UNIQUEIDENTIFIER,
  @status   NVARCHAR(20)
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20), @old NVARCHAR(20), @order_id UNIQUEIDENTIFIER,
            @allowed NVARCHAR(200), @msg NVARCHAR(2048), @now DATETIMEOFFSET(3) = dbo.fn_now();
    EXEC dbo.usp_int_ctx @user_id, N'ADMIN,GERENTE,VENDEDOR', 1, @org_id OUTPUT, @role OUTPUT;

    SELECT @old = status, @order_id = order_id FROM dbo.quotations WITH (UPDLOCK)
     WHERE id = @id AND org_id = @org_id AND branch_id IN (SELECT branch_id FROM dbo.fn_user_branch_ids(@user_id));
    IF @old IS NULL THROW 50004, N'Cotización no encontrada o sin permisos.', 1;
    IF @old = @status BEGIN COMMIT; RETURN; END

    SET @allowed = CASE @old
      WHEN N'BORRADOR'  THEN N',ENVIADA,APROBADA,RECHAZADA,CANCELADA,'
      WHEN N'ENVIADA'   THEN N',BORRADOR,APROBADA,RECHAZADA,VENCIDA,CANCELADA,'
      WHEN N'VENCIDA'   THEN N',BORRADOR,ENVIADA,CANCELADA,'
      WHEN N'RECHAZADA' THEN N',BORRADOR,'
      WHEN N'APROBADA'  THEN CASE WHEN @order_id IS NULL THEN N',CANCELADA,' ELSE N'' END
      ELSE N'' END;
    IF CHARINDEX(N',' + @status + N',', @allowed) = 0
    BEGIN
      SET @msg = CONCAT(N'No se puede cambiar la cotización de ', @old, N' a ', @status, N'.');
      THROW 50000, @msg, 1;
    END

    UPDATE dbo.quotations
       SET status = @status,
           approved_at = CASE WHEN @status = N'APROBADA' THEN @now ELSE approved_at END,
           approved_by = CASE WHEN @status = N'APROBADA' THEN @user_id ELSE approved_by END,
           updated_at = @now
     WHERE id = @id;
    COMMIT;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

-- Duplicar: queda en Borrador con fechas nuevas, en la misma sucursal
CREATE OR ALTER PROCEDURE api.usp_quotation_duplicate
  @user_id  UNIQUEIDENTIFIER,
  @id       UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20), @new UNIQUEIDENTIFIER = NEWID(), @number NVARCHAR(30),
            @days INT, @today DATE = dbo.fn_today(), @now DATETIMEOFFSET(3) = dbo.fn_now();
    EXEC dbo.usp_int_ctx @user_id, N'ADMIN,GERENTE,VENDEDOR', 1, @org_id OUTPUT, @role OUTPUT;
    IF NOT EXISTS (SELECT 1 FROM dbo.quotations WHERE id = @id AND org_id = @org_id
                     AND branch_id IN (SELECT branch_id FROM dbo.fn_user_branch_ids(@user_id)))
      THROW 50004, N'Cotización no encontrada o sin permisos.', 1;

    SELECT @days = quote_validity_days FROM dbo.settings WHERE org_id = @org_id;
    EXEC dbo.usp_int_next_document_number @org_id, N'COT', @number OUTPUT;

    INSERT INTO dbo.quotations (id, org_id, branch_id, number, customer_id, service_type_id, issue_date, expiry_date, title,
                                main_material, estimated_weight, stone, size, notes, terms, tax_rate, created_by, created_at, updated_at)
    SELECT @new, org_id, branch_id, @number, customer_id, service_type_id, @today, DATEADD(DAY, ISNULL(@days, 15), @today), title,
           main_material, estimated_weight, stone, size, notes, terms, tax_rate, @user_id, @now, @now
      FROM dbo.quotations WHERE id = @id;

    INSERT INTO dbo.quotation_items (org_id, quotation_id, position, description, detail, material_id, material_name,
                                     quantity, unit, unit_price, discount)
    SELECT org_id, @new, position, description, detail, material_id, material_name, quantity, unit, unit_price, discount
      FROM dbo.quotation_items WHERE quotation_id = @id;

    EXEC dbo.usp_int_recalc_quotation_totals @new;
    COMMIT;
    SELECT @new AS id;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

-- Marca como vencidas las cotizaciones enviadas fuera de plazo (las visibles)
CREATE OR ALTER PROCEDURE api.usp_quotations_expire
  @user_id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20), @count INT = 0;
  EXEC dbo.usp_int_ctx @user_id, N'ADMIN,GERENTE,VENDEDOR', 0, @org_id OUTPUT, @role OUTPUT;
  IF dbo.fn_org_can_write(@org_id) = 1
  BEGIN
    UPDATE dbo.quotations SET status = N'VENCIDA', updated_at = dbo.fn_now()
     WHERE org_id = @org_id AND status = N'ENVIADA' AND expiry_date < dbo.fn_today()
       AND branch_id IN (SELECT branch_id FROM dbo.fn_user_branch_ids(@user_id));
    SET @count = @@ROWCOUNT;
  END
  SELECT @count AS expired;
END
GO

-- Convierte una cotización aprobada en pedido (reglas 1 y 2)
CREATE OR ALTER PROCEDURE api.usp_quotation_convert_to_order
  @user_id        UNIQUEIDENTIFIER,
  @quotation_id   UNIQUEIDENTIFIER,
  @assigned_to    UNIQUEIDENTIFIER = NULL,
  @due_date       DATE = NULL,
  @priority       NVARCHAR(10) = N'MEDIA',
  @create_stages  BIT = 1
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20), @status NVARCHAR(20), @q_number NVARCHAR(30),
            @q_order UNIQUEIDENTIFIER, @order_id UNIQUEIDENTIFIER = NEWID(), @number NVARCHAR(30), @count INT,
            @msg NVARCHAR(2048), @now DATETIMEOFFSET(3) = dbo.fn_now(), @today DATE = dbo.fn_today();
    EXEC dbo.usp_int_ctx @user_id, N'ADMIN,GERENTE,VENDEDOR', 1, @org_id OUTPUT, @role OUTPUT;

    SELECT @status = status, @q_number = number, @q_order = order_id FROM dbo.quotations WITH (UPDLOCK)
     WHERE id = @quotation_id AND org_id = @org_id AND branch_id IN (SELECT branch_id FROM dbo.fn_user_branch_ids(@user_id));
    IF @status IS NULL THROW 50004, N'Cotización no encontrada o sin permisos.', 1;
    IF @status <> N'APROBADA' THROW 50000, N'Solo una cotización aprobada puede convertirse en pedido.', 1;
    IF @q_order IS NOT NULL
    BEGIN
      SET @msg = CONCAT(N'La cotización ', @q_number, N' ya fue convertida en pedido.');
      THROW 50000, @msg, 1;
    END
    IF @assigned_to IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.profiles WHERE id = @assigned_to AND org_id = @org_id)
      THROW 50000, N'El responsable indicado no pertenece a la empresa.', 1;

    EXEC dbo.usp_int_next_document_number @org_id, N'PED', @number OUTPUT;
    INSERT INTO dbo.orders (id, org_id, branch_id, number, customer_id, quotation_id, service_type_id, status, priority, title,
                            description, main_material, estimated_weight, stone, size, notes, assigned_to, start_date,
                            due_date, tax_rate, created_by, created_at, updated_at)
    SELECT @order_id, q.org_id, q.branch_id, @number, q.customer_id, q.id, q.service_type_id, N'APROBADO',
           ISNULL(@priority, N'MEDIA'), q.title,
           (SELECT STRING_AGG(CAST(i.description + ISNULL(N': ' + i.detail, N'') AS NVARCHAR(MAX)), NCHAR(10))
                   WITHIN GROUP (ORDER BY i.position)
              FROM dbo.quotation_items i WHERE i.quotation_id = q.id),
           q.main_material, q.estimated_weight, q.stone, q.size, q.notes, @assigned_to, @today, @due_date, q.tax_rate,
           @user_id, @now, @now
      FROM dbo.quotations q WHERE q.id = @quotation_id;

    INSERT INTO dbo.order_items (org_id, order_id, position, description, detail, material_id, material_name,
                                 quantity, unit, unit_price, discount)
    SELECT org_id, @order_id, position, description, detail, material_id, material_name, quantity, unit, unit_price, discount
      FROM dbo.quotation_items WHERE quotation_id = @quotation_id;

    EXEC dbo.usp_int_recalc_order_totals @order_id;
    UPDATE dbo.quotations SET order_id = @order_id, updated_at = @now WHERE id = @quotation_id;

    SET @msg = CONCAT(dbo.fn_user_name(@user_id), N' creó el pedido ', @number, N' a partir de la cotización ', @q_number, N'.');
    EXEC dbo.usp_int_log_order_event @order_id, @user_id, N'CREACION', @msg;

    IF @create_stages = 1
      EXEC dbo.usp_int_create_order_stages @order_id, @user_id, @count OUTPUT;
    COMMIT;
    SELECT @order_id AS id, @number AS number;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

/* ---------------------------------------------------------------------
   4.9 Pedidos
   header: {"branch_id","customer_id","service_type_id","priority","title","description","main_material",
            "estimated_weight","stone","size","notes","assigned_to","start_date","due_date","tax_rate"}
   --------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE api.usp_orders_list
  @user_id      UNIQUEIDENTIFIER,
  @status       NVARCHAR(20) = NULL,
  @branch_id    UNIQUEIDENTIFIER = NULL,
  @customer_id  UNIQUEIDENTIFIER = NULL,
  @assigned_to  UNIQUEIDENTIFIER = NULL,
  @search       NVARCHAR(100) = NULL,
  @only_active  BIT = 0,
  @from         DATE = NULL,
  @to           DATE = NULL
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20), @q NVARCHAR(102) = N'%' + NULLIF(LTRIM(RTRIM(@search)), N'') + N'%';
  EXEC dbo.usp_int_ctx @user_id, NULL, 0, @org_id OUTPUT, @role OUTPUT;

  SELECT o.id, o.number, o.status, o.priority, o.title, o.start_date, o.due_date, o.total, o.amount_paid, o.balance,
         o.payment_status, o.progress, o.current_stage_name, o.qc_approved, o.delivered_at, o.closed_at,
         o.customer_id, c.full_name AS customer_name, o.service_type_id, st.name AS service_name,
         o.assigned_to, a.full_name AS assignee_name, o.branch_id, b.name AS branch_name,
         o.quotation_id, o.created_at, o.updated_at
    FROM dbo.orders o
    JOIN dbo.fn_visible_orders(@user_id, NULL) v ON v.id = o.id
    JOIN dbo.customers c ON c.id = o.customer_id
    JOIN dbo.service_types st ON st.id = o.service_type_id
    JOIN dbo.branches b ON b.id = o.branch_id
    LEFT JOIN dbo.profiles a ON a.id = o.assigned_to
   WHERE (@status IS NULL OR o.status = @status)
     AND (@branch_id IS NULL OR o.branch_id = @branch_id)
     AND (@customer_id IS NULL OR o.customer_id = @customer_id)
     AND (@assigned_to IS NULL OR o.assigned_to = @assigned_to)
     AND (@only_active = 0 OR o.status NOT IN (N'ENTREGADO', N'CERRADO', N'CANCELADO'))
     AND (@from IS NULL OR dbo.fn_local_date(o.created_at) >= @from)
     AND (@to IS NULL OR dbo.fn_local_date(o.created_at) <= @to)
     AND (@q IS NULL OR o.number LIKE @q OR o.title LIKE @q OR c.full_name LIKE @q)
   ORDER BY o.created_at DESC;
END
GO

-- 1) cabecera 2) ítems 3) etapas 4) historial 5) pagos 6) entregas 7) adjuntos 8) material del cliente
CREATE OR ALTER PROCEDURE api.usp_order_get
  @user_id  UNIQUEIDENTIFIER,
  @id       UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20);
  EXEC dbo.usp_int_ctx @user_id, NULL, 0, @org_id OUTPUT, @role OUTPUT;
  EXEC dbo.usp_int_assert_order_visible @user_id, @id;

  SELECT o.*, c.full_name AS customer_name, c.phone AS customer_phone, c.whatsapp AS customer_whatsapp,
         c.email AS customer_email, st.name AS service_name, b.name AS branch_name, a.full_name AS assignee_name,
         q.number AS quotation_number, qc.full_name AS qc_approved_by_name
    FROM dbo.orders o
    JOIN dbo.customers c ON c.id = o.customer_id
    JOIN dbo.service_types st ON st.id = o.service_type_id
    JOIN dbo.branches b ON b.id = o.branch_id
    LEFT JOIN dbo.profiles a ON a.id = o.assigned_to
    LEFT JOIN dbo.quotations q ON q.id = o.quotation_id
    LEFT JOIN dbo.profiles qc ON qc.id = o.qc_approved_by
   WHERE o.id = @id;

  SELECT id, position, description, detail, material_id, material_name, quantity, unit, unit_price, discount, subtotal
    FROM dbo.order_items WHERE order_id = @id ORDER BY position;

  SELECT s.id, s.stage_id, s.name, s.position, s.is_quality_check, s.status, s.is_current, s.assigned_to,
         p.full_name AS assignee_name, s.started_at, s.completed_at, s.notes, s.updated_at
    FROM dbo.order_production_stages s LEFT JOIN dbo.profiles p ON p.id = s.assigned_to
   WHERE s.order_id = @id ORDER BY s.position, s.created_at;

  SELECT id, event_type, description, old_value, new_value, actor_id, actor_name, created_at
    FROM dbo.order_history WHERE order_id = @id ORDER BY created_at DESC;

  SELECT p.id, p.payment_date, p.amount, p.method, p.reference, p.notes, p.is_advance, p.voided, p.voided_at,
         p.void_reason, p.branch_id, b.name AS branch_name, cb.full_name AS created_by_name, p.created_at
    FROM dbo.payments p
    JOIN dbo.branches b ON b.id = p.branch_id
    LEFT JOIN dbo.profiles cb ON cb.id = p.created_by
   WHERE p.order_id = @id AND @role IN (N'ADMIN', N'GERENTE', N'VENDEDOR')
   ORDER BY p.payment_date, p.created_at;

  SELECT d.id, d.number, d.status, d.scheduled_date, d.delivered_at, d.responsible_id, r.full_name AS responsible_name,
         d.received_by, d.conformity, d.conformity_notes, d.signature_path, d.notes, d.branch_id, b.name AS branch_name,
         d.created_at
    FROM dbo.deliveries d
    JOIN dbo.branches b ON b.id = d.branch_id
    LEFT JOIN dbo.profiles r ON r.id = d.responsible_id
   WHERE d.order_id = @id AND @role IN (N'ADMIN', N'GERENTE', N'VENDEDOR', N'SUPERVISOR')
   ORDER BY d.scheduled_date, d.created_at;

  SELECT a.id, a.category, a.file_name, a.storage_path, a.mime_type, a.size_bytes, a.description,
         a.uploaded_by, u.full_name AS uploaded_by_name, a.created_at
    FROM dbo.attachments a LEFT JOIN dbo.profiles u ON u.id = a.uploaded_by
   WHERE a.order_id = @id AND a.deleted_at IS NULL
   ORDER BY a.created_at DESC;

  SELECT material_id, material_name, purity, unit, received, used, returned, balance
    FROM dbo.order_client_materials WHERE order_id = @id ORDER BY material_name;
END
GO

CREATE OR ALTER PROCEDURE api.usp_order_save
  @user_id  UNIQUEIDENTIFIER,
  @id       UNIQUEIDENTIFIER = NULL,
  @header   NVARCHAR(MAX),
  @items    NVARCHAR(MAX)
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20), @now DATETIMEOFFSET(3) = dbo.fn_now(), @today DATE = dbo.fn_today(),
            @number NVARCHAR(30), @msg NVARCHAR(2048), @default_tax DECIMAL(5, 2),
            @branch_id UNIQUEIDENTIFIER, @customer_id UNIQUEIDENTIFIER, @service_type_id UNIQUEIDENTIFIER,
            @priority NVARCHAR(10), @title NVARCHAR(200), @description NVARCHAR(MAX), @main_material NVARCHAR(100),
            @estimated_weight DECIMAL(10, 2), @stone NVARCHAR(100), @size NVARCHAR(50), @notes NVARCHAR(2000),
            @assigned_to UNIQUEIDENTIFIER, @start_date DATE, @due_date DATE, @tax_rate DECIMAL(5, 2);
    DECLARE @old TABLE (branch_id UNIQUEIDENTIFIER, customer_id UNIQUEIDENTIFIER, service_type_id UNIQUEIDENTIFIER,
                        priority NVARCHAR(10), title NVARCHAR(200), description NVARCHAR(MAX), main_material NVARCHAR(100),
                        estimated_weight DECIMAL(10, 2), stone NVARCHAR(100), size NVARCHAR(50), notes NVARCHAR(2000),
                        assigned_to UNIQUEIDENTIFIER, start_date DATE, due_date DATE, total DECIMAL(12, 2), number NVARCHAR(30));
    DECLARE @changes TABLE (n INT IDENTITY, label NVARCHAR(200));
    EXEC dbo.usp_int_ctx @user_id, N'ADMIN,GERENTE,VENDEDOR', 1, @org_id OUTPUT, @role OUTPUT;

    IF ISJSON(@header) = 0 THROW 50000, N'Cabecera no válida.', 1;
    IF ISJSON(@items) = 0 OR NOT EXISTS (SELECT 1 FROM OPENJSON(@items))
      THROW 50000, N'El pedido debe tener al menos un ítem.', 1;

    SELECT @branch_id = TRY_CAST(NULLIF(h.branch_id, N'') AS UNIQUEIDENTIFIER),
           @customer_id = TRY_CAST(NULLIF(h.customer_id, N'') AS UNIQUEIDENTIFIER),
           @service_type_id = TRY_CAST(NULLIF(h.service_type_id, N'') AS UNIQUEIDENTIFIER),
           @priority = NULLIF(h.priority, N''), @title = LTRIM(RTRIM(h.title)), @description = NULLIF(h.description, N''),
           @main_material = NULLIF(h.main_material, N''), @estimated_weight = h.estimated_weight,
           @stone = NULLIF(h.stone, N''), @size = NULLIF(h.size, N''), @notes = NULLIF(h.notes, N''),
           @assigned_to = TRY_CAST(NULLIF(h.assigned_to, N'') AS UNIQUEIDENTIFIER),
           @start_date = TRY_CAST(NULLIF(h.start_date, N'') AS DATE), @due_date = TRY_CAST(NULLIF(h.due_date, N'') AS DATE),
           @tax_rate = h.tax_rate
      FROM OPENJSON(@header) WITH (
        branch_id NVARCHAR(50), customer_id NVARCHAR(50), service_type_id NVARCHAR(50), priority NVARCHAR(10),
        title NVARCHAR(200), description NVARCHAR(MAX), main_material NVARCHAR(100), estimated_weight DECIMAL(10, 2),
        stone NVARCHAR(100), size NVARCHAR(50), notes NVARCHAR(2000), assigned_to NVARCHAR(50), start_date NVARCHAR(30),
        due_date NVARCHAR(30), tax_rate DECIMAL(5, 2)) h;

    IF NOT EXISTS (SELECT 1 FROM dbo.customers WHERE id = @customer_id AND org_id = @org_id)
      THROW 50000, N'Seleccione un cliente válido.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.service_types WHERE id = @service_type_id AND org_id = @org_id)
      THROW 50000, N'Seleccione un tipo de servicio válido.', 1;
    IF @assigned_to IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.profiles WHERE id = @assigned_to AND org_id = @org_id)
      THROW 50000, N'El responsable indicado no pertenece a la empresa.', 1;
    IF EXISTS (SELECT 1 FROM OPENJSON(@items) WITH (material_id NVARCHAR(50)) j
                WHERE NULLIF(j.material_id, N'') IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM dbo.materials m
                                   WHERE m.id = TRY_CAST(j.material_id AS UNIQUEIDENTIFIER) AND m.org_id = @org_id))
      THROW 50000, N'Uno de los materiales de los ítems no existe.', 1;

    SELECT @default_tax = tax_rate FROM dbo.settings WHERE org_id = @org_id;

    IF @id IS NULL
    BEGIN
      EXEC dbo.usp_int_resolve_branch @user_id, @org_id, @branch_id OUTPUT;
      EXEC dbo.usp_int_next_document_number @org_id, N'PED', @number OUTPUT;
      SET @id = NEWID();
      INSERT INTO dbo.orders (id, org_id, branch_id, number, customer_id, service_type_id, priority, title, description,
                              main_material, estimated_weight, stone, size, notes, assigned_to, start_date, due_date,
                              tax_rate, created_by, created_at, updated_at)
      VALUES (@id, @org_id, @branch_id, @number, @customer_id, @service_type_id, ISNULL(@priority, N'MEDIA'), @title,
              @description, @main_material, @estimated_weight, @stone, @size, @notes, @assigned_to,
              ISNULL(@start_date, @today), @due_date, COALESCE(@tax_rate, @default_tax, 18), @user_id, @now, @now);

      SET @msg = CONCAT(dbo.fn_user_name(@user_id), N' creó el pedido ', @number, N'.');
      EXEC dbo.usp_int_log_order_event @id, @user_id, N'CREACION', @msg;
    END
    ELSE
    BEGIN
      EXEC dbo.usp_int_assert_order_visible @user_id, @id;
      EXEC dbo.usp_int_assert_order_editable @id, @user_id;

      INSERT INTO @old
      SELECT branch_id, customer_id, service_type_id, priority, title, description, main_material, estimated_weight,
             stone, size, notes, assigned_to, start_date, due_date, total, number
        FROM dbo.orders WITH (UPDLOCK) WHERE id = @id;

      IF @branch_id IS NULL SELECT @branch_id = branch_id FROM @old;
      ELSE IF @branch_id <> (SELECT branch_id FROM @old) EXEC dbo.usp_int_resolve_branch @user_id, @org_id, @branch_id OUTPUT;

      UPDATE dbo.orders
         SET branch_id = @branch_id, customer_id = @customer_id, service_type_id = @service_type_id,
             priority = ISNULL(@priority, priority), title = @title, description = @description,
             main_material = @main_material, estimated_weight = @estimated_weight, stone = @stone, size = @size,
             notes = @notes, assigned_to = @assigned_to, start_date = ISNULL(@start_date, start_date),
             due_date = @due_date, tax_rate = ISNULL(@tax_rate, tax_rate), updated_at = @now
       WHERE id = @id;
      DELETE FROM dbo.order_items WHERE order_id = @id;
    END

    INSERT INTO dbo.order_items (org_id, order_id, position, description, detail, material_id, material_name,
                                 quantity, unit, unit_price, discount)
    SELECT @org_id, @id, CAST(a.[key] AS INT), LTRIM(RTRIM(j.description)), NULLIF(j.detail, N''),
           TRY_CAST(NULLIF(j.material_id, N'') AS UNIQUEIDENTIFIER), NULLIF(j.material_name, N''),
           j.quantity, ISNULL(NULLIF(j.unit, N''), N'und'), j.unit_price, ISNULL(j.discount, 0)
      FROM OPENJSON(@items) a
     CROSS APPLY OPENJSON(a.value) WITH (
        description NVARCHAR(500), detail NVARCHAR(1000), material_id NVARCHAR(50), material_name NVARCHAR(150),
        quantity DECIMAL(12, 3), unit NVARCHAR(10), unit_price DECIMAL(12, 2), discount DECIMAL(12, 2)) j;

    EXEC dbo.usp_int_recalc_order_totals @id;

    -- Auditoría de la edición (ex orders_after_write)
    IF EXISTS (SELECT 1 FROM @old)
    BEGIN
      DECLARE @o_assigned UNIQUEIDENTIFIER, @o_total DECIMAL(12, 2), @n_total DECIMAL(12, 2), @o_number NVARCHAR(30),
              @old_name NVARCHAR(150), @new_name NVARCHAR(150);
      SELECT @o_assigned = assigned_to, @o_total = total, @o_number = number FROM @old;
      SELECT @n_total = total FROM dbo.orders WHERE id = @id;

      IF EXISTS (SELECT @o_assigned EXCEPT SELECT @assigned_to)
      BEGIN
        SELECT @old_name = full_name FROM dbo.profiles WHERE id = @o_assigned;
        SELECT @new_name = full_name FROM dbo.profiles WHERE id = @assigned_to;
        SET @msg = CONCAT(dbo.fn_user_name(@user_id), N' asignó como responsable a ', ISNULL(@new_name, N'(sin responsable)'),
                          CASE WHEN @old_name IS NOT NULL THEN N' (antes: ' + @old_name + N')' ELSE N'' END, N'.');
        EXEC dbo.usp_int_log_order_event @id, @user_id, N'RESPONSABLE', @msg, @old_name, @new_name;
      END

      INSERT INTO @changes (label)
      SELECT v.label FROM @old o
      CROSS APPLY (VALUES
        (N'producto',          CASE WHEN EXISTS (SELECT o.title EXCEPT SELECT @title) THEN 1 ELSE 0 END),
        (N'descripción',       CASE WHEN EXISTS (SELECT o.description EXCEPT SELECT @description) THEN 1 ELSE 0 END),
        (N'cliente',           CASE WHEN EXISTS (SELECT o.customer_id EXCEPT SELECT @customer_id) THEN 1 ELSE 0 END),
        (N'tipo de servicio',  CASE WHEN EXISTS (SELECT o.service_type_id EXCEPT SELECT @service_type_id) THEN 1 ELSE 0 END),
        (N'prioridad',         CASE WHEN EXISTS (SELECT o.priority EXCEPT SELECT ISNULL(@priority, o.priority)) THEN 1 ELSE 0 END),
        (N'fecha de inicio',   CASE WHEN EXISTS (SELECT o.start_date EXCEPT SELECT ISNULL(@start_date, o.start_date)) THEN 1 ELSE 0 END),
        (N'fecha de entrega',  CASE WHEN EXISTS (SELECT o.due_date EXCEPT SELECT @due_date) THEN 1 ELSE 0 END),
        (N'especificaciones',  CASE WHEN EXISTS (SELECT o.main_material, o.estimated_weight, o.stone, o.size
                                                 EXCEPT SELECT @main_material, @estimated_weight, @stone, @size) THEN 1 ELSE 0 END),
        (N'observaciones',     CASE WHEN EXISTS (SELECT o.notes EXCEPT SELECT @notes) THEN 1 ELSE 0 END),
        (N'sucursal',          CASE WHEN EXISTS (SELECT o.branch_id EXCEPT SELECT @branch_id) THEN 1 ELSE 0 END)
      ) v(label, changed)
      WHERE v.changed = 1;

      IF @n_total <> @o_total AND @o_total <> 0
        INSERT INTO @changes (label)
        VALUES (CONCAT(N'total (', dbo.fn_format_money(@o_total), N' → ', dbo.fn_format_money(@n_total), N')'));

      IF EXISTS (SELECT 1 FROM @changes)
      BEGIN
        SELECT @msg = CONCAT(dbo.fn_user_name(@user_id), N' modificó ',
                             STRING_AGG(label, N', ') WITHIN GROUP (ORDER BY n), N' del pedido ', @o_number, N'.')
          FROM @changes;
        EXEC dbo.usp_int_log_order_event @id, @user_id, N'MODIFICACION', @msg;
      END
    END
    COMMIT;
    SELECT id, number FROM dbo.orders WHERE id = @id;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

CREATE OR ALTER PROCEDURE api.usp_order_change_status
  @user_id  UNIQUEIDENTIFIER,
  @id       UNIQUEIDENTIFIER,
  @status   NVARCHAR(20)
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20);
    EXEC dbo.usp_int_ctx @user_id, N'ADMIN,GERENTE,VENDEDOR,SUPERVISOR', 1, @org_id OUTPUT, @role OUTPUT;
    EXEC dbo.usp_int_assert_order_visible @user_id, @id;
    EXEC dbo.usp_int_order_set_status @user_id, @id, @status;
    COMMIT;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

CREATE OR ALTER PROCEDURE api.usp_order_assign
  @user_id      UNIQUEIDENTIFIER,
  @id           UNIQUEIDENTIFIER,
  @assigned_to  UNIQUEIDENTIFIER = NULL
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20), @old UNIQUEIDENTIFIER, @old_name NVARCHAR(150),
            @new_name NVARCHAR(150), @msg NVARCHAR(2048);
    EXEC dbo.usp_int_ctx @user_id, N'ADMIN,GERENTE,VENDEDOR,SUPERVISOR', 1, @org_id OUTPUT, @role OUTPUT;
    EXEC dbo.usp_int_assert_order_visible @user_id, @id;
    EXEC dbo.usp_int_assert_order_editable @id, @user_id;
    IF @assigned_to IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.profiles WHERE id = @assigned_to AND org_id = @org_id)
      THROW 50000, N'El responsable indicado no pertenece a la empresa.', 1;

    SELECT @old = assigned_to FROM dbo.orders WITH (UPDLOCK) WHERE id = @id;
    IF EXISTS (SELECT @old EXCEPT SELECT @assigned_to)
    BEGIN
      UPDATE dbo.orders SET assigned_to = @assigned_to, updated_at = dbo.fn_now() WHERE id = @id;
      SELECT @old_name = full_name FROM dbo.profiles WHERE id = @old;
      SELECT @new_name = full_name FROM dbo.profiles WHERE id = @assigned_to;
      SET @msg = CONCAT(dbo.fn_user_name(@user_id), N' asignó como responsable a ', ISNULL(@new_name, N'(sin responsable)'),
                        CASE WHEN @old_name IS NOT NULL THEN N' (antes: ' + @old_name + N')' ELSE N'' END, N'.');
      EXEC dbo.usp_int_log_order_event @id, @user_id, N'RESPONSABLE', @msg, @old_name, @new_name;
    END
    COMMIT;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

-- Fecha de entrega y prioridad
CREATE OR ALTER PROCEDURE api.usp_order_update_schedule
  @user_id   UNIQUEIDENTIFIER,
  @id        UNIQUEIDENTIFIER,
  @due_date  DATE = NULL,
  @priority  NVARCHAR(10) = NULL
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20), @o_due DATE, @o_priority NVARCHAR(10), @number NVARCHAR(30),
            @changes NVARCHAR(200), @msg NVARCHAR(2048);
    EXEC dbo.usp_int_ctx @user_id, N'ADMIN,GERENTE,VENDEDOR,SUPERVISOR', 1, @org_id OUTPUT, @role OUTPUT;
    EXEC dbo.usp_int_assert_order_visible @user_id, @id;
    EXEC dbo.usp_int_assert_order_editable @id, @user_id;

    SELECT @o_due = due_date, @o_priority = priority, @number = number FROM dbo.orders WITH (UPDLOCK) WHERE id = @id;
    SET @priority = ISNULL(@priority, @o_priority);
    UPDATE dbo.orders SET due_date = @due_date, priority = @priority, updated_at = dbo.fn_now() WHERE id = @id;

    SET @changes = CONCAT_WS(N', ',
      CASE WHEN EXISTS (SELECT @o_due EXCEPT SELECT @due_date) THEN N'fecha de entrega' END,
      CASE WHEN @o_priority <> @priority THEN N'prioridad' END);
    IF @changes <> N''
    BEGIN
      SET @msg = CONCAT(dbo.fn_user_name(@user_id), N' modificó ', @changes, N' del pedido ', @number, N'.');
      EXEC dbo.usp_int_log_order_event @id, @user_id, N'MODIFICACION', @msg;
    END
    COMMIT;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

/* ---------------------------------------------------------------------
   4.10 Producción
   --------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE api.usp_order_create_stages
  @user_id   UNIQUEIDENTIFIER,
  @order_id  UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20), @count INT;
    EXEC dbo.usp_int_ctx @user_id, N'ADMIN,GERENTE,VENDEDOR,SUPERVISOR', 1, @org_id OUTPUT, @role OUTPUT;
    EXEC dbo.usp_int_assert_order_visible @user_id, @order_id;
    EXEC dbo.usp_int_assert_order_editable @order_id, @user_id;
    EXEC dbo.usp_int_create_order_stages @order_id, @user_id, @count OUTPUT;
    COMMIT;
    SELECT @count AS stages;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

CREATE OR ALTER PROCEDURE api.usp_order_stage_add
  @user_id           UNIQUEIDENTIFIER,
  @order_id          UNIQUEIDENTIFIER,
  @name              NVARCHAR(100),
  @position          INT,
  @is_quality_check  BIT = 0
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20), @id UNIQUEIDENTIFIER = NEWID();
    EXEC dbo.usp_int_ctx @user_id, N'ADMIN,GERENTE,VENDEDOR,SUPERVISOR', 1, @org_id OUTPUT, @role OUTPUT;
    EXEC dbo.usp_int_assert_order_visible @user_id, @order_id;
    EXEC dbo.usp_int_assert_order_editable @order_id, @user_id;
    IF LEN(LTRIM(ISNULL(@name, N''))) = 0 THROW 50000, N'Indique el nombre de la etapa.', 1;

    INSERT INTO dbo.order_production_stages (id, org_id, order_id, name, position, is_quality_check)
    VALUES (@id, @org_id, @order_id, LTRIM(RTRIM(@name)), @position, ISNULL(@is_quality_check, 0));
    EXEC dbo.usp_int_sync_order_production @order_id, @user_id;
    COMMIT;
    SELECT @id AS id;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

-- Actualiza estado, responsable y notas de una etapa.
--   ADMIN, GERENTE, SUPERVISOR: etapas de pedidos visibles
--   ORFEBRE: etapas asignadas a él o de pedidos asignados a él
CREATE OR ALTER PROCEDURE api.usp_order_stage_update
  @user_id      UNIQUEIDENTIFIER,
  @stage_id     UNIQUEIDENTIFIER,
  @status       NVARCHAR(20),
  @assigned_to  UNIQUEIDENTIFIER = NULL,
  @notes        NVARCHAR(1000) = NULL
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20), @order_id UNIQUEIDENTIFIER, @old_status NVARCHAR(20),
            @old_assigned UNIQUEIDENTIFIER, @name NVARCHAR(100), @number NVARCHAR(30), @assignee NVARCHAR(150),
            @msg NVARCHAR(2048), @now DATETIMEOFFSET(3) = dbo.fn_now();
    EXEC dbo.usp_int_ctx @user_id, N'ADMIN,GERENTE,SUPERVISOR,ORFEBRE', 1, @org_id OUTPUT, @role OUTPUT;

    SELECT @order_id = s.order_id, @old_status = s.status, @old_assigned = s.assigned_to, @name = s.name
      FROM dbo.order_production_stages s WITH (UPDLOCK) WHERE s.id = @stage_id AND s.org_id = @org_id;
    IF @order_id IS NULL THROW 50004, N'Etapa no encontrada.', 1;

    IF @role = N'ORFEBRE'
    BEGIN
      IF NOT (@old_assigned = @user_id OR EXISTS (SELECT 1 FROM dbo.orders WHERE id = @order_id AND assigned_to = @user_id))
        THROW 50003, N'Solo puede actualizar las etapas asignadas a usted.', 1;
    END
    ELSE
      EXEC dbo.usp_int_assert_order_visible @user_id, @order_id;

    EXEC dbo.usp_int_assert_order_editable @order_id, @user_id;
    IF @assigned_to IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.profiles WHERE id = @assigned_to AND org_id = @org_id)
      THROW 50000, N'El responsable indicado no pertenece a la empresa.', 1;

    UPDATE dbo.order_production_stages
       SET status = @status,
           assigned_to = @assigned_to,
           notes = NULLIF(LTRIM(RTRIM(@notes)), N''),
           started_at = CASE WHEN @status = @old_status THEN started_at
                             WHEN @status IN (N'EN_PROCESO', N'COMPLETADO') THEN ISNULL(started_at, @now)
                             WHEN @status = N'PENDIENTE' THEN NULL ELSE started_at END,
           completed_at = CASE WHEN @status = @old_status THEN completed_at
                               WHEN @status = N'COMPLETADO' THEN ISNULL(completed_at, @now) ELSE NULL END,
           updated_at = @now
     WHERE id = @stage_id;

    SELECT @number = number FROM dbo.orders WHERE id = @order_id;
    IF @status <> @old_status
    BEGIN
      SET @msg = CONCAT(dbo.fn_user_name(@user_id), N' marcó la etapa "', @name, N'" de ', @number, N' como ',
                        dbo.fn_stage_status_label(@status), N'.');
      EXEC dbo.usp_int_log_order_event @order_id, @user_id, N'PRODUCCION', @msg, @old_status, @status;
    END
    IF EXISTS (SELECT @old_assigned EXCEPT SELECT @assigned_to)
    BEGIN
      SELECT @assignee = full_name FROM dbo.profiles WHERE id = @assigned_to;
      SET @msg = CONCAT(dbo.fn_user_name(@user_id), N' asignó la etapa "', @name, N'" a ', ISNULL(@assignee, N'(nadie)'), N'.');
      EXEC dbo.usp_int_log_order_event @order_id, @user_id, N'PRODUCCION', @msg;
    END

    EXEC dbo.usp_int_sync_order_production @order_id, @user_id;
    COMMIT;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

CREATE OR ALTER PROCEDURE api.usp_order_stage_delete
  @user_id   UNIQUEIDENTIFIER,
  @stage_id  UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20), @order_id UNIQUEIDENTIFIER, @name NVARCHAR(100), @msg NVARCHAR(2048);
    EXEC dbo.usp_int_ctx @user_id, N'ADMIN,GERENTE,SUPERVISOR', 1, @org_id OUTPUT, @role OUTPUT;
    SELECT @order_id = order_id, @name = name FROM dbo.order_production_stages WHERE id = @stage_id AND org_id = @org_id;
    IF @order_id IS NULL THROW 50004, N'Etapa no encontrada.', 1;
    EXEC dbo.usp_int_assert_order_visible @user_id, @order_id;
    EXEC dbo.usp_int_assert_order_editable @order_id, @user_id;

    DELETE FROM dbo.order_production_stages WHERE id = @stage_id;
    SET @msg = CONCAT(dbo.fn_user_name(@user_id), N' eliminó la etapa "', @name, N'".');
    EXEC dbo.usp_int_log_order_event @order_id, @user_id, N'PRODUCCION', @msg;
    EXEC dbo.usp_int_sync_order_production @order_id, @user_id;
    COMMIT;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

-- Tablero de producción: etapas de los pedidos activos visibles
CREATE OR ALTER PROCEDURE api.usp_production_list
  @user_id    UNIQUEIDENTIFIER,
  @branch_id  UNIQUEIDENTIFIER = NULL,
  @only_mine  BIT = 0
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20);
  EXEC dbo.usp_int_ctx @user_id, NULL, 0, @org_id OUTPUT, @role OUTPUT;

  SELECT s.id, s.order_id, o.number AS order_number, o.title AS order_title, o.status AS order_status, o.priority,
         o.due_date, o.progress, c.full_name AS customer_name, o.branch_id, b.name AS branch_name,
         s.name, s.position, s.is_quality_check, s.status, s.is_current, s.assigned_to, p.full_name AS assignee_name,
         s.started_at, s.completed_at, s.notes
    FROM dbo.order_production_stages s
    JOIN dbo.orders o ON o.id = s.order_id
    JOIN dbo.fn_visible_orders(@user_id, NULL) v ON v.id = o.id
    JOIN dbo.customers c ON c.id = o.customer_id
    JOIN dbo.branches b ON b.id = o.branch_id
    LEFT JOIN dbo.profiles p ON p.id = s.assigned_to
   WHERE o.status NOT IN (N'ENTREGADO', N'CERRADO', N'CANCELADO')
     AND (@branch_id IS NULL OR o.branch_id = @branch_id)
     AND (@only_mine = 0 OR s.assigned_to = @user_id OR o.assigned_to = @user_id)
   ORDER BY o.due_date, o.number, s.position;
END
GO


/* ---------------------------------------------------------------------
   4.11 Pagos (ADMIN, GERENTE, VENDEDOR). No se eliminan: se anulan.
   La sucursal del pago es donde se cobró (por defecto la del pedido).
   --------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE api.usp_payment_register
  @user_id                UNIQUEIDENTIFIER,
  @order_id               UNIQUEIDENTIFIER,
  @amount                 DECIMAL(12, 2),
  @method                 NVARCHAR(20),
  @payment_date           DATE = NULL,
  @reference              NVARCHAR(100) = NULL,
  @notes                  NVARCHAR(1000) = NULL,
  @is_advance             BIT = 0,
  @overpayment_confirmed  BIT = 0,
  @branch_id              UNIQUEIDENTIFIER = NULL
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20), @balance DECIMAL(12, 2), @number NVARCHAR(30),
            @order_branch UNIQUEIDENTIFIER, @id UNIQUEIDENTIFIER = NEWID(), @msg NVARCHAR(2048),
            @now DATETIMEOFFSET(3) = dbo.fn_now();
    EXEC dbo.usp_int_ctx @user_id, N'ADMIN,GERENTE,VENDEDOR', 1, @org_id OUTPUT, @role OUTPUT;
    EXEC dbo.usp_int_assert_order_visible @user_id, @order_id;
    EXEC dbo.usp_int_assert_order_editable @order_id, @user_id;

    SELECT @balance = balance, @number = number, @order_branch = branch_id
      FROM dbo.orders WITH (UPDLOCK, ROWLOCK) WHERE id = @order_id;
    IF @branch_id IS NULL OR @branch_id = @order_branch SET @branch_id = @order_branch;
    ELSE EXEC dbo.usp_int_resolve_branch @user_id, @org_id, @branch_id OUTPUT;

    IF ISNULL(@amount, 0) <= 0 THROW 50000, N'El monto debe ser mayor que cero.', 1;
    IF @amount > @balance AND ISNULL(@overpayment_confirmed, 0) = 0
    BEGIN
      SET @msg = CONCAT(N'El monto (', dbo.fn_format_money(@amount), N') supera el saldo pendiente (',
                        dbo.fn_format_money(@balance), N'). Confirme explícitamente el pago.');
      THROW 50000, @msg, 1;
    END

    INSERT INTO dbo.payments (id, org_id, branch_id, order_id, payment_date, amount, method, reference, notes, is_advance,
                              overpayment_confirmed, created_by, created_at)
    VALUES (@id, @org_id, @branch_id, @order_id, ISNULL(@payment_date, dbo.fn_today()), @amount, @method,
            NULLIF(LTRIM(RTRIM(@reference)), N''), NULLIF(LTRIM(RTRIM(@notes)), N''), ISNULL(@is_advance, 0),
            ISNULL(@overpayment_confirmed, 0), @user_id, @now);

    UPDATE dbo.orders
       SET amount_paid = (SELECT ISNULL(SUM(amount), 0) FROM dbo.payments WHERE order_id = @order_id AND voided = 0),
           updated_at = @now
     WHERE id = @order_id;

    SET @msg = CONCAT(dbo.fn_user_name(@user_id), N' registró ', CASE WHEN @is_advance = 1 THEN N'un adelanto' ELSE N'un pago' END,
                      N' de ', dbo.fn_format_money(@amount), N' (', UPPER(LEFT(@method, 1)), LOWER(SUBSTRING(@method, 2, 50)),
                      N') en ', @number, N'.');
    DECLARE @amount_txt NVARCHAR(50) = CAST(@amount AS NVARCHAR(50));
    EXEC dbo.usp_int_log_order_event @order_id, @user_id, N'PAGO', @msg, NULL, @amount_txt;
    COMMIT;
    SELECT @id AS id;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

CREATE OR ALTER PROCEDURE api.usp_payment_void
  @user_id     UNIQUEIDENTIFIER,
  @payment_id  UNIQUEIDENTIFIER,
  @reason      NVARCHAR(500)
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20), @order_id UNIQUEIDENTIFIER, @voided BIT, @amount DECIMAL(12, 2),
            @number NVARCHAR(30), @msg NVARCHAR(2048), @now DATETIMEOFFSET(3) = dbo.fn_now();
    EXEC dbo.usp_int_ctx @user_id, N'ADMIN,GERENTE', 1, @org_id OUTPUT, @role OUTPUT;

    SELECT @order_id = order_id, @voided = voided, @amount = amount FROM dbo.payments WITH (UPDLOCK)
     WHERE id = @payment_id AND org_id = @org_id;
    IF @order_id IS NULL THROW 50004, N'Pago no encontrado.', 1;
    IF @voided = 1 THROW 50000, N'El pago ya está anulado.', 1;
    IF LEN(LTRIM(ISNULL(@reason, N''))) = 0 THROW 50000, N'Indique el motivo de la anulación.', 1;
    EXEC dbo.usp_int_assert_order_editable @order_id, @user_id;

    UPDATE dbo.payments SET voided = 1, voided_at = @now, voided_by = @user_id, void_reason = LTRIM(RTRIM(@reason))
     WHERE id = @payment_id;
    UPDATE dbo.orders
       SET amount_paid = (SELECT ISNULL(SUM(amount), 0) FROM dbo.payments WHERE order_id = @order_id AND voided = 0),
           updated_at = @now
     WHERE id = @order_id;

    SELECT @number = number FROM dbo.orders WHERE id = @order_id;
    SET @msg = CONCAT(dbo.fn_user_name(@user_id), N' anuló un pago de ', dbo.fn_format_money(@amount), N' en ', @number,
                      N'. Motivo: ', LTRIM(RTRIM(@reason)), N'.');
    DECLARE @amount_txt NVARCHAR(50) = CAST(@amount AS NVARCHAR(50));
    EXEC dbo.usp_int_log_order_event @order_id, @user_id, N'PAGO', @msg, @amount_txt, NULL;
    COMMIT;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

-- Pagos visibles: de la sucursal donde se cobraron o de pedidos visibles
CREATE OR ALTER PROCEDURE api.usp_payments_list
  @user_id         UNIQUEIDENTIFIER,
  @order_id        UNIQUEIDENTIFIER = NULL,
  @branch_id       UNIQUEIDENTIFIER = NULL,
  @from            DATE = NULL,
  @to              DATE = NULL,
  @include_voided  BIT = 1
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20);
  EXEC dbo.usp_int_ctx @user_id, N'ADMIN,GERENTE,VENDEDOR', 0, @org_id OUTPUT, @role OUTPUT;

  SELECT p.id, p.payment_date, p.amount, p.method, p.reference, p.notes, p.is_advance, p.overpayment_confirmed,
         p.voided, p.voided_at, p.void_reason, vb.full_name AS voided_by_name,
         p.order_id, o.number AS order_number, o.title AS order_title, c.full_name AS customer_name,
         p.branch_id, b.name AS branch_name, cb.full_name AS created_by_name, p.created_at
    FROM dbo.payments p
    JOIN dbo.orders o ON o.id = p.order_id
    JOIN dbo.customers c ON c.id = o.customer_id
    JOIN dbo.branches b ON b.id = p.branch_id
    LEFT JOIN dbo.profiles vb ON vb.id = p.voided_by
    LEFT JOIN dbo.profiles cb ON cb.id = p.created_by
   WHERE p.org_id = @org_id
     AND (p.branch_id IN (SELECT branch_id FROM dbo.fn_user_branch_ids(@user_id))
          OR p.order_id IN (SELECT id FROM dbo.fn_visible_orders(@user_id, NULL)))
     AND (@order_id IS NULL OR p.order_id = @order_id)
     AND (@branch_id IS NULL OR p.branch_id = @branch_id)
     AND (@from IS NULL OR p.payment_date >= @from)
     AND (@to IS NULL OR p.payment_date <= @to)
     AND (@include_voided = 1 OR p.voided = 0)
   ORDER BY p.payment_date DESC, p.created_at DESC;
END
GO

-- Cuentas por cobrar (pedidos visibles con saldo)
CREATE OR ALTER PROCEDURE api.usp_receivables_list
  @user_id    UNIQUEIDENTIFIER,
  @branch_id  UNIQUEIDENTIFIER = NULL
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20);
  EXEC dbo.usp_int_ctx @user_id, N'ADMIN,GERENTE,VENDEDOR', 0, @org_id OUTPUT, @role OUTPUT;

  SELECT o.id, o.number, o.title, o.status, o.due_date, o.delivered_at, o.total, o.amount_paid, o.balance,
         o.payment_status, o.customer_id, c.full_name AS customer_name, ISNULL(c.whatsapp, c.phone) AS customer_phone,
         o.branch_id, b.name AS branch_name
    FROM dbo.orders o
    JOIN dbo.fn_visible_orders(@user_id, NULL) v ON v.id = o.id
    JOIN dbo.customers c ON c.id = o.customer_id
    JOIN dbo.branches b ON b.id = o.branch_id
   WHERE o.status <> N'CANCELADO' AND o.balance > 0
     AND (@branch_id IS NULL OR o.branch_id = @branch_id)
   ORDER BY o.balance DESC;
END
GO

/* ---------------------------------------------------------------------
   4.12 Entregas (ADMIN, GERENTE, VENDEDOR, SUPERVISOR)
   --------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE api.usp_delivery_save
  @user_id           UNIQUEIDENTIFIER,
  @id                UNIQUEIDENTIFIER = NULL,
  @order_id          UNIQUEIDENTIFIER = NULL,      -- obligatorio en el alta
  @status            NVARCHAR(20) = N'PENDIENTE',
  @scheduled_date    DATE = NULL,
  @responsible_id    UNIQUEIDENTIFIER = NULL,
  @received_by       NVARCHAR(150) = NULL,
  @conformity        BIT = NULL,
  @conformity_notes  NVARCHAR(1000) = NULL,
  @notes             NVARCHAR(1000) = NULL,
  @branch_id         UNIQUEIDENTIFIER = NULL
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20), @old_status NVARCHAR(20), @number NVARCHAR(30),
            @o_status NVARCHAR(20), @o_number NVARCHAR(30), @o_customer UNIQUEIDENTIFIER, @o_qc BIT, @o_branch UNIQUEIDENTIFIER,
            @o_balance DECIMAL(12, 2), @delivered_at DATETIMEOFFSET(3), @msg NVARCHAR(2048), @old_branch UNIQUEIDENTIFIER,
            @now DATETIMEOFFSET(3) = dbo.fn_now(), @is_admin BIT;
    EXEC dbo.usp_int_ctx @user_id, N'ADMIN,GERENTE,VENDEDOR,SUPERVISOR', 1, @org_id OUTPUT, @role OUTPUT;
    SET @is_admin = CASE WHEN @role = N'ADMIN' THEN 1 ELSE 0 END;

    IF @id IS NOT NULL
    BEGIN
      SELECT @order_id = order_id, @old_status = status, @number = number, @delivered_at = delivered_at, @old_branch = branch_id
        FROM dbo.deliveries WITH (UPDLOCK) WHERE id = @id AND org_id = @org_id;
      IF @old_status IS NULL THROW 50004, N'Entrega no encontrada.', 1;
    END
    IF @order_id IS NULL THROW 50000, N'Indique el pedido.', 1;
    EXEC dbo.usp_int_assert_order_visible @user_id, @order_id;

    SELECT @o_status = status, @o_number = number, @o_customer = customer_id, @o_qc = qc_approved, @o_branch = branch_id
      FROM dbo.orders WITH (UPDLOCK) WHERE id = @order_id;
    IF @o_status IN (N'CERRADO', N'CANCELADO') AND @is_admin = 0
    BEGIN
      SET @msg = CONCAT(N'El pedido ', @o_number, N' está ', LOWER(dbo.fn_order_status_label(@o_status)), N'; no admite entregas.');
      THROW 50000, @msg, 1;
    END
    IF @old_status = N'ENTREGADA' AND @status <> N'ENTREGADA' AND @is_admin = 0
      THROW 50000, N'Una entrega realizada solo puede revertirla un administrador.', 1;

    -- Sucursal: por defecto la del pedido; otra distinta debe ser accesible
    IF @branch_id IS NULL SET @branch_id = ISNULL(@old_branch, @o_branch);
    ELSE IF @branch_id <> ISNULL(@old_branch, @o_branch) EXEC dbo.usp_int_resolve_branch @user_id, @org_id, @branch_id OUTPUT;

    IF @status = N'ENTREGADA'
    BEGIN
      IF @o_qc = 0
      BEGIN
        SET @msg = CONCAT(N'No se puede entregar: el control de calidad del pedido ', @o_number, N' no está aprobado.');
        THROW 50000, @msg, 1;
      END
      IF @conformity IS NULL THROW 50000, N'Indique si el cliente dio su conformidad.', 1;
      SET @delivered_at = ISNULL(@delivered_at, @now);         -- regla 11: fecha real de entrega
    END
    ELSE SET @delivered_at = NULL;

    IF @id IS NULL
    BEGIN
      EXEC dbo.usp_int_next_document_number @org_id, N'ENT', @number OUTPUT;
      SET @id = NEWID();
      INSERT INTO dbo.deliveries (id, org_id, branch_id, number, order_id, customer_id, status, scheduled_date, delivered_at,
                                  responsible_id, received_by, conformity, conformity_notes, notes, created_by, created_at, updated_at)
      VALUES (@id, @org_id, @branch_id, @number, @order_id, @o_customer, ISNULL(@status, N'PENDIENTE'),
              ISNULL(@scheduled_date, dbo.fn_today()), @delivered_at, @responsible_id, NULLIF(LTRIM(RTRIM(@received_by)), N''),
              @conformity, NULLIF(LTRIM(RTRIM(@conformity_notes)), N''), NULLIF(LTRIM(RTRIM(@notes)), N''), @user_id, @now, @now);
      SET @msg = CONCAT(dbo.fn_user_name(@user_id), N' programó la entrega ', @number, N' para el ',
                        CONVERT(NVARCHAR(10), ISNULL(@scheduled_date, dbo.fn_today()), 103), N'.');
      EXEC dbo.usp_int_log_order_event @order_id, @user_id, N'ENTREGA', @msg;
    END
    ELSE
      UPDATE dbo.deliveries
         SET branch_id = @branch_id, customer_id = @o_customer, status = @status,
             scheduled_date = ISNULL(@scheduled_date, scheduled_date), delivered_at = @delivered_at,
             responsible_id = @responsible_id, received_by = NULLIF(LTRIM(RTRIM(@received_by)), N''),
             conformity = @conformity, conformity_notes = NULLIF(LTRIM(RTRIM(@conformity_notes)), N''),
             notes = NULLIF(LTRIM(RTRIM(@notes)), N''), updated_at = @now
       WHERE id = @id;

    -- Efectos sobre el pedido (ex deliveries_after_write)
    IF @status = N'ENTREGADA' AND ISNULL(@old_status, N'') <> N'ENTREGADA'
    BEGIN
      SELECT @o_balance = balance FROM dbo.orders WHERE id = @order_id;
      SET @msg = CONCAT(dbo.fn_user_name(@user_id), N' registró la entrega ', @number, N' del pedido ', @o_number,
                        CASE WHEN @conformity = 1 THEN N' con conformidad del cliente' ELSE N' SIN conformidad del cliente' END,
                        CASE WHEN @o_balance > 0 THEN N'. Saldo pendiente: ' + dbo.fn_format_money(@o_balance) ELSE N'' END, N'.');
      EXEC dbo.usp_int_log_order_event @order_id, @user_id, N'ENTREGA', @msg;
      IF @o_status NOT IN (N'ENTREGADO', N'CERRADO')
      BEGIN
        EXEC dbo.usp_int_order_set_status @user_id, @order_id, N'ENTREGADO';
        UPDATE dbo.orders SET delivered_at = @delivered_at WHERE id = @order_id;
      END
    END
    ELSE IF @old_status IS NOT NULL AND @status <> @old_status
    BEGIN
      SET @msg = CONCAT(dbo.fn_user_name(@user_id), N' cambió la entrega ', @number, N' a ',
                        CASE @status WHEN N'PENDIENTE' THEN N'Pendiente' WHEN N'LISTA' THEN N'Lista'
                                     WHEN N'NO_ENTREGADA' THEN N'No entregada' ELSE @status END, N'.');
      EXEC dbo.usp_int_log_order_event @order_id, @user_id, N'ENTREGA', @msg;
      IF @old_status = N'ENTREGADA' AND @o_status = N'ENTREGADO'
         AND NOT EXISTS (SELECT 1 FROM dbo.deliveries WHERE order_id = @order_id AND status = N'ENTREGADA')
      BEGIN
        EXEC dbo.usp_int_order_set_status @user_id, @order_id, N'LISTO_ENTREGA';
        UPDATE dbo.orders SET delivered_at = NULL WHERE id = @order_id;
      END
    END
    COMMIT;

    SELECT d.*, o.number AS order_number, c.full_name AS customer_name, r.full_name AS responsible_name, b.name AS branch_name
      FROM dbo.deliveries d
      JOIN dbo.orders o ON o.id = d.order_id
      JOIN dbo.customers c ON c.id = d.customer_id
      JOIN dbo.branches b ON b.id = d.branch_id
      LEFT JOIN dbo.profiles r ON r.id = d.responsible_id
     WHERE d.id = @id;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

CREATE OR ALTER PROCEDURE api.usp_delivery_set_signature
  @user_id         UNIQUEIDENTIFIER,
  @id              UNIQUEIDENTIFIER,
  @signature_path  NVARCHAR(500)
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20), @order_id UNIQUEIDENTIFIER;
    EXEC dbo.usp_int_ctx @user_id, N'ADMIN,GERENTE,VENDEDOR,SUPERVISOR', 1, @org_id OUTPUT, @role OUTPUT;
    SELECT @order_id = order_id FROM dbo.deliveries WHERE id = @id AND org_id = @org_id;
    IF @order_id IS NULL THROW 50004, N'Entrega no encontrada.', 1;
    EXEC dbo.usp_int_assert_order_visible @user_id, @order_id;
    UPDATE dbo.deliveries SET signature_path = @signature_path, updated_at = dbo.fn_now() WHERE id = @id;
    COMMIT;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

CREATE OR ALTER PROCEDURE api.usp_deliveries_list
  @user_id    UNIQUEIDENTIFIER,
  @status     NVARCHAR(20) = NULL,
  @branch_id  UNIQUEIDENTIFIER = NULL,
  @order_id   UNIQUEIDENTIFIER = NULL,
  @from       DATE = NULL,
  @to         DATE = NULL
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20);
  EXEC dbo.usp_int_ctx @user_id, N'ADMIN,GERENTE,VENDEDOR,SUPERVISOR', 0, @org_id OUTPUT, @role OUTPUT;

  SELECT d.id, d.number, d.status, d.scheduled_date, d.delivered_at, d.received_by, d.conformity, d.conformity_notes,
         d.signature_path, d.notes, d.order_id, o.number AS order_number, o.title AS order_title, o.status AS order_status,
         o.balance AS order_balance, o.qc_approved, d.customer_id, c.full_name AS customer_name,
         ISNULL(c.whatsapp, c.phone) AS customer_phone, d.responsible_id, r.full_name AS responsible_name,
         d.branch_id, b.name AS branch_name, d.created_at, d.updated_at
    FROM dbo.deliveries d
    JOIN dbo.orders o ON o.id = d.order_id
    JOIN dbo.customers c ON c.id = d.customer_id
    JOIN dbo.branches b ON b.id = d.branch_id
    LEFT JOIN dbo.profiles r ON r.id = d.responsible_id
   WHERE d.org_id = @org_id
     AND (d.branch_id IN (SELECT branch_id FROM dbo.fn_user_branch_ids(@user_id))
          OR d.order_id IN (SELECT id FROM dbo.fn_visible_orders(@user_id, NULL)))
     AND (@status IS NULL OR d.status = @status)
     AND (@branch_id IS NULL OR d.branch_id = @branch_id)
     AND (@order_id IS NULL OR d.order_id = @order_id)
     AND (@from IS NULL OR d.scheduled_date >= @from)
     AND (@to IS NULL OR d.scheduled_date <= @to)
   ORDER BY d.scheduled_date, d.created_at;
END
GO

/* ---------------------------------------------------------------------
   4.13 Adjuntos (metadata). La API guarda el archivo y, antes de
   servirlo, consulta usp_attachment_check_access.
   --------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE api.usp_attachment_add
  @user_id       UNIQUEIDENTIFIER,
  @order_id      UNIQUEIDENTIFIER,
  @category      NVARCHAR(20),
  @file_name     NVARCHAR(255),
  @storage_path  NVARCHAR(500),
  @mime_type     NVARCHAR(100) = NULL,
  @size_bytes    BIGINT = NULL,
  @description   NVARCHAR(500) = NULL
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20), @id UNIQUEIDENTIFIER = NEWID(), @msg NVARCHAR(2048);
    EXEC dbo.usp_int_ctx @user_id, NULL, 1, @org_id OUTPUT, @role OUTPUT;
    EXEC dbo.usp_int_assert_order_visible @user_id, @order_id;
    EXEC dbo.usp_int_assert_order_editable @order_id, @user_id;

    INSERT INTO dbo.attachments (id, org_id, order_id, category, file_name, storage_path, mime_type, size_bytes, description,
                                 uploaded_by, created_at)
    VALUES (@id, @org_id, @order_id, ISNULL(@category, N'FOTO'), @file_name, @storage_path, @mime_type, @size_bytes,
            NULLIF(LTRIM(RTRIM(@description)), N''), @user_id, dbo.fn_now());
    SET @msg = CONCAT(dbo.fn_user_name(@user_id), N' subió el archivo "', @file_name, N'".');
    EXEC dbo.usp_int_log_order_event @order_id, @user_id, N'ARCHIVO', @msg;
    COMMIT;
    SELECT @id AS id;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

-- Borrado lógico: ADMIN, GERENTE o quien lo subió
CREATE OR ALTER PROCEDURE api.usp_attachment_delete
  @user_id  UNIQUEIDENTIFIER,
  @id       UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20), @order_id UNIQUEIDENTIFIER, @uploaded_by UNIQUEIDENTIFIER,
            @file_name NVARCHAR(255), @msg NVARCHAR(2048);
    EXEC dbo.usp_int_ctx @user_id, NULL, 1, @org_id OUTPUT, @role OUTPUT;
    SELECT @order_id = order_id, @uploaded_by = uploaded_by, @file_name = file_name
      FROM dbo.attachments WITH (UPDLOCK) WHERE id = @id AND org_id = @org_id AND deleted_at IS NULL;
    IF @order_id IS NULL THROW 50004, N'Archivo no encontrado.', 1;
    IF @role NOT IN (N'ADMIN', N'GERENTE') AND ISNULL(@uploaded_by, NEWID()) <> @user_id
      THROW 50003, N'Solo quien subió el archivo o un administrador puede eliminarlo.', 1;
    EXEC dbo.usp_int_assert_order_visible @user_id, @order_id;
    EXEC dbo.usp_int_assert_order_editable @order_id, @user_id;

    UPDATE dbo.attachments SET deleted_at = dbo.fn_now(), deleted_by = @user_id WHERE id = @id;
    SET @msg = CONCAT(dbo.fn_user_name(@user_id), N' eliminó el archivo "', @file_name, N'".');
    EXEC dbo.usp_int_log_order_event @order_id, @user_id, N'ARCHIVO', @msg;
    COMMIT;
    SELECT storage_path FROM dbo.attachments WHERE id = @id;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

-- ¿Puede el usuario descargar este archivo? Devuelve la fila si sí; vacío si no.
CREATE OR ALTER PROCEDURE api.usp_attachment_check_access
  @user_id       UNIQUEIDENTIFIER,
  @storage_path  NVARCHAR(500)
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20);
  EXEC dbo.usp_int_ctx @user_id, NULL, 0, @org_id OUTPUT, @role OUTPUT;
  SELECT a.id, a.order_id, a.file_name, a.mime_type, a.size_bytes
    FROM dbo.attachments a
    JOIN dbo.fn_visible_orders(@user_id, NULL) v ON v.id = a.order_id
   WHERE a.storage_path = @storage_path AND a.deleted_at IS NULL
  UNION ALL
  SELECT d.id, d.order_id, N'firma', NULL, NULL
    FROM dbo.deliveries d
    JOIN dbo.fn_visible_orders(@user_id, NULL) v ON v.id = d.order_id
   WHERE d.signature_path = @storage_path;
END
GO


/* ---------------------------------------------------------------------
   4.14 Dashboard: un JSON con la misma forma que get_dashboard() de
   Supabase. Respeta la visibilidad del usuario; @branch_id filtra.
   --------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE api.usp_dashboard_get
  @user_id    UNIQUEIDENTIFIER,
  @branch_id  UNIQUEIDENTIFIER = NULL
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20), @today DATE = dbo.fn_today(), @month_start DATE, @json NVARCHAR(MAX);
  EXEC dbo.usp_int_ctx @user_id, NULL, 0, @org_id OUTPUT, @role OUTPUT;
  SET @month_start = DATEFROMPARTS(YEAR(@today), MONTH(@today), 1);

  SELECT o.id, o.number, o.status, o.title, o.due_date, o.total, o.balance, o.customer_id, o.service_type_id,
         dbo.fn_local_date(o.created_at) AS created_date,
         CAST(CASE WHEN o.status NOT IN (N'ENTREGADO', N'CERRADO', N'CANCELADO') THEN 1 ELSE 0 END AS BIT) AS is_active
    INTO #o
    FROM dbo.orders o
    JOIN dbo.fn_visible_orders(@user_id, NULL) v ON v.id = o.id
   WHERE @branch_id IS NULL OR o.branch_id = @branch_id;

  SELECT q.id, q.number, q.status, q.expiry_date, q.total, q.customer_id
    INTO #q
    FROM dbo.quotations q
   WHERE q.org_id = @org_id AND @role IN (N'ADMIN', N'GERENTE', N'VENDEDOR')
     AND q.branch_id IN (SELECT branch_id FROM dbo.fn_user_branch_ids(@user_id))
     AND (@branch_id IS NULL OR q.branch_id = @branch_id);

  SELECT p.amount, p.payment_date
    INTO #p
    FROM dbo.payments p
   WHERE p.org_id = @org_id AND p.voided = 0 AND @role IN (N'ADMIN', N'GERENTE', N'VENDEDOR')
     AND (p.branch_id IN (SELECT branch_id FROM dbo.fn_user_branch_ids(@user_id))
          OR p.order_id IN (SELECT id FROM #o))
     AND (@branch_id IS NULL OR p.branch_id = @branch_id);

  SET @json = (
    SELECT
      JSON_QUERY((SELECT
        (SELECT COUNT(*) FROM #o WHERE is_active = 1) AS active_orders,
        (SELECT COUNT(*) FROM #o WHERE is_active = 1 AND status IN (N'DISENO', N'PRODUCCION', N'CONTROL_CALIDAD')) AS in_production,
        (SELECT COUNT(*) FROM #o WHERE status = N'LISTO_ENTREGA') AS ready_to_deliver,
        (SELECT COUNT(*) FROM #q WHERE status IN (N'BORRADOR', N'ENVIADA')) AS pending_quotations,
        (SELECT ISNULL(SUM(total), 0) FROM #o WHERE status <> N'CANCELADO' AND created_date >= @month_start) AS sales_month,
        (SELECT ISNULL(SUM(amount), 0) FROM #p WHERE payment_date >= @month_start) AS collected_month,
        (SELECT ISNULL(SUM(balance), 0) FROM #o WHERE status <> N'CANCELADO' AND balance > 0) AS receivable,
        (SELECT COUNT(*) FROM #o WHERE is_active = 1 AND due_date < @today AND status <> N'PAUSADO') AS overdue_orders
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)) AS kpis,

      JSON_QUERY(ISNULL((SELECT status, COUNT(*) AS [count] FROM #o GROUP BY status ORDER BY COUNT(*) DESC
                          FOR JSON PATH), N'[]')) AS orders_by_status,

      JSON_QUERY(ISNULL((SELECT FORMAT(m.month_start, 'yyyy-MM') AS [month],
                                (SELECT ISNULL(SUM(total), 0) FROM #o
                                  WHERE status <> N'CANCELADO' AND created_date >= m.month_start
                                    AND created_date < DATEADD(MONTH, 1, m.month_start)) AS sales,
                                (SELECT ISNULL(SUM(amount), 0) FROM #p
                                  WHERE payment_date >= m.month_start AND payment_date < DATEADD(MONTH, 1, m.month_start)) AS collected
                           FROM (SELECT DATEADD(MONTH, -n, @month_start) AS month_start
                                   FROM (VALUES (0), (1), (2), (3), (4), (5)) t(n)) m
                          ORDER BY m.month_start
                          FOR JSON PATH), N'[]')) AS sales_by_month,

      JSON_QUERY(ISNULL((SELECT st.name AS service, s.c AS [count]
                           FROM (SELECT service_type_id, COUNT(*) AS c FROM #o WHERE status <> N'CANCELADO'
                                  GROUP BY service_type_id) s
                           JOIN dbo.service_types st ON st.id = s.service_type_id
                          ORDER BY s.c DESC
                          FOR JSON PATH), N'[]')) AS orders_by_service,

      JSON_QUERY(ISNULL((SELECT ops.name AS stage, MIN(ops.position) AS position, COUNT(*) AS [count]
                           FROM dbo.order_production_stages ops
                           JOIN #o o ON o.id = ops.order_id AND o.is_active = 1
                          WHERE ops.is_current = 1
                          GROUP BY ops.name
                          ORDER BY MIN(ops.position)
                          FOR JSON PATH), N'[]')) AS production_by_stage,

      JSON_QUERY(ISNULL((SELECT TOP (10) o.id, o.number, c.full_name AS customer_name, o.title, o.due_date, o.status, o.balance
                           FROM #o o JOIN dbo.customers c ON c.id = o.customer_id
                          WHERE o.is_active = 1 AND o.due_date IS NOT NULL AND o.status <> N'PAUSADO'
                          ORDER BY o.due_date
                          FOR JSON PATH), N'[]')) AS upcoming_deliveries,

      JSON_QUERY((SELECT
        JSON_QUERY(ISNULL((SELECT TOP (10) o.id, o.number, c.full_name AS customer_name, o.due_date
                             FROM #o o JOIN dbo.customers c ON c.id = o.customer_id
                            WHERE o.is_active = 1 AND o.due_date < @today AND o.status <> N'PAUSADO'
                            ORDER BY o.due_date
                            FOR JSON PATH), N'[]')) AS overdue,
        JSON_QUERY(ISNULL((SELECT TOP (10) q.id, q.number, c.full_name AS customer_name, q.expiry_date, q.total
                             FROM #q q JOIN dbo.customers c ON c.id = q.customer_id
                            WHERE q.status IN (N'BORRADOR', N'ENVIADA')
                            ORDER BY q.expiry_date
                            FOR JSON PATH), N'[]')) AS pending_quotations,
        JSON_QUERY(ISNULL((SELECT TOP (10) o.id, o.number, c.full_name AS customer_name, o.balance
                             FROM #o o JOIN dbo.customers c ON c.id = o.customer_id
                            WHERE o.status IN (N'LISTO_ENTREGA', N'ENTREGADO') AND o.balance > 0
                            ORDER BY o.balance DESC
                            FOR JSON PATH), N'[]')) AS pending_payments,
        JSON_QUERY(ISNULL((SELECT TOP (10) o.id, o.number, c.full_name AS customer_name, o.due_date
                             FROM #o o JOIN dbo.customers c ON c.id = o.customer_id
                            WHERE o.is_active = 1 AND o.due_date BETWEEN @today AND DATEADD(DAY, 7, @today)
                            ORDER BY o.due_date
                            FOR JSON PATH), N'[]')) AS upcoming
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)) AS alerts
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);

  SELECT @json AS dashboard;
END
GO

/* ---------------------------------------------------------------------
   4.15 Reportes gerenciales (ADMIN y GERENTE). @branch_id opcional.
   --------------------------------------------------------------------- */

-- 1. Ventas por periodo (fecha de creación del pedido; excluye cancelados)
CREATE OR ALTER PROCEDURE api.usp_report_sales
  @user_id          UNIQUEIDENTIFIER,
  @from             DATE,
  @to               DATE,
  @service_type_id  UNIQUEIDENTIFIER = NULL,
  @customer_id      UNIQUEIDENTIFIER = NULL,
  @assigned_to      UNIQUEIDENTIFIER = NULL,
  @branch_id        UNIQUEIDENTIFIER = NULL
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20);
  EXEC dbo.usp_int_ctx @user_id, N'ADMIN,GERENTE', 0, @org_id OUTPUT, @role OUTPUT;

  SELECT o.id, o.number, dbo.fn_local_date(o.created_at) AS order_date, b.name AS branch_name, c.full_name AS customer_name,
         st.name AS service_name, o.title, pr.full_name AS assignee_name, o.status, o.subtotal, o.discount_total,
         o.tax_amount, o.total, o.amount_paid, o.balance
    FROM dbo.orders o
    JOIN dbo.branches b ON b.id = o.branch_id
    JOIN dbo.customers c ON c.id = o.customer_id
    JOIN dbo.service_types st ON st.id = o.service_type_id
    LEFT JOIN dbo.profiles pr ON pr.id = o.assigned_to
   WHERE o.org_id = @org_id AND o.status <> N'CANCELADO'
     AND dbo.fn_local_date(o.created_at) BETWEEN @from AND @to
     AND (@service_type_id IS NULL OR o.service_type_id = @service_type_id)
     AND (@customer_id IS NULL OR o.customer_id = @customer_id)
     AND (@assigned_to IS NULL OR o.assigned_to = @assigned_to)
     AND (@branch_id IS NULL OR o.branch_id = @branch_id)
   ORDER BY o.created_at;
END
GO

-- 2. Cuentas por cobrar con antigüedad (desde la entrega real; si no, la fecha comprometida; si no, la creación)
CREATE OR ALTER PROCEDURE api.usp_report_receivables
  @user_id      UNIQUEIDENTIFIER,
  @customer_id  UNIQUEIDENTIFIER = NULL,
  @branch_id    UNIQUEIDENTIFIER = NULL
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20), @today DATE = dbo.fn_today();
  EXEC dbo.usp_int_ctx @user_id, N'ADMIN,GERENTE', 0, @org_id OUTPUT, @role OUTPUT;

  SELECT x.*,
         CASE WHEN x.days_old < 0 THEN N'POR_VENCER'
              WHEN x.days_old <= 30 THEN N'0_30'
              WHEN x.days_old <= 60 THEN N'31_60'
              WHEN x.days_old <= 90 THEN N'61_90'
              ELSE N'MAS_90' END AS bucket
    FROM (
      SELECT o.id, o.number, b.name AS branch_name, c.full_name AS customer_name,
             ISNULL(c.whatsapp, c.phone) AS customer_phone, o.title, o.status, o.due_date, o.delivered_at,
             r.reference_date, o.total, o.amount_paid, o.balance, DATEDIFF(DAY, r.reference_date, @today) AS days_old
        FROM dbo.orders o
        JOIN dbo.branches b ON b.id = o.branch_id
        JOIN dbo.customers c ON c.id = o.customer_id
       CROSS APPLY (SELECT COALESCE(dbo.fn_local_date(o.delivered_at), o.due_date, dbo.fn_local_date(o.created_at)) AS reference_date) r
       WHERE o.org_id = @org_id AND o.status <> N'CANCELADO' AND o.balance > 0
         AND (@customer_id IS NULL OR o.customer_id = @customer_id)
         AND (@branch_id IS NULL OR o.branch_id = @branch_id)
    ) x
   ORDER BY x.days_old DESC;
END
GO

-- 3. Cobranza / caja (en la sucursal donde se cobró)
CREATE OR ALTER PROCEDURE api.usp_report_collections
  @user_id         UNIQUEIDENTIFIER,
  @from            DATE,
  @to              DATE,
  @method          NVARCHAR(20) = NULL,
  @include_voided  BIT = 0,
  @branch_id       UNIQUEIDENTIFIER = NULL
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20);
  EXEC dbo.usp_int_ctx @user_id, N'ADMIN,GERENTE', 0, @org_id OUTPUT, @role OUTPUT;

  SELECT p.id, p.payment_date, b.name AS branch_name, o.id AS order_id, o.number AS order_number,
         c.full_name AS customer_name, p.method, p.reference, p.is_advance, p.amount, p.voided, p.void_reason,
         vb.full_name AS voided_by_name, cb.full_name AS created_by_name
    FROM dbo.payments p
    JOIN dbo.branches b ON b.id = p.branch_id
    JOIN dbo.orders o ON o.id = p.order_id
    JOIN dbo.customers c ON c.id = o.customer_id
    LEFT JOIN dbo.profiles vb ON vb.id = p.voided_by
    LEFT JOIN dbo.profiles cb ON cb.id = p.created_by
   WHERE p.org_id = @org_id
     AND p.payment_date BETWEEN @from AND @to
     AND (@method IS NULL OR p.method = @method)
     AND (@include_voided = 1 OR p.voided = 0)
     AND (@branch_id IS NULL OR p.branch_id = @branch_id)
   ORDER BY p.payment_date, p.created_at;
END
GO

-- 4. Pedidos atrasados y por entregar (activos con entrega hasta hoy + N días)
CREATE OR ALTER PROCEDURE api.usp_report_order_deadlines
  @user_id      UNIQUEIDENTIFIER,
  @days_ahead   INT = 7,
  @assigned_to  UNIQUEIDENTIFIER = NULL,
  @branch_id    UNIQUEIDENTIFIER = NULL
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20), @today DATE = dbo.fn_today();
  EXEC dbo.usp_int_ctx @user_id, N'ADMIN,GERENTE', 0, @org_id OUTPUT, @role OUTPUT;
  SET @days_ahead = CASE WHEN ISNULL(@days_ahead, 7) < 0 THEN 0 ELSE ISNULL(@days_ahead, 7) END;

  SELECT o.id, o.number, b.name AS branch_name, c.full_name AS customer_name, ISNULL(c.whatsapp, c.phone) AS customer_phone,
         o.title, o.status, o.priority, o.current_stage_name, o.progress, pr.full_name AS assignee_name, o.due_date,
         DATEDIFF(DAY, @today, o.due_date) AS days_left, o.balance
    FROM dbo.orders o
    JOIN dbo.branches b ON b.id = o.branch_id
    JOIN dbo.customers c ON c.id = o.customer_id
    LEFT JOIN dbo.profiles pr ON pr.id = o.assigned_to
   WHERE o.org_id = @org_id
     AND o.status NOT IN (N'ENTREGADO', N'CERRADO', N'CANCELADO')
     AND o.due_date IS NOT NULL
     AND o.due_date <= DATEADD(DAY, @days_ahead, @today)
     AND (@assigned_to IS NULL OR o.assigned_to = @assigned_to)
     AND (@branch_id IS NULL OR o.branch_id = @branch_id)
   ORDER BY o.due_date,
            CASE o.priority WHEN N'URGENTE' THEN 1 WHEN N'ALTA' THEN 2 WHEN N'MEDIA' THEN 3 ELSE 4 END;
END
GO

-- 5. Stock valorizado. Sin sucursal: consolidado y mínimo global; con sucursal: su stock y su mínimo.
CREATE OR ALTER PROCEDURE api.usp_report_stock
  @user_id           UNIQUEIDENTIFIER,
  @type              NVARCHAR(30) = NULL,
  @include_inactive  BIT = 0,
  @branch_id         UNIQUEIDENTIFIER = NULL
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20);
  EXEC dbo.usp_int_ctx @user_id, N'ADMIN,GERENTE', 0, @org_id OUTPUT, @role OUTPUT;

  SELECT m.id, m.name, m.type, m.purity, m.unit, x.qty AS stock, x.min_qty AS min_stock, m.reference_cost,
         ROUND(x.qty * m.reference_cost, 2) AS stock_value,
         CAST(CASE WHEN m.active = 1 AND x.qty <= x.min_qty THEN 1 ELSE 0 END AS BIT) AS below_min, m.active
    FROM dbo.materials m
    LEFT JOIN dbo.material_stock ms ON ms.material_id = m.id AND ms.branch_id = @branch_id
   CROSS APPLY (SELECT CASE WHEN @branch_id IS NULL THEN m.stock ELSE ISNULL(ms.stock, 0) END AS qty,
                       CASE WHEN @branch_id IS NULL THEN m.min_stock ELSE ISNULL(ms.min_stock, 0) END AS min_qty) x
   WHERE m.org_id = @org_id
     AND (@type IS NULL OR m.type = @type)
     AND (@include_inactive = 1 OR m.active = 1)
   ORDER BY m.type, m.name;
END
GO

-- 6. Material de clientes en custodia (saldo pendiente por pedido)
CREATE OR ALTER PROCEDURE api.usp_report_client_custody
  @user_id      UNIQUEIDENTIFIER,
  @customer_id  UNIQUEIDENTIFIER = NULL,
  @branch_id    UNIQUEIDENTIFIER = NULL
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @org_id UNIQUEIDENTIFIER, @role NVARCHAR(20);
  EXEC dbo.usp_int_ctx @user_id, N'ADMIN,GERENTE', 0, @org_id OUTPUT, @role OUTPUT;

  SELECT o.id AS order_id, o.number AS order_number, o.status AS order_status, b.name AS branch_name,
         c.full_name AS customer_name, ISNULL(c.whatsapp, c.phone) AS customer_phone,
         ocm.material_name, ocm.purity, ocm.unit, ocm.received, ocm.used, ocm.returned, ocm.balance,
         (SELECT MAX(mm.movement_date) FROM dbo.material_movements mm
           WHERE mm.order_id = ocm.order_id AND mm.material_id = ocm.material_id AND mm.ownership = N'CLIENTE') AS last_movement
    FROM dbo.order_client_materials ocm
    JOIN dbo.orders o ON o.id = ocm.order_id
    JOIN dbo.branches b ON b.id = o.branch_id
    JOIN dbo.customers c ON c.id = o.customer_id
   WHERE o.org_id = @org_id AND ocm.balance <> 0
     AND (@customer_id IS NULL OR o.customer_id = @customer_id)
     AND (@branch_id IS NULL OR o.branch_id = @branch_id)
   ORDER BY c.full_name, o.number, ocm.material_name;
END
GO


/* ---------------------------------------------------------------------
   4.16 Plataforma SaaS
   --------------------------------------------------------------------- */

-- Planes (público: formulario de solicitud y página de precios)
CREATE OR ALTER PROCEDURE api.usp_plans_list
  @include_inactive BIT = 0
AS
BEGIN
  SET NOCOUNT ON;
  SELECT code, name, max_users, max_branches, price_month, price_year, extra_user_price, position, active
    FROM dbo.plans WHERE @include_inactive = 1 OR active = 1 ORDER BY position;
END
GO

CREATE OR ALTER PROCEDURE api.usp_plan_update
  @user_id           UNIQUEIDENTIFIER,
  @code              NVARCHAR(20),
  @name              NVARCHAR(100),
  @max_users         INT,
  @max_branches      INT,
  @price_month       DECIMAL(10, 2),
  @price_year        DECIMAL(10, 2),
  @extra_user_price  DECIMAL(10, 2),
  @position          INT,
  @active            BIT
AS
BEGIN
  SET NOCOUNT ON;
  EXEC dbo.usp_int_assert_platform_admin @user_id;
  UPDATE dbo.plans
     SET name = @name, max_users = @max_users, max_branches = @max_branches, price_month = @price_month,
         price_year = @price_year, extra_user_price = @extra_user_price, position = @position, active = @active
   WHERE code = @code;
  IF @@ROWCOUNT = 0 THROW 50004, N'Plan no encontrado.', 1;
END
GO

-- Formulario público "Solicitar acceso"
CREATE OR ALTER PROCEDURE api.usp_access_request_submit
  @company_name  NVARCHAR(120),
  @tax_id        NVARCHAR(11),
  @contact_name  NVARCHAR(120),
  @email         NVARCHAR(254),
  @phone         NVARCHAR(30),
  @plan_code     NVARCHAR(20),
  @message       NVARCHAR(1000)
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @mail NVARCHAR(254) = LOWER(LTRIM(RTRIM(@email)));
  SET @tax_id = NULLIF(LTRIM(RTRIM(@tax_id)), N'');

  IF EXISTS (SELECT 1 FROM dbo.profiles WHERE email = @mail)
    THROW 50000, N'Ese correo ya tiene una cuenta. Inicie sesión o use «¿Olvidó su contraseña?».', 1;
  IF EXISTS (SELECT 1 FROM dbo.access_requests WHERE email = @mail AND status = N'PENDING')
    THROW 50000, N'Ya existe una solicitud pendiente con ese correo. Le contactaremos pronto.', 1;
  IF (SELECT COUNT(*) FROM dbo.access_requests WHERE created_at > DATEADD(HOUR, -1, dbo.fn_now())) >= 30
    THROW 50000, N'Recibimos demasiadas solicitudes. Intente nuevamente en unos minutos.', 1;
  IF @tax_id IS NOT NULL AND (LEN(@tax_id) <> 11 OR @tax_id LIKE N'%[^0-9]%' OR LEFT(@tax_id, 2) NOT IN (N'10', N'15', N'17', N'20'))
    THROW 50000, N'El RUC no es válido.', 1;
  IF LEN(LTRIM(ISNULL(@company_name, N''))) < 2 THROW 50000, N'Indique el nombre de la empresa.', 1;
  IF LEN(LTRIM(ISNULL(@contact_name, N''))) < 3 THROW 50000, N'Indique el nombre de contacto.', 1;
  IF @mail NOT LIKE N'%_@_%._%' OR @mail LIKE N'% %' THROW 50000, N'El correo no es válido.', 1;

  INSERT INTO dbo.access_requests (company_name, tax_id, contact_name, email, phone, plan_code, message, created_at)
  VALUES (LTRIM(RTRIM(@company_name)), @tax_id, LTRIM(RTRIM(@contact_name)), @mail, NULLIF(LTRIM(RTRIM(@phone)), N''),
          NULLIF(@plan_code, N''), NULLIF(LTRIM(RTRIM(@message)), N''), dbo.fn_now());
END
GO

CREATE OR ALTER PROCEDURE api.usp_platform_access_requests
  @user_id  UNIQUEIDENTIFIER,
  @status   NVARCHAR(10) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  EXEC dbo.usp_int_assert_platform_admin @user_id;
  SELECT r.*, p.name AS plan_name, u.email AS reviewed_by_email
    FROM dbo.access_requests r
    LEFT JOIN dbo.plans p ON p.code = r.plan_code
    LEFT JOIN dbo.users u ON u.id = r.reviewed_by
   WHERE @status IS NULL OR r.status = @status
   ORDER BY r.created_at DESC;
END
GO

-- Aprueba la solicitud: crea la empresa (catálogos, suscripción y sucursal) e invita al dueño como ADMIN.
CREATE OR ALTER PROCEDURE api.usp_platform_approve_request
  @user_id     UNIQUEIDENTIFIER,
  @id          UNIQUEIDENTIFIER,
  @plan_code   NVARCHAR(20),
  @trial_days  INT
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @status NVARCHAR(10), @company NVARCHAR(120), @tax_id NVARCHAR(11), @contact NVARCHAR(120),
            @email NVARCHAR(254), @phone NVARCHAR(30), @req_plan NVARCHAR(20), @org_id UNIQUEIDENTIFIER,
            @inv_id UNIQUEIDENTIFIER, @token NVARCHAR(64), @end DATE, @msg NVARCHAR(2048);
    EXEC dbo.usp_int_assert_platform_admin @user_id;

    SELECT @status = status, @company = company_name, @tax_id = tax_id, @contact = contact_name, @email = email,
           @phone = phone, @req_plan = plan_code
      FROM dbo.access_requests WITH (UPDLOCK) WHERE id = @id;
    IF ISNULL(@status, N'') <> N'PENDING' THROW 50000, N'La solicitud no existe o ya fue atendida.', 1;
    IF EXISTS (SELECT 1 FROM dbo.profiles WHERE email = @email)
    BEGIN
      SET @msg = CONCAT(N'El correo ', @email, N' ya tiene una cuenta en el sistema.');
      THROW 50000, @msg, 1;
    END
    IF ISNULL(@trial_days, -1) NOT BETWEEN 0 AND 90 THROW 50000, N'Los días de prueba deben estar entre 0 y 90.', 1;

    SET @end = DATEADD(DAY, @trial_days, dbo.fn_today());
    SET @plan_code = COALESCE(NULLIF(@plan_code, N''), @req_plan, N'BASICO');
    EXEC dbo.usp_int_create_org @company, @tax_id, @phone, @email, @plan_code, N'TRIAL', @end, @org_id OUTPUT;
    EXEC dbo.usp_int_create_invitation @org_id, @email, @contact, N'ADMIN', NULL, @user_id, @inv_id OUTPUT, @token OUTPUT;

    UPDATE dbo.access_requests
       SET status = N'APPROVED', org_id = @org_id, reviewed_by = @user_id, reviewed_at = dbo.fn_now()
     WHERE id = @id;
    COMMIT;
    SELECT @org_id AS org_id, @inv_id AS invitation_id, @email AS email, @contact AS full_name, @token AS token,
           @company AS company_name;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

CREATE OR ALTER PROCEDURE api.usp_platform_reject_request
  @user_id  UNIQUEIDENTIFIER,
  @id       UNIQUEIDENTIFIER,
  @reason   NVARCHAR(500)
AS
BEGIN
  SET NOCOUNT ON;
  EXEC dbo.usp_int_assert_platform_admin @user_id;
  UPDATE dbo.access_requests
     SET status = N'REJECTED', reject_reason = NULLIF(LTRIM(RTRIM(@reason)), N''), reviewed_by = @user_id, reviewed_at = dbo.fn_now()
   WHERE id = @id AND status = N'PENDING';
  IF @@ROWCOUNT = 0 THROW 50000, N'La solicitud no existe o ya fue atendida.', 1;
END
GO

-- Invita a un ADMIN a una empresa existente (p. ej. reemplazo del dueño)
CREATE OR ALTER PROCEDURE api.usp_platform_invite_admin
  @user_id    UNIQUEIDENTIFIER,
  @org_id     UNIQUEIDENTIFIER,
  @email      NVARCHAR(254),
  @full_name  NVARCHAR(150)
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @mail NVARCHAR(254) = LOWER(LTRIM(RTRIM(@email))), @id UNIQUEIDENTIFIER, @token NVARCHAR(64);
    EXEC dbo.usp_int_assert_platform_admin @user_id;
    IF NOT EXISTS (SELECT 1 FROM dbo.organizations WHERE id = @org_id) THROW 50004, N'Empresa no encontrada.', 1;
    IF EXISTS (SELECT 1 FROM dbo.profiles WHERE email = @mail) THROW 50000, N'Ese correo ya tiene una cuenta en el sistema.', 1;
    UPDATE dbo.invitations SET status = N'REVOKED' WHERE email = @mail AND status = N'PENDING';
    IF dbo.fn_org_seats_used(@org_id, NULL) >= dbo.fn_org_seat_limit(@org_id)
      THROW 50000, N'La empresa no tiene cupos libres. Aumente los usuarios adicionales o cambie de plan.', 1;

    EXEC dbo.usp_int_create_invitation @org_id, @mail, @full_name, N'ADMIN', NULL, @user_id, @id OUTPUT, @token OUTPUT;
    COMMIT;
    SELECT i.id, i.email, i.full_name, i.role, i.expires_at, @token AS token, s.company_name
      FROM dbo.invitations i JOIN dbo.settings s ON s.org_id = i.org_id WHERE i.id = @id;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

-- Registra un pago y extiende el periodo. Vigente o en gracia: el nuevo periodo
-- continúa al día siguiente del vencimiento. Prueba o vencida: empieza en la fecha de pago.
CREATE OR ALTER PROCEDURE api.usp_platform_register_payment
  @user_id    UNIQUEIDENTIFIER,
  @org_id     UNIQUEIDENTIFIER,
  @plan_code  NVARCHAR(20),
  @amount     DECIMAL(10, 2),
  @method     NVARCHAR(20),
  @months     INT,
  @paid_at    DATE = NULL,
  @reference  NVARCHAR(100) = NULL
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRY
    BEGIN TRAN;
    DECLARE @status NVARCHAR(20), @period_end DATE, @grace INT, @start DATE, @end DATE;
    EXEC dbo.usp_int_assert_platform_admin @user_id;

    SELECT @status = status, @period_end = current_period_end, @grace = grace_days
      FROM dbo.subscriptions WITH (UPDLOCK) WHERE org_id = @org_id;
    IF @status IS NULL THROW 50004, N'La empresa no tiene suscripción.', 1;

    SET @start = ISNULL(@paid_at, dbo.fn_today());
    IF @status <> N'TRIAL' AND @start <= DATEADD(DAY, @grace, @period_end)
      SET @start = DATEADD(DAY, 1, @period_end);
    SET @end = DATEADD(DAY, -1, DATEADD(MONTH, @months, @start));

    INSERT INTO dbo.subscription_payments (org_id, plan_code, amount, method, reference, months, paid_at, period_start,
                                           period_end, created_by, created_at)
    VALUES (@org_id, @plan_code, @amount, @method, NULLIF(LTRIM(RTRIM(@reference)), N''), @months,
            ISNULL(@paid_at, dbo.fn_today()), @start, @end, @user_id, dbo.fn_now());

    UPDATE dbo.subscriptions SET plan_code = @plan_code, status = N'ACTIVE', current_period_end = @end, updated_at = dbo.fn_now()
     WHERE org_id = @org_id;
    COMMIT;
    SELECT @end AS current_period_end;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO

-- Edición manual: plan, usuarios extra, fecha, gracia, suspender o reactivar
CREATE OR ALTER PROCEDURE api.usp_platform_update_subscription
  @user_id             UNIQUEIDENTIFIER,
  @org_id              UNIQUEIDENTIFIER,
  @plan_code           NVARCHAR(20),
  @status              NVARCHAR(20),
  @extra_users         INT,
  @current_period_end  DATE,
  @grace_days          INT,
  @notes               NVARCHAR(1000)
AS
BEGIN
  SET NOCOUNT ON;
  EXEC dbo.usp_int_assert_platform_admin @user_id;
  UPDATE dbo.subscriptions
     SET plan_code = @plan_code, status = @status, extra_users = @extra_users, current_period_end = @current_period_end,
         grace_days = @grace_days, notes = NULLIF(LTRIM(RTRIM(@notes)), N''), updated_at = dbo.fn_now()
   WHERE org_id = @org_id;
  IF @@ROWCOUNT = 0 THROW 50004, N'La empresa no tiene suscripción.', 1;
END
GO

-- Empresas con su situación de plan y uso
CREATE OR ALTER PROCEDURE api.usp_platform_organizations
  @user_id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  EXEC dbo.usp_int_assert_platform_admin @user_id;
  SELECT o.id AS org_id, ISNULL(st.company_name, o.name) AS name, st.tax_id, st.email, st.phone,
         s.plan_code, p.name AS plan_name, s.status, dbo.fn_org_access_state(o.id) AS state,
         s.current_period_end, DATEDIFF(DAY, dbo.fn_today(), s.current_period_end) AS days_left, s.grace_days,
         s.extra_users, s.notes, dbo.fn_org_seats_used(o.id, NULL) AS seats_used, p.max_users + s.extra_users AS seat_limit,
         dbo.fn_org_branches_used(o.id) AS branches_used, p.max_branches AS branch_limit,
         ow.full_name AS owner_name, ow.email AS owner_email,
         (SELECT MAX(sp.paid_at) FROM dbo.subscription_payments sp WHERE sp.org_id = o.id) AS last_payment_at,
         (SELECT ISNULL(SUM(sp.amount), 0) FROM dbo.subscription_payments sp WHERE sp.org_id = o.id) AS total_paid,
         o.created_at
    FROM dbo.organizations o
    JOIN dbo.subscriptions s ON s.org_id = o.id
    JOIN dbo.plans p ON p.code = s.plan_code
    LEFT JOIN dbo.settings st ON st.org_id = o.id
    OUTER APPLY (SELECT TOP (1) pr.full_name, pr.email FROM dbo.profiles pr
                  WHERE pr.org_id = o.id AND pr.role = N'ADMIN' AND pr.active = 1 ORDER BY pr.created_at) ow
   ORDER BY s.current_period_end;
END
GO

-- Resumen de la plataforma (JSON, misma forma que platform_overview())
CREATE OR ALTER PROCEDURE api.usp_platform_overview
  @user_id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @today DATE = dbo.fn_today(), @month_start DATE, @json NVARCHAR(MAX);
  EXEC dbo.usp_int_assert_platform_admin @user_id;
  SET @month_start = DATEFROMPARTS(YEAR(@today), MONTH(@today), 1);

  SELECT s.org_id, dbo.fn_org_access_state(s.org_id) AS state, p.price_month, p.extra_user_price, s.extra_users
    INTO #orgs
    FROM dbo.subscriptions s JOIN dbo.plans p ON p.code = s.plan_code;

  SET @json = (
    SELECT (SELECT COUNT(*) FROM #orgs) AS total,
           (SELECT COUNT(*) FROM #orgs WHERE state = N'ACTIVE') AS active,
           (SELECT COUNT(*) FROM #orgs WHERE state = N'TRIAL') AS trial,
           (SELECT COUNT(*) FROM #orgs WHERE state = N'GRACE') AS grace,
           (SELECT COUNT(*) FROM #orgs WHERE state = N'EXPIRED') AS expired,
           (SELECT COUNT(*) FROM #orgs WHERE state IN (N'SUSPENDED', N'CANCELLED')) AS suspended,
           (SELECT COUNT(*) FROM dbo.access_requests WHERE status = N'PENDING') AS pending_requests,
           (SELECT COUNT(*) FROM dbo.subscriptions
             WHERE status IN (N'ACTIVE', N'TRIAL') AND current_period_end BETWEEN @today AND DATEADD(DAY, 7, @today)) AS expiring_7_days,
           (SELECT ISNULL(SUM(price_month + ISNULL(extra_user_price, 0) * extra_users), 0)
              FROM #orgs WHERE state IN (N'ACTIVE', N'GRACE')) AS mrr,
           (SELECT ISNULL(SUM(amount), 0) FROM dbo.subscription_payments WHERE paid_at >= @month_start) AS collected_month,
           JSON_QUERY(ISNULL((
             SELECT FORMAT(m.month_start, 'yyyy-MM') AS [month],
                    (SELECT ISNULL(SUM(sp.amount), 0) FROM dbo.subscription_payments sp
                      WHERE sp.paid_at >= m.month_start AND sp.paid_at < DATEADD(MONTH, 1, m.month_start)) AS amount
               FROM (SELECT DATEADD(MONTH, -n, @month_start) AS month_start
                       FROM (VALUES (0), (1), (2), (3), (4), (5), (6), (7), (8), (9), (10), (11)) t(n)) m
              ORDER BY m.month_start
              FOR JSON PATH), N'[]')) AS revenue_by_month
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);

  SELECT @json AS overview;
END
GO

-- Pagos de suscripción: el superadmin ve todos (o de una empresa); el ADMIN de la empresa, los suyos.
CREATE OR ALTER PROCEDURE api.usp_subscription_payments_list
  @user_id  UNIQUEIDENTIFIER,
  @org_id   UNIQUEIDENTIFIER = NULL
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @my_org UNIQUEIDENTIFIER, @role NVARCHAR(20);
  IF dbo.fn_is_platform_admin(@user_id) = 0
  BEGIN
    EXEC dbo.usp_int_ctx @user_id, N'ADMIN', 0, @my_org OUTPUT, @role OUTPUT;
    SET @org_id = @my_org;
  END
  SELECT sp.id, sp.org_id, ISNULL(st.company_name, o.name) AS company_name, sp.plan_code, p.name AS plan_name,
         sp.amount, sp.method, sp.reference, sp.months, sp.paid_at, sp.period_start, sp.period_end, sp.created_at
    FROM dbo.subscription_payments sp
    JOIN dbo.organizations o ON o.id = sp.org_id
    JOIN dbo.plans p ON p.code = sp.plan_code
    LEFT JOIN dbo.settings st ON st.org_id = sp.org_id
   WHERE @org_id IS NULL OR sp.org_id = @org_id
   ORDER BY sp.paid_at DESC;
END
GO

-- Avisos por correo del día (tarea programada de la API):
-- 7, 3, 1 y 0 días antes del vencimiento, al entrar en gracia y al vencer.
CREATE OR ALTER PROCEDURE api.usp_subscription_reminders_due
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @today DATE = dbo.fn_today();
  SELECT s.org_id, ISNULL(st.company_name, o.name) AS company_name, p.name AS plan_name, s.status,
         dbo.fn_org_access_state(s.org_id) AS state, s.current_period_end,
         DATEDIFF(DAY, @today, s.current_period_end) AS days_left, DATEADD(DAY, s.grace_days, s.current_period_end) AS grace_end,
         (SELECT STRING_AGG(pr.email, N',') FROM dbo.profiles pr
           WHERE pr.org_id = s.org_id AND pr.role = N'ADMIN' AND pr.active = 1) AS admin_emails
    FROM dbo.subscriptions s
    JOIN dbo.organizations o ON o.id = s.org_id
    JOIN dbo.plans p ON p.code = s.plan_code
    LEFT JOIN dbo.settings st ON st.org_id = s.org_id
   WHERE s.status IN (N'TRIAL', N'ACTIVE')
     AND (DATEDIFF(DAY, @today, s.current_period_end) IN (7, 3, 1, 0)
          OR @today = DATEADD(DAY, 1, s.current_period_end)
          OR (s.status = N'ACTIVE' AND s.grace_days > 0 AND @today = DATEADD(DAY, s.grace_days + 1, s.current_period_end)));
END
GO

/* =====================================================================
   5. PERMISOS
   La API se conecta con un usuario miembro de orfebreria_api: solo puede
   ejecutar los procedimientos del esquema api. Las tablas y los
   procedimientos internos quedan fuera de su alcance (encadenamiento de
   propiedad: api y dbo pertenecen a dbo).

   Ejemplo (si el hosting permite crear usuarios):
     CREATE USER api_orfebreria WITH PASSWORD = '...';      -- base contenida
     -- o: CREATE USER api_orfebreria FOR LOGIN api_orfebreria;
     ALTER ROLE orfebreria_api ADD MEMBER api_orfebreria;
   ===================================================================== */
IF DATABASE_PRINCIPAL_ID(N'orfebreria_api') IS NULL
  CREATE ROLE orfebreria_api AUTHORIZATION dbo;
GO
GRANT EXECUTE ON SCHEMA::api TO orfebreria_api;
GO

SET NOEXEC OFF;
GO
