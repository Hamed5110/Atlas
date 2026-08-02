:SETVAR CutoverDate "2026-01-01"
:SETVAR CreatedBy "0"

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO

/*
    ATLAS Patch 2.3.89 - Continuous Entitlement Phase 0-1

    SQLCMD mode is required.

    Purpose:
      1. Apply additive continuous airfare entitlement objects.
      2. Seed plans, enrollments, carryover, and usage into new continuous tables only.
      3. Verify object and seed counts.

    Safety:
      - Existing Year End, Opening Balance, Loan, Allocation, and History tables are read only here.
      - This patch does not modify legacy Year End stored procedures.
      - This script is designed to be rerun safely.

    Example:
      sqlcmd -S "." -d "ATLAS" -E -b -i "database\migrations\2026.08.02_patch_2_3_89_continuous_entitlement_phase1.sql" -v CutoverDate="2026-01-01" CreatedBy="0"
*/

PRINT N'Patch 2.3.89: applying continuous airfare entitlement blueprint.';
GO

:r ..\ContinuousAirfareEntitlement_Blueprint.sql
GO

DECLARE @CutoverDate DATE = TRY_CONVERT(DATE, '$(CutoverDate)');
DECLARE @CreatedBy INT = TRY_CONVERT(INT, '$(CreatedBy)');

IF @CutoverDate IS NULL
    THROW 53890, 'Patch 2.3.89 CutoverDate sqlcmd variable must be a valid date.', 1;

DECLARE @FiscalYear INT = YEAR(@CutoverDate);

PRINT CONCAT(N'Patch 2.3.89 seed starting. CutoverDate=', CONVERT(NVARCHAR(10), @CutoverDate, 126), N', FiscalYear=', @FiscalYear);

IF OBJECT_ID(N'dbo.EmployeeAirfareEntitlementPlans', N'U') IS NULL
    THROW 53891, 'EmployeeAirfareEntitlementPlans was not created.', 1;
IF OBJECT_ID(N'dbo.EmployeeAirfarePlanEnrollments', N'U') IS NULL
    THROW 53892, 'EmployeeAirfarePlanEnrollments was not created.', 1;
IF OBJECT_ID(N'dbo.EmployeeAirfareTransactions', N'U') IS NULL
    THROW 53893, 'EmployeeAirfareTransactions was not created.', 1;

DECLARE @HasAirfarePolicyRates BIT = CASE WHEN OBJECT_ID(N'dbo.AirfarePolicyRates', N'U') IS NULL THEN 0 ELSE 1 END;
DECLARE @HasEmployees BIT = CASE WHEN OBJECT_ID(N'dbo.Employees', N'U') IS NULL THEN 0 ELSE 1 END;
DECLARE @HasOpeningBalances BIT = CASE WHEN OBJECT_ID(N'dbo.OpeningBalances', N'U') IS NULL THEN 0 ELSE 1 END;
DECLARE @HasAllocations BIT = CASE WHEN OBJECT_ID(N'dbo.Allocations', N'U') IS NULL THEN 0 ELSE 1 END;

IF @HasAirfarePolicyRates = 1
BEGIN
    INSERT INTO dbo.EmployeeAirfareEntitlementPlans (
        PlanCode,
        PlanName,
        CompanyID,
        EffectiveFrom,
        AccrualRule,
        AccrualAmount,
        AccrualFrequency,
        ResetRule,
        ResetMonth,
        ResetDay,
        CarryOverRule,
        CarryOverCapAmount,
        PayoutRule,
        PolicyJSON,
        CreatedBy
    )
    SELECT
        CONCAT(N'PHASE1_POLICY_', COALESCE(CONVERT(NVARCHAR(20), pr.CompanyID), N'GLOBAL')),
        CONCAT(N'Phase 1 Airfare Policy ', COALESCE(CONVERT(NVARCHAR(20), pr.CompanyID), N'Global')),
        pr.CompanyID,
        @CutoverDate,
        N'lump_sum',
        MAX(COALESCE(pr.MaxPayoutAmount, 0)),
        N'annual',
        N'calendar_year',
        1,
        1,
        N'none',
        0,
        N'manual_approval',
        CONCAT(N'{"source":"Patch 2.3.89 Phase 0-1 seed","cutoverDate":"', CONVERT(NVARCHAR(10), @CutoverDate, 126), N'"}'),
        @CreatedBy
    FROM dbo.AirfarePolicyRates pr
    WHERE ISNULL(pr.IsDeleted, 0) = 0
    GROUP BY pr.CompanyID
    HAVING NOT EXISTS (
        SELECT 1
        FROM dbo.EmployeeAirfareEntitlementPlans existing
        WHERE existing.PlanCode = CONCAT(N'PHASE1_POLICY_', COALESCE(CONVERT(NVARCHAR(20), pr.CompanyID), N'GLOBAL'))
    );
END
ELSE
BEGIN
    PRINT N'Patch 2.3.89 seed notice: dbo.AirfarePolicyRates not found; default blueprint plan only is available.';
END;
GO

DECLARE @CutoverDate DATE = TRY_CONVERT(DATE, '$(CutoverDate)');
DECLARE @CreatedBy INT = TRY_CONVERT(INT, '$(CreatedBy)');

IF OBJECT_ID(N'dbo.Employees', N'U') IS NOT NULL
BEGIN
    IF COL_LENGTH(N'dbo.Employees', N'CompanyID') IS NOT NULL
    BEGIN
        INSERT INTO dbo.EmployeeAirfarePlanEnrollments (
            PlanID,
            EmployeeID,
            CompanyID,
            EnrollmentStart,
            Status,
            EligibilityDate,
            ContractStartDate,
            CreatedBy
        )
        SELECT
            p.PlanID,
            e.EmployeeID,
            p.CompanyID,
            COALESCE(e.JoinDate, @CutoverDate),
            N'active',
            e.JoinDate,
            e.JoinDate,
            @CreatedBy
        FROM dbo.Employees e
        JOIN dbo.EmployeeAirfareEntitlementPlans p
          ON p.IsActive = 1
         AND p.EffectiveFrom <= @CutoverDate
         AND (
              p.CompanyID IS NULL
              OR p.CompanyID = TRY_CONVERT(INT, NULLIF(CONVERT(NVARCHAR(30), e.CompanyID), N''))
         )
        WHERE ISNULL(e.Status, N'active') = N'active'
          AND NOT EXISTS (
              SELECT 1
              FROM dbo.EmployeeAirfarePlanEnrollments existing
              WHERE existing.PlanID = p.PlanID
                AND existing.EmployeeID = e.EmployeeID
                AND existing.Status = N'active'
          );
    END
    ELSE
    BEGIN
        INSERT INTO dbo.EmployeeAirfarePlanEnrollments (
            PlanID,
            EmployeeID,
            CompanyID,
            EnrollmentStart,
            Status,
            EligibilityDate,
            ContractStartDate,
            CreatedBy
        )
        SELECT
            p.PlanID,
            e.EmployeeID,
            p.CompanyID,
            COALESCE(e.JoinDate, @CutoverDate),
            N'active',
            e.JoinDate,
            e.JoinDate,
            @CreatedBy
        FROM dbo.Employees e
        JOIN dbo.EmployeeAirfareEntitlementPlans p
          ON p.IsActive = 1
         AND p.CompanyID IS NULL
         AND p.EffectiveFrom <= @CutoverDate
        WHERE ISNULL(e.Status, N'active') = N'active'
          AND NOT EXISTS (
              SELECT 1
              FROM dbo.EmployeeAirfarePlanEnrollments existing
              WHERE existing.PlanID = p.PlanID
                AND existing.EmployeeID = e.EmployeeID
                AND existing.Status = N'active'
          );

        PRINT N'Patch 2.3.89 seed notice: Employees.CompanyID not found; seeded global-plan enrollments only.';
    END;
END
ELSE
BEGIN
    PRINT N'Patch 2.3.89 seed notice: dbo.Employees not found; enrollment seed skipped.';
END;
GO

DECLARE @CutoverDate DATE = TRY_CONVERT(DATE, '$(CutoverDate)');
DECLARE @FiscalYear INT = YEAR(@CutoverDate);
DECLARE @CreatedBy INT = TRY_CONVERT(INT, '$(CreatedBy)');

IF OBJECT_ID(N'dbo.OpeningBalances', N'U') IS NOT NULL
BEGIN
    INSERT INTO dbo.EmployeeAirfareTransactions (
        PlanID,
        EnrollmentID,
        EmployeeID,
        CompanyID,
        TransactionDate,
        FiscalYear,
        PeriodCode,
        TransactionType,
        Amount,
        Days,
        SourceModule,
        SourceID,
        PolicySnapshotJSON,
        Description,
        CreatedBy
    )
    SELECT
        en.PlanID,
        en.EnrollmentID,
        ob.EmployeeID,
        en.CompanyID,
        @CutoverDate,
        @FiscalYear,
        CONCAT(@FiscalYear, N'-OPEN'),
        N'carryover',
        COALESCE(ob.OpeningBHD, 0),
        ob.OpeningDays,
        N'OpeningBalances',
        ob.OpeningBalanceID,
        CONCAT(N'{"source":"OpeningBalances","patch":"2.3.89","cutoverDate":"', CONVERT(NVARCHAR(10), @CutoverDate, 126), N'"}'),
        N'Patch 2.3.89 legacy opening balance comparison seed',
        @CreatedBy
    FROM dbo.OpeningBalances ob
    JOIN dbo.EmployeeAirfarePlanEnrollments en
      ON en.EmployeeID = ob.EmployeeID
    WHERE ob.BalanceYear = @FiscalYear
      AND COALESCE(ob.OpeningBHD, 0) <> 0
      AND NOT EXISTS (
          SELECT 1
          FROM dbo.EmployeeAirfareTransactions existing
          WHERE existing.SourceModule = N'OpeningBalances'
            AND existing.SourceID = ob.OpeningBalanceID
            AND existing.TransactionType = N'carryover'
            AND existing.IsReversal = 0
      );
END
ELSE
BEGIN
    PRINT N'Patch 2.3.89 seed notice: dbo.OpeningBalances not found; carryover seed skipped.';
END;
GO

DECLARE @CutoverDate DATE = TRY_CONVERT(DATE, '$(CutoverDate)');
DECLARE @FiscalYear INT = YEAR(@CutoverDate);
DECLARE @CreatedBy INT = TRY_CONVERT(INT, '$(CreatedBy)');

IF OBJECT_ID(N'dbo.Allocations', N'U') IS NOT NULL
BEGIN
    INSERT INTO dbo.EmployeeAirfareTransactions (
        PlanID,
        EnrollmentID,
        EmployeeID,
        CompanyID,
        TransactionDate,
        FiscalYear,
        PeriodCode,
        TransactionType,
        Amount,
        SourceModule,
        SourceID,
        PolicySnapshotJSON,
        Description,
        CreatedBy
    )
    SELECT
        en.PlanID,
        en.EnrollmentID,
        a.EmployeeID,
        en.CompanyID,
        COALESCE(a.AllocationDate, DATEFROMPARTS(a.AllocYear, 1, 1)),
        a.AllocYear,
        FORMAT(COALESCE(a.AllocationDate, DATEFROMPARTS(a.AllocYear, 1, 1)), N'yyyy-MM'),
        N'usage',
        COALESCE(a.Entitlement, a.CompanyPaid, 0),
        N'Allocations',
        a.AllocationID,
        CONCAT(N'{"source":"Allocations","patch":"2.3.89","cutoverDate":"', CONVERT(NVARCHAR(10), @CutoverDate, 126), N'"}'),
        N'Patch 2.3.89 legacy allocation comparison seed',
        @CreatedBy
    FROM dbo.Allocations a
    JOIN dbo.EmployeeAirfarePlanEnrollments en
      ON en.EmployeeID = a.EmployeeID
    WHERE a.AllocYear = @FiscalYear
      AND COALESCE(a.Entitlement, a.CompanyPaid, 0) > 0
      AND NOT EXISTS (
          SELECT 1
          FROM dbo.EmployeeAirfareTransactions existing
          WHERE existing.SourceModule = N'Allocations'
            AND existing.SourceID = a.AllocationID
            AND existing.TransactionType = N'usage'
            AND existing.IsReversal = 0
      );
END
ELSE
BEGIN
    PRINT N'Patch 2.3.89 seed notice: dbo.Allocations not found; usage seed skipped.';
END;
GO

SELECT
    OBJECT_ID(N'dbo.EmployeeAirfareEntitlementPlans', N'U') AS HasPlans,
    OBJECT_ID(N'dbo.EmployeeAirfarePlanEnrollments', N'U') AS HasEnrollments,
    OBJECT_ID(N'dbo.EmployeeAirfareTransactions', N'U') AS HasTransactions,
    OBJECT_ID(N'dbo.EmployeeAirfareBalances', N'U') AS HasBalances,
    OBJECT_ID(N'dbo.PayrollPeriodLocks', N'U') AS HasPayrollLocks,
    OBJECT_ID(N'dbo.sp_ATLAS_GetAirfareEntitlementBalance', N'P') AS HasBalanceProc,
    OBJECT_ID(N'dbo.sp_ATLAS_PreviewAirfareEntitlementReset', N'P') AS HasResetPreviewProc,
    OBJECT_ID(N'dbo.sp_ATLAS_ApplyAirfareTransaction', N'P') AS HasApplyTransactionProc;

SELECT
    (SELECT COUNT(*) FROM dbo.EmployeeAirfareEntitlementPlans) AS PlanCount,
    (SELECT COUNT(*) FROM dbo.EmployeeAirfarePlanEnrollments) AS EnrollmentCount,
    (SELECT COUNT(*) FROM dbo.EmployeeAirfareTransactions) AS TransactionCount;
GO

PRINT N'Patch 2.3.89 continuous entitlement Phase 0-1 migration completed.';
GO
