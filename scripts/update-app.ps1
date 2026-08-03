# Releases the work waiting on `dev` into the copy of Capital Command that
# actually runs the social media workflow. This is the whole release: it merges
# dev into main, pushes it, rebuilds and restarts the app.
#
# This checkout is PRODUCTION: the scheduled tasks, the .env and the whole
# data\ folder live here, and it stays on `main`. New work happens in the
# sandbox (scripts\dev-worktree.ps1) on `dev` and reaches this copy only when
# you run this - which is the point, so a half-finished change can never
# interrupt a day of posting.
#
#   .\scripts\update-app.ps1          # release dev, rebuild, restart
#   .\scripts\update-app.ps1 -Check   # list what would ship, change nothing
#
# There is no pull request in this loop and no approval to wait on. The gate is
# this script: nothing reaches the running app until it is run. It refuses if
# this checkout has commits main does not, and backs the merge out untouched if
# dev does not merge cleanly.
#
# See CHANGELOG.md for what each release brought.

param(
  [string]$Branch = "dev",
  [switch]$Check,
  [switch]$Force,
  [switch]$NoRestart
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step($message) {
  Write-Host ""
  Write-Host "==> $message" -ForegroundColor Cyan
}

function Fail($message) {
  Write-Host ""
  Write-Host "ERROR: $message" -ForegroundColor Red
  exit 1
}

# Moves the CHANGELOG's Unreleased block under today's date, because a human
# doing it by hand does not: four releases' worth of shipped work sat under
# "Unreleased" reading as though it were still waiting, in the one file that is
# meant to answer "is there anything new?".
#
# Never fatal. A changelog that failed to rotate is untidy; an app that refused
# to update because of it would be broken.
function Publish-Changelog {
  $path = Join-Path $root "CHANGELOG.md"
  if (-not (Test-Path $path)) {
    Write-Host "No CHANGELOG.md to date."
    return
  }

  # .NET file IO, not Get-Content/Set-Content: Windows PowerShell reads UTF-8
  # as ANSI unless told otherwise and writes a BOM when told to write UTF-8,
  # and this file is full of em dashes. Round-tripping it through the cmdlets
  # turns every one of them into mojibake and prepends a BOM - on every
  # release, compounding.
  $lines = @([System.IO.File]::ReadAllLines($path, [System.Text.UTF8Encoding]::new($false)))
  $heading = $null
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^##\s+Unreleased\s*$') { $heading = $i; break }
  }
  if ($null -eq $heading) {
    Write-Host "No Unreleased heading - leaving CHANGELOG.md alone."
    return
  }

  # Only a block with entries in it is worth dating. An empty Unreleased means
  # this release carried commits nobody wrote a line for, and stamping a date
  # on nothing would just add an empty section per release.
  $hasEntries = $false
  for ($i = $heading + 1; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^##\s') { break }
    if ($lines[$i] -match '^\s*[-*]\s+\S') { $hasEntries = $true; break }
  }
  if (-not $hasEntries) {
    Write-Host "Nothing under Unreleased to date."
    return
  }

  $today = (Get-Date).ToString("yyyy-MM-dd")
  # The heading stays and a dated one is inserted under it, so the next change
  # made in the sandbox still has an Unreleased block to write into.
  $updated = @()
  $updated += $lines[0..$heading]
  $updated += ""
  $updated += "## $today"
  if ($heading + 1 -lt $lines.Count) { $updated += $lines[($heading + 1)..($lines.Count - 1)] }

  [System.IO.File]::WriteAllLines($path, $updated, [System.Text.UTF8Encoding]::new($false))

  git add CHANGELOG.md
  git commit --quiet -m "Date the changelog for the $today release"
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Could not commit the dated changelog - releasing anyway." -ForegroundColor Yellow
    return
  }
  Write-Host "Unreleased is now $today."
}

# Carries the release branch up to what was just released, so the changelog
# commit above cannot come back as a conflict next time.
function Sync-ReleaseBranch {
  git push origin "main:$Branch" --quiet
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Could not fast-forward origin/$Branch to this release." -ForegroundColor Yellow
    return
  }
  # The local branch too, unless a sandbox has it checked out - git refuses
  # there, and rightly: that folder may have uncommitted work sitting on it.
  git branch -f $Branch main 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "origin/$Branch is up to date; the sandbox copy will catch up on its next pull."
  }
}

Step "Checking this checkout"

# Not $branch: PowerShell variable names are case-insensitive, so that would be
# the same variable as the -Branch parameter and this would quietly release
# main into main.
$current = (git rev-parse --abbrev-ref HEAD).Trim()
Write-Host "On: $current, releasing: $Branch"

git fetch origin --quiet

# Commits that exist ONLY here - not on main, not on the branch about to be
# released. Anything already on dev is not stranded, it is just early: this
# checkout following a branch that dev was cut from is normal and fine.
$stranded = git rev-list HEAD --not "origin/main" "origin/$Branch"

if ($stranded -and -not $Force) {
  Write-Host ""
  Write-Host "This copy has commits that exist nowhere else:" -ForegroundColor Yellow
  git log --oneline HEAD --not "origin/main" "origin/$Branch"
  Fail @"
Releasing would strand that work. Get it onto $Branch from the sandbox first,
then run this again. Use -Force only if you are certain it can be discarded.
"@
}

$dirty = git status --porcelain --untracked-files=no
if ($dirty -and -not $Force) {
  Write-Host ""
  Write-Host "Uncommitted changes in the production checkout:" -ForegroundColor Yellow
  Write-Host $dirty
  Fail @"
Edit code in the sandbox, not here. Move this work over (or commit it on a
branch) before updating. Use -Force to throw it away.
"@
}

Step "What this update brings"

# Against HEAD, not origin/main: work now lands on main through pull requests,
# so origin/main..origin/main is always empty and this would report "nothing
# new" while the running checkout sat six releases behind.
$incoming = git log --oneline "HEAD..origin/$Branch"
if (-not $incoming) {
  Write-Host "Nothing new on $Branch - the app is already running the latest."
  if ($Check -or -not $Force) { exit 0 }
} else {
  Write-Host $incoming
}

if ($Check) {
  Write-Host ""
  Write-Host "-Check only: nothing was changed." -ForegroundColor Yellow
  exit 0
}

Step "Releasing $Branch"

git checkout main
if ($LASTEXITCODE -ne 0) { Fail "Could not switch to main." }
git merge --ff-only origin/main
if ($LASTEXITCODE -ne 0) { Fail "main and origin/main have diverged - sort that out before releasing." }

# The release itself. A conflict here means main and the sandbox changed the
# same lines, which is not something to resolve by guessing at 11pm with the
# queue waiting: back the merge out and leave the app exactly as it was.
git merge --no-edit "origin/$Branch"
if ($LASTEXITCODE -ne 0) {
  git merge --abort
  Fail @"
$Branch does not merge cleanly into main, so nothing was changed and the app is
still running the version it was. Resolve it in the sandbox, then run this again.
"@
}

Step "Dating the changelog"
Publish-Changelog

# Keep GitHub in step. Best effort: a release that only exists locally still
# runs, and failing here would leave the app half-updated for no good reason.
git push origin main --quiet
if ($LASTEXITCODE -ne 0) {
  Write-Host "Could not push main to GitHub - the release is applied locally anyway." -ForegroundColor Yellow
}

# Dating the changelog is a commit main has and dev does not, and the next
# release would meet it as a conflict in the one file every change touches.
# Carrying dev up to the release removes the divergence at the source: after a
# release the sandbox's baseline IS what is running, which is what it should
# have been anyway.
Sync-ReleaseBranch

Step "Installing dependencies"
& npm.cmd install
if ($LASTEXITCODE -ne 0) { Fail "npm install failed." }

if ($NoRestart) {
  Write-Host ""
  Write-Host "-NoRestart: leaving the running server alone. It is still on the old build." -ForegroundColor Yellow
  exit 0
}

Step "Stopping the running app"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "stop-server.ps1")

Step "Building and starting the new version"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "start-server.ps1") -Quiet
if ($LASTEXITCODE -ne 0) {
  # It has already printed the reason and the tail of the log it failed in.
  # Waiting five minutes for a server that was never started only buries that.
  Fail "The release did not start. The app is still down - see build.log in $root."
}

Step "Waiting for the app to answer"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "wait-for-url.ps1") -Url "http://127.0.0.1:3000" -TimeoutSeconds 300
if ($LASTEXITCODE -ne 0) {
  Fail "The app did not come up. Check server.err.log in $root."
}

Write-Host ""
Write-Host "Capital Command is updated and running at http://localhost:3000" -ForegroundColor Green
Write-Host "Now on: $((git log --oneline -1))"
