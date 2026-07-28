# Registers (or re-registers) the Threads autopilot in Windows Task Scheduler.
#
# One task, every five minutes, all day. Each tick plans today's batch if it
# isn't scheduled yet and posts whatever is due - see scripts/threads-autopilot.ps1.
#
# Run it from the project folder:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\register-threads-task.ps1
#
# To remove it later:
#   Unregister-ScheduledTask -TaskName "Capital Command threads autopilot" -Confirm:$false

param(
  [string]$TaskName = "Capital Command threads autopilot",
  [int]$IntervalMinutes = 5
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$script = Join-Path $root "scripts\threads-autopilot.ps1"

if (-not (Test-Path $script)) {
  throw "Could not find $script - run this from the capital-command checkout."
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`"" `
  -WorkingDirectory $root

# A daily trigger that repeats all day, rather than a one-off with an infinite
# duration - Task Scheduler rejects TimeSpan::MaxValue as out of range.
$trigger = New-ScheduledTaskTrigger -Daily -At (Get-Date)
$trigger.Repetition = (New-ScheduledTaskTrigger -Once -At (Get-Date) `
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
  -RepetitionDuration (New-TimeSpan -Days 1)).Repetition

# Hidden, no battery gating, and a missed run is picked up rather than dropped -
# a laptop that was asleep should resume posting, not sit out the rest of the day.
#
# The execution limit is deliberately short. Only one instance runs at a time,
# so a wedged one would otherwise refuse every later trigger for as long as it
# lives; ten minutes bounds that to a couple of skipped ticks.
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -Hidden `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Replaced the existing '$TaskName' task."
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
  -Description "Generate and post the daily Threads batch (Capital Command)" | Out-Null

Write-Host "Registered '$TaskName' - every $IntervalMinutes minutes."
Write-Host "Log: $(Join-Path $root 'threads-autopilot.log')"
Write-Host "Remove with: Unregister-ScheduledTask -TaskName `"$TaskName`" -Confirm:`$false"
