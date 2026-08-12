/*
  ATLAS Port 3356 - Modules 02 through 11 MSSQL DDL
  Clean-room Python/FastAPI schema. Continuous entitlement only, no rollover jobs, no legacy UI dependencies.
*/

SET XACT_ABORT ON;
GO

IF SCHEMA_ID(N'core') IS NULL EXEC(N'CREATE SCHEMA core');
GO

IF OBJECT_ID(N'core.ImportBatches', N'U') IS NULL
BEGIN
    CREATE TABLE core.ImportBatches (
        ImportBatchID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_ImportBatches PRIMARY KEY,
        ModuleCode NVARCHAR(60) NOT NULL,
        FileName NVARCHAR(260) NOT NULL,
        TotalRows INT NOT NULL CONSTRAINT DF_core_ImportBatches_TotalRows DEFAULT 0,
        InsertedRows INT NOT NULL CONSTRAINT DF_core_ImportBatches_InsertedRows DEFAULT 0,
        FailedRows INT NOT NULL CONSTRAINT DF_core_ImportBatches_FailedRows DEFAULT 0,
        BatchStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_core_ImportBatches_Status DEFAULT N'Preview',
        CreatedBy NVARCHAR(120) NOT NULL CONSTRAINT DF_core_ImportBatches_CreatedBy DEFAULT N'system',
        CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_core_ImportBatches_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_core_ImportBatches_Status CHECK (BatchStatus IN (N'Preview', N'Processing', N'Completed', N'Failed', N'RolledBack'))
    );
END;
GO

IF OBJECT_ID(N'core.ImportRowErrors', N'U') IS NULL
BEGIN
    CREATE TABLE core.ImportRowErrors (
        ImportRowErrorID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_ImportRowErrors PRIMARY KEY,
        ImportBatchID BIGINT NOT NULL,
        RowNumber INT NOT NULL,
        FieldName NVARCHAR(120) NULL,
        ErrorMessage NVARCHAR(500) NOT NULL,
        RawRowJSON NVARCHAR(MAX) NULL,
        CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_core_ImportRowErrors_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_core_ImportRowErrors_Batch FOREIGN KEY (ImportBatchID) REFERENCES core.ImportBatches(ImportBatchID)
    );
END;
GO

IF OBJECT_ID(N'core.AirfareClaims', N'U') IS NULL
BEGIN
    CREATE TABLE core.AirfareClaims (
        ClaimID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AirfareClaims PRIMARY KEY,
        EmployeeID INT NOT NULL,
        ClaimDate DATE NOT NULL,
        SectorCode NVARCHAR(40) NOT NULL,
        ClaimType NVARCHAR(30) NOT NULL,
        ClaimAmount DECIMAL(18,3) NOT NULL,
        AccruedBalance DECIMAL(18,3) NOT NULL,
        ApprovalStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_core_AirfareClaims_ApprovalStatus DEFAULT N'Submitted',
        ApprovedAtUtc DATETIME2(0) NULL,
        Notes NVARCHAR(400) NULL,
        CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_core_AirfareClaims_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_core_AirfareClaims_Employee FOREIGN KEY (EmployeeID) REFERENCES core.Employees(EmployeeID),
        CONSTRAINT CK_core_AirfareClaims_Type CHECK (ClaimType IN (N'Ticket', N'CashEncashment', N'DependentTicket')),
        CONSTRAINT CK_core_AirfareClaims_Status CHECK (ApprovalStatus IN (N'Submitted', N'Approved', N'Rejected', N'Cancelled')),
        CONSTRAINT CK_core_AirfareClaims_Amounts CHECK (ClaimAmount >= 0 AND AccruedBalance >= 0 AND ClaimAmount <= AccruedBalance)
    );
END;
GO

IF OBJECT_ID(N'core.AirfareAllocationsV2', N'U') IS NULL
BEGIN
    CREATE TABLE core.AirfareAllocationsV2 (
        AllocationID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AirfareAllocationsV2 PRIMARY KEY,
        ClaimID BIGINT NULL,
        EmployeeID INT NOT NULL,
        AllocationDate DATE NOT NULL,
        OriginIATACode CHAR(3) NOT NULL,
        DestinationIATACode CHAR(3) NOT NULL,
        TicketNumber NVARCHAR(80) NULL,
        AirlineName NVARCHAR(160) NULL,
        TicketAmount DECIMAL(18,3) NOT NULL,
        EmployeePaidAmount DECIMAL(18,3) NOT NULL CONSTRAINT DF_core_AirfareAllocationsV2_EmployeePaid DEFAULT 0,
        CompanyPaidAmount DECIMAL(18,3) NOT NULL CONSTRAINT DF_core_AirfareAllocationsV2_CompanyPaid DEFAULT 0,
        AllocationStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_core_AirfareAllocationsV2_Status DEFAULT N'Posted',
        CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_core_AirfareAllocationsV2_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_core_AirfareAllocationsV2_Claim FOREIGN KEY (ClaimID) REFERENCES core.AirfareClaims(ClaimID),
        CONSTRAINT FK_core_AirfareAllocationsV2_Employee FOREIGN KEY (EmployeeID) REFERENCES core.Employees(EmployeeID),
        CONSTRAINT CK_core_AirfareAllocationsV2_Amounts CHECK (TicketAmount >= 0 AND EmployeePaidAmount >= 0 AND CompanyPaidAmount >= 0),
        CONSTRAINT CK_core_AirfareAllocationsV2_Status CHECK (AllocationStatus IN (N'Draft', N'Posted', N'Cancelled'))
    );
END;
GO

IF OBJECT_ID(N'core.Loans', N'U') IS NULL
BEGIN
    CREATE TABLE core.Loans (
        LoanID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_Loans PRIMARY KEY,
        EmployeeID INT NOT NULL,
        PrincipalAmount DECIMAL(18,3) NOT NULL,
        TermsMonths INT NOT NULL,
        AnnualInterestRate DECIMAL(9,3) NOT NULL CONSTRAINT DF_core_Loans_Interest DEFAULT 0,
        MonthlyInstallment DECIMAL(18,3) NOT NULL,
        OutstandingAmount DECIMAL(18,3) NOT NULL,
        DisbursementDate DATE NOT NULL,
        LoanStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_core_Loans_Status DEFAULT N'Active',
        Notes NVARCHAR(400) NULL,
        CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_core_Loans_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_core_Loans_Employee FOREIGN KEY (EmployeeID) REFERENCES core.Employees(EmployeeID),
        CONSTRAINT CK_core_Loans_Amounts CHECK (PrincipalAmount > 0 AND TermsMonths > 0 AND AnnualInterestRate >= 0 AND MonthlyInstallment >= 0 AND OutstandingAmount >= 0),
        CONSTRAINT CK_core_Loans_Status CHECK (LoanStatus IN (N'Pending', N'Active', N'Settled', N'TopUp', N'Cancelled'))
    );
END;
GO

IF OBJECT_ID(N'core.LoanSchedules', N'U') IS NULL
BEGIN
    CREATE TABLE core.LoanSchedules (
        LoanScheduleID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_LoanSchedules PRIMARY KEY,
        LoanID BIGINT NOT NULL,
        InstallmentNo INT NOT NULL,
        DueDate DATE NOT NULL,
        PrincipalComponent DECIMAL(18,3) NOT NULL,
        InterestComponent DECIMAL(18,3) NOT NULL CONSTRAINT DF_core_LoanSchedules_Interest DEFAULT 0,
        InstallmentAmount DECIMAL(18,3) NOT NULL,
        PaymentStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_core_LoanSchedules_Status DEFAULT N'Pending',
        PaidAtUtc DATETIME2(0) NULL,
        CONSTRAINT FK_core_LoanSchedules_Loan FOREIGN KEY (LoanID) REFERENCES core.Loans(LoanID),
        CONSTRAINT UQ_core_LoanSchedules_LoanInstallment UNIQUE (LoanID, InstallmentNo),
        CONSTRAINT CK_core_LoanSchedules_Status CHECK (PaymentStatus IN (N'Pending', N'Deducted', N'Skipped', N'Settled'))
    );
END;
GO

IF OBJECT_ID(N'core.SeedEvidence', N'U') IS NULL
BEGIN
    CREATE TABLE core.SeedEvidence (
        SeedID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_SeedEvidence PRIMARY KEY,
        EmployeeID INT NOT NULL,
        SeedType NVARCHAR(40) NOT NULL,
        EffectiveDate DATE NOT NULL,
        Amount DECIMAL(18,3) NOT NULL,
        SourceReference NVARCHAR(120) NOT NULL,
        VerificationChecksum NVARCHAR(64) NOT NULL,
        ApprovalStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_core_SeedEvidence_Status DEFAULT N'Pending',
        ApprovedBy NVARCHAR(120) NULL,
        ApprovedAtUtc DATETIME2(0) NULL CONSTRAINT DF_core_SeedEvidence_ApprovedAt DEFAULT SYSUTCDATETIME(),
        CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_core_SeedEvidence_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_core_SeedEvidence_Employee FOREIGN KEY (EmployeeID) REFERENCES core.Employees(EmployeeID),
        CONSTRAINT CK_core_SeedEvidence_Type CHECK (SeedType IN (N'LeaveBalance', N'GratuityAccrual', N'SalaryAdjustment', N'AirfareEntitlement')),
        CONSTRAINT CK_core_SeedEvidence_Status CHECK (ApprovalStatus IN (N'Pending', N'Approved', N'Rejected', N'Reversed'))
    );
END;
GO

IF OBJECT_ID(N'core.ReportRuns', N'U') IS NULL
BEGIN
    CREATE TABLE core.ReportRuns (
        ReportRunID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_ReportRuns PRIMARY KEY,
        ReportCode NVARCHAR(60) NOT NULL,
        DateFrom DATE NULL,
        DateTo DATE NULL,
        DepartmentID INT NULL,
        EmployeeID INT NULL,
        ExportFormat NVARCHAR(10) NOT NULL CONSTRAINT DF_core_ReportRuns_Format DEFAULT N'json',
        RunStatus NVARCHAR(30) NOT NULL,
        CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_core_ReportRuns_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_core_ReportRuns_Code CHECK (ReportCode IN (N'PayrollSummary', N'DepartmentCosting', N'DocumentExpiry', N'LoanBalances', N'AirfareUtilization')),
        CONSTRAINT CK_core_ReportRuns_Format CHECK (ExportFormat IN (N'json', N'xlsx', N'pdf')),
        CONSTRAINT CK_core_ReportRuns_Status CHECK (RunStatus IN (N'Queued', N'Completed', N'Failed'))
    );
END;
GO

IF OBJECT_ID(N'core.SystemSettings', N'U') IS NULL
BEGIN
    CREATE TABLE core.SystemSettings (
        SettingID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_SystemSettings PRIMARY KEY,
        SettingKey NVARCHAR(120) NOT NULL CONSTRAINT UQ_core_SystemSettings_Key UNIQUE,
        SettingValue NVARCHAR(4000) NOT NULL,
        ValueType NVARCHAR(20) NOT NULL,
        IsSecret BIT NOT NULL CONSTRAINT DF_core_SystemSettings_IsSecret DEFAULT 0,
        UpdatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_core_SystemSettings_UpdatedAtUtc DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_core_SystemSettings_ValueType CHECK (ValueType IN (N'string', N'number', N'boolean', N'json', N'secret'))
    );
END;
GO

IF OBJECT_ID(N'core.UserRoles', N'U') IS NULL
BEGIN
    CREATE TABLE core.UserRoles (
        UserRoleID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_UserRoles PRIMARY KEY,
        Username NVARCHAR(120) NOT NULL,
        RoleCode NVARCHAR(30) NOT NULL,
        IsActive BIT NOT NULL CONSTRAINT DF_core_UserRoles_IsActive DEFAULT 1,
        CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_core_UserRoles_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_core_UserRoles_UserRole UNIQUE (Username, RoleCode),
        CONSTRAINT CK_core_UserRoles_Role CHECK (RoleCode IN (N'Admin', N'HR', N'Payroll', N'Viewer'))
    );
END;
GO

IF OBJECT_ID(N'core.SelfServiceRequestsV2', N'U') IS NULL
BEGIN
    CREATE TABLE core.SelfServiceRequestsV2 (
        RequestID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_SelfServiceRequestsV2 PRIMARY KEY,
        EmployeeID INT NOT NULL,
        RequestType NVARCHAR(40) NOT NULL,
        RequestedAtUtc DATETIME2(0) NOT NULL,
        RequestPayloadJSON NVARCHAR(MAX) NOT NULL,
        RequestStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_core_SelfServiceRequestsV2_Status DEFAULT N'Submitted',
        CONSTRAINT FK_core_SelfServiceRequestsV2_Employee FOREIGN KEY (EmployeeID) REFERENCES core.Employees(EmployeeID),
        CONSTRAINT CK_core_SelfServiceRequestsV2_Type CHECK (RequestType IN (N'PayslipView', N'LoanRequest', N'AirfareRequest', N'LeaveStatus', N'DocumentStatus', N'ProfileUpdate')),
        CONSTRAINT CK_core_SelfServiceRequestsV2_Status CHECK (RequestStatus IN (N'Submitted', N'Approved', N'Rejected', N'Cancelled', N'Completed')),
        CONSTRAINT CK_core_SelfServiceRequestsV2_JSON CHECK (ISJSON(RequestPayloadJSON) = 1)
    );
END;
GO

IF OBJECT_ID(N'core.DocumentMetadata', N'U') IS NULL
BEGIN
    CREATE TABLE core.DocumentMetadata (
        DocumentID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_DocumentMetadata PRIMARY KEY,
        EmployeeID INT NULL,
        DocumentType NVARCHAR(60) NOT NULL,
        FileName NVARCHAR(260) NOT NULL,
        StorageProvider NVARCHAR(20) NOT NULL,
        StoragePath NVARCHAR(600) NOT NULL,
        MimeType NVARCHAR(120) NOT NULL,
        FileSizeBytes BIGINT NOT NULL,
        VerificationStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_core_DocumentMetadata_Status DEFAULT N'Pending',
        CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_core_DocumentMetadata_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_core_DocumentMetadata_Employee FOREIGN KEY (EmployeeID) REFERENCES core.Employees(EmployeeID),
        CONSTRAINT CK_core_DocumentMetadata_Type CHECK (DocumentType IN (N'CivilID', N'Passport', N'Contract', N'LoanAgreement', N'AirfareEvidence', N'Other')),
        CONSTRAINT CK_core_DocumentMetadata_Storage CHECK (StorageProvider IN (N'local', N's3')),
        CONSTRAINT CK_core_DocumentMetadata_Size CHECK (FileSizeBytes >= 0 AND FileSizeBytes <= 52428800)
    );
END;
GO

IF OBJECT_ID(N'core.Airports', N'U') IS NULL
BEGIN
    CREATE TABLE core.Airports (
        AirportID INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_Airports PRIMARY KEY,
        IATACode CHAR(3) NOT NULL CONSTRAINT UQ_core_Airports_IATA UNIQUE,
        AirportName NVARCHAR(200) NOT NULL,
        CityName NVARCHAR(120) NOT NULL,
        CountryCode CHAR(2) NOT NULL,
        SectorCode NVARCHAR(40) NULL,
        IsActive BIT NOT NULL CONSTRAINT DF_core_Airports_IsActive DEFAULT 1
    );
END;
GO

IF OBJECT_ID(N'core.AuditLogs', N'U') IS NULL
BEGIN
    CREATE TABLE core.AuditLogs (
        AuditLogID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AuditLogs PRIMARY KEY,
        Username NVARCHAR(120) NOT NULL,
        ActionCode NVARCHAR(80) NOT NULL,
        TableName NVARCHAR(160) NULL,
        EntityID NVARCHAR(120) NULL,
        OldValueJSON NVARCHAR(MAX) NULL,
        NewValueJSON NVARCHAR(MAX) NULL,
        IpAddress NVARCHAR(64) NULL,
        CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_core_AuditLogs_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_core_AuditLogs_OldJSON CHECK (OldValueJSON IS NULL OR ISJSON(OldValueJSON) = 1),
        CONSTRAINT CK_core_AuditLogs_NewJSON CHECK (NewValueJSON IS NULL OR ISJSON(NewValueJSON) = 1)
    );
END;
GO

IF OBJECT_ID(N'core.BackupJobs', N'U') IS NULL
BEGIN
    CREATE TABLE core.BackupJobs (
        BackupJobID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_BackupJobs PRIMARY KEY,
        JobType NVARCHAR(40) NOT NULL,
        JobStatus NVARCHAR(30) NOT NULL,
        RequestedAtUtc DATETIME2(0) NOT NULL,
        StartedAtUtc DATETIME2(0) NULL,
        CompletedAtUtc DATETIME2(0) NULL,
        BackupPath NVARCHAR(600) NULL,
        ErrorMessage NVARCHAR(1000) NULL,
        CONSTRAINT CK_core_BackupJobs_Type CHECK (JobType IN (N'DatabaseBackup', N'RestoreValidation')),
        CONSTRAINT CK_core_BackupJobs_Status CHECK (JobStatus IN (N'Queued', N'Running', N'Completed', N'Failed'))
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_core_ImportRowErrors_Batch' AND object_id = OBJECT_ID(N'core.ImportRowErrors'))
    CREATE INDEX IX_core_ImportRowErrors_Batch ON core.ImportRowErrors(ImportBatchID, RowNumber);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_core_AirfareClaims_EmployeeStatus' AND object_id = OBJECT_ID(N'core.AirfareClaims'))
    CREATE INDEX IX_core_AirfareClaims_EmployeeStatus ON core.AirfareClaims(EmployeeID, ApprovalStatus, ClaimDate DESC);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_core_Loans_EmployeeStatus' AND object_id = OBJECT_ID(N'core.Loans'))
    CREATE INDEX IX_core_Loans_EmployeeStatus ON core.Loans(EmployeeID, LoanStatus);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_core_SeedEvidence_EmployeeType' AND object_id = OBJECT_ID(N'core.SeedEvidence'))
    CREATE INDEX IX_core_SeedEvidence_EmployeeType ON core.SeedEvidence(EmployeeID, SeedType, EffectiveDate DESC);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_core_Airports_Search' AND object_id = OBJECT_ID(N'core.Airports'))
    CREATE INDEX IX_core_Airports_Search ON core.Airports(IATACode, CityName) INCLUDE (AirportName, CountryCode, SectorCode);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_core_AuditLogs_Created' AND object_id = OBJECT_ID(N'core.AuditLogs'))
    CREATE INDEX IX_core_AuditLogs_Created ON core.AuditLogs(CreatedAtUtc DESC, Username, ActionCode);
GO
