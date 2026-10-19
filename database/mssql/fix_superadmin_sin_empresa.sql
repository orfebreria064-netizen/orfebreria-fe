/* =====================================================================
   Corrección única: el superadministrador deja de pertenecer a una empresa.

   Antes, el primer usuario creaba "Mi Orfebrería" y quedaba como su ADMIN.
   Ahora el superadministrador solo administra la plataforma (sin perfil
   de empresa). Este script:
     1. Desvincula al superadministrador de los registros de su empresa
        (created_by, assigned_to, etc. quedan en NULL; el historial
        conserva el nombre en texto).
     2. Borra su perfil y sus sucursales asignadas.
   La empresa y todos sus datos se conservan. Si debe seguir operando,
   invite a su nuevo administrador desde Plataforma → «Invitar admin».

   Ejecutar DESPUÉS de orfebreria_mssql.sql. Es idempotente.
   ===================================================================== */
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @email NVARCHAR(254) = N'jjcastilloo79@gmail.com';

DECLARE @user_id UNIQUEIDENTIFIER = (SELECT id FROM dbo.users WHERE email = LOWER(@email));
IF @user_id IS NULL
  THROW 50000, N'No existe un usuario con ese correo.', 1;
IF dbo.fn_is_platform_admin(@user_id) = 0
  THROW 50000, N'Ese usuario no es superadministrador de la plataforma.', 1;
IF NOT EXISTS (SELECT 1 FROM dbo.profiles WHERE id = @user_id)
BEGIN
  PRINT N'El superadministrador ya no tiene perfil de empresa. Nada que hacer.';
  RETURN;
END

DECLARE @org_name NVARCHAR(150) = (SELECT s.company_name FROM dbo.profiles p JOIN dbo.settings s ON s.org_id = p.org_id
                                    WHERE p.id = @user_id);

BEGIN TRAN;

  -- 1) Referencias a su perfil en tablas de negocio → NULL (todas las columnas son opcionales,
  --    salvo user_branches, que se borra en cascada con el perfil).
  DECLARE @sql NVARCHAR(MAX) = N'';
  SELECT @sql += CONCAT(N'UPDATE ', QUOTENAME(SCHEMA_NAME(t.schema_id)), N'.', QUOTENAME(t.name),
                        N' SET ', QUOTENAME(c.name), N' = NULL WHERE ', QUOTENAME(c.name), N' = @uid;', CHAR(10))
    FROM sys.foreign_key_columns fkc
    JOIN sys.foreign_keys fk ON fk.object_id = fkc.constraint_object_id
    JOIN sys.tables t ON t.object_id = fkc.parent_object_id
    JOIN sys.columns c ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id
   WHERE fkc.referenced_object_id = OBJECT_ID(N'dbo.profiles')
     AND fk.delete_referential_action = 0      -- NO ACTION (las de cascada se resuelven solas)
     AND c.is_nullable = 1;
  EXEC sp_executesql @sql, N'@uid UNIQUEIDENTIFIER', @uid = @user_id;

  -- 2) Perfil de empresa (user_branches se borra en cascada)
  DELETE FROM dbo.profiles WHERE id = @user_id;

COMMIT;

PRINT CONCAT(N'Listo: ', @email, N' ya no pertenece a "', @org_name, N'". La empresa y sus datos se conservan.');
IF NOT EXISTS (SELECT 1 FROM dbo.profiles p JOIN dbo.settings s ON s.org_id = p.org_id
                WHERE s.company_name = @org_name AND p.role = N'ADMIN' AND p.active = 1)
  PRINT CONCAT(N'Aviso: "', @org_name, N'" quedó sin administrador. Invítelo desde Plataforma si debe seguir operando.');
GO
