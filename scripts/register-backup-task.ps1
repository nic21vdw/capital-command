param(
  [string]$TaskName = "Capital Command state backup",
  [string]$At = "03:30"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$script = Join-Path $root "scripts\backup-runner.ps1"

if (-not (Test-Path $script)) {
  throw "Could not find $script - run this from the CoLateral Marketing checkout."
}

$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\conhost.exe" `
  -Argument "--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$script`"" `
  -WorkingDirectory $root

$trigger = New-ScheduledTaskTrigger -Daily -At ([datetime]$At)

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -Hidden `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Replaced the existing '$TaskName' task."
}

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
  Description = "Zip every queue and setting under data\ to Google Drive or OneDrive and keep the newest 14 (CoLateral Marketing)"
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

Write-Host "Registered '$TaskName' - every day at $At, backing up $(Join-Path $root 'data')."
if ($principal) {
  Write-Host "Runs whether or not you are logged on."
} else {
  Write-Warning "This task only runs while you are logged ON."
  Write-Host "  Re-run this from an Administrator PowerShell to fix that:"
  Write-Host "    npm run backup:register"
}
Write-Host "Log: $(Join-Path $root 'backup-state.log')"
Write-Host "Status: $(Join-Path $root 'data\backup-status.json')"
Write-Host "Run it now with: npm run backup:state"
Write-Host "Remove with: Unregister-ScheduledTask -TaskName `"$TaskName`" -Confirm:`$false"
