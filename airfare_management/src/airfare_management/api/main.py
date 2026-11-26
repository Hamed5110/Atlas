"""FastAPI composition root and HTTP transport."""

import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import date
from decimal import Decimal
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from starlette.responses import Response

from airfare_management.application.contracts import (
    CalculateEntitlement,
    CreateEmployee,
    EmployeeCommandHandler,
    EntitlementQueryHandler,
    EventBus,
)
from airfare_management.config import Settings, get_settings
from airfare_management.domain.models import DomainError, Employee
from airfare_management.domain.services import calculate_emi
from airfare_management.infrastructure.database import (
    SqlAlchemyUnitOfWork,
    correlation_context,
    create_session_factory,
)
from airfare_management.infrastructure.security import decode_access_token, require_roles

LOGGER = logging.getLogger("airfare.api")


class Problem(BaseModel):
    """RFC 9457-inspired structured error response."""

    code: str
    title: str
    detail: str
    status: int
    correlation_id: str


class EmployeeCreate(BaseModel):
    """Validated employee creation payload."""

    model_config = ConfigDict(str_strip_whitespace=True)

    code: str = Field(min_length=1, max_length=30, pattern=r"^[A-Za-z0-9_-]+$")
    full_name: str = Field(min_length=2, max_length=200)
    company_id: UUID
    join_date: date
    department: str = Field(default="", max_length=100)
    branch: str = Field(default="", max_length=100)
    email: EmailStr | None = None


class EmployeeResponse(BaseModel):
    """Employee API representation."""

    id: UUID
    code: str
    full_name: str
    company_id: UUID
    join_date: date
    version: int

    @classmethod
    def from_domain(cls, employee: Employee) -> "EmployeeResponse":
        """Map a domain employee to its API form."""
        return cls(
            id=employee.id,
            code=employee.code,
            full_name=employee.full_name,
            company_id=employee.company_id,
            join_date=employee.join_date,
            version=employee.version,
        )


class EntitlementRequest(BaseModel):
    """Validated entitlement preview payload."""

    opening_days: Decimal = Field(ge=0, max_digits=10, decimal_places=4)
    current_working_days: int = Field(ge=0, le=360)
    paid_days: Decimal = Field(ge=0, max_digits=10, decimal_places=4)
    maximum_payout: Decimal = Field(ge=0, max_digits=19, decimal_places=4)


class LoanPreviewRequest(BaseModel):
    """Validated loan EMI preview payload."""

    principal: Decimal = Field(gt=0, max_digits=19, decimal_places=4)
    annual_rate: Decimal = Field(ge=0, le=100, max_digits=8, decimal_places=4)
    installments: int = Field(gt=0, le=600)


class Claims(BaseModel):
    """Validated authentication claims dependency."""

    subject: UUID
    roles: set[str]


def _status_for_error(error: DomainError) -> int:
    if error.code == "forbidden":
        return 403
    if error.code == "invalid_token":
        return 401
    if error.code == "stale_version":
        return 409
    return 422


def create_app(settings: Settings | None = None) -> FastAPI:
    """Create a fully wired FastAPI application.

    Args:
        settings: Optional settings override for tests.

    Returns:
        Configured ASGI application.
    """
    config = settings or get_settings()
    sessions = create_session_factory(config)
    events = EventBus()
    employee_handler = EmployeeCommandHandler(lambda: SqlAlchemyUnitOfWork(sessions), events)
    entitlement_handler = EntitlementQueryHandler()

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        LOGGER.info("api_started", extra={"environment": config.environment})
        yield
        sessions.kw["bind"].dispose()

    app = FastAPI(title="Airfare Management API", version="0.1.0", lifespan=lifespan)
    if config.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=config.cors_origins,
            allow_credentials=False,
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
            allow_headers=["Authorization", "Content-Type", "If-Match", "X-Correlation-ID"],
        )

    @app.middleware("http")
    async def request_log(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        correlation_id = request.headers.get("X-Correlation-ID", str(uuid4()))
        token = correlation_context.set(correlation_id)
        started = time.perf_counter()
        try:
            response = await call_next(request)
            response.headers["X-Correlation-ID"] = correlation_id
            return response
        finally:
            LOGGER.info(
                "request_completed",
                extra={
                    "method": request.method,
                    "path": request.url.path,
                    "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                    "correlation_id": correlation_id,
                },
            )
            correlation_context.reset(token)

    @app.exception_handler(DomainError)
    async def domain_error(request: Request, error: DomainError) -> JSONResponse:
        status = _status_for_error(error)
        problem = Problem(
            code=error.code,
            title="Request rejected",
            detail=str(error),
            status=status,
            correlation_id=correlation_context.get() or "",
        )
        return JSONResponse(status_code=status, content=problem.model_dump())

    def authenticated(authorization: Annotated[str | None, Header()] = None) -> Claims:
        if not authorization or not authorization.startswith("Bearer "):
            raise DomainError("invalid_token", "A Bearer access token is required.")
        payload = decode_access_token(authorization[7:], config)
        return Claims(subject=UUID(payload["sub"]), roles=set(payload.get("roles", ())))

    @app.get("/health")
    def health() -> dict[str, str]:
        """Return liveness state without exposing internals."""
        return {"status": "ok", "version": "0.1.0"}

    @app.post("/v1/entitlements/preview")
    def entitlement_preview(
        payload: EntitlementRequest, claims: Annotated[Claims, Depends(authenticated)]
    ) -> dict[str, Decimal]:
        """Calculate a side-effect-free entitlement preview."""
        require_roles(claims.model_dump(), {"admin", "hr", "manager"})
        result = entitlement_handler.handle(CalculateEntitlement(**payload.model_dump()))
        return {
            "current_days": result.current_days,
            "remaining_days": result.remaining_days,
            "payable": result.payable,
        }

    @app.post("/v1/loans/preview")
    def loan_preview(
        payload: LoanPreviewRequest, claims: Annotated[Claims, Depends(authenticated)]
    ) -> dict[str, Decimal]:
        """Calculate a side-effect-free monthly installment."""
        require_roles(claims.model_dump(), {"admin", "hr", "manager"})
        return {"monthly_installment": calculate_emi(**payload.model_dump())}

    @app.post("/v1/employees", response_model=EmployeeResponse, status_code=201)
    def create_employee(
        payload: EmployeeCreate, claims: Annotated[Claims, Depends(authenticated)]
    ) -> EmployeeResponse:
        """Create an employee within an audited transaction."""
        require_roles(claims.model_dump(), {"admin", "hr"})
        command = CreateEmployee(**payload.model_dump())
        return EmployeeResponse.from_domain(employee_handler.handle(command, claims.subject))

    return app


app = create_app()


def run() -> None:
    """Run the development ASGI server."""
    import uvicorn

    uvicorn.run("airfare_management.api.main:app", host="127.0.0.1", port=8000)
