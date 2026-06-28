
-- =====================================================
-- ATLAS Airfare & Loan Manager - MSSQL Database Schema
-- =====================================================
-- Run this script in SQL Server Management Studio (SSMS)
-- or sqlcmd to create the complete database
-- =====================================================

CREATE DATABASE Atlasairfare010;
GO

USE Atlasairfare010;
GO

-- =====================================================
-- 1. USERS & AUTHENTICATION
-- =====================================================
CREATE TABLE Users (
    UserID INT IDENTITY(1,1) PRIMARY KEY,
    Username NVARCHAR(50) NOT NULL UNIQUE,
    PasswordHash NVARCHAR(255) NOT NULL,        -- bcrypt hash
    Email NVARCHAR(100) NOT NULL UNIQUE,
    FullName NVARCHAR(100) NOT NULL,
    Role NVARCHAR(20) NOT NULL DEFAULT 'user'   -- admin, manager, hr, user, viewer
        CHECK (Role IN ('admin', 'manager', 'hr', 'user', 'viewer')),
    Department NVARCHAR(50) NULL,
    Branch NVARCHAR(50) NULL,
    IsActive BIT NOT NULL DEFAULT 1,
    LastLogin DATETIME2 NULL,
    LoginAttempts INT NOT NULL DEFAULT 0,
    LockedUntil DATETIME2 NULL,
    PasswordChangedAt DATETIME2 NOT NULL DEFAULT GETDATE(),
    CreatedAt DATETIME2 NOT NULL DEFAULT GETDATE(),
    CreatedBy INT NULL FOREIGN KEY REFERENCES Users(UserID),
    UpdatedAt DATETIME2 NULL,
    UpdatedBy INT NULL FOREIGN KEY REFERENCES Users(UserID)
);

-- Default admin user (password: Admin@123 - change after first login)
-- Hash generated with bcrypt cost 12
INSERT INTO Users (Username, PasswordHash, Email, FullName, Role, IsActive)
VALUES ('admin', '$2a$12$alD05qG4/7MmpjKlKJuqv.YFoTpNglaKdLcfc6xJXKtUpi.X83T8C', 'admin@atlas.com', 'System Administrator', 'admin', 1);

-- =====================================================
-- 2. AUDIT LOG
-- =====================================================
CREATE TABLE AuditLog (
    AuditID BIGINT IDENTITY(1,1) PRIMARY KEY,
    UserID INT NULL FOREIGN KEY REFERENCES Users(UserID),
    Username NVARCHAR(50) NULL,                    -- denormalized for tracking deleted users
    Action NVARCHAR(50) NOT NULL,                  -- CREATE, UPDATE, DELETE, LOGIN, LOGOUT, EXPORT, IMPORT, BACKUP, RESTORE, YEAR_END_CLOSE, LOAN_EMI, LOAN_SETTLE, LOAN_DEFER
    EntityType NVARCHAR(30) NOT NULL,              -- Employee, Allocation, Loan, EmergencyTicket, YearEnd, User, System
    EntityID BIGINT NULL,                          -- ID of affected record
    OldValues NVARCHAR(MAX) NULL,                  -- JSON of previous state
    NewValues NVARCHAR(MAX) NULL,                  -- JSON of new state
    Description NVARCHAR(500) NULL,
    IPAddress NVARCHAR(45) NULL,                   -- IPv6 compatible
    UserAgent NVARCHAR(500) NULL,
    SessionID NVARCHAR(100) NULL,
    Status NVARCHAR(20) NOT NULL DEFAULT 'success' -- success, failed, warning
        CHECK (Status IN ('success', 'failed', 'warning')),
    ErrorMessage NVARCHAR(MAX) NULL,
    CreatedAt DATETIME2 NOT NULL DEFAULT GETDATE()
);

-- Indexes for audit log performance
CREATE INDEX IX_AuditLog_UserID ON AuditLog(UserID);
CREATE INDEX IX_AuditLog_Action ON AuditLog(Action);
CREATE INDEX IX_AuditLog_Entity ON AuditLog(EntityType, EntityID);
CREATE INDEX IX_AuditLog_CreatedAt ON AuditLog(CreatedAt DESC);
CREATE INDEX IX_AuditLog_Session ON AuditLog(SessionID);

-- =====================================================
-- 3. EMPLOYEES
-- =====================================================
CREATE TABLE Employees (
    EmployeeID INT IDENTITY(1,1) PRIMARY KEY,
    EmployeeCode NVARCHAR(20) NOT NULL UNIQUE,
    FullName NVARCHAR(100) NOT NULL,
    JoinDate DATE NULL,
    CPR NVARCHAR(20) NULL,
    Passport NVARCHAR(20) NULL,
    Nationality NVARCHAR(30) NULL,
    BHStatus NVARCHAR(10) NOT NULL DEFAULT 'NON-BH' CHECK (BHStatus IN ('BH', 'NON-BH')),
    Branch NVARCHAR(50) NULL,
    Department NVARCHAR(50) NULL,
    Section NVARCHAR(50) NULL,
    Location NVARCHAR(50) NULL,
    Designation NVARCHAR(50) NULL,
    EmpGroup NVARCHAR(80) NULL,
    Status NVARCHAR(10) NOT NULL DEFAULT 'Active' CHECK (Status IN ('Active', 'Inactive')),

    -- Airfare Details
    OpeningDays DECIMAL(10,2) NOT NULL DEFAULT 0,
    OpeningBHD DECIMAL(10,2) NOT NULL DEFAULT 0,
    Close2023Days DECIMAL(10,2) NULL,
    Close2023BHD DECIMAL(10,2) NULL,
    CurrentAirfareRate DECIMAL(10,2) NOT NULL DEFAULT 30,
    AirfarePaidDays DECIMAL(10,2) NOT NULL DEFAULT 0,
    RemainingBalance DECIMAL(10,2) NOT NULL DEFAULT 0,
    MaximumPayout DECIMAL(10,2) NOT NULL DEFAULT 150,
    TotalAirfare DECIMAL(10,2) NOT NULL DEFAULT 0,
    LastAllocationYear INT NULL,

    -- Monthly Working Days
    JanDays DECIMAL(5,2) NOT NULL DEFAULT 30,
    FebDays DECIMAL(5,2) NOT NULL DEFAULT 30,
    MarDays DECIMAL(5,2) NOT NULL DEFAULT 30,
    AprDays DECIMAL(5,2) NOT NULL DEFAULT 30,
    MayDays DECIMAL(5,2) NOT NULL DEFAULT 30,
    JunDays DECIMAL(5,2) NOT NULL DEFAULT 30,
    JulDays DECIMAL(5,2) NOT NULL DEFAULT 30,
    AugDays DECIMAL(5,2) NOT NULL DEFAULT 30,
    SepDays DECIMAL(5,2) NOT NULL DEFAULT 30,
    OctDays DECIMAL(5,2) NOT NULL DEFAULT 30,
    NovDays DECIMAL(5,2) NOT NULL DEFAULT 30,
    DecDays DECIMAL(5,2) NOT NULL DEFAULT 30,
    TotalWorkingDays DECIMAL(10,2) NOT NULL DEFAULT 360,

    CreatedAt DATETIME2 NOT NULL DEFAULT GETDATE(),
    CreatedBy INT NULL FOREIGN KEY REFERENCES Users(UserID),
    UpdatedAt DATETIME2 NULL,
    UpdatedBy INT NULL FOREIGN KEY REFERENCES Users(UserID)
);

-- =====================================================
-- 4. AIRFARE ALLOCATIONS
-- =====================================================
CREATE TABLE Allocations (
    AllocationID BIGINT IDENTITY(1,1) PRIMARY KEY,
    EmployeeID INT NOT NULL FOREIGN KEY REFERENCES Employees(EmployeeID),
    AllocationDate DATE NOT NULL,
    AllocYear INT NOT NULL,
    TicketCost DECIMAL(10,2) NOT NULL,
    Entitlement DECIMAL(10,2) NOT NULL DEFAULT 0,
    CompanyPaid DECIMAL(10,2) NOT NULL DEFAULT 0,
    ExcessAmount DECIMAL(10,2) NOT NULL DEFAULT 0,
    PaymentMode NVARCHAR(20) NOT NULL DEFAULT 'entitlement'
        CHECK (PaymentMode IN ('entitlement', 'loan', 'employee', 'employee_full', 'company', 'company_full')),
    LoanAmount DECIMAL(10,2) NOT NULL DEFAULT 0,
    EmployeePaid DECIMAL(10,2) NOT NULL DEFAULT 0,
    CompanyExtra DECIMAL(10,2) NOT NULL DEFAULT 0,
    EMI DECIMAL(10,2) NOT NULL DEFAULT 0,
    Tenure INT NOT NULL DEFAULT 0,
    LeaveStart DATE NULL,
    LeaveEnd DATE NULL,
    Remarks NVARCHAR(255) NULL,
    Status NVARCHAR(10) NOT NULL DEFAULT 'active' CHECK (Status IN ('active', 'cancelled')),
    CreatedAt DATETIME2 NOT NULL DEFAULT GETDATE(),
    CreatedBy INT NULL FOREIGN KEY REFERENCES Users(UserID)
);

CREATE INDEX IX_Allocations_Employee ON Allocations(EmployeeID);
CREATE INDEX IX_Allocations_Year ON Allocations(AllocYear);
CREATE INDEX IX_Allocations_Date ON Allocations(AllocationDate);

-- Date-effective airfare rate policy. Allocation rows store a snapshot
-- so changing a future/current rate never recalculates historical tickets.
CREATE TABLE AirfarePolicyRates (
    PolicyRateID BIGINT IDENTITY(1,1) PRIMARY KEY,
    CompanyID INT NULL,
    EffectiveFrom DATE NOT NULL,
    EffectiveTo DATE NULL,
    MaxPayoutAmount DECIMAL(12,2) NOT NULL,
    CycleDays DECIMAL(10,2) NOT NULL DEFAULT 60,
    WorkingDaysPerMonth DECIMAL(10,2) NOT NULL DEFAULT 30,
    AirfareDaysPerMonth DECIMAL(10,2) NOT NULL DEFAULT 2.5,
    IsActive BIT NOT NULL DEFAULT 1,
    CreatedAt DATETIME2 NOT NULL DEFAULT GETDATE(),
    CreatedBy INT NULL FOREIGN KEY REFERENCES Users(UserID),
    CONSTRAINT CK_AirfarePolicyRates_Amount CHECK (MaxPayoutAmount > 0),
    CONSTRAINT CK_AirfarePolicyRates_Dates CHECK (EffectiveTo IS NULL OR EffectiveTo >= EffectiveFrom)
);

CREATE INDEX IX_AirfarePolicyRates_Effective ON AirfarePolicyRates(CompanyID, EffectiveFrom, EffectiveTo, IsActive);

-- =====================================================
-- 5. LOANS
-- =====================================================
CREATE TABLE Loans (
    LoanID BIGINT IDENTITY(1,1) PRIMARY KEY,
    EmployeeID INT NOT NULL FOREIGN KEY REFERENCES Employees(EmployeeID),
    AllocationID BIGINT NULL FOREIGN KEY REFERENCES Allocations(AllocationID),
    OriginalAmount DECIMAL(10,2) NOT NULL,
    RemainingBalance DECIMAL(10,2) NOT NULL,
    EMI DECIMAL(10,2) NOT NULL,
    Tenure INT NOT NULL,
    MonthsPaid INT NOT NULL DEFAULT 0,
    TotalPaid DECIMAL(10,2) NOT NULL DEFAULT 0,
    Status NVARCHAR(15) NOT NULL DEFAULT 'active' 
        CHECK (Status IN ('active', 'settled', 'deferred')),
    DeferMonths INT NULL,
    DeferStart DATE NULL,
    CreatedDate DATE NOT NULL,
    SettledDate DATE NULL,
    CreatedAt DATETIME2 NOT NULL DEFAULT GETDATE(),
    CreatedBy INT NULL FOREIGN KEY REFERENCES Users(UserID)
);

CREATE INDEX IX_Loans_Employee ON Loans(EmployeeID);
CREATE INDEX IX_Loans_Status ON Loans(Status);

-- =====================================================
-- 6. LOAN PAYMENT HISTORY
-- =====================================================
CREATE TABLE LoanHistory (
    HistoryID BIGINT IDENTITY(1,1) PRIMARY KEY,
    LoanID BIGINT NOT NULL FOREIGN KEY REFERENCES Loans(LoanID),
    PaymentDate DATE NOT NULL,
    PaymentType NVARCHAR(20) NOT NULL
        CHECK (PaymentType IN ('create', 'emi', 'add', 'settle', 'defer', 'bulk', 'restructure', 'reversal')),
    Amount DECIMAL(10,2) NOT NULL,
    BalanceAfter DECIMAL(10,2) NOT NULL,
    Note NVARCHAR(255) NULL,
    CreatedAt DATETIME2 NOT NULL DEFAULT GETDATE(),
    CreatedBy INT NULL FOREIGN KEY REFERENCES Users(UserID)
);

CREATE INDEX IX_LoanHistory_Loan ON LoanHistory(LoanID);

-- =====================================================
-- 7. EMERGENCY TICKETS
-- =====================================================
CREATE TABLE EmergencyTickets (
    TicketID BIGINT IDENTITY(1,1) PRIMARY KEY,
    EmployeeID INT NOT NULL FOREIGN KEY REFERENCES Employees(EmployeeID),
    TicketType NVARCHAR(20) NOT NULL
        CHECK (TicketType IN ('medical', 'family', 'death', 'accident', 'other')),
    Priority NVARCHAR(10) NOT NULL
        CHECK (Priority IN ('urgent', 'high', 'medium', 'low')),
    TicketDate DATE NOT NULL,
    Destination NVARCHAR(100) NULL,
    EstimatedCost DECIMAL(10,2) NOT NULL DEFAULT 0,
    Reason NVARCHAR(MAX) NOT NULL,
    ApproverName NVARCHAR(100) NULL,
    ApproverEmail NVARCHAR(100) NULL,
    Status NVARCHAR(15) NOT NULL DEFAULT 'open'
        CHECK (Status IN ('open', 'in-progress', 'resolved', 'closed')),
    Resolution NVARCHAR(MAX) NULL,
    ResolvedAt DATETIME2 NULL,
    CreatedAt DATETIME2 NOT NULL DEFAULT GETDATE(),
    CreatedBy INT NULL FOREIGN KEY REFERENCES Users(UserID),
    UpdatedAt DATETIME2 NULL,
    UpdatedBy INT NULL FOREIGN KEY REFERENCES Users(UserID)
);

CREATE INDEX IX_Emergency_Employee ON EmergencyTickets(EmployeeID);
CREATE INDEX IX_Emergency_Status ON EmergencyTickets(Status);
CREATE INDEX IX_Emergency_Priority ON EmergencyTickets(Priority);

-- =====================================================
-- 8. YEAR-END CLOSING HISTORY
-- =====================================================
CREATE TABLE YearEndHistory (
    YearEndID INT IDENTITY(1,1) PRIMARY KEY,
    ClosedYear INT NOT NULL,
    NextYear INT NOT NULL,
    ClosingDate DATE NOT NULL,
    EmployeeCount INT NOT NULL DEFAULT 0,
    BalancesCarried INT NOT NULL DEFAULT 0,
    TotalAllocations INT NOT NULL DEFAULT 0,
    TotalLoansCreated INT NOT NULL DEFAULT 0,
    TotalEmergencyTickets INT NOT NULL DEFAULT 0,
    TotalOpeningBalance DECIMAL(12,2) NOT NULL DEFAULT 0,
    Remarks NVARCHAR(MAX) NULL,
    Status NVARCHAR(10) NOT NULL DEFAULT 'closed' CHECK (Status IN ('open', 'closed')),
    ClosedBy INT NULL FOREIGN KEY REFERENCES Users(UserID),
    ClosedAt DATETIME2 NOT NULL DEFAULT GETDATE()
);

-- =====================================================
-- 9. OPENING BALANCES BY YEAR
-- =====================================================
CREATE TABLE OpeningBalances (
    BalanceID BIGINT IDENTITY(1,1) PRIMARY KEY,
    EmployeeID INT NOT NULL FOREIGN KEY REFERENCES Employees(EmployeeID),
    BalanceYear INT NOT NULL,
    OpeningDays DECIMAL(10,2) NOT NULL DEFAULT 0,
    OpeningBHD DECIMAL(10,2) NOT NULL DEFAULT 0,
    CarriedFromYear INT NULL,
    CreatedAt DATETIME2 NOT NULL DEFAULT GETDATE(),
    UNIQUE(EmployeeID, BalanceYear)
);

CREATE INDEX IX_OpeningBal_Year ON OpeningBalances(BalanceYear);

-- =====================================================
-- 10. USER SESSIONS (for JWT token tracking)
-- =====================================================
CREATE TABLE UserSessions (
    SessionID NVARCHAR(100) PRIMARY KEY,
    UserID INT NOT NULL FOREIGN KEY REFERENCES Users(UserID),
    TokenHash NVARCHAR(255) NOT NULL,
    IPAddress NVARCHAR(45) NULL,
    UserAgent NVARCHAR(500) NULL,
    ExpiresAt DATETIME2 NOT NULL,
    CreatedAt DATETIME2 NOT NULL DEFAULT GETDATE(),
    LastActivity DATETIME2 NULL
);

CREATE INDEX IX_Sessions_User ON UserSessions(UserID);
CREATE INDEX IX_Sessions_Expiry ON UserSessions(ExpiresAt);

GO

-- =====================================================
-- AUDIT LOG CLEANUP PROCEDURE (run monthly via SQL Agent)
-- =====================================================
CREATE PROCEDURE sp_CleanupOldAuditLogs
    @RetentionMonths INT = 24
AS
BEGIN
    SET NOCOUNT ON;
    DELETE FROM AuditLog WHERE CreatedAt < DATEADD(MONTH, -@RetentionMonths, GETDATE());
    SELECT @@ROWCOUNT AS DeletedRows;
END;
GO

-- =====================================================
-- VIEW: AUDIT LOG WITH USER DETAILS
-- =====================================================
CREATE VIEW vw_AuditLogDetailed AS
SELECT 
    a.AuditID,
    a.UserID,
    u.FullName AS UserFullName,
    u.Username,
    u.Role,
    a.Action,
    a.EntityType,
    a.EntityID,
    a.OldValues,
    a.NewValues,
    a.Description,
    a.IPAddress,
    a.Status,
    a.ErrorMessage,
    a.CreatedAt
FROM AuditLog a
LEFT JOIN Users u ON a.UserID = u.UserID;
GO

-- =====================================================
-- VIEW: ACTIVE LOANS WITH EMPLOYEE DETAILS
-- =====================================================
CREATE VIEW vw_ActiveLoans AS
SELECT 
    l.LoanID,
    l.EmployeeID,
    e.EmployeeCode,
    e.FullName,
    l.OriginalAmount,
    l.RemainingBalance,
    l.EMI,
    l.Tenure,
    l.MonthsPaid,
    l.TotalPaid,
    l.Status,
    (l.Tenure - l.MonthsPaid) AS MonthsLeft,
    l.CreatedDate
FROM Loans l
JOIN Employees e ON l.EmployeeID = e.EmployeeID
WHERE l.Status = 'active';
GO

PRINT 'ATLAS Database Schema created successfully!';
PRINT 'Default admin credentials: Username=admin, Password=Admin@123';
PRINT 'IMPORTANT: Change the admin password after first login!';
GO

