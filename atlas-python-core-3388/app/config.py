from __future__ import annotations

import os

def env(name: str, default: str) -> str:
    value = os.environ.get(name)
    return value if value not in (None, "") else default

APP_NAME = "atlas-python-core-3388"
APP_VERSION = env("ATLAS_PYTHON_CORE_VERSION", "0.3.0")
PORT = int(env("ATLAS_PYTHON_PORT", env("PORT", "3388")))
DB_SERVER = env("ATLAS_PYTHON_DB_SERVER", env("DB_SERVER", "localhost"))
DB_PORT = env("ATLAS_PYTHON_DB_PORT", env("DB_PORT", "1433"))
DB_NAME = env("ATLAS_PYTHON_DB_NAME", env("DB_NAME", "AtlasPythonCore3388"))
DB_USER = env("ATLAS_PYTHON_DB_USER", env("DB_USER", "sa"))
DB_PASSWORD = env("ATLAS_PYTHON_DB_PASSWORD", env("DB_PASSWORD", "Atlas@25"))
DB_ENCRYPT = env("ATLAS_PYTHON_DB_ENCRYPT", "yes")
DB_TRUST_CERT = env("ATLAS_PYTHON_DB_TRUST_CERT", "yes")
