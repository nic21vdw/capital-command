# Registers (or re-registers) the TikTok audit watcher in Windows Task Scheduler.
#
# Checks every few hours whether the app audit has cleared - see
# scripts/tiktok-audit-watch.ps1 for what it does when it has.
#
# Run it from the project folder:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\register-tiktok-audit-task.ps1
#
# To remove it later:
#   Unregister-ScheduledTask -TaskName "Capital Command tiktok audit watch" -Confirm:$false

param(
  [string]$TaskName = "Capital Command tiktok audit watch",
  [int]$IntervalHours = 4
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$script = Join-Path $root "scripts\tiktok-audit-watch.ps1"

if (-not (Test-Path $script)) {
  throw "Could not find $script - run this from the capital-command checkout."
}

# -Hidden below only hides the task in the Task Scheduler UI; a task that runs
# as the logged-on user still flashes up a console window on every tick. Wrap
# the call in `conhost --headless` so it runs with no window at all.
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\conhost.exe" `
  -Argument "--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$script`"" `
  -WorkingDirectory $root

# A daily trigger that repeats all day, rather than a one-off with an infinite
# duration - Task Scheduler rejects TimeSpan::MaxValue as out of range.
$trigger = New-ScheduledTaskTrigger -Daily -At (Get-Date)
$trigger.Repetition = (New-ScheduledTaskTrigger -Once -At (Get-Date) `
  -RepetitionInterval (New-TimeSpan -Hours $IntervalHours) `
  -RepetitionDuration (New-TimeSpan -Days 1)).Repetition

# Not hidden: the whole point is that the approval is noticed. A missed run is
# picked up rather than dropped, so a laptop that slept still reports in.
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Replaced the existing '$TaskName' task."
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
  -Description "Check whether the TikTok app audit has cleared (Capital Command)" | Out-Null

Write-Host "Registered '$TaskName' - every $IntervalHours hours."
Write-Host "Log: $(Join-Path $root 'tiktok-audit-watch.log')"
Write-Host "On approval it writes TIKTOK-APPROVED.txt to your Desktop."
Write-Host "Remove with: Unregister-ScheduledTask -TaskName `"$TaskName`" -Confirm:`$false"
