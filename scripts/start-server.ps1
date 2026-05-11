$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$node = if ($env:node) { $env:node } else { "node" }
$stdout = Join-Path $root "server.out.log"
$stderr = Join-Path $root "server.err.log"
$pidFile = Join-Path $root "server.pid"

if (Test-Path $pidFile) {
  $existingPid = Get-Content $pidFile -ErrorAction SilentlyContinue
  if ($existingPid) {
    try {
      $existing = Get-Process -Id $existingPid -ErrorAction Stop
      if (-not $existing.HasExited) {
        Write-Output "Server already running with PID $existingPid"
        exit 0
      }
    } catch {
    }
  }
}

Remove-Item $stdout, $stderr -ErrorAction SilentlyContinue

$command = "cd /d `"$root`" && `"$node`" .\node_modules\next\dist\bin\next start --hostname 127.0.0.1 --port 3000 1>`"$stdout`" 2>`"$stderr`""
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "C:\Windows\System32\cmd.exe"
$psi.Arguments = "/c `"$command`""
$psi.UseShellExecute = $false
$process = [System.Diagnostics.Process]::Start($psi)

Set-Content -Path $pidFile -Value $process.Id
Write-Output "Started server with PID $($process.Id)"
