# Opens Capital Command as a desktop app: starts the server if it isn't already
# up, waits for it to answer, then launches a windowed browser at it - no tabs,
# no address bar, its own taskbar entry.
#
# Double-click "Capital Command.bat" rather than running this directly, and
# `npm run app:shortcut` puts it on the Desktop and Start Menu with an icon.
#
# The server keeps running after the window is closed, which is deliberate: the
# publish runner and the Threads autopilot post through it all day whether or
# not anything is on screen.

param(
  [int]$Port = 3000,
  [switch]$NoWindow
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$url = "http://localhost:$Port"

function Test-App {
  if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
    & curl.exe --silent --output NUL --max-time 5 $url 2>$null
    return ($LASTEXITCODE -eq 0)
  }
  try {
    Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5 | Out-Null
    return $true
  } catch {
    return $false
  }
}

if (Test-App) {
  Write-Host "Capital Command is already running."
} else {
  Write-Host "Starting Capital Command..."
  # start-server.ps1 builds in the foreground and only returns 0 once the port
  # answers, so its exit code is the answer. It has already explained any
  # failure, on screen and in a dialog - opening a window at a dead port on top
  # of that is how a broken release looks like a broken app.
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "start-server.ps1")
  if ($LASTEXITCODE -ne 0) { exit 1 }

  $deadline = (Get-Date).AddMinutes(2)
  while ((Get-Date) -lt $deadline -and -not (Test-App)) {
    Start-Sleep -Seconds 1
  }

  if (-not (Test-App)) {
    Write-Host ""
    Write-Host "The server is listening but did not answer." -ForegroundColor Red
    Write-Host "Check server.err.log and build.log in $root."
    exit 1
  }
  Write-Host "Ready."
}

if ($NoWindow) { exit 0 }

# An installed copy (Chrome's "Install Capital Command") wins if there is one,
# because Windows already gave it a real app identity. Otherwise open a plain
# app window, which looks and behaves the same without installing anything.
$browsers = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)

$browser = $browsers | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($browser) {
  Start-Process -FilePath $browser -ArgumentList "--app=$url", "--window-size=1600,1000"
} else {
  Write-Host "No Chrome or Edge found - opening in your default browser instead."
  Start-Process $url
}
