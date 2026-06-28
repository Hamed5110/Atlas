-- Ensure Employee group column can store long pay-group names from payroll import
-- Run this script once against the active ATLAS database after this release.

IF EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE [object_id] = OBJECT_ID(N'dbo.Employees')
      AND [name] = N'EmpGroup'
)
BEGIN
    ALTER TABLE dbo.Employees
    ALTER COLUMN EmpGroup NVARCHAR(80) NULL;
END
