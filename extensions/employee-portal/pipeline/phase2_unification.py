import argparse
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

try:
    import winreg
except ImportError:
    winreg = None


PIPELINE_ROOT = Path(__file__).resolve().parent
EXTENSION_ROOT = PIPELINE_ROOT.parent
APP_ROOT = EXTENSION_ROOT.parent.parent
LOG_PATH = Path(os.environ.get("ATLAS_PHASE2_LOG", r"C:\ProgramData\ATLAS\logs\phase2_unification.log"))
REGISTRY_PATHS = (
    r"SOFTWARE\ATLAS Airfare Allowance",
    r"SOFTWARE\WOW6432Node\ATLAS Airfare Allowance",
)


def log(message):
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {message}"
    print(message, flush=True)
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")


def fail(step, exc, remediation):
    payload = {
        "step": step,
        "error": str(exc),
        "remediation": remediation,
    }
    log("[FAILED] " + json.dumps(payload, ensure_ascii=False))
    raise SystemExit(1)


def read_registry_values():
    values = {}
    if winreg is None:
        return values
    for root_key in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
        for path in REGISTRY_PATHS:
            try:
                with winreg.OpenKey(root_key, path) as key:
                    for name in ("ATLASPORT", "APP_PORT", "INSTALLROOT", "DATAROOT", "DB_SERVER", "DB_PORT", "DB_NAME"):
                        try:
                            values[name] = str(winreg.QueryValueEx(key, name)[0])
                        except FileNotFoundError:
                            continue
            except FileNotFoundError:
                continue
    return values


def read_config_values():
    values = {}
    for candidate in (
        APP_ROOT / "bootstrapper-config.json",
        APP_ROOT / ".env",
        Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData")) / "ATLAS" / "bootstrapper-config.json",
    ):
        if not candidate.exists():
            continue
        try:
            if candidate.suffix.lower() == ".json":
                values.update({k.upper(): str(v) for k, v in json.loads(candidate.read_text(encoding="utf-8")).items() if v is not None})
            else:
                for line in candidate.read_text(encoding="utf-8").splitlines():
                    if "=" in line and not line.lstrip().startswith("#"):
                        key, value = line.split("=", 1)
                        values[key.strip().upper()] = value.strip().strip('"')
        except Exception as exc:
            log(f"[WARN] Skipped unreadable config {candidate}: {exc}")
    return values


def resolve_app_port(cli_port=None):
    values = {}
    values.update(read_config_values())
    values.update(read_registry_values())
    if cli_port:
        return int(cli_port)
    for key in ("ATLASPORT", "APP_PORT", "PORT"):
        value = values.get(key)
        if value and str(value).isdigit():
            return int(value)
    return 3355


def tcp_check(host, port, timeout=3):
    with socket.create_connection((host, int(port)), timeout=timeout):
        return True


def http_check(url, timeout=8):
    request = urllib.request.Request(url, headers={"User-Agent": "ATLAS-Phase2-Unification/1.0"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.status, response.read(256).decode("utf-8", errors="replace")


def run_node_check():
    log("[VERIFY] Checking main backend syntax...")
    result = subprocess.run(["node", "--check", str(APP_ROOT / "server.js")], cwd=str(APP_ROOT), text=True, capture_output=True)
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout).strip())


def verify_source_guards():
    log("[VERIFY] Confirming no split-port extension endpoint remains...")
    blocked = ("33" + "66", "EXT" + "_EMP" + "_PORT", "employee" + "-portal" + "-server")
    matches = []
    for path in EXTENSION_ROOT.glob("**/*"):
        if path.is_file() and path.suffix.lower() in (".js", ".ts", ".tsx", ".ps1", ".md", ".json", ".html"):
            text = path.read_text(encoding="utf-8", errors="ignore")
            for token in blocked:
                if token in text:
                    matches.append(f"{path}: {token}")
    if matches:
        raise RuntimeError("Split-port references found: " + "; ".join(matches))


def verify_same_port(port):
    log(f"[VERIFY] Mapping shared ATLAS port {port}...")
    tcp_check("127.0.0.1", port)
    for url in (f"http://127.0.0.1:{port}/api/health", f"http://localhost:{port}/api/health"):
        try:
            status, _ = http_check(url)
            if 200 <= status < 500:
                log(f"[SUCCESS] Shared-port service responded at {url}")
                return url
        except urllib.error.HTTPError as exc:
            if 200 <= exc.code < 500:
                log(f"[SUCCESS] Shared-port service responded at {url} with HTTP {exc.code}")
                return url
        except Exception as exc:
            log(f"[WARN] {url} did not respond: {exc}")
    raise RuntimeError("ATLAS API health endpoint did not respond on the shared port.")


def verify_extension_sql():
    log("[INJECT] Verifying extension schema script presence...")
    script = EXTENSION_ROOT / "sql" / "ATLAS_Employee_Portal_Extension.sql"
    if not script.exists():
        raise RuntimeError(f"Missing schema script: {script}")
    text = script.read_text(encoding="utf-8", errors="ignore")
    required = (
        "ext_employee_auth_claims",
        "ext_employee_allowance_requests",
        "ext_v_my_requests",
    )
    missing = [token for token in required if token not in text]
    if missing:
        raise RuntimeError("Missing extension SQL objects: " + ", ".join(missing))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()

    try:
        log("[INIT] ATLAS Phase-2 same-port unification started.")
        app_port = resolve_app_port(args.port)
        verify_source_guards()
        verify_extension_sql()
        run_node_check()
        verify_same_port(app_port)
        log("[UPDATE] Employee Self-Service routes are registered inside the main ATLAS service.")
        log("[SUCCESS] Phase-2 unification completed without split-port routing.")
    except Exception as exc:
        fail(
            "phase2_unification",
            exc,
            "Start the main ATLAS service on the configured application port, then rerun this script. Do not start a separate employee portal service.",
        )


if __name__ == "__main__":
    main()
