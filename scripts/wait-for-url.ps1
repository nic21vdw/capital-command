param(
  [string]$Url = "http://127.0.0.1:3000",
  [int]$TimeoutSeconds = 60
)

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ((Get-Date) -lt $deadline) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
    Write-Output "Reachable: $($response.StatusCode)"
    exit 0
  } catch {
    Start-Sleep -Seconds 2
  }
}

Write-Error "Timed out waiting for $Url"
exit 1
