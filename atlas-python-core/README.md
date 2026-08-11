# ATLAS Python Core

Fresh MSSQL-first ATLAS core using Microsoft `mssql-python`.

- Runtime: Python stdlib HTTP server
- Database: Microsoft SQL Server
- Schema namespace: `core`
- Default port: `3356`
- Default database: `AtlasPythonCore`
- No annual close/reset process
- No legacy installer attachment
- No JSON application store

Run:

```powershell
Set-Location C:\Airfare_Allowance\atlas-python-core
.\.venv\Scripts\python.exe -m app.server
```
