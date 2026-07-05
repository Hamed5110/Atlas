SET NOCOUNT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;

SELECT
    r.PolicyRateID,
    r.CompanyID,
    c.CompanyName,
    r.EmployeeID,
    e.EmployeeCode,
    e.FullName,
    r.Department,
    r.EmpGroup,
    r.EffectiveFrom,
    r.EffectiveTo,
    r.MaxPayoutAmount,
    r.CycleDays,
    CAST(r.MaxPayoutAmount / NULLIF(r.CycleDays, 0) AS DECIMAL(12,6)) AS PerDayRate,
    r.IsActive,
    ISNULL(r.IsDeleted, 0) AS IsDeleted,
    ISNULL(r.PolicyStatus, CASE WHEN r.IsActive = 1 AND r.EffectiveTo IS NULL THEN N'active' ELSE N'historical' END) AS PolicyStatus,
    r.DeletedAt,
    r.DeletedBy,
    r.DeleteReason,
    r.ArchivedAt,
    r.DependencySnapshotJson,
    ISNULL(a.AllocationUsageCount, 0) AS AllocationUsageCount,
    ISNULL(al.AuditUsageCount, 0) AS AuditUsageCount,
    ISNULL(ar.ArchiveRows, 0) AS ArchiveRows
FROM dbo.AirfarePolicyRates r
LEFT JOIN dbo.Companies c ON c.CompanyID = r.CompanyID
LEFT JOIN dbo.Employees e ON e.EmployeeID = r.EmployeeID
OUTER APPLY (
    SELECT COUNT_BIG(*) AS AllocationUsageCount
    FROM dbo.Allocations x
    WHERE x.PolicyRateID = r.PolicyRateID
) a
OUTER APPLY (
    SELECT COUNT_BIG(*) AS AuditUsageCount
    FROM dbo.AuditLog x
    WHERE x.EntityType = N'AirfarePolicyRate'
      AND x.EntityID = r.PolicyRateID
) al
OUTER APPLY (
    SELECT COUNT_BIG(*) AS ArchiveRows
    FROM dbo.AirfarePolicyRateArchive x
    WHERE x.PolicyRateID = r.PolicyRateID
) ar
ORDER BY
    r.IsActive DESC,
    ISNULL(r.IsDeleted, 0) ASC,
    r.EffectiveFrom DESC,
    r.PolicyRateID DESC;

SELECT
    fk.name AS ForeignKeyName,
    OBJECT_SCHEMA_NAME(fk.parent_object_id) AS ChildSchema,
    OBJECT_NAME(fk.parent_object_id) AS ChildTable,
    COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS ChildColumn,
    OBJECT_SCHEMA_NAME(fk.referenced_object_id) AS ParentSchema,
    OBJECT_NAME(fk.referenced_object_id) AS ParentTable,
    COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS ParentColumn,
    fk.delete_referential_action_desc AS DeleteAction,
    fk.update_referential_action_desc AS UpdateAction,
    fk.is_disabled AS IsDisabled,
    fk.is_not_trusted AS IsNotTrusted
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
WHERE fk.referenced_object_id = OBJECT_ID(N'dbo.AirfarePolicyRates')
   OR fk.parent_object_id = OBJECT_ID(N'dbo.AirfarePolicyRates')
ORDER BY ChildSchema, ChildTable, ForeignKeyName;

SELECT
    OBJECT_SCHEMA_NAME(i.object_id) AS TableSchema,
    OBJECT_NAME(i.object_id) AS TableName,
    i.name AS IndexName,
    i.type_desc AS IndexType,
    i.filter_definition AS FilterDefinition,
    i.is_disabled AS IsDisabled
FROM sys.indexes i
WHERE i.object_id IN (OBJECT_ID(N'dbo.AirfarePolicyRates'), OBJECT_ID(N'dbo.AirfarePolicyRateArchive'))
  AND i.name IS NOT NULL
ORDER BY TableSchema, TableName, IndexName;
