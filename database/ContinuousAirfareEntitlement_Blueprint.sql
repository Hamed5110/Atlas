SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/*
    ATLAS Continuous Airfare Entitlement Blueprint
    Purpose: replace mandatory Year End close with MSSQL-backed entitlement plans,
             dated transactions, rebuildable balances, and payroll period locks.

    This script is intentionally additive. It does not drop YearEndHistory,
    OpeningBalances, OpeningLoanBalances, or existing allocation tables.
*/

IF OBJECT_ID(N'dbo.EmployeeAirfareEntitlementPlans', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.EmployeeAirfareEntitlementPlans (
        PlanID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_EmployeeAirfareEntitlementPlans PRIMARY KEY,
        PlanCode NVARCHAR(40) NOT NULL CONSTRAINT UQ_EmployeeAirfareEntitlementPlans_Code UNIQUE,
        PlanName NVARCHAR(160) NOT NULL,
        CompanyID INT NULL,
        IsActive BIT NOT NULL CONSTRAINT DF_EmployeeAirfareEntitlementPlans_IsActive DEFAULT (1),
        EffectiveFrom DATE NOT NULL,
        EffectiveTo DATE NULL,
        AccrualRule NVARCHAR(40) NOT NULL,
        AccrualAmount DECIMAL(12,2) NOT NULL CONSTRAINT DF_EmployeeAirfareEntitlementPlans_AccrualAmount DEFAULT (0),
        AccrualFrequency NVARCHAR(40) NOT NULL CONSTRAINT DF_EmployeeAirfareEntitlementPlans_AccrualFrequency DEFAULT (N'monthly'),
        ResetRule NVARCHAR(40) NOT NULL CONSTRAINT DF_EmployeeAirfareEntitlementPlans_ResetRule DEFAULT (N'none'),
        ResetMonth TINYINT NULL,
        ResetDay TINYINT NULL,
        CycleMonths INT NULL,
        CarryOverRule NVARCHAR(40) NOT NULL CONSTRAINT DF_EmployeeAirfareEntitlementPlans_CarryOverRule DEFAULT (N'none'),
        CarryOverCapAmount DECIMAL(12,2) NULL,
        CarryOverExpiryMonths INT NULL,
        PayoutRule NVARCHAR(40) NOT NULL CONSTRAINT DF_EmployeeAirfareEntitlementPlans_PayoutRule DEFAULT (N'none'),
        PayoutMonth TINYINT NULL,
        PayoutDay TINYINT NULL,
        PolicyJSON NVARCHAR(MAX) NULL,
        CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_EmployeeAirfareEntitlementPlans_CreatedAt DEFAULT SYSUTCDATETIME(),
        CreatedBy INT NULL,
        UpdatedAt DATETIME2(0) NULL,
        UpdatedBy INT NULL,
        CONSTRAINT CK_EmployeeAirfareEntitlementPlans_AccrualRule CHECK (AccrualRule IN (N'lump_sum', N'monthly', N'semi_monthly', N'per_pay_period', N'service_month', N'contract_cycle')),
        CONSTRAINT CK_EmployeeAirfareEntitlementPlans_AccrualFrequency CHECK (AccrualFrequency IN (N'annual', N'monthly', N'semi_monthly', N'pay_period', N'contract_cycle')),
        CONSTRAINT CK_EmployeeAirfareEntitlementPlans_ResetRule CHECK (ResetRule IN (N'calendar_year', N'fiscal_year', N'employee_anniversary', N'contract_start', N'none')),
        CONSTRAINT CK_EmployeeAirfareEntitlementPlans_CarryOverRule CHECK (CarryOverRule IN (N'none', N'cap_amount', N'cap_days', N'expire_after_months')),
        CONSTRAINT CK_EmployeeAirfareEntitlementPlans_PayoutRule CHECK (PayoutRule IN (N'none', N'fixed_date', N'termination', N'eligibility_loss', N'manual_approval')),
        CONSTRAINT CK_EmployeeAirfareEntitlementPlans_PolicyJSON CHECK (PolicyJSON IS NULL OR ISJSON(PolicyJSON) = 1)
    );
END;
GO

IF OBJECT_ID(N'dbo.EmployeeAirfarePlanEnrollments', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.EmployeeAirfarePlanEnrollments (
        EnrollmentID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_EmployeeAirfarePlanEnrollments PRIMARY KEY,
        PlanID BIGINT NOT NULL,
        EmployeeID INT NOT NULL,
        CompanyID INT NULL,
        EnrollmentStart DATE NOT NULL,
        EnrollmentEnd DATE NULL,
        Status NVARCHAR(30) NOT NULL CONSTRAINT DF_EmployeeAirfarePlanEnrollments_Status DEFAULT (N'active'),
        EligibilityDate DATE NULL,
        ContractStartDate DATE NULL,
        NextResetDate DATE NULL,
        CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_EmployeeAirfarePlanEnrollments_CreatedAt DEFAULT SYSUTCDATETIME(),
        CreatedBy INT NULL,
        UpdatedAt DATETIME2(0) NULL,
        UpdatedBy INT NULL,
        CONSTRAINT FK_EmployeeAirfarePlanEnrollments_Plan FOREIGN KEY (PlanID) REFERENCES dbo.EmployeeAirfareEntitlementPlans(PlanID),
        CONSTRAINT CK_EmployeeAirfarePlanEnrollments_Status CHECK (Status IN (N'active', N'suspended', N'ended'))
    );
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_EmployeeAirfarePlanEnrollments_Employee_Active'
      AND object_id = OBJECT_ID(N'dbo.EmployeeAirfarePlanEnrollments')
)
BEGIN
    CREATE INDEX IX_EmployeeAirfarePlanEnrollments_Employee_Active
        ON dbo.EmployeeAirfarePlanEnrollments(EmployeeID, Status, EnrollmentStart, EnrollmentEnd)
        INCLUDE (PlanID, CompanyID, NextResetDate);
END;
GO

IF OBJECT_ID(N'dbo.EmployeeAirfareTransactions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.EmployeeAirfareTransactions (
        TransactionID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_EmployeeAirfareTransactions PRIMARY KEY,
        PlanID BIGINT NOT NULL,
        EnrollmentID BIGINT NULL,
        EmployeeID INT NOT NULL,
        CompanyID INT NULL,
        TransactionDate DATE NOT NULL,
        FiscalYear INT NOT NULL,
        PeriodCode NVARCHAR(20) NULL,
        TransactionType NVARCHAR(30) NOT NULL,
        Amount DECIMAL(12,2) NOT NULL,
        Days DECIMAL(12,4) NULL,
        SourceModule NVARCHAR(40) NOT NULL,
        SourceID BIGINT NULL,
        SourceHash CHAR(64) NULL,
        PolicySnapshotJSON NVARCHAR(MAX) NULL,
        Description NVARCHAR(400) NULL,
        IsReversal BIT NOT NULL CONSTRAINT DF_EmployeeAirfareTransactions_IsReversal DEFAULT (0),
        ReversesTransactionID BIGINT NULL,
        CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_EmployeeAirfareTransactions_CreatedAt DEFAULT SYSUTCDATETIME(),
        CreatedBy INT NULL,
        CONSTRAINT FK_EmployeeAirfareTransactions_Plan FOREIGN KEY (PlanID) REFERENCES dbo.EmployeeAirfareEntitlementPlans(PlanID),
        CONSTRAINT FK_EmployeeAirfareTransactions_Enrollment FOREIGN KEY (EnrollmentID) REFERENCES dbo.EmployeeAirfarePlanEnrollments(EnrollmentID),
        CONSTRAINT FK_EmployeeAirfareTransactions_Reversal FOREIGN KEY (ReversesTransactionID) REFERENCES dbo.EmployeeAirfareTransactions(TransactionID),
        CONSTRAINT CK_EmployeeAirfareTransactions_Type CHECK (TransactionType IN (N'accrual', N'usage', N'payout', N'adjustment', N'carryover', N'forfeiture', N'reversal')),
        CONSTRAINT CK_EmployeeAirfareTransactions_PolicySnapshotJSON CHECK (PolicySnapshotJSON IS NULL OR ISJSON(PolicySnapshotJSON) = 1)
    );
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_EmployeeAirfareTransactions_AsOf'
      AND object_id = OBJECT_ID(N'dbo.EmployeeAirfareTransactions')
)
BEGIN
    CREATE INDEX IX_EmployeeAirfareTransactions_AsOf
        ON dbo.EmployeeAirfareTransactions(EmployeeID, PlanID, TransactionDate, TransactionType)
        INCLUDE (CompanyID, FiscalYear, PeriodCode, Amount, Days, SourceModule, SourceID, IsReversal);
END;
GO

IF OBJECT_ID(N'dbo.EmployeeAirfareBalances', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.EmployeeAirfareBalances (
        BalanceID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_EmployeeAirfareBalances PRIMARY KEY,
        PlanID BIGINT NOT NULL,
        EmployeeID INT NOT NULL,
        CompanyID INT NULL,
        AsOfDate DATE NOT NULL,
        AccruedAmount DECIMAL(12,2) NOT NULL CONSTRAINT DF_EmployeeAirfareBalances_Accrued DEFAULT (0),
        UsedAmount DECIMAL(12,2) NOT NULL CONSTRAINT DF_EmployeeAirfareBalances_Used DEFAULT (0),
        PayoutAmount DECIMAL(12,2) NOT NULL CONSTRAINT DF_EmployeeAirfareBalances_Payout DEFAULT (0),
        AdjustmentAmount DECIMAL(12,2) NOT NULL CONSTRAINT DF_EmployeeAirfareBalances_Adjustment DEFAULT (0),
        CarryOverAmount DECIMAL(12,2) NOT NULL CONSTRAINT DF_EmployeeAirfareBalances_CarryOver DEFAULT (0),
        ForfeitedAmount DECIMAL(12,2) NOT NULL CONSTRAINT DF_EmployeeAirfareBalances_Forfeited DEFAULT (0),
        RemainingAmount AS (AccruedAmount + CarryOverAmount + AdjustmentAmount - UsedAmount - PayoutAmount - ForfeitedAmount) PERSISTED,
        LastTransactionID BIGINT NULL,
        LastRebuiltAt DATETIME2(0) NOT NULL CONSTRAINT DF_EmployeeAirfareBalances_LastRebuiltAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_EmployeeAirfareBalances UNIQUE (PlanID, EmployeeID, AsOfDate),
        CONSTRAINT FK_EmployeeAirfareBalances_Plan FOREIGN KEY (PlanID) REFERENCES dbo.EmployeeAirfareEntitlementPlans(PlanID)
    );
END;
GO

IF OBJECT_ID(N'dbo.PayrollPeriodLocks', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.PayrollPeriodLocks (
        PeriodLockID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PayrollPeriodLocks PRIMARY KEY,
        CompanyID INT NULL,
        FiscalYear INT NOT NULL,
        PeriodCode NVARCHAR(20) NOT NULL,
        PeriodStart DATE NOT NULL,
        PeriodEnd DATE NOT NULL,
        LockScope NVARCHAR(40) NOT NULL CONSTRAINT DF_PayrollPeriodLocks_LockScope DEFAULT (N'airfare'),
        Status NVARCHAR(20) NOT NULL CONSTRAINT DF_PayrollPeriodLocks_Status DEFAULT (N'locked'),
        LockReason NVARCHAR(400) NULL,
        LockedAt DATETIME2(0) NOT NULL CONSTRAINT DF_PayrollPeriodLocks_LockedAt DEFAULT SYSUTCDATETIME(),
        LockedBy INT NULL,
        UnlockedAt DATETIME2(0) NULL,
        UnlockedBy INT NULL,
        UnlockReason NVARCHAR(400) NULL,
        CONSTRAINT UQ_PayrollPeriodLocks UNIQUE (CompanyID, FiscalYear, PeriodCode, LockScope),
        CONSTRAINT CK_PayrollPeriodLocks_Status CHECK (Status IN (N'locked', N'unlocked'))
    );
END;
GO

CREATE OR ALTER VIEW dbo.vw_ATLAS_AirfareEntitlementBalanceAsOf
AS
SELECT
    t.EmployeeID,
    t.CompanyID,
    t.PlanID,
    MAX(p.PlanName) AS PlanName,
    MAX(t.TransactionDate) AS LastTransactionDate,
    CAST(SUM(CASE WHEN t.TransactionType = N'accrual' THEN t.Amount ELSE 0 END) AS DECIMAL(12,2)) AS AccruedAmount,
    CAST(SUM(CASE WHEN t.TransactionType = N'usage' THEN t.Amount ELSE 0 END) AS DECIMAL(12,2)) AS UsedAmount,
    CAST(SUM(CASE WHEN t.TransactionType = N'payout' THEN t.Amount ELSE 0 END) AS DECIMAL(12,2)) AS PayoutAmount,
    CAST(SUM(CASE WHEN t.TransactionType = N'adjustment' THEN t.Amount ELSE 0 END) AS DECIMAL(12,2)) AS AdjustmentAmount,
    CAST(SUM(CASE WHEN t.TransactionType = N'carryover' THEN t.Amount ELSE 0 END) AS DECIMAL(12,2)) AS CarryOverAmount,
    CAST(SUM(CASE WHEN t.TransactionType = N'forfeiture' THEN t.Amount ELSE 0 END) AS DECIMAL(12,2)) AS ForfeitedAmount,
    CAST(SUM(CASE
        WHEN t.TransactionType IN (N'accrual', N'adjustment', N'carryover') THEN t.Amount
        WHEN t.TransactionType IN (N'usage', N'payout', N'forfeiture') THEN -t.Amount
        WHEN t.TransactionType = N'reversal' THEN t.Amount
        ELSE 0
    END) AS DECIMAL(12,2)) AS RemainingAmount
FROM dbo.EmployeeAirfareTransactions t
JOIN dbo.EmployeeAirfareEntitlementPlans p ON p.PlanID = t.PlanID
GROUP BY t.EmployeeID, t.CompanyID, t.PlanID;
GO

CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_GetAirfareEntitlementBalance
    @EmployeeID INT = NULL,
    @CompanyID INT = NULL,
    @AsOfDate DATE
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        t.EmployeeID,
        t.CompanyID,
        t.PlanID,
        MAX(p.PlanName) AS PlanName,
        @AsOfDate AS AsOfDate,
        CAST(SUM(CASE WHEN t.TransactionType = N'accrual' THEN t.Amount ELSE 0 END) AS DECIMAL(12,2)) AS AccruedAmount,
        CAST(SUM(CASE WHEN t.TransactionType = N'usage' THEN t.Amount ELSE 0 END) AS DECIMAL(12,2)) AS UsedAmount,
        CAST(SUM(CASE WHEN t.TransactionType = N'payout' THEN t.Amount ELSE 0 END) AS DECIMAL(12,2)) AS PayoutAmount,
        CAST(SUM(CASE WHEN t.TransactionType = N'adjustment' THEN t.Amount ELSE 0 END) AS DECIMAL(12,2)) AS AdjustmentAmount,
        CAST(SUM(CASE WHEN t.TransactionType = N'carryover' THEN t.Amount ELSE 0 END) AS DECIMAL(12,2)) AS CarryOverAmount,
        CAST(SUM(CASE WHEN t.TransactionType = N'forfeiture' THEN t.Amount ELSE 0 END) AS DECIMAL(12,2)) AS ForfeitedAmount,
        CAST(SUM(CASE
            WHEN t.TransactionType IN (N'accrual', N'adjustment', N'carryover') THEN t.Amount
            WHEN t.TransactionType IN (N'usage', N'payout', N'forfeiture') THEN -t.Amount
            WHEN t.TransactionType = N'reversal' THEN t.Amount
            ELSE 0
        END) AS DECIMAL(12,2)) AS RemainingAmount
    FROM dbo.EmployeeAirfareTransactions t
    JOIN dbo.EmployeeAirfareEntitlementPlans p ON p.PlanID = t.PlanID
    WHERE t.TransactionDate <= @AsOfDate
      AND (@EmployeeID IS NULL OR t.EmployeeID = @EmployeeID)
      AND (@CompanyID IS NULL OR t.CompanyID = @CompanyID)
    GROUP BY t.EmployeeID, t.CompanyID, t.PlanID
    ORDER BY t.EmployeeID, t.PlanID;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_PreviewAirfareEntitlementReset
    @CompanyID INT = NULL,
    @ResetDate DATE
AS
BEGIN
    SET NOCOUNT ON;

    ;WITH CurrentBalance AS (
        SELECT
            t.EmployeeID,
            t.CompanyID,
            t.PlanID,
            SUM(CASE
                WHEN t.TransactionType IN (N'accrual', N'adjustment', N'carryover') THEN t.Amount
                WHEN t.TransactionType IN (N'usage', N'payout', N'forfeiture') THEN -t.Amount
                WHEN t.TransactionType = N'reversal' THEN t.Amount
                ELSE 0
            END) AS RemainingAmount
        FROM dbo.EmployeeAirfareTransactions t
        WHERE t.TransactionDate <= @ResetDate
          AND (@CompanyID IS NULL OR t.CompanyID = @CompanyID)
        GROUP BY t.EmployeeID, t.CompanyID, t.PlanID
    )
    SELECT
        b.EmployeeID,
        b.CompanyID,
        b.PlanID,
        p.PlanName,
        @ResetDate AS ResetDate,
        CAST(b.RemainingAmount AS DECIMAL(12,2)) AS CurrentRemainingAmount,
        CAST(CASE
            WHEN p.CarryOverRule = N'cap_amount' THEN
                CASE WHEN b.RemainingAmount > ISNULL(p.CarryOverCapAmount, 0) THEN ISNULL(p.CarryOverCapAmount, 0) ELSE b.RemainingAmount END
            WHEN p.CarryOverRule IN (N'none') THEN 0
            ELSE b.RemainingAmount
        END AS DECIMAL(12,2)) AS CarryOverAmount,
        CAST(CASE
            WHEN p.CarryOverRule = N'cap_amount' AND b.RemainingAmount > ISNULL(p.CarryOverCapAmount, 0) THEN b.RemainingAmount - ISNULL(p.CarryOverCapAmount, 0)
            WHEN p.CarryOverRule = N'none' THEN b.RemainingAmount
            ELSE 0
        END AS DECIMAL(12,2)) AS ForfeitureAmount
    FROM CurrentBalance b
    JOIN dbo.EmployeeAirfareEntitlementPlans p ON p.PlanID = b.PlanID
    WHERE p.IsActive = 1
    ORDER BY b.EmployeeID, b.PlanID;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_ApplyAirfareTransaction
    @PlanID BIGINT,
    @EnrollmentID BIGINT = NULL,
    @EmployeeID INT,
    @CompanyID INT = NULL,
    @TransactionDate DATE,
    @FiscalYear INT,
    @PeriodCode NVARCHAR(20) = NULL,
    @TransactionType NVARCHAR(30),
    @Amount DECIMAL(12,2),
    @Days DECIMAL(12,4) = NULL,
    @SourceModule NVARCHAR(40),
    @SourceID BIGINT = NULL,
    @PolicySnapshotJSON NVARCHAR(MAX) = NULL,
    @Description NVARCHAR(400) = NULL,
    @CreatedBy INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @TransactionType NOT IN (N'accrual', N'usage', N'payout', N'adjustment', N'carryover', N'forfeiture', N'reversal')
        THROW 53001, 'Invalid airfare entitlement transaction type.', 1;
    IF @Amount < 0
        THROW 53002, 'Amount must be positive; use transaction type/reversal for direction.', 1;
    IF @PolicySnapshotJSON IS NOT NULL AND ISJSON(@PolicySnapshotJSON) <> 1
        THROW 53003, 'PolicySnapshotJSON must be valid JSON.', 1;

    IF EXISTS (
        SELECT 1
        FROM dbo.PayrollPeriodLocks
        WHERE Status = N'locked'
          AND LockScope = N'airfare'
          AND (@CompanyID IS NULL OR CompanyID IS NULL OR CompanyID = @CompanyID)
          AND @TransactionDate BETWEEN PeriodStart AND PeriodEnd
    )
        THROW 53004, 'The target payroll period is locked for airfare changes.', 1;

    DECLARE @sourceHash CHAR(64) =
        CONVERT(CHAR(64), HASHBYTES('SHA2_256', CONCAT(@SourceModule, '|', ISNULL(CONVERT(NVARCHAR(30), @SourceID), N''), '|', @TransactionType, '|', CONVERT(NVARCHAR(30), @TransactionDate, 126), '|', @EmployeeID, '|', @PlanID)), 2);

    IF @SourceID IS NOT NULL AND EXISTS (
        SELECT 1 FROM dbo.EmployeeAirfareTransactions
        WHERE SourceModule = @SourceModule
          AND SourceID = @SourceID
          AND TransactionType = @TransactionType
          AND IsReversal = 0
    )
    BEGIN
        SELECT TOP (1) * FROM dbo.EmployeeAirfareTransactions
        WHERE SourceModule = @SourceModule
          AND SourceID = @SourceID
          AND TransactionType = @TransactionType
          AND IsReversal = 0
        ORDER BY TransactionID DESC;
        RETURN;
    END;

    INSERT INTO dbo.EmployeeAirfareTransactions (
        PlanID, EnrollmentID, EmployeeID, CompanyID, TransactionDate, FiscalYear, PeriodCode,
        TransactionType, Amount, Days, SourceModule, SourceID, SourceHash, PolicySnapshotJSON,
        Description, CreatedBy
    )
    VALUES (
        @PlanID, @EnrollmentID, @EmployeeID, @CompanyID, @TransactionDate, @FiscalYear, @PeriodCode,
        @TransactionType, @Amount, @Days, @SourceModule, @SourceID, @sourceHash, @PolicySnapshotJSON,
        @Description, @CreatedBy
    );

    SELECT * FROM dbo.EmployeeAirfareTransactions WHERE TransactionID = SCOPE_IDENTITY();
END;
GO

-- Seed one default plan from current ATLAS policy conventions if no plan exists.
IF NOT EXISTS (SELECT 1 FROM dbo.EmployeeAirfareEntitlementPlans WHERE PlanCode = N'CONTINUOUS_AIRFARE_MONTHLY')
BEGIN
    INSERT INTO dbo.EmployeeAirfareEntitlementPlans (
        PlanCode, PlanName, EffectiveFrom, AccrualRule, AccrualAmount, AccrualFrequency,
        ResetRule, ResetMonth, ResetDay, CarryOverRule, CarryOverCapAmount, PayoutRule,
        PolicyJSON
    )
    VALUES (
        N'CONTINUOUS_AIRFARE_MONTHLY',
        N'Continuous Airfare - Monthly Accrual',
        '2026-01-01',
        N'monthly',
        150.00,
        N'monthly',
        N'none',
        NULL,
        NULL,
        N'none',
        0,
        N'manual_approval',
        N'{"source":"ATLAS continuous entitlement blueprint","defaultCurrency":"BHD","model":"on-demand continuous accrual"}'
    );
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
GO
