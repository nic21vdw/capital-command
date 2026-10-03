function Initialize-UpdateTiming {
  param([string]$Root)
  $dataDir = if ($env:CAPITAL_COMMAND_DATA_DIR) { $env:CAPITAL_COMMAND_DATA_DIR } else { Join-Path $Root 'data' }
  $script:UpdateTimingPath = Join-Path (Join-Path $dataDir 'update-history') ([guid]::NewGuid().ToString('N') + '.json')
  $script:UpdateClock = [System.Diagnostics.Stopwatch]::StartNew()
  $script:UpdateStepStart = 0
  $script:UpdateTiming = [ordered]@{
    id = [System.IO.Path]::GetFileNameWithoutExtension($script:UpdateTimingPath)
    startedAt = [DateTime]::UtcNow.ToString('o')
    finishedAt = $null
    durationMs = $null
    status = 'running'
    steps = @()
  }
}

function Save-UpdateTiming {
  if (-not $script:UpdateTiming) { return }
  try {
    [System.IO.Directory]::CreateDirectory((Split-Path -Parent $script:UpdateTimingPath)) | Out-Null
    $temporary = $script:UpdateTimingPath + '.tmp'
    [System.IO.File]::WriteAllText($temporary, ($script:UpdateTiming | ConvertTo-Json -Depth 8), [System.Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $script:UpdateTimingPath -Force
  } catch {
    Write-Host 'Update timings could not be saved. The update will continue.'
  }
}

function Start-UpdateStep {
  param([string]$Label)
  if (-not $script:UpdateTiming) { return }
  $elapsed = $script:UpdateClock.ElapsedMilliseconds
  if ($script:UpdateTiming.steps.Count -gt 0) {
    $previous = $script:UpdateTiming.steps[-1]
    $previous.durationMs = $elapsed - $script:UpdateStepStart
    $previous.status = 'completed'
  }
  $script:UpdateStepStart = $elapsed
  $script:UpdateTiming.steps += [ordered]@{
    label = ($Label -replace '\s*\([^)]*\bin\b[^)]*\)\s*$', '')
    durationMs = $null
    status = 'running'
    details = @()
  }
  Save-UpdateTiming
}

function Add-UpdateTimingDetail {
  param([string]$Line)
  if (-not $script:UpdateTiming -or $script:UpdateTiming.steps.Count -eq 0 -or -not $Line.StartsWith('[update-timing] ')) { return }
  try {
    $detail = $Line.Substring(16) | ConvertFrom-Json
    if ($detail.label -notin @('Compile build', 'Retry build', 'Reuse build', 'Start server') -or $detail.durationMs -lt 0) { return }
    $script:UpdateTiming.steps[-1].details += [ordered]@{ label = $detail.label; durationMs = [long]$detail.durationMs }
    Save-UpdateTiming
  } catch { }
}

function Complete-UpdateTiming {
  param([string]$Status)
  if (-not $script:UpdateTiming) { return }
  $script:UpdateClock.Stop()
  if ($script:UpdateTiming.steps.Count -gt 0) {
    $last = $script:UpdateTiming.steps[-1]
    $last.durationMs = $script:UpdateClock.ElapsedMilliseconds - $script:UpdateStepStart
    $last.status = if ($Status -eq 'failed') { 'failed' } else { 'completed' }
  }
  $script:UpdateTiming.status = $Status
  $script:UpdateTiming.finishedAt = [DateTime]::UtcNow.ToString('o')
  $script:UpdateTiming.durationMs = $script:UpdateClock.ElapsedMilliseconds
  Save-UpdateTiming
}
