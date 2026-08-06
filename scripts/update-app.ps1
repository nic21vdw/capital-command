# Releases finished work into the copy of Capital Command that actually runs
# the social media workflow: it brings `main` up to date, rebuilds, and
# restarts the app.
#
# This checkout is PRODUCTION: the scheduled tasks, the .env and the whole
# data\ folder live here, and it stays on `main`. New work happens in a sandbox
# worktree (scripts\dev-worktree.ps1) and reaches this copy only when you run
# this - which is the point, so a half-finished change can never interrupt a
# day of posting.
#
#   .\scripts\update-app.ps1          # release, rebuild, restart
#   .\scripts\update-app.ps1 -Check   # list what would ship, change nothing
#
# GITHUB IS OPTIONAL. A sandbox worktree shares this repository, so work merged
# there is already in this .git before any network is involved. Fetching and
# pushing are best effort and a release runs to the end with the network
# unplugged; only the GitHub copy falls behind.
#
# There is no pull request in this loop and no approval to wait on. The gate is
# this script: nothing reaches the running app until it is run. It refuses if
# this checkout has commits nothing else does, and backs the merge out untouched
# if the release branch does not merge cleanly.
#
# See CHANGELOG.md for what each release brought.

param(
  # What is being released INTO main. Defaults to main itself: work lands there
  # through pull requests now, so a release is "build what has already landed".
  [string]$Branch = "main",
  [switch]$Check,
  [switch]$Force,
  [switch]$NoRestart,
  # Everything below is also appended here, because the app starts this script
  # detached and Windows throws a detached child's redirected output away - the
  # banner read an empty file and could never say what the release was doing.
  [string]$LogPath
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if ($LogPath) {
  try {
    $logDir = Split-Path -Parent $LogPath
    if ($logDir -and -not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
  } catch {
    $LogPath = $null
  }
}

# One line to the console and, when the caller asked for a log, to the file.
# Appending line by line rather than transcribing the session keeps the file
# to what the release actually said, so the banner's tail is readable.
#
# Write-Host, not Write-Output: this is a message, not a value. Written to the
# success stream it would join the return value of whatever function is running
# - which is how a healthy `git merge` printing "Fast-forward" came back as a
# non-zero exit code and aborted a release that had already worked.
function Write-Log($message) {
  Write-Host $message
  if (-not $LogPath) { return }
  try {
    [System.IO.File]::AppendAllText($LogPath, "$message`r`n", [System.Text.UTF8Encoding]::new($false))
  } catch {
  }
}

# Runs a child process, sending everything it prints to the console and the
# log, and returning ONLY its exit code. $ErrorActionPreference is relaxed
# around it because a native command writing to stderr is a TERMINATING error
# under "Stop" - which is how a perfectly healthy `npm install` or an
# unreachable `git fetch` could kill a release outright.
function Invoke-Logged {
  param([scriptblock]$Command)
  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & $Command 2>&1 | ForEach-Object { Write-Log $_.ToString() } | Out-Null
    return $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
}

# Runs one of the sibling scripts and returns its exit code.
#
# NOT through Invoke-Logged: a pipeline reads a child's output until the pipe
# CLOSES, and start-server.ps1 leaves a server behind that inherited that same
# handle. The release therefore hung at the restart step forever - the app came
# back up, but the release never wrote another line, so the banner sat on
# "Building and starting the new version" while the thing was already running.
# Start-Process -Wait waits on the process, not on end-of-output.
function Invoke-Script {
  param([string]$Name, [string[]]$Arguments = @())

  $log = Join-Path $env:TEMP ("cc-release-" + [System.Guid]::NewGuid().ToString("N") + ".log")
  $script = Join-Path $PSScriptRoot $Name
  $quoted = ($Arguments | ForEach-Object { '"' + $_ + '"' }) -join " "
  $command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$script`" $quoted 1>`"$log`" 2>&1"

  # cmd with file redirection, waited on by handle. Every other way of doing
  # this waits for the wrong thing: a PIPELINE reads until end-of-output and
  # `Start-Process -Wait` waits for DESCENDANTS - and start-server.ps1 leaves a
  # server running on purpose, so both of them wait for the app to be shut down
  # again. The release then never wrote its last step and the banner sat on
  # "Building and starting the new version" while the app was already back.
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "C:\Windows\System32\cmd.exe"
  $psi.Arguments = "/c `"$command`""
  $psi.UseShellExecute = $false
  $child = [System.Diagnostics.Process]::Start($psi)
  $child.WaitForExit()

  # Shared read, and neither the read nor the delete may be fatal: the server
  # start-server.ps1 leaves behind INHERITED this file's handle and holds it for
  # as long as the app runs. ReadAllLines throws on that, and the exception
  # ended the release one step from the finish - after the app was already back
  # up, so the banner was left saying it was still building forever.
  try {
    $stream = New-Object System.IO.FileStream($log, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    try {
      $reader = New-Object System.IO.StreamReader($stream)
      while ($null -ne ($line = $reader.ReadLine())) {
        if ($line.Trim()) { Write-Log $line }
      }
      $reader.Dispose()
    } finally {
      $stream.Dispose()
    }
  } catch {
    Write-Log "(could not read $Name's output: $($_.Exception.Message))"
  }
  Remove-Item $log -Force -ErrorAction SilentlyContinue

  return $child.ExitCode
}

function Step($message) {
  Write-Log ""
  Write-Log "==> $message"
}

# Nothing may die quietly. Under "Stop" any unhandled error ends the script
# where it stands, and the only thing watching is a banner reading the log - so
# a release that hit one simply stopped mid-step and left the app saying it was
# still building. Every terminating error now writes the same ERROR line a
# deliberate failure does.
trap {
  Write-Log ""
  Write-Log ("ERROR: The update stopped unexpectedly - " + (($_.Exception.Message -split "\r?\n") -join " ").Trim())
  exit 1
}

function Fail($message) {
  Write-Log ""
  # One line. The banner shows the ERROR line and nothing after it, so a reason
  # written across three lines reached the screen cut off mid-word - and the
  # reason is the whole point of showing it.
  Write-Log ("ERROR: " + (($message -split "\r?\n") -join " ").Trim())
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
    Write-Log "No CHANGELOG.md to date."
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
    Write-Log "No Unreleased heading - leaving CHANGELOG.md alone."
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
    Write-Log "Nothing under Unreleased to date."
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
    Write-Log "Could not commit the dated changelog - releasing anyway."
    return
  }
  Write-Log "Unreleased is now $today."
}


# Carries the release branch up to what was just released, so the changelog
# commit above cannot come back as a conflict next time.
function Sync-ReleaseBranch {
  # Releasing main into main: there is no separate branch to carry up, and
  # forcing a branch that is checked out is a fatal error git refuses -
  # which killed the whole release, after the merge and before the rebuild,
  # every time the banner's button ran it.
  if ($Branch -eq "main") { return }

  if ((Invoke-Logged { git push origin "main:$Branch" --quiet }) -ne 0) {
    Write-Log "Could not fast-forward origin/$Branch to this release."
    return
  }
  # The local branch too, unless a sandbox has it checked out - git refuses
  # there, and rightly: that folder may have uncommitted work sitting on it.
  if ((Invoke-Logged { git branch -f $Branch main }) -ne 0) {
    Write-Log "origin/$Branch is up to date; the sandbox copy will catch up on its next pull."
  }
}

# A ref only if git can actually resolve it, so an unreachable GitHub (or a
# branch that only ever existed locally) narrows what the release compares
# against instead of killing it.
function Resolve-Ref($ref) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  git rev-parse --verify --quiet "$ref^{commit}" | Out-Null
  $ok = $LASTEXITCODE -eq 0
  $ErrorActionPreference = $previous
  if ($ok) { return $ref }
  return $null
}

$started = Get-Date
function Elapsed {
  $span = (Get-Date) - $started
  return "{0:mm}m{0:ss}s" -f $span
}

Step "Checking this checkout"

# Not $branch: PowerShell variable names are case-insensitive, so that would be
# the same variable as the -Branch parameter and this would quietly release
# main into main.
$current = (git rev-parse --abbrev-ref HEAD).Trim()
Write-Log "On: $current, releasing: $Branch"

# Best effort, and quiet about it. A sandbox worktree shares this repository,
# so everything worth releasing is already here; GitHub only holds the backup
# copy. Under "Stop" an unreachable remote used to be a terminating error that
# ended the release before it printed a word.
if ((Invoke-Logged { git fetch origin --quiet }) -ne 0) {
  Write-Log "Could not reach GitHub - releasing what is already in this repository."
}

# What is being released: the remote branch when it is there and ahead, the
# local one otherwise. Either way the commits are already in this .git.
$remoteRef = Resolve-Ref "origin/$Branch"
$localRef = Resolve-Ref $Branch
$source = $remoteRef
if (-not $source) { $source = $localRef }
if ($remoteRef -and $localRef -and (git rev-list --count "$remoteRef..$localRef") -ne "0") {
  # The local branch has commits the remote does not - a release made while
  # GitHub was unreachable, or a sandbox merge that was never uploaded. Build
  # what is actually here.
  $source = $localRef
}
if (-not $source) { Fail "There is no $Branch branch here to release." }

# Commits that exist ONLY here - not on what is being released, not on main.
# Anything already on the release branch is not stranded, it is just early.
$notOn = @($source, (Resolve-Ref "origin/main")) | Where-Object { $_ }
$stranded = git rev-list HEAD --not @notOn

if ($stranded -and -not $Force) {
  Write-Log ""
  Write-Log "This copy has commits that exist nowhere else:"
  Invoke-Logged { git log --oneline HEAD --not @notOn } | Out-Null
  Fail @"
Releasing would strand that work. Get it onto $Branch from the sandbox first,
then run this again. Use -Force only if you are certain it can be discarded.
"@
}

$dirty = git status --porcelain --untracked-files=no
if ($dirty -and -not $Force) {
  Write-Log ""
  Write-Log "Uncommitted changes in the production checkout:"
  Write-Log $dirty
  Fail @"
Edit code in the sandbox, not here. Move this work over (or commit it on a
branch) before updating. Use -Force to throw it away.
"@
}

Step "What this update brings"

# Against the RUNNING BUILD, not HEAD and not the release branch.
#
# HEAD is close but wrong: `next start` serves `.next`, so a checkout that
# fast-forwarded and then failed before rebuilding is current in git and stale
# in the browser - which is exactly the state a half-finished release leaves
# behind, and it would report "nothing new" forever after.
$buildCommitFile = Join-Path $root ".next\BUILD_COMMIT"
$from = "HEAD"
if (Test-Path $buildCommitFile) {
  $built = (Get-Content $buildCommitFile -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($built -and (Resolve-Ref $built)) { $from = $built }
}
$incoming = git log --oneline "$from..$source"
if (-not $incoming) {
  Write-Log "Nothing new on $Branch - the app is already running the latest."
  if ($Check -or -not $Force) { exit 0 }
} else {
  Write-Log ($incoming -join "`r`n")
}

if ($Check) {
  Write-Log ""
  Write-Log "-Check only: nothing was changed."
  exit 0
}

Step "Releasing $Branch"

if ($current -ne "main") {
  if ((Invoke-Logged { git checkout main }) -ne 0) { Fail "Could not switch to main." }
}

# One merge covers both shapes this takes: bringing main up to what has landed
# on GitHub, and merging a separate branch in. It is skipped entirely when the
# source is already an ancestor, which is the normal case now that work lands
# on main through pull requests - the release is then just a rebuild.
$behind = git rev-list --count "HEAD..$source"
if ($behind -ne "0") {
  # A conflict here means main and the source changed the same lines, which is
  # not something to resolve by guessing at 11pm with the queue waiting: back
  # the merge out and leave the app exactly as it was.
  if ((Invoke-Logged { git merge --no-edit $source }) -ne 0) {
    Invoke-Logged { git merge --abort } | Out-Null
    Fail @"
$Branch does not merge cleanly into main, so nothing was changed and the app is
still running the version it was. Resolve it in the sandbox, then run this again.
"@
  }
} else {
  Write-Log "main already has everything on $Branch - rebuilding it."
}

Step "Dating the changelog"
Publish-Changelog

# Keep GitHub in step. Best effort: a release that only exists locally still
# runs, and failing here would leave the app half-updated for no good reason.
if ((Invoke-Logged { git push origin main --quiet }) -ne 0) {
  Write-Log "Could not upload main to GitHub - the release is applied locally anyway."
}

# Dating the changelog is a commit main has and the release branch does not,
# and the next release would meet it as a conflict in the one file every change
# touches.
Sync-ReleaseBranch

Step "Installing dependencies ($(Elapsed) in)"

# Only when the lockfile actually moved. `npm install` with nothing to do still
# walks the whole tree, and it ran on every release - a minute of a wait the
# app spends completely down, for no change at all.
$lockFile = Join-Path $root "package-lock.json"
$stamp = Join-Path $root "node_modules\.capital-command-install"
$lockHash = $null
if (Test-Path $lockFile) {
  $lockHash = (Get-FileHash $lockFile -Algorithm SHA256).Hash
}
$installedHash = $null
if (Test-Path $stamp) {
  $installedHash = (Get-Content $stamp -ErrorAction SilentlyContinue | Select-Object -First 1)
}

if ($lockHash -and $installedHash -eq $lockHash -and (Test-Path (Join-Path $root "node_modules"))) {
  Write-Log "package-lock.json has not changed - skipping npm install."
} else {
  # --include=dev because the app starts this: `next start` runs with
  # NODE_ENV=production, the release inherits it, and npm then treats
  # devDependencies as extraneous and REMOVES them - 331 packages in a
  # measured run, leaving the build to run without the tools it needs.
  if ((Invoke-Logged { & npm.cmd install --include=dev }) -ne 0) { Fail "npm install failed." }
  if ($lockHash) { Set-Content -Path $stamp -Value $lockHash }
}

if ($NoRestart) {
  Write-Log ""
  Write-Log "-NoRestart: leaving the running server alone. It is still on the old build."
  exit 0
}

Step "Stopping the running app ($(Elapsed) in)"
Invoke-Script "stop-server.ps1" | Out-Null

Step "Building and starting the new version ($(Elapsed) in, takes a few minutes)"
if ((Invoke-Script "start-server.ps1" @("-Quiet")) -ne 0) {
  # It has already printed the reason and the tail of the log it failed in.
  # Waiting five minutes for a server that was never started only buries that.
  Fail "The release did not start. The app is still down - see build.log in $root."
}

Step "Waiting for the app to answer ($(Elapsed) in)"
$port = if ($env:CAPITAL_COMMAND_PORT) { $env:CAPITAL_COMMAND_PORT } else { "3000" }
if ((Invoke-Script "wait-for-url.ps1" @("-Url", "http://127.0.0.1:$port", "-TimeoutSeconds", "300")) -ne 0) {
  Fail "The app did not come up. Check server.err.log in $root."
}

Write-Log ""
Write-Log "Capital Command is updated and running at http://localhost:$port (took $(Elapsed))"
Write-Log "Now on: $((git log --oneline -1))"
