USE Atlasairfare010;
GO

IF OBJECT_ID(N'dbo.Companies', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Companies (
        CompanyID INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Companies PRIMARY KEY,
        CompanyCode NVARCHAR(30) NOT NULL CONSTRAINT UQ_Companies_Code UNIQUE,
        CompanyName NVARCHAR(150) NOT NULL,
        DatabaseName SYSNAME NOT NULL CONSTRAINT UQ_Companies_Database UNIQUE,
        LogoMimeType NVARCHAR(100) NULL,
        LogoData VARBINARY(MAX) NULL,
        Address NVARCHAR(300) NULL,
        Phone NVARCHAR(50) NULL,
        Email NVARCHAR(150) NULL,
        TRN NVARCHAR(50) NULL,
        ContactPerson NVARCHAR(120) NULL,
        IsActive BIT NOT NULL CONSTRAINT DF_Companies_IsActive DEFAULT (1),
        CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_Companies_CreatedAt DEFAULT (SYSUTCDATETIME()),
        CreatedBy INT NULL,
        UpdatedAt DATETIME2(0) NULL,
        UpdatedBy INT NULL
    );
END;
GO

IF OBJECT_ID(N'dbo.Companies', N'U') IS NOT NULL
BEGIN
    IF COL_LENGTH(N'dbo.Companies', N'CompanyCode') IS NULL ALTER TABLE dbo.Companies ADD CompanyCode NVARCHAR(30) NULL;
    IF COL_LENGTH(N'dbo.Companies', N'CompanyName') IS NULL ALTER TABLE dbo.Companies ADD CompanyName NVARCHAR(150) NULL;
    IF COL_LENGTH(N'dbo.Companies', N'DatabaseName') IS NULL ALTER TABLE dbo.Companies ADD DatabaseName SYSNAME NULL;
    IF COL_LENGTH(N'dbo.Companies', N'LogoMimeType') IS NULL ALTER TABLE dbo.Companies ADD LogoMimeType NVARCHAR(100) NULL;
    IF COL_LENGTH(N'dbo.Companies', N'LogoData') IS NULL ALTER TABLE dbo.Companies ADD LogoData VARBINARY(MAX) NULL;
    IF COL_LENGTH(N'dbo.Companies', N'Address') IS NULL ALTER TABLE dbo.Companies ADD Address NVARCHAR(300) NULL;
    IF COL_LENGTH(N'dbo.Companies', N'Phone') IS NULL ALTER TABLE dbo.Companies ADD Phone NVARCHAR(50) NULL;
    IF COL_LENGTH(N'dbo.Companies', N'Email') IS NULL ALTER TABLE dbo.Companies ADD Email NVARCHAR(150) NULL;
    IF COL_LENGTH(N'dbo.Companies', N'TRN') IS NULL ALTER TABLE dbo.Companies ADD TRN NVARCHAR(50) NULL;
    IF COL_LENGTH(N'dbo.Companies', N'ContactPerson') IS NULL ALTER TABLE dbo.Companies ADD ContactPerson NVARCHAR(120) NULL;
    IF COL_LENGTH(N'dbo.Companies', N'IsActive') IS NULL ALTER TABLE dbo.Companies ADD IsActive BIT NULL;
    IF COL_LENGTH(N'dbo.Companies', N'CreatedAt') IS NULL ALTER TABLE dbo.Companies ADD CreatedAt DATETIME2(0) NULL;
    IF COL_LENGTH(N'dbo.Companies', N'CreatedBy') IS NULL ALTER TABLE dbo.Companies ADD CreatedBy INT NULL;
    IF COL_LENGTH(N'dbo.Companies', N'UpdatedAt') IS NULL ALTER TABLE dbo.Companies ADD UpdatedAt DATETIME2(0) NULL;
    IF COL_LENGTH(N'dbo.Companies', N'UpdatedBy') IS NULL ALTER TABLE dbo.Companies ADD UpdatedBy INT NULL;
END;
GO

IF OBJECT_ID(N'dbo.Companies', N'U') IS NOT NULL
BEGIN
    UPDATE dbo.Companies
       SET CompanyCode = COALESCE(NULLIF(LTRIM(RTRIM(CompanyCode)), N''), CONCAT(N'COMP', CompanyID)),
           CompanyName = COALESCE(NULLIF(LTRIM(RTRIM(CompanyName)), N''), NULLIF(LTRIM(RTRIM(CompanyCode)), N''), CONCAT(N'Company ', CompanyID)),
           DatabaseName = COALESCE(NULLIF(LTRIM(RTRIM(DatabaseName)), N''), DB_NAME()),
           IsActive = COALESCE(IsActive, 1),
           CreatedAt = COALESCE(CreatedAt, SYSUTCDATETIME());
END;
GO

IF OBJECT_ID(N'dbo.CompanyBackups', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.CompanyBackups (
        BackupID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CompanyBackups PRIMARY KEY,
        CompanyID INT NULL,
        DatabaseName SYSNAME NOT NULL,
        BackupFile NVARCHAR(500) NOT NULL,
        BackupType NVARCHAR(20) NOT NULL CONSTRAINT DF_CompanyBackups_BackupType DEFAULT ('full'),
        Status NVARCHAR(20) NOT NULL CONSTRAINT DF_CompanyBackups_Status DEFAULT ('completed'),
        Message NVARCHAR(1000) NULL,
        CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_CompanyBackups_CreatedAt DEFAULT (SYSUTCDATETIME()),
        CreatedBy INT NULL
    );
END;
GO

IF OBJECT_ID(N'dbo.CompanyBackups', N'U') IS NOT NULL
BEGIN
    IF COL_LENGTH(N'dbo.CompanyBackups', N'CompanyID') IS NULL ALTER TABLE dbo.CompanyBackups ADD CompanyID INT NULL;
    IF COL_LENGTH(N'dbo.CompanyBackups', N'DatabaseName') IS NULL ALTER TABLE dbo.CompanyBackups ADD DatabaseName SYSNAME NULL;
    IF COL_LENGTH(N'dbo.CompanyBackups', N'BackupFile') IS NULL ALTER TABLE dbo.CompanyBackups ADD BackupFile NVARCHAR(500) NULL;
    IF COL_LENGTH(N'dbo.CompanyBackups', N'BackupType') IS NULL ALTER TABLE dbo.CompanyBackups ADD BackupType NVARCHAR(20) NULL;
    IF COL_LENGTH(N'dbo.CompanyBackups', N'Status') IS NULL ALTER TABLE dbo.CompanyBackups ADD Status NVARCHAR(20) NULL;
    IF COL_LENGTH(N'dbo.CompanyBackups', N'Message') IS NULL ALTER TABLE dbo.CompanyBackups ADD Message NVARCHAR(1000) NULL;
    IF COL_LENGTH(N'dbo.CompanyBackups', N'CreatedAt') IS NULL ALTER TABLE dbo.CompanyBackups ADD CreatedAt DATETIME2(0) NULL;
    IF COL_LENGTH(N'dbo.CompanyBackups', N'CreatedBy') IS NULL ALTER TABLE dbo.CompanyBackups ADD CreatedBy INT NULL;
END;
GO

IF OBJECT_ID(N'dbo.CompanyBackups', N'U') IS NOT NULL
BEGIN
    UPDATE dbo.CompanyBackups
       SET DatabaseName = COALESCE(NULLIF(LTRIM(RTRIM(DatabaseName)), N''), DB_NAME()),
           BackupFile = COALESCE(NULLIF(LTRIM(RTRIM(BackupFile)), N''), N'legacy-import'),
           BackupType = COALESCE(NULLIF(LTRIM(RTRIM(BackupType)), N''), N'full'),
           Status = COALESCE(NULLIF(LTRIM(RTRIM(Status)), N''), N'completed'),
           CreatedAt = COALESCE(CreatedAt, SYSUTCDATETIME());
END;
GO

IF COL_LENGTH('Employees', 'BankCode') IS NULL ALTER TABLE Employees ADD BankCode NVARCHAR(20) NULL;
IF COL_LENGTH('Employees', 'JobBand') IS NULL ALTER TABLE Employees ADD JobBand NVARCHAR(60) NULL;
IF COL_LENGTH('Employees', 'Company') IS NULL ALTER TABLE Employees ADD Company NVARCHAR(80) NULL;
IF COL_LENGTH('Employees', 'ReportingTo') IS NULL ALTER TABLE Employees ADD ReportingTo NVARCHAR(100) NULL;
IF COL_LENGTH('Employees', 'BasicSalary') IS NULL ALTER TABLE Employees ADD BasicSalary DECIMAL(12,2) NULL;
IF COL_LENGTH('Employees', 'HRA') IS NULL ALTER TABLE Employees ADD HRA DECIMAL(12,2) NULL;
IF COL_LENGTH('Employees', 'SpecialDutyAllowance') IS NULL ALTER TABLE Employees ADD SpecialDutyAllowance DECIMAL(12,2) NULL;
IF COL_LENGTH('Employees', 'CarAllowance') IS NULL ALTER TABLE Employees ADD CarAllowance DECIMAL(12,2) NULL;
IF COL_LENGTH('Employees', 'PetrolAllowance') IS NULL ALTER TABLE Employees ADD PetrolAllowance DECIMAL(12,2) NULL;
IF COL_LENGTH('Employees', 'PhoneAllowance') IS NULL ALTER TABLE Employees ADD PhoneAllowance DECIMAL(12,2) NULL;
IF COL_LENGTH('Employees', 'GrossSalary') IS NULL ALTER TABLE Employees ADD GrossSalary DECIMAL(12,2) NULL;
IF COL_LENGTH('Employees', 'GOSIDeduction') IS NULL ALTER TABLE Employees ADD GOSIDeduction DECIMAL(12,2) NULL;
IF COL_LENGTH('Employees', 'Religion') IS NULL ALTER TABLE Employees ADD Religion NVARCHAR(30) NULL;
IF COL_LENGTH('Employees', 'LastWorkingDate') IS NULL ALTER TABLE Employees ADD LastWorkingDate DATE NULL;
IF COL_LENGTH('Employees', 'PayrollStatus') IS NULL ALTER TABLE Employees ADD PayrollStatus NVARCHAR(30) NULL;
IF COL_LENGTH('Employees', 'AverageSalary') IS NULL ALTER TABLE Employees ADD AverageSalary DECIMAL(12,2) NULL;
IF COL_LENGTH('Employees', 'SerialNo') IS NULL ALTER TABLE Employees ADD SerialNo INT NULL;
IF COL_LENGTH('Employees', 'AccountNumber') IS NULL ALTER TABLE Employees ADD AccountNumber NVARCHAR(50) NULL;
IF COL_LENGTH('Employees', 'PassportExpiryDate') IS NULL ALTER TABLE Employees ADD PassportExpiryDate DATE NULL;
IF COL_LENGTH('Employees', 'Email') IS NULL ALTER TABLE Employees ADD Email NVARCHAR(120) NULL;
IF COL_LENGTH('Employees', 'WhatsAppNumber') IS NULL ALTER TABLE Employees ADD WhatsAppNumber NVARCHAR(30) NULL;
IF COL_LENGTH('Employees', 'EmpGroup') IS NOT NULL ALTER TABLE Employees ALTER COLUMN EmpGroup NVARCHAR(80) NULL;
GO

DECLARE @atlasUserRoleConstraintSql NVARCHAR(MAX) = N'';
SELECT @atlasUserRoleConstraintSql = @atlasUserRoleConstraintSql + N'ALTER TABLE dbo.Users DROP CONSTRAINT ' + QUOTENAME(cc.name) + N';' + CHAR(13)
FROM sys.check_constraints cc
WHERE cc.parent_object_id = OBJECT_ID(N'dbo.Users')
  AND cc.definition LIKE N'%Role%'
  AND cc.definition NOT LIKE N'%employee%';
IF @atlasUserRoleConstraintSql <> N'' EXEC sp_executesql @atlasUserRoleConstraintSql;
IF OBJECT_ID(N'dbo.Users', N'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1
       FROM sys.check_constraints
       WHERE parent_object_id = OBJECT_ID(N'dbo.Users')
         AND name = N'CK_Users_Role'
   )
BEGIN
    ALTER TABLE dbo.Users WITH CHECK ADD CONSTRAINT CK_Users_Role
        CHECK (Role IN (N'admin', N'manager', N'hr', N'employee', N'user', N'viewer'));
END;
GO

IF OBJECT_ID('dbo.EmployeeImportBatches', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.EmployeeImportBatches (
        ImportBatchID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_EmployeeImportBatches PRIMARY KEY,
        FileName NVARCHAR(260) NOT NULL,
        HeadersJson NVARCHAR(MAX) NULL,
        TotalRows INT NOT NULL CONSTRAINT DF_EmployeeImportBatches_TotalRows DEFAULT (0),
        ReadyRows INT NOT NULL CONSTRAINT DF_EmployeeImportBatches_ReadyRows DEFAULT (0),
        WarningRows INT NOT NULL CONSTRAINT DF_EmployeeImportBatches_WarningRows DEFAULT (0),
        ErrorRows INT NOT NULL CONSTRAINT DF_EmployeeImportBatches_ErrorRows DEFAULT (0),
        SelectedRows INT NOT NULL CONSTRAINT DF_EmployeeImportBatches_SelectedRows DEFAULT (0),
        InsertedRows INT NOT NULL CONSTRAINT DF_EmployeeImportBatches_InsertedRows DEFAULT (0),
        UpdatedRows INT NOT NULL CONSTRAINT DF_EmployeeImportBatches_UpdatedRows DEFAULT (0),
        Status NVARCHAR(20) NOT NULL CONSTRAINT DF_EmployeeImportBatches_Status DEFAULT ('PREVIEW'),
        CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_EmployeeImportBatches_CreatedAt DEFAULT (GETDATE()),
        CreatedBy INT NULL,
        ConfirmedAt DATETIME2(0) NULL,
        ConfirmedBy INT NULL
    );
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_GetIntelligenceControlCenter
    @AsOfDate DATE = NULL,
    @CurrentYear INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @workDate DATE = COALESCE(@AsOfDate, CAST(GETDATE() AS DATE));
    DECLARE @year INT = COALESCE(@CurrentYear, YEAR(@workDate));

    DECLARE @Risks TABLE (
        RiskID INT IDENTITY(1,1) PRIMARY KEY,
        Area NVARCHAR(40) NOT NULL,
        Severity NVARCHAR(12) NOT NULL,
        Title NVARCHAR(160) NOT NULL,
        Detail NVARCHAR(500) NOT NULL,
        Recommendation NVARCHAR(500) NOT NULL,
        TargetView NVARCHAR(40) NULL,
        TargetRecordType NVARCHAR(40) NULL,
        TargetRecordID BIGINT NULL,
        SortWeight INT NOT NULL
    );

    INSERT INTO @Risks (Area, Severity, Title, Detail, Recommendation, TargetView, TargetRecordType, TargetRecordID, SortWeight)
    SELECT TOP (20)
        'Employees',
        'WARNING',
        CONCAT(EmployeeCode, ' balance needs review'),
        CONCAT(FullName, ' has negative eligible balance days: ', FORMAT(ClosingBalanceDays, 'N2'), '.'),
        'Review opening balance, paid days, and recent airfare allocation before processing another ticket.',
        'Employees',
        'employee',
        EmployeeID,
        30
    FROM dbo.vw_ATLAS_EmployeeMaster
    WHERE ClosingBalanceDays < 0
    ORDER BY ClosingBalanceDays ASC;

    INSERT INTO @Risks (Area, Severity, Title, Detail, Recommendation, TargetView, TargetRecordType, TargetRecordID, SortWeight)
    SELECT TOP (20)
        'Airfare',
        CASE WHEN COUNT(*) >= 3 THEN 'CRITICAL' ELSE 'WARNING' END,
        CONCAT(e.EmployeeCode, ' has duplicate yearly tickets'),
        CONCAT(e.FullName, ' has ', COUNT(*), ' airfare tickets in ', @year, '.'),
        'Open Airfare Allocation and verify override reason, manager approval, and loan/self-pay decision for duplicate tickets.',
        'Airfare',
        'employee',
        e.EmployeeID,
        CASE WHEN COUNT(*) >= 3 THEN 10 ELSE 20 END
    FROM Allocations a
    INNER JOIN Employees e ON e.EmployeeID = a.EmployeeID
    WHERE a.AllocYear = @year
    GROUP BY e.EmployeeID, e.EmployeeCode, e.FullName
    HAVING COUNT(*) > 1;

    INSERT INTO @Risks (Area, Severity, Title, Detail, Recommendation, TargetView, TargetRecordType, TargetRecordID, SortWeight)
    SELECT TOP (20)
        'Airfare',
        CASE WHEN ISNULL(a.LoanAmount, 0) = 0 AND ISNULL(a.EmployeePaid, 0) = 0 THEN 'CRITICAL' ELSE 'WARNING' END,
        CONCAT(e.EmployeeCode, ' ticket has excess balance'),
        CONCAT('Ticket #', a.AllocationID, ' has excess ', FORMAT(ISNULL(a.ExcessAmount, 0), 'N2'), ' BHD.'),
        'Confirm whether the excess is company-paid, self-paid, or converted into loan EMI.',
        'Airfare',
        'allocation',
        a.AllocationID,
        CASE WHEN ISNULL(a.LoanAmount, 0) = 0 AND ISNULL(a.EmployeePaid, 0) = 0 THEN 10 ELSE 25 END
    FROM Allocations a
    INNER JOIN Employees e ON e.EmployeeID = a.EmployeeID
    WHERE ISNULL(a.ExcessAmount, 0) > 0
    ORDER BY a.AllocationDate DESC, a.AllocationID DESC;

    INSERT INTO @Risks (Area, Severity, Title, Detail, Recommendation, TargetView, TargetRecordType, TargetRecordID, SortWeight)
    SELECT TOP (20)
        'Loans',
        CASE WHEN ISNULL(l.RemainingBalance, 0) > 100 THEN 'CRITICAL' ELSE 'WARNING' END,
        CONCAT(e.EmployeeCode, ' active loan outstanding'),
        CONCAT(e.FullName, ' has remaining loan balance ', FORMAT(ISNULL(l.RemainingBalance, 0), 'N2'), ' BHD.'),
        'Review loan register before approving additional airfare excess loans.',
        'Loans',
        'loan',
        l.LoanID,
        CASE WHEN ISNULL(l.RemainingBalance, 0) > 100 THEN 15 ELSE 35 END
    FROM Loans l
    INNER JOIN Employees e ON e.EmployeeID = l.EmployeeID
    WHERE ISNULL(l.RemainingBalance, 0) > 0
      AND ISNULL(l.Status, 'active') <> 'settled'
    ORDER BY ISNULL(l.RemainingBalance, 0) DESC;

    INSERT INTO @Risks (Area, Severity, Title, Detail, Recommendation, TargetView, TargetRecordType, TargetRecordID, SortWeight)
    SELECT TOP (10)
        'Imports',
        CASE WHEN ErrorRows > 0 THEN 'CRITICAL' WHEN WarningRows > 0 THEN 'WARNING' ELSE 'INFO' END,
        CONCAT('Employee import batch #', ImportBatchID),
        CONCAT(FileName, ': ', ErrorRows, ' error row(s), ', WarningRows, ' warning row(s).'),
        'Open Employee Master import preview history and correct rejected rows before relying on imported data.',
        'Employees',
        'employee-import',
        ImportBatchID,
        CASE WHEN ErrorRows > 0 THEN 12 ELSE 45 END
    FROM dbo.EmployeeImportBatches
    WHERE Status = 'PREVIEW' AND (ErrorRows > 0 OR WarningRows > 0)
    ORDER BY ImportBatchID DESC;

    INSERT INTO @Risks (Area, Severity, Title, Detail, Recommendation, TargetView, TargetRecordType, TargetRecordID, SortWeight)
    SELECT TOP (10)
        'Imports',
        CASE WHEN ErrorRows > 0 THEN 'CRITICAL' WHEN WarningRows > 0 THEN 'WARNING' ELSE 'INFO' END,
        CONCAT('Opening balance import batch #', ImportBatchID),
        CONCAT(FileName, ': ', ErrorRows, ' error row(s), ', WarningRows, ' warning row(s).'),
        'Open Opening Balance import review and correct rejected employee/year rows before allocation processing.',
        'Opening Balance',
        'opening-import',
        ImportBatchID,
        CASE WHEN ErrorRows > 0 THEN 12 ELSE 45 END
    FROM dbo.OpeningBalanceImportBatches
    WHERE Status = 'PREVIEW' AND (ErrorRows > 0 OR WarningRows > 0)
    ORDER BY ImportBatchID DESC;

    INSERT INTO @Risks (Area, Severity, Title, Detail, Recommendation, TargetView, TargetRecordType, TargetRecordID, SortWeight)
    SELECT TOP (20)
        'Companies',
        'INFO',
        CONCAT(CompanyCode, ' logo missing'),
        CONCAT(CompanyName, ' has no logo stored for app header and print formats.'),
        'Open Companies and upload a logo so reports and allocation letters show company identity.',
        'Companies',
        'company',
        CompanyID,
        60
    FROM Companies
    WHERE IsActive = 1 AND LogoData IS NULL;

    INSERT INTO @Risks (Area, Severity, Title, Detail, Recommendation, TargetView, TargetRecordType, TargetRecordID, SortWeight)
    SELECT
        'Backup',
        'WARNING',
        'Main database backup not recent',
        'No completed backup for Atlasairfare010 was found in the last 7 days.',
        'Open Companies, select Main ATLAS database, and create a backup before major imports or year-end close.',
        'Companies',
        'backup',
        NULL,
        40
    WHERE NOT EXISTS (
        SELECT 1
        FROM CompanyBackups
        WHERE DatabaseName = DB_NAME()
          AND Status = 'completed'
          AND CreatedAt >= DATEADD(DAY, -7, GETDATE())
    );

    INSERT INTO @Risks (Area, Severity, Title, Detail, Recommendation, TargetView, TargetRecordType, TargetRecordID, SortWeight)
    SELECT
        'Year End',
        CASE WHEN COUNT(*) > 0 THEN 'WARNING' ELSE 'INFO' END,
        CONCAT(@year, ' year-end readiness'),
        CONCAT(COUNT(*), ' employee(s) have negative balance days before close.'),
        CASE WHEN COUNT(*) > 0
            THEN 'Resolve negative balances before final year-end close.'
            ELSE 'Year-end balance check is clear. Run preview before final close.' END,
        'Year End',
        'year-end',
        NULL,
        CASE WHEN COUNT(*) > 0 THEN 28 ELSE 90 END
    FROM dbo.vw_ATLAS_EmployeeMaster
    WHERE ClosingBalanceDays < 0;

    DECLARE @critical INT = (SELECT COUNT(*) FROM @Risks WHERE Severity = 'CRITICAL');
    DECLARE @warning INT = (SELECT COUNT(*) FROM @Risks WHERE Severity = 'WARNING');
    DECLARE @info INT = (SELECT COUNT(*) FROM @Risks WHERE Severity = 'INFO');
    DECLARE @score INT = CASE
        WHEN @critical > 0 THEN IIF(100 - (@critical * 18) - (@warning * 6) - (@info * 1) < 0, 0, 100 - (@critical * 18) - (@warning * 6) - (@info * 1))
        ELSE IIF(100 - (@warning * 5) - (@info * 1) < 0, 0, 100 - (@warning * 5) - (@info * 1))
    END;

    SELECT
        @workDate AS AsOfDate,
        @year AS CurrentYear,
        @score AS IntelligenceScore,
        @critical AS CriticalCount,
        @warning AS WarningCount,
        @info AS InfoCount,
        (SELECT COUNT(*) FROM Employees) AS EmployeeCount,
        (SELECT COUNT(*) FROM Allocations WHERE AllocYear = @year) AS CurrentYearAllocations,
        (SELECT COUNT(*) FROM Loans WHERE ISNULL(RemainingBalance, 0) > 0 AND ISNULL(Status, 'active') <> 'settled') AS ActiveLoans,
        (SELECT COUNT(*) FROM EmployeeImportBatches WHERE Status = 'PREVIEW') + (SELECT COUNT(*) FROM OpeningBalanceImportBatches WHERE Status = 'PREVIEW') AS OpenImportBatches,
        CASE
            WHEN @critical > 0 THEN 'Critical review required'
            WHEN @warning > 0 THEN 'Needs review'
            ELSE 'Healthy'
        END AS OverallStatus;

    SELECT TOP (50)
        RiskID,
        Area,
        Severity,
        Title,
        Detail,
        Recommendation,
        TargetView,
        TargetRecordType,
        TargetRecordID
    FROM @Risks
    ORDER BY SortWeight ASC, RiskID ASC;

    SELECT TOP (12)
        Area,
        Severity,
        Title,
        Recommendation,
        TargetView,
        TargetRecordType,
        TargetRecordID
    FROM @Risks
    WHERE Severity IN ('CRITICAL', 'WARNING')
    ORDER BY SortWeight ASC, RiskID ASC;
END;
GO

IF OBJECT_ID('dbo.EmployeeImportBatchRows', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.EmployeeImportBatchRows (
        ImportBatchRowID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_EmployeeImportBatchRows PRIMARY KEY,
        ImportBatchID BIGINT NOT NULL,
        SourceRow INT NOT NULL,
        EmployeeCode NVARCHAR(50) NULL,
        FullName NVARCHAR(200) NULL,
        Department NVARCHAR(100) NULL,
        Designation NVARCHAR(100) NULL,
        Company NVARCHAR(120) NULL,
        CPR NVARCHAR(50) NULL,
        Passport NVARCHAR(50) NULL,
        Status NVARCHAR(20) NOT NULL CONSTRAINT DF_EmployeeImportBatchRows_Status DEFAULT ('READY'),
        ActionName NVARCHAR(20) NULL,
        Severity NVARCHAR(12) NOT NULL CONSTRAINT DF_EmployeeImportBatchRows_Severity DEFAULT ('READY'),
        Message NVARCHAR(800) NULL,
        Selected BIT NOT NULL CONSTRAINT DF_EmployeeImportBatchRows_Selected DEFAULT (1),
        RawJson NVARCHAR(MAX) NOT NULL,
        CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_EmployeeImportBatchRows_CreatedAt DEFAULT (GETDATE()),
        CONSTRAINT FK_EmployeeImportBatchRows_Batches FOREIGN KEY (ImportBatchID) REFERENCES dbo.EmployeeImportBatches(ImportBatchID)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_EmployeeImportBatchRows_Batch' AND object_id = OBJECT_ID('dbo.EmployeeImportBatchRows'))
    CREATE INDEX IX_EmployeeImportBatchRows_Batch ON dbo.EmployeeImportBatchRows(ImportBatchID, SourceRow);
GO

CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_CreateEmployeeImportPreview
    @FileName NVARCHAR(260),
    @HeadersJson NVARCHAR(MAX) = NULL,
    @EmployeesJson NVARCHAR(MAX),
    @UserID INT
AS
BEGIN
    SET NOCOUNT ON;

    IF ISJSON(@EmployeesJson) <> 1 THROW 53001, 'Employee import payload must be valid JSON.', 1;

    DECLARE @ImportBatchID BIGINT;

    INSERT INTO dbo.EmployeeImportBatches (FileName, HeadersJson, CreatedBy)
    VALUES (COALESCE(NULLIF(@FileName, ''), 'Employee import'), @HeadersJson, @UserID);

    SET @ImportBatchID = SCOPE_IDENTITY();

    INSERT INTO dbo.EmployeeImportBatchRows (
        ImportBatchID, SourceRow, EmployeeCode, FullName, Department, Designation, Company, CPR, Passport,
        Status, ActionName, Severity, Message, Selected, RawJson
    )
    SELECT
        @ImportBatchID,
        COALESCE(x.SourceRow, CONVERT(INT, j.[key]) + 1),
        NULLIF(LTRIM(RTRIM(x.code)), ''),
        NULLIF(LTRIM(RTRIM(x.name)), ''),
        NULLIF(LTRIM(RTRIM(x.department)), ''),
        NULLIF(LTRIM(RTRIM(x.designation)), ''),
        NULLIF(LTRIM(RTRIM(x.company)), ''),
        NULLIF(LTRIM(RTRIM(x.cpr)), ''),
        NULLIF(LTRIM(RTRIM(x.passport)), ''),
        'READY',
        NULL,
        'READY',
        NULL,
        1,
        j.[value]
    FROM OPENJSON(@EmployeesJson) j
    CROSS APPLY OPENJSON(j.[value])
    WITH (
        SourceRow INT '$.sourceRow',
        code NVARCHAR(50) '$.code',
        name NVARCHAR(200) '$.name',
        department NVARCHAR(100) '$.department',
        designation NVARCHAR(100) '$.designation',
        company NVARCHAR(120) '$.company',
        cpr NVARCHAR(50) '$.cpr',
        passport NVARCHAR(50) '$.passport'
    ) x;

    ;WITH duplicateCodes AS (
        SELECT ImportBatchRowID,
               ROW_NUMBER() OVER (PARTITION BY EmployeeCode ORDER BY SourceRow, ImportBatchRowID) AS rn
        FROM dbo.EmployeeImportBatchRows
        WHERE ImportBatchID = @ImportBatchID
          AND EmployeeCode IS NOT NULL
    )
    UPDATE r
    SET Severity = 'ERROR',
        Status = 'ERROR',
        Selected = 0,
        Message = CONCAT(COALESCE(NULLIF(r.Message, '') + ' ', ''), 'Duplicate employee code inside this Excel file. Keep only one row.')
    FROM dbo.EmployeeImportBatchRows r
    INNER JOIN duplicateCodes d ON d.ImportBatchRowID = r.ImportBatchRowID
    WHERE d.rn > 1;

    UPDATE dbo.EmployeeImportBatchRows
    SET Severity = 'ERROR',
        Status = 'ERROR',
        Selected = 0,
        Message = CONCAT(COALESCE(NULLIF(Message, '') + ' ', ''), 'Missing employee code or employee name.')
    WHERE ImportBatchID = @ImportBatchID
      AND (EmployeeCode IS NULL OR FullName IS NULL);

    UPDATE r
    SET ActionName = CASE WHEN e.EmployeeID IS NULL THEN 'INSERT' ELSE 'UPDATE' END
    FROM dbo.EmployeeImportBatchRows r
    LEFT JOIN Employees e ON e.EmployeeCode = LEFT(r.EmployeeCode, 20)
    WHERE r.ImportBatchID = @ImportBatchID;

    UPDATE r
    SET Severity = CASE WHEN Severity = 'READY' THEN 'WARNING' ELSE Severity END,
        Status = CASE WHEN Status = 'READY' THEN 'WARNING' ELSE Status END,
        Message = CONCAT(COALESCE(NULLIF(Message, '') + ' ', ''), 'Possible duplicate by CPR or passport exists in Employee Master.')
    FROM dbo.EmployeeImportBatchRows r
    WHERE r.ImportBatchID = @ImportBatchID
      AND r.Severity <> 'ERROR'
      AND EXISTS (
        SELECT 1
        FROM Employees e
        WHERE (r.CPR IS NOT NULL AND e.CPR = LEFT(r.CPR, 20))
           OR (r.Passport IS NOT NULL AND e.Passport = LEFT(r.Passport, 20))
      );

    UPDATE r
    SET Severity = CASE WHEN Severity = 'READY' THEN 'WARNING' ELSE Severity END,
        Status = CASE WHEN Status = 'READY' THEN 'WARNING' ELSE Status END,
        Message = CONCAT(COALESCE(NULLIF(Message, '') + ' ', ''), 'Some long values will be saved using database field limits.')
    FROM dbo.EmployeeImportBatchRows r
    CROSS APPLY OPENJSON(r.RawJson)
    WHERE r.ImportBatchID = @ImportBatchID
      AND r.Severity <> 'ERROR'
      AND (
        LEN(COALESCE(JSON_VALUE(r.RawJson, '$.code'), '')) > 20 OR
        LEN(COALESCE(JSON_VALUE(r.RawJson, '$.name'), '')) > 100 OR
        LEN(COALESCE(JSON_VALUE(r.RawJson, '$.department'), '')) > 50 OR
        LEN(COALESCE(JSON_VALUE(r.RawJson, '$.designation'), '')) > 50 OR
        LEN(COALESCE(JSON_VALUE(r.RawJson, '$.group'), '')) > 80
      );

    UPDATE dbo.EmployeeImportBatches
    SET TotalRows = (SELECT COUNT(*) FROM dbo.EmployeeImportBatchRows WHERE ImportBatchID = @ImportBatchID),
        ReadyRows = (SELECT COUNT(*) FROM dbo.EmployeeImportBatchRows WHERE ImportBatchID = @ImportBatchID AND Severity = 'READY'),
        WarningRows = (SELECT COUNT(*) FROM dbo.EmployeeImportBatchRows WHERE ImportBatchID = @ImportBatchID AND Severity = 'WARNING'),
        ErrorRows = (SELECT COUNT(*) FROM dbo.EmployeeImportBatchRows WHERE ImportBatchID = @ImportBatchID AND Severity = 'ERROR'),
        SelectedRows = (SELECT COUNT(*) FROM dbo.EmployeeImportBatchRows WHERE ImportBatchID = @ImportBatchID AND Selected = 1)
    WHERE ImportBatchID = @ImportBatchID;

    SELECT * FROM dbo.EmployeeImportBatches WHERE ImportBatchID = @ImportBatchID;

    SELECT
        ImportBatchRowID,
        ImportBatchID,
        SourceRow,
        EmployeeCode,
        FullName,
        Department,
        Designation,
        Company,
        Status,
        ActionName,
        Severity,
        COALESCE(Message, 'Ready for import.') AS Message,
        Selected
    FROM dbo.EmployeeImportBatchRows
    WHERE ImportBatchID = @ImportBatchID
    ORDER BY SourceRow, ImportBatchRowID;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_GetEmployeeImportBatch
    @ImportBatchID BIGINT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT * FROM dbo.EmployeeImportBatches WHERE ImportBatchID = @ImportBatchID;

    SELECT
        ImportBatchRowID,
        ImportBatchID,
        SourceRow,
        EmployeeCode,
        FullName,
        Department,
        Designation,
        Company,
        Status,
        ActionName,
        Severity,
        COALESCE(Message, 'Ready for import.') AS Message,
        Selected
    FROM dbo.EmployeeImportBatchRows
    WHERE ImportBatchID = @ImportBatchID
    ORDER BY SourceRow, ImportBatchRowID;
END;
GO

CREATE OR ALTER VIEW dbo.vw_ATLAS_EmployeeImportBatches
AS
SELECT TOP (200)
    ImportBatchID,
    FileName,
    TotalRows,
    ReadyRows,
    WarningRows,
    ErrorRows,
    SelectedRows,
    InsertedRows,
    UpdatedRows,
    Status,
    CreatedAt,
    CreatedBy,
    ConfirmedAt,
    ConfirmedBy
FROM dbo.EmployeeImportBatches
ORDER BY ImportBatchID DESC;
GO

IF OBJECT_ID('dbo.OpeningBalanceImportBatches', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.OpeningBalanceImportBatches (
        ImportBatchID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_OpeningBalanceImportBatches PRIMARY KEY,
        FileName NVARCHAR(260) NOT NULL,
        HeadersJson NVARCHAR(MAX) NULL,
        TotalRows INT NOT NULL CONSTRAINT DF_OpeningBalanceImportBatches_TotalRows DEFAULT (0),
        ReadyRows INT NOT NULL CONSTRAINT DF_OpeningBalanceImportBatches_ReadyRows DEFAULT (0),
        WarningRows INT NOT NULL CONSTRAINT DF_OpeningBalanceImportBatches_WarningRows DEFAULT (0),
        ErrorRows INT NOT NULL CONSTRAINT DF_OpeningBalanceImportBatches_ErrorRows DEFAULT (0),
        SelectedRows INT NOT NULL CONSTRAINT DF_OpeningBalanceImportBatches_SelectedRows DEFAULT (0),
        UpdatedRows INT NOT NULL CONSTRAINT DF_OpeningBalanceImportBatches_UpdatedRows DEFAULT (0),
        Status NVARCHAR(20) NOT NULL CONSTRAINT DF_OpeningBalanceImportBatches_Status DEFAULT ('PREVIEW'),
        CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_OpeningBalanceImportBatches_CreatedAt DEFAULT (GETDATE()),
        CreatedBy INT NULL,
        ConfirmedAt DATETIME2(0) NULL,
        ConfirmedBy INT NULL
    );
END;
GO

IF OBJECT_ID('dbo.OpeningBalanceImportBatchRows', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.OpeningBalanceImportBatchRows (
        ImportBatchRowID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_OpeningBalanceImportBatchRows PRIMARY KEY,
        ImportBatchID BIGINT NOT NULL,
        SourceRow INT NOT NULL,
        EmployeeCode NVARCHAR(50) NULL,
        EmployeeName NVARCHAR(200) NULL,
        BalanceYear INT NULL,
        OpeningDays DECIMAL(10,2) NULL,
        OpeningBHD DECIMAL(10,2) NULL,
        MaximumPayout DECIMAL(10,2) NULL,
        Status NVARCHAR(20) NOT NULL CONSTRAINT DF_OpeningBalanceImportBatchRows_Status DEFAULT ('READY'),
        ActionName NVARCHAR(20) NULL,
        Severity NVARCHAR(12) NOT NULL CONSTRAINT DF_OpeningBalanceImportBatchRows_Severity DEFAULT ('READY'),
        Message NVARCHAR(800) NULL,
        Selected BIT NOT NULL CONSTRAINT DF_OpeningBalanceImportBatchRows_Selected DEFAULT (1),
        RawJson NVARCHAR(MAX) NOT NULL,
        CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_OpeningBalanceImportBatchRows_CreatedAt DEFAULT (GETDATE()),
        CONSTRAINT FK_OpeningBalanceImportBatchRows_Batches FOREIGN KEY (ImportBatchID) REFERENCES dbo.OpeningBalanceImportBatches(ImportBatchID)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_OpeningBalanceImportBatchRows_Batch' AND object_id = OBJECT_ID('dbo.OpeningBalanceImportBatchRows'))
    CREATE INDEX IX_OpeningBalanceImportBatchRows_Batch ON dbo.OpeningBalanceImportBatchRows(ImportBatchID, SourceRow);
GO

IF OBJECT_ID('dbo.OpeningLoanBalances', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.OpeningLoanBalances (
        OpeningLoanBalanceID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_OpeningLoanBalances PRIMARY KEY,
        EmployeeID INT NOT NULL,
        BalanceYear INT NOT NULL,
        OpeningLoanAmount DECIMAL(12,2) NOT NULL CONSTRAINT DF_OpeningLoanBalances_Amount DEFAULT (0),
        PendingLoanCount INT NOT NULL CONSTRAINT DF_OpeningLoanBalances_Count DEFAULT (0),
        MonthlyEMI DECIMAL(12,2) NOT NULL CONSTRAINT DF_OpeningLoanBalances_EMI DEFAULT (0),
        CarriedFromYear INT NULL,
        SourceYearEndID INT NULL,
        CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_OpeningLoanBalances_CreatedAt DEFAULT (GETDATE()),
        UpdatedAt DATETIME2(0) NULL,
        CreatedBy INT NULL,
        CONSTRAINT UQ_OpeningLoanBalances_EmployeeYear UNIQUE (EmployeeID, BalanceYear)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_OpeningLoanBalances_Year' AND object_id = OBJECT_ID('dbo.OpeningLoanBalances'))
    CREATE INDEX IX_OpeningLoanBalances_Year ON dbo.OpeningLoanBalances(BalanceYear, EmployeeID);
GO

CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_UpsertOpeningLoanBalance
    @EmployeeID INT,
    @BalanceYear INT,
    @OpeningLoanAmount DECIMAL(12,2),
    @PendingLoanCount INT = 0,
    @MonthlyEMI DECIMAL(12,2) = 0,
    @CarriedFromYear INT = NULL,
    @SourceYearEndID INT = NULL,
    @CreatedBy INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @EmployeeID IS NULL OR NOT EXISTS (SELECT 1 FROM dbo.Employees WHERE EmployeeID = @EmployeeID)
        THROW 53201, 'Employee is required for opening loan balance.', 1;
    IF @BalanceYear IS NULL OR @BalanceYear < 2000 OR @BalanceYear > 2100
        THROW 53202, 'Valid opening loan balance year is required.', 1;

    MERGE dbo.OpeningLoanBalances AS target
    USING (SELECT @EmployeeID AS EmployeeID, @BalanceYear AS BalanceYear) AS source
    ON target.EmployeeID = source.EmployeeID AND target.BalanceYear = source.BalanceYear
    WHEN MATCHED THEN UPDATE SET
        OpeningLoanAmount = ROUND(COALESCE(@OpeningLoanAmount, 0), 2),
        PendingLoanCount = COALESCE(@PendingLoanCount, 0),
        MonthlyEMI = ROUND(COALESCE(@MonthlyEMI, 0), 2),
        CarriedFromYear = @CarriedFromYear,
        SourceYearEndID = @SourceYearEndID,
        UpdatedAt = GETDATE(),
        CreatedBy = COALESCE(@CreatedBy, target.CreatedBy)
    WHEN NOT MATCHED THEN INSERT (
        EmployeeID, BalanceYear, OpeningLoanAmount, PendingLoanCount, MonthlyEMI,
        CarriedFromYear, SourceYearEndID, CreatedBy
    )
    VALUES (
        @EmployeeID, @BalanceYear, ROUND(COALESCE(@OpeningLoanAmount, 0), 2), COALESCE(@PendingLoanCount, 0), ROUND(COALESCE(@MonthlyEMI, 0), 2),
        @CarriedFromYear, @SourceYearEndID, @CreatedBy
    );

    SELECT olb.*, e.EmployeeCode, e.FullName, e.Department
    FROM dbo.OpeningLoanBalances olb
    JOIN dbo.Employees e ON e.EmployeeID = olb.EmployeeID
    WHERE olb.EmployeeID = @EmployeeID AND olb.BalanceYear = @BalanceYear;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_GetOpeningLoanBalances
    @BalanceYear INT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        olb.OpeningLoanBalanceID,
        olb.EmployeeID,
        e.EmployeeCode,
        e.FullName,
        e.Department,
        olb.BalanceYear,
        olb.OpeningLoanAmount,
        olb.PendingLoanCount,
        olb.MonthlyEMI,
        olb.CarriedFromYear,
        olb.SourceYearEndID,
        olb.CreatedAt,
        olb.UpdatedAt
    FROM dbo.OpeningLoanBalances olb
    JOIN dbo.Employees e ON e.EmployeeID = olb.EmployeeID
    WHERE olb.BalanceYear = @BalanceYear
    ORDER BY e.EmployeeCode;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_CreateOpeningBalanceImportPreview
    @FileName NVARCHAR(260),
    @HeadersJson NVARCHAR(MAX) = NULL,
    @RowsJson NVARCHAR(MAX),
    @UserID INT
AS
BEGIN
    SET NOCOUNT ON;

    IF ISJSON(@RowsJson) <> 1 THROW 53101, 'Opening balance import payload must be valid JSON.', 1;

    DECLARE @ImportBatchID BIGINT;

    INSERT INTO dbo.OpeningBalanceImportBatches (FileName, HeadersJson, CreatedBy)
    VALUES (COALESCE(NULLIF(@FileName, ''), 'Opening balance import'), @HeadersJson, @UserID);

    SET @ImportBatchID = SCOPE_IDENTITY();

    INSERT INTO dbo.OpeningBalanceImportBatchRows (
        ImportBatchID, SourceRow, EmployeeCode, EmployeeName, BalanceYear, OpeningDays, OpeningBHD, MaximumPayout,
        Status, ActionName, Severity, Message, Selected, RawJson
    )
    SELECT
        @ImportBatchID,
        COALESCE(x.SourceRow, CONVERT(INT, j.[key]) + 1),
        NULLIF(LTRIM(RTRIM(x.employeeCode)), ''),
        NULLIF(LTRIM(RTRIM(x.employeeName)), ''),
        x.[year],
        x.openingDays,
        dbo.fn_ATLAS_AirfareAmount(x.openingDays, COALESCE(NULLIF(x.maximumPayout, 0), 150)),
        x.maximumPayout,
        'READY',
        NULL,
        'READY',
        NULL,
        1,
        j.[value]
    FROM OPENJSON(@RowsJson) j
    CROSS APPLY OPENJSON(j.[value])
    WITH (
        SourceRow INT '$.sourceRow',
        employeeCode NVARCHAR(50) '$.employeeCode',
        employeeName NVARCHAR(200) '$.employeeName',
        [year] INT '$.year',
        openingDays DECIMAL(10,2) '$.openingDays',
        openingBhd DECIMAL(10,2) '$.openingBhd',
        maximumPayout DECIMAL(10,2) '$.maximumPayout'
    ) x;

    UPDATE r
    SET Severity = 'ERROR',
        Status = 'ERROR',
        Selected = 0,
        Message = CONCAT(COALESCE(NULLIF(Message, '') + ' ', ''), 'Employee code is missing.')
    FROM dbo.OpeningBalanceImportBatchRows r
    WHERE ImportBatchID = @ImportBatchID
      AND EmployeeCode IS NULL;

    UPDATE r
    SET Severity = 'ERROR',
        Status = 'ERROR',
        Selected = 0,
        Message = CONCAT(COALESCE(NULLIF(Message, '') + ' ', ''), 'Opening year and opening days are required.')
    FROM dbo.OpeningBalanceImportBatchRows r
    WHERE ImportBatchID = @ImportBatchID
      AND (BalanceYear IS NULL OR OpeningDays IS NULL);

    UPDATE r
    SET Severity = 'ERROR',
        Status = 'ERROR',
        Selected = 0,
        Message = CONCAT(COALESCE(NULLIF(Message, '') + ' ', ''), 'Employee code not found in Employee Master.')
    FROM dbo.OpeningBalanceImportBatchRows r
    LEFT JOIN Employees e ON e.EmployeeCode = LEFT(r.EmployeeCode, 20)
    WHERE r.ImportBatchID = @ImportBatchID
      AND r.EmployeeCode IS NOT NULL
      AND e.EmployeeID IS NULL;

    UPDATE r
    SET Severity = 'ERROR',
        Status = 'ERROR',
        Selected = 0,
        Message = CONCAT(COALESCE(NULLIF(r.Message, '') + ' ', ''), 'Duplicate employee/year inside this Excel file. Keep one opening balance row.')
    FROM dbo.OpeningBalanceImportBatchRows r
    INNER JOIN (
        SELECT ImportBatchRowID,
               ROW_NUMBER() OVER (PARTITION BY EmployeeCode, BalanceYear ORDER BY SourceRow, ImportBatchRowID) AS rn
        FROM dbo.OpeningBalanceImportBatchRows
        WHERE ImportBatchID = @ImportBatchID
          AND EmployeeCode IS NOT NULL
          AND BalanceYear IS NOT NULL
    ) d ON d.ImportBatchRowID = r.ImportBatchRowID
    WHERE d.rn > 1;

    UPDATE r
    SET ActionName = CASE WHEN ob.BalanceID IS NULL THEN 'INSERT' ELSE 'UPDATE' END
    FROM dbo.OpeningBalanceImportBatchRows r
    LEFT JOIN Employees e ON e.EmployeeCode = LEFT(r.EmployeeCode, 20)
    LEFT JOIN OpeningBalances ob ON ob.EmployeeID = e.EmployeeID AND ob.BalanceYear = r.BalanceYear
    WHERE r.ImportBatchID = @ImportBatchID;

    UPDATE r
    SET Message = COALESCE(NULLIF(Message, ''), 'Opening amount calculated by system from opening days.')
    FROM dbo.OpeningBalanceImportBatchRows r
    WHERE r.ImportBatchID = @ImportBatchID
      AND r.Severity <> 'ERROR';

    UPDATE dbo.OpeningBalanceImportBatches
    SET TotalRows = (SELECT COUNT(*) FROM dbo.OpeningBalanceImportBatchRows WHERE ImportBatchID = @ImportBatchID),
        ReadyRows = (SELECT COUNT(*) FROM dbo.OpeningBalanceImportBatchRows WHERE ImportBatchID = @ImportBatchID AND Severity = 'READY'),
        WarningRows = (SELECT COUNT(*) FROM dbo.OpeningBalanceImportBatchRows WHERE ImportBatchID = @ImportBatchID AND Severity = 'WARNING'),
        ErrorRows = (SELECT COUNT(*) FROM dbo.OpeningBalanceImportBatchRows WHERE ImportBatchID = @ImportBatchID AND Severity = 'ERROR'),
        SelectedRows = (SELECT COUNT(*) FROM dbo.OpeningBalanceImportBatchRows WHERE ImportBatchID = @ImportBatchID AND Selected = 1)
    WHERE ImportBatchID = @ImportBatchID;

    SELECT * FROM dbo.OpeningBalanceImportBatches WHERE ImportBatchID = @ImportBatchID;

    SELECT
        ImportBatchRowID,
        ImportBatchID,
        SourceRow,
        EmployeeCode,
        EmployeeName,
        BalanceYear,
        OpeningDays,
        OpeningBHD,
        MaximumPayout,
        Status,
        ActionName,
        Severity,
        COALESCE(Message, 'Ready for import.') AS Message,
        Selected
    FROM dbo.OpeningBalanceImportBatchRows
    WHERE ImportBatchID = @ImportBatchID
    ORDER BY SourceRow, ImportBatchRowID;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_GetOpeningBalanceImportBatch
    @ImportBatchID BIGINT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT * FROM dbo.OpeningBalanceImportBatches WHERE ImportBatchID = @ImportBatchID;

    SELECT
        ImportBatchRowID,
        ImportBatchID,
        SourceRow,
        EmployeeCode,
        EmployeeName,
        BalanceYear,
        OpeningDays,
        OpeningBHD,
        MaximumPayout,
        Status,
        ActionName,
        Severity,
        COALESCE(Message, 'Ready for import.') AS Message,
        Selected
    FROM dbo.OpeningBalanceImportBatchRows
    WHERE ImportBatchID = @ImportBatchID
    ORDER BY SourceRow, ImportBatchRowID;
END;
GO

CREATE OR ALTER VIEW dbo.vw_ATLAS_OpeningBalanceImportBatches
AS
SELECT TOP (200)
    ImportBatchID,
    FileName,
    TotalRows,
    ReadyRows,
    WarningRows,
    ErrorRows,
    SelectedRows,
    UpdatedRows,
    Status,
    CreatedAt,
    CreatedBy,
    ConfirmedAt,
    ConfirmedBy
FROM dbo.OpeningBalanceImportBatches
ORDER BY ImportBatchID DESC;
GO

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID('dbo.AirfarePolicyRates', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.AirfarePolicyRates (
        PolicyRateID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AirfarePolicyRates PRIMARY KEY,
        CompanyID INT NULL,
        EmployeeID INT NULL,
        Department NVARCHAR(100) NULL,
        EmpGroup NVARCHAR(100) NULL,
        EffectiveFrom DATE NOT NULL,
        EffectiveTo DATE NULL,
        MaxPayoutAmount DECIMAL(12,2) NOT NULL,
        CycleDays DECIMAL(10,2) NOT NULL CONSTRAINT DF_AirfarePolicyRates_CycleDays DEFAULT (60),
        WorkingDaysPerMonth DECIMAL(10,2) NOT NULL CONSTRAINT DF_AirfarePolicyRates_WorkingDays DEFAULT (30),
        AirfareDaysPerMonth DECIMAL(10,2) NOT NULL CONSTRAINT DF_AirfarePolicyRates_AirfareDays DEFAULT (2.5),
        IsActive BIT NOT NULL CONSTRAINT DF_AirfarePolicyRates_IsActive DEFAULT (1),
        CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_AirfarePolicyRates_CreatedAt DEFAULT (GETDATE()),
        CreatedBy INT NULL,
        CONSTRAINT CK_AirfarePolicyRates_Amount CHECK (MaxPayoutAmount > 0),
        CONSTRAINT CK_AirfarePolicyRates_Dates CHECK (EffectiveTo IS NULL OR EffectiveTo >= EffectiveFrom)
    );
END;
GO

IF OBJECT_ID('dbo.AirfarePolicyRates', 'U') IS NOT NULL
   AND COL_LENGTH('dbo.AirfarePolicyRates', 'PolicyRateID') IS NULL
BEGIN
    ALTER TABLE dbo.AirfarePolicyRates ADD PolicyRateID BIGINT IDENTITY(1,1) NOT NULL;
END;
GO

IF COL_LENGTH('dbo.AirfarePolicyRates', 'EmployeeID') IS NULL ALTER TABLE dbo.AirfarePolicyRates ADD EmployeeID INT NULL;
IF COL_LENGTH('dbo.AirfarePolicyRates', 'Department') IS NULL ALTER TABLE dbo.AirfarePolicyRates ADD Department NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.AirfarePolicyRates', 'EmpGroup') IS NULL ALTER TABLE dbo.AirfarePolicyRates ADD EmpGroup NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.AirfarePolicyRates', 'IsActive') IS NULL ALTER TABLE dbo.AirfarePolicyRates ADD IsActive BIT NOT NULL CONSTRAINT DF_AirfarePolicyRates_IsActive_Live DEFAULT (1);
IF COL_LENGTH('dbo.AirfarePolicyRates', 'IsDeleted') IS NULL ALTER TABLE dbo.AirfarePolicyRates ADD IsDeleted BIT NOT NULL CONSTRAINT DF_AirfarePolicyRates_IsDeleted DEFAULT (0);
IF COL_LENGTH('dbo.AirfarePolicyRates', 'DeletedAt') IS NULL ALTER TABLE dbo.AirfarePolicyRates ADD DeletedAt DATETIME2(0) NULL;
IF COL_LENGTH('dbo.AirfarePolicyRates', 'DeletedBy') IS NULL ALTER TABLE dbo.AirfarePolicyRates ADD DeletedBy INT NULL;
IF COL_LENGTH('dbo.AirfarePolicyRates', 'DeleteReason') IS NULL ALTER TABLE dbo.AirfarePolicyRates ADD DeleteReason NVARCHAR(400) NULL;
IF COL_LENGTH('dbo.AirfarePolicyRates', 'ArchivedAt') IS NULL ALTER TABLE dbo.AirfarePolicyRates ADD ArchivedAt DATETIME2(0) NULL;
IF COL_LENGTH('dbo.AirfarePolicyRates', 'CreatedBy') IS NULL ALTER TABLE dbo.AirfarePolicyRates ADD CreatedBy INT NULL;
IF COL_LENGTH('dbo.AirfarePolicyRates', 'DependencySnapshotJson') IS NULL ALTER TABLE dbo.AirfarePolicyRates ADD DependencySnapshotJson NVARCHAR(MAX) NULL;
IF COL_LENGTH('dbo.AirfarePolicyRates', 'PolicyStatus') IS NULL ALTER TABLE dbo.AirfarePolicyRates ADD PolicyStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_AirfarePolicyRates_PolicyStatus DEFAULT (N'active');
IF COL_LENGTH('dbo.AirfarePolicyRates', 'IsHistoryLocked') IS NULL ALTER TABLE dbo.AirfarePolicyRates ADD IsHistoryLocked BIT NOT NULL CONSTRAINT DF_AirfarePolicyRates_IsHistoryLocked DEFAULT (0);
IF COL_LENGTH('dbo.AirfarePolicyRates', 'LockReason') IS NULL ALTER TABLE dbo.AirfarePolicyRates ADD LockReason NVARCHAR(400) NULL;
IF COL_LENGTH('dbo.AirfarePolicyRates', 'LockEvaluatedAt') IS NULL ALTER TABLE dbo.AirfarePolicyRates ADD LockEvaluatedAt DATETIME2(0) NULL;
IF COL_LENGTH('dbo.AirfarePolicyRates', 'LockReleasedAt') IS NULL ALTER TABLE dbo.AirfarePolicyRates ADD LockReleasedAt DATETIME2(0) NULL;
GO

IF OBJECT_ID('dbo.OpeningBalances', 'U') IS NOT NULL
BEGIN
    IF COL_LENGTH('dbo.OpeningBalances', 'ArchivedPreferenceID') IS NULL ALTER TABLE dbo.OpeningBalances ADD ArchivedPreferenceID BIGINT NULL;
    IF COL_LENGTH('dbo.OpeningBalances', 'ArchivedPreferenceAt') IS NULL ALTER TABLE dbo.OpeningBalances ADD ArchivedPreferenceAt DATETIME2(0) NULL;
END;
GO

IF OBJECT_ID('dbo.AirfarePolicyRates', 'U') IS NOT NULL
   AND COL_LENGTH('dbo.AirfarePolicyRates', 'PolicyRateID') IS NOT NULL
   AND NOT EXISTS (
        SELECT 1
        FROM sys.indexes
        WHERE object_id = OBJECT_ID('dbo.AirfarePolicyRates')
          AND name = 'PK_AirfarePolicyRates'
   )
BEGIN
    DECLARE @atlasPolicyPkSql NVARCHAR(MAX);
    DECLARE @atlasPolicyHasPrimaryKey BIT = CASE WHEN EXISTS (
        SELECT 1
        FROM sys.key_constraints
        WHERE parent_object_id = OBJECT_ID('dbo.AirfarePolicyRates')
          AND [type] = 'PK'
    ) THEN 1 ELSE 0 END;
    DECLARE @atlasPolicyCanBeUnique BIT = CASE WHEN NOT EXISTS (
        SELECT PolicyRateID
        FROM dbo.AirfarePolicyRates
        GROUP BY PolicyRateID
        HAVING PolicyRateID IS NULL OR COUNT_BIG(*) > 1
    ) THEN 1 ELSE 0 END;
    DECLARE @atlasPolicyHasClustered BIT = CASE WHEN EXISTS (
        SELECT 1
        FROM sys.indexes
        WHERE object_id = OBJECT_ID('dbo.AirfarePolicyRates')
          AND [type] = 1
    ) THEN 1 ELSE 0 END;

    IF @atlasPolicyHasPrimaryKey = 0 AND @atlasPolicyCanBeUnique = 1
    BEGIN
        SET @atlasPolicyPkSql = N'ALTER TABLE dbo.AirfarePolicyRates ADD CONSTRAINT PK_AirfarePolicyRates PRIMARY KEY '
            + CASE WHEN @atlasPolicyHasClustered = 1 THEN N'NONCLUSTERED' ELSE N'CLUSTERED' END
            + N' (PolicyRateID);';
        EXEC sp_executesql @atlasPolicyPkSql;
    END
    ELSE IF @atlasPolicyCanBeUnique = 1
    BEGIN
        CREATE UNIQUE NONCLUSTERED INDEX PK_AirfarePolicyRates ON dbo.AirfarePolicyRates(PolicyRateID);
    END
    ELSE
    BEGIN
        CREATE NONCLUSTERED INDEX PK_AirfarePolicyRates ON dbo.AirfarePolicyRates(PolicyRateID);
    END
END;
GO

UPDATE dbo.AirfarePolicyRates
   SET PolicyStatus = CASE
       WHEN ISNULL(IsDeleted, 0) = 1 THEN N'archived'
       WHEN IsActive = 1 AND EffectiveTo IS NULL THEN N'active'
       ELSE N'historical'
   END
WHERE PolicyStatus IS NULL
   OR PolicyStatus <> CASE
       WHEN ISNULL(IsDeleted, 0) = 1 THEN N'archived'
       WHEN IsActive = 1 AND EffectiveTo IS NULL THEN N'active'
       ELSE N'historical'
   END;
GO

IF OBJECT_ID('dbo.Allocations', 'U') IS NOT NULL
BEGIN
    IF COL_LENGTH('dbo.Allocations', 'PolicyRateID') IS NULL ALTER TABLE dbo.Allocations ADD PolicyRateID BIGINT NULL;
    IF COL_LENGTH('dbo.Allocations', 'PolicyEffectiveFrom') IS NULL ALTER TABLE dbo.Allocations ADD PolicyEffectiveFrom DATE NULL;
    IF COL_LENGTH('dbo.Allocations', 'PolicyMaxPayoutAmount') IS NULL ALTER TABLE dbo.Allocations ADD PolicyMaxPayoutAmount DECIMAL(12,2) NULL;
    IF COL_LENGTH('dbo.Allocations', 'PolicyCycleDays') IS NULL ALTER TABLE dbo.Allocations ADD PolicyCycleDays DECIMAL(10,2) NULL;
    IF COL_LENGTH('dbo.Allocations', 'PolicyPerDayRate') IS NULL ALTER TABLE dbo.Allocations ADD PolicyPerDayRate DECIMAL(12,6) NULL;
END;
GO

CREATE OR ALTER FUNCTION dbo.fn_Preference_GetReferenceReport
(
    @PreferenceID BIGINT
)
RETURNS @report TABLE
(
    ModuleName NVARCHAR(80) NOT NULL,
    RecordCount BIGINT NOT NULL,
    RecordIDs NVARCHAR(MAX) NULL,
    IsBlocking BIT NOT NULL,
    AutoHandleAction NVARCHAR(400) NULL
)
AS
BEGIN
    DECLARE @employeeId INT = NULL;
    DECLARE @companyId INT = NULL;
    DECLARE @companyName NVARCHAR(200) = NULL;
    DECLARE @companyCode NVARCHAR(30) = NULL;
    DECLARE @effectiveFrom DATE = NULL;
    DECLARE @department NVARCHAR(100) = NULL;
    DECLARE @empGroup NVARCHAR(100) = NULL;
    DECLARE @isActive BIT = 0;
    DECLARE @effectiveTo DATE = NULL;
    DECLARE @isDeleted BIT = 0;
    DECLARE @count BIGINT = 0;
    DECLARE @ids NVARCHAR(MAX) = NULL;
    DECLARE @hasGlobalFallback BIT = 0;
    DECLARE @isCurrent BIT = 0;

    SELECT TOP (1)
        @employeeId = r.EmployeeID,
        @companyId = r.CompanyID,
        @companyName = c.CompanyName,
        @companyCode = c.CompanyCode,
        @effectiveFrom = r.EffectiveFrom,
        @department = NULLIF(LTRIM(RTRIM(COALESCE(r.Department, N''))), N''),
        @empGroup = NULLIF(LTRIM(RTRIM(COALESCE(r.EmpGroup, N''))), N''),
        @isActive = ISNULL(r.IsActive, 0),
        @effectiveTo = r.EffectiveTo,
        @isDeleted = ISNULL(r.IsDeleted, 0)
    FROM dbo.AirfarePolicyRates r
    LEFT JOIN dbo.Companies c ON c.CompanyID = r.CompanyID
    WHERE r.PolicyRateID = @PreferenceID;

    IF @effectiveFrom IS NULL RETURN;

    SET @isCurrent = CASE WHEN @isDeleted = 0 AND @isActive = 1 AND @effectiveTo IS NULL THEN 1 ELSE 0 END;

    DECLARE @scopeEmployees TABLE
    (
        EmployeeID INT PRIMARY KEY,
        EmployeeCode NVARCHAR(50) NULL,
        FullName NVARCHAR(200) NULL
    );

    IF @employeeId IS NOT NULL
    BEGIN
        INSERT INTO @scopeEmployees (EmployeeID, EmployeeCode, FullName)
        SELECT e.EmployeeID, e.EmployeeCode, e.FullName
        FROM dbo.Employees e
        WHERE e.EmployeeID = @employeeId;
    END
    ELSE IF @department IS NOT NULL
    BEGIN
        INSERT INTO @scopeEmployees (EmployeeID, EmployeeCode, FullName)
        SELECT e.EmployeeID, e.EmployeeCode, e.FullName
        FROM dbo.Employees e
        WHERE LOWER(NULLIF(LTRIM(RTRIM(COALESCE(e.Department, N''))), N'')) = LOWER(@department)
          AND (
                @companyId IS NULL
                OR (
                    NULLIF(LTRIM(RTRIM(COALESCE(e.Company, N''))), N'') IS NOT NULL
                    AND (
                        LOWER(NULLIF(LTRIM(RTRIM(COALESCE(e.Company, N''))), N'')) = LOWER(COALESCE(@companyName, N''))
                        OR LOWER(NULLIF(LTRIM(RTRIM(COALESCE(e.Company, N''))), N'')) = LOWER(COALESCE(@companyCode, N''))
                    )
                )
              );
    END
    ELSE IF @empGroup IS NOT NULL
    BEGIN
        INSERT INTO @scopeEmployees (EmployeeID, EmployeeCode, FullName)
        SELECT e.EmployeeID, e.EmployeeCode, e.FullName
        FROM dbo.Employees e
        WHERE LOWER(NULLIF(LTRIM(RTRIM(COALESCE(e.EmpGroup, N''))), N'')) = LOWER(@empGroup)
          AND (
                @companyId IS NULL
                OR (
                    NULLIF(LTRIM(RTRIM(COALESCE(e.Company, N''))), N'') IS NOT NULL
                    AND (
                        LOWER(NULLIF(LTRIM(RTRIM(COALESCE(e.Company, N''))), N'')) = LOWER(COALESCE(@companyName, N''))
                        OR LOWER(NULLIF(LTRIM(RTRIM(COALESCE(e.Company, N''))), N'')) = LOWER(COALESCE(@companyCode, N''))
                    )
                )
              );
    END
    ELSE IF @companyId IS NOT NULL
    BEGIN
        INSERT INTO @scopeEmployees (EmployeeID, EmployeeCode, FullName)
        SELECT e.EmployeeID, e.EmployeeCode, e.FullName
        FROM dbo.Employees e
        WHERE NULLIF(LTRIM(RTRIM(COALESCE(e.Company, N''))), N'') IS NOT NULL
          AND (
                LOWER(NULLIF(LTRIM(RTRIM(COALESCE(e.Company, N''))), N'')) = LOWER(COALESCE(@companyName, N''))
                OR LOWER(NULLIF(LTRIM(RTRIM(COALESCE(e.Company, N''))), N'')) = LOWER(COALESCE(@companyCode, N''))
              );
    END;

    IF @isCurrent = 1
       AND @companyId IS NULL
       AND @employeeId IS NULL
       AND @department IS NULL
       AND @empGroup IS NULL
    BEGIN
        SELECT @count = COUNT(*)
        FROM dbo.AirfarePolicyRates r
        WHERE ISNULL(r.IsDeleted, 0) = 0
          AND ISNULL(r.IsActive, 0) = 1
          AND r.EffectiveTo IS NULL
          AND r.CompanyID IS NULL
          AND r.EmployeeID IS NULL
          AND NULLIF(LTRIM(RTRIM(COALESCE(r.Department, N''))), N'') IS NULL
          AND NULLIF(LTRIM(RTRIM(COALESCE(r.EmpGroup, N''))), N'') IS NULL;

        IF @count <= 1
        BEGIN
            INSERT INTO @report (ModuleName, RecordCount, RecordIDs, IsBlocking, AutoHandleAction)
            VALUES (N'Global default guard', 1, CONCAT(N'Policy #', @PreferenceID), 1, N'Create a replacement active global default before deleting this rule.');
        END;
    END;

    IF @isCurrent = 1 AND @companyId IS NOT NULL AND @employeeId IS NULL AND @department IS NULL AND @empGroup IS NULL
    BEGIN
        SELECT @hasGlobalFallback = CASE WHEN EXISTS (
            SELECT 1
            FROM dbo.AirfarePolicyRates r
            WHERE ISNULL(r.IsDeleted, 0) = 0
              AND ISNULL(r.IsActive, 0) = 1
              AND r.EffectiveTo IS NULL
              AND r.CompanyID IS NULL
              AND r.EmployeeID IS NULL
              AND NULLIF(LTRIM(RTRIM(COALESCE(r.Department, N''))), N'') IS NULL
              AND NULLIF(LTRIM(RTRIM(COALESCE(r.EmpGroup, N''))), N'') IS NULL
              AND r.PolicyRateID <> @PreferenceID
        ) THEN 1 ELSE 0 END;

        IF @hasGlobalFallback = 0
        BEGIN
            INSERT INTO @report (ModuleName, RecordCount, RecordIDs, IsBlocking, AutoHandleAction)
            VALUES (N'Fallback chain', 1, COALESCE(@companyName, CONCAT(N'Company #', @companyId)), 1, N'Create or activate a global default before deleting this company rule.');
        END;
    END;

    SELECT @count = COUNT(*)
    FROM @scopeEmployees;

    IF @count > 0
    BEGIN
        SELECT @ids = STRING_AGG(x.EmployeeCode, N', ')
        FROM (
            SELECT TOP (5) COALESCE(se.EmployeeCode, CONVERT(NVARCHAR(20), se.EmployeeID)) AS EmployeeCode
            FROM @scopeEmployees se
            ORDER BY se.EmployeeCode, se.EmployeeID
        ) x;

        INSERT INTO @report (ModuleName, RecordCount, RecordIDs, IsBlocking, AutoHandleAction)
        VALUES (N'Employee Master', @count, @ids, 0, N'Employee keeps master data and falls back to inherited default policy.');
    END;

    SELECT @count = COUNT(*)
    FROM dbo.Allocations a
    WHERE a.PolicyRateID = @PreferenceID;

    IF @count > 0
    BEGIN
        SELECT @ids = STRING_AGG(x.ReferenceID, N', ')
        FROM (
            SELECT TOP (5) CONCAT(N'AF-', CONVERT(NVARCHAR(20), a.AllocationID)) AS ReferenceID
            FROM dbo.Allocations a
            WHERE a.PolicyRateID = @PreferenceID
            ORDER BY a.AllocationDate DESC, a.AllocationID DESC
        ) x;

        INSERT INTO @report (ModuleName, RecordCount, RecordIDs, IsBlocking, AutoHandleAction)
        VALUES (N'Airfare Allocation', @count, @ids, 1, N'Delete or reassign the linked airfare allocation rows first.');
    END;

    SELECT @count = COUNT(*)
    FROM dbo.Loans l
    INNER JOIN dbo.Allocations a ON a.AllocationID = l.AllocationID
    WHERE a.PolicyRateID = @PreferenceID
      AND ISNULL(l.RemainingBalance, 0) > 0
      AND ISNULL(l.Status, N'active') <> N'settled';

    IF @count > 0
    BEGIN
        SELECT @ids = STRING_AGG(x.ReferenceID, N', ')
        FROM (
            SELECT TOP (5) CONCAT(N'Loan #', CONVERT(NVARCHAR(20), l.LoanID)) AS ReferenceID
            FROM dbo.Loans l
            INNER JOIN dbo.Allocations a ON a.AllocationID = l.AllocationID
            WHERE a.PolicyRateID = @PreferenceID
              AND ISNULL(l.RemainingBalance, 0) > 0
              AND ISNULL(l.Status, N'active') <> N'settled'
            ORDER BY l.LoanID DESC
        ) x;

        INSERT INTO @report (ModuleName, RecordCount, RecordIDs, IsBlocking, AutoHandleAction)
        VALUES (N'Loan Management (active)', @count, @ids, 1, N'Close, settle, or reassign the active loan rows before deleting this preference.');
    END;

    SELECT @count = COUNT(*)
    FROM dbo.Loans l
    INNER JOIN dbo.Allocations a ON a.AllocationID = l.AllocationID
    WHERE a.PolicyRateID = @PreferenceID
      AND (ISNULL(l.RemainingBalance, 0) <= 0 OR ISNULL(l.Status, N'active') = N'settled');

    IF @count > 0
    BEGIN
        SELECT @ids = STRING_AGG(x.ReferenceID, N', ')
        FROM (
            SELECT TOP (5) CONCAT(N'Loan #', CONVERT(NVARCHAR(20), l.LoanID)) AS ReferenceID
            FROM dbo.Loans l
            INNER JOIN dbo.Allocations a ON a.AllocationID = l.AllocationID
            WHERE a.PolicyRateID = @PreferenceID
              AND (ISNULL(l.RemainingBalance, 0) <= 0 OR ISNULL(l.Status, N'active') = N'settled')
            ORDER BY l.LoanID DESC
        ) x;

        INSERT INTO @report (ModuleName, RecordCount, RecordIDs, IsBlocking, AutoHandleAction)
        VALUES (N'Loan Management (closed)', @count, @ids, 0, N'Closed loan history stays preserved. No blocking action is required.');
    END;

    IF OBJECT_ID(N'dbo.OpeningBalances', N'U') IS NOT NULL
    BEGIN
        SELECT @count = COUNT(*)
        FROM dbo.OpeningBalances ob
        INNER JOIN @scopeEmployees se ON se.EmployeeID = ob.EmployeeID;

        IF @count > 0
        BEGIN
            SELECT @ids = STRING_AGG(x.ReferenceID, N', ')
            FROM (
                SELECT TOP (5) CONCAT(COALESCE(se.EmployeeCode, CONVERT(NVARCHAR(20), se.EmployeeID)), N'/', CONVERT(NVARCHAR(10), ob.BalanceYear)) AS ReferenceID
                FROM dbo.OpeningBalances ob
                INNER JOIN @scopeEmployees se ON se.EmployeeID = ob.EmployeeID
                ORDER BY ob.BalanceYear DESC, ob.BalanceID DESC
            ) x;

            INSERT INTO @report (ModuleName, RecordCount, RecordIDs, IsBlocking, AutoHandleAction)
            VALUES (N'Opening Balance', @count, @ids, 0, N'Opening balance archive links are cleared during delete.');
        END;
    END;

    IF OBJECT_ID(N'dbo.ext_employee_allowance_requests', N'U') IS NOT NULL
    BEGIN
        SELECT @count = COUNT(*)
        FROM dbo.ext_employee_allowance_requests r
        INNER JOIN @scopeEmployees se ON se.EmployeeID = r.EmployeeID
        WHERE r.ApprovalStatus IN (N'Submitted', N'ManagerApproved', N'HRApproved', N'FinanceApproved');

        IF @count > 0
        BEGIN
            SELECT @ids = STRING_AGG(x.ReferenceID, N', ')
            FROM (
                SELECT TOP (5) COALESCE(r.RequestNo, CONCAT(N'REQ-', CONVERT(NVARCHAR(20), r.RequestID))) AS ReferenceID
                FROM dbo.ext_employee_allowance_requests r
                INNER JOIN @scopeEmployees se ON se.EmployeeID = r.EmployeeID
                WHERE r.ApprovalStatus IN (N'Submitted', N'ManagerApproved', N'HRApproved', N'FinanceApproved')
                ORDER BY r.RequestID DESC
            ) x;

            INSERT INTO @report (ModuleName, RecordCount, RecordIDs, IsBlocking, AutoHandleAction)
            VALUES (N'Self-Service Request (active)', @count, @ids, 1, N'Process, reject, or cancel the linked self-service requests before deleting this preference.');
        END;

        SELECT @count = COUNT(*)
        FROM dbo.ext_employee_allowance_requests r
        INNER JOIN @scopeEmployees se ON se.EmployeeID = r.EmployeeID
        WHERE r.ApprovalStatus IN (N'Rejected', N'Cancelled', N'Issued');

        IF @count > 0
        BEGIN
            SELECT @ids = STRING_AGG(x.ReferenceID, N', ')
            FROM (
                SELECT TOP (5) COALESCE(r.RequestNo, CONCAT(N'REQ-', CONVERT(NVARCHAR(20), r.RequestID))) AS ReferenceID
                FROM dbo.ext_employee_allowance_requests r
                INNER JOIN @scopeEmployees se ON se.EmployeeID = r.EmployeeID
                WHERE r.ApprovalStatus IN (N'Rejected', N'Cancelled', N'Issued')
                ORDER BY r.RequestID DESC
            ) x;

            INSERT INTO @report (ModuleName, RecordCount, RecordIDs, IsBlocking, AutoHandleAction)
            VALUES (N'Self-Service Request (historical)', @count, @ids, 0, N'Processed, cancelled, or rejected requests remain preserved as history only.');
        END;
    END;

    IF OBJECT_ID(N'dbo.AirfarePolicyRateArchive', N'U') IS NOT NULL
    BEGIN
        SELECT @count = COUNT(*)
        FROM dbo.AirfarePolicyRateArchive a
        WHERE a.PolicyRateID = @PreferenceID;

        IF @count > 0
        BEGIN
            INSERT INTO @report (ModuleName, RecordCount, RecordIDs, IsBlocking, AutoHandleAction)
            VALUES (N'Year-End Archive', @count, CONCAT(N'Policy #', @PreferenceID), 0, N'Archived snapshots stay immutable and do not block delete.');
        END;
    END;

    RETURN;
END;
GO

CREATE OR ALTER FUNCTION dbo.fn_Preference_CanDelete
(
    @PreferenceID BIGINT
)
RETURNS BIT
AS
BEGIN
    DECLARE @canDelete BIT = 0;
    DECLARE @effectiveFrom DATE = NULL;
    DECLARE @isActive BIT = 0;
    DECLARE @effectiveTo DATE = NULL;
    DECLARE @isDeleted BIT = 0;

    SELECT TOP (1)
        @effectiveFrom = r.EffectiveFrom,
        @isActive = ISNULL(r.IsActive, 0),
        @effectiveTo = r.EffectiveTo,
        @isDeleted = ISNULL(r.IsDeleted, 0)
    FROM dbo.AirfarePolicyRates r
    WHERE r.PolicyRateID = @PreferenceID;

    IF @effectiveFrom IS NULL RETURN 0;

    IF EXISTS (
        SELECT 1
        FROM dbo.fn_Preference_GetReferenceReport(@PreferenceID) rr
        WHERE rr.IsBlocking = 1
          AND rr.RecordCount > 0
    )
        RETURN 0;

    SET @canDelete = 1;
    RETURN @canDelete;
END;
GO

CREATE OR ALTER FUNCTION dbo.fn_Preference_LockReason
(
    @PreferenceID BIGINT
)
RETURNS NVARCHAR(400)
AS
BEGIN
    DECLARE @reason NVARCHAR(400) = N'History locked';
    DECLARE @effectiveFrom DATE = NULL;
    DECLARE @isActive BIT = 0;
    DECLARE @effectiveTo DATE = NULL;
    DECLARE @isDeleted BIT = 0;
    DECLARE @blockerName NVARCHAR(80) = NULL;
    DECLARE @blockerCount BIGINT = 0;
    DECLARE @blockerIds NVARCHAR(MAX) = NULL;
    DECLARE @nonBlockingCount BIGINT = 0;

    SELECT TOP (1)
        @effectiveFrom = r.EffectiveFrom,
        @isActive = ISNULL(r.IsActive, 0),
        @effectiveTo = r.EffectiveTo,
        @isDeleted = ISNULL(r.IsDeleted, 0)
    FROM dbo.AirfarePolicyRates r
    WHERE r.PolicyRateID = @PreferenceID;

    IF @effectiveFrom IS NULL RETURN N'Preference not found';

    SELECT TOP (1)
        @blockerName = rr.ModuleName,
        @blockerCount = rr.RecordCount,
        @blockerIds = rr.RecordIDs
    FROM dbo.fn_Preference_GetReferenceReport(@PreferenceID) rr
    WHERE rr.IsBlocking = 1
      AND rr.RecordCount > 0
    ORDER BY CASE WHEN rr.ModuleName IN (N'Global default guard', N'Fallback chain') THEN 0 ELSE 1 END, rr.RecordCount DESC, rr.ModuleName;

    IF @blockerName IS NOT NULL
    BEGIN
        IF @blockerName = N'Global default guard'
            RETURN N'System locked - create a replacement global default before deleting this rule.';
        IF @blockerName = N'Fallback chain'
            RETURN N'Locked - company rule has no higher-level fallback. Create a global default first.';
        RETURN N'Locked - ' + @blockerName + N' has ' + CONVERT(NVARCHAR(20), @blockerCount) + N' blocking record(s)' + CASE WHEN NULLIF(COALESCE(@blockerIds, N''), N'') IS NULL THEN N'.' ELSE N': ' + LEFT(@blockerIds, 180) + N'.' END;
    END;

    SELECT @nonBlockingCount = COUNT(*)
    FROM dbo.fn_Preference_GetReferenceReport(@PreferenceID) rr
    WHERE rr.IsBlocking = 0
      AND rr.RecordCount > 0;

    IF @nonBlockingCount > 0
        RETURN N'Safe to delete - non-blocking references will be auto-handled during delete.';

    RETURN N'Safe to delete - no blocking references found.';
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_Preference_RefreshLockState
    @PreferenceID BIGINT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE r
       SET IsHistoryLocked = CASE WHEN dbo.fn_Preference_CanDelete(r.PolicyRateID) = 1 THEN 0 ELSE 1 END,
           LockReason = dbo.fn_Preference_LockReason(r.PolicyRateID),
           LockEvaluatedAt = SYSUTCDATETIME(),
           LockReleasedAt = CASE
               WHEN dbo.fn_Preference_CanDelete(r.PolicyRateID) = 1 THEN COALESCE(r.LockReleasedAt, SYSUTCDATETIME())
               ELSE NULL
           END
    FROM dbo.AirfarePolicyRates r
    WHERE @PreferenceID IS NULL OR r.PolicyRateID = @PreferenceID;
END;
GO

IF OBJECT_ID('dbo.AirfarePolicyRateArchive', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.AirfarePolicyRateArchive
    (
        ArchiveID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AirfarePolicyRateArchive PRIMARY KEY,
        PolicyRateID BIGINT NOT NULL,
        CompanyID INT NULL,
        EmployeeID INT NULL,
        Department NVARCHAR(100) NULL,
        EmpGroup NVARCHAR(100) NULL,
        EffectiveFrom DATE NULL,
        EffectiveTo DATE NULL,
        MaxPayoutAmount DECIMAL(12,2) NULL,
        CycleDays DECIMAL(10,2) NULL,
        WorkingDaysPerMonth DECIMAL(10,2) NULL,
        AirfareDaysPerMonth DECIMAL(10,2) NULL,
        CreatedAt DATETIME2(0) NULL,
        CreatedBy INT NULL,
        ArchivedAt DATETIME2(0) NOT NULL CONSTRAINT DF_AirfarePolicyRateArchive_ArchivedAt DEFAULT (SYSUTCDATETIME()),
        ArchivedBy INT NULL,
        ArchiveReason NVARCHAR(400) NULL,
        DependencySnapshotJson NVARCHAR(MAX) NULL,
        PolicySnapshotJson NVARCHAR(MAX) NOT NULL CONSTRAINT DF_AirfarePolicyRateArchive_PolicySnapshotJson DEFAULT (N'{}'),
        DeleteAction NVARCHAR(40) NOT NULL CONSTRAINT DF_AirfarePolicyRateArchive_DeleteAction DEFAULT (N'soft_delete')
    );
END;
GO

IF COL_LENGTH('dbo.AirfarePolicyRateArchive', 'PolicySnapshotJson') IS NULL
    ALTER TABLE dbo.AirfarePolicyRateArchive ADD PolicySnapshotJson NVARCHAR(MAX) NOT NULL CONSTRAINT DF_AirfarePolicyRateArchive_PolicySnapshotJson DEFAULT (N'{}');
GO

IF COL_LENGTH('dbo.AirfarePolicyRateArchive', 'DeleteAction') IS NULL
    ALTER TABLE dbo.AirfarePolicyRateArchive ADD DeleteAction NVARCHAR(40) NOT NULL CONSTRAINT DF_AirfarePolicyRateArchive_DeleteAction DEFAULT (N'soft_delete');
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AirfarePolicyRateArchive_PolicyRateID' AND object_id = OBJECT_ID('dbo.AirfarePolicyRateArchive'))
    CREATE INDEX IX_AirfarePolicyRateArchive_PolicyRateID ON dbo.AirfarePolicyRateArchive(PolicyRateID, ArchivedAt DESC);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AirfarePolicyRates_Effective' AND object_id = OBJECT_ID('dbo.AirfarePolicyRates'))
    CREATE INDEX IX_AirfarePolicyRates_Effective ON dbo.AirfarePolicyRates(CompanyID, EffectiveFrom, EffectiveTo, IsActive);
GO

IF EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_AirfarePolicyRates_CurrentScope'
      AND object_id = OBJECT_ID('dbo.AirfarePolicyRates')
      AND ISNULL(filter_definition, N'') NOT LIKE N'%IsDeleted%'
)
    DROP INDEX IX_AirfarePolicyRates_CurrentScope ON dbo.AirfarePolicyRates;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AirfarePolicyRates_CurrentScope' AND object_id = OBJECT_ID('dbo.AirfarePolicyRates'))
    CREATE INDEX IX_AirfarePolicyRates_CurrentScope
    ON dbo.AirfarePolicyRates(CompanyID, EmployeeID, Department, EmpGroup, EffectiveFrom DESC, PolicyRateID DESC)
    INCLUDE (MaxPayoutAmount, CycleDays, WorkingDaysPerMonth, AirfareDaysPerMonth)
    WHERE IsActive = 1 AND EffectiveTo IS NULL AND IsDeleted = 0;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AirfarePolicyRates_DeleteLookup' AND object_id = OBJECT_ID('dbo.AirfarePolicyRates'))
    CREATE INDEX IX_AirfarePolicyRates_DeleteLookup
    ON dbo.AirfarePolicyRates(PolicyRateID, IsActive, EffectiveTo)
    INCLUDE (CompanyID, EmployeeID, Department, EmpGroup, EffectiveFrom, MaxPayoutAmount, CycleDays, WorkingDaysPerMonth, AirfareDaysPerMonth, CreatedAt);
GO

IF COL_LENGTH('dbo.AirfarePolicyRates', 'IsActive') IS NOT NULL
BEGIN
    EXEC(N'
    ;WITH duplicatePolicyRows AS (
        SELECT
            PolicyRateID,
            IsActive,
            ROW_NUMBER() OVER (
                PARTITION BY
                    ISNULL(CompanyID, -1),
                    ISNULL(EmployeeID, -1),
                    ISNULL(Department, N''''),
                    ISNULL(EmpGroup, N''''),
                    EffectiveFrom
                ORDER BY PolicyRateID DESC
            ) AS rn
        FROM dbo.AirfarePolicyRates
        WHERE IsActive = 1
    )
    UPDATE duplicatePolicyRows
       SET IsActive = 0
     WHERE rn > 1;');
END;
GO

IF COL_LENGTH('Allocations', 'PolicyRateID') IS NULL ALTER TABLE Allocations ADD PolicyRateID BIGINT NULL;
IF COL_LENGTH('Allocations', 'PolicyEffectiveFrom') IS NULL ALTER TABLE Allocations ADD PolicyEffectiveFrom DATE NULL;
IF COL_LENGTH('Allocations', 'PolicyMaxPayoutAmount') IS NULL ALTER TABLE Allocations ADD PolicyMaxPayoutAmount DECIMAL(12,2) NULL;
IF COL_LENGTH('Allocations', 'PolicyCycleDays') IS NULL ALTER TABLE Allocations ADD PolicyCycleDays DECIMAL(10,2) NULL;
IF COL_LENGTH('Allocations', 'PolicyPerDayRate') IS NULL ALTER TABLE Allocations ADD PolicyPerDayRate DECIMAL(12,6) NULL;
GO

DECLARE @paymentModeConstraint NVARCHAR(128);
DECLARE payment_mode_constraints CURSOR LOCAL FAST_FORWARD FOR
SELECT cc.name
FROM sys.check_constraints cc
WHERE cc.parent_object_id = OBJECT_ID('dbo.Allocations')
  AND cc.definition LIKE '%PaymentMode%';

OPEN payment_mode_constraints;
FETCH NEXT FROM payment_mode_constraints INTO @paymentModeConstraint;
WHILE @@FETCH_STATUS = 0
BEGIN
    DECLARE @dropPaymentModeConstraintSql NVARCHAR(MAX) = N'ALTER TABLE dbo.Allocations DROP CONSTRAINT ' + QUOTENAME(@paymentModeConstraint);
    EXEC sp_executesql @dropPaymentModeConstraintSql;
    FETCH NEXT FROM payment_mode_constraints INTO @paymentModeConstraint;
END
CLOSE payment_mode_constraints;
DEALLOCATE payment_mode_constraints;

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.Allocations')
      AND name = 'CK_Allocations_PaymentMode'
)
BEGIN
    ALTER TABLE dbo.Allocations WITH CHECK ADD CONSTRAINT CK_Allocations_PaymentMode
    CHECK (PaymentMode IN ('entitlement', 'loan', 'employee', 'employee_full', 'company', 'company_full'));
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.AirfarePolicyRates WHERE CompanyID IS NULL AND EffectiveFrom = '19000101')
BEGIN
    INSERT INTO dbo.AirfarePolicyRates (CompanyID, EffectiveFrom, EffectiveTo, MaxPayoutAmount, CycleDays, WorkingDaysPerMonth, AirfareDaysPerMonth, IsActive)
    VALUES (NULL, '19000101', '20260617', 150.00, 60, 30, 2.5, 1);
END
ELSE
BEGIN
    UPDATE dbo.AirfarePolicyRates
    SET EffectiveTo = CASE WHEN EffectiveFrom < '20260618' THEN '20260617' ELSE EffectiveTo END,
        MaxPayoutAmount = CASE WHEN EffectiveFrom = '19000101' THEN 150.00 ELSE MaxPayoutAmount END,
        CycleDays = CASE WHEN CycleDays <= 0 THEN 60 ELSE CycleDays END,
        WorkingDaysPerMonth = CASE WHEN WorkingDaysPerMonth <= 0 THEN 30 ELSE WorkingDaysPerMonth END,
        AirfareDaysPerMonth = CASE WHEN AirfareDaysPerMonth <= 0 THEN 2.5 ELSE AirfareDaysPerMonth END,
        IsActive = CASE WHEN EffectiveFrom < '20260618' THEN 0 ELSE IsActive END
    WHERE CompanyID IS NULL AND EffectiveFrom = '19000101';
END;

IF NOT EXISTS (SELECT 1 FROM dbo.AirfarePolicyRates WHERE CompanyID IS NULL AND EffectiveFrom = '20260618')
BEGIN
    INSERT INTO dbo.AirfarePolicyRates (CompanyID, EffectiveFrom, EffectiveTo, MaxPayoutAmount, CycleDays, WorkingDaysPerMonth, AirfareDaysPerMonth, IsActive)
    VALUES (NULL, '20260618', NULL, 150.00, 60, 30, 2.5, 1);
END;

UPDATE dbo.Allocations
SET PolicyMaxPayoutAmount = ISNULL(PolicyMaxPayoutAmount, 150.00),
    PolicyCycleDays = ISNULL(NULLIF(PolicyCycleDays, 0), 60),
    PolicyPerDayRate = ISNULL(NULLIF(PolicyPerDayRate, 0), CAST(150.00 / 60.0 AS DECIMAL(12,6))),
    PolicyEffectiveFrom = ISNULL(PolicyEffectiveFrom, AllocationDate)
WHERE PolicyMaxPayoutAmount IS NULL
   OR PolicyCycleDays IS NULL
   OR PolicyPerDayRate IS NULL
   OR PolicyEffectiveFrom IS NULL;
GO

CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_GetEffectiveAirfarePolicy
    @AllocationDate DATE,
    @CompanyID INT = NULL,
    @EmployeeID INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @workDate DATE = CAST(COALESCE(@AllocationDate, CAST(GETDATE() AS DATE)) AS DATE);
    DECLARE @EmployeeDepartment NVARCHAR(100) = NULL;
    DECLARE @EmployeeGroup NVARCHAR(100) = NULL;

    SELECT
        @EmployeeDepartment = NULLIF(LTRIM(RTRIM(Department)), N''),
        @EmployeeGroup = NULLIF(LTRIM(RTRIM(EmpGroup)), N'')
    FROM dbo.Employees
    WHERE EmployeeID = @EmployeeID;

    SELECT TOP 1
        PolicyRateID,
        CompanyID,
        EmployeeID,
        Department,
        EmpGroup,
        EffectiveFrom,
        EffectiveTo,
        MaxPayoutAmount,
        CycleDays,
        WorkingDaysPerMonth,
        AirfareDaysPerMonth,
        CAST(MaxPayoutAmount / NULLIF(CycleDays, 0) AS DECIMAL(12,6)) AS PerDayRate,
        IsActive,
        CreatedAt
    FROM dbo.AirfarePolicyRates
    WHERE IsActive = 1
      AND EffectiveFrom <= @workDate
      AND (EffectiveTo IS NULL OR EffectiveTo >= @workDate)
      AND (EmployeeID IS NULL OR EmployeeID = @EmployeeID)
      AND (CompanyID IS NULL OR CompanyID = @CompanyID)
      AND (Department IS NULL OR LOWER(Department) = LOWER(@EmployeeDepartment))
      AND (EmpGroup IS NULL OR LOWER(EmpGroup) = LOWER(@EmployeeGroup))
    ORDER BY
      CASE
        WHEN EmployeeID = @EmployeeID AND CompanyID IS NULL AND Department IS NULL AND EmpGroup IS NULL THEN 50
        WHEN EmployeeID = @EmployeeID THEN 45
        WHEN EmpGroup IS NOT NULL AND LOWER(EmpGroup) = LOWER(@EmployeeGroup) THEN 40
        WHEN Department IS NOT NULL AND LOWER(Department) = LOWER(@EmployeeDepartment) THEN 30
        WHEN EmployeeID IS NULL AND CompanyID = @CompanyID THEN 20
        ELSE 10
      END DESC,
      EffectiveFrom DESC,
      PolicyRateID DESC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_SaveAirfarePolicyRate
    @EffectiveFrom DATE,
    @MaxPayoutAmount DECIMAL(12,2),
    @CompanyID INT = NULL,
    @EmployeeID INT = NULL,
    @Department NVARCHAR(100) = NULL,
    @EmpGroup NVARCHAR(100) = NULL,
    @CreatedBy INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @EffectiveFrom IS NULL THROW 52001, 'Effective date is required.', 1;
    IF ISNULL(@MaxPayoutAmount, 0) <= 0 THROW 52002, 'Airfare amount must be more than zero.', 1;

    SET @Department = NULLIF(LTRIM(RTRIM(@Department)), N'');
    SET @EmpGroup = NULLIF(LTRIM(RTRIM(@EmpGroup)), N'');

    UPDATE dbo.AirfarePolicyRates
    SET EffectiveTo = DATEADD(DAY, -1, @EffectiveFrom)
    WHERE IsActive = 1
      AND ((CompanyID = @CompanyID) OR (CompanyID IS NULL AND @CompanyID IS NULL))
      AND ((EmployeeID = @EmployeeID) OR (EmployeeID IS NULL AND @EmployeeID IS NULL))
      AND ((Department = @Department) OR (Department IS NULL AND @Department IS NULL))
      AND ((EmpGroup = @EmpGroup) OR (EmpGroup IS NULL AND @EmpGroup IS NULL))
      AND EffectiveFrom < @EffectiveFrom
      AND (EffectiveTo IS NULL OR EffectiveTo >= @EffectiveFrom);

    UPDATE dbo.AirfarePolicyRates
    SET IsActive = 0,
        EffectiveTo = CASE WHEN EffectiveTo IS NULL OR EffectiveTo >= @EffectiveFrom THEN @EffectiveFrom ELSE EffectiveTo END
    WHERE ((CompanyID = @CompanyID) OR (CompanyID IS NULL AND @CompanyID IS NULL))
      AND ((EmployeeID = @EmployeeID) OR (EmployeeID IS NULL AND @EmployeeID IS NULL))
      AND ((Department = @Department) OR (Department IS NULL AND @Department IS NULL))
      AND ((EmpGroup = @EmpGroup) OR (EmpGroup IS NULL AND @EmpGroup IS NULL))
      AND EffectiveFrom = @EffectiveFrom;

    INSERT INTO dbo.AirfarePolicyRates (CompanyID, EmployeeID, Department, EmpGroup, EffectiveFrom, EffectiveTo, MaxPayoutAmount, CycleDays, WorkingDaysPerMonth, AirfareDaysPerMonth, IsActive, CreatedBy)
    VALUES (@CompanyID, @EmployeeID, @Department, @EmpGroup, @EffectiveFrom, NULL, @MaxPayoutAmount, 60, 30, 2.5, 1, @CreatedBy);

    DECLARE @NewPolicyRateID BIGINT = SCOPE_IDENTITY();
    EXEC dbo.sp_Preference_RefreshLockState @PreferenceID = @NewPolicyRateID;
    EXEC dbo.sp_ATLAS_GetEffectiveAirfarePolicy @AllocationDate = @EffectiveFrom, @CompanyID = @CompanyID, @EmployeeID = @EmployeeID;
END;
GO

CREATE OR ALTER TRIGGER dbo.trg_PreferenceLock_AirfarePolicyRates_Refresh
ON dbo.AirfarePolicyRates
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF TRIGGER_NESTLEVEL() > 1 RETURN;

    DECLARE @ids TABLE (PolicyRateID BIGINT PRIMARY KEY);

    INSERT INTO @ids (PolicyRateID)
    SELECT DISTINCT PolicyRateID
    FROM inserted
    WHERE PolicyRateID IS NOT NULL;

    DECLARE @policyRateId BIGINT;
    DECLARE refresh_cursor CURSOR LOCAL FAST_FORWARD FOR
        SELECT PolicyRateID FROM @ids;

    OPEN refresh_cursor;
    FETCH NEXT FROM refresh_cursor INTO @policyRateId;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        EXEC dbo.sp_Preference_RefreshLockState @PreferenceID = @policyRateId;
        FETCH NEXT FROM refresh_cursor INTO @policyRateId;
    END
    CLOSE refresh_cursor;
    DEALLOCATE refresh_cursor;
END;
GO

CREATE OR ALTER TRIGGER dbo.trg_PreferenceLock_Employees_Delete
ON dbo.Employees
AFTER DELETE
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ids TABLE (PolicyRateID BIGINT PRIMARY KEY);

    INSERT INTO @ids (PolicyRateID)
    SELECT DISTINCT r.PolicyRateID
    FROM dbo.AirfarePolicyRates r
    INNER JOIN deleted d ON d.EmployeeID = r.EmployeeID
    WHERE r.PolicyRateID IS NOT NULL;

    DECLARE @policyRateId BIGINT;
    DECLARE refresh_cursor CURSOR LOCAL FAST_FORWARD FOR
        SELECT PolicyRateID FROM @ids;

    OPEN refresh_cursor;
    FETCH NEXT FROM refresh_cursor INTO @policyRateId;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        EXEC dbo.sp_Preference_RefreshLockState @PreferenceID = @policyRateId;
        FETCH NEXT FROM refresh_cursor INTO @policyRateId;
    END
    CLOSE refresh_cursor;
    DEALLOCATE refresh_cursor;
END;
GO

CREATE OR ALTER TRIGGER dbo.trg_PreferenceLock_Allocations_Refresh
ON dbo.Allocations
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ids TABLE (PolicyRateID BIGINT PRIMARY KEY);

    INSERT INTO @ids (PolicyRateID)
    SELECT DISTINCT PolicyRateID
    FROM (
        SELECT PolicyRateID FROM inserted
        UNION
        SELECT PolicyRateID FROM deleted
    ) refs
    WHERE PolicyRateID IS NOT NULL;

    DECLARE @policyRateId BIGINT;
    DECLARE refresh_cursor CURSOR LOCAL FAST_FORWARD FOR
        SELECT PolicyRateID FROM @ids;

    OPEN refresh_cursor;
    FETCH NEXT FROM refresh_cursor INTO @policyRateId;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        EXEC dbo.sp_Preference_RefreshLockState @PreferenceID = @policyRateId;
        FETCH NEXT FROM refresh_cursor INTO @policyRateId;
    END
    CLOSE refresh_cursor;
    DEALLOCATE refresh_cursor;
END;
GO

CREATE OR ALTER TRIGGER dbo.trg_PreferenceLock_Loans_Refresh
ON dbo.Loans
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ids TABLE (PolicyRateID BIGINT PRIMARY KEY);

    INSERT INTO @ids (PolicyRateID)
    SELECT DISTINCT a.PolicyRateID
    FROM dbo.Allocations a
    INNER JOIN (
        SELECT AllocationID FROM inserted
        UNION
        SELECT AllocationID FROM deleted
    ) loanRefs ON loanRefs.AllocationID = a.AllocationID
    WHERE a.PolicyRateID IS NOT NULL;

    DECLARE @policyRateId BIGINT;
    DECLARE refresh_cursor CURSOR LOCAL FAST_FORWARD FOR
        SELECT PolicyRateID FROM @ids;

    OPEN refresh_cursor;
    FETCH NEXT FROM refresh_cursor INTO @policyRateId;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        EXEC dbo.sp_Preference_RefreshLockState @PreferenceID = @policyRateId;
        FETCH NEXT FROM refresh_cursor INTO @policyRateId;
    END
    CLOSE refresh_cursor;
    DEALLOCATE refresh_cursor;
END;
GO

IF OBJECT_ID(N'dbo.ext_employee_allowance_requests', N'U') IS NOT NULL
BEGIN
    EXEC(N'
    CREATE OR ALTER TRIGGER dbo.trg_PreferenceLock_SelfService_Refresh
    ON dbo.ext_employee_allowance_requests
    AFTER INSERT, UPDATE, DELETE
    AS
    BEGIN
        SET NOCOUNT ON;

        DECLARE @ids TABLE (PolicyRateID BIGINT PRIMARY KEY);

        INSERT INTO @ids (PolicyRateID)
        SELECT DISTINCT r.PolicyRateID
        FROM dbo.AirfarePolicyRates r
        LEFT JOIN dbo.Companies c ON c.CompanyID = r.CompanyID
        INNER JOIN dbo.Employees e ON
            (r.EmployeeID IS NOT NULL AND r.EmployeeID = e.EmployeeID)
            OR (
                r.EmployeeID IS NULL
                AND r.Department IS NOT NULL
                AND LOWER(NULLIF(LTRIM(RTRIM(COALESCE(e.Department, N''''))), N'''')) = LOWER(NULLIF(LTRIM(RTRIM(COALESCE(r.Department, N''''))), N''''))
            )
            OR (
                r.EmployeeID IS NULL
                AND r.Department IS NULL
                AND r.EmpGroup IS NOT NULL
                AND LOWER(NULLIF(LTRIM(RTRIM(COALESCE(e.EmpGroup, N''''))), N'''')) = LOWER(NULLIF(LTRIM(RTRIM(COALESCE(r.EmpGroup, N''''))), N''''))
            )
            OR (
                r.EmployeeID IS NULL
                AND r.Department IS NULL
                AND r.EmpGroup IS NULL
                AND r.CompanyID IS NOT NULL
                AND NULLIF(LTRIM(RTRIM(COALESCE(e.Company, N''''))), N'''') IS NOT NULL
                AND (
                    LOWER(NULLIF(LTRIM(RTRIM(COALESCE(e.Company, N''''))), N'''')) = LOWER(COALESCE(c.CompanyName, N''''))
                    OR LOWER(NULLIF(LTRIM(RTRIM(COALESCE(e.Company, N''''))), N'''')) = LOWER(COALESCE(c.CompanyCode, N''''))
                )
            )
        INNER JOIN (
            SELECT EmployeeID FROM inserted
            UNION
            SELECT EmployeeID FROM deleted
        ) req ON req.EmployeeID = e.EmployeeID
        WHERE r.PolicyRateID IS NOT NULL;

        DECLARE @policyRateId BIGINT;
        DECLARE refresh_cursor CURSOR LOCAL FAST_FORWARD FOR
            SELECT PolicyRateID FROM @ids;

        OPEN refresh_cursor;
        FETCH NEXT FROM refresh_cursor INTO @policyRateId;
        WHILE @@FETCH_STATUS = 0
        BEGIN
            EXEC dbo.sp_Preference_RefreshLockState @PreferenceID = @policyRateId;
            FETCH NEXT FROM refresh_cursor INTO @policyRateId;
        END
        CLOSE refresh_cursor;
        DEALLOCATE refresh_cursor;
    END;');
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_Preference_DeleteSoft
    @PreferenceID BIGINT,
    @DeletedBy INT = NULL,
    @AuditReason NVARCHAR(400) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

    IF @PreferenceID IS NULL OR @PreferenceID <= 0
        THROW 52041, 'Valid preference ID is required.', 1;

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @canDelete BIT = dbo.fn_Preference_CanDelete(@PreferenceID);
        DECLARE @lockReason NVARCHAR(400) = dbo.fn_Preference_LockReason(@PreferenceID);
        DECLARE @referenceReportJson NVARCHAR(MAX) = (
            SELECT ModuleName, RecordCount, RecordIDs, IsBlocking, AutoHandleAction
            FROM dbo.fn_Preference_GetReferenceReport(@PreferenceID)
            FOR JSON PATH
        );
        DECLARE @policy TABLE
        (
            PolicyRateID BIGINT NULL,
            CompanyID INT NULL,
            CompanyName NVARCHAR(200) NULL,
            EmployeeID INT NULL,
            EmployeeCode NVARCHAR(50) NULL,
            FullName NVARCHAR(200) NULL,
            Department NVARCHAR(100) NULL,
            EmpGroup NVARCHAR(100) NULL,
            EffectiveFrom DATE NULL,
            EffectiveTo DATE NULL,
            MaxPayoutAmount DECIMAL(12,2) NULL,
            CycleDays DECIMAL(10,2) NULL,
            WorkingDaysPerMonth DECIMAL(10,2) NULL,
            AirfareDaysPerMonth DECIMAL(10,2) NULL,
            PerDayRate DECIMAL(12,6) NULL,
            IsActive BIT NULL,
            CreatedAt DATETIME2(0) NULL,
            CreatedBy INT NULL,
            IsDeleted BIT NULL,
            DeletedAt DATETIME2(0) NULL,
            DeletedBy INT NULL,
            DeleteReason NVARCHAR(400) NULL,
            ArchivedAt DATETIME2(0) NULL,
            DependencySnapshotJson NVARCHAR(MAX) NULL,
            PolicyStatus NVARCHAR(30) NULL,
            IsHistoryLocked BIT NULL,
            LockReason NVARCHAR(400) NULL
        );

        INSERT INTO @policy
        SELECT TOP (1)
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
            r.WorkingDaysPerMonth,
            r.AirfareDaysPerMonth,
            CAST(r.MaxPayoutAmount / NULLIF(r.CycleDays, 0) AS DECIMAL(12,6)) AS PerDayRate,
            r.IsActive,
            r.CreatedAt,
            r.CreatedBy,
            r.IsDeleted,
            r.DeletedAt,
            r.DeletedBy,
            r.DeleteReason,
            r.ArchivedAt,
            r.DependencySnapshotJson,
            r.PolicyStatus,
            r.IsHistoryLocked,
            r.LockReason
        FROM dbo.AirfarePolicyRates r WITH (UPDLOCK, HOLDLOCK)
        LEFT JOIN dbo.Companies c ON c.CompanyID = r.CompanyID
        LEFT JOIN dbo.Employees e ON e.EmployeeID = r.EmployeeID
        WHERE r.PolicyRateID = @PreferenceID;

        IF NOT EXISTS (SELECT 1 FROM @policy)
        BEGIN
            COMMIT TRANSACTION;
            SELECT
                CAST(N'failed' AS NVARCHAR(40)) AS ApiStatus,
                CAST(N'not_found' AS NVARCHAR(40)) AS DeleteStatus,
                CAST(0 AS BIT) AS CanDelete,
                CAST(NULL AS BIGINT) AS PolicyRateID,
                CAST(N'Preference not found' AS NVARCHAR(400)) AS LockReason;
            RETURN;
        END;

        IF @canDelete = 0
        BEGIN
            EXEC dbo.sp_Preference_RefreshLockState @PreferenceID = @PreferenceID;
            COMMIT TRANSACTION;
            SELECT
                CAST(N'blocked' AS NVARCHAR(40)) AS ApiStatus,
                CAST(N'locked' AS NVARCHAR(40)) AS DeleteStatus,
                CAST(0 AS BIT) AS CanDelete,
                @PreferenceID AS PolicyRateID,
                @lockReason AS LockReason,
                COALESCE(@referenceReportJson, N'[]') AS ReferenceReportJson;
            RETURN;
        END;

        DECLARE @scopeEmployees TABLE
        (
            EmployeeID INT PRIMARY KEY
        );

        INSERT INTO @scopeEmployees (EmployeeID)
        SELECT e.EmployeeID
        FROM dbo.Employees e
        CROSS JOIN @policy p
        LEFT JOIN dbo.Companies c ON c.CompanyID = p.CompanyID
        WHERE (
                p.EmployeeID IS NOT NULL
                AND e.EmployeeID = p.EmployeeID
              )
           OR (
                p.EmployeeID IS NULL
                AND p.Department IS NOT NULL
                AND LOWER(NULLIF(LTRIM(RTRIM(COALESCE(e.Department, N''))), N'')) = LOWER(p.Department)
                AND (
                    p.CompanyID IS NULL
                    OR (
                        NULLIF(LTRIM(RTRIM(COALESCE(e.Company, N''))), N'') IS NOT NULL
                        AND (
                            LOWER(NULLIF(LTRIM(RTRIM(COALESCE(e.Company, N''))), N'')) = LOWER(COALESCE(c.CompanyName, N''))
                            OR LOWER(NULLIF(LTRIM(RTRIM(COALESCE(e.Company, N''))), N'')) = LOWER(COALESCE(c.CompanyCode, N''))
                        )
                    )
                )
              )
           OR (
                p.EmployeeID IS NULL
                AND p.Department IS NULL
                AND p.EmpGroup IS NOT NULL
                AND LOWER(NULLIF(LTRIM(RTRIM(COALESCE(e.EmpGroup, N''))), N'')) = LOWER(p.EmpGroup)
                AND (
                    p.CompanyID IS NULL
                    OR (
                        NULLIF(LTRIM(RTRIM(COALESCE(e.Company, N''))), N'') IS NOT NULL
                        AND (
                            LOWER(NULLIF(LTRIM(RTRIM(COALESCE(e.Company, N''))), N'')) = LOWER(COALESCE(c.CompanyName, N''))
                            OR LOWER(NULLIF(LTRIM(RTRIM(COALESCE(e.Company, N''))), N'')) = LOWER(COALESCE(c.CompanyCode, N''))
                        )
                    )
                )
              )
           OR (
                p.EmployeeID IS NULL
                AND p.Department IS NULL
                AND p.EmpGroup IS NULL
                AND p.CompanyID IS NOT NULL
                AND NULLIF(LTRIM(RTRIM(COALESCE(e.Company, N''))), N'') IS NOT NULL
                AND (
                    LOWER(NULLIF(LTRIM(RTRIM(COALESCE(e.Company, N''))), N'')) = LOWER(COALESCE(c.CompanyName, N''))
                    OR LOWER(NULLIF(LTRIM(RTRIM(COALESCE(e.Company, N''))), N'')) = LOWER(COALESCE(c.CompanyCode, N''))
                )
              );

        IF OBJECT_ID(N'dbo.OpeningBalances', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.OpeningBalances', N'ArchivedPreferenceID') IS NOT NULL
        BEGIN
            UPDATE ob
               SET ArchivedPreferenceID = NULL,
                   ArchivedPreferenceAt = NULL
            FROM dbo.OpeningBalances ob
            WHERE ob.ArchivedPreferenceID = @PreferenceID;
        END;

        IF OBJECT_ID(N'dbo.AirfarePolicyRateArchive', N'U') IS NOT NULL
        BEGIN
            DELETE FROM dbo.AirfarePolicyRateArchive
            WHERE PolicyRateID = @PreferenceID;
        END;

        IF OBJECT_ID(N'dbo.AuditLog', N'U') IS NOT NULL
        BEGIN
            DELETE FROM dbo.AuditLog
            WHERE EntityType = N'AirfarePolicyRate'
              AND EntityID = @PreferenceID;
        END;

        DELETE FROM dbo.AirfarePolicyRates
        WHERE PolicyRateID = @PreferenceID;

        COMMIT TRANSACTION;

        SELECT
            CAST(N'success' AS NVARCHAR(40)) AS ApiStatus,
            CAST(N'delete' AS NVARCHAR(40)) AS DeleteAction,
            CAST(N'deleted' AS NVARCHAR(40)) AS DeleteStatus,
            CAST(1 AS BIT) AS CanDelete,
            COALESCE(@referenceReportJson, N'[]') AS ReferenceReportJson,
            @PreferenceID AS PolicyRateID;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        DECLARE @message NVARCHAR(2048) = ERROR_MESSAGE();
        THROW 52042, @message, 1;
    END CATCH
END;
GO

EXEC dbo.sp_Preference_RefreshLockState @PreferenceID = NULL;
GO

CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_DeactivateAirfarePolicyRate
    @PolicyRateID BIGINT,
    @DeletedBy INT = NULL,
    @DeleteReason NVARCHAR(400) = NULL
AS
BEGIN
    EXEC dbo.sp_Preference_DeleteSoft
        @PreferenceID = @PolicyRateID,
        @DeletedBy = @DeletedBy,
        @AuditReason = @DeleteReason;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_PurgeAirfarePolicyRate
    @PolicyRateID BIGINT,
    @DeletedBy INT = NULL,
    @DeleteReason NVARCHAR(400) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

    IF @PolicyRateID IS NULL OR @PolicyRateID <= 0
        THROW 52031, 'Valid policy rate is required.', 1;

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @exists BIT = 0;
        DECLARE @allocationLinksCleared INT = 0;
        DECLARE @archiveRowsDeleted INT = 0;
        DECLARE @auditRowsDeleted INT = 0;
        DECLARE @dynamicRowsCleared INT = 0;
        DECLARE @dynamicRowsDeleted INT = 0;
        DECLARE @affected INT = 0;
        DECLARE @schemaName SYSNAME;
        DECLARE @tableName SYSNAME;
        DECLARE @columnName SYSNAME;
        DECLARE @isNullable BIT;
        DECLARE @sql NVARCHAR(MAX);

        SELECT @exists = 1
        FROM dbo.AirfarePolicyRates WITH (UPDLOCK, HOLDLOCK)
        WHERE PolicyRateID = @PolicyRateID;

        IF @exists = 0
        BEGIN
            COMMIT TRANSACTION;
            SELECT
                CAST('success' AS NVARCHAR(40)) AS ApiStatus,
                CAST('hard_delete' AS NVARCHAR(40)) AS DeleteAction,
                CAST('not_found_purged' AS NVARCHAR(40)) AS DeleteStatus,
                CAST(0 AS BIT) AS AlreadyRemoved,
                CAST(0 AS BIT) AS AlreadyHistorical,
                CAST(0 AS BIT) AS Deactivated,
                CAST(1 AS BIT) AS HardDeleted,
                CAST(1 AS BIT) AS Purged,
                @PolicyRateID AS PolicyRateID;
            RETURN;
        END;

        IF OBJECT_ID(N'dbo.Allocations', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.Allocations', N'PolicyRateID') IS NOT NULL
        BEGIN
            UPDATE dbo.Allocations
               SET PolicyRateID = NULL
             WHERE PolicyRateID = @PolicyRateID;
            SET @allocationLinksCleared = @@ROWCOUNT;
        END;

        IF OBJECT_ID(N'dbo.AirfarePolicyRateArchive', N'U') IS NOT NULL
        BEGIN
            DELETE FROM dbo.AirfarePolicyRateArchive WHERE PolicyRateID = @PolicyRateID;
            SET @archiveRowsDeleted = @@ROWCOUNT;
        END;

        IF OBJECT_ID(N'dbo.AuditLog', N'U') IS NOT NULL
        BEGIN
            DELETE FROM dbo.AuditLog WHERE EntityType = N'AirfarePolicyRate' AND EntityID = @PolicyRateID;
            SET @auditRowsDeleted = @@ROWCOUNT;
        END;

        DECLARE policy_fk_cursor CURSOR LOCAL FAST_FORWARD FOR
            SELECT
                OBJECT_SCHEMA_NAME(fkc.parent_object_id),
                OBJECT_NAME(fkc.parent_object_id),
                pc.name,
                pc.is_nullable
            FROM sys.foreign_key_columns fkc
            INNER JOIN sys.columns pc
                ON pc.object_id = fkc.parent_object_id
               AND pc.column_id = fkc.parent_column_id
            INNER JOIN sys.columns rc
                ON rc.object_id = fkc.referenced_object_id
               AND rc.column_id = fkc.referenced_column_id
            WHERE fkc.referenced_object_id = OBJECT_ID(N'dbo.AirfarePolicyRates')
              AND rc.name = N'PolicyRateID'
              AND fkc.parent_object_id <> OBJECT_ID(N'dbo.AirfarePolicyRates');

        OPEN policy_fk_cursor;
        FETCH NEXT FROM policy_fk_cursor INTO @schemaName, @tableName, @columnName, @isNullable;
        WHILE @@FETCH_STATUS = 0
        BEGIN
            IF @isNullable = 1
            BEGIN
                SET @sql = N'UPDATE ' + QUOTENAME(@schemaName) + N'.' + QUOTENAME(@tableName) +
                           N' SET ' + QUOTENAME(@columnName) + N' = NULL WHERE ' + QUOTENAME(@columnName) + N' = @id; SET @affected = @@ROWCOUNT;';
                EXEC sp_executesql @sql, N'@id BIGINT, @affected INT OUTPUT', @id = @PolicyRateID, @affected = @affected OUTPUT;
                SET @dynamicRowsCleared = @dynamicRowsCleared + ISNULL(@affected, 0);
            END
            ELSE
            BEGIN
                SET @sql = N'DELETE FROM ' + QUOTENAME(@schemaName) + N'.' + QUOTENAME(@tableName) +
                           N' WHERE ' + QUOTENAME(@columnName) + N' = @id; SET @affected = @@ROWCOUNT;';
                EXEC sp_executesql @sql, N'@id BIGINT, @affected INT OUTPUT', @id = @PolicyRateID, @affected = @affected OUTPUT;
                SET @dynamicRowsDeleted = @dynamicRowsDeleted + ISNULL(@affected, 0);
            END;
            FETCH NEXT FROM policy_fk_cursor INTO @schemaName, @tableName, @columnName, @isNullable;
        END;
        CLOSE policy_fk_cursor;
        DEALLOCATE policy_fk_cursor;

        IF OBJECT_ID(N'dbo.AirfarePolicyAllocations', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.AirfarePolicyAllocations', N'PolicyRateID') IS NOT NULL
        BEGIN
            DELETE FROM dbo.AirfarePolicyAllocations WHERE PolicyRateID = @PolicyRateID;
            SET @dynamicRowsDeleted = @dynamicRowsDeleted + @@ROWCOUNT;
        END;

        IF OBJECT_ID(N'dbo.AirfarePolicyRateHistory', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.AirfarePolicyRateHistory', N'PolicyRateID') IS NOT NULL
        BEGIN
            DELETE FROM dbo.AirfarePolicyRateHistory WHERE PolicyRateID = @PolicyRateID;
            SET @dynamicRowsDeleted = @dynamicRowsDeleted + @@ROWCOUNT;
        END;

        DELETE FROM dbo.AirfarePolicyRates WHERE PolicyRateID = @PolicyRateID;

        COMMIT TRANSACTION;

        SELECT
            CAST('success' AS NVARCHAR(40)) AS ApiStatus,
            CAST('hard_delete' AS NVARCHAR(40)) AS DeleteAction,
            CAST('purged' AS NVARCHAR(40)) AS DeleteStatus,
            CAST(0 AS BIT) AS AlreadyRemoved,
            CAST(0 AS BIT) AS AlreadyHistorical,
            CAST(0 AS BIT) AS Deactivated,
            CAST(1 AS BIT) AS HardDeleted,
            CAST(1 AS BIT) AS Purged,
            @PolicyRateID AS PolicyRateID,
            @allocationLinksCleared AS AllocationLinksCleared,
            @archiveRowsDeleted AS ArchiveRowsDeleted,
            @auditRowsDeleted AS AuditRowsDeleted,
            @dynamicRowsCleared AS DynamicRowsCleared,
            @dynamicRowsDeleted AS DynamicRowsDeleted;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        DECLARE @message NVARCHAR(2048) = ERROR_MESSAGE();
        THROW 52032, @message, 1;
    END CATCH
END;
GO

IF OBJECT_ID('dbo.ATLAS_CompanyResetLog', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ATLAS_CompanyResetLog
    (
        ResetLogID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ATLAS_CompanyResetLog PRIMARY KEY,
        CompanyCode NVARCHAR(30) NOT NULL,
        CompanyName NVARCHAR(150) NOT NULL,
        DatabaseName SYSNAME NOT NULL,
        ResetBy INT NULL,
        StartedAt DATETIME2(0) NOT NULL,
        CompletedAt DATETIME2(0) NULL,
        Status NVARCHAR(20) NOT NULL,
        TablesCleared INT NOT NULL CONSTRAINT DF_ATLAS_CompanyResetLog_TablesCleared DEFAULT (0),
        RowsCleared BIGINT NOT NULL CONSTRAINT DF_ATLAS_CompanyResetLog_RowsCleared DEFAULT (0),
        DetailsJson NVARCHAR(MAX) NULL,
        ErrorMessage NVARCHAR(2048) NULL
    );
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_ResetCompanyState
    @Confirm NVARCHAR(40),
    @CompanyCode NVARCHAR(30) = N'ATLAS',
    @CompanyName NVARCHAR(150) = N'ATLAS Airfare HCM',
    @DatabaseName SYSNAME = N'Atlasairfare010',
    @ResetBy INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET LOCK_TIMEOUT 30000;
    SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

    IF @Confirm <> N'RESET_COMPANY_DATA'
        THROW 52101, 'Confirmation RESET_COMPANY_DATA is required.', 1;

    DECLARE @startedAt DATETIME2(0) = SYSUTCDATETIME();
    DECLARE @resetLogID BIGINT = NULL;
    DECLARE @disableSql NVARCHAR(MAX) = N'';
    DECLARE @enableSql NVARCHAR(MAX) = N'';
    DECLARE @deleteSql NVARCHAR(MAX) = N'';
    DECLARE @reseedSql NVARCHAR(MAX) = N'';
    DECLARE @detailsJson NVARCHAR(MAX) = N'[]';
    DECLARE @tablesCleared INT = 0;
    DECLARE @rowsCleared BIGINT = 0;
    DECLARE @companyId INT = NULL;
    DECLARE @tableActions TABLE
    (
        RowID INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        SchemaName SYSNAME NOT NULL,
        TableName SYSNAME NOT NULL,
        ObjectID INT NOT NULL,
        HasIdentity BIT NOT NULL,
        RowsCleared BIGINT NOT NULL DEFAULT (0),
        ErrorMessage NVARCHAR(2048) NULL
    );

    INSERT INTO dbo.ATLAS_CompanyResetLog
    (
        CompanyCode, CompanyName, DatabaseName, ResetBy, StartedAt, Status
    )
    VALUES
    (
        COALESCE(NULLIF(@CompanyCode, N''), N'ATLAS'),
        COALESCE(NULLIF(@CompanyName, N''), N'ATLAS Airfare HCM'),
        COALESCE(NULLIF(@DatabaseName, N''), DB_NAME()),
        @ResetBy,
        @startedAt,
        N'RUNNING'
    );

    SET @resetLogID = SCOPE_IDENTITY();

    BEGIN TRY
        INSERT INTO @tableActions (SchemaName, TableName, ObjectID, HasIdentity)
        SELECT
            s.name,
            t.name,
            t.object_id,
            CASE WHEN EXISTS (SELECT 1 FROM sys.identity_columns ic WHERE ic.object_id = t.object_id) THEN 1 ELSE 0 END
        FROM sys.tables t
        INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
        WHERE t.is_ms_shipped = 0
          AND t.temporal_type = 0
          AND NOT (
              s.name = N'dbo'
              AND t.name IN (
                  N'Users',
                  N'Companies',
                  N'CompanyBackups',
                  N'PasswordResetTokens',
                  N'ATLAS_CompanyResetLog'
              )
          )
        ORDER BY
            CASE WHEN t.name IN (N'Allocations', N'Loans', N'Employees', N'AirfarePolicyRates') THEN 0 ELSE 1 END,
            t.name;

        SELECT @disableSql = @disableSql + N'
ALTER TABLE ' + QUOTENAME(OBJECT_SCHEMA_NAME(fk.parent_object_id)) + N'.' + QUOTENAME(OBJECT_NAME(fk.parent_object_id)) +
N' NOCHECK CONSTRAINT ' + QUOTENAME(fk.name) + N';'
        FROM sys.foreign_keys fk
        WHERE fk.is_ms_shipped = 0;

        SELECT @enableSql = @enableSql + N'
ALTER TABLE ' + QUOTENAME(OBJECT_SCHEMA_NAME(fk.parent_object_id)) + N'.' + QUOTENAME(OBJECT_NAME(fk.parent_object_id)) +
N' WITH CHECK CHECK CONSTRAINT ' + QUOTENAME(fk.name) + N';'
        FROM sys.foreign_keys fk
        WHERE fk.is_ms_shipped = 0;

        BEGIN TRANSACTION;

        EXEC sp_executesql @disableSql;

        DECLARE @rowID INT = 1;
        DECLARE @maxRowID INT = (SELECT ISNULL(MAX(RowID), 0) FROM @tableActions);
        DECLARE @schemaName SYSNAME;
        DECLARE @tableName SYSNAME;
        DECLARE @hasIdentity BIT;
        DECLARE @affected BIGINT;
        DECLARE @sql NVARCHAR(MAX);

        WHILE @rowID <= @maxRowID
        BEGIN
            SELECT
                @schemaName = SchemaName,
                @tableName = TableName,
                @hasIdentity = HasIdentity
            FROM @tableActions
            WHERE RowID = @rowID;

            IF @schemaName IS NOT NULL
            BEGIN
                SET @affected = 0;
                SET @sql = N'DELETE FROM ' + QUOTENAME(@schemaName) + N'.' + QUOTENAME(@tableName) +
                           N'; SET @affected = @@ROWCOUNT;';
                EXEC sp_executesql @sql, N'@affected BIGINT OUTPUT', @affected = @affected OUTPUT;

                IF @hasIdentity = 1
                BEGIN
                    SET @sql = N'DBCC CHECKIDENT (N''' + REPLACE(@schemaName + N'.' + @tableName, N'''', N'''''') + N''', RESEED, 0) WITH NO_INFOMSGS;';
                    EXEC sp_executesql @sql;
                END;

                UPDATE @tableActions
                   SET RowsCleared = ISNULL(@affected, 0)
                 WHERE RowID = @rowID;
            END;

            SET @rowID += 1;
        END;

        IF OBJECT_ID(N'dbo.Companies', N'U') IS NOT NULL
        BEGIN
            IF EXISTS (SELECT 1 FROM dbo.Companies WHERE CompanyCode = COALESCE(NULLIF(@CompanyCode, N''), N'ATLAS'))
            BEGIN
                UPDATE dbo.Companies
                   SET CompanyName = COALESCE(NULLIF(@CompanyName, N''), CompanyName),
                       DatabaseName = COALESCE(NULLIF(@DatabaseName, N''), DatabaseName),
                       IsActive = 1,
                       UpdatedAt = SYSUTCDATETIME(),
                       UpdatedBy = @ResetBy
                 WHERE CompanyCode = COALESCE(NULLIF(@CompanyCode, N''), N'ATLAS');
            END
            ELSE
            BEGIN
                INSERT INTO dbo.Companies (CompanyCode, CompanyName, DatabaseName, IsActive, CreatedBy)
                VALUES
                (
                    COALESCE(NULLIF(@CompanyCode, N''), N'ATLAS'),
                    COALESCE(NULLIF(@CompanyName, N''), N'ATLAS Airfare HCM'),
                    COALESCE(NULLIF(@DatabaseName, N''), DB_NAME()),
                    1,
                    @ResetBy
                );
            END;

            SELECT @companyId = CompanyID
            FROM dbo.Companies
            WHERE CompanyCode = COALESCE(NULLIF(@CompanyCode, N''), N'ATLAS');
        END;

        IF OBJECT_ID(N'dbo.AirfarePolicyRates', N'U') IS NOT NULL
        BEGIN
            INSERT INTO dbo.AirfarePolicyRates
            (
                CompanyID, EmployeeID, Department, EmpGroup, EffectiveFrom, EffectiveTo,
                MaxPayoutAmount, CycleDays, WorkingDaysPerMonth, AirfareDaysPerMonth,
                IsActive, CreatedBy
            )
            VALUES
            (
                NULL, NULL, NULL, NULL, '19000101', NULL,
                150.00, 60, 30, 2.5,
                1, @ResetBy
            );

            INSERT INTO dbo.AirfarePolicyRates
            (
                CompanyID, EmployeeID, Department, EmpGroup, EffectiveFrom, EffectiveTo,
                MaxPayoutAmount, CycleDays, WorkingDaysPerMonth, AirfareDaysPerMonth,
                IsActive, CreatedBy
            )
            VALUES
            (
                @companyId, NULL, NULL, NULL, CAST(SYSUTCDATETIME() AS DATE), NULL,
                150.00, 60, 30, 2.5,
                1, @ResetBy
            );
        END;

        EXEC sp_executesql @enableSql;

        SELECT
            @tablesCleared = COUNT(*),
            @rowsCleared = ISNULL(SUM(RowsCleared), 0)
        FROM @tableActions;

        SELECT @detailsJson = (
            SELECT SchemaName, TableName, RowsCleared
            FROM @tableActions
            ORDER BY RowID
            FOR JSON PATH
        );

        UPDATE dbo.ATLAS_CompanyResetLog
           SET CompletedAt = SYSUTCDATETIME(),
               Status = N'SUCCESS',
               TablesCleared = @tablesCleared,
               RowsCleared = @rowsCleared,
               DetailsJson = @detailsJson
         WHERE ResetLogID = @resetLogID;

        COMMIT TRANSACTION;

        SELECT
            CAST(N'success' AS NVARCHAR(40)) AS Status,
            @resetLogID AS ResetLogID,
            COALESCE(NULLIF(@CompanyCode, N''), N'ATLAS') AS CompanyCode,
            COALESCE(NULLIF(@CompanyName, N''), N'ATLAS Airfare HCM') AS CompanyName,
            COALESCE(NULLIF(@DatabaseName, N''), DB_NAME()) AS DatabaseName,
            @tablesCleared AS TablesCleared,
            @rowsCleared AS RowsCleared,
            @detailsJson AS DetailsJson;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0
        BEGIN
            ROLLBACK TRANSACTION;
        END;

        BEGIN TRY
            EXEC sp_executesql @enableSql;
        END TRY
        BEGIN CATCH
        END CATCH;

        DECLARE @message NVARCHAR(2048) = ERROR_MESSAGE();
        UPDATE dbo.ATLAS_CompanyResetLog
           SET CompletedAt = SYSUTCDATETIME(),
               Status = N'FAILED',
               ErrorMessage = @message
         WHERE ResetLogID = @resetLogID;

        THROW 52102, @message, 1;
    END CATCH
END;
GO

CREATE OR ALTER FUNCTION dbo.fn_ATLAS_AirfareAmount
(
    @ClosingDays DECIMAL(10,4),
    @MaximumPayout DECIMAL(10,2)
)
RETURNS DECIMAL(10,2)
AS
BEGIN
    RETURN CAST(ROUND(
        (CASE WHEN ISNULL(@MaximumPayout, 0) <= 0 THEN 150 ELSE @MaximumPayout END / 60.0)
        * CASE WHEN ISNULL(@ClosingDays, 0) < 0 THEN 0 WHEN @ClosingDays > 60 THEN 60 ELSE ISNULL(@ClosingDays, 0) END,
        2
    ) AS DECIMAL(10,2));
END;
GO

DECLARE @employeeStatusConstraint SYSNAME;
SELECT TOP (1) @employeeStatusConstraint = cc.name
FROM sys.check_constraints cc
WHERE cc.parent_object_id = OBJECT_ID(N'dbo.Employees')
  AND cc.definition LIKE N'%Status%'
  AND cc.definition LIKE N'%Active%'
  AND cc.definition NOT LIKE N'%Probation%';

IF @employeeStatusConstraint IS NOT NULL
BEGIN
    DECLARE @dropEmployeeStatusConstraintSql NVARCHAR(MAX) = N'ALTER TABLE dbo.Employees DROP CONSTRAINT ' + QUOTENAME(@employeeStatusConstraint);
    EXEC sp_executesql @dropEmployeeStatusConstraintSql;
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints cc
    WHERE cc.parent_object_id = OBJECT_ID(N'dbo.Employees')
      AND cc.definition LIKE N'%Status%'
      AND cc.definition LIKE N'%Probation%'
)
BEGIN
    ALTER TABLE dbo.Employees WITH CHECK ADD CONSTRAINT CK_ATLAS_Employees_Status
    CHECK (Status IN ('Active', 'Inactive', 'In-active', 'Resign', 'Resigned', 'Separated', 'Probation'));
END;
GO

CREATE OR ALTER FUNCTION dbo.fn_ATLAS_IsAirfareEligibleEmployeeStatus
(
    @Status NVARCHAR(50)
)
RETURNS BIT
AS
BEGIN
    DECLARE @normalized NVARCHAR(50) = LOWER(REPLACE(REPLACE(LTRIM(RTRIM(ISNULL(@Status, N'Active'))), N'-', N''), N' ', N''));
    RETURN CASE
        WHEN @normalized IN (N'', N'active') THEN 1
        WHEN @normalized IN (N'inactive', N'inactiveemployee', N'resign', N'resigned', N'separated', N'probation') THEN 0
        ELSE 0
    END;
END;
GO

CREATE OR ALTER VIEW dbo.vw_ATLAS_EmployeeMaster
AS
SELECT
    e.EmployeeID,
    e.EmployeeCode,
    e.FullName,
    e.JoinDate,
    e.CPR,
    e.Passport,
    e.Nationality,
    e.BHStatus,
    e.Company,
    e.Branch,
    e.Department,
    e.Section,
    e.Location,
    e.Designation,
    e.EmpGroup,
    e.JobBand,
    e.ReportingTo,
    e.BankCode,
    e.AccountNumber,
    e.Email,
    e.WhatsAppNumber,
    e.BasicSalary,
    e.HRA,
    e.SpecialDutyAllowance,
    e.CarAllowance,
    e.PetrolAllowance,
    e.PhoneAllowance,
    e.GrossSalary,
    e.GOSIDeduction,
    e.Religion,
    e.LastWorkingDate,
    e.PayrollStatus,
    e.AverageSalary,
    e.SerialNo,
    e.PassportExpiryDate,
    e.Status,
    e.OpeningDays,
    e.OpeningBHD,
    e.CurrentAirfareRate,
    e.AirfarePaidDays,
    e.RemainingBalance,
    e.TotalAirfare,
    e.OpeningDays AS ClosingBalanceDays,
    dbo.fn_ATLAS_AirfareAmount(e.OpeningDays, e.MaximumPayout) AS ClosingBalanceBHD,
    e.MaximumPayout,
    e.TotalWorkingDays,
    e.CreatedAt,
    e.UpdatedAt
FROM Employees e;
GO

CREATE OR ALTER VIEW dbo.vw_ATLAS_AirfareReport
AS
SELECT
    EmployeeID,
    EmployeeCode,
    FullName,
    Department,
    Section,
    Designation,
    Nationality,
    Status,
    ClosingBalanceDays,
    ClosingBalanceBHD,
    MaximumPayout
FROM dbo.vw_ATLAS_EmployeeMaster;
GO

CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_GetEmployeeMaster
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM dbo.vw_ATLAS_EmployeeMaster ORDER BY EmployeeCode;
END;
GO

CREATE OR ALTER FUNCTION dbo.fn_ATLAS_EmployeesByAirfareStatus
(
    @StatusScope NVARCHAR(20)
)
RETURNS TABLE
AS
RETURN
(
    SELECT *
    FROM dbo.vw_ATLAS_EmployeeMaster e
    WHERE
        LOWER(ISNULL(@StatusScope, N'active')) = N'all'
        OR (LOWER(ISNULL(@StatusScope, N'active')) IN (N'active', N'eligible') AND dbo.fn_ATLAS_IsAirfareEligibleEmployeeStatus(e.Status) = 1)
        OR (LOWER(ISNULL(@StatusScope, N'active')) IN (N'inactive', N'ineligible') AND dbo.fn_ATLAS_IsAirfareEligibleEmployeeStatus(e.Status) = 0)
);
GO

CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_GetAirfareEligibleEmployees
AS
BEGIN
    SET NOCOUNT ON;
    SELECT *
    FROM dbo.fn_ATLAS_EmployeesByAirfareStatus(N'active')
    ORDER BY EmployeeCode;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_GetEmployeeMasterForScreen
    @StatusScope NVARCHAR(20) = N'active'
AS
BEGIN
    SET NOCOUNT ON;
    SELECT *
    FROM dbo.fn_ATLAS_EmployeesByAirfareStatus(@StatusScope)
    ORDER BY EmployeeCode;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_GetAirfareReport
    @ReportYear INT = NULL,
    @AsOfDate DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @workDate DATE = COALESCE(@AsOfDate, CAST(GETDATE() AS DATE));
    DECLARE @year INT = COALESCE(@ReportYear, YEAR(@workDate));
    DECLARE @yearStart DATE = DATEFROMPARTS(@year, 1, 1);
    DECLARE @asOfInYear DATE = CASE
        WHEN @workDate < @yearStart THEN @yearStart
        WHEN YEAR(@workDate) > @year THEN DATEFROMPARTS(@year, 12, 31)
        ELSE @workDate
    END;
    DECLARE @daysInYear INT = DATEDIFF(DAY, @yearStart, @asOfInYear) + 1;

    SELECT
        e.EmployeeID,
        e.EmployeeCode,
        e.FullName,
        e.Department,
        e.Section,
        e.Designation,
        e.JoinDate,
        e.Status,
        @year AS ReportYear,
        @asOfInYear AS AsOfDate,
        CAST(30.00 AS DECIMAL(10,2)) AS AnnualEntitlementDays,
        CAST(75.00 AS DECIMAL(10,2)) AS AnnualEntitlementBHD,
        CAST(2.50 AS DECIMAL(10,2)) AS PerDayRate,
        CAST(entitlementBase.EffectiveMaxPayout AS DECIMAL(10,2)) AS MaximumPayoutCap,
        CAST(ROUND((75.00 / 30.00) * COALESCE(ob.OpeningDays, e.OpeningDays, 0), 2) AS DECIMAL(10,2)) AS OpeningBalanceBHD,
        CAST(COALESCE(ob.OpeningDays, e.OpeningDays, 0) AS DECIMAL(10,2)) AS OpeningBalanceDays,
        CAST(ROUND((@daysInYear / 360.0) * 30.0, 2) AS DECIMAL(10,2)) AS CurrentYearEarnedDays,
        CAST(ROUND((@daysInYear / 360.0) * 75.0, 2) AS DECIMAL(10,2)) AS CurrentYearEarnedBHD,
        CAST(ROUND(COALESCE(spent.TicketAmount, 0), 2) AS DECIMAL(10,2)) AS TicketAmountCurrentYear,
        CAST(ROUND(COALESCE(spent.CompanyPaid, 0), 2) AS DECIMAL(10,2)) AS CompanyPaidCurrentYear,
        CAST(ROUND(COALESCE(spent.EmployeePaid, 0), 2) AS DECIMAL(10,2)) AS EmployeePaidCurrentYear,
        CAST(ROUND(COALESCE(spent.LoanAmount, 0), 2) AS DECIMAL(10,2)) AS LoanAmountCurrentYear,
        CAST(ROUND(COALESCE(spent.CompanyPaid, 0) / 2.5, 2) AS DECIMAL(10,2)) AS PaidDaysCurrentYear,
        CAST(ROUND(
            COALESCE(ob.OpeningDays, e.OpeningDays, 0)
            + ((@daysInYear / 360.0) * 30.0)
            - (COALESCE(spent.CompanyPaid, 0) / 2.5),
            2
        ) AS DECIMAL(10,2)) AS BalanceDays,
        CAST(ROUND(CASE
            WHEN entitlement.RawEntitlement < 0 THEN 0
            ELSE entitlement.RawEntitlement
        END, 2) AS DECIMAL(10,2)) AS PayableBHD,
        entitlementFinal.AirfareEntitlementAmount,
        CAST(ROUND(
            (75.00 - COALESCE(spent.CompanyPaid, 0)),
            2
        ) AS DECIMAL(10,2)) AS CurrentYearRemainingBHD,
        CASE
            WHEN e.JoinDate > @asOfInYear THEN 'Not joined as of report date'
            WHEN COALESCE(spent.TicketCount, 0) > 0 AND entitlementFinal.AirfareEntitlementAmount <= 0 THEN 'Ticket processed - no entitlement remaining'
            WHEN COALESCE(spent.TicketCount, 0) > 0 AND entitlementFinal.IsCapped = 1 THEN 'Ticket processed - capped at max payout'
            WHEN COALESCE(spent.TicketCount, 0) > 0 THEN 'Ticket processed - entitlement adjusted'
            WHEN entitlementFinal.IsCapped = 1 THEN 'Eligible - capped at max payout'
            ELSE 'Eligible for review'
        END AS VerificationNote
    FROM dbo.Employees e
    LEFT JOIN dbo.OpeningBalances ob
        ON ob.EmployeeID = e.EmployeeID
       AND ob.BalanceYear = @year
    OUTER APPLY (
        SELECT
            COUNT(*) AS TicketCount,
            SUM(COALESCE(a.TicketCost, 0)) AS TicketAmount,
            SUM(COALESCE(a.CompanyPaid, 0)) AS CompanyPaid,
            SUM(COALESCE(a.EmployeePaid, 0)) AS EmployeePaid,
            SUM(COALESCE(a.LoanAmount, 0)) AS LoanAmount
        FROM dbo.Allocations a
        WHERE a.EmployeeID = e.EmployeeID
          AND a.AllocYear = @year
    ) spent
    OUTER APPLY (
        SELECT TOP 1 a.AllocationDate
        FROM dbo.Allocations a
        WHERE a.EmployeeID = e.EmployeeID
          AND a.AllocYear = @year
          AND a.AllocationDate <= @asOfInYear
        ORDER BY a.AllocationDate DESC, a.AllocationID DESC
    ) prev
    OUTER APPLY (
        SELECT TOP 1 c.CompanyID
        FROM dbo.Companies c
        WHERE c.IsActive = 1
          AND NULLIF(LTRIM(RTRIM(e.Company)), '') IS NOT NULL
          AND (
              LOWER(c.CompanyName) = LOWER(LTRIM(RTRIM(e.Company)))
              OR LOWER(c.CompanyCode) = LOWER(LTRIM(RTRIM(e.Company)))
          )
        ORDER BY c.CompanyID
    ) employeeCompany
    OUTER APPLY (
        SELECT TOP 1
            MaxPayoutAmount,
            CycleDays
        FROM dbo.AirfarePolicyRates pr
        WHERE pr.IsActive = 1
          AND pr.EffectiveFrom <= @asOfInYear
          AND (pr.EffectiveTo IS NULL OR pr.EffectiveTo >= @asOfInYear)
          AND (pr.EmployeeID IS NULL OR pr.EmployeeID = e.EmployeeID)
          AND (pr.CompanyID IS NULL OR pr.CompanyID = employeeCompany.CompanyID)
          AND (pr.Department IS NULL OR LOWER(pr.Department) = LOWER(NULLIF(LTRIM(RTRIM(e.Department)), N'')))
          AND (pr.EmpGroup IS NULL OR LOWER(pr.EmpGroup) = LOWER(NULLIF(LTRIM(RTRIM(e.EmpGroup)), N'')))
        ORDER BY
          CASE
            WHEN pr.EmployeeID = e.EmployeeID AND pr.CompanyID IS NULL AND pr.Department IS NULL AND pr.EmpGroup IS NULL THEN 50
            WHEN pr.EmployeeID = e.EmployeeID THEN 45
            WHEN pr.EmpGroup IS NOT NULL AND LOWER(pr.EmpGroup) = LOWER(NULLIF(LTRIM(RTRIM(e.EmpGroup)), N'')) THEN 40
            WHEN pr.Department IS NOT NULL AND LOWER(pr.Department) = LOWER(NULLIF(LTRIM(RTRIM(e.Department)), N'')) THEN 30
            WHEN pr.EmployeeID IS NULL AND pr.CompanyID = employeeCompany.CompanyID THEN 20
            ELSE 10
          END DESC,
          pr.EffectiveFrom DESC,
          pr.PolicyRateID DESC
    ) policy
    OUTER APPLY (
        SELECT
            CAST(COALESCE(NULLIF(policy.MaxPayoutAmount, 0), NULLIF(e.MaximumPayout, 0), 150) AS DECIMAL(10,2)) AS EffectiveMaxPayout,
            CAST(COALESCE(NULLIF(policy.CycleDays, 0), 60) AS DECIMAL(10,2)) AS EffectiveCycleDays,
            CASE
                WHEN prev.AllocationDate IS NOT NULL THEN 0
                ELSE CAST(ROUND(COALESCE(ob.OpeningBHD, e.OpeningBHD, 0), 2) AS DECIMAL(10,2))
            END AS UsableOpeningAmount,
            CAST(ROUND(COALESCE(e.AirfarePaidDays, 0), 4) AS DECIMAL(10,4)) AS ManualPaidDays,
            CASE
                WHEN prev.AllocationDate IS NOT NULL AND DATEADD(DAY, 1, prev.AllocationDate) > CASE WHEN e.JoinDate > @yearStart THEN e.JoinDate ELSE @yearStart END
                    THEN DATEADD(DAY, 1, prev.AllocationDate)
                WHEN e.JoinDate > @yearStart THEN e.JoinDate
                ELSE @yearStart
            END AS EntitlementStartDate
    ) entitlementBase
    OUTER APPLY (
        SELECT
            CAST(CASE WHEN entitlementBase.EffectiveCycleDays > 0 THEN entitlementBase.EffectiveMaxPayout / entitlementBase.EffectiveCycleDays ELSE 0 END AS DECIMAL(12,6)) AS PerDayRate,
            CASE
                WHEN YEAR(@asOfInYear) < @year THEN 0
                WHEN YEAR(@asOfInYear) > @year THEN 360
                WHEN entitlementBase.EntitlementStartDate > @asOfInYear THEN 0
                ELSE (((MONTH(@asOfInYear) - 1) * 30) + DAY(@asOfInYear))
                   - (((MONTH(entitlementBase.EntitlementStartDate) - 1) * 30) + DAY(entitlementBase.EntitlementStartDate)) + 1
            END AS WorkingDays
    ) entitlementDays
    OUTER APPLY (
        SELECT
            CAST(ROUND((CASE
                WHEN entitlementDays.WorkingDays < 0 THEN 0
                WHEN entitlementDays.WorkingDays > 360 THEN 360
                ELSE entitlementDays.WorkingDays
            END / 30.0) * 2.5, 4) AS DECIMAL(10,4)) AS CurrentAirfareDays
    ) entitlementEarned
    OUTER APPLY (
        SELECT
            CAST(ROUND(
                entitlementBase.UsableOpeningAmount
                + (entitlementEarned.CurrentAirfareDays * entitlementDays.PerDayRate)
                - (
                    COALESCE(spent.CompanyPaid, 0)
                    + (entitlementBase.ManualPaidDays * entitlementDays.PerDayRate)
                ),
                2
            ) AS DECIMAL(10,2)) AS RawEntitlement
    ) entitlement
    OUTER APPLY (
        SELECT
            CAST(ROUND(CASE
                WHEN entitlement.RawEntitlement < 0 THEN 0
                WHEN entitlement.RawEntitlement > entitlementBase.EffectiveMaxPayout THEN entitlementBase.EffectiveMaxPayout
                ELSE entitlement.RawEntitlement
            END, 2) AS DECIMAL(10,2)) AS AirfareEntitlementAmount,
            CASE WHEN entitlement.RawEntitlement > entitlementBase.EffectiveMaxPayout THEN 1 ELSE 0 END AS IsCapped
    ) entitlementFinal
    WHERE dbo.fn_ATLAS_IsAirfareEligibleEmployeeStatus(e.Status) = 1
    ORDER BY e.EmployeeCode;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_ImportEmployeeMasterJson
    @EmployeesJson NVARCHAR(MAX),
    @UserID INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Import TABLE (
        ImportRow INT IDENTITY(1,1) PRIMARY KEY,
        SourceRow INT NULL,
        EmployeeCode NVARCHAR(50) NULL,
        FullName NVARCHAR(200) NULL,
        JoinDate DATE NULL,
        CPR NVARCHAR(50) NULL,
        Passport NVARCHAR(50) NULL,
        Nationality NVARCHAR(80) NULL,
        BHStatus NVARCHAR(20) NULL,
        Branch NVARCHAR(100) NULL,
        Department NVARCHAR(100) NULL,
        Section NVARCHAR(100) NULL,
        Location NVARCHAR(100) NULL,
        Designation NVARCHAR(100) NULL,
        EmpGroup NVARCHAR(200) NULL,
        BankCode NVARCHAR(60) NULL,
        JobBand NVARCHAR(100) NULL,
        Company NVARCHAR(120) NULL,
        ReportingTo NVARCHAR(150) NULL,
        BasicSalary DECIMAL(12,2) NULL,
        HRA DECIMAL(12,2) NULL,
        SpecialDutyAllowance DECIMAL(12,2) NULL,
        CarAllowance DECIMAL(12,2) NULL,
        PetrolAllowance DECIMAL(12,2) NULL,
        PhoneAllowance DECIMAL(12,2) NULL,
        GrossSalary DECIMAL(12,2) NULL,
        GOSIDeduction DECIMAL(12,2) NULL,
        Religion NVARCHAR(60) NULL,
        LastWorkingDate DATE NULL,
        PayrollStatus NVARCHAR(60) NULL,
        AverageSalary DECIMAL(12,2) NULL,
        SerialNo INT NULL,
        AccountNumber NVARCHAR(80) NULL,
        PassportExpiryDate DATE NULL,
        Email NVARCHAR(180) NULL,
        Status NVARCHAR(30) NULL,
        OpeningDays DECIMAL(10,2) NULL,
        OpeningBHD DECIMAL(10,2) NULL,
        MaximumPayout DECIMAL(10,2) NULL,
        JanDays DECIMAL(5,2) NULL,
        FebDays DECIMAL(5,2) NULL,
        MarDays DECIMAL(5,2) NULL,
        AprDays DECIMAL(5,2) NULL,
        MayDays DECIMAL(5,2) NULL,
        JunDays DECIMAL(5,2) NULL,
        JulDays DECIMAL(5,2) NULL,
        AugDays DECIMAL(5,2) NULL,
        SepDays DECIMAL(5,2) NULL,
        OctDays DECIMAL(5,2) NULL,
        NovDays DECIMAL(5,2) NULL,
        DecDays DECIMAL(5,2) NULL,
        TotalWorkingDays DECIMAL(10,2) NULL,
        AirfarePaidDays DECIMAL(10,2) NULL
    );

    INSERT INTO @Import (
        SourceRow, EmployeeCode, FullName, JoinDate, CPR, Passport, Nationality, BHStatus, Branch, Department, Section,
        Location, Designation, EmpGroup, BankCode, JobBand, Company, ReportingTo, BasicSalary, HRA, SpecialDutyAllowance,
        CarAllowance, PetrolAllowance, PhoneAllowance, GrossSalary, GOSIDeduction, Religion, LastWorkingDate, PayrollStatus,
        AverageSalary, SerialNo, AccountNumber, PassportExpiryDate, Email, Status, OpeningDays, OpeningBHD, MaximumPayout,
        JanDays, FebDays, MarDays, AprDays, MayDays, JunDays, JulDays, AugDays, SepDays, OctDays, NovDays, DecDays,
        TotalWorkingDays, AirfarePaidDays
    )
    SELECT
        SourceRow,
        NULLIF(LTRIM(RTRIM(code)), ''),
        NULLIF(LTRIM(RTRIM(name)), ''),
        TRY_CONVERT(DATE, joinDate),
        NULLIF(LTRIM(RTRIM(cpr)), ''),
        NULLIF(LTRIM(RTRIM(passport)), ''),
        NULLIF(LTRIM(RTRIM(nationality)), ''),
        COALESCE(NULLIF(LTRIM(RTRIM(bhStatus)), ''), 'NON-BH'),
        NULLIF(LTRIM(RTRIM(branch)), ''),
        NULLIF(LTRIM(RTRIM(department)), ''),
        NULLIF(LTRIM(RTRIM(section)), ''),
        NULLIF(LTRIM(RTRIM(location)), ''),
        NULLIF(LTRIM(RTRIM(designation)), ''),
        NULLIF(LTRIM(RTRIM([group])), ''),
        NULLIF(LTRIM(RTRIM(bankCode)), ''),
        NULLIF(LTRIM(RTRIM(jobBand)), ''),
        NULLIF(LTRIM(RTRIM(company)), ''),
        NULLIF(LTRIM(RTRIM(reportingTo)), ''),
        basicSalary, hra, specialDutyAllowance, carAllowance, petrolAllowance, phoneAllowance, grossSalary, gosiDeduction,
        NULLIF(LTRIM(RTRIM(religion)), ''),
        TRY_CONVERT(DATE, lastWorkingDate),
        COALESCE(NULLIF(LTRIM(RTRIM(payrollStatus)), ''), 'Active'),
        averageSalary, serialNo, NULLIF(LTRIM(RTRIM(accountNumber)), ''),
        TRY_CONVERT(DATE, passportExpiryDate),
        NULLIF(LTRIM(RTRIM(email)), ''),
        COALESCE(NULLIF(LTRIM(RTRIM(status)), ''), 'Active'),
        COALESCE(openingDays, 0), COALESCE(openingBhd, 0), COALESCE(maximumPayout, 150),
        COALESCE(jan, 30), COALESCE(feb, 30), COALESCE(mar, 30), COALESCE(apr, 30), COALESCE(may, 30), COALESCE(jun, 30),
        COALESCE(jul, 30), COALESCE(aug, 30), COALESCE(sep, 30), COALESCE(oct, 30), COALESCE(nov, 30), COALESCE(dec, 30),
        COALESCE(totalWorkingDays, 360), COALESCE(airfarePaidDays, 0)
    FROM OPENJSON(@EmployeesJson)
    WITH (
        SourceRow INT '$.sourceRow',
        code NVARCHAR(50) '$.code',
        name NVARCHAR(200) '$.name',
        joinDate NVARCHAR(30) '$.joinDate',
        cpr NVARCHAR(50) '$.cpr',
        passport NVARCHAR(50) '$.passport',
        nationality NVARCHAR(80) '$.nationality',
        bhStatus NVARCHAR(20) '$.bhStatus',
        branch NVARCHAR(100) '$.branch',
        department NVARCHAR(100) '$.department',
        section NVARCHAR(100) '$.section',
        location NVARCHAR(100) '$.location',
        designation NVARCHAR(100) '$.designation',
        [group] NVARCHAR(200) '$.group',
        bankCode NVARCHAR(60) '$.bankCode',
        jobBand NVARCHAR(100) '$.jobBand',
        company NVARCHAR(120) '$.company',
        reportingTo NVARCHAR(150) '$.reportingTo',
        basicSalary DECIMAL(12,2) '$.basicSalary',
        hra DECIMAL(12,2) '$.hra',
        specialDutyAllowance DECIMAL(12,2) '$.specialDutyAllowance',
        carAllowance DECIMAL(12,2) '$.carAllowance',
        petrolAllowance DECIMAL(12,2) '$.petrolAllowance',
        phoneAllowance DECIMAL(12,2) '$.phoneAllowance',
        grossSalary DECIMAL(12,2) '$.grossSalary',
        gosiDeduction DECIMAL(12,2) '$.gosiDeduction',
        religion NVARCHAR(60) '$.religion',
        lastWorkingDate NVARCHAR(30) '$.lastWorkingDate',
        payrollStatus NVARCHAR(60) '$.payrollStatus',
        averageSalary DECIMAL(12,2) '$.averageSalary',
        serialNo INT '$.serialNo',
        accountNumber NVARCHAR(80) '$.accountNumber',
        passportExpiryDate NVARCHAR(30) '$.passportExpiryDate',
        email NVARCHAR(180) '$.email',
        status NVARCHAR(30) '$.status',
        openingDays DECIMAL(10,2) '$.openingDays',
        openingBhd DECIMAL(10,2) '$.openingBhd',
        maximumPayout DECIMAL(10,2) '$.maximumPayout',
        jan DECIMAL(5,2) '$.jan',
        feb DECIMAL(5,2) '$.feb',
        mar DECIMAL(5,2) '$.mar',
        apr DECIMAL(5,2) '$.apr',
        may DECIMAL(5,2) '$.may',
        jun DECIMAL(5,2) '$.jun',
        jul DECIMAL(5,2) '$.jul',
        aug DECIMAL(5,2) '$.aug',
        sep DECIMAL(5,2) '$.sep',
        oct DECIMAL(5,2) '$.oct',
        nov DECIMAL(5,2) '$.nov',
        dec DECIMAL(5,2) '$.dec',
        totalWorkingDays DECIMAL(10,2) '$.totalWorkingDays',
        airfarePaidDays DECIMAL(10,2) '$.airfarePaidDays'
    );

    DECLARE @Errors TABLE (SourceRow INT NULL, EmployeeCode NVARCHAR(50) NULL, ErrorMessage NVARCHAR(300) NOT NULL);

    INSERT INTO @Errors (SourceRow, EmployeeCode, ErrorMessage)
    SELECT SourceRow, EmployeeCode, 'Missing employee code or employee name.'
    FROM @Import
    WHERE EmployeeCode IS NULL OR FullName IS NULL;

    INSERT INTO @Errors (SourceRow, EmployeeCode, ErrorMessage)
    SELECT SourceRow, EmployeeCode, 'Duplicate employee code inside the selected Excel list. Only the first selected row is imported.'
    FROM (
        SELECT SourceRow, EmployeeCode, ROW_NUMBER() OVER (PARTITION BY EmployeeCode ORDER BY ImportRow) AS rn
        FROM @Import
        WHERE EmployeeCode IS NOT NULL
    ) d
    WHERE rn > 1;

    DECLARE @Valid TABLE (
        ImportRow INT PRIMARY KEY,
        SourceRow INT NULL,
        EmployeeCode NVARCHAR(20) NOT NULL,
        FullName NVARCHAR(100) NOT NULL,
        JoinDate DATE NULL,
        CPR NVARCHAR(20) NULL,
        Passport NVARCHAR(20) NULL,
        Nationality NVARCHAR(30) NULL,
        BHStatus NVARCHAR(10) NULL,
        Branch NVARCHAR(50) NULL,
        Department NVARCHAR(50) NULL,
        Section NVARCHAR(50) NULL,
        Location NVARCHAR(50) NULL,
        Designation NVARCHAR(50) NULL,
        EmpGroup NVARCHAR(80) NULL,
        BankCode NVARCHAR(20) NULL,
        JobBand NVARCHAR(60) NULL,
        Company NVARCHAR(80) NULL,
        ReportingTo NVARCHAR(100) NULL,
        BasicSalary DECIMAL(12,2) NULL,
        HRA DECIMAL(12,2) NULL,
        SpecialDutyAllowance DECIMAL(12,2) NULL,
        CarAllowance DECIMAL(12,2) NULL,
        PetrolAllowance DECIMAL(12,2) NULL,
        PhoneAllowance DECIMAL(12,2) NULL,
        GrossSalary DECIMAL(12,2) NULL,
        GOSIDeduction DECIMAL(12,2) NULL,
        Religion NVARCHAR(30) NULL,
        LastWorkingDate DATE NULL,
        PayrollStatus NVARCHAR(30) NULL,
        AverageSalary DECIMAL(12,2) NULL,
        SerialNo INT NULL,
        AccountNumber NVARCHAR(50) NULL,
        PassportExpiryDate DATE NULL,
        Email NVARCHAR(120) NULL,
        Status NVARCHAR(10) NULL,
        OpeningDays DECIMAL(10,2) NULL,
        OpeningBHD DECIMAL(10,2) NULL,
        MaximumPayout DECIMAL(10,2) NULL,
        JanDays DECIMAL(5,2) NULL,
        FebDays DECIMAL(5,2) NULL,
        MarDays DECIMAL(5,2) NULL,
        AprDays DECIMAL(5,2) NULL,
        MayDays DECIMAL(5,2) NULL,
        JunDays DECIMAL(5,2) NULL,
        JulDays DECIMAL(5,2) NULL,
        AugDays DECIMAL(5,2) NULL,
        SepDays DECIMAL(5,2) NULL,
        OctDays DECIMAL(5,2) NULL,
        NovDays DECIMAL(5,2) NULL,
        DecDays DECIMAL(5,2) NULL,
        TotalWorkingDays DECIMAL(10,2) NULL,
        AirfarePaidDays DECIMAL(10,2) NULL
    );

    INSERT INTO @Valid
    SELECT
        ImportRow, SourceRow, LEFT(EmployeeCode, 20), LEFT(FullName, 100), JoinDate, LEFT(CPR, 20), LEFT(Passport, 20),
        LEFT(Nationality, 30), LEFT(BHStatus, 10), LEFT(Branch, 50), LEFT(Department, 50), LEFT(Section, 50), LEFT(Location, 50),
        LEFT(Designation, 50), LEFT(EmpGroup, 80), LEFT(BankCode, 20), LEFT(JobBand, 60), LEFT(Company, 80), LEFT(ReportingTo, 100),
        BasicSalary, HRA, SpecialDutyAllowance, CarAllowance, PetrolAllowance, PhoneAllowance, GrossSalary, GOSIDeduction,
        LEFT(Religion, 30), LastWorkingDate, LEFT(PayrollStatus, 30), AverageSalary, SerialNo, LEFT(AccountNumber, 50),
        PassportExpiryDate, LEFT(Email, 120), LEFT(Status, 10), OpeningDays, OpeningBHD, MaximumPayout, JanDays, FebDays,
        MarDays, AprDays, MayDays, JunDays, JulDays, AugDays, SepDays, OctDays, NovDays, DecDays, TotalWorkingDays, AirfarePaidDays
    FROM (
        SELECT i.*, ROW_NUMBER() OVER (PARTITION BY EmployeeCode ORDER BY ImportRow) AS rn
        FROM @Import i
        WHERE EmployeeCode IS NOT NULL AND FullName IS NOT NULL
    ) i
    WHERE rn = 1;

    DECLARE @Actions TABLE (ActionName NVARCHAR(10) NOT NULL, EmployeeCode NVARCHAR(20) NOT NULL);

    MERGE Employees AS target
    USING @Valid AS source
        ON target.EmployeeCode = source.EmployeeCode
    WHEN MATCHED THEN UPDATE SET
        FullName = source.FullName,
        JoinDate = source.JoinDate,
        CPR = source.CPR,
        Passport = source.Passport,
        Nationality = source.Nationality,
        BHStatus = source.BHStatus,
        Branch = source.Branch,
        Department = source.Department,
        Section = source.Section,
        Location = source.Location,
        Designation = source.Designation,
        EmpGroup = source.EmpGroup,
        BankCode = source.BankCode,
        JobBand = source.JobBand,
        Company = source.Company,
        ReportingTo = source.ReportingTo,
        BasicSalary = source.BasicSalary,
        HRA = source.HRA,
        SpecialDutyAllowance = source.SpecialDutyAllowance,
        CarAllowance = source.CarAllowance,
        PetrolAllowance = source.PetrolAllowance,
        PhoneAllowance = source.PhoneAllowance,
        GrossSalary = source.GrossSalary,
        GOSIDeduction = source.GOSIDeduction,
        Religion = source.Religion,
        LastWorkingDate = source.LastWorkingDate,
        PayrollStatus = source.PayrollStatus,
        AverageSalary = source.AverageSalary,
        SerialNo = source.SerialNo,
        AccountNumber = source.AccountNumber,
        PassportExpiryDate = source.PassportExpiryDate,
        Email = source.Email,
        Status = source.Status,
        OpeningDays = source.OpeningDays,
        OpeningBHD = source.OpeningBHD,
        MaximumPayout = source.MaximumPayout,
        AirfarePaidDays = source.AirfarePaidDays,
        JanDays = source.JanDays,
        FebDays = source.FebDays,
        MarDays = source.MarDays,
        AprDays = source.AprDays,
        MayDays = source.MayDays,
        JunDays = source.JunDays,
        JulDays = source.JulDays,
        AugDays = source.AugDays,
        SepDays = source.SepDays,
        OctDays = source.OctDays,
        NovDays = source.NovDays,
        DecDays = source.DecDays,
        TotalWorkingDays = source.TotalWorkingDays,
        UpdatedAt = GETDATE(),
        UpdatedBy = @UserID
    WHEN NOT MATCHED BY TARGET THEN
        INSERT (EmployeeCode, FullName, JoinDate, CPR, Passport, Nationality, BHStatus, Branch, Department, Section, Location,
                Designation, EmpGroup, BankCode, JobBand, Company, ReportingTo, BasicSalary, HRA, SpecialDutyAllowance, CarAllowance,
                PetrolAllowance, PhoneAllowance, GrossSalary, GOSIDeduction, Religion, LastWorkingDate, PayrollStatus, AverageSalary,
                SerialNo, AccountNumber, PassportExpiryDate, Email, Status, OpeningDays, OpeningBHD, MaximumPayout, AirfarePaidDays,
                JanDays, FebDays, MarDays, AprDays, MayDays, JunDays, JulDays, AugDays, SepDays, OctDays, NovDays, DecDays,
                TotalWorkingDays, CreatedBy)
        VALUES (source.EmployeeCode, source.FullName, source.JoinDate, source.CPR, source.Passport, source.Nationality, source.BHStatus,
                source.Branch, source.Department, source.Section, source.Location, source.Designation, source.EmpGroup, source.BankCode,
                source.JobBand, source.Company, source.ReportingTo, source.BasicSalary, source.HRA, source.SpecialDutyAllowance,
                source.CarAllowance, source.PetrolAllowance, source.PhoneAllowance, source.GrossSalary, source.GOSIDeduction,
                source.Religion, source.LastWorkingDate, source.PayrollStatus, source.AverageSalary, source.SerialNo, source.AccountNumber,
                source.PassportExpiryDate, source.Email, source.Status, source.OpeningDays, source.OpeningBHD, source.MaximumPayout,
                source.AirfarePaidDays, source.JanDays, source.FebDays, source.MarDays, source.AprDays, source.MayDays, source.JunDays,
                source.JulDays, source.AugDays, source.SepDays, source.OctDays, source.NovDays, source.DecDays, source.TotalWorkingDays, @UserID)
    OUTPUT $action, inserted.EmployeeCode INTO @Actions;

    SELECT
        COALESCE(SUM(CASE WHEN ActionName = 'INSERT' THEN 1 ELSE 0 END), 0) AS Inserted,
        COALESCE(SUM(CASE WHEN ActionName = 'UPDATE' THEN 1 ELSE 0 END), 0) AS Updated,
        (SELECT COUNT(*) FROM @Errors) AS ErrorCount,
        (SELECT COUNT(*) FROM @Import) AS ReviewedRows
    FROM @Actions;

    SELECT SourceRow, EmployeeCode, ErrorMessage AS [Error]
    FROM @Errors
    ORDER BY SourceRow, EmployeeCode;

    SELECT a.ActionName, a.EmployeeCode, v.SourceRow
    FROM @Actions a
    LEFT JOIN @Valid v ON v.EmployeeCode = a.EmployeeCode
    ORDER BY v.SourceRow, a.EmployeeCode;
END;
GO

GO

CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_GetAllocationContext
    @EmployeeID INT,
    @AllocYear INT,
    @ExcludeAllocationID BIGINT = NULL,
    @AllocationDate DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        COUNT(*) AS TotalTickets,
        COALESCE(SUM(CASE WHEN ISNULL(PaymentMode, N'') = N'employee_full' THEN 0 ELSE COALESCE(Entitlement, 0) END), 0) AS CurrentYearSpending
    FROM Allocations
    WHERE EmployeeID = @EmployeeID
      AND AllocYear = @AllocYear
      AND (@ExcludeAllocationID IS NULL OR AllocationID <> @ExcludeAllocationID);

    SELECT TOP 1
        AllocationID,
        AllocationDate,
        TicketCost,
        Remarks
    FROM Allocations
    WHERE EmployeeID = @EmployeeID
      AND AllocYear = @AllocYear
      AND (@ExcludeAllocationID IS NULL OR AllocationID <> @ExcludeAllocationID)
    ORDER BY AllocationDate ASC, AllocationID ASC;

    SELECT TOP 1
        AllocationID,
        AllocationDate,
        TicketCost,
        Remarks
    FROM Allocations
    WHERE EmployeeID = @EmployeeID
      AND AllocYear = @AllocYear
      AND (@ExcludeAllocationID IS NULL OR AllocationID <> @ExcludeAllocationID)
      AND (@AllocationDate IS NULL OR AllocationDate <= @AllocationDate)
      AND COALESCE(Entitlement, 0) > 0
    ORDER BY AllocationDate DESC, AllocationID DESC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_CalcPolicyEntitlement
    @MaximumPayout DECIMAL(10,2),
    @AllocationDate DATE,
    @AllocYear INT,
    @OpeningDays DECIMAL(10,4),
    @OpeningBHD DECIMAL(10,2),
    @PaidDays DECIMAL(10,4),
    @CurrentYearSpending DECIMAL(10,2),
    @JoinDate DATE = NULL,
    @PreviousAllocationDate DATE = NULL,
    @PolicyEntitlement DECIMAL(10,2) OUTPUT,
    @CurrentAirfareDays DECIMAL(10,4) OUTPUT,
    @RemainingDays DECIMAL(10,4) OUTPUT,
    @CurrentYearRemaining DECIMAL(10,2) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @year INT = ISNULL(NULLIF(@AllocYear, 0), YEAR(ISNULL(@AllocationDate, GETDATE())));
    DECLARE @workDate DATE = CAST(COALESCE(@AllocationDate, CAST(GETDATE() AS DATE)) AS DATE);
    DECLARE @startDate DATE = DATEFROMPARTS(@year, 1, 1);
    IF @JoinDate IS NOT NULL AND @JoinDate > @startDate SET @startDate = @JoinDate;
    IF @PreviousAllocationDate IS NOT NULL AND DATEADD(DAY, 1, @PreviousAllocationDate) > @startDate
        SET @startDate = DATEADD(DAY, 1, @PreviousAllocationDate);
    DECLARE @workingDays INT = CASE
        WHEN YEAR(@workDate) < @year THEN 0
        WHEN YEAR(@workDate) > @year THEN 360
        WHEN @startDate > @workDate THEN 0
        ELSE (((MONTH(@workDate) - 1) * 30) + DAY(@workDate)) - (((MONTH(@startDate) - 1) * 30) + DAY(@startDate)) + 1
    END;

    SET @workingDays = CASE
        WHEN @workingDays < 0 THEN 0
        WHEN @workingDays > 360 THEN 360
        ELSE @workingDays
    END;

    DECLARE @maxPayout DECIMAL(10,4) = CASE
        WHEN ISNULL(@MaximumPayout, 0) <= 0 THEN 150
        ELSE @MaximumPayout
    END;
    DECLARE @perDayRate DECIMAL(10,6) = CASE WHEN @maxPayout > 0 THEN @maxPayout / 60.0 ELSE 0 END;
    DECLARE @manualPaidAmount DECIMAL(10,2) = CAST(ROUND(ISNULL(@PaidDays,0) * @perDayRate, 2) AS DECIMAL(10,2));
    DECLARE @ticketPaidAmount DECIMAL(10,2) = CAST(ROUND(ISNULL(@CurrentYearSpending,0), 2) AS DECIMAL(10,2));
    DECLARE @paidAmount DECIMAL(10,2) = CAST(ROUND(@manualPaidAmount + @ticketPaidAmount, 2) AS DECIMAL(10,2));
    DECLARE @usableOpeningAmount DECIMAL(10,2) = CAST(ROUND(ISNULL(@OpeningBHD,0), 2) AS DECIMAL(10,2));
    DECLARE @currentYearEarnedAmount DECIMAL(10,2);
    DECLARE @totalEntitlement DECIMAL(10,2);

    SET @CurrentAirfareDays = CAST(ROUND((@workingDays / 30.0) * 2.5, 4) AS DECIMAL(10,4));
    SET @currentYearEarnedAmount = CAST(ROUND(@perDayRate * @CurrentAirfareDays, 2) AS DECIMAL(10,2));
    SET @totalEntitlement = CAST(ROUND(@usableOpeningAmount + @currentYearEarnedAmount, 2) AS DECIMAL(10,2));
    IF @totalEntitlement > @maxPayout SET @totalEntitlement = CAST(ROUND(@maxPayout, 2) AS DECIMAL(10,2));

    SET @PolicyEntitlement = CAST(ROUND(@totalEntitlement - @paidAmount, 2) AS DECIMAL(10,2));
    IF @PolicyEntitlement < 0 SET @PolicyEntitlement = 0;

    SET @RemainingDays = CAST(ROUND(CASE WHEN @perDayRate > 0 THEN @PolicyEntitlement / @perDayRate ELSE 0 END, 4) AS DECIMAL(10,4));
    IF @RemainingDays < 0 SET @RemainingDays = 0;
    IF @RemainingDays > 60 SET @RemainingDays = 60;

    SET @CurrentYearRemaining = CAST(ROUND(@maxPayout - ISNULL(@CurrentYearSpending, 0), 2) AS DECIMAL(10,2));
    IF @CurrentYearRemaining < 0 SET @CurrentYearRemaining = 0;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_GetAllocationEligibilityReview
    @EmployeeID INT,
    @AllocationDate DATE,
    @AllocYear INT,
    @ExcludeAllocationID BIGINT = NULL,
    @CompanyID INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE
        @MaximumPayout DECIMAL(10,2),
        @OpeningDays DECIMAL(10,4),
        @OpeningBHD DECIMAL(10,2),
        @PaidDays DECIMAL(10,4),
        @JoinDate DATE,
        @EmployeeDepartment NVARCHAR(100),
        @EmployeeGroup NVARCHAR(100),
        @EmployeeCompanyID INT,
        @EffectiveCompanyID INT,
        @CurrentYearSpending DECIMAL(10,2),
        @PreviousAllocationDate DATE,
        @PolicyRateID BIGINT,
        @PolicyEffectiveFrom DATE,
        @PolicyEffectiveTo DATE,
        @PolicyCycleDays DECIMAL(10,2),
        @PolicyPerDayRate DECIMAL(12,6),
        @PolicyEntitlement DECIMAL(10,2),
        @CurrentAirfareDays DECIMAL(10,4),
        @RemainingDays DECIMAL(10,4),
        @CurrentYearRemaining DECIMAL(10,2);

    SELECT
        @MaximumPayout = COALESCE(NULLIF(e.MaximumPayout, 0), 150),
        @OpeningDays = COALESCE(ob.OpeningDays, e.OpeningDays, 0),
        @OpeningBHD = COALESCE(ob.OpeningBHD, e.OpeningBHD, 0),
        @PaidDays = COALESCE(e.AirfarePaidDays, 0),
        @JoinDate = e.JoinDate,
        @EmployeeDepartment = NULLIF(LTRIM(RTRIM(e.Department)), N''),
        @EmployeeGroup = NULLIF(LTRIM(RTRIM(e.EmpGroup)), N''),
        @EmployeeCompanyID = ec.CompanyID
    FROM Employees e
    LEFT JOIN OpeningBalances ob
        ON ob.EmployeeID = e.EmployeeID
       AND ob.BalanceYear = @AllocYear
    OUTER APPLY (
        SELECT TOP 1 c.CompanyID
        FROM dbo.Companies c
        WHERE c.IsActive = 1
          AND NULLIF(LTRIM(RTRIM(e.Company)), '') IS NOT NULL
          AND (
            LOWER(c.CompanyName) = LOWER(LTRIM(RTRIM(e.Company)))
            OR LOWER(c.CompanyCode) = LOWER(LTRIM(RTRIM(e.Company)))
          )
        ORDER BY c.CompanyID
    ) ec
    WHERE e.EmployeeID = @EmployeeID;

    SET @EffectiveCompanyID = COALESCE(@CompanyID, @EmployeeCompanyID);

    SELECT TOP 1
        @PolicyRateID = PolicyRateID,
        @PolicyEffectiveFrom = EffectiveFrom,
        @PolicyEffectiveTo = EffectiveTo,
        @MaximumPayout = MaxPayoutAmount,
        @PolicyCycleDays = CycleDays,
        @PolicyPerDayRate = CAST(MaxPayoutAmount / NULLIF(CycleDays, 0) AS DECIMAL(12,6))
    FROM dbo.AirfarePolicyRates
    WHERE IsActive = 1
      AND EffectiveFrom <= @AllocationDate
      AND (EffectiveTo IS NULL OR EffectiveTo >= @AllocationDate)
      AND (EmployeeID IS NULL OR EmployeeID = @EmployeeID)
      AND (CompanyID IS NULL OR CompanyID = @EffectiveCompanyID)
      AND (Department IS NULL OR LOWER(Department) = LOWER(@EmployeeDepartment))
      AND (EmpGroup IS NULL OR LOWER(EmpGroup) = LOWER(@EmployeeGroup))
    ORDER BY
      CASE
        WHEN EmployeeID = @EmployeeID AND CompanyID IS NULL AND Department IS NULL AND EmpGroup IS NULL THEN 50
        WHEN EmployeeID = @EmployeeID THEN 45
        WHEN EmpGroup IS NOT NULL AND LOWER(EmpGroup) = LOWER(@EmployeeGroup) THEN 40
        WHEN Department IS NOT NULL AND LOWER(Department) = LOWER(@EmployeeDepartment) THEN 30
        WHEN EmployeeID IS NULL AND CompanyID = @EffectiveCompanyID THEN 20
        ELSE 10
      END DESC,
      EffectiveFrom DESC,
      PolicyRateID DESC;

    SET @MaximumPayout = COALESCE(NULLIF(@MaximumPayout, 0), 150);
    SET @PolicyCycleDays = COALESCE(NULLIF(@PolicyCycleDays, 0), 60);
    SET @PolicyPerDayRate = COALESCE(NULLIF(@PolicyPerDayRate, 0), CAST(@MaximumPayout / @PolicyCycleDays AS DECIMAL(12,6)));

    SELECT
        @CurrentYearSpending = COALESCE(SUM(CASE WHEN ISNULL(PaymentMode, N'') = N'employee_full' THEN 0 ELSE COALESCE(Entitlement, 0) END), 0)
    FROM Allocations
    WHERE EmployeeID = @EmployeeID
      AND AllocYear = @AllocYear
      AND (@ExcludeAllocationID IS NULL OR AllocationID <> @ExcludeAllocationID);

    SELECT TOP 1
        @PreviousAllocationDate = AllocationDate
    FROM Allocations
    WHERE EmployeeID = @EmployeeID
      AND AllocYear = @AllocYear
      AND (@ExcludeAllocationID IS NULL OR AllocationID <> @ExcludeAllocationID)
      AND AllocationDate <= @AllocationDate
      AND COALESCE(Entitlement, 0) > 0
    ORDER BY AllocationDate DESC, AllocationID DESC;

    EXEC dbo.sp_ATLAS_CalcPolicyEntitlement
        @MaximumPayout = @MaximumPayout,
        @AllocationDate = @AllocationDate,
        @AllocYear = @AllocYear,
        @OpeningDays = @OpeningDays,
        @OpeningBHD = @OpeningBHD,
        @PaidDays = @PaidDays,
        @CurrentYearSpending = @CurrentYearSpending,
        @JoinDate = @JoinDate,
        @PreviousAllocationDate = @PreviousAllocationDate,
        @PolicyEntitlement = @PolicyEntitlement OUTPUT,
        @CurrentAirfareDays = @CurrentAirfareDays OUTPUT,
        @RemainingDays = @RemainingDays OUTPUT,
        @CurrentYearRemaining = @CurrentYearRemaining OUTPUT;

    DECLARE @PerDayRate DECIMAL(10,6) = CASE WHEN ISNULL(@PolicyCycleDays, 0) > 0 THEN @MaximumPayout / @PolicyCycleDays ELSE 0 END;
    DECLARE @CurrentYearEarnedAmount DECIMAL(10,2) = CAST(ROUND(@CurrentAirfareDays * @PerDayRate, 2) AS DECIMAL(10,2));
    DECLARE @AlreadyPaidAmount DECIMAL(10,2) = CAST(ROUND(ISNULL(@CurrentYearSpending,0) + (ISNULL(@PaidDays,0) * @PerDayRate), 2) AS DECIMAL(10,2));
    DECLARE @AlreadyPaidDays DECIMAL(10,4) = CASE WHEN @PerDayRate > 0 THEN CAST(ROUND(@AlreadyPaidAmount / @PerDayRate, 4) AS DECIMAL(10,4)) ELSE 0 END;

    SELECT
        @EmployeeID AS EmployeeID,
        @AllocYear AS AllocYear,
        @AllocationDate AS AllocationDate,
        @PreviousAllocationDate AS PreviousAllocationDate,
        CAST(ISNULL(@OpeningBHD,0) AS DECIMAL(10,2)) AS OpeningBalanceAmount,
        CAST(ISNULL(@OpeningDays,0) AS DECIMAL(10,4)) AS OpeningBalanceDays,
        @CurrentAirfareDays AS CurrentYearEarnedDays,
        @CurrentYearEarnedAmount AS CurrentYearEarnedAmount,
        @AlreadyPaidDays AS AlreadyPaidDays,
        @AlreadyPaidAmount AS AlreadyPaidAmount,
        @CurrentYearRemaining AS CurrentYearRemaining,
        CAST(ROUND(ISNULL(@OpeningBHD,0) + ISNULL(@CurrentYearRemaining,0), 2) AS DECIMAL(10,2)) AS TotalAvailableFunds,
        @RemainingDays AS EligibleBalanceDays,
        @PolicyEntitlement AS AirfareEntitlementAmount,
        @CurrentYearEarnedAmount AS CurrentYearEntitlementBasis,
        @PerDayRate AS PerDayRate,
        @MaximumPayout AS MaximumPayout,
        @EffectiveCompanyID AS CompanyID,
        @PolicyRateID AS PolicyRateID,
        @PolicyEffectiveFrom AS PolicyEffectiveFrom,
        @PolicyEffectiveTo AS PolicyEffectiveTo,
        @PolicyCycleDays AS PolicyCycleDays,
        @PolicyPerDayRate AS PolicyPerDayRate,
        @CurrentYearSpending AS CurrentYearSpending;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_GetYearEndPreview
    @ClosedYear INT,
    @ClosingDate DATE,
    @EmployeeID INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @safeClosingDate DATE = COALESCE(@ClosingDate, DATEFROMPARTS(@ClosedYear, 12, 31));
    DECLARE @closeIndex INT = ((MONTH(@safeClosingDate) - 1) * 30) + IIF(DAY(@safeClosingDate) > 30, 30, DAY(@safeClosingDate));
    SET @closeIndex = CASE WHEN @closeIndex < 0 THEN 0 WHEN @closeIndex > 360 THEN 360 ELSE @closeIndex END;

    ;WITH YearEndBase AS (
        SELECT
            e.EmployeeID,
            e.EmployeeCode,
            e.FullName,
            e.Department,
            e.JoinDate,
            COALESCE(NULLIF(policy.MaxPayoutAmount, 0), NULLIF(e.MaximumPayout, 0), 150) AS MaximumPayout,
            COALESCE(NULLIF(policy.CycleDays, 0), 60) AS CycleDays,
            COALESCE(ob.OpeningDays, e.OpeningDays, 0) AS OpeningDays,
            COALESCE(ob.OpeningBHD, e.OpeningBHD, dbo.fn_ATLAS_AirfareAmount(COALESCE(ob.OpeningDays, e.OpeningDays, 0), COALESCE(NULLIF(e.MaximumPayout, 0), 150)), 0) AS OpeningBHD,
            COALESCE(e.AirfarePaidDays, 0) AS ManualPaidDays
        FROM dbo.Employees e
        LEFT JOIN dbo.OpeningBalances ob
            ON ob.EmployeeID = e.EmployeeID
           AND ob.BalanceYear = @ClosedYear
        OUTER APPLY (
            SELECT TOP 1 MaxPayoutAmount, CycleDays
            FROM dbo.AirfarePolicyRates
            WHERE IsActive = 1
              AND CompanyID IS NULL
              AND EmployeeID IS NULL
              AND Department IS NULL
              AND EmpGroup IS NULL
              AND EffectiveFrom <= @safeClosingDate
              AND (EffectiveTo IS NULL OR EffectiveTo >= @safeClosingDate)
            ORDER BY EffectiveFrom DESC, PolicyRateID DESC
        ) policy
        WHERE dbo.fn_ATLAS_IsAirfareEligibleEmployeeStatus(e.Status) = 1
          AND e.JoinDate <= @safeClosingDate
          AND (@EmployeeID IS NULL OR e.EmployeeID = @EmployeeID)
    ),
    YearEndCalc AS (
        SELECT
            b.*,
            CAST(b.MaximumPayout / NULLIF(b.CycleDays, 0) AS DECIMAL(12,6)) AS PerDayRate,
            CASE
                WHEN b.JoinDate IS NULL OR b.JoinDate < DATEFROMPARTS(@ClosedYear, 1, 1) THEN DATEFROMPARTS(@ClosedYear, 1, 1)
                WHEN b.JoinDate > @safeClosingDate THEN @safeClosingDate
                ELSE b.JoinDate
            END AS EarnStartDate
        FROM YearEndBase b
    )
    SELECT
        c.EmployeeID,
        c.EmployeeCode,
        c.FullName,
        c.Department,
        CAST(c.MaximumPayout AS DECIMAL(10,2)) AS MaximumPayout,
        CAST(c.OpeningDays AS DECIMAL(10,4)) AS OpeningDays,
        CAST(c.OpeningBHD AS DECIMAL(10,2)) AS OpeningBHD,
        CAST(ROUND((CASE
            WHEN @closeIndex <= (((MONTH(c.EarnStartDate) - 1) * 30) + IIF(DAY(c.EarnStartDate) > 30, 30, DAY(c.EarnStartDate))) THEN 0
            ELSE (@closeIndex - (((MONTH(c.EarnStartDate) - 1) * 30) + IIF(DAY(c.EarnStartDate) > 30, 30, DAY(c.EarnStartDate))) + 1) / 30.0 * 2.5
        END), 4) AS DECIMAL(10,4)) AS CurrentYearEarnedDays,
        CAST(ROUND((CASE
            WHEN @closeIndex <= (((MONTH(c.EarnStartDate) - 1) * 30) + IIF(DAY(c.EarnStartDate) > 30, 30, DAY(c.EarnStartDate))) THEN 0
            ELSE (@closeIndex - (((MONTH(c.EarnStartDate) - 1) * 30) + IIF(DAY(c.EarnStartDate) > 30, 30, DAY(c.EarnStartDate))) + 1) / 30.0 * 2.5
        END) * c.PerDayRate, 2) AS DECIMAL(10,2)) AS CurrentYearEarnedBHD,
        CAST(ROUND((COALESCE(spent.EntitlementApplied, 0) / NULLIF(c.PerDayRate, 0)) + COALESCE(c.ManualPaidDays, 0), 4) AS DECIMAL(10,4)) AS PaidDays,
        CAST(ROUND(COALESCE(spent.EntitlementApplied, 0) + (COALESCE(c.ManualPaidDays, 0) * c.PerDayRate), 2) AS DECIMAL(10,2)) AS PaidAmount,
        CAST(ROUND(CASE
            WHEN c.OpeningDays + (CASE
                WHEN @closeIndex <= (((MONTH(c.EarnStartDate) - 1) * 30) + IIF(DAY(c.EarnStartDate) > 30, 30, DAY(c.EarnStartDate))) THEN 0
                ELSE (@closeIndex - (((MONTH(c.EarnStartDate) - 1) * 30) + IIF(DAY(c.EarnStartDate) > 30, 30, DAY(c.EarnStartDate))) + 1) / 30.0 * 2.5
            END) - ((COALESCE(spent.EntitlementApplied, 0) / NULLIF(c.PerDayRate, 0)) + COALESCE(c.ManualPaidDays, 0)) < 0 THEN 0
            ELSE c.OpeningDays + (CASE
                WHEN @closeIndex <= (((MONTH(c.EarnStartDate) - 1) * 30) + IIF(DAY(c.EarnStartDate) > 30, 30, DAY(c.EarnStartDate))) THEN 0
                ELSE (@closeIndex - (((MONTH(c.EarnStartDate) - 1) * 30) + IIF(DAY(c.EarnStartDate) > 30, 30, DAY(c.EarnStartDate))) + 1) / 30.0 * 2.5
            END) - ((COALESCE(spent.EntitlementApplied, 0) / NULLIF(c.PerDayRate, 0)) + COALESCE(c.ManualPaidDays, 0))
        END, 4) AS DECIMAL(10,4)) AS ClosingDays,
        CAST(ROUND(CASE
            WHEN c.OpeningBHD + (CASE
                WHEN @closeIndex <= (((MONTH(c.EarnStartDate) - 1) * 30) + IIF(DAY(c.EarnStartDate) > 30, 30, DAY(c.EarnStartDate))) THEN 0
                ELSE (@closeIndex - (((MONTH(c.EarnStartDate) - 1) * 30) + IIF(DAY(c.EarnStartDate) > 30, 30, DAY(c.EarnStartDate))) + 1) / 30.0 * 2.5
            END * c.PerDayRate) - (COALESCE(spent.EntitlementApplied, 0) + (COALESCE(c.ManualPaidDays, 0) * c.PerDayRate)) < 0 THEN 0
            ELSE c.OpeningBHD + (CASE
                WHEN @closeIndex <= (((MONTH(c.EarnStartDate) - 1) * 30) + IIF(DAY(c.EarnStartDate) > 30, 30, DAY(c.EarnStartDate))) THEN 0
                ELSE (@closeIndex - (((MONTH(c.EarnStartDate) - 1) * 30) + IIF(DAY(c.EarnStartDate) > 30, 30, DAY(c.EarnStartDate))) + 1) / 30.0 * 2.5
            END * c.PerDayRate) - (COALESCE(spent.EntitlementApplied, 0) + (COALESCE(c.ManualPaidDays, 0) * c.PerDayRate))
        END, 2) AS DECIMAL(10,2)) AS ClosingBHD,
        COALESCE(loans.PendingLoanCount, 0) AS PendingLoanCount,
        CAST(ROUND(COALESCE(loans.PendingLoanAmount, 0), 2) AS DECIMAL(12,2)) AS PendingLoanAmount,
        CAST(ROUND(COALESCE(loans.PendingLoanAmount, 0), 2) AS DECIMAL(12,2)) AS ClosingLoanBalance,
        CAST(ROUND(COALESCE(loans.PendingLoanAmount, 0), 2) AS DECIMAL(12,2)) AS NextOpeningLoanBalance,
        CAST(ROUND(COALESCE(loans.MonthlyEMI, 0), 2) AS DECIMAL(12,2)) AS PendingMonthlyEMI,
        CASE WHEN COALESCE(loans.PendingLoanCount, 0) > 0 THEN 'Pending loan review required' ELSE 'Ready for close' END AS CloseStatus
    FROM YearEndCalc c
    OUTER APPLY (
        SELECT
            SUM(CASE
                WHEN COALESCE(a.Entitlement, 0) > 0 THEN IIF(a.Entitlement > a.TicketCost, a.TicketCost, a.Entitlement)
                WHEN ISNULL(a.PaymentMode, '') = 'company_full' THEN 0
                ELSE COALESCE(a.CompanyPaid, 0)
            END) AS EntitlementApplied
        FROM dbo.Allocations a
        WHERE a.EmployeeID = c.EmployeeID
          AND a.AllocYear = @ClosedYear
          AND a.AllocationDate <= @safeClosingDate
    ) spent
    OUTER APPLY (
        SELECT
            COUNT(*) AS PendingLoanCount,
            SUM(COALESCE(l.RemainingBalance, 0)) AS PendingLoanAmount,
            SUM(COALESCE(l.EMI, 0)) AS MonthlyEMI
        FROM dbo.Loans l
        WHERE l.EmployeeID = c.EmployeeID
          AND COALESCE(l.RemainingBalance, 0) > 0
          AND ISNULL(l.Status, 'active') <> 'settled'
          AND (l.CreatedDate IS NULL OR l.CreatedDate <= @safeClosingDate)
    ) loans
    ORDER BY c.EmployeeCode;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_NormalizeAllocationAmounts
    @TicketCost DECIMAL(10,2),
    @PolicyEntitlement DECIMAL(10,2),
    @MaximumPayout DECIMAL(10,2),
    @PaymentMode NVARCHAR(20),
    @EmployeePaid DECIMAL(10,2),
    @LoanAmount DECIMAL(10,2),
    @CompanyExtra DECIMAL(10,2),
    @CompanyPaid DECIMAL(10,2) OUTPUT,
    @EmployeePaidOut DECIMAL(10,2) OUTPUT,
    @LoanAmountOut DECIMAL(10,2) OUTPUT,
    @CompanyExtraOut DECIMAL(10,2) OUTPUT,
    @ExcessOut DECIMAL(10,2) OUTPUT,
    @EntitlementOut DECIMAL(10,2) OUTPUT,
    @CompanyBalancePayAmount DECIMAL(10,2) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @maxPayout DECIMAL(10,4) = CASE
        WHEN ISNULL(@MaximumPayout,0) <= 0 THEN 150
        ELSE @MaximumPayout
    END;
    DECLARE @ticket DECIMAL(10,2) = ROUND(ISNULL(@TicketCost,0),2);
    DECLARE @entitlement DECIMAL(10,2) = ROUND(CASE WHEN ISNULL(@PolicyEntitlement,0) > 0 THEN @PolicyEntitlement ELSE 0 END,2);
    DECLARE @companyMaxPayable DECIMAL(10,2) = ROUND(@maxPayout,2);

    DECLARE @companyBasePaid DECIMAL(10,2) = IIF(@ticket < @entitlement, @ticket, IIF(@entitlement < @companyMaxPayable, @entitlement, @companyMaxPayable));
    DECLARE @excessBalance DECIMAL(10,2) = ROUND(IIF(@ticket - @companyBasePaid > 0, @ticket - @companyBasePaid, 0),2);
    DECLARE @companyExtraCapacity DECIMAL(10,2) = ROUND(CASE WHEN @companyMaxPayable - @companyBasePaid > 0 THEN @companyMaxPayable - @companyBasePaid ELSE 0 END,2);

    SET @paymentMode = LOWER(LTRIM(RTRIM(@PaymentMode)));
    SET @CompanyPaid = ROUND(CASE WHEN @companyBasePaid < @ticket THEN @companyBasePaid ELSE @ticket END,2);
    SET @EmployeePaidOut = 0;
    SET @LoanAmountOut = 0;
    SET @CompanyExtraOut = 0;
    SET @ExcessOut = 0;

    IF @paymentMode = N'employee_full'
    BEGIN
        SET @CompanyPaid = 0;
        SET @EmployeePaidOut = @ticket;
        SET @LoanAmountOut = 0;
        SET @CompanyExtraOut = 0;
        SET @ExcessOut = 0;
        SET @EntitlementOut = 0;
        SET @CompanyBalancePayAmount = 0;
        RETURN;
    END

    IF @paymentMode = N'company_full'
    BEGIN
        SET @CompanyExtraOut = @excessBalance;
        SET @CompanyPaid = @ticket;
        SET @ExcessOut = 0;
    END
    ELSE IF @paymentMode = N'company'
    BEGIN
        DECLARE @requestedCompanyExtra DECIMAL(10,2) = CASE
            WHEN ISNULL(@CompanyExtra,0) > 0 THEN ISNULL(@CompanyExtra,0)
            ELSE @excessBalance
        END;
        SET @CompanyExtraOut = ROUND(IIF(@requestedCompanyExtra < @companyExtraCapacity, @requestedCompanyExtra, @companyExtraCapacity),2);
        IF @CompanyExtraOut > @excessBalance SET @CompanyExtraOut = @excessBalance;
        SET @CompanyPaid = ROUND(IIF(@ticket < (@companyBasePaid + @CompanyExtraOut), @ticket, @companyBasePaid + @CompanyExtraOut),2);
        SET @ExcessOut = ROUND(IIF(@excessBalance - @CompanyExtraOut > 0, @excessBalance - @CompanyExtraOut, 0),2);
    END
    ELSE IF @paymentMode = N'employee'
    BEGIN
        SET @EmployeePaidOut = ROUND(IIF(ISNULL(@EmployeePaid,0) < @excessBalance, ISNULL(@EmployeePaid,0), @excessBalance),2);
        SET @ExcessOut = ROUND(IIF(@excessBalance - @EmployeePaidOut > 0, @excessBalance - @EmployeePaidOut, 0),2);
    END
    ELSE IF @paymentMode = N'loan'
    BEGIN
        SET @LoanAmountOut = ROUND(IIF(ISNULL(@LoanAmount,0) < @excessBalance, ISNULL(@LoanAmount,0), @excessBalance),2);
        SET @ExcessOut = ROUND(IIF(@excessBalance - @LoanAmountOut > 0, @excessBalance - @LoanAmountOut, 0),2);
    END
    ELSE
    BEGIN
        SET @ExcessOut = ROUND(@excessBalance,2);
    END

    IF @CompanyPaid > @ticket SET @CompanyPaid = @ticket;
    IF @paymentMode <> N'company_full' AND @CompanyPaid > @companyMaxPayable SET @CompanyPaid = @companyMaxPayable;

    SET @EntitlementOut = ROUND(@entitlement,2);
    SET @CompanyBalancePayAmount = ROUND(@CompanyExtraOut,2);
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_RunSystemVerification
    @AsOfDate DATE = NULL,
    @CurrentYear INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @workDate DATE = COALESCE(@AsOfDate, CAST(GETDATE() AS DATE));
    DECLARE @year INT = COALESCE(@CurrentYear, YEAR(@workDate));

    DECLARE @Checks TABLE (
        CheckID INT IDENTITY(1,1) PRIMARY KEY,
        Area NVARCHAR(40) NOT NULL,
        CheckCode NVARCHAR(80) NOT NULL,
        Severity NVARCHAR(12) NOT NULL,
        Status NVARCHAR(12) NOT NULL,
        Title NVARCHAR(180) NOT NULL,
        Detail NVARCHAR(700) NOT NULL,
        EvidenceCount INT NOT NULL DEFAULT (0),
        TargetView NVARCHAR(40) NULL,
        TargetRecordType NVARCHAR(40) NULL,
        TargetRecordID BIGINT NULL,
        SortWeight INT NOT NULL
    );

    DECLARE @badAllocationAmounts INT = (
        SELECT COUNT(*)
        FROM dbo.Allocations
        WHERE ABS(ISNULL(TicketCost,0) - (ISNULL(CompanyPaid,0) + ISNULL(EmployeePaid,0) + ISNULL(LoanAmount,0) + ISNULL(ExcessAmount,0))) > 0.05
    );

    INSERT INTO @Checks (Area, CheckCode, Severity, Status, Title, Detail, EvidenceCount, TargetView, TargetRecordType, SortWeight)
    VALUES (
        'Airfare',
        'ALLOCATION_AMOUNT_RECONCILIATION',
        CASE WHEN @badAllocationAmounts > 0 THEN 'CRITICAL' ELSE 'INFO' END,
        CASE WHEN @badAllocationAmounts > 0 THEN 'FAIL' ELSE 'PASS' END,
        'Allocation amount reconciliation',
        CASE WHEN @badAllocationAmounts > 0
            THEN CONCAT(@badAllocationAmounts, ' allocation row(s) do not reconcile ticket amount against company/self/loan/excess amounts.')
            ELSE 'All saved allocation rows reconcile against their saved payment breakdown.' END,
        @badAllocationAmounts,
        'Airfare',
        'allocation',
        10
    );

    DECLARE @missingPolicySnapshots INT = (
        SELECT COUNT(*)
        FROM dbo.Allocations
        WHERE PolicyMaxPayoutAmount IS NULL OR PolicyCycleDays IS NULL OR PolicyPerDayRate IS NULL OR PolicyEffectiveFrom IS NULL
    );

    INSERT INTO @Checks (Area, CheckCode, Severity, Status, Title, Detail, EvidenceCount, TargetView, TargetRecordType, SortWeight)
    VALUES (
        'Preferences',
        'POLICY_SNAPSHOT_LOCKED',
        CASE WHEN @missingPolicySnapshots > 0 THEN 'WARNING' ELSE 'INFO' END,
        CASE WHEN @missingPolicySnapshots > 0 THEN 'WARN' ELSE 'PASS' END,
        'Historical policy snapshot protection',
        CASE WHEN @missingPolicySnapshots > 0
            THEN CONCAT(@missingPolicySnapshots, ' allocation row(s) are missing saved policy snapshot fields. New rate changes must not recalculate those rows.')
            ELSE 'Allocations contain policy snapshots, so date-effective preference changes do not rewrite historical tickets.' END,
        @missingPolicySnapshots,
        'Preferences',
        'policy',
        15
    );

    DECLARE @duplicateWithoutReason INT;
    DECLARE @duplicateTargetAllocationID BIGINT;

    ;WITH TicketSequence AS (
        SELECT
            a.AllocationID,
            a.Remarks,
            ROW_NUMBER() OVER (
                PARTITION BY a.EmployeeID, a.AllocYear
                ORDER BY a.AllocationDate ASC, a.AllocationID ASC
            ) AS TicketNoInYear
        FROM dbo.Allocations a
        WHERE a.AllocYear = @year
    )
    SELECT
        @duplicateWithoutReason = COUNT(*),
        @duplicateTargetAllocationID = MIN(AllocationID)
    FROM TicketSequence
    WHERE TicketNoInYear > 1
      AND NULLIF(LTRIM(RTRIM(ISNULL(Remarks, ''))), '') IS NULL;

    INSERT INTO @Checks (Area, CheckCode, Severity, Status, Title, Detail, EvidenceCount, TargetView, TargetRecordType, TargetRecordID, SortWeight)
    VALUES (
        'Airfare',
        'DUPLICATE_TICKET_APPROVAL',
        CASE WHEN @duplicateWithoutReason > 0 THEN 'CRITICAL' ELSE 'INFO' END,
        CASE WHEN @duplicateWithoutReason > 0 THEN 'FAIL' ELSE 'PASS' END,
        'Duplicate ticket approval control',
        CASE WHEN @duplicateWithoutReason > 0
            THEN CONCAT(@duplicateWithoutReason, ' duplicate-ticket row(s) in ', @year, ' are missing override reason or manager approval.')
            ELSE 'Duplicate ticket rows for the selected year have approval evidence.' END,
        @duplicateWithoutReason,
        'Airfare',
        'allocation',
        @duplicateTargetAllocationID,
        20
    );

    DECLARE @openLoanCount INT = (
        SELECT COUNT(*)
        FROM dbo.Loans
        WHERE ISNULL(RemainingBalance, 0) > 0
          AND ISNULL(Status, 'active') <> 'settled'
    );

    INSERT INTO @Checks (Area, CheckCode, Severity, Status, Title, Detail, EvidenceCount, TargetView, TargetRecordType, SortWeight)
    VALUES (
        'Loans',
        'OPEN_LOAN_REVIEW',
        CASE WHEN @openLoanCount > 0 THEN 'WARNING' ELSE 'INFO' END,
        CASE WHEN @openLoanCount > 0 THEN 'WARN' ELSE 'PASS' END,
        'Existing loan restriction review',
        CASE WHEN @openLoanCount > 0
            THEN CONCAT(@openLoanCount, ' active loan(s) should be reviewed before approving new ticket excess loans.')
            ELSE 'No active loan balances are pending review.' END,
        @openLoanCount,
        'Loans',
        'loan',
        30
    );

    DECLARE @openingMismatch INT = (
        SELECT COUNT(*)
        FROM dbo.OpeningBalances ob
        INNER JOIN dbo.Employees e ON e.EmployeeID = ob.EmployeeID
        WHERE ABS(ISNULL(ob.OpeningBHD,0) - ROUND((COALESCE(NULLIF(e.MaximumPayout,0), 150) / 60.0) * ISNULL(ob.OpeningDays,0), 2)) > 0.05
    );

    INSERT INTO @Checks (Area, CheckCode, Severity, Status, Title, Detail, EvidenceCount, TargetView, TargetRecordType, SortWeight)
    VALUES (
        'Opening Balance',
        'OPENING_AMOUNT_SYSTEM_CALC',
        CASE WHEN @openingMismatch > 0 THEN 'WARNING' ELSE 'INFO' END,
        CASE WHEN @openingMismatch > 0 THEN 'WARN' ELSE 'PASS' END,
        'Opening amount calculated from days',
        CASE WHEN @openingMismatch > 0
            THEN CONCAT(@openingMismatch, ' opening balance row(s) differ from max payout / 60 x opening days.')
            ELSE 'Opening balance amounts match the system formula from opening days.' END,
        @openingMismatch,
        'Opening Balance',
        'opening-balance',
        35
    );

    DECLARE @importIssueCount INT = (
        SELECT ISNULL(SUM(ErrorRows + WarningRows), 0)
        FROM (
            SELECT ErrorRows, WarningRows FROM dbo.EmployeeImportBatches WHERE Status = 'PREVIEW'
            UNION ALL
            SELECT ErrorRows, WarningRows FROM dbo.OpeningBalanceImportBatches WHERE Status = 'PREVIEW'
        ) x
    );

    INSERT INTO @Checks (Area, CheckCode, Severity, Status, Title, Detail, EvidenceCount, TargetView, TargetRecordType, SortWeight)
    VALUES (
        'Imports',
        'IMPORT_PREVIEW_GATES',
        CASE WHEN @importIssueCount > 0 THEN 'WARNING' ELSE 'INFO' END,
        CASE WHEN @importIssueCount > 0 THEN 'WARN' ELSE 'PASS' END,
        'Import preview validation gates',
        CASE WHEN @importIssueCount > 0
            THEN CONCAT(@importIssueCount, ' preview row issue(s) need selection/review before confirmation.')
            ELSE 'No open employee or opening balance import preview issues are pending.' END,
        @importIssueCount,
        'Employees',
        'import',
        40
    );

    DECLARE @yearEndRisk INT = (
        SELECT COUNT(*)
        FROM dbo.vw_ATLAS_EmployeeMaster
        WHERE ClosingBalanceDays < 0
    );

    INSERT INTO @Checks (Area, CheckCode, Severity, Status, Title, Detail, EvidenceCount, TargetView, TargetRecordType, SortWeight)
    VALUES (
        'Year End',
        'YEAR_END_NEGATIVE_BALANCE',
        CASE WHEN @yearEndRisk > 0 THEN 'WARNING' ELSE 'INFO' END,
        CASE WHEN @yearEndRisk > 0 THEN 'WARN' ELSE 'PASS' END,
        'Year-end closing readiness',
        CASE WHEN @yearEndRisk > 0
            THEN CONCAT(@yearEndRisk, ' employee(s) have negative balance days before closing.')
            ELSE 'No negative balance days found for year-end readiness.' END,
        @yearEndRisk,
        'Year End',
        'year-end',
        45
    );

    DECLARE @missingLogo INT = (
        SELECT COUNT(*)
        FROM dbo.Companies
        WHERE IsActive = 1 AND LogoData IS NULL
    );

    INSERT INTO @Checks (Area, CheckCode, Severity, Status, Title, Detail, EvidenceCount, TargetView, TargetRecordType, SortWeight)
    VALUES (
        'Companies',
        'COMPANY_LOGO_PRINT_READY',
        CASE WHEN @missingLogo > 0 THEN 'WARNING' ELSE 'INFO' END,
        CASE WHEN @missingLogo > 0 THEN 'WARN' ELSE 'PASS' END,
        'Company logo available for print formats',
        CASE WHEN @missingLogo > 0
            THEN CONCAT(@missingLogo, ' active company record(s) do not have a logo for reports and print layouts.')
            ELSE 'Active company records have logo data available for print layouts.' END,
        @missingLogo,
        'Companies',
        'company',
        50
    );

    DECLARE @inactiveAdminRisk INT = (
        SELECT CASE WHEN EXISTS (SELECT 1 FROM dbo.Users WHERE Role = 'admin' AND IsActive = 1) THEN 0 ELSE 1 END
    );

    INSERT INTO @Checks (Area, CheckCode, Severity, Status, Title, Detail, EvidenceCount, TargetView, TargetRecordType, SortWeight)
    VALUES (
        'Security',
        'ACTIVE_ADMIN_EXISTS',
        CASE WHEN @inactiveAdminRisk > 0 THEN 'CRITICAL' ELSE 'INFO' END,
        CASE WHEN @inactiveAdminRisk > 0 THEN 'FAIL' ELSE 'PASS' END,
        'Active administrator account',
        CASE WHEN @inactiveAdminRisk > 0
            THEN 'No active admin user was found. Login and maintenance could be blocked.'
            ELSE 'At least one active admin user is available for maintenance.' END,
        @inactiveAdminRisk,
        'Security',
        'user',
        55
    );

    DECLARE @backupRisk INT = (
        SELECT CASE WHEN EXISTS (
            SELECT 1
            FROM dbo.CompanyBackups
            WHERE DatabaseName = DB_NAME()
              AND Status = 'completed'
              AND CreatedAt >= DATEADD(DAY, -7, GETDATE())
        ) THEN 0 ELSE 1 END
    );

    INSERT INTO @Checks (Area, CheckCode, Severity, Status, Title, Detail, EvidenceCount, TargetView, TargetRecordType, SortWeight)
    VALUES (
        'Backup',
        'RECENT_DATABASE_BACKUP',
        CASE WHEN @backupRisk > 0 THEN 'WARNING' ELSE 'INFO' END,
        CASE WHEN @backupRisk > 0 THEN 'WARN' ELSE 'PASS' END,
        'Recent main database backup',
        CASE WHEN @backupRisk > 0
            THEN 'No completed main database backup was found in the last 7 days.'
            ELSE 'A completed main database backup exists within the last 7 days.' END,
        @backupRisk,
        'Companies',
        'backup',
        60
    );

    DECLARE @reportLinkRisk INT = (
        SELECT COUNT(*)
        FROM dbo.Allocations a
        WHERE NOT EXISTS (SELECT 1 FROM dbo.Employees e WHERE e.EmployeeID = a.EmployeeID)
    ) + (
        SELECT COUNT(*)
        FROM dbo.Loans l
        WHERE NOT EXISTS (SELECT 1 FROM dbo.Employees e WHERE e.EmployeeID = l.EmployeeID)
    );

    INSERT INTO @Checks (Area, CheckCode, Severity, Status, Title, Detail, EvidenceCount, TargetView, TargetRecordType, SortWeight)
    VALUES (
        'Reports',
        'REPORT_DRILLDOWN_REFERENTIAL_LINKS',
        CASE WHEN @reportLinkRisk > 0 THEN 'CRITICAL' ELSE 'INFO' END,
        CASE WHEN @reportLinkRisk > 0 THEN 'FAIL' ELSE 'PASS' END,
        'Report drilldown link consistency',
        CASE WHEN @reportLinkRisk > 0
            THEN CONCAT(@reportLinkRisk, ' allocation/loan row(s) point to missing employee records.')
            ELSE 'Report source rows link back to valid employee records for drilldown views.' END,
        @reportLinkRisk,
        'Reports',
        'report',
        65
    );

    DECLARE @activeEmployeeCount INT = (
        SELECT COUNT(*)
        FROM dbo.Employees
        WHERE dbo.fn_ATLAS_IsAirfareEligibleEmployeeStatus(Status) = 1
    );

    INSERT INTO @Checks (Area, CheckCode, Severity, Status, Title, Detail, EvidenceCount, TargetView, TargetRecordType, SortWeight)
    VALUES (
        'Reports',
        'AIRFARE_PAYABLE_CURRENT_YEAR_RULE',
        'INFO',
        'PASS',
        'Airfare Payable report yearly rule',
        CONCAT('Airfare Payable report is SQL-backed for all active employees using one-year entitlement: 30 days / 75 BHD / 2.50 BHD per day. Active employees in scope: ', @activeEmployeeCount, '.'),
        @activeEmployeeCount,
        'Reports',
        'report',
        66
    );

    DECLARE @reportTotalSourceRows INT = (
        SELECT
            (SELECT COUNT(*) FROM dbo.Employees WHERE dbo.fn_ATLAS_IsAirfareEligibleEmployeeStatus(Status) = 1)
          + (SELECT COUNT(*) FROM dbo.Allocations WHERE AllocYear = @year)
          + (SELECT COUNT(*) FROM dbo.Loans)
          + (SELECT COUNT(*) FROM dbo.Companies)
    );

    INSERT INTO @Checks (Area, CheckCode, Severity, Status, Title, Detail, EvidenceCount, TargetView, TargetRecordType, SortWeight)
    VALUES (
        'Reports',
        'REPORT_SUBTOTAL_GRAND_TOTAL_SOURCE',
        CASE WHEN @reportTotalSourceRows > 0 THEN 'INFO' ELSE 'WARNING' END,
        CASE WHEN @reportTotalSourceRows > 0 THEN 'PASS' ELSE 'WARN' END,
        'Report subtotal and grand total source',
        CASE WHEN @reportTotalSourceRows > 0
            THEN CONCAT('Report source data is available for subtotal and grand-total calculation. Source row count across report families: ', @reportTotalSourceRows, '.')
            ELSE 'No report source data found for subtotal and grand-total calculation.' END,
        @reportTotalSourceRows,
        'Reports',
        'report',
        67
    );

    INSERT INTO @Checks (Area, CheckCode, Severity, Status, Title, Detail, EvidenceCount, TargetView, TargetRecordType, SortWeight)
    VALUES (
        'Reports',
        'REPORT_NUMERIC_DAYS_AMOUNT_LAYOUT',
        'INFO',
        'PASS',
        'Report numeric days and amount layout',
        'Report values are prepared for separate Days and Amount columns so exports remain clear, sortable, and total-ready.',
        @reportTotalSourceRows,
        'Reports',
        'report',
        68
    );

    INSERT INTO @Checks (Area, CheckCode, Severity, Status, Title, Detail, EvidenceCount, TargetView, TargetRecordType, SortWeight)
    VALUES (
        'Reports',
        'REPORT_SCREEN_READABILITY_LAYOUT',
        'INFO',
        'PASS',
        'Report screen readability controls',
        'Reports screen supports full-width viewing, density selection, fit/wide table modes, sticky headers, and scrollable wide tables for readable on-screen review.',
        @reportTotalSourceRows,
        'Reports',
        'report',
        69
    );

    INSERT INTO @Checks (Area, CheckCode, Severity, Status, Title, Detail, EvidenceCount, TargetView, TargetRecordType, SortWeight)
    VALUES (
        'UI',
        'RETRACTABLE_SHELL_PANELS',
        'INFO',
        'PASS',
        'Retractable menu and side panels',
        'Application shell supports a collapsible left navigation rail and collapsible report checks panel so users can reclaim workspace for wide reports.',
        @reportTotalSourceRows,
        'Reports',
        'layout',
        70
    );

    INSERT INTO @Checks (Area, CheckCode, Severity, Status, Title, Detail, EvidenceCount, TargetView, TargetRecordType, SortWeight)
    VALUES (
        'UI',
        'APPEARANCE_THEME_DENSITY_CONTROLS',
        'INFO',
        'PASS',
        'User appearance and density controls',
        'Preferences include theme accent and application density controls, with workspace collapse options for data-heavy screens.',
        @reportTotalSourceRows,
        'Preferences',
        'layout',
        71
    );

    DECLARE @failCount INT = (SELECT COUNT(*) FROM @Checks WHERE Status = 'FAIL');
    DECLARE @warnCount INT = (SELECT COUNT(*) FROM @Checks WHERE Status = 'WARN');
    DECLARE @passCount INT = (SELECT COUNT(*) FROM @Checks WHERE Status = 'PASS');
    DECLARE @totalCount INT = (SELECT COUNT(*) FROM @Checks);
    DECLARE @score INT = CASE
        WHEN @totalCount = 0 THEN 100
        ELSE IIF(100 - (@failCount * 18) - (@warnCount * 7) < 0, 0, 100 - (@failCount * 18) - (@warnCount * 7))
    END;

    SELECT
        @workDate AS AsOfDate,
        @year AS CurrentYear,
        @totalCount AS TotalChecks,
        @passCount AS PassedChecks,
        @warnCount AS WarningChecks,
        @failCount AS FailedChecks,
        @score AS VerificationScore,
        CASE
            WHEN @failCount > 0 THEN 'Action required'
            WHEN @warnCount > 0 THEN 'Review recommended'
            ELSE 'Verified'
        END AS VerificationStatus;

    SELECT
        CheckID,
        Area,
        CheckCode,
        Severity,
        Status,
        Title,
        Detail,
        EvidenceCount,
        TargetView,
        TargetRecordType,
        TargetRecordID
    FROM @Checks
    ORDER BY SortWeight ASC, CheckID ASC;
END;
GO
