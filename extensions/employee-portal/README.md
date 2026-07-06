# ATLAS Employee Portal Extension

Phase-2 isolated add-on. It shares the existing database and authentication token model, but keeps all new tables under the `ext_emp_` prefix.

Local run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Airfare_Allowance\extensions\employee-portal\pipeline\Start-EmployeePortal-Local.ps1
```

Audit:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Airfare_Allowance\extensions\employee-portal\pipeline\Build-EmployeePortal-Audit.ps1
```
