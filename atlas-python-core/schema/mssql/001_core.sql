/*
  ATLAS Python Core Foundation Schema
  Fresh application schema. Standalone. No legacy annual close/reset tables/jobs.
*/

SET XACT_ABORT ON;
GO

IF SCHEMA_ID(N'core') IS NULL EXEC(N'CREATE SCHEMA core');
GO

IF OBJECT_ID(N'core.Tenants', N'U') IS NULL
BEGIN
  CREATE TABLE core.Tenants (
    TenantID UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_PythonCore_Tenants PRIMARY KEY,
    TenantCode NVARCHAR(40) NOT NULL CONSTRAINT UQ_PythonCore_Tenants_Code UNIQUE,
    TenantName NVARCHAR(160) NOT NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_PythonCore_Tenants_IsActive DEFAULT 1,
    CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_PythonCore_Tenants_Created DEFAULT SYSUTCDATETIME()
  );
END;
GO

IF OBJECT_ID(N'core.Companies', N'U') IS NULL
BEGIN
  CREATE TABLE core.Companies (
    CompanyID UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_PythonCore_Companies PRIMARY KEY,
    TenantID UNIQUEIDENTIFIER NOT NULL,
    CompanyCode NVARCHAR(40) NOT NULL,
    CompanyName NVARCHAR(180) NOT NULL,
    BaseCurrencyCode CHAR(3) NOT NULL CONSTRAINT DF_PythonCore_Companies_Currency DEFAULT 'BHD',
    IsActive BIT NOT NULL CONSTRAINT DF_PythonCore_Companies_IsActive DEFAULT 1,
    CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_PythonCore_Companies_Created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_PythonCore_Companies_Tenants FOREIGN KEY (TenantID) REFERENCES core.Tenants(TenantID),
    CONSTRAINT UQ_PythonCore_Companies_TenantCode UNIQUE (TenantID, CompanyCode)
  );
END;
GO

IF OBJECT_ID(N'core.Employees', N'U') IS NULL
BEGIN
  CREATE TABLE core.Employees (
    EmployeeID UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_PythonCore_Employees PRIMARY KEY,
    TenantID UNIQUEIDENTIFIER NOT NULL,
    CompanyID UNIQUEIDENTIFIER NOT NULL,
    EmployeeNumber NVARCHAR(60) NOT NULL,
    DisplayName NVARCHAR(180) NOT NULL,
    WorkEmail NVARCHAR(254) NULL,
    Department NVARCHAR(120) NULL,
    JobTitle NVARCHAR(120) NULL,
    StatusCode NVARCHAR(32) NOT NULL CONSTRAINT DF_PythonCore_Employees_Status DEFAULT 'active',
    HireDate DATE NOT NULL,
    CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_PythonCore_Employees_Created DEFAULT SYSUTCDATETIME(),
    UpdatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_PythonCore_Employees_Updated DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_PythonCore_Employees_Tenants FOREIGN KEY (TenantID) REFERENCES core.Tenants(TenantID),
    CONSTRAINT FK_PythonCore_Employees_Companies FOREIGN KEY (CompanyID) REFERENCES core.Companies(CompanyID),
    CONSTRAINT UQ_PythonCore_Employees_TenantCompanyNumber UNIQUE (TenantID, CompanyID, EmployeeNumber),
    CONSTRAINT CK_PythonCore_Employees_Status CHECK (StatusCode IN ('active','inactive','suspended','terminated','on_leave'))
  );
END;
GO

IF OBJECT_ID(N'core.EntitlementRules', N'U') IS NULL
BEGIN
  CREATE TABLE core.EntitlementRules (
    RuleID UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_PythonCore_EntitlementRules PRIMARY KEY,
    TenantID UNIQUEIDENTIFIER NOT NULL,
    CompanyID UNIQUEIDENTIFIER NOT NULL,
    RuleCode NVARCHAR(60) NOT NULL,
    RuleName NVARCHAR(160) NOT NULL,
    Cadence NVARCHAR(40) NOT NULL,
    MaxPayoutAmount DECIMAL(12,3) NOT NULL,
    CurrencyCode CHAR(3) NOT NULL CONSTRAINT DF_PythonCore_Rules_Currency DEFAULT 'BHD',
    EffectiveFrom DATE NOT NULL,
    EffectiveTo DATE NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_PythonCore_Rules_IsActive DEFAULT 1,
    CONSTRAINT FK_PythonCore_Rules_Tenants FOREIGN KEY (TenantID) REFERENCES core.Tenants(TenantID),
    CONSTRAINT FK_PythonCore_Rules_Companies FOREIGN KEY (CompanyID) REFERENCES core.Companies(CompanyID),
    CONSTRAINT UQ_PythonCore_Rules_TenantCompanyCode UNIQUE (TenantID, CompanyID, RuleCode),
    CONSTRAINT CK_PythonCore_Rules_Cadence CHECK (Cadence IN ('monthly','pay_period','service_day','manual_rule'))
  );
END;
GO

IF OBJECT_ID(N'core.EntitlementEvents', N'U') IS NULL
BEGIN
  CREATE TABLE core.EntitlementEvents (
    EventID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PythonCore_EntitlementEvents PRIMARY KEY,
    TenantID UNIQUEIDENTIFIER NOT NULL,
    CompanyID UNIQUEIDENTIFIER NOT NULL,
    EmployeeID UNIQUEIDENTIFIER NOT NULL,
    EventDate DATE NOT NULL,
    EventType NVARCHAR(40) NOT NULL,
    Amount DECIMAL(12,3) NOT NULL,
    CurrencyCode CHAR(3) NOT NULL CONSTRAINT DF_PythonCore_Events_Currency DEFAULT 'BHD',
    SourceReference NVARCHAR(120) NULL,
    CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_PythonCore_Events_Created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_PythonCore_Events_Employees FOREIGN KEY (EmployeeID) REFERENCES core.Employees(EmployeeID),
    CONSTRAINT CK_PythonCore_Events_Type CHECK (EventType IN ('seed','accrual','usage','adjustment','reversal'))
  );
END;
GO

IF OBJECT_ID(N'core.AirfareAllocations', N'U') IS NULL
BEGIN
  CREATE TABLE core.AirfareAllocations (
    AllocationID UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_PythonCore_AirfareAllocations PRIMARY KEY,
    TenantID UNIQUEIDENTIFIER NOT NULL,
    CompanyID UNIQUEIDENTIFIER NOT NULL,
    EmployeeID UNIQUEIDENTIFIER NOT NULL,
    AllocationDate DATE NOT NULL,
    TicketCost DECIMAL(12,3) NOT NULL,
    EntitlementApplied DECIMAL(12,3) NOT NULL,
    CompanyPaid DECIMAL(12,3) NOT NULL,
    StatusCode NVARCHAR(32) NOT NULL CONSTRAINT DF_PythonCore_Allocations_Status DEFAULT 'posted',
    EventID BIGINT NULL,
    CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_PythonCore_Allocations_Created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_PythonCore_Allocations_Employees FOREIGN KEY (EmployeeID) REFERENCES core.Employees(EmployeeID),
    CONSTRAINT FK_PythonCore_Allocations_Events FOREIGN KEY (EventID) REFERENCES core.EntitlementEvents(EventID),
    CONSTRAINT CK_PythonCore_Allocations_Amounts CHECK (TicketCost >= 0 AND EntitlementApplied >= 0 AND CompanyPaid >= 0)
  );
END;
GO

IF OBJECT_ID(N'core.EmployeeLoans', N'U') IS NULL
BEGIN
  CREATE TABLE core.EmployeeLoans (
    LoanID UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_PythonCore_EmployeeLoans PRIMARY KEY,
    TenantID UNIQUEIDENTIFIER NOT NULL,
    CompanyID UNIQUEIDENTIFIER NOT NULL,
    EmployeeID UNIQUEIDENTIFIER NOT NULL,
    PrincipalAmount DECIMAL(12,3) NOT NULL,
    EmiAmount DECIMAL(12,3) NOT NULL,
    StartDate DATE NOT NULL,
    StatusCode NVARCHAR(32) NOT NULL CONSTRAINT DF_PythonCore_Loans_Status DEFAULT 'active',
    CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_PythonCore_Loans_Created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_PythonCore_Loans_Employees FOREIGN KEY (EmployeeID) REFERENCES core.Employees(EmployeeID),
    CONSTRAINT CK_PythonCore_Loans_Amounts CHECK (PrincipalAmount >= 0 AND EmiAmount >= 0)
  );
END;
GO
