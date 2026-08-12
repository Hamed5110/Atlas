from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
VERSION = "0.3.0"
DIST = ROOT / "dist"
BUILD = ROOT / "build"
PACKAGE_DIR = DIST / "atlas-python-core-3388"
ZIP_PATH = DIST / f"atlas-python-core-mssql-v{VERSION}.zip"
MANIFEST_PATH = PACKAGE_DIR / "python-core-manifest.json"


MODULE_COMPATIBILITY = {
    "employeeMaster": {"status": "ready", "api": "/api/v1/employees"},
    "employeeImport": {"status": "ready", "api": "/api/v1/import/verify-preview"},
    "airfareAllocation": {"status": "ready", "api": "/api/v1/airfare/claims"},
    "loansEmi": {"status": "ready", "api": "/api/v1/loans"},
    "seedEvidence": {"status": "ready", "api": "/api/v1/seed-evidence"},
    "reports": {"status": "ready", "api": "/api/v1/reports/run"},
    "preferencesAdmin": {"status": "ready", "api": "/api/v1/admin/settings/{setting_key}"},
    "selfService": {"status": "ready", "api": "/api/v1/me/requests"},
    "attachments": {"status": "ready", "api": "/api/v1/attachments/metadata"},
    "airportSearch": {"status": "ready", "api": "/api/v1/airports"},
    "backupRestoreAudit": {"status": "ready", "api": "/api/v1/admin/backups"},
}


def run_checked(args: list[str], cwd: Path = ROOT) -> None:
    print("RUN:", " ".join(args))
    completed = subprocess.run(args, cwd=cwd, text=True)
    if completed.returncode != 0:
        raise SystemExit(f"Command failed with exit code {completed.returncode}: {' '.join(args)}")


def clean() -> None:
    for path in (DIST, BUILD):
        if path.exists():
            shutil.rmtree(path)
    DIST.mkdir(parents=True, exist_ok=True)


def ensure_dependencies() -> None:
    run_checked([sys.executable, "-m", "pip", "install", "-r", "requirements.txt"])


def build_binary() -> None:
    run_checked([sys.executable, "-m", "PyInstaller", "--clean", "--noconfirm", "AtlasPythonCore3388.spec"])
    if not PACKAGE_DIR.exists():
        raise SystemExit(f"PyInstaller did not create package directory: {PACKAGE_DIR}")


def copy_deployment_files() -> None:
    for folder in ("schema", "scripts", "web", "installer"):
        source = ROOT / folder
        target = PACKAGE_DIR / folder
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(
            source,
            target,
            ignore=shutil.ignore_patterns(
                "__pycache__",
                "*.pyc",
                "logs",
                "dist",
                "build",
                "build_release_artifact.py",
                "verify_build.ps1",
                "verify_build_3388.ps1",
                "verify_exe_build.ps1",
                "001_core.sql",
                "reference_module_source.txt",
            ),
        )
    for file_name in ("requirements.txt", "README.md", "AtlasPythonCore3388.spec", "build_spec.py"):
        source = ROOT / file_name
        if source.exists():
            shutil.copy2(source, PACKAGE_DIR / file_name)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git_commit() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, text=True).strip()
    except Exception:
        return "unknown"


def file_hashes() -> dict[str, str]:
    hashes: dict[str, str] = {}
    for path in sorted(PACKAGE_DIR.rglob("*")):
        if path.is_file() and path.name != "python-core-manifest.json":
            hashes[str(path.relative_to(PACKAGE_DIR)).replace("\\", "/")] = sha256(path)
    return hashes


def write_manifest() -> dict[str, Any]:
    manifest: dict[str, Any] = {
        "product": "ATLAS Python Core",
        "version": VERSION,
        "gitCommit": git_commit(),
        "buildTimestampUtc": datetime.now(timezone.utc).isoformat(),
        "runtime": "python-fastapi-uvicorn",
        "driver": "mssql-python + pyodbc",
        "service": {
            "name": "AtlasPythonCore3388",
            "displayName": "ATLAS Python Core Service (Port 3388)",
            "port": 3388,
            "healthEndpoint": "http://127.0.0.1:3388/api/v1/health",
        },
        "database": {
            "defaultName": "AtlasPythonCore3388",
            "schema": "core",
            "migrationEngine": "scripts/migrate_and_seed.py",
        },
        "runtimeIsolated": True,
        "continuousModelOnly": True,
        "moduleCompatibility": MODULE_COMPATIBILITY,
        "artifactHashes": file_hashes(),
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def write_checksums() -> None:
    lines = []
    for path in sorted(PACKAGE_DIR.rglob("*")):
        if path.is_file():
            lines.append(f"{sha256(path)}  {path.relative_to(PACKAGE_DIR).as_posix()}")
    (PACKAGE_DIR / "SHA256SUMS.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")


def create_zip() -> None:
    if ZIP_PATH.exists():
        ZIP_PATH.unlink()
    with zipfile.ZipFile(ZIP_PATH, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(PACKAGE_DIR.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(DIST))


def main() -> None:
    os.environ["PORT"] = "3388"
    os.environ["ATLAS_PYTHON_PORT"] = "3388"
    clean()
    ensure_dependencies()
    build_binary()
    copy_deployment_files()
    manifest = write_manifest()
    write_checksums()
    create_zip()
    print(json.dumps({
        "status": "PASS",
        "version": manifest["version"],
        "packageDir": str(PACKAGE_DIR),
        "zip": str(ZIP_PATH),
        "sha256": sha256(ZIP_PATH),
    }, indent=2))


if __name__ == "__main__":
    main()




