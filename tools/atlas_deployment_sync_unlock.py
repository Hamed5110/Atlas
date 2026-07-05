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


APP_NAME = "ATLAS Airfare Allowance"
DEFAULT_INSTALL_ROOT = pathlib.Path(os.environ.get("ATLAS_INSTALL_ROOT", r"C:\Program Files\ATLAS Airfare Allowance"))
DEFAULT_PROGRAM_DATA = pathlib.Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData")) / "ATLAS"
LOG_PATH = DEFAULT_PROGRAM_DATA / "logs" / "deployment_sync_error.log"


def now():
    return _dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def emit(stage, message):
    line = f"[{stage}] {message}"
    print(line, flush=True)
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(f"{now()} {line}\n")


def fail(stage, error, suggestion):
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "time": now(),
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


def parse_env_file(path):
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


def write_env_file(path, values):
    existing = parse_env_file(path)
    existing.update({k: str(v) for k, v in values.items() if v is not None})
    ordered = [
        "PORT",
        "DB_SERVER",
        "DB_PORT",
        "DB_NAME",
        "DB_USER",
        "DB_PASSWORD",
        "NODE_ENV",
    ]
    keys = ordered + sorted(k for k in existing if k not in ordered)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(f"{key}={existing[key]}" for key in keys if key in existing) + "\n", encoding="utf-8")


def tcp_host(server):
    value = (server or "127.0.0.1").strip()
    if "," in value:
        value = value.split(",", 1)[0]
    if "\\" in value:
        value = value.split("\\", 1)[0]
    if value.lower() in {"localhost", ".", "(local)"}:
        return "127.0.0.1"
    return value or "127.0.0.1"


def test_port(host, port, timeout=3.0):
    with socket.create_connection((host, int(port)), timeout=timeout):
        return True


def registry_set(root, subkey, values):
    if winreg is None:
        emit("SKIP", "Windows registry API is unavailable on this platform.")
        return
    access = winreg.KEY_SET_VALUE
    try:
        key = winreg.CreateKeyEx(root, subkey, 0, access)
    except PermissionError:
        if root == winreg.HKEY_LOCAL_MACHINE:
            emit("WARN", "HKLM registry write denied; retrying HKCU for current user.")
            registry_set(winreg.HKEY_CURRENT_USER, subkey, values)
            return
        raise
    with key:
        for name, value in values.items():
            winreg.SetValueEx(key, name, 0, winreg.REG_SZ, str(value))


def clear_lock_files(program_data, install_root):
    candidates = [
        program_data / "ui-lock.json",
        program_data / "preferences-lock.json",
        program_data / "workspace-lock.json",
        program_data / "atlas-ui-state.json",
        install_root / ".ui-lock",
        install_root / ".preferences-lock",
    ]
    removed = []
    for path in candidates:
        if path.exists() and path.is_file():
            path.unlink()
            removed.append(str(path))
    cache_root = program_data / "cache"
    if cache_root.exists():
        backup = program_data / f"cache_backup_{_dt.datetime.now().strftime('%Y%m%d%H%M%S')}"
        shutil.move(str(cache_root), str(backup))
        removed.append(f"{cache_root} -> {backup}")
    return removed


def run_sqlcmd(server, port, database, user, password, query):
    sqlcmd = shutil.which("sqlcmd")
    if not sqlcmd:
        emit("WARN", "sqlcmd not found; schema validation will use port checks only.")
        return None
    target = f"tcp:{tcp_host(server)},{int(port)}"
    cmd = [
        sqlcmd,
        "-S", target,
        "-d", database,
        "-U", user,
        "-P", password,
        "-b",
        "-Q", query,
    ]
    return subprocess.run(cmd, text=True, capture_output=True, timeout=45)


def validate_schema(settings):
    query = """
SET NOCOUNT ON;
SELECT
  CASE WHEN OBJECT_ID(N'dbo.AirfarePolicyRates', N'U') IS NULL THEN 1 ELSE 0 END AS MissingRates,
  CASE WHEN OBJECT_ID(N'dbo.sp_ATLAS_PurgeAirfarePolicyRate', N'P') IS NULL THEN 1 ELSE 0 END AS MissingPurgeProc,
  CASE WHEN OBJECT_ID(N'dbo.sp_ATLAS_SaveAirfarePolicyRate', N'P') IS NULL THEN 1 ELSE 0 END AS MissingSaveProc;
"""
    result = run_sqlcmd(
        settings.get("DB_SERVER", "127.0.0.1"),
        settings.get("DB_PORT", "1433"),
        settings.get("DB_NAME", "Atlasairfare010"),
        settings.get("DB_USER", "sa"),
        settings.get("DB_PASSWORD", ""),
        query,
    )
    if result is None:
        return
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "sqlcmd schema validation failed")
    if " 1" in result.stdout:
        raise RuntimeError(f"Schema validation failed: {result.stdout.strip()}")
    emit("VERIFY", "Schema objects confirmed: AirfarePolicyRates and purge/save procedures.")


def main():
    parser = argparse.ArgumentParser(description="ATLAS post-repair deployment synchronizer")
    parser.add_argument("--install-root", default=str(DEFAULT_INSTALL_ROOT))
    parser.add_argument("--program-data", default=str(DEFAULT_PROGRAM_DATA))
    parser.add_argument("--app-port", default=None)
    parser.add_argument("--sql-port", default=None)
    args = parser.parse_args()

    stage = "START"
    try:
        install_root = pathlib.Path(args.install_root)
        program_data = pathlib.Path(args.program_data)
        env_path = install_root / ".env"
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        emit("VERIFY", f"Reading application configuration: {env_path}")
        settings = parse_env_file(env_path)
        if not settings:
            raise FileNotFoundError(f"Configuration file not found or empty: {env_path}")

        app_port = int(args.app_port or settings.get("PORT") or 3355)
        sql_port = int(args.sql_port or settings.get("DB_PORT") or 1433)
        db_server = settings.get("DB_SERVER", "127.0.0.1")
        db_host = tcp_host(db_server)

        stage = "VERIFY_SQL_PORT"
        emit("VERIFY", f"Connecting to target database engine {db_host}:{sql_port}...")
        test_port(db_host, sql_port)
        emit("PASS", f"MSSQL TCP port confirmed: {db_host}:{sql_port}")

        stage = "VERIFY_APP_PORT"
        emit("VERIFY", f"Checking application route port {app_port}...")
        try:
            test_port("127.0.0.1", app_port, timeout=1.5)
            emit("PASS", f"Application port is accepting local traffic: 127.0.0.1:{app_port}")
        except OSError:
            emit("WARN", f"Application port {app_port} is not currently listening. Config will still be synchronized.")

        stage = "SYNC_CONFIG"
        emit("EXECUTE", "Writing verified port values to .env and registry...")
        write_env_file(env_path, {"PORT": app_port, "DB_PORT": sql_port, "DB_SERVER": db_server})
        registry_values = {
            "InstallRoot": str(install_root),
            "ProgramData": str(program_data),
            "PORT": app_port,
            "DB_SERVER": db_server,
            "DB_PORT": sql_port,
            "DB_NAME": settings.get("DB_NAME", "Atlasairfare010"),
            "DB_USER": settings.get("DB_USER", "sa"),
        }
        if winreg is not None:
            registry_set(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\ATLAS\AirfareAllowance", registry_values)

        stage = "RESET_UI_LOCKS"
        emit("REPAIR", "Resetting interface preference locks and stale cache files...")
        removed = clear_lock_files(program_data, install_root)
        emit("PASS", f"Interface lock reset complete. Removed or moved {len(removed)} item(s).")

        stage = "VALIDATE_SCHEMA"
        emit("VERIFY", "Validating database schema stack...")
        validate_schema(settings)

        emit("PASS", "Deployment synchronization completed.")
        return 0
    except Exception as exc:
        return fail(stage, exc, "Run this tool as Administrator, confirm DB_SERVER/DB_PORT in .env, and verify SQL Server TCP/IP is enabled for the configured port.")


if __name__ == "__main__":
    sys.exit(main())
