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
    CONSTRAINT CK_Tickets_Status CHECK (Status IN ('draft','submitted','approved','rejected','paid'))
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
      (ScopeType IN ('default','company','branch','department','user')),
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
    CONSTRAINT CK_AuditLog_BeforeJson CHECK (BeforeJson IS NULL OR ISJSON(BeforeJson) = 1),
    CONSTRAINT CK_AuditLog_AfterJson CHECK (AfterJson IS NULL OR ISJSON(AfterJson) = 1)
);
CREATE INDEX IX_AuditLog_Entity_Time ON airfare.AuditLog(EntityType, EntityId, OccurredAt DESC);
CREATE INDEX IX_AuditLog_Correlation ON airfare.AuditLog(CorrelationId) WHERE CorrelationId IS NOT NULL;
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
