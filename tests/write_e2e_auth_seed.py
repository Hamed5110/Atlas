"""Write Playwright auth seed using JWT issuance (no login — avoids lockouts)."""

from __future__ import annotations

import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

# Always load settings from the HCM product tree (JWT secret must match :3389).
HCM_ROOT = Path(__file__).resolve().parents[1]
os.chdir(HCM_ROOT)
if str(HCM_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(HCM_ROOT / "src"))

from airfare_management.config import get_settings
from airfare_management.infrastructure.security import issue_access_token

OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(r"C:\Airfare_Allowance\tests\e2e\.auth.json")


def main() -> int:
    settings = get_settings()
    # E2E seeds need a long TTL; default API access tokens are only ~30 minutes.
    long_lived = settings.model_copy(update={"access_token_minutes": 1440})
    token = issue_access_token(
        uuid4(),
        {"admin", "hr", "manager", "finance", "auditor", "SYSTEM_ADMIN"},
        long_lived,
        now=datetime.now(UTC),
        username="admin",
        session_id="e2e-seed",
    )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {
                "access_token": token,
                "refresh_token": "e2e-seed-refresh",
                "token_type": "bearer",
                "expires_in": 1440 * 60,
            }
        ),
        encoding="utf-8",
    )
    print(f"auth_seed_written={OUT.exists()} bytes={OUT.stat().st_size} ttl_minutes=1440")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
