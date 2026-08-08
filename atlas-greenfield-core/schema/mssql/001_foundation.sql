/*
  ATLAS Greenfield Foundation Schema
  Purpose: Employees-first HCM core with tenant/company/database scope from row one.
  This file is standalone. It does not depend on legacy ATLAS tables.
*/

SET XACT_ABORT ON;
GO

IF SCHEMA_ID(N'core') IS NULL
  EXEC(N'CREATE SCHEMA core');
GO

IF OBJECT_ID(N'core.Tenants', N'U') IS NULL
BEGIN
  CREATE TABLE core.Tenants (
    TenantID UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Tenants PRIMARY KEY,
    TenantCode NVARCHAR(40) NOT NULL CONSTRAINT UQ_Tenants_Code UNIQUE,
    TenantName NVARCHAR(160) NOT NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_Tenants_IsActive DEFAULT 1,
    CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_Tenants_CreatedAtUtc DEFAULT SYSUTCDATETIME()
  );
END;
GO

IF OBJECT_ID(N'core.TenantDatabases', N'U') IS NULL
BEGIN
  CREATE TABLE core.TenantDatabases (
    TenantDatabaseID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_TenantDatabases PRIMARY KEY,
    TenantID UNIQUEIDENTIFIER NOT NULL,
    LogicalName NVARCHAR(80) NOT NULL,
    SqlServerName NVARCHAR(160) NOT NULL,
    DatabaseName NVARCHAR(128) NOT NULL,
    IsPrimary BIT NOT NULL CONSTRAINT DF_TenantDatabases_IsPrimary DEFAULT 0,
    CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_TenantDatabases_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_TenantDatabases_Tenants FOREIGN KEY (TenantID) REFERENCES core.Tenants(TenantID),
    CONSTRAINT UQ_TenantDatabases_TenantLogical UNIQUE (TenantID, LogicalName)
  );
END;
GO

IF OBJECT_ID(N'core.Companies', N'U') IS NULL
BEGIN
  CREATE TABLE core.Companies (
    CompanyID UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Companies PRIMARY KEY,
    TenantID UNIQUEIDENTIFIER NOT NULL,
    CompanyCode NVARCHAR(40) NOT NULL,
    CompanyName NVARCHAR(180) NOT NULL,
    BaseCurrencyCode CHAR(3) NOT NULL CONSTRAINT DF_Companies_BaseCurrency DEFAULT 'BHD',
    IsActive BIT NOT NULL CONSTRAINT DF_Companies_IsActive DEFAULT 1,
    CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_Companies_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Companies_Tenants FOREIGN KEY (TenantID) REFERENCES core.Tenants(TenantID),
    CONSTRAINT UQ_Companies_TenantCode UNIQUE (TenantID, CompanyCode)
  );
END;
GO

IF OBJECT_ID(N'core.Employees', N'U') IS NULL
BEGIN
  CREATE TABLE core.Employees (
    EmployeeID UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Employees PRIMARY KEY,
    TenantID UNIQUEIDENTIFIER NOT NULL,
    CompanyID UNIQUEIDENTIFIER NOT NULL,
    EmployeeNumber NVARCHAR(60) NOT NULL,
    DisplayName NVARCHAR(180) NOT NULL,
    LegalName NVARCHAR(180) NULL,
    WorkEmail NVARCHAR(254) NULL,
    Department NVARCHAR(120) NULL,
    JobTitle NVARCHAR(120) NULL,
    EmploymentType NVARCHAR(40) NOT NULL CONSTRAINT DF_Employees_EmploymentType DEFAULT 'full_time',
    StatusCode NVARCHAR(32) NOT NULL CONSTRAINT DF_Employees_Status DEFAULT 'active',
    HireDate DATE NOT NULL,
    TerminationDate DATE NULL,
    CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_Employees_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
    UpdatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_Employees_UpdatedAtUtc DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Employees_Tenants FOREIGN KEY (TenantID) REFERENCES core.Tenants(TenantID),
    CONSTRAINT FK_Employees_Companies FOREIGN KEY (CompanyID) REFERENCES core.Companies(CompanyID),
    CONSTRAINT UQ_Employees_TenantCompanyNumber UNIQUE (TenantID, CompanyID, EmployeeNumber),
    CONSTRAINT CK_Employees_Status CHECK (StatusCode IN ('active','inactive','suspended','terminated','on_leave')),
    CONSTRAINT CK_Employees_Termination CHECK (TerminationDate IS NULL OR TerminationDate >= HireDate)
  );
END;
GO

IF OBJECT_ID(N'core.AirfareEntitlementPolicies', N'U') IS NULL
BEGIN
  CREATE TABLE core.AirfareEntitlementPolicies (
    PolicyID UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_AirfareEntitlementPolicies PRIMARY KEY,
    TenantID UNIQUEIDENTIFIER NOT NULL,
    CompanyID UNIQUEIDENTIFIER NOT NULL,
    PolicyCode NVARCHAR(60) NOT NULL,
    PolicyName NVARCHAR(160) NOT NULL,
    AccrualCadence NVARCHAR(40) NOT NULL,
    MaxPayoutAmount DECIMAL(12,2) NOT NULL,
    CurrencyCode CHAR(3) NOT NULL CONSTRAINT DF_AirfarePolicies_Currency DEFAULT 'BHD',
    EffectiveFrom DATE NOT NULL,
    EffectiveTo DATE NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_AirfarePolicies_IsActive DEFAULT 1,
    CONSTRAINT FK_AirfarePolicies_Tenants FOREIGN KEY (TenantID) REFERENCES core.Tenants(TenantID),
    CONSTRAINT FK_AirfarePolicies_Companies FOREIGN KEY (CompanyID) REFERENCES core.Companies(CompanyID),
    CONSTRAINT UQ_AirfarePolicies_TenantCompanyCode UNIQUE (TenantID, CompanyID, PolicyCode),
    CONSTRAINT CK_AirfarePolicies_Cadence CHECK (AccrualCadence IN ('monthly','pay_period','service_day','manual_rule')),
    CONSTRAINT CK_AirfarePolicies_Effective CHECK (EffectiveTo IS NULL OR EffectiveTo >= EffectiveFrom)
  );
END;
GO

IF OBJECT_ID(N'core.EmployeeStatusEvents', N'U') IS NULL
BEGIN
  CREATE TABLE core.EmployeeStatusEvents (
    StatusEventID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_EmployeeStatusEvents PRIMARY KEY,
    EmployeeID UNIQUEIDENTIFIER NOT NULL,
    StatusCode NVARCHAR(32) NOT NULL,
    EffectiveDate DATE NOT NULL,
    Reason NVARCHAR(240) NULL,
    CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_EmployeeStatusEvents_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_EmployeeStatusEvents_Employees FOREIGN KEY (EmployeeID) REFERENCES core.Employees(EmployeeID),
    CONSTRAINT CK_EmployeeStatusEvents_Status CHECK (StatusCode IN ('active','inactive','suspended','terminated','on_leave'))
  );
END;
GO

IF OBJECT_ID(N'core.AirfareEntitlementEvents', N'U') IS NULL
BEGIN
  CREATE TABLE core.AirfareEntitlementEvents (
    EntitlementEventID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AirfareEntitlementEvents PRIMARY KEY,
    TenantID UNIQUEIDENTIFIER NOT NULL,
    CompanyID UNIQUEIDENTIFIER NOT NULL,
    EmployeeID UNIQUEIDENTIFIER NOT NULL,
    EventDate DATE NOT NULL,
    EventType NVARCHAR(40) NOT NULL,
    Amount DECIMAL(12,2) NOT NULL,
    CurrencyCode CHAR(3) NOT NULL CONSTRAINT DF_AirfareEvents_Currency DEFAULT 'BHD',
    SourceReference NVARCHAR(120) NULL,
    CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_AirfareEvents_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_AirfareEvents_Employees FOREIGN KEY (EmployeeID) REFERENCES core.Employees(EmployeeID),
    CONSTRAINT CK_AirfareEvents_Type CHECK (EventType IN ('seed','accrual','usage','adjustment','reversal'))
  );
END;
GO

IF OBJECT_ID(N'core.EmployeeLoans', N'U') IS NULL
BEGIN
  CREATE TABLE core.EmployeeLoans (
    LoanID UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_EmployeeLoans PRIMARY KEY,
    TenantID UNIQUEIDENTIFIER NOT NULL,
    CompanyID UNIQUEIDENTIFIER NOT NULL,
    EmployeeID UNIQUEIDENTIFIER NOT NULL,
    PrincipalAmount DECIMAL(12,2) NOT NULL,
    EmiAmount DECIMAL(12,2) NOT NULL,
    StartDate DATE NOT NULL,
    StatusCode NVARCHAR(32) NOT NULL CONSTRAINT DF_EmployeeLoans_Status DEFAULT 'active',
    CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_EmployeeLoans_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_EmployeeLoans_Employees FOREIGN KEY (EmployeeID) REFERENCES core.Employees(EmployeeID),
    CONSTRAINT CK_EmployeeLoans_Amounts CHECK (PrincipalAmount >= 0 AND EmiAmount >= 0),
    CONSTRAINT CK_EmployeeLoans_Status CHECK (StatusCode IN ('active','settled','paused','cancelled'))
  );
END;
GO
