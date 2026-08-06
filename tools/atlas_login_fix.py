#!/usr/bin/env python3
import argparse
import ctypes
import datetime as _dt
import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

try:
    import winreg
except ImportError:
    winreg = None


DEFAULT_INSTALL_ROOT = Path(r"C:\Program Files\ATLAS Airfare Allowance")
DEFAULT_DATA_ROOT = Path(r"C:\ProgramData\ATLAS Airfare Allowance")
REG_PATHS = [
    (winreg.HKEY_LOCAL_MACHINE if winreg else None, r"SOFTWARE\ATLAS Airfare Allowance"),
    (winreg.HKEY_LOCAL_MACHINE if winreg else None, r"SOFTWARE\WOW6432Node\ATLAS Airfare Allowance"),
]


class LoginFix:
    def __init__(self, install_root: Path, data_root: Path, args):
        self.install_root = install_root
        self.data_root = data_root
        self.args = args
        self.log_dir = data_root / "logs"
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.debug_path = self.log_dir / "login_fix_debug.log"
        self.current_step = "startup"

    def emit(self, step, status="INFO", message="", error_code="", remediation_suggestion=""):
        self.current_step = step
        line = {
            "timestamp": _dt.datetime.now(_dt.timezone.utc).isoformat(),
            "current_step": step,
            "status": status,
            "message": message,
            "error_code": error_code,
            "remediation_suggestion": remediation_suggestion,
        }
        print(f"[ATLAS][{status}] {step}: {message}", flush=True)
        with self.debug_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(line, separators=(",", ":")) + "\n")

    def fail(self, step, exc, remediation):
        self.emit(step, "FAILED", str(exc), exc.__class__.__name__, remediation)
        raise SystemExit(1)

    def read_env(self):
        settings = {}
        env_path = self.install_root / ".env"
        if env_path.exists():
            for raw in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
                if not raw.strip() or raw.lstrip().startswith("#") or "=" not in raw:
                    continue
                key, value = raw.split("=", 1)
                settings[key.strip()] = value.strip()
        return settings

    def write_env(self, settings):
        env_path = self.install_root / ".env"
        self.install_root.mkdir(parents=True, exist_ok=True)
        text = "\n".join(f"{key}={value}" for key, value in settings.items()) + "\n"
        env_path.write_text(text, encoding="ascii", errors="ignore")

    def read_registry(self):
        values = {}
        if not winreg:
            return values
        for hive, subkey in REG_PATHS:
            try:
                with winreg.OpenKey(hive, subkey) as key:
                    for name in ("INSTALLROOT", "DATAROOT", "ATLASPORT", "DB_SERVER", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD", "DB_ODBC_DRIVER"):
                        try:
                            value, _ = winreg.QueryValueEx(key, name)
                            if value not in (None, ""):
                                values[name] = str(value)
                        except FileNotFoundError:
                            pass
            except FileNotFoundError:
                pass
        return values

    def write_registry(self, settings):
        if not winreg or os.name != "nt":
            return
        for hive, subkey in REG_PATHS:
            try:
                with winreg.CreateKeyEx(hive, subkey, 0, winreg.KEY_SET_VALUE) as key:
                    mapping = {
                        "INSTALLROOT": str(self.install_root),
                        "DATAROOT": str(self.data_root),
                        "ATLASPORT": str(settings.get("PORT", self.args.app_port or "3356")),
                        "DB_SERVER": settings.get("DB_SERVER", "127.0.0.1"),
                        "DB_PORT": str(settings.get("DB_PORT", "1433")),
                        "DB_NAME": settings.get("DB_NAME", "Atlasairfare010"),
                        "DB_USER": settings.get("DB_USER", "sa"),
                        "DB_PASSWORD": settings.get("DB_PASSWORD", ""),
                        "DB_ODBC_DRIVER": settings.get("DB_ODBC_DRIVER", "ODBC Driver 18 for SQL Server"),
                    }
                    for name, value in mapping.items():
                        winreg.SetValueEx(key, name, 0, winreg.REG_SZ, value)
            except PermissionError as exc:
                self.emit("Fixing Registry Endpoints", "WARNING", f"Registry update skipped: {exc}", "REGISTRY_PERMISSION", "Run the repair as Administrator.")

    @staticmethod
    def parse_host(server):
        value = (server or "127.0.0.1").strip()
        if value.lower().startswith("tcp:"):
            value = value[4:]
        if "," in value:
            value = value.split(",", 1)[0].strip()
        if "\\" in value:
            value = value.split("\\", 1)[0].strip()
        if value in ("", ".", "(local)", "localhost"):
            return "127.0.0.1"
        return value

    @staticmethod
    def tcp_open(host, port, timeout=1.5):
        try:
            with socket.create_connection((host, int(port)), timeout=timeout):
                return True
        except OSError:
            return False

    def discover_sql_ports(self, host, preferred):
        self.emit("Scanning SQL Ports", "STARTED", f"Testing SQL TCP ports on {host}.")
        candidates = []
        for port in [preferred, 1433, 1434, 3009, 3356, 5000, 51433]:
            try:
                port_int = int(port)
            except (TypeError, ValueError):
                continue
            if 1 <= port_int <= 65535 and port_int not in candidates:
                candidates.append(port_int)
        open_ports = [port for port in candidates if self.tcp_open(host, port)]
        self.emit("Scanning SQL Ports", "OK" if open_ports else "WARNING", f"Open SQL candidate ports: {open_ports or 'none'}")
        return open_ports

    def test_sql_handshake(self, server, port, database, user, password):
        host = self.parse_host(server)
        target = f"tcp:{host},{int(port)}"
        self.emit("Verifying Database Handshake", "STARTED", f"Testing {target}/{database} as {user}.")
        try:
            import pyodbc  # type: ignore
            driver = self.args.odbc_driver or "ODBC Driver 18 for SQL Server"
            conn = pyodbc.connect(
                f"DRIVER={{{driver}}};SERVER={target};DATABASE={database};UID={user};PWD={password};Encrypt=no;TrustServerCertificate=yes;Connection Timeout=8",
                timeout=8,
            )
            try:
                cursor = conn.cursor()
                cursor.execute("SELECT 1")
                cursor.fetchone()
            finally:
                conn.close()
            self.emit("Verifying Database Handshake", "OK", f"ODBC login succeeded on {target}.")
            return True, ""
        except Exception as pyodbc_exc:
            sqlcmd = self.find_sqlcmd()
            if not sqlcmd:
                return False, f"pyodbc failed and sqlcmd was not found: {pyodbc_exc}"
            cmd = [sqlcmd, "-S", target, "-d", database, "-U", user, "-P", password, "-C", "-l", "8", "-Q", "SET NOCOUNT ON; SELECT 1;"]
            completed = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
            if completed.returncode == 0:
                self.emit("Verifying Database Handshake", "OK", f"sqlcmd login succeeded on {target}.")
                return True, ""
            return False, (completed.stderr or completed.stdout or str(pyodbc_exc)).strip()

    @staticmethod
    def find_sqlcmd():
        for path_dir in os.environ.get("PATH", "").split(os.pathsep):
            candidate = Path(path_dir) / ("sqlcmd.exe" if os.name == "nt" else "sqlcmd")
            if candidate.exists():
                return str(candidate)
        for candidate in [
            Path(r"C:\Program Files\Microsoft SQL Server\Client SDK\ODBC\170\Tools\Binn\sqlcmd.exe"),
            Path(r"C:\Program Files\Microsoft SQL Server\Client SDK\ODBC\180\Tools\Binn\sqlcmd.exe"),
        ]:
            if candidate.exists():
                return str(candidate)
        return None

    def test_app_port(self, port):
        self.emit("Verifying Application Port", "STARTED", f"Testing ATLAS app port {port}.")
        ok = self.tcp_open("127.0.0.1", int(port), timeout=2)
        self.emit("Verifying Application Port", "OK" if ok else "WARNING", f"127.0.0.1:{port} {'is accepting TCP' if ok else 'is not accepting TCP yet'}.")
        return ok

    def stop_start_task(self):
        task = self.install_root / "Install-ATLAS-StartupTask.ps1"
        if not task.exists():
            self.emit("Restarting ATLAS Runtime", "WARNING", f"Startup task installer not found: {task}", "STARTUP_TASK_MISSING", "Run the update patch Repair option.")
            return
        cmd = ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(task), "-InstallRoot", str(self.install_root), "-StartNow"]
        completed = subprocess.run(cmd, cwd=str(self.install_root), capture_output=True, text=True, timeout=90)
        if completed.returncode == 0:
            self.emit("Restarting ATLAS Runtime", "OK", "ATLAS startup task repaired and started.")
        else:
            self.emit("Restarting ATLAS Runtime", "WARNING", completed.stderr or completed.stdout, "STARTUP_TASK_FAILED", "Check atlas-startup-task-install-err.log.")

    def run(self):
        try:
            if os.name == "nt" and not ctypes.windll.shell32.IsUserAnAdmin():
                self.emit("Privilege Check", "WARNING", "Not running as Administrator.", "NOT_ADMIN", "Run as Administrator to update HKLM registry and service tasks.")
            else:
                self.emit("Privilege Check", "OK", "Administrator rights confirmed.")
        except Exception:
            pass

        settings = self.read_env()
        registry = self.read_registry()
        for key, value in registry.items():
            if key == "ATLASPORT" and "PORT" not in settings:
                settings["PORT"] = value
            elif key not in ("INSTALLROOT", "DATAROOT") and key not in settings:
                settings[key] = value

        settings.setdefault("HOST", "0.0.0.0")
        settings.setdefault("PORT", str(self.args.app_port or 3356))
        settings.setdefault("DB_SERVER", self.args.db_server or "127.0.0.1")
        settings.setdefault("DB_PORT", str(self.args.db_port or 1433))
        settings.setdefault("DB_NAME", self.args.db_name or "Atlasairfare010")
        settings.setdefault("DB_USER", self.args.db_user or "sa")
        settings.setdefault("DB_PASSWORD", self.args.db_password or "")
        settings.setdefault("DB_ODBC_DRIVER", self.args.odbc_driver or "ODBC Driver 18 for SQL Server")
        settings.setdefault("DB_ENCRYPT", "false")
        settings.setdefault("DB_TRUST_SERVER_CERTIFICATE", "true")

        sql_host = self.parse_host(settings["DB_SERVER"])
        preferred_port = int(settings.get("DB_PORT") or 1433)
        open_ports = self.discover_sql_ports(sql_host, preferred_port)
        candidate_ports = open_ports or [preferred_port]
        handshake_error = ""
        selected_port = preferred_port
        for port in candidate_ports:
            ok, error = self.test_sql_handshake(settings["DB_SERVER"], port, settings["DB_NAME"], settings["DB_USER"], settings.get("DB_PASSWORD", ""))
            if ok:
                selected_port = port
                handshake_error = ""
                break
            handshake_error = error
        if handshake_error:
            self.fail("Verifying Database Handshake", Exception(handshake_error), "Confirm SQL TCP/IP port, sa password, and database name. Then rerun this repair.")

        settings["DB_PORT"] = str(selected_port)
        settings["DB_SERVER"] = settings["DB_SERVER"] or "127.0.0.1"
        self.emit("Writing Runtime Configuration", "STARTED", f"Writing .env and registry with DB port {selected_port}, app port {settings['PORT']}.")
        self.write_env(settings)
        self.write_registry(settings)
        self.emit("Writing Runtime Configuration", "OK", "Runtime configuration synchronized.")

        self.stop_start_task()
        time.sleep(3)
        self.test_app_port(int(settings["PORT"]))
        self.emit("Repair Complete", "OK", f"Report written to {self.debug_path}")


def main():
    parser = argparse.ArgumentParser(description="ATLAS login/connectivity repair")
    parser.add_argument("--install-root", default=str(DEFAULT_INSTALL_ROOT))
    parser.add_argument("--data-root", default=str(DEFAULT_DATA_ROOT))
    parser.add_argument("--app-port", type=int, default=None)
    parser.add_argument("--db-server", default="")
    parser.add_argument("--db-port", type=int, default=None)
    parser.add_argument("--db-name", default="")
    parser.add_argument("--db-user", default="")
    parser.add_argument("--db-password", default="")
    parser.add_argument("--odbc-driver", default="")
    args = parser.parse_args()
    fixer = LoginFix(Path(args.install_root), Path(args.data_root), args)
    fixer.run()


if __name__ == "__main__":
    main()
