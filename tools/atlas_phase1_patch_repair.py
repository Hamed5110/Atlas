#!/usr/bin/env python3
import argparse
import datetime as dt
import json
import os
import pathlib
import socket
import subprocess
import sys
import tempfile
import traceback

try:
    import winreg
except ImportError:
    winreg = None


APP_NAME = "ATLAS Airfare Allowance"
DEFAULT_INSTALL_ROOT = pathlib.Path(os.environ.get("ATLAS_INSTALL_ROOT", r"C:\Airfare_Allowance"))
DEFAULT_DATA_ROOT = pathlib.Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData")) / "ATLAS"
LOG_NAME = "phase1_patch_debug.log"


def utc_now():
    return dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


class Telemetry:
    def __init__(self, data_root):
        self.log_path = pathlib.Path(data_root) / "logs" / LOG_NAME
        self.log_path.parent.mkdir(parents=True, exist_ok=True)

    def write(self, stage, message, payload=None):
        line = f"[{stage}] {message}"
        print(line, flush=True)
        record = {"time": utc_now(), "stage": stage, "message": message}
        if payload is not None:
            record["payload"] = payload
        with self.log_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    def failure(self, step, exc, remediation):
        payload = {
            "time": utc_now(),
            "current_step": step,
            "error_code": type(exc).__name__,
            "error": str(exc),
            "remediation_suggestion": remediation,
            "trace": traceback.format_exc(),
        }
        print(json.dumps(payload, indent=2), flush=True)
        with self.log_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, ensure_ascii=False) + "\n")


def parse_env_file(path):
    values = {}
    path = pathlib.Path(path)
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip().upper()] = value.strip().strip('"')
    return values


def read_registry_config():
    values = {}
    if winreg is None:
        return values
    paths = (
        r"SOFTWARE\ATLAS\AirfareAllowance",
        r"SOFTWARE\ATLAS Airfare Allowance",
        r"SOFTWARE\WOW6432Node\ATLAS\AirfareAllowance",
        r"SOFTWARE\WOW6432Node\ATLAS Airfare Allowance",
    )
    names = ("INSTALLROOT", "InstallRoot", "ProgramData", "PORT", "ATLASPORT", "DB_SERVER", "DB_PORT", "DB_NAME", "DB_USER")
    for root in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
        for path in paths:
            try:
                with winreg.OpenKey(root, path) as key:
                    for name in names:
                        try:
                            value = winreg.QueryValueEx(key, name)[0]
                            values[name.upper()] = str(value)
                        except FileNotFoundError:
                            pass
            except FileNotFoundError:
                pass
            except PermissionError:
                pass
    return values


def merge_settings(args):
    registry = read_registry_config()
    install_root = pathlib.Path(args.install_root or registry.get("INSTALLROOT") or DEFAULT_INSTALL_ROOT)
    data_root = pathlib.Path(args.data_root or registry.get("PROGRAMDATA") or DEFAULT_DATA_ROOT)
    env_path = pathlib.Path(args.env_path or install_root / ".env")
    env_values = parse_env_file(env_path)
    settings = {}
    settings.update(registry)
    settings.update(env_values)
    if args.app_port:
        settings["PORT"] = str(args.app_port)
    if args.sql_port:
        settings["DB_PORT"] = str(args.sql_port)
    if args.db_server:
        settings["DB_SERVER"] = args.db_server
    if args.db_name:
        settings["DB_NAME"] = args.db_name
    if args.db_user:
        settings["DB_USER"] = args.db_user
    if args.db_password:
        settings["DB_PASSWORD"] = args.db_password
    settings.setdefault("PORT", settings.get("ATLASPORT", "5110"))
    settings.setdefault("DB_SERVER", "127.0.0.1")
    settings.setdefault("DB_PORT", "1433")
    settings.setdefault("DB_NAME", "Atlasairfare010")
    settings.setdefault("DB_USER", "sa")
    settings.setdefault("DB_PASSWORD", "")
    return install_root, data_root, env_path, settings


def tcp_host(server):
    value = str(server or "127.0.0.1").strip()
    if "," in value:
        value = value.split(",", 1)[0]
    if "\\" in value:
        value = value.split("\\", 1)[0]
    if value.lower() in ("localhost", ".", "(local)"):
        return "127.0.0.1"
    return value or "127.0.0.1"


def test_tcp(host, port, timeout=5.0):
    with socket.create_connection((host, int(port)), timeout=timeout):
        return True


def split_sql_batches(sql_text):
    batches = []
    current = []
    for line in sql_text.splitlines():
        if line.strip().upper() == "GO":
            batch = "\n".join(current).strip()
            if batch:
                batches.append(batch)
            current = []
        else:
            current.append(line)
    batch = "\n".join(current).strip()
    if batch:
        batches.append(batch)
    return batches


def sql_server_part(server, port):
    server = str(server or "127.0.0.1").strip()
    if "," in server:
        return "tcp:" + server
    port = int(port or 0)
    if port > 0:
        host = tcp_host(server)
        return f"tcp:{host},{port}"
    return server


def powershell_sql_execute(server_part, database, user, password, sql_text, timeout=180):
    ps_script = r"""
param(
  [string]$ServerPart,
  [string]$Database,
  [string]$User,
  [string]$Password,
  [string]$SqlFile
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Data
$query = [System.IO.File]::ReadAllText($SqlFile, [System.Text.Encoding]::UTF8)
$cs = "Server=$ServerPart;Database=$Database;User ID=$User;Password=$Password;Encrypt=False;TrustServerCertificate=True;Connection Timeout=15;"
$conn = New-Object System.Data.SqlClient.SqlConnection($cs)
try {
  $conn.Open()
  $cmd = $conn.CreateCommand()
  $cmd.CommandTimeout = 180
  $cmd.CommandText = $query
  $null = $cmd.ExecuteNonQuery()
} finally {
  $conn.Dispose()
}
"""
    with tempfile.TemporaryDirectory(prefix="atlas_phase1_") as temp_dir:
        temp_dir = pathlib.Path(temp_dir)
        ps_path = temp_dir / "run_sql.ps1"
        sql_path = temp_dir / "batch.sql"
        ps_path.write_text(ps_script, encoding="utf-8")
        sql_path.write_text(sql_text, encoding="utf-8")
        cmd = [
            "powershell.exe",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(ps_path),
            "-ServerPart",
            server_part,
            "-Database",
            database,
            "-User",
            user,
            "-Password",
            password,
            "-SqlFile",
            str(sql_path),
        ]
        return subprocess.run(cmd, text=True, capture_output=True, timeout=timeout)


def execute_sql_file(sql_path, settings, telemetry):
    server_part = sql_server_part(settings["DB_SERVER"], settings["DB_PORT"])
    database = settings["DB_NAME"]
    user = settings["DB_USER"]
    password = settings["DB_PASSWORD"]
    if not password:
        raise RuntimeError("DB_PASSWORD is empty. Configure the MSSQL login before running Phase-1 repair.")

    telemetry.write("EXECUTE", f"Synchronizing indexes and procedures from {sql_path.name}...")
    sql_text = pathlib.Path(sql_path).read_text(encoding="utf-8", errors="ignore")
    batches = split_sql_batches(sql_text)
    for index, batch in enumerate(batches, start=1):
        telemetry.write("EXECUTE", f"Applying SQL batch {index}/{len(batches)}")
        result = powershell_sql_execute(server_part, database, user, password, batch)
        if result.returncode != 0:
            detail = (result.stderr or result.stdout or "").strip()
            raise RuntimeError(f"SQL batch {index} failed: {detail}")


def verify_database(settings, telemetry):
    server_part = sql_server_part(settings["DB_SERVER"], settings["DB_PORT"])
    query = """
SET NOCOUNT ON;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.AirfarePolicyRates') AND name = N'PK_AirfarePolicyRates')
    THROW 53101, 'PK_AirfarePolicyRates was not restored on dbo.AirfarePolicyRates.', 1;
IF OBJECT_ID(N'dbo.sp_ATLAS_PurgeAirfarePolicyRate', N'P') IS NULL
    THROW 53102, 'dbo.sp_ATLAS_PurgeAirfarePolicyRate is missing after repair.', 1;
IF OBJECT_ID(N'dbo.sp_ATLAS_DeactivateAirfarePolicyRate', N'P') IS NULL
    THROW 53103, 'dbo.sp_ATLAS_DeactivateAirfarePolicyRate is missing after repair.', 1;
SELECT CAST(1 AS INT) AS Phase1PolicyRepairVerified;
"""
    result = powershell_sql_execute(
        server_part,
        settings["DB_NAME"],
        settings["DB_USER"],
        settings["DB_PASSWORD"],
        query,
        timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "Database verification failed").strip())
    telemetry.write("SUCCESS", "Database metadata verification completed.")


def write_registry(settings, install_root, data_root, telemetry):
    if winreg is None:
        return
    values = {
        "InstallRoot": str(install_root),
        "ProgramData": str(data_root),
        "PORT": settings.get("PORT", "5110"),
        "ATLASPORT": settings.get("PORT", "5110"),
        "DB_SERVER": settings.get("DB_SERVER", "127.0.0.1"),
        "DB_PORT": settings.get("DB_PORT", "1433"),
        "DB_NAME": settings.get("DB_NAME", "Atlasairfare010"),
        "DB_USER": settings.get("DB_USER", "sa"),
    }
    for root in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
        try:
            with winreg.CreateKeyEx(root, r"SOFTWARE\ATLAS\AirfareAllowance", 0, winreg.KEY_SET_VALUE) as key:
                for name, value in values.items():
                    winreg.SetValueEx(key, name, 0, winreg.REG_SZ, str(value))
            telemetry.write("VERIFY", "Runtime registry settings synchronized.")
            return
        except PermissionError:
            continue


def main():
    parser = argparse.ArgumentParser(description="ATLAS Phase-1 policy-rate database repair")
    parser.add_argument("--install-root", default=None)
    parser.add_argument("--data-root", default=None)
    parser.add_argument("--env-path", default=None)
    parser.add_argument("--app-port", type=int, default=None)
    parser.add_argument("--sql-port", type=int, default=None)
    parser.add_argument("--db-server", default=None)
    parser.add_argument("--db-name", default=None)
    parser.add_argument("--db-user", default=None)
    parser.add_argument("--db-password", default=None)
    parser.add_argument("--sql-file", default=None)
    args = parser.parse_args()

    install_root, data_root, _env_path, settings = merge_settings(args)
    telemetry = Telemetry(data_root)
    step = "INIT"
    try:
        telemetry.write("VERIFY", "ATLAS Phase-1 patch repair started.")

        step = "VERIFY_SQL_SOCKET"
        sql_host = tcp_host(settings["DB_SERVER"])
        telemetry.write("VERIFY", f"Establishing Database Socket Handshake {sql_host}:{settings['DB_PORT']}...")
        test_tcp(sql_host, int(settings["DB_PORT"]))
        telemetry.write("SUCCESS", f"MSSQL socket verified: {sql_host}:{settings['DB_PORT']}")

        step = "VERIFY_APP_PORT"
        app_port = int(settings.get("PORT", "5110"))
        try:
            telemetry.write("VERIFY", f"Checking main application port 127.0.0.1:{app_port}...")
            test_tcp("127.0.0.1", app_port, timeout=2.0)
            telemetry.write("SUCCESS", f"Application port is reachable: 127.0.0.1:{app_port}")
        except OSError as exc:
            telemetry.write("WARN", f"Application port is not listening yet: {exc}")

        step = "SYNC_REGISTRY"
        write_registry(settings, install_root, data_root, telemetry)

        step = "APPLY_SQL"
        sql_file = pathlib.Path(args.sql_file) if args.sql_file else install_root / "database" / "ATLAS_Phase1_PolicyRate_Repair.sql"
        if not sql_file.exists():
            fallback = pathlib.Path(__file__).resolve().parents[1] / "database" / "ATLAS_Phase1_PolicyRate_Repair.sql"
            sql_file = fallback
        if not sql_file.exists():
            raise FileNotFoundError(f"Phase-1 repair SQL was not found: {sql_file}")
        execute_sql_file(sql_file, settings, telemetry)

        step = "VERIFY_DATABASE"
        verify_database(settings, telemetry)

        telemetry.write("SUCCESS", "Phase-1 Patch Fully Applied.")
        return 0
    except Exception as exc:
        telemetry.failure(
            step,
            exc,
            "Confirm DB_SERVER, DB_PORT, DB_NAME, DB_USER, and DB_PASSWORD in .env. Verify SQL Server TCP/IP is enabled and rerun this script as Administrator.",
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
