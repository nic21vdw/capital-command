# Publish runner - the entrypoint for Windows Task Scheduler.
#
# One tick posts whatever is due on the publish queue: scheduled clips go to
# YouTube, TikTok, Instagram and Facebook at their slot time, with nothing to
# click. Register it to run every 5 minutes, all day:
#
#   npm run publish:register
#
# (which is scripts\register-publish-task.ps1 - read that for the settings and
# for how to remove the task again).
#
# The queue lives inside the app, so this drives it over HTTP rather than with
# the CLI. Running `cli.ts run-due` alongside a live app gives the queue file
# two owners, and the app flushing its in-memory copy silently drops whatever
# the CLI wrote - the same trap the Stream Pipeline and Threads queues have.
# So: start the app if nothing is listening, then POST /api/publish/run.
#
# A missed run is not a backlog. Items are posted when due and stay pending
# until a tick sees them, so a laptop that was asleep picks up where it left
# off on the next trigger.

param(
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "build-lock.ps1")
. (Join-Path $PSScriptRoot "log-files.ps1")
$log = Join-Path $root "publish-runner.log"
$baseUrl = if ($env:APP_BASE_URL) { $env:APP_BASE_URL } else { "http://localhost:3000" }

Set-Location $root

Invoke-LogRotation -Path $log

$stamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
Add-LogText -Path $log -Text "=== publish run $stamp ==="

# curl.exe rather than Invoke-WebRequest: IWR has hung indefinitely here under
# Task Scheduler despite -TimeoutSec, and one wedged instance blocks every later
# trigger for the rest of the day. --max-time cannot hang.
function Test-App {
  if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
    & curl.exe --silent --output NUL --max-time 10 "$baseUrl/api/publish" 2>$null
    return ($LASTEXITCODE -eq 0)
  }
  try {
    Invoke-WebRequest -Uri "$baseUrl/api/publish" -UseBasicParsing -TimeoutSec 10 | Out-Null
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
    Add-LogText -Path $log -Text "There is no build to serve (.next\BUILD_ID is missing) - not starting a server."
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

$body = if ($DryRun) { '{"dryRun":true}' } else { '{}' }

# Uploads and the platforms' own processing polls can take minutes, so this is
# given far longer than the health check above.
$responseFile = [System.IO.Path]::GetTempFileName()
$previousPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& curl.exe --silent --show-error --max-time 280 `
  -X POST -H "Content-Type: application/json" -d $body --output $responseFile "$baseUrl/api/publish/run" 2>&1 |
  ForEach-Object { Add-LogText -Path $log -Text "$_" }
$curlExit = $LASTEXITCODE
$ErrorActionPreference = $previousPreference
Write-PublishRunSummary -Log $log -ResponseFile $responseFile -StatePath (Join-Path $root "publish-runner.seen")
Remove-Item -LiteralPath $responseFile -Force -ErrorAction SilentlyContinue
exit $curlExit
