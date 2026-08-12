from __future__ import annotations

def disabled_repository_notice() -> dict[str, str]:
    return {
        "status": "disabled",
        "reason": "The Port 3388 build uses app.database SQLAlchemy sessions and split FastAPI routers only.",
        "activeDatabase": "AtlasPythonCore3388",
    }
