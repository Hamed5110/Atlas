/*
HCM / Atlas Aluminum entitlement helper functions.
Parity target: airfare_management.domain.services (30/360 + cycle 60).
Schema: airfare (matches existing mssql_procedures.sql).
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;
GO

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'airfare')
    EXEC(N'CREATE SCHEMA airfare');
GO

IF OBJECT_ID(N'airfare.fn_HCM_WorkingDays30360', N'FN') IS NOT NULL
    DROP FUNCTION airfare.fn_HCM_WorkingDays30360;
GO

CREATE FUNCTION airfare.fn_HCM_WorkingDays30360 (
    @AsOfDate DATE,
    @AllocationYear INT,
    @JoinDate DATE,
    @PreviousTicketDate DATE
)
RETURNS INT
AS
BEGIN
    DECLARE @start DATE;
    DECLARE @startSerial INT;
    DECLARE @endSerial INT;
    DECLARE @days INT;

    IF YEAR(@AsOfDate) < @AllocationYear
        RETURN 0;
    IF YEAR(@AsOfDate) > @AllocationYear
        RETURN 360;

    SET @start = DATEFROMPARTS(@AllocationYear, 1, 1);
    IF @JoinDate IS NOT NULL AND @JoinDate > @start
        SET @start = @JoinDate;
    IF @PreviousTicketDate IS NOT NULL AND DATEADD(DAY, 1, @PreviousTicketDate) > @start
        SET @start = DATEADD(DAY, 1, @PreviousTicketDate);
    IF @start > @AsOfDate
        RETURN 0;

    SET @startSerial = (MONTH(@start) - 1) * 30 + DAY(@start);
    SET @endSerial = (MONTH(@AsOfDate) - 1) * 30 + DAY(@AsOfDate);
    SET @days = @endSerial - @startSerial + 1;
    IF @days < 0 SET @days = 0;
    IF @days > 360 SET @days = 360;
    RETURN @days;
END;
GO

IF OBJECT_ID(N'airfare.fn_HCM_AirfareAmountFromDays', N'FN') IS NOT NULL
    DROP FUNCTION airfare.fn_HCM_AirfareAmountFromDays;
GO

CREATE FUNCTION airfare.fn_HCM_AirfareAmountFromDays (
    @ClosingDays DECIMAL(18, 4),
    @MaxPayout DECIMAL(19, 4)
)
RETURNS DECIMAL(19, 4)
AS
BEGIN
    DECLARE @payout DECIMAL(19, 4) = CASE WHEN ISNULL(@MaxPayout, 0) <= 0 THEN 150 ELSE @MaxPayout END;
    DECLARE @days DECIMAL(18, 4) = CASE
        WHEN ISNULL(@ClosingDays, 0) < 0 THEN 0
        WHEN @ClosingDays > 60 THEN 60
        ELSE @ClosingDays
    END;
    RETURN CAST(ROUND((@payout / 60.0) * @days, 2) AS DECIMAL(19, 4));
END;
GO

IF OBJECT_ID(N'airfare.fn_HCM_NextDueDate', N'FN') IS NOT NULL
    DROP FUNCTION airfare.fn_HCM_NextDueDate;
GO

CREATE FUNCTION airfare.fn_HCM_NextDueDate (@AsOfDate DATE)
RETURNS DATE
AS
BEGIN
    RETURN DATEFROMPARTS(
        YEAR(DATEADD(MONTH, 1, @AsOfDate)),
        MONTH(DATEADD(MONTH, 1, @AsOfDate)),
        1
    );
END;
GO

IF OBJECT_ID(N'airfare.fn_HCM_LoanEMI', N'FN') IS NOT NULL
    DROP FUNCTION airfare.fn_HCM_LoanEMI;
GO

CREATE FUNCTION airfare.fn_HCM_LoanEMI (
    @Principal DECIMAL(19, 4),
    @Installments INT
)
RETURNS DECIMAL(19, 4)
AS
BEGIN
    -- Parity with dbo.fn_ATLAS_LoanEMI / Python fn_atlas_loan_emi (simple divide).
    IF ISNULL(@Principal, 0) <= 0 OR ISNULL(@Installments, 0) <= 0
        RETURN CAST(0 AS DECIMAL(19, 4));
    RETURN CAST(ROUND(@Principal / @Installments, 2) AS DECIMAL(19, 4));
END;
GO
