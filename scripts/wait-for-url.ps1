param(
  [string]$Url = "http://127.0.0.1:3000",
  [int]$TimeoutSeconds = 60
)

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ((Get-Date) -lt $deadline) {
  try {
    # Invoke-WebRequest has hung under Task Scheduler despite TimeoutSec.
    # curl has a wall-clock limit and does not run a browser or render a page.
    $remaining = [Math]::Max(1, [Math]::Min(5, [Math]::Ceiling(($deadline - (Get-Date)).TotalSeconds)))
    & curl.exe --fail --silent --show-error --noproxy "*" --connect-timeout 2 --max-time $remaining $Url 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      Write-Output "Reachable: $Url"
      exit 0
    }
  } catch {
    # An offline server is expected while restarting; retry until the deadline.
  }
  Start-Sleep -Milliseconds 500
}

Write-Error "Timed out waiting for $Url"
exit 1
