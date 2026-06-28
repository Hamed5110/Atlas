@echo off
setlocal
set "ATLAS_HOST=FOCUSSERVER"
set "ATLAS_PORT=3355"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$hostName='%ATLAS_HOST%'; $port=%ATLAS_PORT%; $stamp=Get-Date -Format 'yyyyMMdd-HHmmss'; $report=Join-Path ([Environment]::GetFolderPath('Desktop')) ('ATLAS-LAN-CLIENT-TEST-' + $stamp + '.txt');" ^
  "'ATLAS LAN client test' | Set-Content $report; 'Date: ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') | Tee-Object -FilePath $report -Append; 'Target: http://' + $hostName + '/' | Tee-Object -FilePath $report -Append;" ^
  "'=== Client IP ===' | Tee-Object -FilePath $report -Append; Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254*' } | Select-Object IPAddress,InterfaceAlias,PrefixLength | Format-Table -AutoSize | Out-String | Tee-Object -FilePath $report -Append;" ^
  "'=== Name + TCP 80 ===' | Tee-Object -FilePath $report -Append; Test-NetConnection $hostName -Port 80 -InformationLevel Detailed | Format-List | Out-String | Tee-Object -FilePath $report -Append;" ^
  "'=== Name + TCP 3355 ===' | Tee-Object -FilePath $report -Append; Test-NetConnection $hostName -Port $port -InformationLevel Detailed | Format-List | Out-String | Tee-Object -FilePath $report -Append;" ^
  "'=== HTTP LAN Check ===' | Tee-Object -FilePath $report -Append; try { Invoke-WebRequest ('http://' + $hostName + '/api/lan-check') -UseBasicParsing -TimeoutSec 10 | Select-Object StatusCode,Content | Format-List | Out-String | Tee-Object -FilePath $report -Append } catch { $_.Exception.Message | Tee-Object -FilePath $report -Append };" ^
  "'=== HTTP Page ===' | Tee-Object -FilePath $report -Append; try { Invoke-WebRequest ('http://' + $hostName + '/') -UseBasicParsing -TimeoutSec 10 | Select-Object StatusCode,StatusDescription | Format-List | Out-String | Tee-Object -FilePath $report -Append } catch { $_.Exception.Message | Tee-Object -FilePath $report -Append };" ^
  "'=== Browser Launch ===' | Tee-Object -FilePath $report -Append; Start-Process ('http://' + $hostName + '/api/lan-check'); Start-Process ('http://' + $hostName + '/'); 'Report: ' + $report | Tee-Object -FilePath $report -Append; Write-Host ('Report written to: ' + $report) -ForegroundColor Green"
pause
