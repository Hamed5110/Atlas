#!/usr/bin/env python3
"""Sanitize local junk files and sync path catalogs into HCM_Airfare_Management.

Non-breaking ops utility:
  - Default mode is --dry-run (no deletes, no DB writes unless --sync-db with --apply).
  - Additive tables only (ai_local_dataset_catalog, local_tool_catalog, process_execution_log).
  - Idempotent upserts on path_key; safe to re-run.

Examples:
  python scripts/local_workspace_sanitize.py --dry-run
  python scripts/local_workspace_sanitize.py --dry-run --sync-db
  python scripts/local_workspace_sanitize.py --apply --sync-db
  python scripts/local_workspace_sanitize.py --apply --sanitize-only
"""

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import logging
import os
import shutil
import sys
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = Path(__file__).resolve().with_name("local_workspace_sanitize.json")
PROCESS_NAME = "local_workspace_sanitize"

logger = logging.getLogger(PROCESS_NAME)


@dataclass
class Candidate:
    absolute_path: str
    relative_path: str
    root_role: str
    kind: str  # junk_file | junk_dir | dataset | tool
    size_bytes: int = 0
    mtime_utc: str | None = None
    action: str = "review"  # delete | catalog | skip


@dataclass
class RunReport:
    mode: str
    started_at: str
    finished_at: str | None = None
    status: str = "running"
    files_scanned: int = 0
    junk_candidates: int = 0
    deleted: int = 0
    quarantined: int = 0
    bytes_freed: int = 0
    datasets_cataloged: int = 0
    tools_cataloged: int = 0
    empty_dirs_removed: int = 0
    quarantine_root: str | None = None
    errors: list[str] = field(default_factory=list)
    sample_deletes: list[str] = field(default_factory=list)
    sample_quarantined: list[str] = field(default_factory=list)
    sample_datasets: list[str] = field(default_factory=list)
    sample_tools: list[str] = field(default_factory=list)


def utc_now() -> datetime:
    return datetime.now(UTC)


def path_key(absolute_path: str) -> str:
    norm = os.path.normcase(os.path.abspath(absolute_path)).replace("\\", "/")
    return hashlib.sha256(norm.encode("utf-8")).hexdigest()


def load_config(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("Config root must be a JSON object")
    return data


def setup_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


def get_engine() -> Engine:
    sys.path.insert(0, str(ROOT / "src"))
    from airfare_management.config import get_settings

    return create_engine(get_settings().database_url, pool_pre_ping=True)


def ensure_tables(engine: Engine) -> None:
    """Create catalog tables if missing (idempotent; does not alter existing tables)."""
    ddl = [
        """
        IF OBJECT_ID(N'dbo.ai_local_dataset_catalog', N'U') IS NULL
        CREATE TABLE dbo.ai_local_dataset_catalog (
            id NVARCHAR(36) NOT NULL PRIMARY KEY,
            path_key NVARCHAR(64) NOT NULL,
            absolute_path NVARCHAR(1000) NOT NULL,
            relative_path NVARCHAR(1000) NOT NULL,
            root_role NVARCHAR(40) NOT NULL CONSTRAINT DF_ai_lds_role DEFAULT ('ui_workspace'),
            category NVARCHAR(40) NOT NULL CONSTRAINT DF_ai_lds_cat DEFAULT ('dataset'),
            size_bytes BIGINT NOT NULL CONSTRAINT DF_ai_lds_size DEFAULT (0),
            mtime_utc DATETIMEOFFSET NULL,
            checksum_sha256 NVARCHAR(64) NULL,
            status NVARCHAR(20) NOT NULL CONSTRAINT DF_ai_lds_status DEFAULT ('present'),
            metadata_json NVARCHAR(MAX) NOT NULL CONSTRAINT DF_ai_lds_meta DEFAULT ('{}'),
            last_seen_at DATETIMEOFFSET NOT NULL,
            created_at DATETIMEOFFSET NOT NULL,
            updated_at DATETIMEOFFSET NOT NULL,
            CONSTRAINT uq_ai_local_dataset_path_key UNIQUE (path_key)
        )
        """,
        """
        IF OBJECT_ID(N'dbo.local_tool_catalog', N'U') IS NULL
        CREATE TABLE dbo.local_tool_catalog (
            id NVARCHAR(36) NOT NULL PRIMARY KEY,
            path_key NVARCHAR(64) NOT NULL,
            absolute_path NVARCHAR(1000) NOT NULL,
            relative_path NVARCHAR(1000) NOT NULL,
            root_role NVARCHAR(40) NOT NULL CONSTRAINT DF_ltc_role DEFAULT ('api_runtime'),
            tool_name NVARCHAR(200) NOT NULL,
            kind NVARCHAR(40) NOT NULL CONSTRAINT DF_ltc_kind DEFAULT ('script'),
            size_bytes BIGINT NOT NULL CONSTRAINT DF_ltc_size DEFAULT (0),
            mtime_utc DATETIMEOFFSET NULL,
            metadata_json NVARCHAR(MAX) NOT NULL CONSTRAINT DF_ltc_meta DEFAULT ('{}'),
            last_seen_at DATETIMEOFFSET NOT NULL,
            created_at DATETIMEOFFSET NOT NULL,
            updated_at DATETIMEOFFSET NOT NULL,
            CONSTRAINT uq_local_tool_path_key UNIQUE (path_key)
        )
        """,
        """
        IF OBJECT_ID(N'dbo.process_execution_log', N'U') IS NULL
        CREATE TABLE dbo.process_execution_log (
            id NVARCHAR(36) NOT NULL PRIMARY KEY,
            process_name NVARCHAR(80) NOT NULL,
            mode NVARCHAR(20) NOT NULL,
            started_at DATETIMEOFFSET NOT NULL,
            finished_at DATETIMEOFFSET NULL,
            status NVARCHAR(20) NOT NULL CONSTRAINT DF_pel_status DEFAULT ('running'),
            files_scanned INT NOT NULL CONSTRAINT DF_pel_scan DEFAULT (0),
            files_deleted INT NOT NULL CONSTRAINT DF_pel_del DEFAULT (0),
            files_cataloged INT NOT NULL CONSTRAINT DF_pel_cat DEFAULT (0),
            bytes_freed BIGINT NOT NULL CONSTRAINT DF_pel_bytes DEFAULT (0),
            error_message NVARCHAR(MAX) NULL,
            details_json NVARCHAR(MAX) NOT NULL CONSTRAINT DF_pel_details DEFAULT ('{}'),
            created_by NVARCHAR(100) NULL
        )
        """,
    ]
    with engine.begin() as conn:
        for stmt in ddl:
            conn.execute(text(stmt))


def _is_skipped_dir(name: str, skip_names: set[str]) -> bool:
    return name.casefold() in {n.casefold() for n in skip_names}


def _matches_any(name: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatch(name, pat) or fnmatch.fnmatch(name.casefold(), pat.casefold()) for pat in patterns)


def _rel_to(root: Path, path: Path) -> str:
    try:
        return str(path.relative_to(root)).replace("\\", "/")
    except ValueError:
        return path.name


def _file_meta(path: Path) -> tuple[int, str | None]:
    try:
        st = path.stat()
        mtime = datetime.fromtimestamp(st.st_mtime, tz=UTC).isoformat()
        return int(st.st_size), mtime
    except OSError:
        return 0, None


def _path_matches_globs(rel: str, globs: list[str]) -> bool:
    posix = rel.replace("\\", "/")
    name = Path(posix).name
    for g in globs:
        g2 = g.replace("\\", "/")
        if fnmatch.fnmatch(posix, g2) or fnmatch.fnmatch(name, g2):
            return True
        # folder prefix: ".tmp_airports/**"
        if g2.endswith("/**"):
            prefix = g2[:-3].rstrip("/")
            if posix == prefix or posix.startswith(prefix + "/"):
                return True
        # recursive file glob: "scripts/**/*.py"
        if "/**/" in g2:
            head, tail = g2.split("/**/", 1)
            if (posix.startswith(head + "/") or posix.startswith(head + "\\")) and fnmatch.fnmatch(
                name, tail
            ):
                return True
            if posix.startswith(head + "/") and fnmatch.fnmatch(posix[len(head) + 1 :], tail):
                return True
            # also allow nested: scripts/foo/bar.py vs *.py
            if posix.startswith(head + "/") and fnmatch.fnmatch(name, tail):
                return True
        # directory prefix shorthand: "scripts/" or "tools/"
        if g2.endswith("/") and (posix.startswith(g2) or posix.startswith(g2.rstrip("/") + "/")):
            return True
    return False


def scan_root(root_cfg: dict[str, Any], config: dict[str, Any]) -> list[Candidate]:
    root = Path(root_cfg["path"]).resolve()
    role = str(root_cfg.get("role") or "workspace")
    if not root.exists():
        logger.warning("Root missing, skip: %s", root)
        return []

    junk_files = list(config.get("junk_file_globs") or [])
    junk_dirs = {str(x) for x in (config.get("junk_dir_names") or [])}
    junk_prefixes = list(config.get("junk_name_prefixes") or [])
    skip_dirs = {str(x) for x in (config.get("skip_dir_names") or [])}
    protected = {str(x).casefold() for x in (config.get("protected_names") or [])}
    dataset_globs = list(config.get("dataset_globs") or [])
    tool_globs = list(config.get("tool_globs") or [])
    do_sanitize = bool(root_cfg.get("sanitize", True))
    do_datasets = bool(root_cfg.get("catalog_datasets", False))
    do_tools = bool(root_cfg.get("catalog_tools", False))

    out: list[Candidate] = []

    for dirpath, dirnames, filenames in os.walk(root, topdown=True):
        current = Path(dirpath)
        # prune skip dirs in-place
        kept: list[str] = []
        for d in list(dirnames):
            if _is_skipped_dir(d, skip_dirs):
                continue
            if d.casefold() in protected:
                # Walk protected trees for catalog; never delete the protected root.
                kept.append(d)
                continue
            # Junk directories: explicit names only (prefix match is files-only).
            if do_sanitize and d in junk_dirs:
                abs_p = current / d
                size, mtime = 0, None
                try:
                    for fp in abs_p.rglob("*"):
                        if fp.is_file():
                            sz, _ = _file_meta(fp)
                            size += sz
                except OSError as exc:
                    logger.debug("size walk failed %s: %s", abs_p, exc)
                out.append(
                    Candidate(
                        absolute_path=str(abs_p),
                        relative_path=_rel_to(root, abs_p),
                        root_role=role,
                        kind="junk_dir",
                        size_bytes=size,
                        mtime_utc=mtime,
                        action="delete",
                    )
                )
                continue  # do not descend
            kept.append(d)
        dirnames[:] = kept

        for name in filenames:
            path = current / name
            rel = _rel_to(root, path)
            size, mtime = _file_meta(path)

            if do_sanitize and (
                _matches_any(name, junk_files)
                or any(name.startswith(pref) for pref in junk_prefixes)
            ):
                # top-level .tmp_*.pdf etc.
                if name.casefold() not in protected:
                    out.append(
                        Candidate(
                            absolute_path=str(path),
                            relative_path=rel,
                            root_role=role,
                            kind="junk_file",
                            size_bytes=size,
                            mtime_utc=mtime,
                            action="delete",
                        )
                    )
                    continue

            if do_datasets and _path_matches_globs(rel, dataset_globs):
                out.append(
                    Candidate(
                        absolute_path=str(path),
                        relative_path=rel,
                        root_role=role,
                        kind="dataset",
                        size_bytes=size,
                        mtime_utc=mtime,
                        action="catalog",
                    )
                )
            elif do_tools and _path_matches_globs(rel, tool_globs):
                out.append(
                    Candidate(
                        absolute_path=str(path),
                        relative_path=rel,
                        root_role=role,
                        kind="tool",
                        size_bytes=size,
                        mtime_utc=mtime,
                        action="catalog",
                    )
                )

    return out


def delete_candidate(c: Candidate) -> int:
    """Delete file/dir; return bytes freed. Raises on hard failure."""
    path = Path(c.absolute_path)
    freed = c.size_bytes
    if not path.exists():
        return 0
    if path.is_dir():
        shutil.rmtree(path, ignore_errors=False)
    else:
        path.unlink(missing_ok=True)
    return freed


def _unique_dest(dest: Path) -> Path:
    if not dest.exists():
        return dest
    stem = dest.name
    parent = dest.parent
    for i in range(1, 10_000):
        candidate = parent / f"{stem}.__q{i}"
        if not candidate.exists():
            return candidate
    raise OSError(f"Cannot find unique quarantine path for {dest}")


def quarantine_candidate(c: Candidate, quarantine_root: Path, source_root: Path) -> tuple[int, str]:
    """Move junk into unwanted/ for emergency recovery. Returns (bytes, dest_path)."""
    src = Path(c.absolute_path)
    if not src.exists():
        return 0, ""
    try:
        rel = src.resolve().relative_to(source_root.resolve())
    except ValueError:
        rel = Path(c.root_role) / Path(c.relative_path)
    dest = quarantine_root / c.root_role / rel
    dest = _unique_dest(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    # Prefer move; fall back to copy+remove on cross-device lock issues.
    try:
        shutil.move(str(src), str(dest))
    except OSError:
        if src.is_dir():
            shutil.copytree(src, dest, dirs_exist_ok=False)
            shutil.rmtree(src)
        else:
            shutil.copy2(src, dest)
            src.unlink(missing_ok=True)
    return c.size_bytes, str(dest)


def remove_empty_dirs(root: Path, skip_names: set[str]) -> int:
    removed = 0
    if not root.exists():
        return 0
    for dirpath, dirnames, filenames in os.walk(root, topdown=False):
        current = Path(dirpath)
        if current == root:
            continue
        if current.name.casefold() in {n.casefold() for n in skip_names}:
            continue
        try:
            if not any(current.iterdir()):
                current.rmdir()
                removed += 1
        except OSError:
            continue
    return removed


def upsert_dataset(conn: Any, c: Candidate) -> None:
    now = utc_now().isoformat()
    key = path_key(c.absolute_path)
    meta = json.dumps({"source": "local_workspace_sanitize", "kind": c.kind})
    row = conn.execute(
        text("SELECT id FROM ai_local_dataset_catalog WHERE path_key = :k"),
        {"k": key},
    ).fetchone()
    if row:
        conn.execute(
            text(
                """
                UPDATE ai_local_dataset_catalog
                SET absolute_path=:ap, relative_path=:rp, root_role=:role, category=:cat,
                    size_bytes=:sz, mtime_utc=:mt, status='present', metadata_json=:meta,
                    last_seen_at=:now, updated_at=:now
                WHERE path_key=:k
                """
            ),
            {
                "ap": c.absolute_path[:1000],
                "rp": c.relative_path[:1000],
                "role": c.root_role[:40],
                "cat": "dataset",
                "sz": c.size_bytes,
                "mt": c.mtime_utc,
                "meta": meta,
                "now": now,
                "k": key,
            },
        )
    else:
        conn.execute(
            text(
                """
                INSERT INTO ai_local_dataset_catalog
                (id, path_key, absolute_path, relative_path, root_role, category, size_bytes,
                 mtime_utc, checksum_sha256, status, metadata_json, last_seen_at, created_at, updated_at)
                VALUES
                (:id, :k, :ap, :rp, :role, :cat, :sz, :mt, NULL, 'present', :meta, :now, :now, :now)
                """
            ),
            {
                "id": str(uuid4()),
                "k": key,
                "ap": c.absolute_path[:1000],
                "rp": c.relative_path[:1000],
                "role": c.root_role[:40],
                "cat": "dataset",
                "sz": c.size_bytes,
                "mt": c.mtime_utc,
                "meta": meta,
                "now": now,
            },
        )


def upsert_tool(conn: Any, c: Candidate) -> None:
    now = utc_now().isoformat()
    key = path_key(c.absolute_path)
    name = Path(c.absolute_path).name
    kind = "ps1" if name.lower().endswith(".ps1") else "script" if name.lower().endswith(".py") else "tool"
    meta = json.dumps({"source": "local_workspace_sanitize"})
    row = conn.execute(
        text("SELECT id FROM local_tool_catalog WHERE path_key = :k"),
        {"k": key},
    ).fetchone()
    if row:
        conn.execute(
            text(
                """
                UPDATE local_tool_catalog
                SET absolute_path=:ap, relative_path=:rp, root_role=:role, tool_name=:tn, kind=:kind,
                    size_bytes=:sz, mtime_utc=:mt, metadata_json=:meta, last_seen_at=:now, updated_at=:now
                WHERE path_key=:k
                """
            ),
            {
                "ap": c.absolute_path[:1000],
                "rp": c.relative_path[:1000],
                "role": c.root_role[:40],
                "tn": name[:200],
                "kind": kind,
                "sz": c.size_bytes,
                "mt": c.mtime_utc,
                "meta": meta,
                "now": now,
                "k": key,
            },
        )
    else:
        conn.execute(
            text(
                """
                INSERT INTO local_tool_catalog
                (id, path_key, absolute_path, relative_path, root_role, tool_name, kind, size_bytes,
                 mtime_utc, metadata_json, last_seen_at, created_at, updated_at)
                VALUES
                (:id, :k, :ap, :rp, :role, :tn, :kind, :sz, :mt, :meta, :now, :now, :now)
                """
            ),
            {
                "id": str(uuid4()),
                "k": key,
                "ap": c.absolute_path[:1000],
                "rp": c.relative_path[:1000],
                "role": c.root_role[:40],
                "tn": name[:200],
                "kind": kind,
                "sz": c.size_bytes,
                "mt": c.mtime_utc,
                "meta": meta,
                "now": now,
            },
        )


def write_execution_log(
    engine: Engine,
    report: RunReport,
    *,
    dry_run: bool,
    actor: str | None,
) -> str:
    run_id = str(uuid4())
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO process_execution_log
                (id, process_name, mode, started_at, finished_at, status, files_scanned,
                 files_deleted, files_cataloged, bytes_freed, error_message, details_json, created_by)
                VALUES
                (:id, :pn, :mode, :start, :finish, :status, :scan, :deleted, :cataloged, :bytes,
                 :err, :details, :actor)
                """
            ),
            {
                "id": run_id,
                "pn": PROCESS_NAME,
                "mode": "dry_run" if dry_run else "apply",
                "start": report.started_at,
                "finish": report.finished_at,
                "status": report.status,
                "scan": report.files_scanned,
                "deleted": report.deleted,
                "cataloged": report.datasets_cataloged + report.tools_cataloged,
                "bytes": report.bytes_freed,
                "err": "; ".join(report.errors)[:4000] if report.errors else None,
                "details": json.dumps(
                    {
                        "junk_candidates": report.junk_candidates,
                        "quarantine_root": report.quarantine_root,
                        "quarantined": report.quarantined,
                        "sample_deletes": report.sample_deletes[:50],
                        "sample_quarantined": report.sample_quarantined[:50],
                        "sample_datasets": report.sample_datasets[:30],
                        "sample_tools": report.sample_tools[:30],
                        "empty_dirs_removed": report.empty_dirs_removed,
                    }
                ),
                "actor": actor,
            },
        )
    return run_id


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Dry-run-first local directory sanitize + MSSQL catalog sync."
    )
    mode = p.add_mutually_exclusive_group()
    mode.add_argument(
        "--dry-run",
        dest="apply",
        action="store_false",
        help="Preview only (default). No deletes or catalog writes.",
    )
    mode.add_argument(
        "--apply",
        dest="apply",
        action="store_true",
        help="Move junk into unwanted/ (quarantine) and optional DB sync.",
    )
    p.set_defaults(apply=False)
    p.add_argument("--sync-db", action="store_true", help="Upsert dataset/tool catalogs into MSSQL.")
    p.add_argument(
        "--log-dry-run",
        action="store_true",
        help="Even in dry-run, write a process_execution_log row (requires DB).",
    )
    p.add_argument("--sanitize-only", action="store_true", help="Skip catalog upserts.")
    p.add_argument("--catalog-only", action="store_true", help="Skip quarantine moves.")
    p.add_argument("--config", type=Path, default=DEFAULT_CONFIG, help="JSON config path.")
    p.add_argument("--ensure-schema", action="store_true", help="CREATE TABLE IF NOT EXISTS catalog tables.")
    p.add_argument("--migrate", action="store_true", help="Run alembic upgrade for 0014 (optional).")
    p.add_argument("--actor", default=os.environ.get("USERNAME") or "ops")
    p.add_argument("--verbose", "-v", action="store_true")
    p.add_argument("--json-out", type=Path, help="Write report JSON to this path.")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    setup_logging(args.verbose)
    dry_run = not args.apply
    started = utc_now()
    report = RunReport(mode="dry_run" if dry_run else "apply", started_at=started.isoformat())

    try:
        config = load_config(args.config)
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to load config: %s", exc)
        return 2

    engine: Engine | None = None
    if args.sync_db or args.log_dry_run or args.ensure_schema or args.migrate or args.apply:
        try:
            engine = get_engine()
        except Exception as exc:  # noqa: BLE001
            logger.error("Database connection failed: %s", exc)
            if args.sync_db or args.apply and args.sync_db:
                return 3
            engine = None

    if args.migrate and engine is not None:
        import subprocess

        logger.info("Running alembic upgrade head …")
        proc = subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            logger.error("Alembic failed: %s", proc.stderr or proc.stdout)
            return 4
        logger.info("Alembic OK")

    if args.ensure_schema and engine is not None:
        try:
            ensure_tables(engine)
            logger.info("Catalog tables ensured.")
        except Exception as exc:  # noqa: BLE001
            logger.error("ensure_schema failed: %s", exc)
            return 5

    all_candidates: list[Candidate] = []
    for root_cfg in config.get("roots") or []:
        try:
            found = scan_root(root_cfg, config)
            all_candidates.extend(found)
            report.files_scanned += len(found)
        except Exception as exc:  # noqa: BLE001
            msg = f"scan failed for {root_cfg.get('path')}: {exc}"
            logger.exception(msg)
            report.errors.append(msg)

    junk = [c for c in all_candidates if c.action == "delete"]
    datasets = [c for c in all_candidates if c.kind == "dataset"]
    tools = [c for c in all_candidates if c.kind == "tool"]
    report.junk_candidates = len(junk)
    report.sample_deletes = [c.relative_path for c in junk[:40]]
    report.sample_datasets = [c.relative_path for c in datasets[:30]]
    report.sample_tools = [c.relative_path for c in tools[:30]]

    quarantine_root = Path(
        str(config.get("quarantine_root") or (Path(r"C:\Airfare_Allowance") / "unwanted"))
    ).resolve()
    report.quarantine_root = str(quarantine_root)
    role_to_root = {
        str(r.get("role")): Path(str(r["path"])).resolve()
        for r in (config.get("roots") or [])
        if r.get("path")
    }

    logger.info(
        "Scan complete: junk=%s datasets=%s tools=%s mode=%s quarantine=%s",
        len(junk),
        len(datasets),
        len(tools),
        report.mode,
        quarantine_root,
    )
    for c in junk[:25]:
        logger.info("  [QUARANTINE?] %s (%s bytes)", c.absolute_path, c.size_bytes)
    if len(junk) > 25:
        logger.info("  … %s more junk candidates", len(junk) - 25)

    max_bytes = int(config.get("max_delete_bytes") or 0)
    planned_bytes = sum(c.size_bytes for c in junk)
    if max_bytes and planned_bytes > max_bytes:
        msg = f"Refusing: planned quarantine {planned_bytes} bytes exceeds max_delete_bytes={max_bytes}"
        logger.error(msg)
        report.errors.append(msg)
        report.status = "refused"
        report.finished_at = utc_now().isoformat()
        if args.json_out:
            args.json_out.write_text(json.dumps(asdict(report), indent=2), encoding="utf-8")
        return 6

    # Quarantine junk into unwanted/ (keep for emergency) — never permanent delete.
    if not args.catalog_only:
        if dry_run:
            logger.info("Dry-run: no moves to unwanted/ performed.")
        else:
            quarantine_root.mkdir(parents=True, exist_ok=True)
            readme = quarantine_root / "README_EMERGENCY_RESTORE.txt"
            if not readme.exists():
                readme.write_text(
                    "Emergency quarantine for Atlas HCM / Airfare_Allowance junk files.\n"
                    "Items here were moved (not deleted) by local_workspace_sanitize.py.\n"
                    "Layout: unwanted/<root_role>/<original relative path>\n"
                    "To restore: move the file/folder back to its original workspace path.\n",
                    encoding="utf-8",
                )
            for c in junk:
                try:
                    source_root = role_to_root.get(c.root_role) or Path(c.absolute_path).anchor
                    freed, dest = quarantine_candidate(c, quarantine_root, Path(source_root))
                    report.quarantined += 1
                    report.deleted += 1  # process_execution_log column = items removed from workspace
                    report.bytes_freed += freed
                    if len(report.sample_quarantined) < 40 and dest:
                        report.sample_quarantined.append(dest)
                except Exception as exc:  # noqa: BLE001
                    msg = f"quarantine failed {c.absolute_path}: {exc}"
                    logger.warning(msg)
                    report.errors.append(msg)
            skip = {str(x) for x in (config.get("skip_dir_names") or [])}
            skip.add("unwanted")
            for root_cfg in config.get("roots") or []:
                if not root_cfg.get("sanitize", True):
                    continue
                try:
                    report.empty_dirs_removed += remove_empty_dirs(
                        Path(root_cfg["path"]).resolve(), skip
                    )
                except Exception as exc:  # noqa: BLE001
                    report.errors.append(f"empty-dir pass: {exc}")

    # DB catalog sync
    do_sync = args.sync_db and not args.sanitize_only and engine is not None
    if do_sync and dry_run and not args.apply:
        logger.info("Dry-run: catalog upserts skipped (pass --apply --sync-db to write).")
    elif do_sync and not dry_run:
        try:
            ensure_tables(engine)
            with engine.begin() as conn:
                for c in datasets:
                    upsert_dataset(conn, c)
                    report.datasets_cataloged += 1
                for c in tools:
                    upsert_tool(conn, c)
                    report.tools_cataloged += 1
            logger.info(
                "Catalog upserts: datasets=%s tools=%s",
                report.datasets_cataloged,
                report.tools_cataloged,
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("Catalog sync failed (rolled back): %s", exc)
            report.errors.append(str(exc))
            report.status = "error"
            report.finished_at = utc_now().isoformat()
            if args.json_out:
                args.json_out.write_text(json.dumps(asdict(report), indent=2), encoding="utf-8")
            return 7

    report.status = "ok" if not report.errors else ("ok_with_errors" if report.deleted or dry_run else "error")
    report.finished_at = utc_now().isoformat()

    if engine is not None and (args.apply or args.log_dry_run):
        try:
            if args.ensure_schema or args.sync_db or args.log_dry_run or args.apply:
                ensure_tables(engine)
            run_id = write_execution_log(engine, report, dry_run=dry_run, actor=args.actor)
            logger.info("process_execution_log id=%s", run_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not write process_execution_log: %s", exc)
            report.errors.append(f"execution_log: {exc}")

    if args.json_out:
        args.json_out.write_text(json.dumps(asdict(report), indent=2), encoding="utf-8")
        logger.info("Report written: %s", args.json_out)

    logger.info(
        "Done status=%s quarantined=%s bytes_moved=%s cataloged=%s errors=%s root=%s",
        report.status,
        report.quarantined,
        report.bytes_freed,
        report.datasets_cataloged + report.tools_cataloged,
        len(report.errors),
        report.quarantine_root,
    )
    print(json.dumps(asdict(report), indent=2))
    return 0 if report.status in {"ok", "ok_with_errors"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
