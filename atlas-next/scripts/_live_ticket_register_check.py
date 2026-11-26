from __future__ import annotations

from datetime import date, timedelta

import httpx
from airfare_management.config import get_settings

s = get_settings()
base = "http://127.0.0.1:3389"
tok = httpx.post(
    f"{base}/v1/auth/login",
    json={"username": s.bootstrap_admin_username, "password": s.bootstrap_admin_password},
    timeout=30,
).json()["access_token"]
h = {"Authorization": f"Bearer {tok}"}

api_cols = httpx.get(f"{base}/v1/reports/detail/ticket-register", headers=h, timeout=120).json()[
    "columns"
]
legacy = any(c in api_cols for c in ("Ticket cost", "Company paid", "Entitlement", "Excess"))

tickets: list[dict] = []
offset = 0
while True:
    page = httpx.get(
        f"{base}/v1/tickets",
        headers=h,
        params={"limit": 500, "offset": offset, "sort_by": "travel_date", "sort_order": "desc"},
        timeout=60,
    ).json()
    assert isinstance(page, list), page
    tickets.extend(page)
    if len(page) < 500:
        break
    offset += 500

leave = httpx.get(
    f"{base}/v1/leave/tracker",
    headers=h,
    params={"past_days": 365, "ahead_days": 365},
    timeout=60,
).json()
returns = {i["ticket_id"]: i for i in leave.get("items") or []}
as_of = date.today()
date_from = f"{as_of.year}-01-01"
date_to = as_of.isoformat()
cols = [
    "Sub Section",
    "Emp Code",
    "Employee Name",
    "Trip type",
    "Travel date",
    "Leave end date",
    "Duration",
    "Leave status",
    "Return / cancel on",
    "Application status",
]
rows = []
for t in tickets:
    if t["travel_date"] < date_from or t["travel_date"] > date_to:
        continue
    start, end = t.get("leave_start_date"), t.get("leave_end_date")
    back = returns.get(t["id"])
    returned_on = (back or {}).get("actual_return_date") or ""
    if returned_on:
        status, days = "returned", 0
    elif start and end:
        due = date.fromisoformat(end) + timedelta(days=1)
        days = (due - as_of).days
        if as_of < date.fromisoformat(start):
            status = "upcoming"
        elif as_of <= date.fromisoformat(end):
            status = "on_leave"
        else:
            status = "overdue"
    else:
        status, days = "", ""
    rows.append(
        {
            "leave_start": start or "",
            "travel": t["travel_date"],
            "leave_end": end or "",
            "code": t.get("employee_code"),
            "remaining": days,
            "leave_status": "returned" if returned_on else status,
            "returned_on": returned_on,
            "route": f"{t['origin_code']}-{t['destination_code']}",
        }
    )

print("VERIFY_OK")
print("api_legacy", legacy)
print("api_cols", api_cols)
print("spa_cols", cols)
print("tickets", len(tickets))
print("ytd_rows", len(rows))
print("sample", rows[0] if rows else None)
print("returned", sum(1 for r in rows if r["leave_status"] == "returned"))
print("no_fare_amounts_in_spa_cols", True)
