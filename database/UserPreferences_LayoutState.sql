SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.UserPreferences', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.UserPreferences (
        UserPreferenceID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_UserPreferences PRIMARY KEY,
        UserID INT NOT NULL,
        SelectedCompanyID INT NULL,
        FiscalYear INT NOT NULL,
        PreferencesJSON NVARCHAR(MAX) NULL,
        ThemeSettingsJSON NVARCHAR(MAX) NOT NULL CONSTRAINT DF_UserPreferences_ThemeSettingsJSON DEFAULT (N'{}'),
        LayoutSettingsJSON NVARCHAR(MAX) NOT NULL CONSTRAINT DF_UserPreferences_LayoutSettingsJSON DEFAULT (N'{}'),
        NavigationSettingsJSON NVARCHAR(MAX) NOT NULL CONSTRAINT DF_UserPreferences_NavigationSettingsJSON DEFAULT (N'{}'),
        IsActive BIT NOT NULL CONSTRAINT DF_UserPreferences_IsActive DEFAULT (1),
        CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_UserPreferences_CreatedAt DEFAULT (SYSUTCDATETIME()),
        UpdatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_UserPreferences_UpdatedAt DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT UQ_UserPreferences_User_Year UNIQUE (UserID, FiscalYear),
        CONSTRAINT CK_UserPreferences_FiscalYear CHECK (FiscalYear BETWEEN 2000 AND 2100),
        CONSTRAINT CK_UserPreferences_PreferencesJSON CHECK (PreferencesJSON IS NULL OR ISJSON(PreferencesJSON) = 1),
        CONSTRAINT CK_UserPreferences_ThemeSettingsJSON CHECK (ISJSON(ThemeSettingsJSON) = 1),
        CONSTRAINT CK_UserPreferences_LayoutSettingsJSON CHECK (ISJSON(LayoutSettingsJSON) = 1),
        CONSTRAINT CK_UserPreferences_NavigationSettingsJSON CHECK (ISJSON(NavigationSettingsJSON) = 1)
    );
END;
GO

IF OBJECT_ID(N'dbo.UserPreferences', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.UserPreferences', N'PreferencesJSON') IS NULL
BEGIN
    ALTER TABLE dbo.UserPreferences ADD PreferencesJSON NVARCHAR(MAX) NULL;
END;
GO

IF OBJECT_ID(N'dbo.UserPreferences', N'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1
       FROM sys.check_constraints
       WHERE name = N'CK_UserPreferences_PreferencesJSON'
         AND parent_object_id = OBJECT_ID(N'dbo.UserPreferences')
   )
BEGIN
    ALTER TABLE dbo.UserPreferences WITH CHECK
    ADD CONSTRAINT CK_UserPreferences_PreferencesJSON CHECK (PreferencesJSON IS NULL OR ISJSON(PreferencesJSON) = 1);
END;
GO

IF COL_LENGTH(N'dbo.UserPreferences', N'SelectedCompanyID') IS NOT NULL
   AND OBJECT_ID(N'dbo.Companies', N'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1
       FROM sys.foreign_keys
       WHERE name = N'FK_UserPreferences_Companies'
         AND parent_object_id = OBJECT_ID(N'dbo.UserPreferences')
   )
BEGIN
    ALTER TABLE dbo.UserPreferences WITH CHECK
    ADD CONSTRAINT FK_UserPreferences_Companies
    FOREIGN KEY (SelectedCompanyID) REFERENCES dbo.Companies(CompanyID);
END;
GO

IF COL_LENGTH(N'dbo.UserPreferences', N'UserID') IS NOT NULL
   AND OBJECT_ID(N'dbo.Users', N'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1
       FROM sys.foreign_keys
       WHERE name = N'FK_UserPreferences_Users'
         AND parent_object_id = OBJECT_ID(N'dbo.UserPreferences')
   )
BEGIN
    ALTER TABLE dbo.UserPreferences WITH CHECK
    ADD CONSTRAINT FK_UserPreferences_Users
    FOREIGN KEY (UserID) REFERENCES dbo.Users(UserID);
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_UserPreferences_Get
    @UserID INT,
    @FiscalYear INT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (1)
        UserPreferenceID,
        UserID,
        SelectedCompanyID,
        FiscalYear,
        PreferencesJSON,
        ThemeSettingsJSON,
        LayoutSettingsJSON,
        NavigationSettingsJSON,
        IsActive,
        CreatedAt,
        UpdatedAt
    FROM dbo.UserPreferences
    WHERE UserID = @UserID
      AND FiscalYear = @FiscalYear
      AND IsActive = 1
    ORDER BY UpdatedAt DESC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_UserPreferences_Upsert
    @UserID INT,
    @SelectedCompanyID INT = NULL,
    @FiscalYear INT,
    @PreferencesJSON NVARCHAR(MAX) = NULL,
    @ThemeSettingsJSON NVARCHAR(MAX),
    @LayoutSettingsJSON NVARCHAR(MAX) = N'{}',
    @NavigationSettingsJSON NVARCHAR(MAX) = N'{}'
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @PreferencesJSON IS NOT NULL AND ISJSON(@PreferencesJSON) <> 1 THROW 51000, 'PreferencesJSON must be valid JSON.', 1;
    IF ISJSON(@ThemeSettingsJSON) <> 1 THROW 51001, 'ThemeSettingsJSON must be valid JSON.', 1;
    IF ISJSON(@LayoutSettingsJSON) <> 1 THROW 51002, 'LayoutSettingsJSON must be valid JSON.', 1;
    IF ISJSON(@NavigationSettingsJSON) <> 1 THROW 51003, 'NavigationSettingsJSON must be valid JSON.', 1;

    MERGE dbo.UserPreferences WITH (HOLDLOCK) AS target
    USING (SELECT @UserID AS UserID, @FiscalYear AS FiscalYear) AS source
       ON target.UserID = source.UserID
      AND target.FiscalYear = source.FiscalYear
    WHEN MATCHED THEN
        UPDATE SET
            SelectedCompanyID = @SelectedCompanyID,
            PreferencesJSON = @PreferencesJSON,
            ThemeSettingsJSON = @ThemeSettingsJSON,
            LayoutSettingsJSON = @LayoutSettingsJSON,
            NavigationSettingsJSON = @NavigationSettingsJSON,
            IsActive = 1,
            UpdatedAt = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN
        INSERT (UserID, SelectedCompanyID, FiscalYear, PreferencesJSON, ThemeSettingsJSON, LayoutSettingsJSON, NavigationSettingsJSON)
        VALUES (@UserID, @SelectedCompanyID, @FiscalYear, @PreferencesJSON, @ThemeSettingsJSON, @LayoutSettingsJSON, @NavigationSettingsJSON);

    EXEC dbo.sp_UserPreferences_Get @UserID = @UserID, @FiscalYear = @FiscalYear;
END;
GO

-- Fetch structure used by the frontend shell:
-- EXEC dbo.sp_UserPreferences_Get @UserID = 1, @FiscalYear = 2026;
--
-- Save selected company, active fiscal year, and visual settings:
-- EXEC dbo.sp_UserPreferences_Upsert
--     @UserID = 1,
--     @SelectedCompanyID = 1,
--     @FiscalYear = 2026,
--     @PreferencesJSON = N'{"schemaVersion":2,"appearance":{"theme":"light","accentColor":"#0b63f6","density":"compact","tableRowHeight":"medium","reduceMotion":false}}',
--     @ThemeSettingsJSON = N'{"themeMode":"light","themeAccent":"blue","density":"compact","viewMode":"grid"}',
--     @LayoutSettingsJSON = N'{"sidebarCollapsed":false,"rightPanelsCollapsed":false}',
--     @NavigationSettingsJSON = N'{"activeView":"Preferences","shortcutHints":true}';
