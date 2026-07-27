# Threads autopilot - the entrypoint for Windows Task Scheduler.
#
# One tick does the whole loop: if today's batch isn't scheduled yet, DeepSeek
# writes a fresh pack of posts and both versions of every slot go onto the
# queue; then anything due right now is posted to Threads. Planning is
# idempotent, so running this every few minutes gives you one new batch a day
# and posts that go out on time, with nothing to click.
#
# The queue lives inside the app, so Capital Command has to be up. This script
# starts it if nothing is listening, and leaves it running afterwards.
#
# Register it to run every 5 minutes, all day:
#
#   npm run threads:register
#
# (which is scripts\register-threads-task.ps1 - read that for the settings and
# for how to remove the task again).
#
# A missed run is not a problem: posts more than THREADS_LATE_GRACE_MINUTES
# late are skipped rather than fired, so coming back from an offline morning
# never dumps a backlog into the feed.

param(
  [ValidateSet("tick", "plan", "run-due", "status", "check")]
  [string]$Mode = "tick",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $root "threads-autopilot.log"
$baseUrl = if ($env:APP_BASE_URL) { $env:APP_BASE_URL } else { "http://localhost:3000" }

Set-Location $root

# Keep the last few runs rather than growing without bound.
if ((Test-Path $log) -and ((Get-Item $log).Length -gt 2MB)) {
  Move-Item $log "$log.old" -Force
}

$stamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
Add-Content -Path $log -Value "" -Encoding utf8
Add-Content -Path $log -Value "=== threads $Mode $stamp ===" -Encoding utf8

# curl.exe rather than Invoke-WebRequest: IWR has hung indefinitely here under
# Task Scheduler despite -TimeoutSec, and one wedged instance blocks every later
# trigger for the rest of the day. --max-time cannot hang.
function Test-App {
  if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
    & curl.exe --silent --output NUL --max-time 10 "$baseUrl/api/threads" 2>$null
    return ($LASTEXITCODE -eq 0)
  }
  try {
    Invoke-WebRequest -Uri "$baseUrl/api/threads" -UseBasicParsing -TimeoutSec 10 | Out-Null
    return $true
  } catch {
    return $false
  }
}

if (-not (Test-App)) {
  Add-Content -Path $log -Value "App not running at $baseUrl - starting it." -Encoding utf8
  Start-Process -FilePath "npm.cmd" -ArgumentList "run", "start" -WorkingDirectory $root -WindowStyle Hidden

  $deadline = (Get-Date).AddMinutes(3)
  while ((Get-Date) -lt $deadline -and -not (Test-App)) {
    Start-Sleep -Seconds 5
  }

  if (-not (Test-App)) {
    Add-Content -Path $log -Value "App did not come up within 3 minutes. Is it built? Run 'npm run build'." -Encoding utf8
    exit 1
  }
  Add-Content -Path $log -Value "App is up." -Encoding utf8
}

$cliArgs = @("tsx", "src/lib/threads/cli.ts", $Mode)
if ($DryRun) { $cliArgs += "--dry-run" }

# Written a line at a time rather than through Tee-Object: Tee writes UTF-16 on
# Windows PowerShell, which garbles the log the rest of this script appends to.
& npx.cmd @cliArgs 2>&1 | ForEach-Object {
  $line = "$_"
  Write-Host $line
  Add-Content -Path $log -Value $line -Encoding utf8
}
exit $LASTEXITCODE
