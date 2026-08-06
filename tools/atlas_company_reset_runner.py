#!/usr/bin/env python3
import argparse
import datetime as _dt
import json
import os
import pathlib
import shutil
import socket
import subprocess
import sys
import traceback

try:
    import winreg
except ImportError:  # pragma: no cover
    winreg = None


DEFAULT_INSTALL_ROOT = pathlib.Path(os.environ.get("ATLAS_INSTALL_ROOT", r"C:\Program Files\ATLAS Airfare Allowance"))
DEFAULT_PROGRAM_DATA = pathlib.Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData")) / "ATLAS"
LOG_PATH = DEFAULT_PROGRAM_DATA / "logs" / "company_reset_debug.log"


def emit(stage, message):
    line = f"[{stage}] {message}"
    print(line, flush=True)
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(f"{_dt.datetime.now().isoformat(timespec='seconds')} {line}\n")


def fail(stage, error, suggestion):
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "time": _dt.datetime.now().isoformat(timespec="seconds"),
        "current_step": stage,
        "error_code": type(error).__name__,
        "error": str(error),
        "remediation_suggestion": suggestion,
        "trace": traceback.format_exc(),
    }
    with LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, indent=2) + "\n")
    print(json.dumps(payload, indent=2), flush=True)
    return 1


def parse_env(path):
    values = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"')
    return values


def read_registry_values():
    values = {}
    if winreg is None:
        return values
    for root in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
        try:
            with winreg.OpenKey(root, r"SOFTWARE\ATLAS\AirfareAllowance") as key:
                for name in ("InstallRoot", "ProgramData", "PORT", "DB_SERVER", "DB_PORT", "DB_NAME", "DB_USER"):
                    try:
                        values[name], _ = winreg.QueryValueEx(key, name)
                    except OSError:
                        pass
        except OSError:
            pass
    return values


def tcp_host(server):
    value = str(server or "127.0.0.1").strip()
    if "," in value:
        value = value.split(",", 1)[0]
    if "\\" in value:
        value = value.split("\\", 1)[0]
    if value.lower() in {"localhost", ".", "(local)"}:
        return "127.0.0.1"
    return value or "127.0.0.1"


def test_port(host, port, timeout=4):
    with socket.create_connection((host, int(port)), timeout=timeout):
        return True


def sqlcmd_path():
    found = shutil.which("sqlcmd")
    if not found:
        raise FileNotFoundError("sqlcmd was not found in PATH. Install SQL Server command line tools or run from the ATLAS server.")
    return found


def run_sql(settings, query, timeout=180):
    target = f"tcp:{tcp_host(settings.get('DB_SERVER'))},{int(settings.get('DB_PORT', 1433))}"
    cmd = [
        sqlcmd_path(),
        "-S", target,
        "-d", settings.get("DB_NAME", "Atlasairfare010"),
        "-U", settings.get("DB_USER", "sa"),
        "-P", settings.get("DB_PASSWORD", ""),
        "-b",
        "-r", "1",
        "-Q", query,
    ]
    result = subprocess.run(cmd, text=True, capture_output=True, timeout=timeout)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "sqlcmd failed")
    return result.stdout


def merge_settings(args):
    registry = read_registry_values()
    install_root = pathlib.Path(args.install_root or registry.get("InstallRoot") or DEFAULT_INSTALL_ROOT)
    program_data = pathlib.Path(args.program_data or registry.get("ProgramData") or DEFAULT_PROGRAM_DATA)
    env_values = parse_env(install_root / ".env")
    settings = {
        "InstallRoot": str(install_root),
        "ProgramData": str(program_data),
        "PORT": args.app_port or registry.get("PORT") or env_values.get("PORT") or "5110",
        "DB_SERVER": args.db_server or registry.get("DB_SERVER") or env_values.get("DB_SERVER") or "127.0.0.1",
        "DB_PORT": args.db_port or registry.get("DB_PORT") or env_values.get("DB_PORT") or "1433",
        "DB_NAME": args.db_name or registry.get("DB_NAME") or env_values.get("DB_NAME") or "Atlasairfare010",
        "DB_USER": args.db_user or registry.get("DB_USER") or env_values.get("DB_USER") or "sa",
        "DB_PASSWORD": args.db_password or env_values.get("DB_PASSWORD") or "",
    }
    return settings


def validate_schema(settings):
    emit("VERIFY", "Validating reset procedure and core schema objects...")
    query = """
SET NOCOUNT ON;
SELECT
  CASE WHEN OBJECT_ID(N'dbo.sp_ATLAS_ResetCompanyState', N'P') IS NULL THEN 1 ELSE 0 END AS MissingResetProc,
  CASE WHEN OBJECT_ID(N'dbo.ATLAS_CompanyResetLog', N'U') IS NULL THEN 1 ELSE 0 END AS MissingResetLog,
  CASE WHEN OBJECT_ID(N'dbo.AirfarePolicyRates', N'U') IS NULL THEN 1 ELSE 0 END AS MissingPolicyRates,
  CASE WHEN OBJECT_ID(N'dbo.Companies', N'U') IS NULL THEN 1 ELSE 0 END AS MissingCompanies;
"""
    output = run_sql(settings, query, timeout=60)
    if " 1" in output:
        raise RuntimeError(f"Schema validation failed: {output.strip()}")
    emit("SUCCESS", "Schema reset objects are present.")


def execute_reset(settings, confirm, company_code, company_name):
    if confirm != "RESET_COMPANY_DATA":
        raise ValueError("Use --confirm RESET_COMPANY_DATA to execute the company reset.")
    escaped_code = company_code.replace("'", "''")
    escaped_name = company_name.replace("'", "''")
    escaped_db = settings.get("DB_NAME", "Atlasairfare010").replace("'", "''")
    emit("INIT", "Dropping Foreign Key Constraints...")
    emit("PURGE", "Wiping Company Financials and Allowance Data...")
    emit("SEED", "Initializing Fresh Airfare Rate Rules...")
    query = f"""
SET NOCOUNT ON;
EXEC dbo.sp_ATLAS_ResetCompanyState
    @Confirm = N'RESET_COMPANY_DATA',
    @CompanyCode = N'{escaped_code}',
    @CompanyName = N'{escaped_name}',
    @DatabaseName = N'{escaped_db}',
    @ResetBy = NULL;
"""
    output = run_sql(settings, query, timeout=600)
    emit("SUCCESS", "Company Reset Completed Successfully.")
    print(output, flush=True)


def main():
    parser = argparse.ArgumentParser(description="ATLAS company reset orchestration runner")
    parser.add_argument("--install-root")
    parser.add_argument("--program-data")
    parser.add_argument("--app-port")
    parser.add_argument("--db-server")
    parser.add_argument("--db-port")
    parser.add_argument("--db-name")
    parser.add_argument("--db-user")
    parser.add_argument("--db-password")
    parser.add_argument("--confirm", default="")
    parser.add_argument("--company-code", default="ATLAS")
    parser.add_argument("--company-name", default="ATLAS Airfare HCM")
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()

    stage = "INIT"
    try:
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        settings = merge_settings(args)
        stage = "VERIFY_PORTS"
        emit("VERIFY", f"Application port configured as {settings['PORT']}.")
        emit("VERIFY", f"Connecting to MSSQL {tcp_host(settings['DB_SERVER'])}:{settings['DB_PORT']}...")
        test_port(tcp_host(settings["DB_SERVER"]), int(settings["DB_PORT"]))
        emit("SUCCESS", "Database TCP port is reachable.")

        stage = "VALIDATE_SCHEMA"
        validate_schema(settings)

        if args.validate_only:
            emit("SUCCESS", "Validation completed. Reset was not executed.")
            return 0

        stage = "EXECUTE_RESET"
        execute_reset(settings, args.confirm, args.company_code, args.company_name)
        return 0
    except Exception as exc:
        return fail(stage, exc, "Run as Administrator, confirm the configured SQL port, verify sa credentials in .env, then rerun with --confirm RESET_COMPANY_DATA.")


if __name__ == "__main__":
    sys.exit(main())
