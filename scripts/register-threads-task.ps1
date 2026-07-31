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

# A task registered the default way runs only while this account is logged ON.
# A Windows Update reboot then leaves the machine at the login screen with the
# autopilot silently stopped - the feed just goes quiet, with no error anywhere.
# S4U ("run whether the user is logged on or not") survives that, but setting it
# needs elevation, so an ordinary prompt falls back rather than failing outright.
$elevated = ([Security.Principal.WindowsPrincipal] `
  [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

$principal = $null
if ($elevated) {
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Limited
}

$register = @{
  TaskName    = $TaskName
  Action      = $action
  Trigger     = $trigger
  Settings    = $settings
  Description = "Generate and post the daily Threads batch (Capital Command)"
}
if ($principal) { $register.Principal = $principal }

try {
  Register-ScheduledTask @register | Out-Null
} catch {
  if (-not $principal) { throw }
  Write-Warning "Could not register to run while logged out ($($_.Exception.Message)) - falling back."
  $register.Remove("Principal")
  Register-ScheduledTask @register | Out-Null
  $principal = $null
}

Write-Host "Registered '$TaskName' - every $IntervalMinutes minutes."
if ($principal) {
  Write-Host "Runs whether or not you are logged on, so a reboot cannot stop it."
} else {
  Write-Warning "This task only runs while you are logged ON - an overnight reboot will stop it."
  Write-Host "  Re-run this from an Administrator PowerShell to fix that:"
  Write-Host "    npm run threads:register"
}
Write-Host "Log: $(Join-Path $root 'threads-autopilot.log')"
Write-Host "Remove with: Unregister-ScheduledTask -TaskName `"$TaskName`" -Confirm:`$false"

# A sleeping machine posts nothing, and the failure is silent - the feed just
# goes quiet for the night and the morning's slots are skipped. The task cannot
# fix this itself: WakeToRun on a five-minute repetition would wake the machine
# every five minutes all night, which is not sleeping at all. So check the power
# plan here, where someone is already looking.
function Get-IdleTimeout($setting) {
  $raw = powercfg /q SCHEME_CURRENT SUB_SLEEP $setting 2>$null
  $line = $raw | Select-String "Current AC Power Setting Index"
  if (-not $line) { return $null }
  return [Convert]::ToInt32((($line -split ":")[1].Trim()), 16)
}

$standby = Get-IdleTimeout "STANDBYIDLE"
if ($null -ne $standby -and $standby -gt 0) {
  Write-Warning "This PC sleeps after $($standby / 60) minutes idle, so the overnight batch will not post."
  Write-Host "  Keep it awake (the display still turns off) with:"
  Write-Host "    powercfg /change standby-timeout-ac 0"
  Write-Host "    powercfg /change standby-timeout-dc 0"
  Write-Host "    powercfg /change hibernate-timeout-ac 0"
  Write-Host "    powercfg /change hibernate-timeout-dc 0"
} else {
  Write-Host "Power plan: this PC does not sleep on idle - the overnight batch will post."
}
