SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.ext_emp_auth_mapping', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ext_emp_auth_mapping (
        MappingID INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ext_emp_auth_mapping PRIMARY KEY,
        UserID INT NOT NULL,
        EmployeeID INT NOT NULL,
        PortalRole NVARCHAR(20) NOT NULL CONSTRAINT DF_ext_emp_auth_mapping_PortalRole DEFAULT N'Employee',
        IsActive BIT NOT NULL CONSTRAINT DF_ext_emp_auth_mapping_IsActive DEFAULT 1,
        LastPortalLoginAt DATETIME2(0) NULL,
        CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_ext_emp_auth_mapping_CreatedAt DEFAULT SYSUTCDATETIME(),
        CreatedBy INT NULL,
        UpdatedAt DATETIME2(0) NULL,
        UpdatedBy INT NULL,
        RowVer ROWVERSION NOT NULL,
        CONSTRAINT FK_ext_emp_auth_mapping_Users FOREIGN KEY (UserID) REFERENCES dbo.Users(UserID),
        CONSTRAINT FK_ext_emp_auth_mapping_Employees FOREIGN KEY (EmployeeID) REFERENCES dbo.Employees(EmployeeID),
        CONSTRAINT FK_ext_emp_auth_mapping_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users(UserID),
        CONSTRAINT FK_ext_emp_auth_mapping_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.Users(UserID),
        CONSTRAINT CK_ext_emp_auth_mapping_Role CHECK (PortalRole IN (N'Employee', N'Admin')),
        CONSTRAINT UQ_ext_emp_auth_mapping_UserEmployee UNIQUE (UserID, EmployeeID)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.ext_emp_auth_mapping') AND name = N'UX_ext_emp_auth_mapping_User_Active')
    CREATE UNIQUE INDEX UX_ext_emp_auth_mapping_User_Active ON dbo.ext_emp_auth_mapping(UserID) WHERE IsActive = 1;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.ext_emp_auth_mapping') AND name = N'IX_ext_emp_auth_mapping_Employee_Active')
    CREATE INDEX IX_ext_emp_auth_mapping_Employee_Active ON dbo.ext_emp_auth_mapping(EmployeeID, IsActive) INCLUDE (UserID, PortalRole);
GO

IF OBJECT_ID(N'dbo.ext_emp_ticket_requests', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ext_emp_ticket_requests (
        RequestID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ext_emp_ticket_requests PRIMARY KEY,
        RequestNo AS (CONVERT(NVARCHAR(30), N'ETR-' + RIGHT(REPLICATE(N'0', 10) + CONVERT(NVARCHAR(20), RequestID), 10))) PERSISTED,
        EmployeeID INT NOT NULL,
        CreatedByUserID INT NOT NULL,
        TravelFromDate DATE NOT NULL,
        TravelToDate DATE NULL,
        Origin NVARCHAR(80) NULL,
        Destination NVARCHAR(120) NOT NULL,
        TripType NVARCHAR(20) NOT NULL CONSTRAINT DF_ext_emp_ticket_requests_TripType DEFAULT N'RoundTrip',
        CabinClass NVARCHAR(20) NOT NULL CONSTRAINT DF_ext_emp_ticket_requests_CabinClass DEFAULT N'Economy',
        EstimatedCostBHD DECIMAL(12,2) NOT NULL,
        PreferredAirline NVARCHAR(80) NULL,
        Purpose NVARCHAR(250) NULL,
        ApprovalStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_ext_emp_ticket_requests_Status DEFAULT N'Draft',
        CurrentApproverUserID INT NULL,
        SubmittedAt DATETIME2(0) NULL,
        ReviewedAt DATETIME2(0) NULL,
        ApprovedAt DATETIME2(0) NULL,
        RejectedAt DATETIME2(0) NULL,
        RejectionReason NVARCHAR(500) NULL,
        LinkedAllocationID BIGINT NULL,
        CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_ext_emp_ticket_requests_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2(0) NULL,
        RowVer ROWVERSION NOT NULL,
        CONSTRAINT UQ_ext_emp_ticket_requests_RequestNo UNIQUE (RequestNo),
        CONSTRAINT FK_ext_emp_ticket_requests_Employees FOREIGN KEY (EmployeeID) REFERENCES dbo.Employees(EmployeeID),
        CONSTRAINT FK_ext_emp_ticket_requests_CreatedBy FOREIGN KEY (CreatedByUserID) REFERENCES dbo.Users(UserID),
        CONSTRAINT FK_ext_emp_ticket_requests_Approver FOREIGN KEY (CurrentApproverUserID) REFERENCES dbo.Users(UserID),
        CONSTRAINT FK_ext_emp_ticket_requests_Allocation FOREIGN KEY (LinkedAllocationID) REFERENCES dbo.Allocations(AllocationID),
        CONSTRAINT CK_ext_emp_ticket_requests_TripType CHECK (TripType IN (N'OneWay', N'RoundTrip', N'MultiCity')),
        CONSTRAINT CK_ext_emp_ticket_requests_CabinClass CHECK (CabinClass IN (N'Economy', N'PremiumEconomy', N'Business', N'First')),
        CONSTRAINT CK_ext_emp_ticket_requests_Status CHECK (ApprovalStatus IN (N'Draft', N'Submitted', N'ManagerApproved', N'HRApproved', N'FinanceApproved', N'Rejected', N'Cancelled', N'Issued')),
        CONSTRAINT CK_ext_emp_ticket_requests_Dates CHECK (TravelToDate IS NULL OR TravelToDate >= TravelFromDate),
        CONSTRAINT CK_ext_emp_ticket_requests_Cost CHECK (EstimatedCostBHD >= 0)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.ext_emp_ticket_requests') AND name = N'IX_ext_emp_ticket_requests_Employee_Status_Date')
    CREATE INDEX IX_ext_emp_ticket_requests_Employee_Status_Date ON dbo.ext_emp_ticket_requests(EmployeeID, ApprovalStatus, TravelFromDate DESC) INCLUDE (Destination, EstimatedCostBHD, RequestNo);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.ext_emp_ticket_requests') AND name = N'IX_ext_emp_ticket_requests_Status_Approver')
    CREATE INDEX IX_ext_emp_ticket_requests_Status_Approver ON dbo.ext_emp_ticket_requests(ApprovalStatus, CurrentApproverUserID, SubmittedAt) INCLUDE (EmployeeID, EstimatedCostBHD);
GO

IF OBJECT_ID(N'dbo.ext_emp_ticket_request_audit', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ext_emp_ticket_request_audit (
        AuditID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ext_emp_ticket_request_audit PRIMARY KEY,
        RequestID BIGINT NOT NULL,
        ActorUserID INT NOT NULL,
        FromStatus NVARCHAR(30) NULL,
        ToStatus NVARCHAR(30) NOT NULL,
        ActionNote NVARCHAR(500) NULL,
        CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_ext_emp_ticket_request_audit_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_ext_emp_ticket_request_audit_Request FOREIGN KEY (RequestID) REFERENCES dbo.ext_emp_ticket_requests(RequestID),
        CONSTRAINT FK_ext_emp_ticket_request_audit_User FOREIGN KEY (ActorUserID) REFERENCES dbo.Users(UserID)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.ext_emp_ticket_request_audit') AND name = N'IX_ext_emp_ticket_request_audit_Request')
    CREATE INDEX IX_ext_emp_ticket_request_audit_Request ON dbo.ext_emp_ticket_request_audit(RequestID, CreatedAt DESC);
GO

IF OBJECT_ID(N'dbo.ext_emp_document_templates', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ext_emp_document_templates (
        TemplateID INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ext_emp_document_templates PRIMARY KEY,
        TemplateCode NVARCHAR(40) NOT NULL,
        TemplateName NVARCHAR(120) NOT NULL,
        DocumentType NVARCHAR(30) NOT NULL,
        EnglishHtml NVARCHAR(MAX) NOT NULL,
        ArabicHtml NVARCHAR(MAX) NULL,
        IsActive BIT NOT NULL CONSTRAINT DF_ext_emp_document_templates_IsActive DEFAULT 1,
        CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_ext_emp_document_templates_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2(0) NULL,
        CONSTRAINT UQ_ext_emp_document_templates_Code UNIQUE (TemplateCode),
        CONSTRAINT CK_ext_emp_document_templates_Type CHECK (DocumentType IN (N'OfferLetter', N'Contract'))
    );
END;
GO

IF OBJECT_ID(N'dbo.ext_emp_document_instances', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ext_emp_document_instances (
        DocumentID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ext_emp_document_instances PRIMARY KEY,
        TemplateID INT NOT NULL,
        EmployeeID INT NOT NULL,
        DocumentStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_ext_emp_document_instances_Status DEFAULT N'Draft',
        EnglishHtml NVARCHAR(MAX) NOT NULL,
        ArabicHtml NVARCHAR(MAX) NULL,
        IssuedAt DATETIME2(0) NULL,
        SignedAt DATETIME2(0) NULL,
        CreatedByUserID INT NOT NULL,
        CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_ext_emp_document_instances_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2(0) NULL,
        CONSTRAINT FK_ext_emp_document_instances_Template FOREIGN KEY (TemplateID) REFERENCES dbo.ext_emp_document_templates(TemplateID),
        CONSTRAINT FK_ext_emp_document_instances_Employee FOREIGN KEY (EmployeeID) REFERENCES dbo.Employees(EmployeeID),
        CONSTRAINT FK_ext_emp_document_instances_User FOREIGN KEY (CreatedByUserID) REFERENCES dbo.Users(UserID),
        CONSTRAINT CK_ext_emp_document_instances_Status CHECK (DocumentStatus IN (N'Draft', N'Issued', N'Signed', N'Cancelled'))
    );
END;
GO

CREATE OR ALTER VIEW dbo.v_ext_emp_current_user_ticket_requests
AS
    SELECT
        r.RequestID,
        r.RequestNo,
        r.EmployeeID,
        e.EmployeeCode,
        e.FullName,
        r.TravelFromDate,
        r.TravelToDate,
        r.Origin,
        r.Destination,
        r.TripType,
        r.CabinClass,
        r.EstimatedCostBHD,
        r.PreferredAirline,
        r.Purpose,
        r.ApprovalStatus,
        r.SubmittedAt,
        r.CreatedAt,
        r.UpdatedAt
    FROM dbo.ext_emp_ticket_requests r
    INNER JOIN dbo.Employees e ON e.EmployeeID = r.EmployeeID
    INNER JOIN dbo.Users u ON u.Username IN (CURRENT_USER, SUSER_SNAME())
    INNER JOIN dbo.ext_emp_auth_mapping m
        ON m.UserID = u.UserID
       AND m.IsActive = 1
       AND (m.PortalRole = N'Admin' OR m.EmployeeID = r.EmployeeID);
GO

CREATE OR ALTER PROCEDURE dbo.sp_ext_emp_upsert_auth_mapping
    @UserID INT,
    @EmployeeID INT,
    @PortalRole NVARCHAR(20),
    @ActorUserID INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @PortalRole NOT IN (N'Employee', N'Admin') THROW 62001, 'Invalid portal role.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE UserID = @UserID AND IsActive = 1) THROW 62002, 'Active user was not found.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.Employees WHERE EmployeeID = @EmployeeID) THROW 62003, 'Employee was not found.', 1;

    BEGIN TRANSACTION;
        MERGE dbo.ext_emp_auth_mapping AS target
        USING (SELECT @UserID AS UserID, @EmployeeID AS EmployeeID) AS source
            ON target.UserID = source.UserID AND target.EmployeeID = source.EmployeeID
        WHEN MATCHED THEN
            UPDATE SET PortalRole = @PortalRole, IsActive = 1, UpdatedAt = SYSUTCDATETIME(), UpdatedBy = @ActorUserID
        WHEN NOT MATCHED THEN
            INSERT (UserID, EmployeeID, PortalRole, CreatedBy)
            VALUES (@UserID, @EmployeeID, @PortalRole, @ActorUserID);
    COMMIT TRANSACTION;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_ext_emp_create_ticket_request
    @ActorUserID INT,
    @EmployeeID INT = NULL,
    @TravelFromDate DATE,
    @TravelToDate DATE = NULL,
    @Origin NVARCHAR(80) = NULL,
    @Destination NVARCHAR(120),
    @TripType NVARCHAR(20) = N'RoundTrip',
    @CabinClass NVARCHAR(20) = N'Economy',
    @EstimatedCostBHD DECIMAL(12,2),
    @PreferredAirline NVARCHAR(80) = NULL,
    @Purpose NVARCHAR(250) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @resolvedEmployeeID INT;
    SELECT TOP 1 @resolvedEmployeeID = COALESCE(@EmployeeID, EmployeeID)
    FROM dbo.ext_emp_auth_mapping
    WHERE UserID = @ActorUserID AND IsActive = 1
      AND (PortalRole = N'Admin' OR @EmployeeID IS NULL OR EmployeeID = @EmployeeID)
    ORDER BY CASE WHEN PortalRole = N'Admin' THEN 0 ELSE 1 END;

    IF @resolvedEmployeeID IS NULL THROW 62101, 'No active employee portal mapping was found for this user.', 1;
    IF @Destination IS NULL OR LTRIM(RTRIM(@Destination)) = N'' THROW 62102, 'Destination is required.', 1;
    IF @EstimatedCostBHD < 0 THROW 62103, 'Estimated cost cannot be negative.', 1;
    IF @TravelToDate IS NOT NULL AND @TravelToDate < @TravelFromDate THROW 62104, 'Return date cannot be before travel date.', 1;

    BEGIN TRANSACTION;
        INSERT INTO dbo.ext_emp_ticket_requests (
            EmployeeID, CreatedByUserID, TravelFromDate, TravelToDate, Origin, Destination,
            TripType, CabinClass, EstimatedCostBHD, PreferredAirline, Purpose
        )
        VALUES (
            @resolvedEmployeeID, @ActorUserID, @TravelFromDate, @TravelToDate, NULLIF(LTRIM(RTRIM(@Origin)), N''),
            LTRIM(RTRIM(@Destination)), @TripType, @CabinClass, @EstimatedCostBHD, NULLIF(LTRIM(RTRIM(@PreferredAirline)), N''), @Purpose
        );

        DECLARE @requestID BIGINT = SCOPE_IDENTITY();
        INSERT INTO dbo.ext_emp_ticket_request_audit (RequestID, ActorUserID, FromStatus, ToStatus, ActionNote)
        VALUES (@requestID, @ActorUserID, NULL, N'Draft', N'Employee portal request created.');

        SELECT * FROM dbo.ext_emp_ticket_requests WHERE RequestID = @requestID;
    COMMIT TRANSACTION;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_ext_emp_transition_ticket_request
    @ActorUserID INT,
    @RequestID BIGINT,
    @ToStatus NVARCHAR(30),
    @ActionNote NVARCHAR(500) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @ToStatus NOT IN (N'Submitted', N'ManagerApproved', N'HRApproved', N'FinanceApproved', N'Rejected', N'Cancelled', N'Issued')
        THROW 62201, 'Invalid request status transition.', 1;

    BEGIN TRANSACTION;
        DECLARE @fromStatus NVARCHAR(30), @employeeID INT, @portalRole NVARCHAR(20);
        SELECT @fromStatus = ApprovalStatus, @employeeID = EmployeeID
        FROM dbo.ext_emp_ticket_requests WITH (UPDLOCK, HOLDLOCK)
        WHERE RequestID = @RequestID;

        IF @fromStatus IS NULL THROW 62202, 'Ticket request was not found.', 1;

        SELECT TOP 1 @portalRole = PortalRole
        FROM dbo.ext_emp_auth_mapping
        WHERE UserID = @ActorUserID AND IsActive = 1 AND (EmployeeID = @employeeID OR PortalRole = N'Admin')
        ORDER BY CASE WHEN PortalRole = N'Admin' THEN 0 ELSE 1 END;

        IF @portalRole IS NULL THROW 62203, 'User is not authorized for this ticket request.', 1;
        IF @portalRole = N'Employee' AND @ToStatus NOT IN (N'Submitted', N'Cancelled') THROW 62204, 'Employee users can only submit or cancel their own draft requests.', 1;

        UPDATE dbo.ext_emp_ticket_requests
        SET ApprovalStatus = @ToStatus,
            SubmittedAt = CASE WHEN @ToStatus = N'Submitted' AND SubmittedAt IS NULL THEN SYSUTCDATETIME() ELSE SubmittedAt END,
            ReviewedAt = CASE WHEN @ToStatus IN (N'ManagerApproved', N'HRApproved', N'FinanceApproved', N'Rejected') THEN SYSUTCDATETIME() ELSE ReviewedAt END,
            ApprovedAt = CASE WHEN @ToStatus IN (N'FinanceApproved', N'Issued') THEN SYSUTCDATETIME() ELSE ApprovedAt END,
            RejectedAt = CASE WHEN @ToStatus = N'Rejected' THEN SYSUTCDATETIME() ELSE RejectedAt END,
            RejectionReason = CASE WHEN @ToStatus = N'Rejected' THEN @ActionNote ELSE RejectionReason END,
            UpdatedAt = SYSUTCDATETIME()
        WHERE RequestID = @RequestID;

        INSERT INTO dbo.ext_emp_ticket_request_audit (RequestID, ActorUserID, FromStatus, ToStatus, ActionNote)
        VALUES (@RequestID, @ActorUserID, @fromStatus, @ToStatus, @ActionNote);

        SELECT * FROM dbo.ext_emp_ticket_requests WHERE RequestID = @RequestID;
    COMMIT TRANSACTION;
END;
GO
