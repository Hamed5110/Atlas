@echo off
set "SCRIPT=C:\Airfare_Allowance\Reset-ATLAS-LAN-Fresh-Admin.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File ""%SCRIPT%""'"
