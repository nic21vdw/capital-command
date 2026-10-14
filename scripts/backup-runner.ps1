$ErrorActionPreference = "Continue"

$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $root "backup-state.log"

Set-Location $root

if ((Test-Path $log) -and ((Get-Item $log).Length -gt 1MB)) {
  Set-Content -Path $log -Value (Get-Content -Path $log -Tail 500) -Encoding utf8
}

$stamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
Add-Content -Path $log -Value "" -Encoding utf8
Add-Content -Path $log -Value "=== state backup $stamp ===" -Encoding utf8

& npm.cmd run backup:state 2>&1 | ForEach-Object {
  $line = "$_"
  Write-Host $line
  Add-Content -Path $log -Value $line -Encoding utf8
}
exit $LASTEXITCODE
