# TimeMap Windows launcher
# Kills existing frontend/backend processes, starts them in the background,
# and streams output to log files. Prints errors to the terminal if startup fails.

param()
$scriptDir = $PSScriptRoot

# ── helpers ───────────────────────────────────────────────────────────────────

function Stop-Port([int]$Port) {
    $lines = (& netstat.exe -ano 2>$null) |
             Where-Object { $_ -match ":$Port\s" -and $_ -match 'LISTENING' }
    foreach ($line in $lines) {
        $pid = ($line -split '\s+')[-1]
        if ($pid -match '^\d+$' -and [int]$pid -ne 0) {
            Write-Host "  Port $Port : killing PID $pid"
            & taskkill.exe /T /F /PID $pid 2>$null | Out-Null
        }
    }
}

function Test-TcpPort([int]$Port) {
    try {
        $c = New-Object System.Net.Sockets.TcpClient
        $c.Connect('127.0.0.1', $Port)
        $c.Close()
        return $true
    } catch {
        return $false
    }
}

# ── 1. Kill existing processes ────────────────────────────────────────────────

Write-Host 'Stopping any running TimeMap servers...'

foreach ($port in @(3001, 5173, 5174, 5175)) { Stop-Port $port }

# Also kill by command-line pattern, scoped to this project directory
$escaped = [regex]::Escape($scriptDir)
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match $escaped } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Start-Sleep -Seconds 1
Write-Host 'Done.'
Write-Host ''

# ── 2. Start servers in background ───────────────────────────────────────────

$backendLog  = Join-Path $scriptDir 'backend.log'
$frontendLog = Join-Path $scriptDir 'frontend.log'

Write-Host 'Starting backend...'
$backendProc = Start-Process `
    -FilePath         'cmd.exe' `
    -ArgumentList     '/c', "npm --prefix backend run dev > `"$backendLog`" 2>&1" `
    -WorkingDirectory $scriptDir `
    -NoNewWindow `
    -PassThru

Write-Host 'Starting frontend...'
$frontendProc = Start-Process `
    -FilePath         'cmd.exe' `
    -ArgumentList     '/c', "npm --prefix frontend run dev > `"$frontendLog`" 2>&1" `
    -WorkingDirectory $scriptDir `
    -NoNewWindow `
    -PassThru

# ── 3. Wait for both TCP ports to open (max 30 s) ────────────────────────────

Write-Host ''
Write-Host 'Waiting for servers' -NoNewline

$sw          = [System.Diagnostics.Stopwatch]::StartNew()
$backendOk   = $false
$frontendOk  = $false

while ($sw.Elapsed.TotalSeconds -lt 30) {
    if (-not $backendOk)  { $backendOk  = Test-TcpPort 3001 }
    if (-not $frontendOk) { $frontendOk = Test-TcpPort 5173 }
    if ($backendOk -and $frontendOk) { break }
    if ($backendProc.HasExited -or $frontendProc.HasExited) { break }   # crash
    Write-Host '.' -NoNewline
    Start-Sleep -Milliseconds 500
}

Write-Host ''
Write-Host ''

# ── 4. Report ─────────────────────────────────────────────────────────────────

$allOk = $true

if (-not $backendOk -or $backendProc.HasExited) {
    $allOk = $false
    Write-Host 'ERROR: Backend failed to start.' -ForegroundColor Red
    if (Test-Path $backendLog) {
        Write-Host '--- Last output from backend.log ---' -ForegroundColor DarkRed
        Get-Content $backendLog -Tail 30 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkRed }
        Write-Host '------------------------------------' -ForegroundColor DarkRed
    }
    Write-Host ''
}

if (-not $frontendOk -or $frontendProc.HasExited) {
    $allOk = $false
    Write-Host 'ERROR: Frontend failed to start.' -ForegroundColor Red
    if (Test-Path $frontendLog) {
        Write-Host '--- Last output from frontend.log ---' -ForegroundColor DarkRed
        Get-Content $frontendLog -Tail 30 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkRed }
        Write-Host '-------------------------------------' -ForegroundColor DarkRed
    }
    Write-Host ''
}

if ($allOk) {
    Write-Host "Backend  -> http://localhost:3001   (logs: backend.log)"  -ForegroundColor Green
    Write-Host "Frontend -> http://localhost:5173   (logs: frontend.log)" -ForegroundColor Green
    Write-Host ''
    Write-Host 'To stop: .\stop.ps1' -ForegroundColor DarkGray
}
