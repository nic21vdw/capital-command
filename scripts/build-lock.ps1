# Says "a build is running here", so the scheduled runners leave it alone.
#
# A release rebuilds the app in place and the app is DOWN for the whole build.
# The publish runner and the threads autopilot both start the app when nothing
# answers on port 3000, and during a build that means `npm run start` against a
# half-written `.next`. All three of the things that go wrong then are quiet:
# the new server serves 500s, it holds port 3000 so `start-server.ps1` skips
# the build it was about to do, and two builds end up writing the same folder -
# which dies with "Cannot find module './<chunk>.js'" and leaves the app down.
#
# Dot-source this; whoever builds calls Set-BuildLock, whoever might start a
# second server asks Test-BuildInProgress first.

$script:BuildLockPath = Join-Path (Split-Path -Parent $PSScriptRoot) "build.lock"

function Set-BuildLock {
  try {
    Set-Content -Path $script:BuildLockPath -Value ((Get-Date).ToString("o")) -Encoding utf8
  } catch {
  }
}

function Clear-BuildLock {
  Remove-Item $script:BuildLockPath -Force -ErrorAction SilentlyContinue
}

# A stale lock is ignored on purpose. A build killed halfway must not stop the
# app being started for the rest of the day - the whole point of the runners
# starting it is that nobody is watching.
function Test-BuildInProgress {
  param([int]$StaleAfterMinutes = 30)

  if (-not (Test-Path $script:BuildLockPath)) { return $false }
  try {
    $age = (Get-Date) - (Get-Item $script:BuildLockPath).LastWriteTime
    return $age.TotalMinutes -lt $StaleAfterMinutes
  } catch {
    return $false
  }
}

# `next start` cannot serve a build that is not there, so a missing BUILD_ID
# means starting one would fail anyway - and would take the port with it.
function Test-BuildPresent {
  return Test-Path (Join-Path (Split-Path -Parent $PSScriptRoot) ".next\BUILD_ID")
}

# A missing build used to be a dead end. A release that died halfway left
# `.next` with no BUILD_ID, and from then on every runner tick logged "not
# starting a server" and exited 0: the app stayed down and nothing posted
# until somebody happened to rebuild by hand. Now the runner hands the job to
# start-server.ps1, which builds and starts the app on its own.
#
# It runs detached, because a build can outlast the task's ten minute limit,
# and at most once an hour, so a build that keeps failing does not rebuild
# every five minutes all day. start-server.ps1 takes the build lock, so ticks
# that land while it works leave it alone.
function Start-RecoveryBuild {
  param([string]$Log, [int]$EveryMinutes = 60)

  $root = Split-Path -Parent $PSScriptRoot
  $stamp = Join-Path $root "rebuild-attempt.stamp"
  if (Test-Path $stamp) {
    $age = (Get-Date) - (Get-Item $stamp).LastWriteTime
    if ($age.TotalMinutes -lt $EveryMinutes) {
      Add-Content -Path $Log -Value "There is no build to serve (.next\BUILD_ID is missing). A rebuild was tried $([int]$age.TotalMinutes) min ago; see build.log." -Encoding utf8
      return
    }
  }
  Set-Content -Path $stamp -Value ((Get-Date).ToString("o")) -Encoding utf8
  Add-Content -Path $Log -Value "There is no build to serve (.next\BUILD_ID is missing) - rebuilding and starting the app. Progress in build.log." -Encoding utf8
  $startServer = Join-Path $PSScriptRoot "start-server.ps1"
  Start-Process -FilePath "powershell.exe" `
    -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$startServer`"", "-Quiet" `
    -WorkingDirectory $root -WindowStyle Hidden
}
