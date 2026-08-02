# Ships whatever has landed on `main` into the copy of Capital Command that
# actually runs the social media workflow.
#
# This checkout is PRODUCTION: the scheduled tasks, the .env and the whole
# data\ folder live here, and it stays on `main`. New work happens in the dev
# worktree (scripts\dev-worktree.ps1) on the `dev` branch and reaches this copy
# only when you run this script - which is the point, so a half-finished change
# can never interrupt a day of posting.
#
#   .\scripts\update-app.ps1          # fetch main, rebuild, restart the server
#   .\scripts\update-app.ps1 -Check   # say what would happen, change nothing
#
# Refuses to run if this checkout has commits that main does not, so an update
# can't quietly throw away work that never made it into a pull request.

param(
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

Step "Checking this checkout"

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
Write-Host "Branch: $branch"

git fetch origin main --quiet
$behind = (git rev-list --count "HEAD..origin/main").Trim()
$ahead = (git rev-list --count "origin/main..HEAD").Trim()

if ($ahead -ne "0" -and -not $Force) {
  Write-Host ""
  Write-Host "This copy has $ahead commit(s) that are not on main:" -ForegroundColor Yellow
  git log --oneline "origin/main..HEAD"
  Fail @"
Production is meant to follow main, never lead it. Get that work onto main
first (push the branch and merge its pull request), then run this again.
Use -Force only if you are certain those commits can be discarded.
"@
}

$dirty = git status --porcelain --untracked-files=no
if ($dirty -and -not $Force) {
  Write-Host ""
  Write-Host "Uncommitted changes in the production checkout:" -ForegroundColor Yellow
  Write-Host $dirty
  Fail @"
Edit code in the dev worktree, not here. Move this work over (or commit it on
a branch) before updating. Use -Force to throw it away.
"@
}

if ($behind -eq "0" -and $branch -eq "main") {
  Write-Host "Already up to date with origin/main."
  if ($Check) { exit 0 }
} else {
  Write-Host "$behind new commit(s) on main:"
  git log --oneline "HEAD..origin/main"
}

if ($Check) {
  Write-Host ""
  Write-Host "-Check only: nothing was changed." -ForegroundColor Yellow
  exit 0
}

Step "Switching to main"
git checkout main
git merge --ff-only origin/main

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
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "start-server.ps1")

Step "Waiting for the app to answer"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "wait-for-url.ps1") -Url "http://127.0.0.1:3000" -TimeoutSeconds 300
if ($LASTEXITCODE -ne 0) {
  Fail "The app did not come up. Check server.err.log in $root."
}

Write-Host ""
Write-Host "Capital Command is updated and running at http://localhost:3000" -ForegroundColor Green
Write-Host "Now on: $((git log --oneline -1))"
