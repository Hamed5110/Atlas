from __future__ import annotations

import os
from collections.abc import Generator
from urllib.parse import quote_plus

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


class Base(DeclarativeBase):
    pass


def build_mssql_url(database: str | None = None) -> str:
    server = os.getenv("ATLAS_PYTHON_DB_SERVER", "localhost")
    port = os.getenv("ATLAS_PYTHON_DB_PORT", "")
    database_name = database or os.getenv("ATLAS_PYTHON_DB_NAME", "AtlasPythonCore3388")
    username = os.getenv("ATLAS_PYTHON_DB_USER", "sa")
    password = os.getenv("ATLAS_PYTHON_DB_PASSWORD", "Atlas@25")
    driver = os.getenv("ATLAS_PYTHON_ODBC_DRIVER", "ODBC Driver 18 for SQL Server")
    trust_server_certificate = os.getenv("ATLAS_PYTHON_TRUST_CERT", "yes")
    encrypt = os.getenv("ATLAS_PYTHON_ENCRYPT", "yes")
    server_part = f"{server},{port}" if port.strip() else server

    odbc = (
        f"DRIVER={{{driver}}};"
        f"SERVER={server_part};"
        f"DATABASE={database_name};"
        f"UID={username};"
        f"PWD={password};"
        f"Encrypt={encrypt};"
        f"TrustServerCertificate={trust_server_certificate};"
        "Connection Timeout=30;"
    )
    return "mssql+pyodbc:///?odbc_connect=" + quote_plus(odbc)


def create_mssql_engine() -> Engine:
    return create_engine(
        build_mssql_url(),
        pool_size=int(os.getenv("ATLAS_SQL_POOL_SIZE", "10")),
        max_overflow=int(os.getenv("ATLAS_SQL_MAX_OVERFLOW", "20")),
        pool_timeout=int(os.getenv("ATLAS_SQL_POOL_TIMEOUT", "30")),
        pool_recycle=int(os.getenv("ATLAS_SQL_POOL_RECYCLE", "1800")),
        pool_pre_ping=True,
        future=True,
        fast_executemany=True,
    )


engine = create_mssql_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False, future=True)


def create_engine_for_database(database: str) -> Engine:
    return create_engine(
        build_mssql_url(database),
        pool_size=5,
        max_overflow=10,
        pool_timeout=30,
        pool_recycle=1800,
        pool_pre_ping=True,
        future=True,
        fast_executemany=True,
    )


def get_db() -> Generator[Session, None, None]:
    session = SessionLocal()
    try:
        yield session
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def assert_database_ready() -> dict[str, str]:
    with engine.connect() as connection:
        row = connection.execute(text("SELECT @@SERVERNAME AS server_name, DB_NAME() AS database_name")).one()
    return {"serverName": str(row.server_name), "databaseName": str(row.database_name)}

