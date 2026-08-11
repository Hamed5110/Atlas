from __future__ import annotations

import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import config, db


ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
BOOT_PROOF = db.initialize()


class Handler(BaseHTTPRequestHandler):
    server_version = "ATLASPythonCore/0.1.0"

    def do_GET(self) -> None:
        try:
            parsed = urlparse(self.path)
            query = parse_qs(parsed.query)
            if parsed.path == "/":
                return self.send_file(WEB / "index.html", "text/html; charset=utf-8")
            if parsed.path == "/assets/app.css":
                return self.send_file(WEB / "app.css", "text/css; charset=utf-8")
            if parsed.path == "/assets/app.js":
                return self.send_file(WEB / "app.js", "application/javascript; charset=utf-8")
            if parsed.path == "/api/health":
                return self.send_json({
                    "status": "ok",
                    "application": config.APP_NAME,
                    "version": config.APP_VERSION,
                    "runtime": "python",
                    "repository": "mssql-python-core",
                    "port": config.PORT,
                    "oldRuntimeLinked": False,
                    "annualCloseProcess": False,
                    "database": db.health_probe(),
                    "startupDatabaseProof": BOOT_PROOF,
                })
            if parsed.path == "/api/summary":
                return self.send_json(db.summary(required_query(query, "asOfDate")))
            if parsed.path == "/api/companies":
                return self.send_json({"rows": db.list_companies()})
            if parsed.path == "/api/employees":
                return self.send_json({"rows": db.list_employees()})
            if parsed.path == "/api/entitlement/rules":
                return self.send_json({"rows": db.list_entitlement_rules()})
            if parsed.path == "/api/entitlement/events":
                return self.send_json({"rows": db.list_entitlement_events()})
            if parsed.path == "/api/entitlement/balance":
                return self.send_json({"asOfDate": required_query(query, "asOfDate"), "rows": db.entitlement_balance(required_query(query, "asOfDate"))})
            if parsed.path == "/api/entitlement/reconciliation":
                return self.send_json(db.reconciliation(required_query(query, "asOfDate")))
            if parsed.path == "/api/allocations":
                return self.send_json({"rows": db.list_allocations()})
            if parsed.path == "/api/loans":
                return self.send_json({"rows": db.list_loans()})
            return self.send_json({"code": "NOT_FOUND", "error": "Route not found."}, HTTPStatus.NOT_FOUND)
        except Exception as exc:
            return self.send_error_json(exc)

    def do_POST(self) -> None:
        try:
            parsed = urlparse(self.path)
            if parsed.path == "/api/employees":
                return self.send_json({"employee": db.create_employee(self.read_json())}, HTTPStatus.CREATED)
            if parsed.path == "/api/entitlement/events":
                return self.send_json({"event": db.post_entitlement_event(self.read_json())}, HTTPStatus.CREATED)
            if parsed.path == "/api/allocations":
                return self.send_json({"allocation": db.create_allocation(self.read_json())}, HTTPStatus.CREATED)
            if parsed.path == "/api/loans":
                return self.send_json({"loan": db.create_loan(self.read_json())}, HTTPStatus.CREATED)
            return self.send_json({"code": "NOT_FOUND", "error": "Route not found."}, HTTPStatus.NOT_FOUND)
        except Exception as exc:
            return self.send_error_json(exc)

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or "0")
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def send_file(self, path: Path, content_type: str) -> None:
        body = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Atlas-Python-Core", "true")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, body: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        raw = json.dumps(body, indent=2, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Atlas-Python-Core", "true")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def send_error_json(self, exc: Exception) -> None:
        message = str(exc) or exc.__class__.__name__
        status = HTTPStatus.BAD_REQUEST if isinstance(exc, (ValueError, json.JSONDecodeError)) else HTTPStatus.INTERNAL_SERVER_ERROR
        self.send_json({"code": exc.__class__.__name__, "error": message}, status)

    def log_message(self, fmt: str, *args) -> None:
        print(f"{self.client_address[0]} - {fmt % args}")


def required_query(query: dict[str, list[str]], name: str) -> str:
    value = query.get(name, [""])[0].strip()
    if not value:
        raise ValueError(f"{name} is required in YYYY-MM-DD format.")
    return value


def main() -> None:
    server = ThreadingHTTPServer(("0.0.0.0", config.PORT), Handler)
    print(f"ATLAS Python Core listening on http://127.0.0.1:{config.PORT}")
    print(f"ATLAS Python Core database: {config.DB_SERVER},{config.DB_PORT}/{config.DB_NAME}")
    server.serve_forever()


if __name__ == "__main__":
    main()
