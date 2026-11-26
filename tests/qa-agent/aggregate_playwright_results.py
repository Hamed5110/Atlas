"""Merge per-project Playwright agent reports into playwright-combined.json.

Orchestration Fixes §2.1 Option A.
"""

from __future__ import annotations

import json
import sys
from datetime import UTC, datetime
from pathlib import Path

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from _paths import qa_report_dir, resolve_repo_root


def main() -> int:
    root = resolve_repo_root(Path(__file__))
    report_dir = qa_report_dir(root)
    files = sorted(
        f
        for f in report_dir.glob("playwright-*.json")
        if f.name not in {"playwright-combined.json", "playwright-last.json"}
    )
    if not files:
        print(f"FAIL no playwright-{{project}}.json under {report_dir}")
        return 1

    cases: list[dict] = []
    projects: list[str] = []
    duration_ms = 0
    status = "passed"
    for path in files:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
        project = data.get("project") or path.stem.replace("playwright-", "", 1)
        projects.append(str(project))
        duration_ms += int(data.get("duration_ms") or 0)
        if data.get("status") not in {None, "passed"}:
            status = str(data.get("status"))
        for case in data.get("cases") or []:
            row = dict(case)
            row.setdefault("project", project)
            cases.append(row)

    combined = {
        "generated_at": datetime.now(UTC).isoformat(),
        "duration_ms": duration_ms,
        "status": status,
        "projects": projects,
        "sources": [f.name for f in files],
        "cases": cases,
        "counts": {
            "total": len(cases),
            "passed": sum(1 for c in cases if c.get("status") == "passed"),
            "failed": sum(1 for c in cases if c.get("status") == "failed"),
            "skipped": sum(1 for c in cases if c.get("status") == "skipped"),
            "flaky": sum(
                1 for c in cases if int(c.get("retries") or 0) > 0 and c.get("status") == "passed"
            ),
            "timedOut": sum(1 for c in cases if c.get("status") == "timedOut"),
        },
    }
    out = report_dir / "playwright-combined.json"
    out.write_text(json.dumps(combined, indent=2), encoding="utf-8")
    (report_dir / "playwright-last.json").write_text(json.dumps(combined, indent=2), encoding="utf-8")
    print(
        f"OK combined {len(cases)} cases from {', '.join(projects)} → {out.relative_to(root)}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
