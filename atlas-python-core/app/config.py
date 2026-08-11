import os


def env(name: str, default: str) -> str:
    value = os.environ.get(name)
    return value if value not in (None, "") else default


APP_NAME = "atlas-python-core"
APP_VERSION = "0.1.0"
PORT = int(env("ATLAS_PYTHON_PORT", env("PORT", "3356")))
DB_SERVER = env("ATLAS_PYTHON_DB_SERVER", env("DB_SERVER", "localhost"))
DB_PORT = env("ATLAS_PYTHON_DB_PORT", env("DB_PORT", "1433"))
DB_NAME = env("ATLAS_PYTHON_DB_NAME", env("DB_NAME", "AtlasPythonCore"))
DB_USER = env("ATLAS_PYTHON_DB_USER", env("DB_USER", "sa"))
DB_PASSWORD = env("ATLAS_PYTHON_DB_PASSWORD", env("DB_PASSWORD", "Atlas@25"))
DB_ENCRYPT = env("ATLAS_PYTHON_DB_ENCRYPT", "no")
DB_TRUST_CERT = env("ATLAS_PYTHON_DB_TRUST_CERT", "yes")

TENANT_ID = "11111111-1111-4111-8111-111111111111"
COMPANY_ID = "22222222-2222-4222-8222-222222222222"


def connection_string(database: str | None = None) -> str:
    server = DB_SERVER
    if "\\" in server:
        server_part = server
    elif DB_PORT:
        server_part = f"{server},{DB_PORT}"
    else:
        server_part = server
    return (
        f"Server={server_part};"
        f"Database={database or DB_NAME};"
        f"UID={DB_USER};"
        f"PWD={DB_PASSWORD};"
        f"TrustServerCertificate={DB_TRUST_CERT};"
        f"Encrypt={DB_ENCRYPT};"
    )
