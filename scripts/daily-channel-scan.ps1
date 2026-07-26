# Daily channel ingest scan — the entrypoint for Windows Task Scheduler.
#
# Reads the YouTube channel, skips anything this app published and anything that
# looks like a Short, and takes what is left into the long-form pipeline as an
# analyzed project. It never clips and never publishes.
#
# Register it to run once a day (adjust the time to suit):
#
#   $action = New-ScheduledTaskAction -Execute "powershell.exe" `
#     -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$PWD\scripts\daily-channel-scan.ps1`""
#   $trigger = New-ScheduledTaskTrigger -Daily -At 6am
#   Register-ScheduledTask -TaskName "Capital Command channel scan" -Action $action -Trigger $trigger `
#     -Description "Ingest new YouTube uploads into the content pipeline"
#
# A missed run is not a problem: the scan looks back several days and the ledger
# keeps it from taking the same video twice.

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $root "channel-scan.log"

Set-Location $root

# Keep the last few runs rather than growing without bound.
if ((Test-Path $log) -and ((Get-Item $log).Length -gt 2MB)) {
  Move-Item $log "$log.old" -Force
}

$stamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
Add-Content -Path $log -Value "" -Encoding utf8
Add-Content -Path $log -Value "=== channel scan $stamp ===" -Encoding utf8

# --limit keeps one run from turning a backlog into an all-day download; the rest
# are picked up tomorrow. Pass extra flags through, so a manual run can do
# `-ExtraArgs "--dry-run"`.
$scanArgs = @("tsx", "src/lib/ingest/cli.ts", "scan", "--limit", "3")
if ($args.Count -gt 0) { $scanArgs += $args }

& npx.cmd @scanArgs 2>&1 | Tee-Object -FilePath $log -Append
$code = $LASTEXITCODE

# 78 is "YouTube isn't connected" — worth seeing in the log, not worth alarming
# Task Scheduler about, since it will be true every day until you connect it.
if ($code -eq 78) {
  Add-Content -Path $log -Value "YouTube is not connected; nothing to scan." -Encoding utf8
  exit 0
}

exit $code
