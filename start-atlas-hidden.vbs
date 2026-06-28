Set shell = CreateObject("WScript.Shell")
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""C:\Airfare_Allowance\Start-ATLAS-Service.ps1"""
shell.Run cmd, 0, False
