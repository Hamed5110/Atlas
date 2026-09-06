-- Modern entitlement engine (UUID / company-scoped). Applied via apply_entitlement_sql.py
-- Period-end = carry-over + forfeit + seed next year. NOT a hard year-end wipe.

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'airfare')
    EXEC(N'CREATE SCHEMA airfare');
GO

CREATE OR ALTER FUNCTION airfare.fn_GetLengthOfServiceYears(
    @HireDate DATE,
    @AsOfDate DATE,
    @ContinuousServiceDate DATE = NULL
)
RETURNS DECIMAL(5, 2)
AS
BEGIN
    DECLARE @Start DATE = COALESCE(@ContinuousServiceDate, @HireDate);
    IF @Start IS NULL OR @AsOfDate IS NULL OR @AsOfDate < @Start
        RETURN 0;
    RETURN CAST((DATEDIFF(DAY, @Start, @AsOfDate) + 1) / 365.25 AS DECIMAL(5, 2));
END;
GO

CREATE OR ALTER FUNCTION airfare.fn_ProrateAnnualEntitlement(
    @AnnualAmount DECIMAL(18, 4),
    @EligibleDays INT,
    @TotalDays INT
)
RETURNS DECIMAL(18, 4)
AS
BEGIN
    IF @TotalDays IS NULL OR @TotalDays <= 0 OR @EligibleDays IS NULL OR @EligibleDays <= 0
        RETURN 0;
    RETURN ROUND((@AnnualAmount * @EligibleDays) / @TotalDays, 2);
END;
GO

CREATE OR ALTER FUNCTION airfare.fn_GetEntitlementRateByMatrix(
    @CompanyID NVARCHAR(36),
    @EntitlementTypeID NVARCHAR(36),
    @Grade NVARCHAR(40),
    @Location NVARCHAR(100),
    @FamilyStatus NVARCHAR(40),
    @LOSYears DECIMAL(5, 2),
    @AsOfDate DATE
)
RETURNS DECIMAL(18, 4)
AS
BEGIN
    DECLARE @Amount DECIMAL(18, 4);

    SELECT TOP (1) @Amount = annual_amount
    FROM dbo.entitlement_rules
    WHERE company_id = @CompanyID
      AND entitlement_type_id = @EntitlementTypeID
      AND is_current = 1
      AND is_active = 1
      AND deleted_at IS NULL
      AND @AsOfDate BETWEEN effective_from AND effective_to
      AND @LOSYears BETWEEN los_band_from AND los_band_to
      AND (grade = @Grade OR grade = N'')
      AND (location = @Location OR location = N'')
      AND (family_status = @FamilyStatus OR family_status = N'')
    ORDER BY
        CASE WHEN grade = @Grade THEN 0 ELSE 1 END,
        CASE WHEN location = @Location THEN 0 ELSE 1 END,
        CASE WHEN family_status = @FamilyStatus THEN 0 ELSE 1 END;

    RETURN COALESCE(@Amount, 0);
END;
GO

CREATE OR ALTER PROCEDURE airfare.sp_Entitlement_AccrueAnnual
    @CompanyID NVARCHAR(36),
    @FiscalYear INT,
    @EntitlementTypeID NVARCHAR(36),
    @RunBy NVARCHAR(100),
    @RowsProcessed INT OUTPUT,
    @TotalAmountAccrued DECIMAL(18, 4) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET @RowsProcessed = 0;
    SET @TotalAmountAccrued = 0;

    DECLARE @EmpID UNIQUEIDENTIFIER, @Hire DATE, @Grade NVARCHAR(40), @Loc NVARCHAR(100);
    DECLARE @LOS DECIMAL(5, 2), @Rate DECIMAL(18, 4), @Prorated DECIMAL(18, 4);
    DECLARE @AccountID NVARCHAR(36), @TxnID NVARCHAR(36);
    DECLARE @YearStart DATE = DATEFROMPARTS(@FiscalYear, 1, 1);
    DECLARE @YearEnd DATE = DATEFROMPARTS(@FiscalYear, 12, 31);
    DECLARE @TotalDays INT = DATEDIFF(DAY, @YearStart, @YearEnd) + 1;
    DECLARE @Now DATETIME2 = SYSUTCDATETIME();

    DECLARE c CURSOR LOCAL FAST_FORWARD FOR
        SELECT e.id, e.join_date, ISNULL(e.grade, N''), ISNULL(e.branch, N'')
        FROM dbo.employees e
        WHERE e.company_id = @CompanyID
          AND e.deleted_at IS NULL
          AND ISNULL(e.active, 1) = 1;

    OPEN c;
    FETCH NEXT FROM c INTO @EmpID, @Hire, @Grade, @Loc;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM dbo.entitlement_accounts
            WHERE company_id = @CompanyID AND employee_id = @EmpID
              AND entitlement_type_id = @EntitlementTypeID AND fiscal_year = @FiscalYear
              AND deleted_at IS NULL
        )
        BEGIN
            SET @LOS = airfare.fn_GetLengthOfServiceYears(@Hire, @YearEnd, NULL);
            SET @Rate = airfare.fn_GetEntitlementRateByMatrix(
                @CompanyID, @EntitlementTypeID, @Grade, @Loc, N'', @LOS, @YearStart
            );
            DECLARE @Eligible INT = CASE
                WHEN @Hire IS NULL THEN @TotalDays
                WHEN @Hire > @YearEnd THEN 0
                WHEN @Hire < @YearStart THEN @TotalDays
                ELSE DATEDIFF(DAY, @Hire, @YearEnd) + 1
            END;
            SET @Prorated = airfare.fn_ProrateAnnualEntitlement(@Rate, @Eligible, @TotalDays);
            SET @AccountID = CONVERT(NVARCHAR(36), NEWID());
            SET @TxnID = CONVERT(NVARCHAR(36), NEWID());

            INSERT INTO dbo.entitlement_accounts (
                id, company_id, employee_id, entitlement_type_id, fiscal_year,
                opening_balance, accruals, used_amount, adjustments, carry_over, forfeited,
                current_balance, status, effective_from, effective_to, is_current, version,
                created_at, updated_at, created_by
            ) VALUES (
                @AccountID, @CompanyID, @EmpID, @EntitlementTypeID, @FiscalYear,
                @Prorated, @Prorated, 0, 0, 0, 0,
                @Prorated, N'open', @YearStart, N'9999-12-31', 1, 1,
                @Now, @Now, @RunBy
            );

            INSERT INTO dbo.entitlement_transactions (
                id, company_id, account_id, employee_id, txn_type, amount, source,
                effective_from, is_approved, is_exported, notes, created_at, created_by
            ) VALUES (
                @TxnID, @CompanyID, @AccountID, @EmpID, N'ACCRUAL', @Prorated, N'ANNUAL_RUN',
                @YearStart, 1, 0, N'Annual accrual', @Now, @RunBy
            );

            SET @RowsProcessed += 1;
            SET @TotalAmountAccrued += @Prorated;
        END
        FETCH NEXT FROM c INTO @EmpID, @Hire, @Grade, @Loc;
    END
    CLOSE c; DEALLOCATE c;
END;
GO

CREATE OR ALTER PROCEDURE airfare.sp_Entitlement_Reconcile
    @CompanyID NVARCHAR(36),
    @FiscalYear INT,
    @EntitlementTypeID NVARCHAR(36)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        a.employee_id,
        e.full_name AS employee_name,
        CAST(a.opening_balance + a.accruals - a.used_amount + a.adjustments - a.forfeited AS DECIMAL(19, 4))
            AS expected_balance,
        a.current_balance,
        CAST(
            (a.opening_balance + a.accruals - a.used_amount + a.adjustments - a.forfeited)
            - a.current_balance AS DECIMAL(19, 4)
        ) AS variance,
        (
            SELECT MAX(t.created_at)
            FROM dbo.entitlement_transactions t
            WHERE t.account_id = a.id
        ) AS last_transaction_date
    FROM dbo.entitlement_accounts a
    INNER JOIN dbo.employees e ON e.id = a.employee_id
    WHERE a.company_id = @CompanyID
      AND a.fiscal_year = @FiscalYear
      AND a.entitlement_type_id = @EntitlementTypeID
      AND a.deleted_at IS NULL
      AND a.is_current = 1;
END;
GO

CREATE OR ALTER PROCEDURE airfare.sp_Entitlement_PeriodEndProcess
    @CompanyID NVARCHAR(36),
    @FiscalYear INT,
    @EntitlementTypeID NVARCHAR(36),
    @RunBy NVARCHAR(100),
    @CarryOverMax DECIMAL(18, 4) = 999999,
    @AccountsClosed INT OUTPUT,
    @TotalCarriedOver DECIMAL(18, 4) OUTPUT,
    @TotalForfeited DECIMAL(18, 4) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET @AccountsClosed = 0;
    SET @TotalCarriedOver = 0;
    SET @TotalForfeited = 0;

    DECLARE @Id NVARCHAR(36), @Emp UNIQUEIDENTIFIER, @Bal DECIMAL(18, 4);
    DECLARE @Carry DECIMAL(18, 4), @Forfeit DECIMAL(18, 4);
    DECLARE @Now DATETIME2 = SYSUTCDATETIME();
    DECLARE @NextYear INT = @FiscalYear + 1;
    DECLARE @NextStart DATE = DATEFROMPARTS(@NextYear, 1, 1);

    DECLARE c CURSOR LOCAL FAST_FORWARD FOR
        SELECT id, employee_id, current_balance
        FROM dbo.entitlement_accounts
        WHERE company_id = @CompanyID
          AND fiscal_year = @FiscalYear
          AND entitlement_type_id = @EntitlementTypeID
          AND status = N'open'
          AND deleted_at IS NULL;

    OPEN c;
    FETCH NEXT FROM c INTO @Id, @Emp, @Bal;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @Carry = CASE WHEN @Bal > @CarryOverMax THEN @CarryOverMax ELSE CASE WHEN @Bal > 0 THEN @Bal ELSE 0 END END;
        SET @Forfeit = CASE WHEN @Bal > @CarryOverMax THEN @Bal - @CarryOverMax ELSE 0 END;

        UPDATE dbo.entitlement_accounts
        SET carry_over = @Carry,
            forfeited = @Forfeit,
            current_balance = 0,
            status = N'closed',
            updated_at = @Now,
            updated_by = @RunBy
        WHERE id = @Id;

        IF @Carry > 0
            INSERT INTO dbo.entitlement_transactions (
                id, company_id, account_id, employee_id, txn_type, amount, source,
                effective_from, is_approved, is_exported, notes, created_at, created_by
            ) VALUES (
                CONVERT(NVARCHAR(36), NEWID()), @CompanyID, @Id, @Emp, N'CARRY_OVER', @Carry, N'PERIOD_END',
                @NextStart, 1, 0, N'Period-end carry over', @Now, @RunBy
            );

        IF @Forfeit > 0
            INSERT INTO dbo.entitlement_transactions (
                id, company_id, account_id, employee_id, txn_type, amount, source,
                effective_from, is_approved, is_exported, notes, created_at, created_by
            ) VALUES (
                CONVERT(NVARCHAR(36), NEWID()), @CompanyID, @Id, @Emp, N'FORFEITURE', @Forfeit, N'PERIOD_END',
                DATEFROMPARTS(@FiscalYear, 12, 31), 1, 0, N'Period-end forfeiture', @Now, @RunBy
            );

        IF NOT EXISTS (
            SELECT 1 FROM dbo.entitlement_accounts
            WHERE company_id = @CompanyID AND employee_id = @Emp
              AND entitlement_type_id = @EntitlementTypeID AND fiscal_year = @NextYear
              AND deleted_at IS NULL
        )
        BEGIN
            INSERT INTO dbo.entitlement_accounts (
                id, company_id, employee_id, entitlement_type_id, fiscal_year,
                opening_balance, accruals, used_amount, adjustments, carry_over, forfeited,
                current_balance, status, effective_from, effective_to, is_current, version,
                created_at, updated_at, created_by
            ) VALUES (
                CONVERT(NVARCHAR(36), NEWID()), @CompanyID, @Emp, @EntitlementTypeID, @NextYear,
                @Carry, 0, 0, 0, 0, 0,
                @Carry, N'open', @NextStart, N'9999-12-31', 1, 1,
                @Now, @Now, @RunBy
            );
        END

        SET @AccountsClosed += 1;
        SET @TotalCarriedOver += @Carry;
        SET @TotalForfeited += @Forfeit;
        FETCH NEXT FROM c INTO @Id, @Emp, @Bal;
    END
    CLOSE c; DEALLOCATE c;

    INSERT INTO dbo.entitlement_period_end (
        id, company_id, fiscal_year, entitlement_type_id,
        accounts_closed, total_carried_over, total_forfeited, run_by, created_at
    ) VALUES (
        CONVERT(NVARCHAR(36), NEWID()), @CompanyID, @FiscalYear, @EntitlementTypeID,
        @AccountsClosed, @TotalCarriedOver, @TotalForfeited, @RunBy, @Now
    );
END;
GO
