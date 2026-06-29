@echo off
powershell -ExecutionPolicy Bypass -File "%~dp0Verify-ATLAS-Installed.ps1" -InstallRoot "%~dp0"
pause
