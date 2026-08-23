/*
HCM Airfare MSSQL reporting views (SQL Server 2022).
Read-only projections for dashboards, exports, and sp_generate_report.
All joined rows exclude soft-deleted records (deleted_at IS NULL).
*/
SET NOCOUNT ON;
GO

CREATE OR ALTER VIEW dbo.vw_employee_summary AS
SELECT
    e.id AS employee_id,
    e.code,
    e.full_name,
    c.code AS company_code,
    c.name AS company_name,
    e.designation,
    e.repair_center,
    e.pay_group,
    e.nationality,
    e.sub_section,
    ro.display_name AS reporting_officer_name,
    e.join_date AS date_of_joining,
    DATEDIFF(MONTH, e.join_date, CAST(GETUTCDATE() AS date)) AS tenure_months,
    CASE WHEN e.active = 1 THEN N'active' ELSE N'inactive' END AS status,
    ISNULL(tc.total_tickets, 0) AS total_tickets,
    ISNULL(lc.total_loans, 0) AS total_loans,
    ISNULL(lc.outstanding_loan_amount, CAST(0 AS decimal(19, 4))) AS outstanding_loan_amount,
    tc.last_ticket_date,
    ISNULL(ob.opening_days, CAST(0 AS decimal(10, 4))) AS opening_balance_days,
    ISNULL(ob.opening_amount, CAST(0 AS decimal(19, 4))) AS opening_balance_amount
FROM dbo.employees e
INNER JOIN dbo.companies c
    ON c.id = e.company_id
   AND c.deleted_at IS NULL
LEFT JOIN dbo.users ro
    ON ro.id = e.reporting_officer_id
   AND ro.deleted_at IS NULL
OUTER APPLY (
    SELECT TOP (1)
        ob.opening_days,
        ob.opening_amount
    FROM dbo.opening_balances ob
    WHERE ob.employee_id = e.id
      AND ob.deleted_at IS NULL
    ORDER BY ob.balance_year DESC
) ob
OUTER APPLY (
    SELECT
        COUNT(*) AS total_tickets,
        MAX(t.travel_date) AS last_ticket_date
    FROM dbo.tickets t
    WHERE t.employee_id = e.id
      AND t.deleted_at IS NULL
) tc
OUTER APPLY (
    SELECT
        COUNT(*) AS total_loans,
        SUM(l.outstanding) AS outstanding_loan_amount
    FROM dbo.loans l
    WHERE l.employee_id = e.id
      AND l.deleted_at IS NULL
) lc
WHERE e.deleted_at IS NULL;
GO

CREATE OR ALTER VIEW dbo.vw_ticket_ledger AS
SELECT
    t.id AS ticket_id,
    e.code AS employee_code,
    e.full_name AS employee_name,
    c.name AS company,
    t.destination_code AS destination,
    t.travel_date,
    t.ticket_cost,
    t.company_paid,
    t.employee_payable,
    CASE
        WHEN t.company_paid > t.entitlement THEN t.company_paid - t.entitlement
        ELSE CAST(0 AS decimal(19, 4))
    END AS excess_amount,
    t.status,
    CASE WHEN t.status IN (N'approved', N'paid', N'settled') THEN CAST(t.updated_at AS date) END AS approval_date,
    approver.display_name AS approver_name,
    l.id AS loan_id,
    t.created_at
FROM dbo.tickets t
INNER JOIN dbo.employees e
    ON e.id = t.employee_id
   AND e.deleted_at IS NULL
INNER JOIN dbo.companies c
    ON c.id = e.company_id
   AND c.deleted_at IS NULL
LEFT JOIN dbo.users approver
    ON approver.id = t.updated_by
   AND approver.deleted_at IS NULL
LEFT JOIN dbo.loans l
    ON l.source_ticket_id = t.id
   AND l.deleted_at IS NULL
   AND t.excess_handling = N'CONVERT_TO_LOAN'
WHERE t.deleted_at IS NULL;
GO

CREATE OR ALTER VIEW dbo.vw_loan_portfolio AS
SELECT
    l.id AS loan_id,
    e.code AS employee_code,
    e.full_name AS employee_name,
    l.principal,
    l.outstanding,
    l.annual_rate,
    l.installments,
    l.monthly_installment AS installment_amount,
    l.first_due_date,
    nd.next_due_date,
    l.status,
    l.deferred_until,
    ISNULL(pay.total_paid, CAST(0 AS decimal(19, 4))) AS total_paid,
    ISNULL(pay.total_interest_paid, CAST(0 AS decimal(19, 4))) AS total_interest_paid,
    CAST(NULL AS decimal(9, 4)) AS risk_score,
    CASE
        WHEN l.status = N'active'
         AND nd.next_due_date IS NOT NULL
         AND nd.next_due_date < CAST(GETUTCDATE() AS date)
        THEN DATEDIFF(DAY, nd.next_due_date, CAST(GETUTCDATE() AS date))
        ELSE 0
    END AS days_overdue
FROM dbo.loans l
INNER JOIN dbo.employees e
    ON e.id = l.employee_id
   AND e.deleted_at IS NULL
OUTER APPLY (
    SELECT MIN(li.due_date) AS next_due_date
    FROM dbo.loan_installments li
    WHERE li.loan_id = l.id
      AND li.deleted_at IS NULL
      AND li.due_date >= CAST(GETUTCDATE() AS date)
) nd
OUTER APPLY (
    SELECT
        SUM(lp.amount) AS total_paid,
        SUM(CAST(0 AS decimal(19, 4))) AS total_interest_paid
    FROM dbo.loan_payments lp
    WHERE lp.loan_id = l.id
      AND lp.deleted_at IS NULL
) pay
WHERE l.deleted_at IS NULL;
GO

CREATE OR ALTER VIEW dbo.vw_monthly_spend AS
SELECT
    FORMAT(spend.travel_date, N'yyyy-MM') AS year_month,
    SUM(spend.ticket_cost) AS total_ticket_cost,
    SUM(spend.company_paid) AS total_company_paid,
    SUM(spend.employee_payable) AS total_employee_payable,
    SUM(spend.excess_amount) AS total_excess,
    SUM(spend.ticket_count) AS ticket_count,
    SUM(spend.loan_disbursements) AS loan_disbursements,
    SUM(spend.loan_repayments) AS loan_repayments
FROM (
    SELECT
        t.travel_date,
        t.ticket_cost,
        t.company_paid,
        t.employee_payable,
        CASE
            WHEN t.company_paid > t.entitlement THEN t.company_paid - t.entitlement
            ELSE CAST(0 AS decimal(19, 4))
        END AS excess_amount,
        CAST(1 AS bigint) AS ticket_count,
        CAST(0 AS decimal(19, 4)) AS loan_disbursements,
        CAST(0 AS decimal(19, 4)) AS loan_repayments
    FROM dbo.tickets t
    WHERE t.deleted_at IS NULL
    UNION ALL
    SELECT
        CAST(l.created_at AS date) AS travel_date,
        CAST(0 AS decimal(19, 4)),
        CAST(0 AS decimal(19, 4)),
        CAST(0 AS decimal(19, 4)),
        CAST(0 AS decimal(19, 4)),
        CAST(0 AS bigint),
        l.principal AS loan_disbursements,
        CAST(0 AS decimal(19, 4)) AS loan_repayments
    FROM dbo.loans l
    WHERE l.deleted_at IS NULL
    UNION ALL
    SELECT
        lp.paid_on AS travel_date,
        CAST(0 AS decimal(19, 4)),
        CAST(0 AS decimal(19, 4)),
        CAST(0 AS decimal(19, 4)),
        CAST(0 AS decimal(19, 4)),
        CAST(0 AS bigint),
        CAST(0 AS decimal(19, 4)),
        lp.amount AS loan_repayments
    FROM dbo.loan_payments lp
    WHERE lp.deleted_at IS NULL
) spend
GROUP BY FORMAT(spend.travel_date, N'yyyy-MM');
GO

CREATE OR ALTER VIEW dbo.vw_excess_recovery AS
SELECT
    e.code AS employee_code,
    e.full_name AS employee_name,
    t.id AS ticket_id,
    t.company_paid - t.entitlement AS excess_amount,
    CASE
        WHEN l.id IS NOT NULL AND l.status = N'active' THEN N'loan_recovery'
        WHEN t.status = N'settled' THEN N'recovered'
        ELSE N'outstanding'
    END AS recovery_status,
    l.id AS loan_id,
    CASE
        WHEN l.id IS NULL THEN NULL
        ELSE (
            SELECT COUNT(*)
            FROM dbo.loan_installments li
            WHERE li.loan_id = l.id
              AND li.deleted_at IS NULL
              AND li.due_date >= CAST(GETUTCDATE() AS date)
        )
    END AS installments_remaining,
    ISNULL(recovered.total_recovered, CAST(0 AS decimal(19, 4))) AS total_recovered,
    CASE
        WHEN l.id IS NOT NULL THEN l.outstanding
        ELSE CASE
            WHEN t.company_paid > t.entitlement THEN t.company_paid - t.entitlement
            ELSE CAST(0 AS decimal(19, 4))
        END
    END AS balance_due
FROM dbo.tickets t
INNER JOIN dbo.employees e
    ON e.id = t.employee_id
   AND e.deleted_at IS NULL
LEFT JOIN dbo.loans l
    ON l.source_ticket_id = t.id
   AND l.deleted_at IS NULL
OUTER APPLY (
    SELECT SUM(lp.amount) AS total_recovered
    FROM dbo.loan_payments lp
    WHERE lp.loan_id = l.id
      AND lp.deleted_at IS NULL
) recovered
WHERE t.deleted_at IS NULL
  AND t.company_paid > t.entitlement;
GO

CREATE OR ALTER VIEW dbo.vw_preference_audit AS
SELECT
    p.id AS preference_id,
    p.scope_type AS scope,
    CASE
        WHEN p.scope_type = N'global' THEN N'Global'
        WHEN p.scope_type = N'repair_center' THEN p.scope_id
        WHEN p.scope_type = N'pay_group' THEN p.scope_id
        WHEN p.scope_type = N'user' THEN u.display_name
        ELSE p.scope_id
    END AS entity_name,
    p.preference_key AS [key],
    p.value,
    CAST(p.created_at AS date) AS effective_from,
    CAST(NULL AS date) AS effective_to,
    editor.display_name AS overridden_by,
    p.is_locked
FROM dbo.preferences p
LEFT JOIN dbo.users u
    ON p.scope_type = N'user'
   AND u.id = p.scope_id
   AND u.deleted_at IS NULL
LEFT JOIN dbo.users editor
    ON editor.id = p.updated_by
   AND editor.deleted_at IS NULL
WHERE p.deleted_at IS NULL;
GO

CREATE OR ALTER VIEW dbo.vw_ess_request_tracker AS
SELECT
    r.id AS request_id,
    e.code AS employee_code,
    e.full_name AS employee_name,
    r.request_type AS type,
    r.notes AS description,
    CAST(NULL AS decimal(9, 4)) AS sentiment_score,
    CAST(0 AS bit) AS urgency_flag,
    r.status,
    CAST(NULL AS nvarchar(200)) AS assigned_to,
    r.created_at,
    CASE
        WHEN r.status IN (N'closed', N'approved', N'rejected', N'cancelled') THEN r.updated_at
    END AS resolved_at,
    DATEDIFF(
        DAY,
        CAST(r.created_at AS date),
        CAST(COALESCE(
            CASE WHEN r.status IN (N'closed', N'approved', N'rejected', N'cancelled') THEN r.updated_at END,
            GETUTCDATE()
        ) AS date)
    ) AS days_open
FROM dbo.ess_requests r
INNER JOIN dbo.employees e
    ON e.id = r.employee_id
   AND e.deleted_at IS NULL
WHERE r.deleted_at IS NULL;
GO

CREATE OR ALTER VIEW dbo.vw_ai_anomaly_flags AS
SELECT
    N'ticket' AS entity_type,
    t.id AS entity_id,
    e.code AS employee_code,
    CAST(
        CASE
            WHEN t.entitlement > 0
            THEN (t.ticket_cost / NULLIF(t.entitlement, 0)) * 100
            ELSE 100
        END AS decimal(9, 4)
    ) AS anomaly_score,
    N'ticket_cost_ratio' AS feature_name,
    t.ticket_cost AS feature_value,
    t.entitlement AS expected_range_min,
    t.entitlement * CAST(1.25 AS decimal(19, 4)) AS expected_range_max,
    t.updated_at AS flagged_at
FROM dbo.tickets t
INNER JOIN dbo.employees e
    ON e.id = t.employee_id
   AND e.deleted_at IS NULL
WHERE t.deleted_at IS NULL
  AND t.ticket_cost > t.entitlement * CAST(1.25 AS decimal(19, 4));
GO
