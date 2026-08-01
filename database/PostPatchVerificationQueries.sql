SET NOCOUNT ON;

PRINT 'ATLAS post-patch MSSQL verification';

SELECT
    DB_NAME() AS DatabaseName,
    SYSUTCDATETIME() AS CheckedAtUtc;

SELECT
    OBJECT_ID(N'dbo.UserPreferences', N'U') AS UserPreferencesTable,
    COL_LENGTH(N'dbo.UserPreferences', N'PreferencesJSON') AS PreferencesJsonColumn,
    OBJECT_ID(N'dbo.AirfarePolicyRates', N'U') AS AirfarePolicyRatesTable,
    OBJECT_ID(N'dbo.sp_ATLAS_GetEffectiveAirfarePolicy', N'P') AS EffectiveAirfarePolicyProc,
    OBJECT_ID(N'dbo.Loans', N'U') AS LoansTable,
    OBJECT_ID(N'dbo.LoanHistory', N'U') AS LoanHistoryTable,
    OBJECT_ID(N'dbo.sp_ATLAS_GetLoanRegister', N'P') AS LoanRegisterProc,
    OBJECT_ID(N'dbo.sp_ATLAS_GetLoanSummary', N'P') AS LoanSummaryProc,
    OBJECT_ID(N'dbo.sp_ATLAS_RunMonthlyLoanEMI', N'P') AS RunMonthlyLoanEmiProc,
    OBJECT_ID(N'dbo.sp_ATLAS_SettleLoan', N'P') AS SettleLoanProc,
    OBJECT_ID(N'dbo.sp_ATLAS_DeferLoan', N'P') AS DeferLoanProc,
    OBJECT_ID(N'dbo.sp_ATLAS_RestructureLoanEMI', N'P') AS RestructureLoanProc;

SELECT TOP (50)
    PolicyRateID,
    CompanyID,
    EmployeeID,
    Department,
    EmpGroup,
    EffectiveFrom,
    EffectiveTo,
    MaxPayoutAmount,
    CycleDays,
    PerDayRate,
    IsActive,
    IsDeleted,
    PolicyStatus
FROM dbo.AirfarePolicyRates
ORDER BY IsActive DESC, EffectiveFrom DESC, PolicyRateID DESC;

EXEC dbo.sp_ATLAS_GetEffectiveAirfarePolicy
    @AllocationDate = '2026-08-01',
    @CompanyID = NULL,
    @EmployeeID = NULL;

EXEC dbo.sp_ATLAS_GetLoanRegister @Status = NULL;
EXEC dbo.sp_ATLAS_GetLoanSummary;

SELECT TOP (50)
    l.LoanID,
    l.EmployeeID,
    e.EmployeeCode,
    e.FullName,
    l.OriginalAmount,
    l.RemainingBalance,
    l.EMI,
    l.Tenure,
    l.MonthsPaid,
    l.TotalPaid,
    l.Status,
    l.DeferMonths,
    l.DeferStart,
    l.SettledDate
FROM dbo.Loans l
LEFT JOIN dbo.Employees e ON e.EmployeeID = l.EmployeeID
ORDER BY l.LoanID DESC;

SELECT TOP (20)
    UserID,
    SelectedCompanyID,
    FiscalYear,
    ISJSON(PreferencesJSON) AS IsPreferencesJson,
    JSON_VALUE(PreferencesJSON, '$.schemaVersion') AS PreferencesSchemaVersion,
    JSON_VALUE(PreferencesJSON, '$.appearance.density') AS Density,
    UpdatedAt
FROM dbo.UserPreferences
ORDER BY UpdatedAt DESC;

SELECT TOP (25)
    YearEndID,
    CompanyID,
    ClosedYear,
    NextYear,
    Status,
    EmployeeCount,
    BalancesCarried,
    LoansCarriedForward,
    ClosedAt
FROM dbo.YearEndHistory
ORDER BY ClosedYear DESC, YearEndID DESC;
