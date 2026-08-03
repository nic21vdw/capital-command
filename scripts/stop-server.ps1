# Stops the app, whoever started it.
#
# The PID file only knows about servers this repo's start-server.ps1 launched.
# The publish runner starts the app too (`npm run start`, when a tick finds
# nothing listening), and so does a hand-run `next start` — neither writes the
# file. Stopping only the recorded PID left that server holding port 3000, the
# rebuilt one failed to bind, and the release looked like it had worked while
# the app carried on serving the old build. So: kill the PID file's process if
# it is alive, then whatever still holds the port.

param(
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root "server.pid"
$stopped = @()

if (Test-Path $pidFile) {
  $recorded = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($recorded) {
    try {
      Stop-Process -Id $recorded -Force -ErrorAction Stop
      $stopped += $recorded
    } catch {
    }
  }
  Remove-Item $pidFile -ErrorAction SilentlyContinue
}

# Whatever is left on the port, regardless of who started it.
$holders = @()
try {
  $holders = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
} catch {
}

foreach ($holder in $holders) {
  if ($stopped -contains $holder) { continue }
  try {
    Stop-Process -Id $holder -Force -ErrorAction Stop
    $stopped += $holder
  } catch {
  }
}

if ($stopped.Count -gt 0) {
  # Give the socket a moment to release before the caller tries to bind it.
  Start-Sleep -Seconds 2
  Write-Output "Stopped server PID(s): $($stopped -join ', ')"
} else {
  Write-Output "Nothing was listening on port $Port."
}
