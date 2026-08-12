@echo off
setlocal EnableExtensions

cd /d "%~dp0\.."

if "%PORT%"=="" set "PORT=3388"
if not "%PORT%"=="3388" (
  echo FAIL: PORT must be 3388. Current PORT=%PORT%
  exit /b 10
)

if "%ATLAS_PYTHON_PORT%"=="" set "ATLAS_PYTHON_PORT=3388"
if not "%ATLAS_PYTHON_PORT%"=="3388" (
  echo FAIL: ATLAS_PYTHON_PORT must be 3388. Current ATLAS_PYTHON_PORT=%ATLAS_PYTHON_PORT%
  exit /b 11
)

if "%ATLAS_PYTHON_HOST%"=="" set "ATLAS_PYTHON_HOST=0.0.0.0"
if "%ATLAS_PYTHON_CORE_VERSION%"=="" set "ATLAS_PYTHON_CORE_VERSION=0.3.0"
if "%ATLAS_PYTHON_DB_NAME%"=="" set "ATLAS_PYTHON_DB_NAME=AtlasPythonCore3388"
if "%ATLAS_PYTHON_DB_USER%"=="" set "ATLAS_PYTHON_DB_USER=sa"
if "%ATLAS_PYTHON_DB_PORT%"=="" set "ATLAS_PYTHON_DB_PORT=1433"
if "%ATLAS_PYTHON_ENCRYPT%"=="" set "ATLAS_PYTHON_ENCRYPT=yes"
if "%ATLAS_PYTHON_TRUST_CERT%"=="" set "ATLAS_PYTHON_TRUST_CERT=yes"
if "%ATLAS_PYTHON_DB_ENCRYPT%"=="" set "ATLAS_PYTHON_DB_ENCRYPT=yes"
if "%ATLAS_PYTHON_DB_TRUST_CERT%"=="" set "ATLAS_PYTHON_DB_TRUST_CERT=yes"
if "%ATLAS_UVICORN_WORKERS%"=="" set "ATLAS_UVICORN_WORKERS=1"

if "%ATLAS_PYTHON_DB_SERVER%"=="" if "%DB_SERVER%"=="" (
  echo FAIL: Set ATLAS_PYTHON_DB_SERVER or DB_SERVER.
  exit /b 12
)
if "%ATLAS_PYTHON_DB_SERVER%"=="" set "ATLAS_PYTHON_DB_SERVER=%DB_SERVER%"
if "%ATLAS_PYTHON_DB_PASSWORD%"=="" if "%DB_PASSWORD%"=="" (
  echo FAIL: Set ATLAS_PYTHON_DB_PASSWORD or DB_PASSWORD.
  exit /b 13
)
if "%ATLAS_PYTHON_DB_PASSWORD%"=="" set "ATLAS_PYTHON_DB_PASSWORD=%DB_PASSWORD%"
if "%JWT_SECRET%"=="" (
  echo FAIL: Set JWT_SECRET.
  exit /b 14
)

if not exist "atlas-python-core-3388.exe" (
  echo FAIL: Missing bundled runtime atlas-python-core-3388.exe in %CD%.
  exit /b 15
)

"%CD%\atlas-python-core-3388.exe"
exit /b %errorlevel%
