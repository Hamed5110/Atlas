"""Debug /v1/ai/anomalies 500."""

from __future__ import annotations

import traceback
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from airfare_management.ai_agent.anomaly_detector import score_ticket_anomalies
from airfare_management.config import get_settings
from airfare_management.infrastructure.schema import TicketRow


def main() -> None:
    s = get_settings()
    eng = create_engine(str(s.database_url))
    Session = sessionmaker(bind=eng)
    session = Session()
    try:
        tickets = list(
            session.scalars(select(TicketRow).where(TicketRow.deleted_at.is_(None)).limit(20))
        )
        print("cols", [c.name for c in TicketRow.__table__.columns])
        print("n", len(tickets))
        if tickets:
            t = tickets[0]
            print("sample attrs", [a for a in dir(t) if not a.startswith("_")][:40])
            for attr in ("ticket_cost", "entitlement", "entitlement_amount", "employee_id"):
                print(attr, getattr(t, attr, "MISSING"))
        rows = []
        for t in tickets:
            rows.append(
                {
                    "ticket_cost": str(t.ticket_cost),
                    "entitlement": str(getattr(t, "entitlement", None) or getattr(t, "entitlement_amount", None) or "0"),
                    "employee_id": str(t.employee_id),
                }
            )
        print("score", score_ticket_anomalies(rows)[:1])
    except Exception:
        traceback.print_exc()
    finally:
        session.close()


if __name__ == "__main__":
    main()
