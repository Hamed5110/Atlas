#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import socket
import sys
import time
import traceback
import urllib.request
from pathlib import Path


DEFAULT_INSTALL_ROOT = Path(os.environ.get("ATLAS_INSTALL_ROOT", r"C:\Program Files\ATLAS Airfare Allowance"))
DEFAULT_DATA_ROOT = Path(os.environ.get("ATLAS_DATA_ROOT", r"C:\ProgramData\ATLAS Airfare Allowance"))


class DeployError(Exception):
    def __init__(self, step, code, message, remediation):
        super().__init__(message)
        self.step = step
        self.code = code
        self.remediation = remediation


class DeployLogger:
    def __init__(self, log_path):
        self.log_path = Path(log_path)
        self.log_path.parent.mkdir(parents=True, exist_ok=True)

    def event(self, step, status, **payload):
        row = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "current_step": step,
            "status": status,
            **payload,
        }
        line = json.dumps(row, sort_keys=True)
        print(line, flush=True)
        with self.log_path.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")

    def failure(self, error):
        self.event(
            error.step,
            "FAILED",
            error_code=error.code,
            error_message=str(error),
            remediation_suggestion=error.remediation,
            traceback=traceback.format_exc(),
        )


def read_env(path):
    values = {}
    env_path = Path(path) / ".env"
    if not env_path.exists():
        return values
    for line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        if not line.strip() or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def write_env(path, values):
    env_path = Path(path) / ".env"
    env_path.parent.mkdir(parents=True, exist_ok=True)
    env_path.write_text("\n".join(f"{key}={value}" for key, value in values.items()) + "\n", encoding="ascii")


def test_tcp(host, port, timeout=3.0):
    try:
        with socket.create_connection((host, int(port)), timeout=timeout):
            return True
    except OSError:
        return False


def assert_port_free(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind(("0.0.0.0", int(port)))
        except OSError as exc:
            raise DeployError(
                "PORT_VALIDATION",
                getattr(exc, "winerror", None) or getattr(exc, "errno", "PORT_IN_USE"),
                f"Application port {port} is already in use.",
                "Choose another ATLAS application port or stop the process currently bound to the port.",
            ) from exc


def parse_sql_host(server):
    server = (server or "127.0.0.1").strip()
    if "," in server:
        return server.split(",", 1)[0].replace("tcp:", "").strip()
    if "\\" in server:
        return server.split("\\", 1)[0].strip() or "127.0.0.1"
    if server in (".", "(local)", "localhost"):
        return "127.0.0.1"
    return server


def scan_sql_ports(host, ports):
    return {str(port): test_tcp(host, int(port), timeout=1.5) for port in ports}


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def checksum_manifest(install_root):
    manifest = Path(install_root) / "atlas-payload-manifest.json"
    if not manifest.exists():
        return {"manifest": str(manifest), "status": "missing", "files": []}
    data = json.loads(manifest.read_text(encoding="utf-8"))
    rows = []
    for item in data.get("files", []):
        target = Path(install_root) / item.get("path", "")
        if not target.exists():
            rows.append({"path": str(target), "status": "missing"})
            continue
        actual = sha256_file(target)
        rows.append({
            "path": str(target),
            "status": "ok" if actual == item.get("sha256") else "changed",
            "expected_sha256": item.get("sha256"),
            "actual_sha256": actual,
        })
    return {"manifest": str(manifest), "status": "checked", "files": rows}


def check_manifest_url(url, current_version, logger):
    if not url:
        logger.event("UPDATE_MANIFEST", "SKIPPED", message="No manifest URL configured.")
        return
    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8"))
        logger.event(
            "UPDATE_MANIFEST",
            "OK",
            current_version=current_version,
            latest_version=payload.get("latestVersion") or payload.get("version"),
            package_url=payload.get("packageUrl") or payload.get("url"),
        )
    except Exception as exc:
        logger.event("UPDATE_MANIFEST", "WARNING", error_code=type(exc).__name__, message=str(exc))


def fresh_install(args, logger):
    settings = read_env(args.install_root)
    sql_host = parse_sql_host(args.db_server or settings.get("DB_SERVER") or "127.0.0.1")
    ports = sorted(set([1433, int(args.db_port or settings.get("DB_PORT") or 1433)]))
    logger.event("MSSQL_PORT_SCAN", "STARTED", host=sql_host, candidate_ports=ports)
    scan = scan_sql_ports(sql_host, ports)
    logger.event("MSSQL_PORT_SCAN", "OK", results=scan)
    sql_port = int(args.db_port or settings.get("DB_PORT") or next((p for p, ok in scan.items() if ok), 1433))
    if not test_tcp(sql_host, sql_port):
        raise DeployError(
            "MSSQL_PORT_VALIDATION",
            "SQL_PORT_UNREACHABLE",
            f"MSSQL endpoint {sql_host}:{sql_port} is not reachable.",
            "Confirm SQL Server TCP/IP is enabled and update DB_PORT to the configured SQL Server port.",
        )
    assert_port_free(args.app_port)
    settings.update({
        "PORT": str(args.app_port),
        "HOST": "0.0.0.0",
        "DB_SERVER": args.db_server or settings.get("DB_SERVER") or "127.0.0.1",
        "DB_PORT": str(sql_port),
        "DB_NAME": args.db_name or settings.get("DB_NAME") or "Atlasairfare010",
        "DB_USER": args.db_user or settings.get("DB_USER") or "sa",
        "DB_PASSWORD": args.db_password or settings.get("DB_PASSWORD") or "",
        "DB_ENCRYPT": "false",
        "DB_TRUST_SERVER_CERTIFICATE": "true",
    })
    write_env(args.install_root, settings)
    logger.event("CONFIG_SYNC", "OK", install_root=str(args.install_root), app_port=args.app_port, db_port=sql_port)


def repair(args, logger):
    report = checksum_manifest(args.install_root)
    logger.event("CHECKSUM_DIAGNOSTIC", "OK", report=report)
    settings = read_env(args.install_root)
    db_port = int(args.db_port or settings.get("DB_PORT") or 1433)
    db_server = args.db_server or settings.get("DB_SERVER") or "127.0.0.1"
    if not test_tcp(parse_sql_host(db_server), db_port):
        raise DeployError(
            "REPAIR_DB_ENDPOINT",
            "SQL_PORT_UNREACHABLE",
            f"MSSQL endpoint {db_server}:{db_port} is not reachable.",
            "Correct DB_SERVER/DB_PORT or enable SQL Server TCP/IP before rerunning repair.",
        )
    logger.event("REPAIR_DB_ENDPOINT", "OK", db_server=db_server, db_port=db_port)


def troubleshoot(args, logger):
    settings = read_env(args.install_root)
    app_port = int(args.app_port or settings.get("PORT") or 3356)
    db_port = int(args.db_port or settings.get("DB_PORT") or 1433)
    db_server = args.db_server or settings.get("DB_SERVER") or "127.0.0.1"
    logger.event("TROUBLESHOOT_APP_PORT", "OK", app_port=app_port, in_use=not port_available_for_report(app_port))
    logger.event("TROUBLESHOOT_DB_PORT", "OK", db_server=db_server, db_port=db_port, reachable=test_tcp(parse_sql_host(db_server), db_port))
    logger.event("TROUBLESHOOT_WRITE_ACCESS", "OK", install_root=str(args.install_root), data_root=str(args.data_root), install_writable=os.access(args.install_root, os.W_OK), data_writable=os.access(args.data_root, os.W_OK))


def port_available_for_report(port):
    try:
        assert_port_free(port)
        return True
    except DeployError:
        return False


def main(argv=None):
    parser = argparse.ArgumentParser(description="ATLAS deployment wizard")
    parser.add_argument("--mode", choices=["fresh", "repair", "troubleshoot"], required=True)
    parser.add_argument("--install-root", type=Path, default=DEFAULT_INSTALL_ROOT)
    parser.add_argument("--data-root", type=Path, default=DEFAULT_DATA_ROOT)
    parser.add_argument("--app-port", type=int, default=3356)
    parser.add_argument("--db-server", default="")
    parser.add_argument("--db-port", type=int, default=0)
    parser.add_argument("--db-name", default="")
    parser.add_argument("--db-user", default="")
    parser.add_argument("--db-password", default="")
    parser.add_argument("--manifest-url", default="")
    parser.add_argument("--version", default="2.3.33")
    args = parser.parse_args(argv)

    logger = DeployLogger(args.data_root / "logs" / "install_debug.log")
    try:
        logger.event("ENTRYPOINT", "STARTED", mode=args.mode, version=args.version)
        check_manifest_url(args.manifest_url, args.version, logger)
        if args.mode == "fresh":
            fresh_install(args, logger)
        elif args.mode == "repair":
            repair(args, logger)
        else:
            troubleshoot(args, logger)
        logger.event("DEPLOYMENT", "SUCCESS", mode=args.mode)
        return 0
    except DeployError as exc:
        logger.failure(exc)
        return 1
    except Exception as exc:
        logger.failure(DeployError("UNHANDLED_EXCEPTION", type(exc).__name__, str(exc), "Review install_debug.log and rerun the selected installer mode."))
        return 1


if __name__ == "__main__":
    sys.exit(main())
