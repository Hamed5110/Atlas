from __future__ import annotations

import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
OUT = REPO / "artifacts" / "python-core-mssql-0.1.0"


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    for folder in ["app", "schema", "web", "tests", "tools", "docs"]:
        shutil.copytree(ROOT / folder, OUT / folder)
    for file_name in ["README.md", "requirements.txt"]:
        shutil.copy2(ROOT / file_name, OUT / file_name)

    manifest = {
        "product": "ATLAS Python Core",
        "version": "0.1.0",
        "buildTimestampUtc": datetime.now(timezone.utc).isoformat(),
        "runtime": "python",
        "driver": "mssql-python",
        "defaultPort": 3356,
        "database": {"defaultName": "AtlasPythonCore", "schema": "core"},
        "oldRuntimeLinked": False,
        "annualCloseProcess": False,
        "modules": [
            "signIn",
            "command",
            "employees",
            "companies",
            "entitlement",
            "seedEvidence",
            "allocations",
            "selfService",
            "loans",
            "reports",
            "preferences",
            "diagnostics",
            "securityUsers",
            "support",
            "systemMaintenance",
            "importExport",
        ],
        "hashes": {
            "server": sha256(OUT / "app" / "server.py"),
            "repository": sha256(OUT / "app" / "db.py"),
            "schema": sha256(OUT / "schema" / "mssql" / "001_core.sql"),
            "ui": sha256(OUT / "web" / "index.html"),
        },
    }
    (OUT / "python-core-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"ATLAS Python Core artifact built: {OUT}")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


if __name__ == "__main__":
    main()
