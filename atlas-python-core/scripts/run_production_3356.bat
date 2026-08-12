@echo off
setlocal EnableExtensions

cd /d "%~dp0\.."

if "%PORT%"=="" set "PORT=3356"
if not "%PORT%"=="3356" (
  echo FAIL: PORT must be 3356. Current PORT=%PORT%
  exit /b 10
)

if "%ATLAS_PYTHON_DB_SERVER%"=="" if "%DB_SERVER%"=="" (
  echo FAIL: Set ATLAS_PYTHON_DB_SERVER or DB_SERVER.
  exit /b 11
)

if "%ATLAS_PYTHON_DB_NAME%"=="" if "%DB_NAME%"=="" set "ATLAS_PYTHON_DB_NAME=AtlasPythonCore"
if "%ATLAS_PYTHON_DB_USER%"=="" if "%DB_USER%"=="" set "ATLAS_PYTHON_DB_USER=sa"
if "%ATLAS_PYTHON_DB_PASSWORD%"=="" if "%DB_PASSWORD%"=="" (
  echo FAIL: Set ATLAS_PYTHON_DB_PASSWORD or DB_PASSWORD.
  exit /b 12
)

if "%JWT_SECRET%"=="" (
  echo FAIL: Set JWT_SECRET.
  exit /b 13
)

if not exist ".venv\Scripts\python.exe" (
  echo FAIL: Missing .venv\Scripts\python.exe. Run python -m venv .venv and install requirements.
  exit /b 14
)

".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 exit /b %errorlevel%

".venv\Scripts\python.exe" scripts\migrate_and_seed.py
if errorlevel 1 exit /b %errorlevel%

".venv\Scripts\python.exe" -m app.server
exit /b %errorlevel%
