/*
  ATLAS Python Core Foundation Schema
  Fresh application schema. Standalone. No legacy batch reset tables/jobs.
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
    LegalName NVARCHAR(180) NULL,
    WorkEmail NVARCHAR(254) NULL,
    PhoneNumber NVARCHAR(60) NULL,
    Department NVARCHAR(120) NULL,
    JobTitle NVARCHAR(120) NULL,
    EmploymentType NVARCHAR(40) NOT NULL CONSTRAINT DF_PythonCore_Employees_EmploymentType DEFAULT 'full_time',
    PayGroup NVARCHAR(120) NULL,
    Nationality NVARCHAR(80) NULL,
    PassportNumber NVARCHAR(80) NULL,
    CPRNumber NVARCHAR(80) NULL,
    BankName NVARCHAR(120) NULL,
    IBAN NVARCHAR(80) NULL,
    BasicSalary DECIMAL(12,3) NOT NULL CONSTRAINT DF_PythonCore_Employees_BasicSalary DEFAULT 0,
    EligibleForAirfare BIT NOT NULL CONSTRAINT DF_PythonCore_Employees_EligibleForAirfare DEFAULT 1,
    HomeAirportCode CHAR(3) NULL,
    DestinationAirportCode CHAR(3) NULL,
    StatusCode NVARCHAR(32) NOT NULL CONSTRAINT DF_PythonCore_Employees_Status DEFAULT 'active',
    HireDate DATE NOT NULL,
    TerminationDate DATE NULL,
    CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_PythonCore_Employees_Created DEFAULT SYSUTCDATETIME(),
    UpdatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_PythonCore_Employees_Updated DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_PythonCore_Employees_Tenants FOREIGN KEY (TenantID) REFERENCES core.Tenants(TenantID),
    CONSTRAINT FK_PythonCore_Employees_Companies FOREIGN KEY (CompanyID) REFERENCES core.Companies(CompanyID),
    CONSTRAINT UQ_PythonCore_Employees_TenantCompanyNumber UNIQUE (TenantID, CompanyID, EmployeeNumber),
    CONSTRAINT CK_PythonCore_Employees_BasicSalary CHECK (BasicSalary >= 0),
    CONSTRAINT CK_PythonCore_Employees_EmploymentType CHECK (EmploymentType IN ('full_time','part_time','contract','temporary','intern')),
    CONSTRAINT CK_PythonCore_Employees_Status CHECK (StatusCode IN ('active','inactive','suspended','terminated','on_leave'))
  );
END;
GO

IF COL_LENGTH(N'core.Employees', N'LegalName') IS NULL ALTER TABLE core.Employees ADD LegalName NVARCHAR(180) NULL;
IF COL_LENGTH(N'core.Employees', N'PhoneNumber') IS NULL ALTER TABLE core.Employees ADD PhoneNumber NVARCHAR(60) NULL;
IF COL_LENGTH(N'core.Employees', N'EmploymentType') IS NULL ALTER TABLE core.Employees ADD EmploymentType NVARCHAR(40) NOT NULL CONSTRAINT DF_PythonCore_Employees_EmploymentType_Add DEFAULT 'full_time';
IF COL_LENGTH(N'core.Employees', N'PayGroup') IS NULL ALTER TABLE core.Employees ADD PayGroup NVARCHAR(120) NULL;
IF COL_LENGTH(N'core.Employees', N'Nationality') IS NULL ALTER TABLE core.Employees ADD Nationality NVARCHAR(80) NULL;
IF COL_LENGTH(N'core.Employees', N'PassportNumber') IS NULL ALTER TABLE core.Employees ADD PassportNumber NVARCHAR(80) NULL;
IF COL_LENGTH(N'core.Employees', N'CPRNumber') IS NULL ALTER TABLE core.Employees ADD CPRNumber NVARCHAR(80) NULL;
IF COL_LENGTH(N'core.Employees', N'BankName') IS NULL ALTER TABLE core.Employees ADD BankName NVARCHAR(120) NULL;
IF COL_LENGTH(N'core.Employees', N'IBAN') IS NULL ALTER TABLE core.Employees ADD IBAN NVARCHAR(80) NULL;
IF COL_LENGTH(N'core.Employees', N'BasicSalary') IS NULL ALTER TABLE core.Employees ADD BasicSalary DECIMAL(12,3) NOT NULL CONSTRAINT DF_PythonCore_Employees_BasicSalary_Add DEFAULT 0;
IF COL_LENGTH(N'core.Employees', N'EligibleForAirfare') IS NULL ALTER TABLE core.Employees ADD EligibleForAirfare BIT NOT NULL CONSTRAINT DF_PythonCore_Employees_EligibleForAirfare_Add DEFAULT 1;
IF COL_LENGTH(N'core.Employees', N'HomeAirportCode') IS NULL ALTER TABLE core.Employees ADD HomeAirportCode CHAR(3) NULL;
IF COL_LENGTH(N'core.Employees', N'DestinationAirportCode') IS NULL ALTER TABLE core.Employees ADD DestinationAirportCode CHAR(3) NULL;
IF COL_LENGTH(N'core.Employees', N'TerminationDate') IS NULL ALTER TABLE core.Employees ADD TerminationDate DATE NULL;
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
    OriginAirportCode CHAR(3) NULL,
    DestinationAirportCode CHAR(3) NULL,
    TravelDate DATE NULL,
    AirlineName NVARCHAR(120) NULL,
    TicketNumber NVARCHAR(80) NULL,
    PaymentMode NVARCHAR(40) NOT NULL CONSTRAINT DF_PythonCore_Allocations_PaymentMode DEFAULT 'entitlement',
    TicketCost DECIMAL(12,3) NOT NULL,
    EntitlementApplied DECIMAL(12,3) NOT NULL,
    CompanyPaid DECIMAL(12,3) NOT NULL,
    StatusCode NVARCHAR(32) NOT NULL CONSTRAINT DF_PythonCore_Allocations_Status DEFAULT 'posted',
    EventID BIGINT NULL,
    CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_PythonCore_Allocations_Created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_PythonCore_Allocations_Employees FOREIGN KEY (EmployeeID) REFERENCES core.Employees(EmployeeID),
    CONSTRAINT FK_PythonCore_Allocations_Events FOREIGN KEY (EventID) REFERENCES core.EntitlementEvents(EventID),
    CONSTRAINT CK_PythonCore_Allocations_Amounts CHECK (TicketCost >= 0 AND EntitlementApplied >= 0 AND CompanyPaid >= 0),
    CONSTRAINT CK_PythonCore_Allocations_PaymentMode CHECK (PaymentMode IN ('entitlement','loan','employee','company','mixed'))
  );
END;
GO

IF COL_LENGTH(N'core.AirfareAllocations', N'OriginAirportCode') IS NULL ALTER TABLE core.AirfareAllocations ADD OriginAirportCode CHAR(3) NULL;
IF COL_LENGTH(N'core.AirfareAllocations', N'DestinationAirportCode') IS NULL ALTER TABLE core.AirfareAllocations ADD DestinationAirportCode CHAR(3) NULL;
IF COL_LENGTH(N'core.AirfareAllocations', N'TravelDate') IS NULL ALTER TABLE core.AirfareAllocations ADD TravelDate DATE NULL;
IF COL_LENGTH(N'core.AirfareAllocations', N'AirlineName') IS NULL ALTER TABLE core.AirfareAllocations ADD AirlineName NVARCHAR(120) NULL;
IF COL_LENGTH(N'core.AirfareAllocations', N'TicketNumber') IS NULL ALTER TABLE core.AirfareAllocations ADD TicketNumber NVARCHAR(80) NULL;
IF COL_LENGTH(N'core.AirfareAllocations', N'PaymentMode') IS NULL ALTER TABLE core.AirfareAllocations ADD PaymentMode NVARCHAR(40) NOT NULL CONSTRAINT DF_PythonCore_Allocations_PaymentMode_Add DEFAULT 'entitlement';
GO

IF OBJECT_ID(N'core.EmployeeLoans', N'U') IS NULL
BEGIN
  CREATE TABLE core.EmployeeLoans (
    LoanID UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_PythonCore_EmployeeLoans PRIMARY KEY,
    TenantID UNIQUEIDENTIFIER NOT NULL,
    CompanyID UNIQUEIDENTIFIER NOT NULL,
    EmployeeID UNIQUEIDENTIFIER NOT NULL,
    LoanType NVARCHAR(40) NOT NULL CONSTRAINT DF_PythonCore_Loans_LoanType DEFAULT 'airfare',
    PrincipalAmount DECIMAL(12,3) NOT NULL,
    EmiAmount DECIMAL(12,3) NOT NULL,
    TenureMonths INT NOT NULL CONSTRAINT DF_PythonCore_Loans_TenureMonths DEFAULT 0,
    OutstandingAmount DECIMAL(12,3) NOT NULL CONSTRAINT DF_PythonCore_Loans_OutstandingAmount DEFAULT 0,
    StartDate DATE NOT NULL,
    LoanDate DATE NULL,
    Notes NVARCHAR(400) NULL,
    StatusCode NVARCHAR(32) NOT NULL CONSTRAINT DF_PythonCore_Loans_Status DEFAULT 'active',
    CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_PythonCore_Loans_Created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_PythonCore_Loans_Employees FOREIGN KEY (EmployeeID) REFERENCES core.Employees(EmployeeID),
    CONSTRAINT CK_PythonCore_Loans_Amounts CHECK (PrincipalAmount >= 0 AND EmiAmount >= 0 AND OutstandingAmount >= 0 AND TenureMonths >= 0),
    CONSTRAINT CK_PythonCore_Loans_LoanType CHECK (LoanType IN ('airfare','emergency_ticket','salary_advance','manual'))
  );
END;
GO

IF COL_LENGTH(N'core.EmployeeLoans', N'LoanType') IS NULL ALTER TABLE core.EmployeeLoans ADD LoanType NVARCHAR(40) NOT NULL CONSTRAINT DF_PythonCore_Loans_LoanType_Add DEFAULT 'airfare';
IF COL_LENGTH(N'core.EmployeeLoans', N'TenureMonths') IS NULL ALTER TABLE core.EmployeeLoans ADD TenureMonths INT NOT NULL CONSTRAINT DF_PythonCore_Loans_TenureMonths_Add DEFAULT 0;
IF COL_LENGTH(N'core.EmployeeLoans', N'OutstandingAmount') IS NULL ALTER TABLE core.EmployeeLoans ADD OutstandingAmount DECIMAL(12,3) NOT NULL CONSTRAINT DF_PythonCore_Loans_OutstandingAmount_Add DEFAULT 0;
IF COL_LENGTH(N'core.EmployeeLoans', N'LoanDate') IS NULL ALTER TABLE core.EmployeeLoans ADD LoanDate DATE NULL;
IF COL_LENGTH(N'core.EmployeeLoans', N'Notes') IS NULL ALTER TABLE core.EmployeeLoans ADD Notes NVARCHAR(400) NULL;
GO

IF OBJECT_ID(N'core.Users', N'U') IS NULL
BEGIN
  CREATE TABLE core.Users (
    UserID UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_PythonCore_Users PRIMARY KEY,
    Username NVARCHAR(80) NOT NULL CONSTRAINT UQ_PythonCore_Users_Username UNIQUE,
    DisplayName NVARCHAR(160) NOT NULL,
    RoleCode NVARCHAR(40) NOT NULL CONSTRAINT DF_PythonCore_Users_Role DEFAULT 'admin',
    IsActive BIT NOT NULL CONSTRAINT DF_PythonCore_Users_IsActive DEFAULT 1,
    CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_PythonCore_Users_Created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_PythonCore_Users_Role CHECK (RoleCode IN ('admin','payroll','viewer','employee'))
  );
END;
GO

IF OBJECT_ID(N'core.UserPreferences', N'U') IS NULL
BEGIN
  CREATE TABLE core.UserPreferences (
    PreferenceID UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_PythonCore_UserPreferences PRIMARY KEY,
    UserID UNIQUEIDENTIFIER NOT NULL,
    PreferenceJSON NVARCHAR(MAX) NOT NULL,
    UpdatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_PythonCore_UserPreferences_Updated DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_PythonCore_UserPreferences_Users FOREIGN KEY (UserID) REFERENCES core.Users(UserID),
    CONSTRAINT UQ_PythonCore_UserPreferences_User UNIQUE (UserID)
  );
END;
GO

IF OBJECT_ID(N'core.SelfServiceRequests', N'U') IS NULL
BEGIN
  CREATE TABLE core.SelfServiceRequests (
    RequestID UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_PythonCore_SelfServiceRequests PRIMARY KEY,
    TenantID UNIQUEIDENTIFIER NOT NULL,
    CompanyID UNIQUEIDENTIFIER NOT NULL,
    EmployeeID UNIQUEIDENTIFIER NOT NULL,
    RequestType NVARCHAR(40) NOT NULL,
    RequestDate DATE NOT NULL,
    Amount DECIMAL(12,3) NULL,
    StatusCode NVARCHAR(32) NOT NULL CONSTRAINT DF_PythonCore_SelfService_Status DEFAULT 'submitted',
    Notes NVARCHAR(400) NULL,
    CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_PythonCore_SelfService_Created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_PythonCore_SelfService_Employees FOREIGN KEY (EmployeeID) REFERENCES core.Employees(EmployeeID),
    CONSTRAINT CK_PythonCore_SelfService_Type CHECK (RequestType IN ('airfare_request','profile_update','loan_request')),
    CONSTRAINT CK_PythonCore_SelfService_Status CHECK (StatusCode IN ('submitted','approved','rejected','cancelled'))
  );
END;
GO

IF OBJECT_ID(N'core.ImportExportRuns', N'U') IS NULL
BEGIN
  CREATE TABLE core.ImportExportRuns (
    RunID UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_PythonCore_ImportExportRuns PRIMARY KEY,
    Direction NVARCHAR(20) NOT NULL,
    ModuleCode NVARCHAR(60) NOT NULL,
    DataRowCount INT NOT NULL CONSTRAINT DF_PythonCore_ImportExport_DataRowCount DEFAULT 0,
    StatusCode NVARCHAR(32) NOT NULL,
    DetailJSON NVARCHAR(MAX) NULL,
    CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_PythonCore_ImportExport_Created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_PythonCore_ImportExport_Direction CHECK (Direction IN ('import','export')),
    CONSTRAINT CK_PythonCore_ImportExport_Status CHECK (StatusCode IN ('preview','completed','failed'))
  );
END;
GO

IF OBJECT_ID(N'core.SystemAuditLog', N'U') IS NULL
BEGIN
  CREATE TABLE core.SystemAuditLog (
    AuditID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PythonCore_SystemAuditLog PRIMARY KEY,
    AreaCode NVARCHAR(80) NOT NULL,
    ActionCode NVARCHAR(80) NOT NULL,
    Detail NVARCHAR(400) NULL,
    CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_PythonCore_SystemAudit_Created DEFAULT SYSUTCDATETIME()
  );
END;
GO

IF OBJECT_ID(N'core.Attachments', N'U') IS NULL
BEGIN
  CREATE TABLE core.Attachments (
    AttachmentID UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_PythonCore_Attachments PRIMARY KEY,
    ModuleCode NVARCHAR(60) NOT NULL,
    OwnerID NVARCHAR(80) NOT NULL,
    FileName NVARCHAR(240) NOT NULL,
    ContentType NVARCHAR(120) NOT NULL,
    ContentBytes VARBINARY(MAX) NOT NULL,
    CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_PythonCore_Attachments_Created DEFAULT SYSUTCDATETIME()
  );
END;
GO
