/*
Optional reporting views for Atlas Aluminum entitlement status.
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;
GO

IF OBJECT_ID(N'airfare.vw_HCM_EmployeeEntitlementStatus', N'V') IS NOT NULL
    DROP VIEW airfare.vw_HCM_EmployeeEntitlementStatus;
GO

CREATE VIEW airfare.vw_HCM_EmployeeEntitlementStatus
AS
SELECT
    e.id AS employee_id,
    e.code,
    e.full_name,
    e.join_date,
    e.pay_group,
    e.custom_airfare_rate,
    e.max_entitlement_cap_rate,
    e.active,
    ob.balance_year,
    ob.opening_days,
    ob.opening_amount,
    ob.paid_days,
    (
        SELECT TOP (1) t.travel_date
        FROM dbo.tickets t
        WHERE t.employee_id = e.id
          AND t.deleted_at IS NULL
          AND t.status IN (N'approved', N'paid', N'issued')
        ORDER BY t.travel_date DESC
    ) AS last_ticket_date
FROM dbo.employees e
LEFT JOIN dbo.opening_balances ob
    ON ob.employee_id = e.id
   AND ob.deleted_at IS NULL
   AND ob.balance_year = YEAR(GETDATE())
WHERE e.deleted_at IS NULL;
GO
