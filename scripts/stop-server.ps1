$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root "server.pid"

if (-not (Test-Path $pidFile)) {
  Write-Output "No PID file found"
  exit 0
}

$pidValue = Get-Content $pidFile
try {
  Stop-Process -Id $pidValue -Force -ErrorAction Stop
  Write-Output "Stopped server PID $pidValue"
} catch {
  Write-Output "PID $pidValue was not running"
}

Remove-Item $pidFile -ErrorAction SilentlyContinue
