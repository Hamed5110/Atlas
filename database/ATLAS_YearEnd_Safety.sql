/* ATLAS Year End Safety Patch: company-scoped, evidence-gated close controls. */
IF COL_LENGTH('dbo.YearEndHistory', 'CompanyID') IS NULL
    ALTER TABLE dbo.YearEndHistory ADD CompanyID INT NULL;
GO
IF COL_LENGTH('dbo.YearEndHistory', 'PreviewHash') IS NULL
    ALTER TABLE dbo.YearEndHistory ADD PreviewHash CHAR(64) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_YearEndHistory_CompanyYear' AND object_id = OBJECT_ID('dbo.YearEndHistory'))
    CREATE UNIQUE INDEX UX_YearEndHistory_CompanyYear ON dbo.YearEndHistory(CompanyID, ClosedYear) WHERE CompanyID IS NOT NULL;
GO
IF OBJECT_ID('dbo.YearEndPreviewEvidence', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.YearEndPreviewEvidence (
        PreviewID UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_YearEndPreviewEvidence PRIMARY KEY,
        CompanyID INT NOT NULL,
        ClosedYear INT NOT NULL,
        ClosingDate DATE NOT NULL,
        PreviewHash CHAR(64) NOT NULL,
        EmployeeCount INT NOT NULL,
        SnapshotJson NVARCHAR(MAX) NOT NULL,
        CreatedBy INT NOT NULL,
        CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_YearEndPreviewEvidence_CreatedAt DEFAULT SYSUTCDATETIME(),
        ExpiresAt DATETIME2(0) NOT NULL,
        ConsumedAt DATETIME2(0) NULL,
        CONSTRAINT FK_YearEndPreviewEvidence_Company FOREIGN KEY (CompanyID) REFERENCES dbo.Companies(CompanyID)
    );
END;
GO
IF OBJECT_ID('dbo.YearEndEmployeeSnapshots', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.YearEndEmployeeSnapshots (
        YearEndID INT NOT NULL,
        EmployeeID INT NOT NULL,
        ClosingDays DECIMAL(10,4) NOT NULL,
        ClosingBHD DECIMAL(12,2) NOT NULL,
        OpeningLoanBHD DECIMAL(12,2) NOT NULL,
        SnapshotHash CHAR(64) NOT NULL,
        CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_YearEndEmployeeSnapshots_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_YearEndEmployeeSnapshots PRIMARY KEY (YearEndID, EmployeeID),
        CONSTRAINT FK_YearEndEmployeeSnapshots_History FOREIGN KEY (YearEndID) REFERENCES dbo.YearEndHistory(YearEndID)
    );
END;
GO
CREATE OR ALTER TRIGGER dbo.tr_ATLAS_BlockClosedYearAllocationMutation
ON dbo.Allocations
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (
        SELECT 1
        FROM (SELECT EmployeeID, AllocYear FROM inserted UNION SELECT EmployeeID, AllocYear FROM deleted) x
        JOIN dbo.Employees e ON e.EmployeeID = x.EmployeeID
        JOIN dbo.Companies c ON LOWER(LTRIM(RTRIM(COALESCE(e.Company, N'')))) IN (LOWER(c.CompanyName), LOWER(c.CompanyCode))
        JOIN dbo.YearEndHistory y ON y.CompanyID = c.CompanyID AND y.ClosedYear = x.AllocYear AND y.Status = 'closed'
    )
        THROW 53301, 'Closed fiscal-year allocation mutation is blocked. Use an approved adjustment/re-close workflow.', 1;
END;
GO
CREATE OR ALTER TRIGGER dbo.tr_ATLAS_BlockClosedYearOpeningBalanceMutation
ON dbo.OpeningBalances
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (
        SELECT 1
        FROM (SELECT EmployeeID, BalanceYear FROM inserted UNION SELECT EmployeeID, BalanceYear FROM deleted) x
        JOIN dbo.Employees e ON e.EmployeeID = x.EmployeeID
        JOIN dbo.Companies c ON LOWER(LTRIM(RTRIM(COALESCE(e.Company, N'')))) IN (LOWER(c.CompanyName), LOWER(c.CompanyCode))
        JOIN dbo.YearEndHistory y ON y.CompanyID = c.CompanyID AND y.ClosedYear = x.BalanceYear AND y.Status = 'closed'
    )
        THROW 53302, 'Closed fiscal-year opening-balance mutation is blocked.', 1;
END;
GO
