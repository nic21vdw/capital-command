# Builds Capital Command and starts the production server on port 3000.
#
# The build runs in the foreground so a failure is caught here, with its output
# in build.log, rather than disappearing into a detached console. That is not
# cosmetic: a half-finished `.next` has no BUILD_ID, `next start` refuses to
# run against it, and the app is simply down with nothing on screen to say why.

param(
  # Callers that already show their own console output (update-app.ps1) pass
  # this so a failure does not stop the release behind a modal dialog.
  [switch]$Quiet
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$node = if ($env:node) { $env:node } else { "node" }
$stdout = Join-Path $root "server.out.log"
$stderr = Join-Path $root "server.err.log"
$buildLog = Join-Path $root "build.log"
$pidFile = Join-Path $root "server.pid"
$port = 3000

function Test-Port {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $client.Connect("127.0.0.1", $port)
    return $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Show-Failure($summary, $logPath) {
  Write-Host ""
  Write-Host $summary -ForegroundColor Red
  if (Test-Path $logPath) {
    Write-Host "--- last 40 lines of $(Split-Path -Leaf $logPath) ---"
    Get-Content $logPath -Tail 40 | ForEach-Object { Write-Host $_ }
  }

  # The desktop shortcut runs this through a headless console, so anything
  # written above is invisible. A dialog is the only way the failure reaches
  # whoever just double-clicked the icon.
  if ($Quiet -or -not [Environment]::UserInteractive) { return }

  try {
    Add-Type -AssemblyName System.Windows.Forms
    $tail = if (Test-Path $logPath) { (Get-Content $logPath -Tail 12) -join "`n" } else { "" }
    [System.Windows.Forms.MessageBox]::Show(
      "$summary`n`n$tail`n`nFull log: $logPath",
      "Capital Command could not start",
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
  } catch {
  }
}

if (Test-Port) {
  Write-Output "Capital Command is already listening on port $port."
  exit 0
}

if (Test-Path $pidFile) {
  $existingPid = Get-Content $pidFile -ErrorAction SilentlyContinue
  if ($existingPid) {
    try {
      $existing = Get-Process -Id $existingPid -ErrorAction Stop
      if (-not $existing.HasExited) {
        Write-Output "A previous launch (PID $existingPid) is still working. Waiting for it."
        exit 0
      }
    } catch {
    }
  }
  Remove-Item $pidFile -ErrorAction SilentlyContinue
}

Remove-Item $stdout, $stderr, $buildLog -ErrorAction SilentlyContinue

Write-Host "Building Capital Command (a few minutes)..."

# `next build` writes progress and warnings to stderr. Under the Stop
# preference PowerShell promotes each of those lines to a terminating error, so
# a perfectly good build would abort here and a failed one would never reach
# the report below.
$previousPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& cmd.exe /c "cd /d `"$root`" && `"$node`" scripts\prepare-dev-cache.mjs && npm.cmd run build" 2>&1 |
  ForEach-Object { $_.ToString() } |
  Tee-Object -FilePath $buildLog
$buildExit = $LASTEXITCODE
$ErrorActionPreference = $previousPreference

if ($buildExit -ne 0) {
  Show-Failure "The build failed (exit $buildExit), so the app was not started." $buildLog
  exit 1
}

# `next build` can exit 0 and still leave nothing runnable behind if it was
# killed partway. BUILD_ID is the file `next start` looks for.
$buildId = Join-Path $root ".next\BUILD_ID"
if (-not (Test-Path $buildId)) {
  Show-Failure "The build produced no .next\BUILD_ID, so there is nothing to serve." $buildLog
  exit 1
}

$command = "cd /d `"$root`" && `"$node`" .\node_modules\next\dist\bin\next start --hostname 127.0.0.1 --port $port 1>`"$stdout`" 2>`"$stderr`""
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "C:\Windows\System32\cmd.exe"
$psi.Arguments = "/c `"$command`""
$psi.UseShellExecute = $false
$process = [System.Diagnostics.Process]::Start($psi)

Set-Content -Path $pidFile -Value $process.Id

$deadline = (Get-Date).AddSeconds(90)
while ((Get-Date) -lt $deadline -and -not (Test-Port)) {
  if ($process.HasExited) {
    Show-Failure "The server exited immediately after the build succeeded." $stderr
    exit 1
  }
  Start-Sleep -Milliseconds 500
}

if (-not (Test-Port)) {
  Show-Failure "The server did not open port $port within 90 seconds." $stderr
  exit 1
}

Write-Output "Started server with PID $($process.Id)"
