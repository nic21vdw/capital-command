# Threads autopilot - the entrypoint for Windows Task Scheduler.
#
# One tick does the whole loop: if today's batch isn't scheduled yet, DeepSeek
# writes a fresh pack of posts and both versions of every slot go onto the
# queue; then anything due right now is posted to Threads. Planning is
# idempotent, so running this every few minutes gives you one new batch a day
# and posts that go out on time, with nothing to click.
#
# The queue lives inside the app, so CoLateral Marketing has to be up. This script
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
  [switch]$DryRun,
  [string]$ReplayFile
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "build-lock.ps1")
. (Join-Path $PSScriptRoot "log-files.ps1")
$log = Join-Path $root "threads-autopilot.log"
$baseUrl = if ($env:APP_BASE_URL) { $env:APP_BASE_URL } else { "http://localhost:3000" }

Set-Location $root

Invoke-LogRotation -Path $log

$stamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
Add-LogText -Path $log -Text "=== threads $Mode $stamp ==="

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
  # A release is rebuilding, and the app is down for all of it. Starting a
  # second server now would serve a half-written `.next` and take port 3000
  # from the build that is about to want it. The tick is skipped, not delayed:
  # the next one is minutes away and the release will be finished by then.
  if (Test-BuildInProgress) {
    Add-LogText -Path $log -Text "A build is in progress - leaving it alone this tick."
    exit 0
  }
  if (-not (Test-BuildPresent)) {
    Start-RecoveryBuild -Log $log
    exit 0
  }
  Add-LogText -Path $log -Text "App not running at $baseUrl - starting it."
  try {
    & (Join-Path $PSScriptRoot "start-server.ps1") -Quiet -NoBuild *>&1 | ForEach-Object { Add-LogText -Path $log -Text "$_" }
  } catch {
    Add-LogText -Path $log -Text "start-server.ps1 failed: $($_.Exception.Message)"
  }

  $deadline = (Get-Date).AddMinutes(3)
  while ((Get-Date) -lt $deadline -and -not (Test-App)) {
    Start-Sleep -Seconds 5
  }

  if (-not (Test-App)) {
    Add-LogText -Path $log -Text "App did not come up within 3 minutes. Is it built? Run 'npm run build'."
    exit 1
  }
  Add-LogText -Path $log -Text "App is up."
}

$cliArgs = @("tsx", "src/lib/threads/cli.ts", $Mode)
if ($DryRun) { $cliArgs += "--dry-run" }

if ($ReplayFile) {
  $cliLines = @(Get-Content -LiteralPath $ReplayFile -Encoding UTF8)
  $cliExit = 0
} else {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $cliLines = @(& npx.cmd @cliArgs 2>&1 | ForEach-Object { "$_" })
  $cliExit = $LASTEXITCODE
  $ErrorActionPreference = $previousPreference
}
Write-ThreadsTickSummary -Log $log -Lines $cliLines -ExitCode $cliExit -StatePath (Join-Path $root "threads-autopilot.seen")
$tickExit = $cliExit
if (-not $DryRun -and $Mode -in @("tick", "run-due")) {
  try {
    & (Join-Path $PSScriptRoot "health-toast.ps1") -BaseUrl $baseUrl -Log $log
  } catch {
    Add-LogText -Path $log -Text "Health toast failed: $($_.Exception.Message)"
  }
}
exit $tickExit
