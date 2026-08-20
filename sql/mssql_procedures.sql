/*
HCM Airfare operational SQL objects.
Modeled on ATLAS import-preview and company-reset patterns using OPENJSON staging.
Apply after sql/mssql_schema.sql on SQL Server 2016+.
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;
GO

IF OBJECT_ID(N'airfare.fn_HCM_AirfareAmount', N'FN') IS NOT NULL
    DROP FUNCTION airfare.fn_HCM_AirfareAmount;
GO

CREATE FUNCTION airfare.fn_HCM_AirfareAmount (
    @OpeningDays DECIMAL(10, 4),
    @RateAmount DECIMAL(19, 4),
    @RateDays DECIMAL(10, 4)
)
RETURNS DECIMAL(19, 4)
AS
BEGIN
    DECLARE @payout DECIMAL(19, 4) = CASE WHEN ISNULL(@RateAmount, 0) <= 0 THEN 150 ELSE @RateAmount END;
    DECLARE @days DECIMAL(10, 4) = CASE
        WHEN ISNULL(@OpeningDays, 0) < 0 THEN 0
        WHEN @OpeningDays > 60 THEN 60
        ELSE ISNULL(@OpeningDays, 0)
    END;
    -- ATLAS dbo.fn_ATLAS_AirfareAmount always divides by cycle 60.
    RETURN CAST(ROUND((@payout / 60.0) * @days, 2) AS DECIMAL(19, 4));
END;
GO

IF OBJECT_ID(N'airfare.sp_HCM_PreviewEmployeeImport', N'P') IS NOT NULL
    DROP PROCEDURE airfare.sp_HCM_PreviewEmployeeImport;
GO

CREATE PROCEDURE airfare.sp_HCM_PreviewEmployeeImport
    @RowsJson NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;

    IF ISJSON(@RowsJson) <> 1
        THROW 53001, 'Employee import payload must be valid JSON.', 1;

    ;WITH staged AS (
        SELECT
            COALESCE(x.SourceRow, CONVERT(INT, j.[key]) + 1) AS SourceRow,
            NULLIF(LTRIM(RTRIM(x.code)), '') AS EmployeeCode,
            NULLIF(LTRIM(RTRIM(x.full_name)), '') AS FullName,
            TRY_CONVERT(uniqueidentifier, x.company_id) AS CompanyId,
            TRY_CONVERT(date, x.join_date) AS JoinDate,
            NULLIF(LTRIM(RTRIM(x.department)), '') AS Department,
            NULLIF(LTRIM(RTRIM(x.branch)), '') AS Branch,
            NULLIF(LTRIM(RTRIM(x.email)), '') AS Email
        FROM OPENJSON(@RowsJson) j
        CROSS APPLY OPENJSON(j.[value])
        WITH (
            SourceRow INT '$.row',
            code NVARCHAR(30) '$.code',
            full_name NVARCHAR(200) '$.full_name',
            company_id NVARCHAR(36) '$.company_id',
            join_date NVARCHAR(30) '$.join_date',
            department NVARCHAR(100) '$.department',
            branch NVARCHAR(100) '$.branch',
            email NVARCHAR(320) '$.email'
        ) x
    ),
    ranked AS (
        SELECT
            s.*,
            ROW_NUMBER() OVER (PARTITION BY s.CompanyId, s.EmployeeCode ORDER BY s.SourceRow) AS DuplicateRank
        FROM staged s
    )
    SELECT
        SourceRow,
        EmployeeCode,
        FullName,
        CompanyId,
        JoinDate,
        Department,
        Branch,
        Email,
        CASE
            WHEN EmployeeCode IS NULL OR FullName IS NULL OR CompanyId IS NULL OR JoinDate IS NULL THEN 'ERROR'
            WHEN DuplicateRank > 1 THEN 'ERROR'
            WHEN EXISTS (
                SELECT 1
                FROM airfare.Employees e
                WHERE e.DeletedAt IS NULL
                  AND e.CompanyId = ranked.CompanyId
                  AND e.Code = ranked.EmployeeCode
            ) THEN 'ERROR'
            WHEN NOT EXISTS (
                SELECT 1 FROM airfare.Companies c WHERE c.Id = ranked.CompanyId AND c.DeletedAt IS NULL
            ) THEN 'ERROR'
            ELSE 'READY'
        END AS Severity,
        CASE
            WHEN EmployeeCode IS NULL OR FullName IS NULL THEN 'Missing employee code or name.'
            WHEN CompanyId IS NULL OR JoinDate IS NULL THEN 'Missing company or join date.'
            WHEN DuplicateRank > 1 THEN 'Duplicate employee code inside this Excel file.'
            WHEN EXISTS (
                SELECT 1
                FROM airfare.Employees e
                WHERE e.DeletedAt IS NULL
                  AND e.CompanyId = ranked.CompanyId
                  AND e.Code = ranked.EmployeeCode
            ) THEN 'Duplicate employee code already exists.'
            WHEN NOT EXISTS (
                SELECT 1 FROM airfare.Companies c WHERE c.Id = ranked.CompanyId AND c.DeletedAt IS NULL
            ) THEN 'Company reference does not exist.'
            ELSE 'Ready for import.'
        END AS Message,
        CASE
            WHEN EmployeeCode IS NULL OR FullName IS NULL OR CompanyId IS NULL OR JoinDate IS NULL THEN 0
            WHEN DuplicateRank > 1 THEN 0
            WHEN EXISTS (
                SELECT 1
                FROM airfare.Employees e
                WHERE e.DeletedAt IS NULL
                  AND e.CompanyId = ranked.CompanyId
                  AND e.Code = ranked.EmployeeCode
            ) THEN 0
            WHEN NOT EXISTS (
                SELECT 1 FROM airfare.Companies c WHERE c.Id = ranked.CompanyId AND c.DeletedAt IS NULL
            ) THEN 0
            ELSE 1
        END AS Selected
    FROM ranked
    ORDER BY SourceRow;
END;
GO

IF OBJECT_ID(N'airfare.sp_HCM_PreviewOpeningBalanceImport', N'P') IS NOT NULL
    DROP PROCEDURE airfare.sp_HCM_PreviewOpeningBalanceImport;
GO

CREATE PROCEDURE airfare.sp_HCM_PreviewOpeningBalanceImport
    @RowsJson NVARCHAR(MAX),
    @RateAmount DECIMAL(19, 4) = 150,
    @RateDays DECIMAL(10, 4) = 60
AS
BEGIN
    SET NOCOUNT ON;

    IF ISJSON(@RowsJson) <> 1
        THROW 53101, 'Opening balance import payload must be valid JSON.', 1;

    ;WITH staged AS (
        SELECT
            COALESCE(x.SourceRow, CONVERT(INT, j.[key]) + 1) AS SourceRow,
            NULLIF(LTRIM(RTRIM(x.employee_code)), '') AS EmployeeCode,
            TRY_CONVERT(smallint, x.balance_year) AS BalanceYear,
            TRY_CONVERT(DECIMAL(10, 4), x.opening_days) AS OpeningDays,
            COALESCE(TRY_CONVERT(DECIMAL(10, 4), x.paid_days), 0) AS PaidDays,
            TRY_CONVERT(DECIMAL(19, 4), x.opening_amount) AS OpeningAmount,
            COALESCE(TRY_CONVERT(DECIMAL(19, 4), x.maximum_payout), @RateAmount) AS MaximumPayout
        FROM OPENJSON(@RowsJson) j
        CROSS APPLY OPENJSON(j.[value])
        WITH (
            SourceRow INT '$.row',
            employee_code NVARCHAR(30) '$.employee_code',
            balance_year NVARCHAR(10) '$.balance_year',
            opening_days NVARCHAR(30) '$.opening_days',
            paid_days NVARCHAR(30) '$.paid_days',
            opening_amount NVARCHAR(30) '$.opening_amount',
            maximum_payout NVARCHAR(30) '$.maximum_payout'
        ) x
    ),
    ranked AS (
        SELECT
            s.*,
            e.Id AS EmployeeId,
            e.FullName AS EmployeeName,
            ROW_NUMBER() OVER (PARTITION BY s.EmployeeCode, s.BalanceYear ORDER BY s.SourceRow) AS DuplicateRank
        FROM staged s
        LEFT JOIN airfare.Employees e
            ON e.DeletedAt IS NULL
           AND e.Code = s.EmployeeCode
    )
    SELECT
        SourceRow,
        EmployeeCode,
        EmployeeId,
        EmployeeName,
        BalanceYear,
        OpeningDays,
        PaidDays,
        COALESCE(
            OpeningAmount,
            airfare.fn_HCM_AirfareAmount(OpeningDays, MaximumPayout, @RateDays)
        ) AS OpeningAmount,
        MaximumPayout,
        CASE
            WHEN EmployeeCode IS NULL OR BalanceYear IS NULL OR OpeningDays IS NULL THEN 'ERROR'
            WHEN EmployeeId IS NULL THEN 'ERROR'
            WHEN DuplicateRank > 1 THEN 'ERROR'
            ELSE 'READY'
        END AS Severity,
        CASE
            WHEN EmployeeCode IS NULL THEN 'Employee code is required.'
            WHEN BalanceYear IS NULL OR OpeningDays IS NULL THEN 'Opening year and opening days are required.'
            WHEN EmployeeId IS NULL THEN 'Employee code not found in Employee Master.'
            WHEN DuplicateRank > 1 THEN 'Duplicate employee/year inside this Excel file.'
            ELSE 'Ready for import.'
        END AS Message,
        CASE
            WHEN EmployeeCode IS NULL OR BalanceYear IS NULL OR OpeningDays IS NULL THEN 0
            WHEN EmployeeId IS NULL THEN 0
            WHEN DuplicateRank > 1 THEN 0
            ELSE 1
        END AS Selected,
        CASE
            WHEN EXISTS (
                SELECT 1
                FROM airfare.OpeningBalances ob
                WHERE ob.DeletedAt IS NULL
                  AND ob.EmployeeId = ranked.EmployeeId
                  AND ob.BalanceYear = ranked.BalanceYear
            ) THEN 'UPDATE'
            ELSE 'INSERT'
        END AS ActionName
    FROM ranked
    ORDER BY SourceRow;
END;
GO

IF OBJECT_ID(N'airfare.sp_HCM_EraseOperationalData', N'P') IS NOT NULL
    DROP PROCEDURE airfare.sp_HCM_EraseOperationalData;
GO

CREATE PROCEDURE airfare.sp_HCM_EraseOperationalData
    @Confirm NVARCHAR(40)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @Confirm <> N'ERASE_ALL_DATA'
        THROW 52101, 'Confirmation ERASE_ALL_DATA is required.', 1;

    BEGIN TRANSACTION;

    UPDATE airfare.Users SET EmployeeID = NULL WHERE EmployeeID IS NOT NULL;

    DELETE FROM airfare.LoanPayments;
    DELETE FROM airfare.LoanInstallments;
    DELETE FROM airfare.Loans;
    DELETE FROM airfare.Tickets;
    DELETE FROM airfare.OpeningBalances;
    DELETE FROM airfare.EssRequests;
    DELETE FROM airfare.EntitlementRates;
    DELETE FROM airfare.Attachments;
    DELETE FROM airfare.Preferences;
    DELETE FROM airfare.Employees;
    UPDATE airfare.RefreshTokens SET RevokedAt = SYSUTCDATETIME() WHERE RevokedAt IS NULL;

    COMMIT TRANSACTION;

    SELECT
        'erased' AS Status,
        SYSUTCDATETIME() AS ErasedAt;
END;
GO
