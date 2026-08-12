/*
  ATLAS Port 3356 - Module 1 Employee Master
  Clean-room MSSQL schema for Python/FastAPI rebuild.
  Explicitly excludes Year-End Process, Year-End Closing, and yearly balance rollover logic.
*/

SET XACT_ABORT ON;
GO

IF SCHEMA_ID(N'core') IS NULL EXEC(N'CREATE SCHEMA core');
GO

IF OBJECT_ID(N'core.Departments', N'U') IS NULL
BEGIN
    CREATE TABLE core.Departments (
        DepartmentID INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_Departments PRIMARY KEY,
        DepartmentCode NVARCHAR(40) NOT NULL CONSTRAINT UQ_core_Departments_Code UNIQUE,
        DepartmentName NVARCHAR(160) NOT NULL,
        IsActive BIT NOT NULL CONSTRAINT DF_core_Departments_IsActive DEFAULT (1),
        CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_core_Departments_CreatedAtUtc DEFAULT SYSUTCDATETIME()
    );
END;
GO

IF OBJECT_ID(N'core.Branches', N'U') IS NULL
BEGIN
    CREATE TABLE core.Branches (
        BranchID INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_Branches PRIMARY KEY,
        BranchCode NVARCHAR(40) NOT NULL CONSTRAINT UQ_core_Branches_Code UNIQUE,
        BranchName NVARCHAR(160) NOT NULL,
        IsActive BIT NOT NULL CONSTRAINT DF_core_Branches_IsActive DEFAULT (1),
        CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_core_Branches_CreatedAtUtc DEFAULT SYSUTCDATETIME()
    );
END;
GO

IF OBJECT_ID(N'core.Employees', N'U') IS NULL
BEGIN
    CREATE TABLE core.Employees (
        EmployeeID INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_Employees PRIMARY KEY,
        EmployeeCode NVARCHAR(50) NOT NULL,
        PunchMachineID NVARCHAR(50) NULL,

        FullName NVARCHAR(200) NOT NULL,
        FirstName NVARCHAR(80) NOT NULL,
        MiddleName NVARCHAR(80) NULL,
        LastName NVARCHAR(80) NOT NULL,
        PassportName NVARCHAR(200) NULL,
        Gender NVARCHAR(20) NOT NULL,
        DateOfBirth DATE NOT NULL,
        Nationality NVARCHAR(80) NOT NULL,
        Religion NVARCHAR(80) NULL,
        MaritalStatus NVARCHAR(30) NULL,

        JoiningDate DATE NOT NULL,
        ProbationEndDate DATE NULL,
        ConfirmationDate DATE NULL,
        DepartmentID INT NULL,
        Designation NVARCHAR(120) NOT NULL,
        GradeLevel NVARCHAR(60) NULL,
        BranchID INT NULL,
        EmploymentType NVARCHAR(30) NOT NULL,
        Status NVARCHAR(30) NOT NULL CONSTRAINT DF_core_Employees_Status DEFAULT (N'Active'),
        DirectManagerID INT NULL,

        PersonalEmail NVARCHAR(254) NULL,
        WorkEmail NVARCHAR(254) NULL,
        MobileNumber NVARCHAR(40) NULL,
        EmergencyContactName NVARCHAR(160) NULL,
        EmergencyContactPhone NVARCHAR(40) NULL,
        EmergencyContactRelationship NVARCHAR(80) NULL,
        LocalAddress NVARCHAR(500) NULL,
        HomeCountryAddress NVARCHAR(500) NULL,

        PassportNumber NVARCHAR(80) NULL,
        PassportExpiry DATE NULL,
        CivilID NVARCHAR(80) NULL,
        CivilIDExpiry DATE NULL,
        VisaNumber NVARCHAR(80) NULL,
        VisaType NVARCHAR(80) NULL,
        VisaExpiry DATE NULL,
        LabourCardNumber NVARCHAR(80) NULL,
        LabourCardExpiry DATE NULL,

        BasicSalary DECIMAL(18,3) NOT NULL CONSTRAINT DF_core_Employees_BasicSalary DEFAULT (0),
        HousingAllowance DECIMAL(18,3) NOT NULL CONSTRAINT DF_core_Employees_HousingAllowance DEFAULT (0),
        TransportAllowance DECIMAL(18,3) NOT NULL CONSTRAINT DF_core_Employees_TransportAllowance DEFAULT (0),
        OtherFixedAllowances DECIMAL(18,3) NOT NULL CONSTRAINT DF_core_Employees_OtherFixedAllowances DEFAULT (0),
        PaymentMode NVARCHAR(20) NOT NULL,
        BankName NVARCHAR(160) NULL,
        IBANAccountNumber NVARCHAR(80) NULL,
        SwiftCode NVARCHAR(40) NULL,

        ResignationDate DATE NULL,
        LastWorkingDay DATE NULL,
        ReasonForLeaving NVARCHAR(400) NULL,
        RehireEligible BIT NOT NULL CONSTRAINT DF_core_Employees_RehireEligible DEFAULT (1),

        RowVersion ROWVERSION NOT NULL,
        IsDeleted BIT NOT NULL CONSTRAINT DF_core_Employees_IsDeleted DEFAULT (0),
        CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_core_Employees_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
        UpdatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_core_Employees_UpdatedAtUtc DEFAULT SYSUTCDATETIME(),

        CONSTRAINT UQ_core_Employees_EmployeeCode UNIQUE (EmployeeCode),
        CONSTRAINT UQ_core_Employees_CivilID UNIQUE (CivilID),
        CONSTRAINT UQ_core_Employees_PassportNumber UNIQUE (PassportNumber),
        CONSTRAINT FK_core_Employees_Department FOREIGN KEY (DepartmentID) REFERENCES core.Departments(DepartmentID),
        CONSTRAINT FK_core_Employees_Branch FOREIGN KEY (BranchID) REFERENCES core.Branches(BranchID),
        CONSTRAINT FK_core_Employees_Manager FOREIGN KEY (DirectManagerID) REFERENCES core.Employees(EmployeeID),

        CONSTRAINT CK_core_Employees_Gender CHECK (Gender IN (N'Male', N'Female', N'Other', N'Undisclosed')),
        CONSTRAINT CK_core_Employees_MaritalStatus CHECK (MaritalStatus IS NULL OR MaritalStatus IN (N'Single', N'Married', N'Divorced', N'Widowed', N'Other')),
        CONSTRAINT CK_core_Employees_EmploymentType CHECK (EmploymentType IN (N'Permanent', N'Contract', N'Probation', N'Temporary', N'Intern')),
        CONSTRAINT CK_core_Employees_Status CHECK (Status IN (N'Active', N'Inactive', N'Resigned', N'Terminated', N'OnLeave')),
        CONSTRAINT CK_core_Employees_PaymentMode CHECK (PaymentMode IN (N'Bank', N'Cash', N'WPS')),
        CONSTRAINT CK_core_Employees_SalaryNonNegative CHECK (
            BasicSalary >= 0 AND HousingAllowance >= 0 AND TransportAllowance >= 0 AND OtherFixedAllowances >= 0
        ),
        CONSTRAINT CK_core_Employees_ProbationAfterJoin CHECK (ProbationEndDate IS NULL OR ProbationEndDate >= JoiningDate),
        CONSTRAINT CK_core_Employees_ConfirmationAfterJoin CHECK (ConfirmationDate IS NULL OR ConfirmationDate >= JoiningDate),
        CONSTRAINT CK_core_Employees_ExitDates CHECK (
            (ResignationDate IS NULL AND LastWorkingDay IS NULL)
            OR (LastWorkingDay IS NULL OR ResignationDate IS NULL OR LastWorkingDay >= ResignationDate)
        )
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_core_Employees_EmployeeCode' AND object_id = OBJECT_ID(N'core.Employees'))
    CREATE INDEX IX_core_Employees_EmployeeCode ON core.Employees(EmployeeCode) INCLUDE (FullName, Status, DepartmentID);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_core_Employees_DepartmentID' AND object_id = OBJECT_ID(N'core.Employees'))
    CREATE INDEX IX_core_Employees_DepartmentID ON core.Employees(DepartmentID) INCLUDE (EmployeeCode, FullName, Status);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_core_Employees_Status' AND object_id = OBJECT_ID(N'core.Employees'))
    CREATE INDEX IX_core_Employees_Status ON core.Employees(Status, IsDeleted) INCLUDE (EmployeeCode, FullName, JoiningDate);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_core_Employees_DocExpiry' AND object_id = OBJECT_ID(N'core.Employees'))
    CREATE INDEX IX_core_Employees_DocExpiry ON core.Employees(PassportExpiry, CivilIDExpiry, VisaExpiry, LabourCardExpiry) WHERE IsDeleted = 0;
GO

CREATE OR ALTER TRIGGER core.trg_Employees_SetUpdatedAtUtc
ON core.Employees
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE e
        SET UpdatedAtUtc = SYSUTCDATETIME()
    FROM core.Employees e
    INNER JOIN inserted i ON i.EmployeeID = e.EmployeeID;
END;
GO
