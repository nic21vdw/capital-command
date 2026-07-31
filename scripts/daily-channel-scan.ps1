# Daily channel scan - the entrypoint for Windows Task Scheduler.
#
# Reads the YouTube channel and hands every new live stream to the Stream
# Pipeline, which fans it out into the long-form edit, clips, a podcast MP3, a
# carousel and text posts, and stops at "ready to schedule". It never publishes:
# nothing goes out to a channel unreviewed.
#
# The pipeline runs inside the app, so Capital Command has to be up. This script
# starts it if nothing is listening, and leaves it running afterwards.
#
# Register it to run once a day (adjust the time to suit):
#
#   $action = New-ScheduledTaskAction -Execute "powershell.exe" `
#     -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$PWD\scripts\daily-channel-scan.ps1`""
#   $trigger = New-ScheduledTaskTrigger -Daily -At 6am
#   Register-ScheduledTask -TaskName "Capital Command channel scan" -Action $action -Trigger $trigger `
#     -Description "Run new YouTube live streams through the content pipeline"
#
# A missed run is not a problem: the scan looks back several days and the ledger
# keeps it from taking the same stream twice.

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $root "channel-scan.log"
$baseUrl = if ($env:APP_BASE_URL) { $env:APP_BASE_URL } else { "http://localhost:3000" }

Set-Location $root

# Keep the last few runs rather than growing without bound.
if ((Test-Path $log) -and ((Get-Item $log).Length -gt 2MB)) {
  Move-Item $log "$log.old" -Force
}

$stamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
Add-Content -Path $log -Value "" -Encoding utf8
Add-Content -Path $log -Value "=== channel scan $stamp ===" -Encoding utf8

function Test-App {
  try {
    Invoke-WebRequest -Uri "$baseUrl/api/pipeline" -UseBasicParsing -TimeoutSec 10 | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Write-Log($message) {
  Add-Content -Path $log -Value $message -Encoding utf8
  Write-Output $message
}

# Tee-Object is what you would reach for here, but on Windows PowerShell 5.1 it
# has no -Encoding parameter and writes UTF-16LE. Mixed with the UTF-8 that
# Write-Log produces, the log becomes half unreadable and, worse, invisible to
# any line-based tooling: grep matched none of the Tee-written lines, so a log
# watcher sat silent through a whole run. This streams the same output while
# keeping one encoding for the whole file.
function Write-Piped {
  process {
    Write-Output $_
    Add-Content -Path $log -Value $_ -Encoding utf8
  }
}

function Stop-App {
  # Only ever the local port this script manages; a remote APP_BASE_URL is not
  # ours to stop.
  if ($baseUrl -notmatch '^https?://(localhost|127\.0\.0\.1):(\d+)') { return $false }
  $port = [int]$Matches[2]
  $owners = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -eq $port } |
    Select-Object -ExpandProperty OwningProcess -Unique
  if (-not $owners) { return $false }
  foreach ($owner in $owners) { Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 3
  return $true
}

# --- Is the build we would serve older than the code that is checked out? -----
#
# Merging a fix does not redeploy it. `next start` serves whatever is in
# `.next`, so without this the scan happily runs yesterday's code while main
# says the bug is fixed - which is how a merged carousel fix nearly missed a
# 6am run. BUILD_ID is random, so `npm run postbuild` stamps the commit into
# .next/BUILD_COMMIT and this compares the two.
$buildId = Join-Path $root ".next\BUILD_ID"
$buildCommitFile = Join-Path $root ".next\BUILD_COMMIT"

$head = $null
try { $head = (& git -C $root rev-parse HEAD 2>$null).Trim() } catch { $head = $null }

$needsRebuild = $false
$why = ""
if (-not (Test-Path $buildId)) {
  $needsRebuild = $true
  $why = "there is no production build"
} elseif (-not $head) {
  # No git to compare against (a copied folder, git missing). Serve what is
  # there rather than rebuilding blindly on every run.
  Write-Log "Cannot read git HEAD - leaving the existing build alone."
} elseif (-not (Test-Path $buildCommitFile)) {
  $needsRebuild = $true
  $why = "the build predates commit stamping, so its code is unknown"
} else {
  $built = (Get-Content $buildCommitFile -Raw).Trim()
  if ($built -ne $head) {
    $shortBuilt = if ($built.Length -ge 12) { $built.Substring(0, 12) } else { $built }
    $shortHead = $head.Substring(0, 12)
    $needsRebuild = $true
    $why = "the build is from $shortBuilt but HEAD is $shortHead"
  }
}

if ($needsRebuild) {
  Write-Log "Rebuilding: $why."
  # The build has to own .next, and a running server would keep serving the old
  # code anyway - so stop first and start again below. An unfinished run dies
  # with it; the ledger leaves that video unsettled and the next scan re-checks
  # it, which is the same path a crash already takes.
  if (Stop-App) { Write-Log "Stopped the running app so the build can replace it." }

  & npm.cmd run build 2>&1 | Write-Piped

  # `next build` has exited 0 without producing a build here before (OneDrive
  # grabbing files mid-trace), so the artifact is what gets trusted, not the
  # exit code.
  if (-not (Test-Path $buildId)) {
    Write-Log "Build did not produce .next\BUILD_ID - refusing to scan against an unknown build."
    exit 1
  }
  $newId = (Get-Content $buildId -Raw).Trim()
  Write-Log "Rebuilt - BUILD_ID $newId."
}

# Start the app if it isn't already up. A scheduled run at 6am can't assume a
# dev server from yesterday is still alive.
$startedByUs = $false
if (-not (Test-App)) {
  Add-Content -Path $log -Value "App not running at $baseUrl - starting it." -Encoding utf8
  Start-Process -FilePath "npm.cmd" -ArgumentList "run", "start" -WorkingDirectory $root -WindowStyle Hidden
  $startedByUs = $true

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

# --limit keeps one run from turning a backlog into an all-day download; the rest
# are picked up tomorrow. Pass extra flags through, so a manual run can do
# `-ExtraArgs "--dry-run"` or `--all` to include ordinary uploads.
$scanArgs = @("tsx", "src/lib/ingest/cli.ts", "scan", "--limit", "2")
if ($args.Count -gt 0) { $scanArgs += $args }

& npx.cmd @scanArgs 2>&1 | Write-Piped
$code = $LASTEXITCODE

if ($startedByUs) {
  # Left running on purpose: a run that timed out is still being worked on by
  # the app, and killing it here would throw away hours of download.
  Add-Content -Path $log -Value "Leaving the app running so any unfinished run can continue." -Encoding utf8
}

# 78 is "YouTube isn't connected" - worth seeing in the log, not worth alarming
# Task Scheduler about, since it will be true every day until you connect it.
if ($code -eq 78) {
  Add-Content -Path $log -Value "YouTube is not connected; nothing to scan." -Encoding utf8
  exit 0
}

exit $code
