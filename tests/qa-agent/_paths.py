"""Shared path helpers for QA Agent scripts."""

from __future__ import annotations

import os
from pathlib import Path


def resolve_repo_root(start: Path | None = None) -> Path:
    """Resolve repository root from REPO_ROOT env or by walking up for markers."""
    env = os.environ.get("REPO_ROOT", "").strip()
    if env:
        root = Path(env).resolve()
        if root.is_dir():
            return root
        raise SystemExit(f"Could not resolve repository root. REPO_ROOT={env!r} is not a directory.")

    here = (start or Path(__file__)).resolve()
    for candidate in [here, *here.parents]:
        if (candidate / ".git").exists() or (candidate / "package.json").is_file():
            return candidate
    raise SystemExit(
        "Could not resolve repository root. Set REPO_ROOT env var "
        "(CI: REPO_ROOT=${{ github.workspace }})."
    )


def qa_report_dir(root: Path | None = None) -> Path:
    base = root or resolve_repo_root()
    path = base / "test-reports" / "qa-agent"
    path.mkdir(parents=True, exist_ok=True)
    return path
