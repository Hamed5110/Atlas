/*
sp_HCM_CalculateEntitlement — parity with calculate_allocation_entitlement().
Also provides employee-id loader that hydrates opening balances / last ticket.
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;
GO

IF OBJECT_ID(N'airfare.sp_HCM_CalculateEntitlement', N'P') IS NOT NULL
    DROP PROCEDURE airfare.sp_HCM_CalculateEntitlement;
GO

CREATE PROCEDURE airfare.sp_HCM_CalculateEntitlement
    @AsOfDate DATE,
    @DateOfJoining DATE,
    @LastTicketDate DATE = NULL,
    @OpeningBalanceDays DECIMAL(18, 4) = 0,
    @OpeningBalanceAmount DECIMAL(19, 4) = 0,
    @AirfareRate DECIMAL(19, 4),
    @RateSource NVARCHAR(20) = N'global',
    @MaxEntitlementCapRate DECIMAL(19, 4) = NULL,
    @PaidDays DECIMAL(18, 4) = 0,
    @CurrentYearSpending DECIMAL(19, 4) = 0
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @CycleDays DECIMAL(18, 4) = 60;
    DECLARE @MaxPayout DECIMAL(19, 4);
    DECLARE @PreviousTicket DATE = @LastTicketDate;
    DECLARE @CapRate DECIMAL(19, 4);
    DECLARE @PerDay DECIMAL(19, 10);
    DECLARE @WorkingDays INT;
    DECLARE @AccruedDays DECIMAL(18, 4);
    DECLARE @OpeningAmountUsed DECIMAL(19, 4);
    DECLARE @CurrentYearAmount DECIMAL(19, 4);
    DECLARE @Total DECIMAL(19, 4);
    DECLARE @PaidAmount DECIMAL(19, 4);
    DECLARE @Policy DECIMAL(19, 4);
    DECLARE @RemainingDays DECIMAL(18, 4);
    DECLARE @Final DECIMAL(19, 4);
    DECLARE @AlreadyPaidDays DECIMAL(18, 4);
    DECLARE @CurrentYearRemaining DECIMAL(19, 4);
    DECLARE @TotalAvailableFunds DECIMAL(19, 4);
    DECLARE @Scenario NVARCHAR(40);
    DECLARE @AccrualStart DATE;
    DECLARE @YearStart DATE;

    IF @OpeningBalanceDays < 0 OR @OpeningBalanceAmount < 0 OR @PaidDays < 0 OR @CurrentYearSpending < 0
    BEGIN
        RAISERROR(N'Opening balance values cannot be negative.', 16, 1);
        RETURN;
    END;
    IF @AirfareRate < 0
    BEGIN
        RAISERROR(N'Airfare rate cannot be negative.', 16, 1);
        RETURN;
    END;
    IF @MaxEntitlementCapRate IS NOT NULL AND @MaxEntitlementCapRate < 0
    BEGIN
        RAISERROR(N'Entitlement cap cannot be negative.', 16, 1);
        RETURN;
    END;

    SET @MaxPayout = CASE WHEN @AirfareRate <= 0 THEN 150 ELSE @AirfareRate END;

    -- Ignore prior-year tickets (Python parity).
    IF @PreviousTicket IS NOT NULL AND YEAR(@PreviousTicket) <> YEAR(@AsOfDate)
        SET @PreviousTicket = NULL;

    SET @CapRate = CASE WHEN @MaxEntitlementCapRate IS NULL THEN @MaxPayout ELSE @MaxEntitlementCapRate END;
    SET @PerDay = @MaxPayout / @CycleDays;

    SET @WorkingDays = airfare.fn_HCM_WorkingDays30360(
        @AsOfDate,
        YEAR(@AsOfDate),
        @DateOfJoining,
        @PreviousTicket
    );

    SET @AccruedDays = CAST(ROUND((CAST(@WorkingDays AS DECIMAL(18, 4)) / 30.0) * 2.5, 4) AS DECIMAL(18, 4));

    SET @OpeningAmountUsed = @OpeningBalanceAmount;
    IF @OpeningAmountUsed = 0 AND @OpeningBalanceDays > 0
        SET @OpeningAmountUsed = airfare.fn_HCM_AirfareAmountFromDays(@OpeningBalanceDays, @MaxPayout);

    SET @CurrentYearAmount = CAST(ROUND(@PerDay * @AccruedDays, 2) AS DECIMAL(19, 4));
    SET @Total = CAST(ROUND(@OpeningAmountUsed + @CurrentYearAmount, 2) AS DECIMAL(19, 4));
    IF @Total > @MaxPayout
        SET @Total = CAST(ROUND(@MaxPayout, 2) AS DECIMAL(19, 4));

    SET @PaidAmount = CAST(ROUND(@PaidDays * @PerDay, 2) AS DECIMAL(19, 4))
                    + CAST(ROUND(@CurrentYearSpending, 2) AS DECIMAL(19, 4));
    SET @Policy = CAST(ROUND(@Total - @PaidAmount, 2) AS DECIMAL(19, 4));
    IF @Policy < 0 SET @Policy = 0;

    IF @PerDay > 0
        SET @RemainingDays = CAST(ROUND(@Policy / @PerDay, 4) AS DECIMAL(18, 4));
    ELSE
        SET @RemainingDays = 0;
    IF @RemainingDays < 0 SET @RemainingDays = 0;
    IF @RemainingDays > @CycleDays SET @RemainingDays = @CycleDays;

    SET @Final = CAST(ROUND(CASE WHEN @Policy < @CapRate THEN @Policy ELSE @CapRate END, 2) AS DECIMAL(19, 4));

    IF @PerDay > 0
        SET @AlreadyPaidDays = CAST(ROUND(@PaidAmount / @PerDay, 4) AS DECIMAL(18, 4));
    ELSE
        SET @AlreadyPaidDays = 0;

    SET @CurrentYearRemaining = CAST(ROUND(@MaxPayout - CAST(ROUND(@CurrentYearSpending, 2) AS DECIMAL(19, 4)), 2) AS DECIMAL(19, 4));
    IF @CurrentYearRemaining < 0 SET @CurrentYearRemaining = 0;

    SET @TotalAvailableFunds = CAST(ROUND(
        CAST(ROUND(@OpeningBalanceAmount, 2) AS DECIMAL(19, 4)) + @CurrentYearRemaining, 2
    ) AS DECIMAL(19, 4));

    IF @PreviousTicket IS NOT NULL
        SET @Scenario = N'previous_ticket';
    ELSE IF YEAR(@DateOfJoining) = YEAR(@AsOfDate)
        SET @Scenario = N'new_joinee';
    ELSE
        SET @Scenario = N'opening_balance_accrual';

    SET @YearStart = DATEFROMPARTS(YEAR(@AsOfDate), 1, 1);
    SET @AccrualStart = @YearStart;
    IF @DateOfJoining > @AccrualStart SET @AccrualStart = @DateOfJoining;
    IF @PreviousTicket IS NOT NULL AND DATEADD(DAY, 1, @PreviousTicket) > @AccrualStart
        SET @AccrualStart = DATEADD(DAY, 1, @PreviousTicket);

    SELECT
        @Scenario AS scenario,
        @AccrualStart AS accrual_start,
        @AccruedDays AS accrued_days,
        @PerDay AS daily_rate,
        @MaxPayout AS airfare_rate,
        @RateSource AS rate_source,
        @CycleDays AS rate_days,
        @Policy AS calculated_entitlement_amount,
        @CurrentYearAmount AS current_year_amount,
        @RemainingDays AS total_entitlement_days,
        @OpeningBalanceDays AS opening_balance_days,
        @OpeningAmountUsed AS opening_balance_amount,
        @Final AS final_entitlement_amount,
        @MaxEntitlementCapRate AS max_entitlement_cap_rate,
        @PreviousTicket AS last_ticket_date,
        @AlreadyPaidDays AS already_paid_days,
        @PaidAmount AS already_paid_amount,
        @CurrentYearRemaining AS current_year_remaining,
        @TotalAvailableFunds AS total_available_funds,
        @WorkingDays AS working_days;
END;
GO

IF OBJECT_ID(N'airfare.sp_HCM_CalculateEntitlementForEmployee', N'P') IS NOT NULL
    DROP PROCEDURE airfare.sp_HCM_CalculateEntitlementForEmployee;
GO

CREATE PROCEDURE airfare.sp_HCM_CalculateEntitlementForEmployee
    @EmployeeId UNIQUEIDENTIFIER,
    @AsOfDate DATE = NULL,
    @RequestedTicketAmount DECIMAL(19, 4) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @AsOfDate IS NULL SET @AsOfDate = CAST(GETDATE() AS DATE);

    DECLARE @JoinDate DATE;
    DECLARE @CustomRate DECIMAL(19, 4);
    DECLARE @CapRate DECIMAL(19, 4);
    DECLARE @PayGroup NVARCHAR(100);
    DECLARE @OpeningDays DECIMAL(18, 4) = 0;
    DECLARE @OpeningAmount DECIMAL(19, 4) = 0;
    DECLARE @PaidDays DECIMAL(18, 4) = 0;
    DECLARE @PrevTicket DATE = NULL;
    DECLARE @GlobalRate DECIMAL(19, 4) = 150;
    DECLARE @PayGroupRate DECIMAL(19, 4) = NULL;
    DECLARE @CompanyRate DECIMAL(19, 4) = NULL;
    DECLARE @AirfareRate DECIMAL(19, 4);
    DECLARE @RateSource NVARCHAR(20);
    DECLARE @Spending DECIMAL(19, 4) = 0;

    SELECT
        @JoinDate = e.join_date,
        @CustomRate = e.custom_airfare_rate,
        @CapRate = e.max_entitlement_cap_rate,
        @PayGroup = e.pay_group
    FROM dbo.employees e
    WHERE e.id = @EmployeeId AND e.deleted_at IS NULL;

    IF @JoinDate IS NULL
    BEGIN
        RAISERROR(N'Employee not found or soft-deleted.', 16, 1);
        RETURN;
    END;

    SELECT TOP (1)
        @OpeningDays = ISNULL(ob.opening_days, 0),
        @OpeningAmount = ISNULL(ob.opening_amount, 0),
        @PaidDays = ISNULL(ob.paid_days, 0)
    FROM dbo.opening_balances ob
    WHERE ob.employee_id = @EmployeeId
      AND ob.balance_year = YEAR(@AsOfDate)
      AND ob.deleted_at IS NULL
    ORDER BY ob.created_at DESC;

    SELECT TOP (1) @PrevTicket = t.travel_date
    FROM dbo.tickets t
    WHERE t.employee_id = @EmployeeId
      AND t.deleted_at IS NULL
      AND t.status IN (N'approved', N'paid', N'issued')
      AND t.travel_date IS NOT NULL
      AND t.travel_date <= @AsOfDate
      AND YEAR(t.travel_date) = YEAR(@AsOfDate)
    ORDER BY t.travel_date DESC;

    SELECT @Spending = ISNULL(SUM(t.company_paid), 0)
    FROM dbo.tickets t
    WHERE t.employee_id = @EmployeeId
      AND t.deleted_at IS NULL
      AND t.status IN (N'approved', N'paid', N'issued')
      AND t.travel_date IS NOT NULL
      AND YEAR(t.travel_date) = YEAR(@AsOfDate);

    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = N'preferences')
    BEGIN
        SELECT TOP (1)
            @GlobalRate = TRY_CONVERT(
                DECIMAL(19, 4),
                REPLACE(REPLACE(CONVERT(NVARCHAR(100), p.[value]), N'"', N''), N'''', N'')
            )
        FROM dbo.preferences p
        WHERE p.scope_type = N'global'
          AND p.scope_id = N''
          AND p.preference_key = N'global_company_preference_rate'
          AND p.deleted_at IS NULL
        ORDER BY p.updated_at DESC;

        IF @GlobalRate IS NULL OR @GlobalRate <= 0 SET @GlobalRate = 150;
    END;

    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = N'entitlement_rates')
       AND NULLIF(LTRIM(RTRIM(@PayGroup)), N'') IS NOT NULL
    BEGIN
        SELECT TOP (1) @PayGroupRate = er.amount
        FROM dbo.entitlement_rates er
        WHERE er.deleted_at IS NULL
          AND er.scope_type = N'pay_group'
          AND er.scope_id = @PayGroup
          AND er.effective_from <= @AsOfDate
          AND (er.effective_to IS NULL OR er.effective_to >= @AsOfDate)
        ORDER BY er.effective_from DESC;
    END;

    IF @CustomRate IS NOT NULL
    BEGIN
        SET @AirfareRate = @CustomRate;
        SET @RateSource = N'employee';
    END
    ELSE IF @PayGroupRate IS NOT NULL
    BEGIN
        SET @AirfareRate = @PayGroupRate;
        SET @RateSource = N'pay_group';
    END
    ELSE IF @CompanyRate IS NOT NULL
    BEGIN
        SET @AirfareRate = @CompanyRate;
        SET @RateSource = N'company';
    END
    ELSE
    BEGIN
        SET @AirfareRate = @GlobalRate;
        SET @RateSource = N'global';
    END;

    EXEC airfare.sp_HCM_CalculateEntitlement
        @AsOfDate = @AsOfDate,
        @DateOfJoining = @JoinDate,
        @LastTicketDate = @PrevTicket,
        @OpeningBalanceDays = @OpeningDays,
        @OpeningBalanceAmount = @OpeningAmount,
        @AirfareRate = @AirfareRate,
        @RateSource = @RateSource,
        @MaxEntitlementCapRate = @CapRate,
        @PaidDays = @PaidDays,
        @CurrentYearSpending = @Spending;
END;
GO
