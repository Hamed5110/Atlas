/*
Seed baseline entitlement policies for Atlas Aluminum (idempotent MERGE).
Requires dbo.entitlement_policies from Alembic 0011.
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.entitlement_policies', N'U') IS NOT NULL
BEGIN
    MERGE dbo.entitlement_policies AS target
    USING (VALUES
        (N'AA-GRADE-A', N'Atlas Aluminum Grade A', N'A', N'permanent', 24, CAST(200.0000 AS DECIMAL(19,4)), N'economy', CAST(1 AS BIT), 3),
        (N'AA-GRADE-B', N'Atlas Aluminum Grade B', N'B', N'permanent', 24, CAST(175.0000 AS DECIMAL(19,4)), N'economy', CAST(1 AS BIT), 2),
        (N'AA-GRADE-C', N'Atlas Aluminum Grade C', N'C', N'permanent', 24, CAST(150.0000 AS DECIMAL(19,4)), N'economy', CAST(0 AS BIT), 0),
        (N'AA-GRADE-D', N'Atlas Aluminum Grade D', N'D', N'contract', 24, CAST(150.0000 AS DECIMAL(19,4)), N'economy', CAST(0 AS BIT), 0),
        (N'AA-GRADE-E', N'Atlas Aluminum Grade E', N'E', N'contract', 24, CAST(125.0000 AS DECIMAL(19,4)), N'economy', CAST(0 AS BIT), 0)
    ) AS source (code, name, grade, contract_type, cycle_months, max_payout, travel_class, family_included, dependent_count)
    ON target.code = source.code AND target.deleted_at IS NULL
    WHEN MATCHED THEN
        UPDATE SET
            name = source.name,
            grade = source.grade,
            contract_type = source.contract_type,
            cycle_months = source.cycle_months,
            max_payout = source.max_payout,
            travel_class = source.travel_class,
            family_included = source.family_included,
            dependent_count = source.dependent_count,
            updated_at = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN
        INSERT (
            id, code, name, grade, contract_type, cycle_months, max_payout, travel_class,
            family_included, dependent_count, is_active, effective_from, version, created_at, updated_at
        )
        VALUES (
            CONVERT(NVARCHAR(36), NEWID()),
            source.code, source.name, source.grade, source.contract_type, source.cycle_months,
            source.max_payout, source.travel_class, source.family_included, source.dependent_count,
            1, CAST(N'2026-01-01' AS DATE), 1, SYSUTCDATETIME(), SYSUTCDATETIME()
        );
END;
GO
