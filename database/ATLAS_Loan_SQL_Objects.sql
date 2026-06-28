USE Atlasairfare010;
GO

CREATE OR ALTER FUNCTION dbo.fn_ATLAS_LoanEMI
(
    @Amount DECIMAL(12,2),
    @Tenure INT
)
RETURNS DECIMAL(12,2)
AS
BEGIN
    IF @Amount IS NULL OR @Amount <= 0 OR @Tenure IS NULL OR @Tenure <= 0 RETURN 0;
    RETURN ROUND(@Amount / @Tenure, 2);
END;
GO

CREATE OR ALTER FUNCTION dbo.fn_ATLAS_LoanMonthsLeft
(
    @Tenure INT,
    @MonthsPaid INT,
    @RemainingBalance DECIMAL(12,2),
    @EMI DECIMAL(12,2)
)
RETURNS INT
AS
BEGIN
    IF @RemainingBalance IS NULL OR @RemainingBalance <= 0 RETURN 0;
    IF @EMI IS NOT NULL AND @EMI > 0 RETURN CEILING(@RemainingBalance / @EMI);
    IF @Tenure IS NULL RETURN 0;
    RETURN IIF(@Tenure - ISNULL(@MonthsPaid, 0) > 0, @Tenure - ISNULL(@MonthsPaid, 0), 0);
END;
GO

CREATE OR ALTER VIEW dbo.vw_ATLAS_LoanRegister
AS
SELECT
    l.LoanID,
    l.EmployeeID,
    e.EmployeeCode,
    e.FullName,
    e.Department,
    e.Branch,
    l.AllocationID,
    l.OriginalAmount,
    l.RemainingBalance,
    l.EMI,
    l.Tenure,
    l.MonthsPaid,
    dbo.fn_ATLAS_LoanMonthsLeft(l.Tenure, l.MonthsPaid, l.RemainingBalance, l.EMI) AS MonthsLeft,
    l.TotalPaid,
    CAST(CASE WHEN l.OriginalAmount > 0 THEN ROUND((l.TotalPaid / l.OriginalAmount) * 100, 2) ELSE 0 END AS DECIMAL(10,2)) AS PaidPercent,
    l.Status,
    l.DeferMonths,
    l.DeferStart,
    l.CreatedDate,
    l.SettledDate,
    DATEADD(MONTH, dbo.fn_ATLAS_LoanMonthsLeft(l.Tenure, l.MonthsPaid, l.RemainingBalance, l.EMI), CAST(GETDATE() AS DATE)) AS EstimatedCloseDate,
    l.CreatedAt
FROM Loans l
JOIN Employees e ON e.EmployeeID = l.EmployeeID;
GO

CREATE OR ALTER VIEW dbo.vw_ATLAS_LoanSummary
AS
SELECT
    COUNT(*) AS TotalLoans,
    ISNULL(SUM(CASE WHEN Status = 'active' THEN 1 ELSE 0 END), 0) AS ActiveLoans,
    ISNULL(SUM(CASE WHEN Status = 'settled' THEN 1 ELSE 0 END), 0) AS SettledLoans,
    ISNULL(SUM(CASE WHEN Status = 'deferred' THEN 1 ELSE 0 END), 0) AS DeferredLoans,
    CAST(ISNULL(SUM(OriginalAmount), 0) AS DECIMAL(12,2)) AS TotalOriginal,
    CAST(ISNULL(SUM(RemainingBalance), 0) AS DECIMAL(12,2)) AS TotalOutstanding,
    CAST(ISNULL(SUM(EMI), 0) AS DECIMAL(12,2)) AS MonthlyDeduction,
    CAST(ISNULL(SUM(TotalPaid), 0) AS DECIMAL(12,2)) AS TotalRecovered
FROM Loans;
GO

CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_GetLoanRegister
    @Status NVARCHAR(15) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT *
    FROM dbo.vw_ATLAS_LoanRegister
    WHERE @Status IS NULL OR @Status = '' OR Status = @Status
    ORDER BY
        CASE WHEN Status = 'active' THEN 0 WHEN Status = 'deferred' THEN 1 ELSE 2 END,
        CreatedDate DESC,
        LoanID DESC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_GetLoanSummary
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM dbo.vw_ATLAS_LoanSummary;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_CreateManualLoan
    @EmployeeID INT,
    @OriginalAmount DECIMAL(12,2),
    @Tenure INT,
    @CreatedDate DATE,
    @Note NVARCHAR(255) = NULL,
    @CreatedBy INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @OriginalAmount <= 0 THROW 51000, 'Loan amount must be more than zero.', 1;
    IF @Tenure <= 0 THROW 51001, 'Loan tenure must be more than zero.', 1;
    IF NOT EXISTS (SELECT 1 FROM Employees WHERE EmployeeID = @EmployeeID)
        THROW 51002, 'Employee not found.', 1;

    DECLARE @EMI DECIMAL(12,2) = dbo.fn_ATLAS_LoanEMI(@OriginalAmount, @Tenure);

    INSERT INTO Loans (EmployeeID, AllocationID, OriginalAmount, RemainingBalance, EMI, Tenure, CreatedDate, CreatedBy)
    VALUES (@EmployeeID, NULL, @OriginalAmount, @OriginalAmount, @EMI, @Tenure, @CreatedDate, @CreatedBy);

    DECLARE @LoanID BIGINT = SCOPE_IDENTITY();

    INSERT INTO LoanHistory (LoanID, PaymentDate, PaymentType, Amount, BalanceAfter, Note, CreatedBy)
    VALUES (@LoanID, @CreatedDate, 'create', @OriginalAmount, @OriginalAmount, ISNULL(@Note, 'Manual employee loan created'), @CreatedBy);

    SELECT * FROM dbo.vw_ATLAS_LoanRegister WHERE LoanID = @LoanID;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_RunMonthlyLoanEMI
    @PaymentDate DATE,
    @CreatedBy INT = NULL,
    @LoanIDsCsv NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Processed TABLE
    (
        LoanID BIGINT,
        Deducted DECIMAL(12,2),
        BalanceAfter DECIMAL(12,2)
    );

    UPDATE Loans
    SET Status = 'active',
        DeferMonths = NULL,
        DeferStart = NULL
    WHERE Status = 'deferred'
      AND DeferStart IS NOT NULL
      AND DeferMonths IS NOT NULL
      AND DATEADD(MONTH, DeferMonths, DeferStart) <= @PaymentDate;

    DECLARE @SelectedLoanIDs TABLE (LoanID BIGINT PRIMARY KEY);
    IF NULLIF(LTRIM(RTRIM(@LoanIDsCsv)), '') IS NOT NULL
    BEGIN
        INSERT INTO @SelectedLoanIDs (LoanID)
        SELECT DISTINCT TRY_CONVERT(BIGINT, value)
        FROM STRING_SPLIT(@LoanIDsCsv, ',')
        WHERE TRY_CONVERT(BIGINT, value) IS NOT NULL;
    END;

    DECLARE @LoanID BIGINT, @Remaining DECIMAL(12,2), @EMI DECIMAL(12,2), @TotalPaid DECIMAL(12,2), @MonthsPaid INT;
    DECLARE loan_cursor CURSOR LOCAL FAST_FORWARD FOR
        SELECT LoanID, RemainingBalance, EMI, TotalPaid, MonthsPaid
        FROM Loans
        WHERE Status = 'active'
          AND RemainingBalance > 0
          AND (
              NOT EXISTS (SELECT 1 FROM @SelectedLoanIDs)
              OR LoanID IN (SELECT LoanID FROM @SelectedLoanIDs)
          );

    OPEN loan_cursor;
    FETCH NEXT FROM loan_cursor INTO @LoanID, @Remaining, @EMI, @TotalPaid, @MonthsPaid;

    WHILE @@FETCH_STATUS = 0
    BEGIN
        DECLARE @Deduct DECIMAL(12,2) = IIF(@EMI < @Remaining, @EMI, @Remaining);
        DECLARE @NewBalance DECIMAL(12,2) = @Remaining - @Deduct;
        DECLARE @NewStatus NVARCHAR(15) = IIF(@NewBalance <= 0.01, 'settled', 'active');

        UPDATE Loans
        SET RemainingBalance = @NewBalance,
            TotalPaid = @TotalPaid + @Deduct,
            MonthsPaid = @MonthsPaid + 1,
            Status = @NewStatus,
            SettledDate = CASE WHEN @NewStatus = 'settled' THEN @PaymentDate ELSE SettledDate END
        WHERE LoanID = @LoanID;

        INSERT INTO LoanHistory (LoanID, PaymentDate, PaymentType, Amount, BalanceAfter, Note, CreatedBy)
        VALUES (@LoanID, @PaymentDate, 'emi', @Deduct, @NewBalance, CONCAT('Monthly EMI #', @MonthsPaid + 1), @CreatedBy);

        INSERT INTO @Processed VALUES (@LoanID, @Deduct, @NewBalance);

        FETCH NEXT FROM loan_cursor INTO @LoanID, @Remaining, @EMI, @TotalPaid, @MonthsPaid;
    END;

    CLOSE loan_cursor;
    DEALLOCATE loan_cursor;

    SELECT COUNT(*) AS Processed, CAST(ISNULL(SUM(Deducted), 0) AS DECIMAL(12,2)) AS TotalDeducted FROM @Processed;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_DeferLoan
    @LoanID BIGINT,
    @DeferMonths INT,
    @DeferStart DATE,
    @CreatedBy INT = NULL,
    @Note NVARCHAR(255) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @DeferMonths IS NULL OR @DeferMonths <= 0 OR @DeferMonths > 24
        THROW 51004, 'Defer months must be between 1 and 24.', 1;

    DECLARE @Remaining DECIMAL(12,2), @Status NVARCHAR(15);
    SELECT @Remaining = RemainingBalance, @Status = Status FROM Loans WHERE LoanID = @LoanID;
    IF @Remaining IS NULL THROW 51003, 'Loan not found.', 1;
    IF @Status = 'settled' THROW 51005, 'Settled loans cannot be deferred.', 1;

    UPDATE Loans
    SET Status = 'deferred',
        DeferMonths = @DeferMonths,
        DeferStart = @DeferStart
    WHERE LoanID = @LoanID;

    INSERT INTO LoanHistory (LoanID, PaymentDate, PaymentType, Amount, BalanceAfter, Note, CreatedBy)
    VALUES (@LoanID, @DeferStart, 'defer', 0, @Remaining, ISNULL(@Note, CONCAT('EMI deferred for ', @DeferMonths, ' month(s)')), @CreatedBy);

    SELECT * FROM dbo.vw_ATLAS_LoanRegister WHERE LoanID = @LoanID;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_RestructureLoanEMI
    @LoanID BIGINT,
    @NewEMI DECIMAL(12,2) = NULL,
    @NewTenureMonths INT = NULL,
    @EffectiveDate DATE,
    @CreatedBy INT = NULL,
    @Note NVARCHAR(255) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Remaining DECIMAL(12,2), @MonthsPaid INT, @Status NVARCHAR(15);
    SELECT @Remaining = RemainingBalance, @MonthsPaid = MonthsPaid, @Status = Status FROM Loans WHERE LoanID = @LoanID;
    IF @Remaining IS NULL THROW 51003, 'Loan not found.', 1;
    IF @Status = 'settled' THROW 51006, 'Settled loans cannot be restructured.', 1;

    IF (@NewEMI IS NULL OR @NewEMI <= 0) AND (@NewTenureMonths IS NULL OR @NewTenureMonths <= 0)
        THROW 51007, 'Enter either a new EMI amount or a new remaining tenure.', 1;

    DECLARE @FinalEMI DECIMAL(12,2);
    DECLARE @FinalTenure INT;

    IF @NewEMI IS NOT NULL AND @NewEMI > 0
    BEGIN
        SET @FinalEMI = @NewEMI;
        SET @FinalTenure = ISNULL(@MonthsPaid, 0) + CEILING(@Remaining / @NewEMI);
    END
    ELSE
    BEGIN
        SET @FinalEMI = dbo.fn_ATLAS_LoanEMI(@Remaining, @NewTenureMonths);
        SET @FinalTenure = ISNULL(@MonthsPaid, 0) + @NewTenureMonths;
    END;

    UPDATE Loans
    SET EMI = @FinalEMI,
        Tenure = @FinalTenure,
        Status = 'active',
        DeferMonths = NULL,
        DeferStart = NULL
    WHERE LoanID = @LoanID;

    INSERT INTO LoanHistory (LoanID, PaymentDate, PaymentType, Amount, BalanceAfter, Note, CreatedBy)
    VALUES (@LoanID, @EffectiveDate, 'restructure', 0, @Remaining,
        ISNULL(@Note, CONCAT('Loan restructured. New EMI ', @FinalEMI, ', tenure ', @FinalTenure, ' month(s).')), @CreatedBy);

    SELECT * FROM dbo.vw_ATLAS_LoanRegister WHERE LoanID = @LoanID;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_SettleLoan
    @LoanID BIGINT,
    @PaymentDate DATE,
    @CreatedBy INT = NULL,
    @Note NVARCHAR(255) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Remaining DECIMAL(12,2), @TotalPaid DECIMAL(12,2);
    SELECT @Remaining = RemainingBalance, @TotalPaid = TotalPaid FROM Loans WHERE LoanID = @LoanID;
    IF @Remaining IS NULL THROW 51003, 'Loan not found.', 1;

    UPDATE Loans
    SET RemainingBalance = 0,
        TotalPaid = @TotalPaid + @Remaining,
        Status = 'settled',
        SettledDate = @PaymentDate
    WHERE LoanID = @LoanID;

    INSERT INTO LoanHistory (LoanID, PaymentDate, PaymentType, Amount, BalanceAfter, Note, CreatedBy)
    VALUES (@LoanID, @PaymentDate, 'settle', @Remaining, 0, ISNULL(@Note, 'Manual settlement'), @CreatedBy);

    SELECT * FROM dbo.vw_ATLAS_LoanRegister WHERE LoanID = @LoanID;
END;
GO
