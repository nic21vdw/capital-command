# Daily channel scan — the entrypoint for Windows Task Scheduler.
#
# Reads the YouTube channel and hands every new live stream to the Stream
# Pipeline, which fans it out into the long-form edit, clips, a podcast MP3, a
# carousel and text posts, and stops at "ready to schedule". It never publishes:
# nothing goes out to a channel unreviewed.
#
# The pipeline runs inside the app, so Capital Command has to be up. This script
# starts it if nothing is listening, and leaves it running afterwards.
#
# Register it to run once a day (adjust the time to suit):
#
#   $action = New-ScheduledTaskAction -Execute "powershell.exe" `
#     -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$PWD\scripts\daily-channel-scan.ps1`""
#   $trigger = New-ScheduledTaskTrigger -Daily -At 6am
#   Register-ScheduledTask -TaskName "Capital Command channel scan" -Action $action -Trigger $trigger `
#     -Description "Run new YouTube live streams through the content pipeline"
#
# A missed run is not a problem: the scan looks back several days and the ledger
# keeps it from taking the same stream twice.

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $root "channel-scan.log"
$baseUrl = if ($env:APP_BASE_URL) { $env:APP_BASE_URL } else { "http://localhost:3000" }

Set-Location $root

# Keep the last few runs rather than growing without bound.
if ((Test-Path $log) -and ((Get-Item $log).Length -gt 2MB)) {
  Move-Item $log "$log.old" -Force
}

$stamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
Add-Content -Path $log -Value "" -Encoding utf8
Add-Content -Path $log -Value "=== channel scan $stamp ===" -Encoding utf8

function Test-App {
  try {
    Invoke-WebRequest -Uri "$baseUrl/api/pipeline" -UseBasicParsing -TimeoutSec 10 | Out-Null
    return $true
  } catch {
    return $false
  }
}

# Start the app if it isn't already up. A scheduled run at 6am can't assume a
# dev server from yesterday is still alive.
$startedByUs = $false
if (-not (Test-App)) {
  Add-Content -Path $log -Value "App not running at $baseUrl — starting it." -Encoding utf8
  Start-Process -FilePath "npm.cmd" -ArgumentList "run", "start" -WorkingDirectory $root -WindowStyle Hidden
  $startedByUs = $true

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

# --limit keeps one run from turning a backlog into an all-day download; the rest
# are picked up tomorrow. Pass extra flags through, so a manual run can do
# `-ExtraArgs "--dry-run"` or `--all` to include ordinary uploads.
$scanArgs = @("tsx", "src/lib/ingest/cli.ts", "scan", "--limit", "2")
if ($args.Count -gt 0) { $scanArgs += $args }

& npx.cmd @scanArgs 2>&1 | Tee-Object -FilePath $log -Append
$code = $LASTEXITCODE

if ($startedByUs) {
  # Left running on purpose: a run that timed out is still being worked on by
  # the app, and killing it here would throw away hours of download.
  Add-Content -Path $log -Value "Leaving the app running so any unfinished run can continue." -Encoding utf8
}

# 78 is "YouTube isn't connected" — worth seeing in the log, not worth alarming
# Task Scheduler about, since it will be true every day until you connect it.
if ($code -eq 78) {
  Add-Content -Path $log -Value "YouTube is not connected; nothing to scan." -Encoding utf8
  exit 0
}

exit $code
