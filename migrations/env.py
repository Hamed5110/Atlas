"""Alembic migration environment."""

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from airfare_management.config import get_settings
from airfare_management.infrastructure import schema as operational_schema
from airfare_management.infrastructure.database import Base

_ = operational_schema

config = context.config
config.set_main_option("sqlalchemy.url", get_settings().database_url.replace("%", "%%"))
if config.config_file_name:
    fileConfig(config.config_file_name)
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations without creating an Engine."""
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations with a pooled connection."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        dialect_name = connection.dialect.name
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            transaction_per_migration=dialect_name == "mssql",
        )
        if dialect_name == "mssql":
            context.run_migrations()
            return
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
