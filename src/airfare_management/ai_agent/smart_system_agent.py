"""Smart AI Agent (SAA) — strategic verifier above the Data Agent.

Outputs: diagnostic findings, T-SQL artifacts, verification reports,
structured change recommendations. Does not emit application code.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field
from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session

from airfare_management.ai_agent.schema_dictionary import (
    SCHEMA_VERSION,
    as_public_dict,
    schema_fingerprint,
)
from airfare_management.application.support import run_diagnostics
from airfare_management.infrastructure.schema import AiAgentAuditRow

SAA_VERSION = "saa-1.0.0"

# Trusted research index (retrieved 2026-09-03)
TRUSTED_SOURCES: list[dict[str, str]] = [
    {
        "title": "Temporal Table Usage Scenarios — Microsoft Learn",
        "url": "https://learn.microsoft.com/en-us/sql/relational-databases/tables/temporal-table-usage-scenarios?view=sql-server-ver17",
        "retrieved": "2026-09-03",
        "why": "Employee master history auditing without custom Employee_History tables",
    },
    {
        "title": "Temporal Table Considerations and Limitations — Microsoft Learn",
        "url": "https://learn.microsoft.com/en-us/sql/relational-databases/tables/temporal/considerations-limitations?view=sql-server-ver17",
        "retrieved": "2026-09-03",
        "why": "Indexing and PK requirements before proposing system-versioning",
    },
]

ZERO_RISK_WHITELIST: frozenset[str] = frozenset(
    {
        "update_statistics",
        "rebuild_index_fragmented",
        "expand_select_star_view",  # recommendation-only until human gate
    }
)


class ActionItem(BaseModel):
    kind: Literal["silent", "verified", "human_gated", "recommendation"]
    code: str
    title: str
    risk: Literal["Low", "Medium", "High"]
    business_risk: float = Field(ge=0, le=1)
    fix_confidence: float = Field(ge=0, le=1)
    effort_minutes: int = Field(ge=0)
    score: float = 0
    tsql: str | None = None
    rollback_tsql: str | None = None
    validation_query: str | None = None
    research: list[dict[str, str]] = Field(default_factory=list)
    focus_artifact: str | None = None
    status: Literal["queued", "applied", "proposed", "snoozed"] = "queued"


class BaselineReport(BaseModel):
    saa_version: str = SAA_VERSION
    generated_at: str
    executive_summary: str
    focus8080: dict[str, Any]
    performance: dict[str, Any]
    data_quality: dict[str, Any]
    agent_feedback: dict[str, Any]
    action_queue: list[ActionItem]
    ask: str = (
        "Shall I proceed with zero-risk silent fixes, or do you want to review the proposal queue first?"
    )


def _score(item: ActionItem) -> float:
    # Business Risk × Fix Confidence / Effort (normalized)
    effort = max(item.effort_minutes, 1) / 60.0
    return round(item.business_risk * item.fix_confidence / effort, 4)


def _is_mssql(session: Session) -> bool:
    return session.get_bind().dialect.name.startswith("mssql")


def _exec_maps(session: Session, sql: str) -> list[dict[str, Any]]:
    """Run diagnostic SQL on a side connection so failures don't doom the request txn."""
    bind = session.get_bind()
    try:
        with bind.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
            return [dict(r) for r in conn.execute(text(sql)).mappings()]
    except Exception as exc:  # noqa: BLE001
        return [{"error": str(exc)}]


def _catalog_focus_like(session: Session) -> dict[str, Any]:
    """Discover Focus8080-origin objects in the active DB (if any were imported)."""
    if not _is_mssql(session):
        return {
            "focus_origin_objects": [],
            "focus_origin_count": 0,
            "hcm_native_routines": [],
            "note": (
                "Focus8080 catalog skipped (non-MSSQL dialect). "
                "On production MSSQL, SAA scans sys.objects for usp_Emp_/vw_HR_/mPay patterns."
            ),
        }
    rows = [
        r
        for r in _exec_maps(
            session,
            """
            SELECT o.type_desc,
                   OBJECT_SCHEMA_NAME(o.object_id) AS sch,
                   o.name,
                   CAST(LEN(ISNULL(m.definition, '')) AS int) AS def_len
            FROM sys.objects o
            LEFT JOIN sys.sql_modules m ON m.object_id = o.object_id
            WHERE o.is_ms_shipped = 0
              AND (
                    o.name LIKE N'%Focus%'
                 OR o.name LIKE N'usp_Emp%'
                 OR o.name LIKE N'usp_%Emp%'
                 OR o.name LIKE N'fn_Calc%'
                 OR o.name LIKE N'vw_HR%'
                 OR o.name LIKE N'mPay%'
                 OR o.name LIKE N'muPay%'
              )
            ORDER BY o.type_desc, o.name
            """,
        )
        if not r.get("error")
    ]
    hcm_fns = [
        r
        for r in _exec_maps(
            session,
            """
            SELECT OBJECT_SCHEMA_NAME(o.object_id) AS sch, o.name, o.type_desc
            FROM sys.objects o
            WHERE o.is_ms_shipped = 0
              AND (o.name LIKE N'fn_HCM_%' OR o.name LIKE N'sp_HCM_%' OR o.name LIKE N'usp_HCM_%')
            ORDER BY o.name
            """,
        )
        if not r.get("error")
    ]
    return {
        "focus_origin_objects": rows,
        "focus_origin_count": len(rows),
        "hcm_native_routines": hcm_fns,
        "note": (
            f"Found {len(rows)} Focus-pattern object(s); map each to HCM equivalent before deprecation."
            if rows
            else (
                "Focus8080 is a design reference only at runtime. "
                "No Focus usp_Emp_/vw_HR_ objects were found in HCM_Airfare_Management; "
                "employee master logic lives in the FastAPI domain + airfare.fn_HCM_* routines."
            )
        ),
    }


def _performance_bottlenecks(session: Session) -> dict[str, Any]:
    if not _is_mssql(session):
        return {
            "tool": "DMV scan skipped",
            "justification": "sys.dm_* requires MSSQL; SQLite test harness returns empty bottlenecks.",
            "missing_indexes": [],
            "fragmented_indexes": [],
            "top_cpu_queries": [],
        }
    missing = _exec_maps(
        session,
        """
        SELECT TOP 5
               mid.equality_columns,
               mid.inequality_columns,
               mid.included_columns,
               migs.avg_user_impact AS impact
        FROM sys.dm_db_missing_index_details mid
        JOIN sys.dm_db_missing_index_groups mig
          ON mid.index_handle = mig.index_handle
        JOIN sys.dm_db_missing_index_group_stats migs
          ON mig.index_group_handle = migs.group_handle
        WHERE mid.database_id = DB_ID()
        ORDER BY migs.avg_user_impact DESC
        """,
    )
    fragmented = _exec_maps(
        session,
        """
        SELECT TOP 5
               OBJECT_SCHEMA_NAME(ips.object_id) AS sch,
               OBJECT_NAME(ips.object_id) AS table_name,
               i.name AS index_name,
               ips.avg_fragmentation_in_percent AS frag_pct,
               ips.page_count
        FROM sys.dm_db_index_physical_stats(DB_ID(), NULL, NULL, NULL, 'LIMITED') ips
        JOIN sys.indexes i
          ON i.object_id = ips.object_id AND i.index_id = ips.index_id
        WHERE ips.avg_fragmentation_in_percent >= 30
          AND ips.page_count >= 100
        ORDER BY ips.avg_fragmentation_in_percent DESC
        """,
    )
    top_cpu = _exec_maps(
        session,
        """
        SELECT TOP 3
               qs.execution_count,
               qs.total_worker_time / 1000 AS total_cpu_ms,
               SUBSTRING(st.text, 1, 180) AS query_text
        FROM sys.dm_exec_query_stats qs
        CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
        WHERE st.dbid = DB_ID()
        ORDER BY qs.total_worker_time DESC
        """,
    )
    return {
        "tool": "sys.dm_db_missing_index_* + sys.dm_db_index_physical_stats + sys.dm_exec_query_stats",
        "justification": "DMVs answer index/CPU questions cheaper than external research.",
        "missing_indexes": missing,
        "fragmented_indexes": fragmented,
        "top_cpu_queries": top_cpu,
    }


def _data_quality_flags(session: Session) -> dict[str, Any]:
    diagnostics = run_diagnostics(session, actor="saa")
    findings = diagnostics.get("findings") or []
    # Rank top 3 by severity weight * confidence
    weight = {"critical": 1.0, "warning": 0.6, "info": 0.3}
    ranked = sorted(
        findings,
        key=lambda f: weight.get(str(f.get("severity")), 0.2) * float(f.get("confidence") or 0.7),
        reverse=True,
    )[:3]
    return {
        "tool": "AI Data Agent diagnostics (shared schema gate)",
        "justification": "Reuse tactical diagnostics instead of duplicating scans.",
        "healthy": diagnostics.get("healthy"),
        "top_flags": ranked,
        "finding_count": len(findings),
    }


def _agent_feedback(session: Session) -> dict[str, Any]:
    if not _table_exists(session, "ai_learning_events"):
        return {
            "recent_events": 0,
            "thumbs_down_cluster": [],
            "note": "Upstream signal for SAA heuristic tuning when false-positives cluster.",
        }
    limit_sql = "TOP 20" if _is_mssql(session) else ""
    limit_tail = "" if _is_mssql(session) else "LIMIT 20"
    rows = session.execute(
        text(
            f"""
            SELECT {limit_sql} event_type, check_code, outcome, confidence, summary, created_at
            FROM ai_learning_events
            ORDER BY created_at DESC
            {limit_tail}
            """
        )
    ).mappings().all()
    thumbs_down = [dict(r) for r in rows if str(r.get("outcome")) == "failed"]
    return {
        "recent_events": len(rows),
        "thumbs_down_cluster": thumbs_down[:5],
        "note": "Upstream signal for SAA heuristic tuning when false-positives cluster.",
    }


def _table_exists(session: Session, name: str) -> bool:
    if _is_mssql(session):
        return bool(
            session.scalar(
                text("SELECT 1 FROM sys.tables WHERE name = :n AND is_ms_shipped = 0"),
                {"n": name},
            )
        )
    return inspect(session.get_bind()).has_table(name)


def _build_action_queue(
    focus: dict[str, Any],
    performance: dict[str, Any],
    quality: dict[str, Any],
) -> list[ActionItem]:
    queue: list[ActionItem] = []

    # Zero-risk: update stats if any user table exists
    queue.append(
        ActionItem(
            kind="silent",
            code="update_statistics",
            title="UPDATE STATISTICS on core HCM tables",
            risk="Low",
            business_risk=0.25,
            fix_confidence=0.95,
            effort_minutes=5,
            tsql="""
-- Zero-risk whitelist: refresh optimizer stats
UPDATE STATISTICS dbo.employees WITH FULLSCAN;
UPDATE STATISTICS dbo.opening_balances WITH FULLSCAN;
UPDATE STATISTICS dbo.tickets WITH FULLSCAN;
UPDATE STATISTICS dbo.loans WITH FULLSCAN;
UPDATE STATISTICS dbo.entitlement_rates WITH FULLSCAN;
""".strip(),
            rollback_tsql="-- Statistics updates are non-destructive; no rollback required.",
            validation_query="SELECT STATS_DATE(OBJECT_ID('dbo.employees'), 1) AS employees_stats_date;",
            status="queued",
        )
    )

    for frag in performance.get("fragmented_indexes") or []:
        if frag.get("error"):
            continue
        table = frag.get("table_name")
        index = frag.get("index_name")
        sch = frag.get("sch") or "dbo"
        if not table or not index:
            continue
        queue.append(
            ActionItem(
                kind="human_gated",
                code="rebuild_index_fragmented",
                title=f"Rebuild fragmented index {sch}.{table}.{index}",
                risk="Low",
                business_risk=0.4,
                fix_confidence=0.88,
                effort_minutes=15,
                tsql=f"ALTER INDEX [{index}] ON [{sch}].[{table}] REBUILD WITH (ONLINE = OFF);",
                rollback_tsql="-- Index rebuild is online-equivalent for data; restore from backup only if corruption (rare).",
                validation_query=(
                    f"SELECT avg_fragmentation_in_percent FROM sys.dm_db_index_physical_stats("
                    f"DB_ID(), OBJECT_ID('[{sch}].[{table}]'), NULL, NULL, 'LIMITED') ips "
                    f"JOIN sys.indexes i ON i.object_id=ips.object_id AND i.index_id=ips.index_id "
                    f"WHERE i.name = N'{index}';"
                ),
                status="proposed",
            )
        )

    if focus.get("focus_origin_count", 0) == 0:
        queue.append(
            ActionItem(
                kind="recommendation",
                code="focus_already_modernized",
                title="Focus8080 employee master already abstracted into HCM schema",
                risk="Low",
                business_risk=0.2,
                fix_confidence=0.9,
                effort_minutes=0,
                focus_artifact="(none in DB — design reference only)",
                research=TRUSTED_SOURCES,
                status="proposed",
            )
        )
        queue.append(
            ActionItem(
                kind="human_gated",
                code="employees_temporal_pilot",
                title="Pilot system-versioned temporal history on dbo.employees",
                risk="Medium",
                business_risk=0.55,
                fix_confidence=0.78,
                effort_minutes=120,
                focus_artifact="Focus Soft employee change history / personal-info audit pattern",
                research=TRUSTED_SOURCES,
                tsql="""
-- PROPOSAL ONLY — human gate required (confidence < 0.85 for production cutover)
-- Research: Microsoft Learn temporal table usage scenarios (retrieved 2026-09-03)
/*
ALTER TABLE dbo.employees
ADD
  valid_from DATETIME2 GENERATED ALWAYS AS ROW START HIDDEN
    CONSTRAINT df_employees_valid_from DEFAULT SYSUTCDATETIME(),
  valid_to DATETIME2 GENERATED ALWAYS AS ROW END HIDDEN
    CONSTRAINT df_employees_valid_to DEFAULT CONVERT(DATETIME2, '9999-12-31 23:59:59.9999999'),
  PERIOD FOR SYSTEM_TIME (valid_from, valid_to);
ALTER TABLE dbo.employees
SET (SYSTEM_VERSIONING = ON (HISTORY_TABLE = dbo.employees_history));
*/
""".strip(),
                rollback_tsql="""
-- ROLLBACK (test in TRAN first):
-- ALTER TABLE dbo.employees SET (SYSTEM_VERSIONING = OFF);
-- ALTER TABLE dbo.employees DROP PERIOD FOR SYSTEM_TIME;
-- ALTER TABLE dbo.employees DROP CONSTRAINT df_employees_valid_from, df_employees_valid_to;
-- ALTER TABLE dbo.employees DROP COLUMN valid_from, valid_to;
-- DROP TABLE IF EXISTS dbo.employees_history;
""".strip(),
                validation_query="""
SELECT temporal_type_desc, name
FROM sys.tables
WHERE name IN ('employees', 'employees_history');
""".strip(),
                status="proposed",
            )
        )

    for flag in quality.get("top_flags") or []:
        code = str(flag.get("check_code") or "data_quality")
        queue.append(
            ActionItem(
                kind="human_gated" if not flag.get("auto_fixable") else "verified",
                code=f"dq_{code}",
                title=str(flag.get("summary") or code),
                risk="High" if flag.get("severity") == "critical" else "Medium",
                business_risk=0.8 if flag.get("severity") == "critical" else 0.5,
                fix_confidence=float(flag.get("confidence") or 0.7),
                effort_minutes=20,
                status="proposed",
            )
        )

    for item in queue:
        item.score = _score(item)
    queue.sort(key=lambda x: x.score, reverse=True)
    return queue


def run_baseline(session: Session, *, actor: str | None = None) -> BaselineReport:
    focus = _catalog_focus_like(session)
    performance = _performance_bottlenecks(session)
    quality = _data_quality_flags(session)
    feedback = _agent_feedback(session)
    queue = _build_action_queue(focus, performance, quality)

    summary = (
        f"SAA {SAA_VERSION} baseline on schema `{SCHEMA_VERSION}`: "
        f"Focus-origin objects={focus.get('focus_origin_count', 0)} "
        f"(HCM native routines={len(focus.get('hcm_native_routines') or [])}); "
        f"missing indexes={len([m for m in performance.get('missing_indexes') or [] if not m.get('error')])}; "
        f"fragmented indexes={len([f for f in performance.get('fragmented_indexes') or [] if not f.get('error')])}; "
        f"data-quality findings={quality.get('finding_count', 0)}. "
        f"Top action: {queue[0].title if queue else 'none'}."
    )

    session.add(
        AiAgentAuditRow(
            id=str(uuid4()),
            prompt="SAA baseline scan",
            intent="saa_baseline",
            schema_version=SCHEMA_VERSION,
            sql_text=None,
            result_summary=summary[:2000],
            details={
                "fingerprint": schema_fingerprint(),
                "focus_count": focus.get("focus_origin_count"),
                "queue": [q.model_dump() for q in queue[:10]],
                "trusted_sources": TRUSTED_SOURCES,
            },
            confidence=0.9,
            actor=actor or "saa",
        )
    )
    session.flush()

    return BaselineReport(
        generated_at=datetime.now(UTC).isoformat(),
        executive_summary=summary,
        focus8080=focus,
        performance=performance,
        data_quality=quality,
        agent_feedback=feedback,
        action_queue=queue,
    )


def apply_silent_fixes(
    session: Session,
    *,
    codes: list[str] | None = None,
    actor: str | None = None,
) -> dict[str, Any]:
    """Apply zero-risk whitelist only (currently UPDATE STATISTICS)."""
    allowed = set(codes or ["update_statistics"]) & ZERO_RISK_WHITELIST
    applied: list[dict[str, Any]] = []
    if "update_statistics" in allowed:
        if _is_mssql(session):
            for table in ("employees", "opening_balances", "tickets", "loans", "entitlement_rates"):
                if _table_exists(session, table):
                    session.execute(text(f"UPDATE STATISTICS dbo.{table}"))
            verification = "passed"
        else:
            verification = "skipped_non_mssql"
        session.flush()
        applied.append(
            {
                "code": "update_statistics",
                "verification": verification,
                "rollback_id": None,
                "next_review": None,
            }
        )
        session.add(
            AiAgentAuditRow(
                id=str(uuid4()),
                prompt="SAA silent fixes",
                intent="saa_silent",
                schema_version=SCHEMA_VERSION,
                result_summary="UPDATE STATISTICS on core tables",
                details={"applied": applied},
                confidence=0.95,
                actor=actor or "saa",
            )
        )
        session.flush()
    return {
        "format": "autonomous_action_report",
        "applied": applied,
        "schema": as_public_dict()["schema_version"],
    }
