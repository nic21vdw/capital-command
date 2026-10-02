# Registers (or re-registers) the publish runner in Windows Task Scheduler.
#
# One task, every five minutes, all day. Each tick posts whatever is due on the
# publish queue - see scripts/publish-runner.ps1.
#
# This is what makes scheduling survive a closed terminal. A `npm run
# publish:scheduler` process only lives as long as the shell that started it,
# so a reboot, a logout or a tidied-up session takes the schedule with it.
#
# Run it from the project folder:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\register-publish-task.ps1
#
# To remove it later:
#   Unregister-ScheduledTask -TaskName "Capital Command publish runner" -Confirm:$false

param(
  [string]$TaskName = "Capital Command publish runner",
  [int]$IntervalMinutes = 5
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$script = Join-Path $root "scripts\publish-runner.ps1"

if (-not (Test-Path $script)) {
  throw "Could not find $script - run this from the CoLateral Marketing checkout."
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
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
  -RepetitionDuration (New-TimeSpan -Days 1)).Repetition

# Hidden, no battery gating, and a missed run is picked up rather than dropped -
# a laptop that was asleep should resume posting the queue, not sit out the day.
#
# The execution limit is longer than the Threads one: a tick may upload a whole
# clip and then poll the platform while it processes. Only one instance runs at
# a time, so this also bounds how long a wedged run can block later triggers.
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -Hidden `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 20)

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Replaced the existing '$TaskName' task."
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
  -Description "Post whatever is due on the publish queue (CoLateral Marketing)" | Out-Null

Write-Host "Registered '$TaskName' - every $IntervalMinutes minutes."
Write-Host "Log: $(Join-Path $root 'publish-runner.log')"
Write-Host "Remove with: Unregister-ScheduledTask -TaskName `"$TaskName`" -Confirm:`$false"

