@echo off
echo Testing ATLAS server from this PC...
echo.
set "ATLAS_HOST=FOCUSSERVER"
echo 1. Testing ping to %ATLAS_HOST%
ping %ATLAS_HOST%
echo.
echo 2. Testing ATLAS IIS port 80 by name
powershell -NoProfile -ExecutionPolicy Bypass -Command "Test-NetConnection '%ATLAS_HOST%' -Port 80 | Format-List ComputerName,RemoteAddress,TcpTestSucceeded"
echo.
echo 3. Testing ATLAS direct port 3355 by name
powershell -NoProfile -ExecutionPolicy Bypass -Command "Test-NetConnection '%ATLAS_HOST%' -Port 3355 | Format-List ComputerName,RemoteAddress,TcpTestSucceeded"
echo.
echo 4. Testing ATLAS health URL
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-RestMethod 'http://%ATLAS_HOST%/api/health' -TimeoutSec 10 | ConvertTo-Json } catch { Write-Host $_.Exception.Message -ForegroundColor Red }"
echo.
echo If TcpTestSucceeded is False, the network/router/firewall/name lookup is blocking access.
echo If health works here, open http://%ATLAS_HOST%/
echo.
pause
