# ATLAS Employee Portal Extension

Phase-2 isolated add-on. It runs inside the existing ATLAS application port and shares the existing database, service process, and authentication token model. New objects stay under extension prefixes only.

Local run:

```powershell
Start the normal ATLAS application and open the Self Service menu on the same application URL.
```

Audit:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Airfare_Allowance\extensions\employee-portal\pipeline\Build-EmployeePortal-Audit.ps1
```
