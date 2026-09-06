"""QA Agent Stage 5 — post-run analysis (Orchestration Fixes §4).

Reads playwright-combined.json (+ optional k6), updates SAA scores,
writes report.md / saa-scores.json / historical JSONL.

Gate policy: Gate 0/1 disabled (no auto-repair commits). Gate 3 blocks exit 1.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _paths import qa_report_dir, resolve_repo_root  # noqa: E402

AGENT_VERSION = "0.6"


def _tier(score: float) -> str:
    if score >= 0.85:
        return "Platinum"
    if score >= 0.70:
        return "Gold"
    if score >= 0.55:
        return "Silver"
    if score >= 0.40:
        return "Bronze"
    return "At Risk"


def _tier_key(score: float) -> str:
    return _tier(score).lower().replace(" ", "_")


def _classify_failure(error: str | None) -> str:
    text = (error or "").casefold()
    if "screenshot" in text or "tohave screenshot" in text or "ratio" in text:
        return "VISUAL_NOISE"
    if "timeout" in text:
        return "TIMING_RACE"
    if "strict mode" in text or "not found" in text or "locator" in text:
        return "SELECTOR_DRIFT"
    if "expect" in text or "assertion" in text:
        return "ASSERTION"
    return "UNKNOWN"


def _git_meta(root: Path) -> tuple[str, str]:
    branch = os.environ.get("GITHUB_HEAD_REF") or os.environ.get("GITHUB_REF_NAME") or "unknown"
    commit = (os.environ.get("GITHUB_SHA") or "")[:7] or "unknown"
    try:
        if branch in {"unknown", "HEAD", ""}:
            branch = subprocess.check_output(
                ["git", "rev-parse", "--abbrev-ref", "HEAD"], text=True, cwd=root
            ).strip()
        if commit == "unknown":
            commit = subprocess.check_output(
                ["git", "rev-parse", "--short", "HEAD"], text=True, cwd=root
            ).strip()
    except Exception:  # noqa: BLE001
        pass
    return branch, commit


def _load_json(path: Path) -> dict | None:
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8-sig"))


def _load_k6(report_dir: Path) -> dict | None:
    for name in ("k6-output.json", "k6-summary.json"):
        data = _load_json(report_dir / name)
        if data:
            return data
    matches = sorted(report_dir.glob("k6-*.json"))
    return _load_json(matches[-1]) if matches else None


def _speed_dim(duration_ms: int) -> float:
    if duration_ms < 15_000:
        return 1.0
    if duration_ms < 45_000:
        return 0.7
    return 0.4


def _update_scores(cases: list[dict], previous: dict | None) -> tuple[dict, float | None]:
    prev_tests = (previous or {}).get("tests") or {}
    # Support both list (spec format) and dict (legacy)
    if isinstance(prev_tests, list):
        prev_map = {t.get("name"): t for t in prev_tests if isinstance(t, dict)}
    else:
        prev_map = prev_tests

    suite_prev = None
    if previous and previous.get("suite_saa") is not None:
        suite_prev = float(previous["suite_saa"])

    out_tests: list[dict] = []
    for case in cases:
        name = f"{case.get('file', '?')}::{case.get('title', '?')}"
        prev = prev_map.get(name) or {}
        hist = prev.get("history") or {
            "runs": int(prev.get("runs") or 0),
            "passes": int(prev.get("passes") or 0),
            "fails": int(prev.get("fails") or 0),
            "flakes": int(prev.get("flakes") or 0),
        }
        runs = int(hist.get("runs") or 0) + 1
        passes = int(hist.get("passes") or 0)
        fails = int(hist.get("fails") or 0)
        flakes = int(hist.get("flakes") or 0)
        status = case.get("status")
        if status == "passed":
            passes += 1
            if int(case.get("retries") or 0) > 0:
                flakes += 1
        elif status in {"failed", "timedOut"}:
            fails += 1

        duration_ms = int(case.get("duration_ms") or 0)
        stability = passes / max(runs, 1)
        accuracy = 1.0 - min(fails / max(runs, 1), 1.0)
        # Placeholder 0.5 for Autonomy / Coverage until Repair Engine / Istanbul (Consolidated §5.4)
        autonomy = 0.5
        coverage = 0.5
        speed = _speed_dim(duration_ms)
        data_health = 1.0 if status == "passed" else 0.5
        saa = (
            stability * 0.25
            + accuracy * 0.20
            + autonomy * 0.20
            + coverage * 0.15
            + speed * 0.10
            + data_health * 0.10
        )
        saa = round(max(0.0, min(1.0, saa)), 3)
        tags = list(case.get("tags") or [])
        is_critical = "critical" in {str(t).casefold() for t in tags}
        failed_status = status in {"failed", "timedOut"}
        gate = 0
        # Consolidated §5.5: Gate 3 if SAA < 0.55 or critical failure; Gate 2 if 0.55–0.69 or non-critical fail
        if saa < 0.55 or (is_critical and failed_status):
            gate = 3
        elif saa < 0.70 or failed_status:
            gate = 2

        out_tests.append(
            {
                "name": name,
                "title": case.get("title"),
                "file": case.get("file"),
                "project": case.get("project"),
                "status": status,
                "duration_ms": duration_ms,
                "saa": saa,
                "tier": _tier_key(saa),
                "dimensions": {
                    "stability": round(stability, 3),
                    "accuracy": round(accuracy, 3),
                    "autonomy": autonomy,
                    "coverage": coverage,
                    "speed": round(speed, 3),
                    "data_health": data_health,
                },
                "gate": gate,
                "tags": tags,
                "last_failure": case.get("error") if status in {"failed", "timedOut"} else None,
                "failure_pattern": _classify_failure(case.get("error"))
                if status in {"failed", "timedOut"}
                else None,
                "history": {"runs": runs, "passes": passes, "fails": fails, "flakes": flakes},
                # legacy fields for older readers
                "runs": runs,
                "passes": passes,
                "fails": fails,
                "flakes": flakes,
            }
        )

    suite_saa = round(sum(t["saa"] for t in out_tests) / len(out_tests), 3) if out_tests else 0.0
    gate_summary = {
        "gate_0": sum(1 for t in out_tests if t["gate"] == 0),
        "gate_1": sum(1 for t in out_tests if t["gate"] == 1),
        "gate_2": sum(1 for t in out_tests if t["gate"] == 2),
        "gate_3": sum(1 for t in out_tests if t["gate"] == 3),
    }
    return (
        {
            "tests": out_tests,
            "suite_saa": suite_saa,
            "suite_saa_previous": suite_prev,
            "suite_saa_delta": round(suite_saa - suite_prev, 3) if suite_prev is not None else None,
            "gate_summary": gate_summary,
        },
        suite_prev,
    )


def _perf_section(k6: dict | None) -> dict:
    if not k6:
        return {
            "k6_run": False,
            "p95_ms": None,
            "p95_baseline_ms": None,
            "p95_delta_pct": None,
            "error_rate_pct": None,
            "alert": None,
            "status": "skipped",
        }
    # Support k6 summary export shape or simplified custom JSON
    metrics = k6.get("metrics") or {}
    duration = metrics.get("http_req_duration") or {}
    values = duration.get("values") or duration
    p95 = values.get("p(95)") or values.get("p95") or k6.get("p95_ms")
    failed = metrics.get("http_req_failed") or {}
    fail_vals = failed.get("values") or failed
    err_rate = fail_vals.get("rate")
    if err_rate is not None and err_rate <= 1:
        err_rate = round(float(err_rate) * 100, 2)
    threshold = float(k6.get("p95_threshold_ms") or 500)
    alert = None
    status = "pass"
    if p95 is not None and float(p95) > threshold:
        alert = f"p95 degraded: {round(float(p95))}ms (threshold: {threshold}ms)"
        status = "fail"
    return {
        "k6_run": True,
        "p95_ms": round(float(p95), 1) if p95 is not None else None,
        "p95_baseline_ms": threshold,
        "p95_delta_pct": None,
        "error_rate_pct": err_rate,
        "alert": alert,
        "status": status,
    }


def build_summary(
    pw: dict,
    score_payload: dict,
    perf: dict,
    branch: str,
    commit: str,
    trigger: str,
) -> str:
    counts = pw.get("counts") or {}
    total = int(counts.get("total") or 0)
    passed = int(counts.get("passed") or 0)
    failed = int(counts.get("failed") or 0)
    skipped = int(counts.get("skipped") or 0)
    flaky = int(counts.get("flaky") or 0)
    pass_rate = round((passed / total) * 100, 1) if total else 0.0
    duration_s = round(int(pw.get("duration_ms") or 0) / 1000, 1)
    suite_saa = float(score_payload.get("suite_saa") or 0)
    delta = score_payload.get("suite_saa_delta")
    if delta is None:
        trend = "→ n/a (first scored run)"
    else:
        arrow = "↑" if delta > 0 else "↓" if delta < 0 else "→"
        trend = f"{arrow} {delta:+.3f} from last run"

    tests = score_payload.get("tests") or []
    tier_counts = {
        "Platinum": sum(1 for t in tests if t.get("tier") == "platinum"),
        "Gold": sum(1 for t in tests if t.get("tier") == "gold"),
        "Silver": sum(1 for t in tests if t.get("tier") == "silver"),
        "Bronze": sum(1 for t in tests if t.get("tier") == "bronze"),
        "At Risk": sum(1 for t in tests if t.get("tier") == "at_risk"),
    }
    attention = [t for t in tests if int(t.get("gate") or 0) >= 2]

    lines = [
        "## ATLAS HCM QA Run — Summary",
        f"**Branch:** `{branch}`  **Commit:** `{commit}`  **Agent:** v{AGENT_VERSION}",
        f"**Trigger:** {trigger}  **Duration:** {duration_s}s",
        "",
        "### ✅ E2E Results",
        f"- **Passed:** {passed}/{total} ({pass_rate}%)",
        f"- **Failed:** {failed}",
        f"- **Skipped:** {skipped}",
        f"- **Flaky:** {flaky} (passed on retry)",
        f"- **Auto-Repaired:** 0 (Gate 0 disabled — Repair Engine not built)",
        "",
    ]

    if attention:
        lines += [
            "### ⚠️ Requires Human Attention (Gate 2+)",
            "| Test | Status | SAA | Duration | Error Snippet | Gate |",
            "|------|--------|-----|----------|---------------|------|",
        ]
        for t in attention:
            title = re.sub(r"\|", "/", str(t.get("title") or t.get("name") or "")[:50])
            err = re.sub(r"\|", "/", str(t.get("last_failure") or "")[:50])
            lines.append(
                f"| `{title}` | {t.get('status')} | {t.get('saa')} | "
                f"{t.get('duration_ms')}ms | {err} | {t.get('gate')} |"
            )
        lines.append("")
    else:
        lines += ["### ⚠️ Requires Human Attention (Gate 2+)", "- None.", ""]

    lines += [
        "### 📊 SAA Trends",
        f"- Suite average: **{suite_saa}** ({trend})",
        f"- Platinum (≥0.85): {tier_counts['Platinum']}",
        f"- Gold (0.70–0.84): {tier_counts['Gold']}",
        f"- Silver (0.55–0.69): {tier_counts['Silver']}",
        f"- Bronze (0.40–0.54): {tier_counts['Bronze']}",
        f"- At Risk (<0.40): {tier_counts['At Risk']}",
        "",
        "### 🚀 Load Test Results",
    ]
    if perf.get("k6_run"):
        lines += [
            f"- **Status:** {perf.get('status')}",
            f"- **p95 Latency:** {perf.get('p95_ms')}ms (threshold: {perf.get('p95_baseline_ms')}ms)",
            f"- **Error Rate:** {perf.get('error_rate_pct')}%",
            f"- **Alert:** {perf.get('alert') or 'None'}",
            "",
        ]
    else:
        lines += [
            "- **Status:** skipped (no k6-output.json)",
            "- **Alert:** None",
            "",
        ]

    lines += [
        "### 🔧 Agent Actions Taken",
        "- Aggregated chromium + visual Playwright results",
        "- Updated SAA scores (6 dimensions; Autonomy/Coverage placeholder 0.5 per Consolidated §5.4)",
        "- Classified failures (diagnose only — no auto-commit)",
        "",
        "### 📁 Artifacts",
        "- `test-reports/qa-agent/playwright-combined.json`",
        "- `test-reports/qa-agent/report.md`",
        "- `test-reports/qa-agent/saa-scores.json`",
        "- `test-reports/qa-agent/saa-scores-historical.jsonl`",
        "",
        "### 🚀 Next Steps",
    ]
    gate3 = int((score_payload.get("gate_summary") or {}).get("gate_3") or 0)
    gate2 = int((score_payload.get("gate_summary") or {}).get("gate_2") or 0)
    if gate3:
        lines.append(f"1. Investigate {gate3} Gate 3 item(s) before merge")
    else:
        lines.append("1. No Gate 3 blockers")
    if gate2:
        lines.append(f"2. Review {gate2} Gate 2 item(s) (SAA 0.55–0.69 or non-critical fail)")
    else:
        lines.append("2. No Gate 2 attention items")
    if perf.get("alert"):
        lines.append(f"3. Address load alert: {perf['alert']}")
    else:
        lines.append("3. Optional: `npm run test:load:agent` / Data Agent `test:agentic:hcm`")
    lines.append("")
    # Drop empty lines from conditional load fields
    return "\n".join(line for line in lines if line is not None)


def main() -> int:
    root = resolve_repo_root(Path(__file__))
    report_dir = qa_report_dir(root)
    combined = report_dir / "playwright-combined.json"
    legacy = report_dir / "playwright-last.json"
    pw_path = combined if combined.is_file() else legacy
    if not pw_path.is_file():
        print(
            f"FAIL missing {combined.name} (and no {legacy.name}) — "
            "run `npm run test:e2e:suite` first"
        )
        return 1

    pw = _load_json(pw_path) or {}
    prev_path = report_dir / "saa-scores.json"
    previous = _load_json(prev_path)
    score_body, _ = _update_scores(pw.get("cases") or [], previous)
    perf = _perf_section(_load_k6(report_dir))
    branch, commit = _git_meta(root)
    trigger = os.environ.get("GITHUB_EVENT_NAME") or "local"
    if os.environ.get("GITHUB_EVENT_NAME") == "pull_request":
        trigger = f"pr #{os.environ.get('GITHUB_REF_NAME', '?')}"

    run_id = f"{datetime.now(UTC).strftime('%Y-%m-%dT%H-%M-%SZ')}-{commit}"
    saa_out = {
        "run_id": run_id,
        "branch": branch,
        "commit": commit,
        "timestamp": datetime.now(UTC).isoformat(),
        "suite_saa": score_body["suite_saa"],
        "suite_saa_previous": score_body.get("suite_saa_previous"),
        "suite_saa_delta": score_body.get("suite_saa_delta"),
        "tests": score_body["tests"],
        "gate_summary": score_body["gate_summary"],
        "performance": perf,
        "note": "Gate 0/1 Playwright auto-repair disabled. MSSQL Smart System Agent is separate.",
    }

    report_md = build_summary(pw, score_body, perf, branch, commit, trigger)
    (report_dir / "report.md").write_text(report_md, encoding="utf-8")
    (report_dir / "last-run-summary.md").write_text(report_md, encoding="utf-8")
    prev_path.write_text(json.dumps(saa_out, indent=2), encoding="utf-8")
    # Also keep a tracked copy under tests/ for local trends (optional)
    tracked = root / "tests" / "qa-agent" / "saa-scores.json"
    tracked.write_text(json.dumps(saa_out, indent=2), encoding="utf-8")

    hist = report_dir / "saa-scores-historical.jsonl"
    with hist.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps({"run_id": run_id, "suite_saa": saa_out["suite_saa"], "gate_summary": saa_out["gate_summary"]}) + "\n")

    # Slack-compatible snippet
    (report_dir / "slack-snippet.json").write_text(
        json.dumps(
            {
                "text": (
                    f"ATLAS QA — {branch}@{commit}: "
                    f"{(pw.get('counts') or {}).get('passed', 0)}/"
                    f"{(pw.get('counts') or {}).get('total', 0)} passed, "
                    f"SAA {saa_out['suite_saa']}, Gate3={saa_out['gate_summary']['gate_3']}"
                )
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    print(report_md)

    gate3 = int(saa_out["gate_summary"]["gate_3"])
    failed = int((pw.get("counts") or {}).get("failed") or 0)
    # Gate 3 blocks; also fail if raw E2E failures exist
    if gate3 or failed:
        return 1
    if perf.get("status") == "fail":
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
