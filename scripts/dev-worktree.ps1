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
  # One session per checkout. Pass -Name to get your own: two sessions sharing
  # a working tree means one `git add -A` sweeps up the other's half-finished
  # files, and neither notices until it is committed and pushed.
  [string]$Name,
  [string]$Path,
  [string]$Branch,
  [switch]$SkipInstall
)

if ($Name) {
  $slug = ($Name -replace "[^A-Za-z0-9-]", "-").Trim("-").ToLower()
  if (-not $slug) { throw "-Name needs at least one letter or number." }
  if (-not $Path) { $Path = Join-Path $env:USERPROFILE "capital-command-$slug" }
  if (-not $Branch) { $Branch = "claude/$slug" }
} else {
  if (-not $Path) { $Path = Join-Path $env:USERPROFILE "capital-command-dev" }
  if (-not $Branch) { $Branch = "dev" }
}

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

# Every remote, not just one. `github` is where pull requests merge and
# `origin` is the local backup hub that follows it on a schedule, so fetching
# only one can hand a sandbox a base that is days behind. Never fatal - an
# offline machine must still be able to open a sandbox to work in.
$remotes = @(git remote | ForEach-Object { $_.Trim() } | Where-Object { $_ })
foreach ($remote in $remotes) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  git fetch $remote --quiet 2>$null
  $ErrorActionPreference = $previous
}

if (Test-Path (Join-Path $Path ".git")) {
  # Someone is mid-edit in there. Handing the same checkout to a second session
  # is how one session's `git add -A` ends up committing another's work.
  $busy = git -C $Path status --porcelain --untracked-files=no
  if ($busy) {
    Write-Host ""
    Write-Host "$Path has uncommitted changes:" -ForegroundColor Yellow
    Write-Host $busy
    throw @"
Another session is working in that checkout. Take your own instead:

    npm run dev:worktree -- -Name <something-short>

which creates %USERPROFILE%\capital-command-<name> on its own branch.
"@
  }
  Write-Host "Sandbox already exists at $Path"
} else {
  $exists = git branch --list $Branch
  if (-not $exists) {
    # Local refs first, and no network call at all. `git ls-remote` writes to
    # stderr when GitHub cannot be reached, which under "Stop" is a TERMINATING
    # error - so an offline machine could not even open a sandbox to work in.
    # A REMOTE main outranks the local one. The fetch above has just brought the
    # remotes up to date, while local `main` only moves when something checks it
    # out - it was ten commits behind, and every sandbox opened from it started
    # by silently reviewing yesterday's code.
    $candidates = @()
    foreach ($remote in $remotes) { $candidates += "$remote/$Branch" }
    foreach ($remote in $remotes) { $candidates += "$remote/main" }
    $candidates += "main"
    $base = $candidates | Where-Object {
      $previous = $ErrorActionPreference
      $ErrorActionPreference = "Continue"
      git rev-parse --verify --quiet "$_^{commit}" | Out-Null
      $found = $LASTEXITCODE -eq 0
      $ErrorActionPreference = $previous
      $found
    } | Select-Object -First 1
    if (-not $base) { throw "No branch to base $Branch on - this checkout has neither $Branch nor main." }
    git branch $Branch $base
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
Write-Host "Work there, land it on main when a day's changes are ready, then run"
Write-Host "update-capital-command.bat in the production folder."
Write-Host ""
Write-Host "No GitHub? This worktree shares the production repository, so the branch is"
Write-Host "already there. Release it directly:"
Write-Host "  .\scripts\update-app.ps1 -Branch $Branch"
