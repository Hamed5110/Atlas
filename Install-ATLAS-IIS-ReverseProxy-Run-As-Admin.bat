@echo off
set "SCRIPT=C:\Airfare_Allowance\Install-ATLAS-IIS-ReverseProxy-Admin.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File ""%SCRIPT%""'"
