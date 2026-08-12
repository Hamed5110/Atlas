# -*- mode: python ; coding: utf-8 -*-
from __future__ import annotations

from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

ROOT = Path(SPECPATH)

datas = [
    (str(ROOT / "web"), "web"),
    (str(ROOT / "schema" / "mssql" / "Port3388_Complete_Schema.sql"), "schema/mssql"),
    (str(ROOT / "schema" / "mssql" / "Port3388_EmployeeMaster.sql"), "schema/mssql"),
    (str(ROOT / "schema" / "mssql" / "Port3388_Modules_02_11.sql"), "schema/mssql"),
    (str(ROOT / "scripts" / "migrate_and_seed.py"), "scripts"),
]

for package_name in ("fastapi", "pydantic", "sqlalchemy", "uvicorn", "pyodbc"):
    datas += collect_data_files(package_name)

hiddenimports = [
    "app",
    "app.main",
    "app.server",
    "app.database",
    "app.routers",
    "app.routers.employee",
    "app.routers.import_engine",
    "app.routers.entitlement",
    "scripts",
    "scripts.migrate_and_seed",
]
for package_name in (
    "fastapi",
    "pydantic",
    "sqlalchemy",
    "uvicorn",
    "pyodbc",
    "email_validator",
    "multipart",
):
    hiddenimports += collect_submodules(package_name)

a = Analysis(
    ["app/server.py"],
    pathex=[str(ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["pytest", "tests", "tkinter", "IPython", "jupyter", "notebook", "app.db"],
    noarchive=False,
    optimize=1,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="atlas-python-core-3388",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="atlas-python-core-3388",
)
