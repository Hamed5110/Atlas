/*
HCM Airfare MSSQL reporting and maintenance stored procedures.
Modular, parameterized, TRY/CATCH with RAISERROR codes 54xxx.
*/
SET NOCOUNT ON;
GO

CREATE OR ALTER PROCEDURE dbo.sp_generate_report
    @report_name NVARCHAR(50),
    @start_date DATE = NULL,
    @end_date DATE = NULL,
    @company_id UNIQUEIDENTIFIER = NULL,
    @repair_center NVARCHAR(100) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF @report_name NOT IN (
            N'employee_summary',
            N'ticket_ledger',
            N'loan_portfolio',
            N'monthly_spend',
            N'excess_recovery',
            N'preference_audit',
            N'ess_request_tracker',
            N'ai_anomaly_flags'
        )
        BEGIN
            RAISERROR(N'Unknown report name: %s', 16, 1, @report_name);
            RETURN;
        END;

        IF @report_name = N'employee_summary'
        BEGIN
            SELECT *
            FROM dbo.vw_employee_summary v
            WHERE (@company_id IS NULL OR EXISTS (
                SELECT 1 FROM dbo.employees e
                INNER JOIN dbo.companies c ON c.id = e.company_id
                WHERE e.id = v.employee_id AND c.id = CAST(@company_id AS nvarchar(36))
            ))
              AND (@repair_center IS NULL OR EXISTS (
                SELECT 1 FROM dbo.employees e
                WHERE e.id = v.employee_id AND e.repair_center = @repair_center
            ))
              AND (@start_date IS NULL OR v.date_of_joining >= @start_date)
              AND (@end_date IS NULL OR v.date_of_joining <= @end_date);
            RETURN;
        END;

        IF @report_name = N'ticket_ledger'
        BEGIN
            SELECT v.*
            FROM dbo.vw_ticket_ledger v
            INNER JOIN dbo.employees e ON e.code = v.employee_code AND e.deleted_at IS NULL
            WHERE (@start_date IS NULL OR v.travel_date >= @start_date)
              AND (@end_date IS NULL OR v.travel_date <= @end_date)
              AND (@company_id IS NULL OR e.company_id = CAST(@company_id AS nvarchar(36)))
              AND (@repair_center IS NULL OR e.repair_center = @repair_center);
            RETURN;
        END;

        IF @report_name = N'loan_portfolio'
        BEGIN
            SELECT v.*
            FROM dbo.vw_loan_portfolio v
            INNER JOIN dbo.employees e ON e.code = v.employee_code AND e.deleted_at IS NULL
            WHERE (@company_id IS NULL OR e.company_id = CAST(@company_id AS nvarchar(36)))
              AND (@repair_center IS NULL OR e.repair_center = @repair_center)
              AND (@start_date IS NULL OR v.first_due_date >= @start_date)
              AND (@end_date IS NULL OR v.first_due_date <= @end_date);
            RETURN;
        END;

        IF @report_name = N'monthly_spend'
        BEGIN
            SELECT *
            FROM dbo.vw_monthly_spend
            WHERE (@start_date IS NULL OR year_month >= FORMAT(@start_date, N'yyyy-MM'))
              AND (@end_date IS NULL OR year_month <= FORMAT(@end_date, N'yyyy-MM'));
            RETURN;
        END;

        IF @report_name = N'excess_recovery'
            SELECT * FROM dbo.vw_excess_recovery;
        ELSE IF @report_name = N'preference_audit'
            SELECT * FROM dbo.vw_preference_audit;
        ELSE IF @report_name = N'ess_request_tracker'
            SELECT * FROM dbo.vw_ess_request_tracker
            WHERE (@start_date IS NULL OR CAST(created_at AS date) >= @start_date)
              AND (@end_date IS NULL OR CAST(created_at AS date) <= @end_date);
        ELSE IF @report_name = N'ai_anomaly_flags'
            SELECT * FROM dbo.vw_ai_anomaly_flags
            WHERE (@start_date IS NULL OR CAST(flagged_at AS date) >= @start_date)
              AND (@end_date IS NULL OR CAST(flagged_at AS date) <= @end_date);
    END TRY
    BEGIN CATCH
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(N'sp_generate_report failed: %s', 16, 1, @msg);
    END CATCH
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_export_report_excel
    @report_name NVARCHAR(50),
    @start_date DATE = NULL,
    @end_date DATE = NULL,
    @company_id UNIQUEIDENTIFIER = NULL,
    @repair_center NVARCHAR(100) = NULL,
    @file_path NVARCHAR(500) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF @file_path IS NOT NULL AND LEN(@file_path) > 0
            RAISERROR(N'File export is handled by the Python layer for formula-injection protection.', 10, 1);

        EXEC dbo.sp_generate_report
            @report_name = @report_name,
            @start_date = @start_date,
            @end_date = @end_date,
            @company_id = @company_id,
            @repair_center = @repair_center;
    END TRY
    BEGIN CATCH
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(N'sp_export_report_excel failed: %s', 16, 1, @msg);
    END CATCH
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_backup_logical_json
    @tables NVARCHAR(MAX) = N'all'
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        DECLARE @table_name NVARCHAR(128);
        DECLARE @sql NVARCHAR(MAX);

        DECLARE table_cursor CURSOR LOCAL FAST_FORWARD FOR
        SELECT value
        FROM STRING_SPLIT(
            CASE WHEN @tables = N'all' THEN
                N'companies,users,employees,opening_balances,tickets,loans,loan_payments,loan_installments,preferences,ess_requests,entitlement_rates,lookups,attachments'
            ELSE @tables END,
            N','
        );

        OPEN table_cursor;
        FETCH NEXT FROM table_cursor INTO @table_name;
        WHILE @@FETCH_STATUS = 0
        BEGIN
            SET @table_name = LTRIM(RTRIM(@table_name));
            IF OBJECT_ID(N'dbo.' + @table_name, N'U') IS NOT NULL
            BEGIN
                SET @sql = N'SELECT @table_name AS table_name, (SELECT * FROM dbo.' + QUOTENAME(@table_name)
                    + N' FOR JSON AUTO) AS json_payload';
                EXEC sp_executesql @sql, N'@table_name NVARCHAR(128)', @table_name = @table_name;
            END;
            FETCH NEXT FROM table_cursor INTO @table_name;
        END;
        CLOSE table_cursor;
        DEALLOCATE table_cursor;
    END TRY
    BEGIN CATCH
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(N'sp_backup_logical_json failed: %s', 16, 1, @msg);
    END CATCH
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_restore_logical_json
    @table_name NVARCHAR(100),
    @json_data NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF ISJSON(@json_data) <> 1
            RAISERROR(N'Restore payload must be valid JSON.', 16, 1);

        IF @table_name NOT IN (
            N'companies', N'employees', N'users', N'opening_balances', N'tickets',
            N'loans', N'loan_payments', N'loan_installments', N'preferences',
            N'ess_requests', N'entitlement_rates', N'lookups', N'attachments'
        )
            RAISERROR(N'Unsupported restore table: %s', 16, 1, @table_name);

        RAISERROR(
            N'sp_restore_logical_json requires table-specific MERGE scripts; use the Python logical restore API.',
            16,
            1
        );
    END TRY
    BEGIN CATCH
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(N'sp_restore_logical_json failed: %s', 16, 1, @msg);
    END CATCH
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_recalculate_loan_schedule
    @loan_id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @loan_key NVARCHAR(36) = CAST(@loan_id AS NVARCHAR(36));
        DECLARE @outstanding DECIMAL(19, 4);
        DECLARE @rate DECIMAL(9, 6);
        DECLARE @installments INT;
        DECLARE @first_due DATE;

        SELECT
            @outstanding = outstanding,
            @rate = annual_rate,
            @installments = installments,
            @first_due = first_due_date
        FROM dbo.loans
        WHERE id = @loan_key
          AND deleted_at IS NULL
          AND status IN (N'active', N'deferred');

        IF @outstanding IS NULL
            RAISERROR(N'Active loan not found: %s', 16, 1, @loan_key);

        UPDATE dbo.loan_installments
        SET deleted_at = GETUTCDATE(),
            version = version + 1
        WHERE loan_id = @loan_key
          AND deleted_at IS NULL;

        DECLARE @i INT = 1;
        DECLARE @balance DECIMAL(19, 4) = @outstanding;
        DECLARE @monthly DECIMAL(19, 4);
        DECLARE @due DATE = @first_due;

        IF @rate = 0
            SET @monthly = ROUND(@outstanding / NULLIF(@installments, 0), 2);
        ELSE
        BEGIN
            DECLARE @factor DECIMAL(19, 10) = POWER(1 + (@rate / 12.0), @installments);
            SET @monthly = ROUND(@outstanding * (@rate / 12.0) * @factor / NULLIF(@factor - 1, 0), 2);
        END;

        WHILE @i <= @installments AND @balance > 0
        BEGIN
            DECLARE @interest DECIMAL(19, 4) = ROUND(@balance * (@rate / 12.0), 2);
            DECLARE @principal DECIMAL(19, 4) = CASE
                WHEN @i = @installments THEN @balance
                ELSE ROUND(@monthly - @interest, 2)
            END;
            DECLARE @payment DECIMAL(19, 4) = @principal + @interest;
            DECLARE @closing DECIMAL(19, 4) = @balance - @principal;

            INSERT INTO dbo.loan_installments (
                id, loan_id, number, due_date, opening_balance, principal, interest, payment, closing_balance,
                created_at, updated_at, version
            )
            VALUES (
                NEWID(), @loan_key, @i, @due, @balance, @principal, @interest, @payment, @closing,
                GETUTCDATE(), GETUTCDATE(), 1
            );

            SET @balance = @closing;
            SET @i += 1;
            SET @due = DATEADD(MONTH, 1, @due);
        END;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(N'sp_recalculate_loan_schedule failed: %s', 16, 1, @msg);
    END CATCH
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_post_loan_payment
    @loan_id UNIQUEIDENTIFIER,
    @amount DECIMAL(18, 2),
    @payment_date DATE,
    @posted_by UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @loan_key NVARCHAR(36) = CAST(@loan_id AS NVARCHAR(36));
        DECLARE @status NVARCHAR(20);
        DECLARE @outstanding DECIMAL(19, 4);

        SELECT @status = status, @outstanding = outstanding
        FROM dbo.loans WITH (UPDLOCK)
        WHERE id = @loan_key AND deleted_at IS NULL;

        IF @status <> N'active'
            RAISERROR(N'Loan is not active (status=%s).', 16, 1, @status);

        IF @amount <= 0
            RAISERROR(N'Payment amount must be positive.', 16, 1);

        INSERT INTO dbo.loan_payments (
            id, loan_id, amount, paid_on, reference, created_at, updated_at, created_by, version
        )
        VALUES (
            NEWID(), @loan_key, @amount, @payment_date, N'SP payment', GETUTCDATE(), GETUTCDATE(),
            CAST(@posted_by AS NVARCHAR(36)), 1
        );

        SET @outstanding = @outstanding - @amount;
        UPDATE dbo.loans
        SET outstanding = CASE WHEN @outstanding < 0 THEN 0 ELSE @outstanding END,
            status = CASE WHEN @outstanding <= 0 THEN N'settled' ELSE status END,
            updated_at = GETUTCDATE(),
            updated_by = CAST(@posted_by AS NVARCHAR(36)),
            version = version + 1
        WHERE id = @loan_key;

        IF @outstanding > 0
            EXEC dbo.sp_recalculate_loan_schedule @loan_id = @loan_id;

        SELECT
            outstanding = (SELECT outstanding FROM dbo.loans WHERE id = @loan_key),
            next_due_date = (
                SELECT MIN(due_date)
                FROM dbo.loan_installments
                WHERE loan_id = @loan_key AND deleted_at IS NULL AND due_date >= @payment_date
            );

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(N'sp_post_loan_payment failed: %s', 16, 1, @msg);
    END CATCH
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_employee_soft_delete_cascade
    @employee_id UNIQUEIDENTIFIER,
    @deleted_by UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @emp_key UNIQUEIDENTIFIER = @employee_id;
        DECLARE @now DATETIME2 = GETUTCDATE();
        DECLARE @actor NVARCHAR(36) = CAST(@deleted_by AS NVARCHAR(36));

        IF NOT EXISTS (
            SELECT 1 FROM dbo.employees
            WHERE id = @emp_key AND deleted_at IS NULL
        )
            RAISERROR(N'Active employee not found for soft delete.', 16, 1);

        UPDATE dbo.employees
        SET deleted_at = @now,
            active = 0,
            updated_at = @now,
            updated_by = @actor,
            version = version + 1
        WHERE id = @emp_key;

        UPDATE dbo.tickets
        SET deleted_at = @now, updated_at = @now, updated_by = @actor, version = version + 1
        WHERE employee_id = @emp_key AND deleted_at IS NULL;

        UPDATE dbo.loans
        SET deleted_at = @now, updated_at = @now, updated_by = @actor, version = version + 1
        WHERE employee_id = @emp_key AND deleted_at IS NULL;

        UPDATE dbo.opening_balances
        SET deleted_at = @now, updated_at = @now, updated_by = @actor, version = version + 1
        WHERE employee_id = @emp_key AND deleted_at IS NULL;

        UPDATE dbo.ess_requests
        SET deleted_at = @now, updated_at = @now, updated_by = @actor, version = version + 1
        WHERE employee_id = @emp_key AND deleted_at IS NULL;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(N'sp_employee_soft_delete_cascade failed: %s', 16, 1, @msg);
    END CATCH
END;
GO
