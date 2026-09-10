import json
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(r"C:\HCM Airfare")


def load_env():
    env = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def req(method, path, data=None, token=None):
    body = None if data is None else json.dumps(data).encode()
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(
        "http://127.0.0.1:3389" + path, data=body, headers=headers, method=method
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as resp:
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


env = load_env()
_, login = req(
    "POST",
    "/v1/auth/login",
    {
        "username": env.get("AIRFARE_BOOTSTRAP_ADMIN_USERNAME", "admin"),
        "password": env["AIRFARE_BOOTSTRAP_ADMIN_PASSWORD"],
    },
)
token = login["access_token"]
_, emps = req("GET", "/v1/employees?limit=5", token=token)
emp = emps[0]
payloads = [
    {
        "employee_id": emp["id"],
        "as_of_date": str(date.today()),
        "requested_ticket_amount": "300",
        "origin_code": "DEL",
        "destination_code": "BLR",
    },
    {
        "employee_id": emp["id"],
        "as_of_date": str(date.today()),
        "requested_ticket_amount": 300,
        "origin_code": "DEL",
        "destination_code": "BLR",
    },
    {
        "employee_id": emp["id"],
        "as_of_date": str(date.today()),
        "requested_ticket_amount": 300,
    },
]
for i, p in enumerate(payloads):
    st, body = req("POST", "/v1/allocations/preview", p, token=token)
    print("try", i, st, str(body)[:300])
