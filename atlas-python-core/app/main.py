from __future__ import annotations

import os
from http import HTTPStatus

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError, OperationalError, SQLAlchemyError

from app.database import assert_database_ready
from app.routers import employee, module_blueprints


APP_VERSION = os.getenv("ATLAS_PYTHON_CORE_VERSION", "0.2.0")
PORT = int(os.getenv("PORT", os.getenv("ATLAS_PYTHON_PORT", "3356")))


def create_app() -> FastAPI:
    app = FastAPI(
        title="ATLAS Port 3356 Python Core",
        version=APP_VERSION,
        description="Clean-room Python + MSSQL API. Zero Year-End process.",
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
    )

    allowed_origins = [origin.strip() for origin in os.getenv("ATLAS_CORS_ORIGINS", "http://127.0.0.1:3356,http://localhost:3356").split(",") if origin.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "If-Match", "X-Request-ID"],
    )

    app.include_router(employee.router)
    app.include_router(module_blueprints.router)

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
            "yearEndProcess": False,
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
        return JSONResponse(status_code=HTTPStatus.CONFLICT, content={"code": "IntegrityError", "detail": "Database constraint conflict.", "driverMessage": str(exc.orig)})

    @app.exception_handler(OperationalError)
    async def operational_exception_handler(_: Request, exc: OperationalError) -> JSONResponse:
        return JSONResponse(status_code=HTTPStatus.SERVICE_UNAVAILABLE, content={"code": "OperationalError", "detail": "Database is unavailable.", "driverMessage": str(exc.orig)})

    @app.exception_handler(SQLAlchemyError)
    async def sqlalchemy_exception_handler(_: Request, exc: SQLAlchemyError) -> JSONResponse:
        return JSONResponse(status_code=HTTPStatus.INTERNAL_SERVER_ERROR, content={"code": exc.__class__.__name__, "detail": "Database operation failed."})

    @app.exception_handler(Exception)
    async def generic_exception_handler(_: Request, exc: Exception) -> JSONResponse:
        return JSONResponse(status_code=HTTPStatus.INTERNAL_SERVER_ERROR, content={"code": exc.__class__.__name__, "detail": str(exc)})


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=PORT, reload=False)
