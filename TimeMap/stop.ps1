# TimeMap Windows stopper — kills frontend and backend processes

param()
$scriptDir = $PSScriptRoot

Write-Host 'Stopping TimeMap servers...'

foreach ($port in @(3001, 5173, 5174, 5175)) {
    $lines = (& netstat.exe -ano 2>$null) |
             Where-Object { $_ -match ":$port\s" -and $_ -match 'LISTENING' }
    foreach ($line in $lines) {
        $pid = ($line -split '\s+')[-1]
        if ($pid -match '^\d+$' -and [int]$pid -ne 0) {
            Write-Host "  Port $port : killing PID $pid"
            & taskkill.exe /T /F /PID $pid 2>$null | Out-Null
        }
    }
}

$escaped = [regex]::Escape($scriptDir)
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match $escaped } |
    ForEach-Object {
        Write-Host "  Killing PID $($_.ProcessId) ($($_.Name))"
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

Write-Host 'Done.'
