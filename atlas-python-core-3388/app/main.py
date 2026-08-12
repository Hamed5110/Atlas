from __future__ import annotations

import os
from pathlib import Path
from http import HTTPStatus
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError, OperationalError, SQLAlchemyError

from app.database import assert_database_ready
from app.routers import employee, import_engine, entitlement


APP_VERSION = os.getenv("ATLAS_PYTHON_CORE_VERSION", "0.3.0")
PORT = int(os.getenv("PORT", os.getenv("ATLAS_PYTHON_PORT", "3388")))
ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"


def run_startup_migration() -> None:
    if os.getenv("ATLAS_SKIP_STARTUP_MIGRATION", "").lower() in {"1", "true", "yes"}:
        return

    from scripts import migrate_and_seed

    result = migrate_and_seed.main()
    if result != 0:
        raise RuntimeError("Port 3388 startup migration failed. Database was not created or schema verification failed.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    run_startup_migration()
    app.state.database_ready = assert_database_ready()
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="ATLAS Port 3388 Python Core",
        version=APP_VERSION,
        description="Clean-room Python + MSSQL API with continuous entitlement only.",
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        lifespan=lifespan,
    )

    allowed_origins = [origin.strip() for origin in os.getenv("ATLAS_CORS_ORIGINS", "http://127.0.0.1:3388,http://localhost:3388").split(",") if origin.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "If-Match", "X-Request-ID"],
    )

    app.include_router(employee.router)
    app.include_router(import_engine.router)
    app.include_router(entitlement.router)
    app.mount("/assets", StaticFiles(directory=WEB), name="assets")
    app.mount("/modules", StaticFiles(directory=WEB / "modules"), name="modules")

    register_exception_handlers(app)

    @app.get("/api/v1/health")
    def health() -> dict:
        database = assert_database_ready()
        return {
            "status": "ok",
            "application": "atlas-python-core-fastapi",
            "version": APP_VERSION,
            "port": PORT,
            "runtime": "FastAPI",
            "database": database,
            "oldRuntimeLinked": False,
            "legacyBatchCloseLinked": False,
            "registeredModules": [
                "employees",
                "employee-import",
                "airfare-allocation",
                "loans-emi",
                "seed-evidence",
                "reports",
                "preferences-admin",
                "self-service",
                "attachments",
                "airports",
                "backup-restore-audit",
            ],
        }

    @app.get("/")
    def dashboard() -> FileResponse:
        return FileResponse(WEB / "index.html", media_type="text/html")

    return app


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(HTTPException)
    async def http_exception_handler(_: Request, exc: HTTPException) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"code": "HTTPException", "detail": exc.detail})

    @app.exception_handler(ValidationError)
    async def validation_exception_handler(_: Request, exc: ValidationError) -> JSONResponse:
        return JSONResponse(status_code=HTTPStatus.UNPROCESSABLE_ENTITY, content={"code": "ValidationError", "detail": exc.errors()})

    @app.exception_handler(IntegrityError)
    async def integrity_exception_handler(_: Request, exc: IntegrityError) -> JSONResponse:
        return JSONResponse(status_code=HTTPStatus.CONFLICT, content={"code": "IntegrityError", "detail": "Database constraint conflict."})

    @app.exception_handler(OperationalError)
    async def operational_exception_handler(_: Request, exc: OperationalError) -> JSONResponse:
        return JSONResponse(status_code=HTTPStatus.SERVICE_UNAVAILABLE, content={"code": "OperationalError", "detail": "Database is unavailable."})

    @app.exception_handler(SQLAlchemyError)
    async def sqlalchemy_exception_handler(_: Request, exc: SQLAlchemyError) -> JSONResponse:
        return JSONResponse(status_code=HTTPStatus.INTERNAL_SERVER_ERROR, content={"code": exc.__class__.__name__, "detail": "Database operation failed."})

    @app.exception_handler(Exception)
    async def generic_exception_handler(_: Request, exc: Exception) -> JSONResponse:
        return JSONResponse(status_code=HTTPStatus.INTERNAL_SERVER_ERROR, content={"code": exc.__class__.__name__, "detail": "Unhandled server error."})


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=PORT, reload=False)

