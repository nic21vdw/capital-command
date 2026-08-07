# Registers (or re-registers) the daily channel scan in Windows Task Scheduler.
#
# One task, once a day. Each run reads the YouTube channel and hands every new
# live stream to the Stream Pipeline, stopping at "ready to schedule" - see
# scripts/daily-channel-scan.ps1. Nothing it does publishes.
#
# Run it from the PRODUCTION folder only. Like the other registrars, it points
# Task Scheduler at whatever checkout it runs in - registered from a sandbox
# worktree, the 6am run drives that sandbox's data and the real one never scans:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\register-channel-scan-task.ps1
#
# To remove it later:
#   Unregister-ScheduledTask -TaskName "Capital Command channel scan" -Confirm:$false

param(
  [string]$TaskName = "Capital Command channel scan",
  [string]$At = "6:00am"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$script = Join-Path $root "scripts\daily-channel-scan.ps1"

if (-not (Test-Path $script)) {
  throw "Could not find $script - run this from the capital-command checkout."
}

# -Hidden below only hides the task in the Task Scheduler UI; a task that runs
# as the logged-on user still flashes up a console window on every tick. Wrap
# the call in `conhost --headless` so it runs with no window at all.
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\conhost.exe" `
  -Argument "--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$script`"" `
  -WorkingDirectory $root

$trigger = New-ScheduledTaskTrigger -Daily -At $At

# A missed run is picked up rather than dropped - a PC that was off at 6am should
# still scan when it comes back, and the ledger keeps that from taking the same
# stream twice.
#
# The execution limit is hours, not minutes, because a run downloads a whole
# three-hour stream and drives it through the pipeline. Only one instance runs at
# a time, so this also bounds how long a wedged run can block tomorrow's.
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -Hidden `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 6)

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Replaced the existing '$TaskName' task."
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
  -Description "Run new YouTube live streams through the content pipeline (Capital Command)" | Out-Null

Write-Host "Registered '$TaskName' - daily at $At."
Write-Host "It will run from: $root"
Write-Host "Log: $(Join-Path $root 'channel-scan.log')"
Write-Host "It builds and starts the app if nothing is listening, and leaves it running."
Write-Host "Remove with: Unregister-ScheduledTask -TaskName `"$TaskName`" -Confirm:`$false"
