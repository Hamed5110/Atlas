IF OBJECT_ID('dbo.Companies', 'U') IS NULL
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

IF OBJECT_ID('dbo.CompanyBackups', 'U') IS NULL
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

IF OBJECT_ID('dbo.PasswordResetTokens', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.PasswordResetTokens (
        ResetID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PasswordResetTokens PRIMARY KEY,
        UserID INT NOT NULL,
        Email NVARCHAR(150) NOT NULL,
        TokenHash NVARCHAR(128) NOT NULL,
        ExpiresAt DATETIME2(0) NOT NULL,
        UsedAt DATETIME2(0) NULL,
        CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_PasswordResetTokens_CreatedAt DEFAULT (SYSUTCDATETIME())
    );
END;
GO

IF OBJECT_ID('dbo.sp_ATLAS_GetCompanies', 'P') IS NOT NULL
BEGIN
    DROP PROCEDURE dbo.sp_ATLAS_GetCompanies;
END
GO

CREATE PROCEDURE dbo.sp_ATLAS_GetCompanies
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        CompanyID,
        CompanyCode,
        CompanyName,
        DatabaseName,
        LogoMimeType,
        CASE WHEN LogoData IS NULL THEN 0 ELSE DATALENGTH(LogoData) END AS LogoSize,
        Address,
        Phone,
        Email,
        TRN,
        ContactPerson,
        IsActive,
        CreatedAt,
        UpdatedAt
    FROM dbo.Companies
    WHERE IsActive = 1
    ORDER BY
        CASE WHEN UPPER(CompanyCode) = N'ATLAS' THEN 0 ELSE 1 END,
        CompanyName;
END;
GO

IF OBJECT_ID('dbo.sp_ATLAS_UpsertCompany', 'P') IS NOT NULL
BEGIN
    DROP PROCEDURE dbo.sp_ATLAS_UpsertCompany;
END
GO

CREATE PROCEDURE dbo.sp_ATLAS_UpsertCompany
    @CompanyID INT = NULL,
    @CompanyCode NVARCHAR(30),
    @CompanyName NVARCHAR(150),
    @DatabaseName SYSNAME,
    @LogoMimeType NVARCHAR(100) = NULL,
    @LogoData VARBINARY(MAX) = NULL,
    @Address NVARCHAR(300) = NULL,
    @Phone NVARCHAR(50) = NULL,
    @Email NVARCHAR(150) = NULL,
    @TRN NVARCHAR(50) = NULL,
    @ContactPerson NVARCHAR(120) = NULL,
    @IsActive BIT = 1,
    @UserID INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompanyID IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.Companies WHERE CompanyID = @CompanyID)
    BEGIN
        UPDATE dbo.Companies
        SET
            CompanyCode = @CompanyCode,
            CompanyName = @CompanyName,
            DatabaseName = @DatabaseName,
            LogoMimeType = COALESCE(@LogoMimeType, LogoMimeType),
            LogoData = COALESCE(@LogoData, LogoData),
            Address = @Address,
            Phone = @Phone,
            Email = @Email,
            TRN = @TRN,
            ContactPerson = @ContactPerson,
            IsActive = @IsActive,
            UpdatedAt = SYSUTCDATETIME(),
            UpdatedBy = @UserID
        WHERE CompanyID = @CompanyID;
    END
    ELSE
    BEGIN
        INSERT INTO dbo.Companies
            (CompanyCode, CompanyName, DatabaseName, LogoMimeType, LogoData, Address, Phone, Email, TRN, ContactPerson, IsActive, CreatedBy)
        VALUES
            (@CompanyCode, @CompanyName, @DatabaseName, @LogoMimeType, @LogoData, @Address, @Phone, @Email, @TRN, @ContactPerson, @IsActive, @UserID);

        SET @CompanyID = SCOPE_IDENTITY();
    END

    SELECT
        CompanyID,
        CompanyCode,
        CompanyName,
        DatabaseName,
        LogoMimeType,
        CASE WHEN LogoData IS NULL THEN 0 ELSE DATALENGTH(LogoData) END AS LogoSize,
        Address,
        Phone,
        Email,
        TRN,
        ContactPerson,
        IsActive,
        CreatedAt,
        UpdatedAt
    FROM dbo.Companies
    WHERE CompanyID = @CompanyID;
END;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Companies WHERE CompanyCode = N'ATLAS')
BEGIN
    INSERT INTO dbo.Companies
        (CompanyCode, CompanyName, DatabaseName, Address, IsActive)
    VALUES
        (N'ATLAS', N'ATLAS Airfare HCM', N'Atlasairfare010', N'', 1);
END;
ELSE
BEGIN
    UPDATE dbo.Companies
    SET CompanyName = N'ATLAS Airfare HCM',
        DatabaseName = N'Atlasairfare010',
        IsActive = 1
    WHERE CompanyCode = N'ATLAS';
END;
GO

IF OBJECT_ID('dbo.Employees', 'U') IS NOT NULL
   AND COL_LENGTH('dbo.Employees', 'Company') IS NOT NULL
   AND OBJECT_ID('dbo.AirfarePolicyRates', 'U') IS NOT NULL
BEGIN
    IF OBJECT_ID('dbo.YearEndPreviewEvidence', 'U') IS NOT NULL
    BEGIN
        DELETE y
        FROM dbo.YearEndPreviewEvidence y
        JOIN dbo.Companies c ON c.CompanyID = y.CompanyID
        WHERE (
                c.CompanyCode LIKE N'QAC%'
                OR c.CompanyName LIKE N'QA Temporary Company%'
                OR c.DatabaseName LIKE N'ATLAS_QA_%'
            )
          AND COALESCE(c.UpdatedAt, c.CreatedAt, SYSUTCDATETIME()) < DATEADD(MINUTE, -30, SYSUTCDATETIME());
    END;

    IF OBJECT_ID('dbo.YearEndHistory', 'U') IS NOT NULL
    BEGIN
        DELETE c
        FROM dbo.Companies c
        WHERE (
                c.CompanyCode LIKE N'QAC%'
                OR c.CompanyName LIKE N'QA Temporary Company%'
                OR c.DatabaseName LIKE N'ATLAS_QA_%'
            )
          AND COALESCE(c.UpdatedAt, c.CreatedAt, SYSUTCDATETIME()) < DATEADD(MINUTE, -30, SYSUTCDATETIME())
          AND NOT EXISTS (
                SELECT 1
                FROM dbo.Employees e
                WHERE UPPER(LTRIM(RTRIM(ISNULL(e.Company, N'')))) IN (
                    UPPER(LTRIM(RTRIM(ISNULL(c.CompanyCode, N'')))),
                    UPPER(LTRIM(RTRIM(ISNULL(c.CompanyName, N'')))),
                    UPPER(LTRIM(RTRIM(ISNULL(c.DatabaseName, N''))))
                )
            )
          AND NOT EXISTS (
                SELECT 1
                FROM dbo.AirfarePolicyRates r
                WHERE r.CompanyID = c.CompanyID
            )
          AND NOT EXISTS (
                SELECT 1
                FROM dbo.YearEndHistory y
                WHERE y.CompanyID = c.CompanyID
            );
    END
    ELSE
    BEGIN
        DELETE c
        FROM dbo.Companies c
        WHERE (
                c.CompanyCode LIKE N'QAC%'
                OR c.CompanyName LIKE N'QA Temporary Company%'
                OR c.DatabaseName LIKE N'ATLAS_QA_%'
            )
          AND COALESCE(c.UpdatedAt, c.CreatedAt, SYSUTCDATETIME()) < DATEADD(MINUTE, -30, SYSUTCDATETIME())
          AND NOT EXISTS (
                SELECT 1
                FROM dbo.Employees e
                WHERE UPPER(LTRIM(RTRIM(ISNULL(e.Company, N'')))) IN (
                    UPPER(LTRIM(RTRIM(ISNULL(c.CompanyCode, N'')))),
                    UPPER(LTRIM(RTRIM(ISNULL(c.CompanyName, N'')))),
                    UPPER(LTRIM(RTRIM(ISNULL(c.DatabaseName, N''))))
                )
            )
          AND NOT EXISTS (
                SELECT 1
                FROM dbo.AirfarePolicyRates r
                WHERE r.CompanyID = c.CompanyID
            );
    END;
END;
GO
