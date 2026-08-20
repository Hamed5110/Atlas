SET XACT_ABORT ON;
SET NOCOUNT ON;
GO

CREATE SCHEMA airfare AUTHORIZATION dbo;
GO

CREATE TABLE airfare.Companies (
    Id uniqueidentifier NOT NULL CONSTRAINT PK_Companies PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
    Code nvarchar(30) NOT NULL,
    Name nvarchar(200) NOT NULL,
    Version int NOT NULL CONSTRAINT DF_Companies_Version DEFAULT 1,
    CreatedAt datetime2(7) NOT NULL CONSTRAINT DF_Companies_Created DEFAULT SYSUTCDATETIME(),
    UpdatedAt datetime2(7) NOT NULL CONSTRAINT DF_Companies_Updated DEFAULT SYSUTCDATETIME(),
    DeletedAt datetime2(7) NULL,
    ValidFrom datetime2(7) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
    ValidTo datetime2(7) GENERATED ALWAYS AS ROW END HIDDEN NOT NULL,
    PERIOD FOR SYSTEM_TIME (ValidFrom, ValidTo),
    CONSTRAINT CK_Companies_Version CHECK (Version > 0)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = airfare.CompaniesHistory, DATA_CONSISTENCY_CHECK = ON));
GO
CREATE UNIQUE INDEX UX_Companies_Code_Active ON airfare.Companies(Code) WHERE DeletedAt IS NULL;
CREATE INDEX IX_CompaniesHistory_Time_Id ON airfare.CompaniesHistory(ValidTo, ValidFrom, Id);
GO

CREATE TABLE airfare.Users (
    Id uniqueidentifier NOT NULL CONSTRAINT PK_Users PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
    Username nvarchar(100) NOT NULL,
    PasswordHash nvarchar(255) NOT NULL,
    DisplayName nvarchar(200) NOT NULL,
    RolesJson nvarchar(max) NOT NULL,
    IsActive bit NOT NULL CONSTRAINT DF_Users_Active DEFAULT 1,
    CreatedAt datetime2(7) NOT NULL CONSTRAINT DF_Users_Created DEFAULT SYSUTCDATETIME(),
    LastLoginAt datetime2(7) NULL,
    CONSTRAINT CK_Users_RolesJson CHECK (ISJSON(RolesJson) = 1)
);
CREATE UNIQUE INDEX UX_Users_Username ON airfare.Users(Username);
GO

CREATE TABLE airfare.Employees (
    Id uniqueidentifier NOT NULL CONSTRAINT PK_Employees PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
    CompanyId uniqueidentifier NOT NULL,
    Code nvarchar(30) NOT NULL,
    FullName nvarchar(200) NOT NULL,
    JoinDate date NOT NULL,
    Department nvarchar(100) NOT NULL CONSTRAINT DF_Employees_Department DEFAULT N'',
    Branch nvarchar(100) NOT NULL CONSTRAINT DF_Employees_Branch DEFAULT N'',
    Email nvarchar(320) NULL,
    IsActive bit NOT NULL CONSTRAINT DF_Employees_Active DEFAULT 1,
    Version int NOT NULL CONSTRAINT DF_Employees_Version DEFAULT 1,
    CreatedAt datetime2(7) NOT NULL CONSTRAINT DF_Employees_Created DEFAULT SYSUTCDATETIME(),
    UpdatedAt datetime2(7) NOT NULL CONSTRAINT DF_Employees_Updated DEFAULT SYSUTCDATETIME(),
    DeletedAt datetime2(7) NULL,
    ValidFrom datetime2(7) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
    ValidTo datetime2(7) GENERATED ALWAYS AS ROW END HIDDEN NOT NULL,
    PERIOD FOR SYSTEM_TIME (ValidFrom, ValidTo),
    CONSTRAINT FK_Employees_Companies FOREIGN KEY (CompanyId) REFERENCES airfare.Companies(Id),
    CONSTRAINT CK_Employees_Version CHECK (Version > 0),
    CONSTRAINT CK_Employees_Code CHECK (LEN(LTRIM(RTRIM(Code))) > 0)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = airfare.EmployeesHistory, DATA_CONSISTENCY_CHECK = ON));
GO
CREATE UNIQUE INDEX UX_Employees_Company_Code_Active
    ON airfare.Employees(CompanyId, Code) WHERE DeletedAt IS NULL;
CREATE INDEX IX_Employees_Search ON airfare.Employees(CompanyId, IsActive, Department)
    INCLUDE (Code, FullName, Branch) WHERE DeletedAt IS NULL;
CREATE INDEX IX_EmployeesHistory_Time_Id ON airfare.EmployeesHistory(ValidTo, ValidFrom, Id);
GO

CREATE TABLE airfare.OpeningBalances (
    Id uniqueidentifier NOT NULL CONSTRAINT PK_OpeningBalances PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
    EmployeeId uniqueidentifier NOT NULL,
    BalanceYear smallint NOT NULL,
    OpeningDays decimal(10,4) NOT NULL,
    OpeningAmount decimal(19,4) NOT NULL,
    MaximumPayout decimal(19,4) NOT NULL,
    Version int NOT NULL CONSTRAINT DF_OpeningBalances_Version DEFAULT 1,
    CreatedAt datetime2(7) NOT NULL CONSTRAINT DF_OpeningBalances_Created DEFAULT SYSUTCDATETIME(),
    UpdatedAt datetime2(7) NOT NULL CONSTRAINT DF_OpeningBalances_Updated DEFAULT SYSUTCDATETIME(),
    DeletedAt datetime2(7) NULL,
    CONSTRAINT FK_OpeningBalances_Employee FOREIGN KEY (EmployeeId) REFERENCES airfare.Employees(Id),
    CONSTRAINT CK_OpeningBalances_Year CHECK (BalanceYear BETWEEN 2000 AND 2200),
    CONSTRAINT CK_OpeningBalances_Amounts CHECK
      (OpeningDays BETWEEN 0 AND 60 AND OpeningAmount >= 0 AND MaximumPayout >= 0)
);
CREATE UNIQUE INDEX UX_OpeningBalances_Employee_Year_Active
    ON airfare.OpeningBalances(EmployeeId, BalanceYear) WHERE DeletedAt IS NULL;
GO

CREATE TABLE airfare.Tickets (
    Id uniqueidentifier NOT NULL CONSTRAINT PK_Tickets PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
    EmployeeId uniqueidentifier NOT NULL,
    TravelDate date NOT NULL,
    OriginCode char(3) NOT NULL,
    DestinationCode char(3) NOT NULL,
    TicketCost decimal(19,4) NOT NULL,
    Entitlement decimal(19,4) NOT NULL,
    CompanyPaid decimal(19,4) NOT NULL,
    ExcessHandling varchar(30) NOT NULL CONSTRAINT DF_Tickets_ExcessHandling DEFAULT 'SELF_PAID',
    ExcessAmount AS
      (CONVERT(decimal(19,4), CASE WHEN CompanyPaid > Entitlement THEN CompanyPaid - Entitlement ELSE 0 END)) PERSISTED,
    Status varchar(20) NOT NULL,
    Version int NOT NULL CONSTRAINT DF_Tickets_Version DEFAULT 1,
    CreatedAt datetime2(7) NOT NULL CONSTRAINT DF_Tickets_Created DEFAULT SYSUTCDATETIME(),
    UpdatedAt datetime2(7) NOT NULL CONSTRAINT DF_Tickets_Updated DEFAULT SYSUTCDATETIME(),
    DeletedAt datetime2(7) NULL,
    CONSTRAINT FK_Tickets_Employee FOREIGN KEY (EmployeeId) REFERENCES airfare.Employees(Id),
    CONSTRAINT CK_Tickets_Route CHECK (OriginCode <> DestinationCode),
    CONSTRAINT CK_Tickets_Amounts CHECK (TicketCost >= 0 AND Entitlement >= 0 AND CompanyPaid >= 0),
    CONSTRAINT CK_Tickets_Status CHECK (Status IN ('draft','submitted','approved','rejected','paid')),
    CONSTRAINT CK_Tickets_ExcessHandling CHECK
      (ExcessHandling IN ('CONVERT_TO_LOAN','COMPANY_PAID','SELF_PAID'))
);
CREATE INDEX IX_Tickets_Employee_Date ON airfare.Tickets(EmployeeId, TravelDate DESC)
    INCLUDE (Status, TicketCost, Entitlement, CompanyPaid) WHERE DeletedAt IS NULL;
CREATE INDEX IX_Tickets_Excess ON airfare.Tickets(Status, ExcessAmount)
    INCLUDE (EmployeeId, TravelDate) WHERE DeletedAt IS NULL AND ExcessAmount > 0;
GO

CREATE TABLE airfare.Loans (
    Id uniqueidentifier NOT NULL CONSTRAINT PK_Loans PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
    EmployeeId uniqueidentifier NOT NULL,
    SourceTicketId uniqueidentifier NULL,
    Principal decimal(19,4) NOT NULL,
    AnnualRate decimal(9,6) NOT NULL,
    Installments smallint NOT NULL,
    Outstanding decimal(19,4) NOT NULL,
    Status varchar(20) NOT NULL,
    DeferredUntil date NULL,
    Version int NOT NULL CONSTRAINT DF_Loans_Version DEFAULT 1,
    CreatedAt datetime2(7) NOT NULL CONSTRAINT DF_Loans_Created DEFAULT SYSUTCDATETIME(),
    UpdatedAt datetime2(7) NOT NULL CONSTRAINT DF_Loans_Updated DEFAULT SYSUTCDATETIME(),
    DeletedAt datetime2(7) NULL,
    CONSTRAINT FK_Loans_Employee FOREIGN KEY (EmployeeId) REFERENCES airfare.Employees(Id),
    CONSTRAINT FK_Loans_Ticket FOREIGN KEY (SourceTicketId) REFERENCES airfare.Tickets(Id),
    CONSTRAINT CK_Loans_Terms CHECK
      (Principal > 0 AND AnnualRate >= 0 AND Installments > 0 AND Outstanding >= 0),
    CONSTRAINT CK_Loans_Status CHECK (Status IN ('active','deferred','settled')),
    CONSTRAINT CK_Loans_Settled CHECK
      ((Status = 'settled' AND Outstanding = 0) OR Status <> 'settled')
);
CREATE INDEX IX_Loans_Recovery ON airfare.Loans(Status, DeferredUntil, EmployeeId)
    INCLUDE (Outstanding, Installments) WHERE DeletedAt IS NULL;
GO

CREATE TABLE airfare.LoanPayments (
    Id uniqueidentifier NOT NULL CONSTRAINT PK_LoanPayments PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
    LoanId uniqueidentifier NOT NULL,
    Amount decimal(19,4) NOT NULL,
    PaidOn date NOT NULL,
    Reference nvarchar(100) NOT NULL CONSTRAINT DF_LoanPayments_Reference DEFAULT N'',
    CreatedAt datetime2(7) NOT NULL CONSTRAINT DF_LoanPayments_Created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_LoanPayments_Loan FOREIGN KEY (LoanId) REFERENCES airfare.Loans(Id),
    CONSTRAINT CK_LoanPayments_Amount CHECK (Amount > 0)
);
CREATE INDEX IX_LoanPayments_Loan_Date ON airfare.LoanPayments(LoanId, PaidOn DESC);
GO

CREATE TABLE airfare.Preferences (
    Id uniqueidentifier NOT NULL CONSTRAINT PK_Preferences PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
    ScopeType varchar(20) NOT NULL,
    ScopeId uniqueidentifier NULL,
    PreferenceKey nvarchar(200) NOT NULL,
    JsonValue nvarchar(max) NOT NULL,
    IsLocked bit NOT NULL CONSTRAINT DF_Preferences_Locked DEFAULT 0,
    Version int NOT NULL CONSTRAINT DF_Preferences_Version DEFAULT 1,
    UpdatedAt datetime2(7) NOT NULL CONSTRAINT DF_Preferences_Updated DEFAULT SYSUTCDATETIME(),
    DeletedAt datetime2(7) NULL,
    CONSTRAINT CK_Preferences_Scope CHECK
      (ScopeType IN ('global','pay_group','repair_center','user','default','company','branch','department')),
    CONSTRAINT CK_Preferences_Json CHECK (ISJSON(JsonValue) = 1)
);
CREATE UNIQUE INDEX UX_Preferences_Scope_Key_Active
    ON airfare.Preferences(ScopeType, ScopeId, PreferenceKey) WHERE DeletedAt IS NULL;
GO

CREATE TABLE airfare.Attachments (
    Id uniqueidentifier NOT NULL CONSTRAINT PK_Attachments PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
    EntityType varchar(50) NOT NULL,
    EntityId uniqueidentifier NOT NULL,
    OriginalName nvarchar(255) NOT NULL,
    ContentType varchar(100) NOT NULL,
    SizeBytes bigint NOT NULL,
    Sha256 char(64) NOT NULL,
    StorageKey nvarchar(500) NOT NULL,
    ScanStatus varchar(20) NOT NULL,
    CreatedAt datetime2(7) NOT NULL CONSTRAINT DF_Attachments_Created DEFAULT SYSUTCDATETIME(),
    DeletedAt datetime2(7) NULL,
    CONSTRAINT CK_Attachments_Size CHECK (SizeBytes BETWEEN 1 AND 26214400),
    CONSTRAINT CK_Attachments_Scan CHECK (ScanStatus IN ('pending','clean','rejected'))
);
CREATE UNIQUE INDEX UX_Attachments_StorageKey ON airfare.Attachments(StorageKey);
CREATE INDEX IX_Attachments_Entity ON airfare.Attachments(EntityType, EntityId) WHERE DeletedAt IS NULL;
GO

CREATE TABLE airfare.AuditLog (
    Id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_AuditLog PRIMARY KEY,
    OccurredAt datetime2(7) NOT NULL CONSTRAINT DF_AuditLog_Time DEFAULT SYSUTCDATETIME(),
    ActorId uniqueidentifier NULL,
    CorrelationId varchar(64) NULL,
    Action varchar(30) NOT NULL,
    EntityType varchar(100) NOT NULL,
    EntityId uniqueidentifier NULL,
    BeforeJson nvarchar(max) NULL,
    AfterJson nvarchar(max) NULL,
    ClientIp varchar(45) NULL,
    SessionId uniqueidentifier NULL,
    CONSTRAINT CK_AuditLog_BeforeJson CHECK (BeforeJson IS NULL OR ISJSON(BeforeJson) = 1),
    CONSTRAINT CK_AuditLog_AfterJson CHECK (AfterJson IS NULL OR ISJSON(AfterJson) = 1)
);
CREATE INDEX IX_AuditLog_Entity_Time ON airfare.AuditLog(EntityType, EntityId, OccurredAt DESC);
CREATE INDEX IX_AuditLog_Correlation ON airfare.AuditLog(CorrelationId) WHERE CorrelationId IS NOT NULL;
GO

CREATE TABLE airfare.RefreshTokens (
    Id uniqueidentifier NOT NULL CONSTRAINT PK_RefreshTokens PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
    UserId uniqueidentifier NOT NULL,
    FamilyId uniqueidentifier NOT NULL,
    TokenHash char(64) NOT NULL,
    ExpiresAt datetime2(7) NOT NULL,
    ConsumedAt datetime2(7) NULL,
    RevokedAt datetime2(7) NULL,
    SessionId uniqueidentifier NOT NULL,
    Version int NOT NULL CONSTRAINT DF_RefreshTokens_Version DEFAULT 1,
    CreatedAt datetime2(7) NOT NULL CONSTRAINT DF_RefreshTokens_Created DEFAULT SYSUTCDATETIME(),
    UpdatedAt datetime2(7) NOT NULL CONSTRAINT DF_RefreshTokens_Updated DEFAULT SYSUTCDATETIME(),
    CreatedBy uniqueidentifier NULL,
    UpdatedBy uniqueidentifier NULL,
    DeletedAt datetime2(7) NULL,
    CONSTRAINT FK_RefreshTokens_User FOREIGN KEY (UserId) REFERENCES airfare.Users(Id)
        ON DELETE NO ACTION ON UPDATE CASCADE
);
CREATE UNIQUE INDEX UX_RefreshTokens_Hash ON airfare.RefreshTokens(TokenHash);
CREATE INDEX IX_RefreshTokens_Family ON airfare.RefreshTokens(FamilyId, ExpiresAt);
GO

CREATE TABLE airfare.PasswordHistory (
    Id uniqueidentifier NOT NULL CONSTRAINT PK_PasswordHistory PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
    UserId uniqueidentifier NOT NULL,
    PasswordHash nvarchar(255) NOT NULL,
    Version int NOT NULL CONSTRAINT DF_PasswordHistory_Version DEFAULT 1,
    CreatedAt datetime2(7) NOT NULL CONSTRAINT DF_PasswordHistory_Created DEFAULT SYSUTCDATETIME(),
    UpdatedAt datetime2(7) NOT NULL CONSTRAINT DF_PasswordHistory_Updated DEFAULT SYSUTCDATETIME(),
    CreatedBy uniqueidentifier NULL,
    UpdatedBy uniqueidentifier NULL,
    DeletedAt datetime2(7) NULL,
    CONSTRAINT FK_PasswordHistory_User FOREIGN KEY (UserId) REFERENCES airfare.Users(Id)
        ON DELETE NO ACTION ON UPDATE CASCADE
);
CREATE INDEX IX_PasswordHistory_User_Time ON airfare.PasswordHistory(UserId, CreatedAt DESC);
GO

CREATE TABLE airfare.Lookups (
    Id uniqueidentifier NOT NULL CONSTRAINT PK_Lookups PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
    LookupType varchar(30) NOT NULL,
    Code nvarchar(30) NOT NULL,
    Name nvarchar(200) NOT NULL,
    IsActive bit NOT NULL CONSTRAINT DF_Lookups_Active DEFAULT 1,
    Version int NOT NULL CONSTRAINT DF_Lookups_Version DEFAULT 1,
    CreatedAt datetime2(7) NOT NULL CONSTRAINT DF_Lookups_Created DEFAULT SYSUTCDATETIME(),
    UpdatedAt datetime2(7) NOT NULL CONSTRAINT DF_Lookups_Updated DEFAULT SYSUTCDATETIME(),
    CreatedBy uniqueidentifier NULL,
    UpdatedBy uniqueidentifier NULL,
    DeletedAt datetime2(7) NULL
);
CREATE UNIQUE INDEX UX_Lookups_Type_Code ON airfare.Lookups(LookupType, Code) WHERE DeletedAt IS NULL;
CREATE INDEX IX_Lookups_Search ON airfare.Lookups(LookupType, Name) INCLUDE (Code, IsActive);
GO

CREATE TABLE airfare.EntitlementRates (
    Id uniqueidentifier NOT NULL CONSTRAINT PK_EntitlementRates PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
    ScopeType varchar(20) NOT NULL,
    ScopeId nvarchar(100) NOT NULL CONSTRAINT DF_EntitlementRates_ScopeId DEFAULT N'',
    Amount decimal(19,4) NOT NULL,
    EffectiveFrom date NOT NULL,
    EffectiveTo date NULL,
    CapAmount decimal(19,4) NULL,
    Version int NOT NULL CONSTRAINT DF_EntitlementRates_Version DEFAULT 1,
    CreatedAt datetime2(7) NOT NULL CONSTRAINT DF_EntitlementRates_Created DEFAULT SYSUTCDATETIME(),
    UpdatedAt datetime2(7) NOT NULL CONSTRAINT DF_EntitlementRates_Updated DEFAULT SYSUTCDATETIME(),
    CreatedBy uniqueidentifier NULL,
    UpdatedBy uniqueidentifier NULL,
    DeletedAt datetime2(7) NULL,
    CONSTRAINT CK_EntitlementRates_Scope CHECK (ScopeType IN ('global','pay_group','employee')),
    CONSTRAINT CK_EntitlementRates_Dates CHECK (EffectiveTo IS NULL OR EffectiveTo >= EffectiveFrom),
    CONSTRAINT CK_EntitlementRates_Amounts CHECK (Amount >= 0 AND (CapAmount IS NULL OR CapAmount >= 0))
);
CREATE INDEX IX_EntitlementRates_Resolution
    ON airfare.EntitlementRates(ScopeType, ScopeId, EffectiveFrom DESC, EffectiveTo);
GO

CREATE TABLE airfare.EssRequests (
    Id uniqueidentifier NOT NULL CONSTRAINT PK_EssRequests PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
    EmployeeId uniqueidentifier NOT NULL,
    RequestType varchar(30) NOT NULL,
    TravelDate date NOT NULL,
    OriginCode char(3) NOT NULL,
    DestinationCode char(3) NOT NULL,
    Status varchar(20) NOT NULL CONSTRAINT DF_EssRequests_Status DEFAULT 'submitted',
    Notes nvarchar(max) NOT NULL CONSTRAINT DF_EssRequests_Notes DEFAULT N'',
    Version int NOT NULL CONSTRAINT DF_EssRequests_Version DEFAULT 1,
    CreatedAt datetime2(7) NOT NULL CONSTRAINT DF_EssRequests_Created DEFAULT SYSUTCDATETIME(),
    UpdatedAt datetime2(7) NOT NULL CONSTRAINT DF_EssRequests_Updated DEFAULT SYSUTCDATETIME(),
    CreatedBy uniqueidentifier NULL,
    UpdatedBy uniqueidentifier NULL,
    DeletedAt datetime2(7) NULL,
    CONSTRAINT FK_EssRequests_Employee FOREIGN KEY (EmployeeId) REFERENCES airfare.Employees(Id)
        ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT CK_EssRequests_Route CHECK (OriginCode <> DestinationCode),
    CONSTRAINT CK_EssRequests_Status CHECK (Status IN ('submitted','approved','rejected','paid'))
);
CREATE INDEX IX_EssRequests_Employee_Status_Date
    ON airfare.EssRequests(EmployeeId, Status, TravelDate DESC) WHERE DeletedAt IS NULL;
GO

CREATE OR ALTER TRIGGER airfare.TR_AuditLog_Immutable ON airfare.AuditLog
INSTEAD OF UPDATE, DELETE
AS
BEGIN
    THROW 51000, 'AuditLog is append-only.', 1;
END;
GO

-- Production partition strategy: partition AuditLog/temporal history monthly by
-- OccurredAt/ValidTo after measured history exceeds operational thresholds. Keep the
-- current and next boundary pre-created; switch expired partitions into an archive
-- table only under an approved retention policy. Do not partition small installations.
