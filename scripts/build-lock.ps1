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
