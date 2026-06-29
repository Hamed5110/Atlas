@echo off
powershell -ExecutionPolicy Bypass -File "%~dp0Configure-ATLAS-After-Install.ps1" -InstallRoot "%~dp0"
