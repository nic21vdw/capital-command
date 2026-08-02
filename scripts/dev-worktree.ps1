# Creates (or refreshes) the sandbox copy of Capital Command where changes get
# made, so the copy that runs the workflow is never edited underneath you.
#
#   .\scripts\dev-worktree.ps1
#
# It is a git worktree on the `dev` branch, outside OneDrive and outside the
# production folder, with its own node_modules, its own .next cache and - the
# part that matters - its OWN data\ folder. Every data path in the app is
# resolved from the working directory, so the sandbox cannot touch the live
# publish queue, the Threads queue or the tokens no matter what you run in it.
#
# Start it with `npm run dev:sandbox` (port 3100) so both copies can run at
# once: the real one on 3000, the one you are changing on 3100.

param(
  [string]$Path = (Join-Path $env:USERPROFILE "capital-command-dev"),
  [string]$Branch = "dev",
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step($message) {
  Write-Host ""
  Write-Host "==> $message" -ForegroundColor Cyan
}

# The sandbox needs the settings, not the ability to post. Access tokens are
# commented out and the two kill switches are turned off, so a stray CLI or a
# button clicked while testing cannot reach a real account. Client ids and
# secrets stay: they only matter for connect flows, which write to the
# sandbox's own token file.
function Get-SandboxEnv($file) {
  $muted = "IG_ACCESS_TOKEN", "FB_PAGE_ACCESS_TOKEN", "THREADS_ACCESS_TOKEN"
  $off = @{ "PUBLISH_ENABLED" = "false"; "THREADS_ENABLED" = "false" }

  $lines = foreach ($line in Get-Content $file) {
    $key = if ($line -match "^([A-Z0-9_]+)=") { $Matches[1] } else { $null }
    if ($key -and $muted -contains $key) {
      "# sandbox: disarmed`n# $line"
    } elseif ($key -and $off.ContainsKey($key)) {
      "$key=$($off[$key])"
    } else {
      $line
    }
  }

  @("# Sandbox copy - posting credentials disarmed by scripts\dev-worktree.ps1.", "") + $lines
}

Step "Preparing the $Branch branch"
git fetch origin --quiet

if (Test-Path (Join-Path $Path ".git")) {
  Write-Host "Sandbox already exists at $Path"
} else {
  $exists = git branch --list $Branch
  if (-not $exists) {
    $remote = git ls-remote --heads origin $Branch
    if ($remote) {
      git branch $Branch "origin/$Branch"
    } else {
      git branch $Branch "origin/main"
    }
  }
  Step "Creating the sandbox at $Path"
  git worktree add $Path $Branch
}

Step "Copying settings the sandbox needs"
$envFile = Join-Path $root ".env"
$devEnv = Join-Path $Path ".env"
if ((Test-Path $envFile) -and -not (Test-Path $devEnv)) {
  Set-Content -Path $devEnv -Value (Get-SandboxEnv $envFile) -Encoding utf8
  Write-Host "Copied .env with the posting credentials and kill switches disarmed"
} else {
  Write-Host ".env already in place (or none to copy)"
}

# App data only - a snapshot to work against. Queues and tokens are deliberately
# NOT copied: nothing in the sandbox should be able to post as you.
$appData = Join-Path $root "data\capital-command.json"
$devData = Join-Path $Path "data\capital-command.json"
if ((Test-Path $appData) -and -not (Test-Path $devData)) {
  New-Item -ItemType Directory -Force -Path (Split-Path $devData) | Out-Null
  Copy-Item $appData $devData
  Write-Host "Copied a snapshot of your app data"
}

if (-not $SkipInstall) {
  Step "Installing dependencies in the sandbox (first run takes a few minutes)"
  Push-Location $Path
  & npm.cmd install
  $code = $LASTEXITCODE
  Pop-Location
  if ($code -ne 0) { throw "npm install failed in $Path" }
}

Write-Host ""
Write-Host "Sandbox ready: $Path (branch $Branch)" -ForegroundColor Green
Write-Host "  cd `"$Path`""
Write-Host "  npm run dev:sandbox     # http://localhost:3100"
Write-Host ""
Write-Host "Work there, merge dev into main when a day's changes are ready, then run"
Write-Host "update-capital-command.bat in the production folder."
