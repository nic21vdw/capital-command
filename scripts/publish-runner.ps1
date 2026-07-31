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
$log = Join-Path $root "publish-runner.log"
$baseUrl = if ($env:APP_BASE_URL) { $env:APP_BASE_URL } else { "http://localhost:3000" }

Set-Location $root

# Keep the last few runs rather than growing without bound.
if ((Test-Path $log) -and ((Get-Item $log).Length -gt 2MB)) {
  Move-Item $log "$log.old" -Force
}

$stamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
Add-Content -Path $log -Value "" -Encoding utf8
Add-Content -Path $log -Value "=== publish run $stamp ===" -Encoding utf8

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
  Add-Content -Path $log -Value "App not running at $baseUrl - starting it." -Encoding utf8
  Start-Process -FilePath "npm.cmd" -ArgumentList "run", "start" -WorkingDirectory $root -WindowStyle Hidden

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

$body = if ($DryRun) { '{"dryRun":true}' } else { '{}' }

# Uploads and the platforms' own processing polls can take minutes, so this is
# given far longer than the health check above.
& curl.exe --silent --show-error --max-time 280 `
  -X POST -H "Content-Type: application/json" -d $body "$baseUrl/api/publish/run" 2>&1 |
  ForEach-Object {
    $line = "$_"
    Write-Host $line
    Add-Content -Path $log -Value $line -Encoding utf8
  }
exit $LASTEXITCODE
