"""Import Focus Soft Employee Information workbook into live HCM API."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path

os.chdir(r"C:\HCM Airfare")
from airfare_management.config import get_settings

FOCUS_XLSX = Path(
    r"c:\Users\Hamed Ali Khan\Downloads\pay_Employee Information_46dce3a6-bed6-42cf-b005-6365ed3fc84f.xlsx"
)


def main() -> int:
    get_settings.cache_clear()
    settings = get_settings()
    base = "http://127.0.0.1:3389"
    login_body = json.dumps(
        {
            "username": settings.bootstrap_admin_username,
            "password": settings.bootstrap_admin_password,
        }
    ).encode()
    token = json.loads(
        urllib.request.urlopen(
            urllib.request.Request(
                f"{base}/v1/auth/login",
                data=login_body,
                headers={"Content-Type": "application/json"},
                method="POST",
            ),
            timeout=20,
        ).read()
    )["access_token"]
    auth = {"Authorization": f"Bearer {token}"}

    content = FOCUS_XLSX.read_bytes()
    boundary = "----atlasbound"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{FOCUS_XLSX.name}"\r\n'
        "Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n"
    ).encode() + content + f"\r\n--{boundary}--\r\n".encode()
    preview_req = urllib.request.Request(
        f"{base}/v1/employees/import/preview",
        data=body,
        headers={**auth, "Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    preview_payload = json.loads(urllib.request.urlopen(preview_req, timeout=120).read())
    preview = preview_payload.get("rows", preview_payload)
    if not isinstance(preview, list):
        print("unexpected_preview", type(preview_payload).__name__, str(preview_payload)[:500])
        return 1
    ready = [row for row in preview if row.get("severity") == "READY"]
    blocked = [row for row in preview if row.get("severity") != "READY"]
    print("summary", preview_payload.get("summary"))
    print("preview_total", len(preview), "ready", len(ready), "blocked", len(blocked))
    if blocked[:5]:
        print("blocked_sample", json.dumps(blocked[:5], default=str)[:1500])

    commit_rows = []
    for row in ready:
        commit_rows.append(
            {
                "row": row["row"],
                "code": row["code"],
                "full_name": row["full_name"],
                "company_id": row["company_id"],
                "join_date": row["join_date"],
                "department": row.get("department") or "",
                "branch": row.get("branch") or "",
                "pay_group": row.get("pay_group") or "",
                "designation": row.get("designation") or "",
                "nationality": row.get("nationality") or "",
                "cpr_no": row.get("cpr_no") or "",
                "sub_section": row.get("sub_section") or "",
                "reporting_officer_id": row.get("reporting_officer_id"),
                "grade": row.get("grade") or "",
                "selected": True,
            }
        )
    commit_req = urllib.request.Request(
        f"{base}/v1/employees/import/commit",
        data=json.dumps({"rows": commit_rows}).encode(),
        headers={**auth, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        result = json.loads(urllib.request.urlopen(commit_req, timeout=180).read())
        print("commit", result)
    except urllib.error.HTTPError as exc:
        print("commit_fail", exc.read().decode()[:2000])
        return 1

    employees = json.loads(
        urllib.request.urlopen(
            urllib.request.Request(f"{base}/v1/employees?limit=500", headers=auth),
            timeout=30,
        ).read()
    )
    print("employees_now", len(employees))
    sample = next((emp for emp in employees if emp.get("code") == "0001"), None)
    if sample:
        keys = (
            "code",
            "full_name",
            "grade",
            "department",
            "cpr_no",
            "pay_group",
            "designation",
            "sub_section",
            "nationality",
        )
        print("sample_0001", {key: sample.get(key) for key in keys})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
