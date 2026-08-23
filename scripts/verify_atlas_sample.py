"""Quick verification that Atlas sample employees support allocation preview."""

from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient

from airfare_management.api.main import create_app
from airfare_management.config import Settings
from airfare_management.infrastructure.security import issue_access_token


def main() -> None:
    settings = Settings()
    client = TestClient(create_app(settings))
    headers = {
        "Authorization": f"Bearer {issue_access_token(uuid4(), {'admin', 'hr'}, settings)}"
    }
    employees = client.get("/v1/employees", headers=headers)
    assert employees.status_code == 200, employees.text
    rows = employees.json()
    print(f"Active employees via API: {len(rows)}")
    sample = rows[0]
    preview = client.post(
        "/v1/allocations/preview",
        headers=headers,
        json={
            "employee_id": sample["id"],
            "as_of_date": "2026-08-22",
            "requested_ticket_amount": "200",
            "excess_option": "LOAN",
        },
    )
    assert preview.status_code == 200, preview.text
    body = preview.json()
    print(
        f"Preview OK: {sample['full_name']} -> scenario={body['scenario']}, "
        f"entitlement={body['final_entitlement_amount']}"
    )


if __name__ == "__main__":
    main()
