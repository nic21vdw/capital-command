param(
  [string]$BaseUrl = $(if ($env:APP_BASE_URL) { $env:APP_BASE_URL } else { "http://localhost:3000" }),
  [string]$HealthJson,
  [string]$StatePath,
  [string]$Now,
  [string]$Log,
  [string]$OutFile,
  [int]$RepeatHours = 24,
  [string]$LeadsJson,
  [string]$LeadsStatePath,
  [int]$LeadsRepeatHours = 2,
  [switch]$SkipHealth,
  [switch]$SkipLeads,
  [switch]$DryRun,
  [switch]$NoToast,
  [switch]$NoDesktop
)

$ErrorActionPreference = "Stop"

$ToastAppId = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe"

function Write-HealthLog([string]$Line) {
  if (-not $Log) { return }
  Add-Content -Path $Log -Value $Line -Encoding utf8
}

function ConvertTo-UtcDate($Value) {
  if ($Value -is [DateTime]) { return $Value.ToUniversalTime() }
  $styles = [System.Globalization.DateTimeStyles]::AssumeUniversal -bor [System.Globalization.DateTimeStyles]::AdjustToUniversal
  return [DateTime]::Parse([string]$Value, [System.Globalization.CultureInfo]::InvariantCulture, $styles)
}

function Get-AccountKey($Entry) {
  return "$($Entry.platform):$($Entry.accountId)"
}

function Get-ToastDecision {
  param($Broken, $State, [DateTime]$Now, [int]$RepeatHours = 24)

  $due = @()
  $next = [ordered]@{}
  foreach ($entry in @($Broken)) {
    $key = Get-AccountKey $entry
    $known = $null
    if ($State.Contains($key)) { $known = $State[$key] }
    $isDue = $true
    if ($known) {
      $sameBreak = (ConvertTo-UtcDate $known.since).Ticks -eq (ConvertTo-UtcDate $entry.since).Ticks
      $age = $Now - (ConvertTo-UtcDate $known.lastToastAt)
      $isDue = (-not $sameBreak) -or ($age.TotalHours -ge $RepeatHours)
    }
    if ($isDue) {
      $due += $entry
      $next[$key] = [ordered]@{ since = [string]$entry.since; lastToastAt = $Now.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", [System.Globalization.CultureInfo]::InvariantCulture) }
    } else {
      $next[$key] = [ordered]@{ since = [string]$known.since; lastToastAt = [string]$known.lastToastAt }
    }
  }
  return [pscustomobject]@{ Due = $due; NextState = $next }
}

function ConvertTo-ToastText([string]$Text) {
  $spaced = [regex]::Replace($Text, '[\t\r\n]+', ' ')
  return [regex]::Replace($spaced, '[\x00-\x1F\x7F]', '')
}

function Format-SinceDate([string]$Since) {
  try {
    return (ConvertTo-UtcDate $Since).ToString("MMM d, yyyy", [System.Globalization.CultureInfo]::InvariantCulture)
  } catch {
    return "an unknown date"
  }
}

function New-ToastContent {
  param($Due, [string]$BaseUrl)

  $entries = @($Due)
  if ($entries.Count -eq 1) {
    $title = ConvertTo-ToastText "$($entries[0].displayName) has stopped posting"
    $body = ConvertTo-ToastText "It broke on $(Format-SinceDate $entries[0].since). Reconnect it in Settings > Accounts."
  } else {
    $title = ConvertTo-ToastText "$($entries.Count) accounts have stopped posting"
    $body = ConvertTo-ToastText ((($entries | ForEach-Object { "$($_.displayName) (since $(Format-SinceDate $_.since))" }) -join "; ") + ". Reconnect them in Settings > Accounts.")
  }
  $launch = "$($BaseUrl.TrimEnd('/'))/settings#accounts"
  $escape = { param($Text) [System.Security.SecurityElement]::Escape((ConvertTo-ToastText $Text)) }
  $xml = "<toast activationType=`"protocol`" launch=`"$(& $escape $launch)`"><visual><binding template=`"ToastGeneric`">" +
    "<text>$(& $escape $title)</text><text>$(& $escape $body)</text></binding></visual></toast>"
  return [ordered]@{
    title = $title
    body = $body
    launch = $launch
    accountKeys = @($entries | ForEach-Object { Get-AccountKey $_ })
    xml = $xml
  }
}

function Show-Toast([string]$Xml) {
  [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
  [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
  $document = New-Object Windows.Data.Xml.Dom.XmlDocument
  $document.LoadXml($Xml)
  $toast = New-Object Windows.UI.Notifications.ToastNotification $document
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($ToastAppId).Show($toast)
}

function Read-NotifiedState([string]$Path) {
  $state = [ordered]@{}
  if (-not (Test-Path -LiteralPath $Path)) { return $state }
  try {
    $parsed = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
    foreach ($property in $parsed.PSObject.Properties) {
      if ($property.Value.since -and $property.Value.lastToastAt) { $state[$property.Name] = $property.Value }
    }
  } catch {
    Write-HealthLog "Health toast: ignoring an unreadable $Path."
  }
  return $state
}

function Write-NotifiedState([string]$Path, $State) {
  $directory = Split-Path -Parent $Path
  if ($directory -and -not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
  $temp = "$Path.$PID.tmp"
  $json = ConvertTo-Json -InputObject $State -Depth 5
  [System.IO.File]::WriteAllText($temp, $json, (New-Object System.Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temp -Destination $Path -Force
}

function Read-Health([string]$HealthJson, [string]$BaseUrl) {
  if ($HealthJson) {
    return [System.IO.File]::ReadAllText($HealthJson, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
  }
  $temp = [System.IO.Path]::GetTempFileName()
  try {
    & curl.exe --silent --fail --max-time 10 --output $temp "$BaseUrl/api/health/platforms" 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return [System.IO.File]::ReadAllText($temp, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
  } finally {
    Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-HealthToast {
  $nowUtc = if ($Now) { ConvertTo-UtcDate $Now } else { [DateTime]::UtcNow }
  $statePath = if ($StatePath) { $StatePath } else { Join-Path (Join-Path (Split-Path -Parent $PSScriptRoot) "data") "health-notified.json" }

  $health = Read-Health $HealthJson $BaseUrl
  if (-not $health -or $null -eq $health.broken) {
    Write-HealthLog "Health toast: the app did not answer /api/health/platforms - nothing to do."
    return $null
  }

  $state = Read-NotifiedState $statePath
  $decision = Get-ToastDecision -Broken $health.broken -State $state -Now $nowUtc -RepeatHours $RepeatHours
  $content = if (@($decision.Due).Count -gt 0) { New-ToastContent -Due $decision.Due -BaseUrl $BaseUrl } else { $null }

  $shown = $false
  $skippedReason = $null
  if ($content -and -not $DryRun -and -not $NoToast) {
    if ($NoDesktop -or -not [Environment]::UserInteractive) {
      $skippedReason = "no desktop session"
    } else {
      try {
        Show-Toast $content.xml
        $shown = $true
      } catch {
        $skippedReason = $_.Exception.Message
      }
    }
  }

  $nextState = $decision.NextState
  $recorded = $DryRun -or $NoToast -or $shown -or -not $content
  if ($content -and -not $recorded) {
    foreach ($key in $content.accountKeys) {
      if ($state.Contains($key)) { $nextState[$key] = $state[$key] } else { $nextState.Remove($key) }
    }
  }
  if (-not $DryRun) { Write-NotifiedState $statePath $nextState }

  if ($content -and $shown) { Write-HealthLog "Health toast: showed '$($content.title)'." }
  elseif ($content -and $skippedReason) { Write-HealthLog "Health toast: could not show '$($content.title)' ($skippedReason); will try again next run." }

  return [ordered]@{ toast = $content; state = $nextState; shown = $shown; skipped = $skippedReason }
}

function Read-LeadSummary([string]$LeadsJson, [string]$BaseUrl) {
  if ($LeadsJson) {
    return [System.IO.File]::ReadAllText($LeadsJson, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
  }
  $temp = [System.IO.Path]::GetTempFileName()
  try {
    & curl.exe --silent --fail --max-time 10 --output $temp "$BaseUrl/api/listening?summary=1" 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return [System.IO.File]::ReadAllText($temp, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
  } finally {
    Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
  }
}

function Read-LeadState([string]$Path) {
  $state = [ordered]@{ lastToastAt = $null; notifiedIds = @() }
  if (-not (Test-Path -LiteralPath $Path)) { return $state }
  try {
    $parsed = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
    if ($parsed.lastToastAt) { $state.lastToastAt = [string]$parsed.lastToastAt }
    $state.notifiedIds = @(@($parsed.notifiedIds) | Where-Object { $_ } | ForEach-Object { [string]$_ })
  } catch {
    Write-HealthLog "Lead toast: ignoring an unreadable $Path."
    $state = [ordered]@{ lastToastAt = $null; notifiedIds = @() }
  }
  return $state
}

function Get-LeadToastDecision {
  param($Summary, $State, [DateTime]$Now, [int]$RepeatHours = 2)

  $current = @(if ($Summary.leads) { $Summary.leads })
  $currentIds = @($current | ForEach-Object { [string]$_.id })
  $known = @($State.notifiedIds)
  $fresh = @($current | Where-Object { $known -notcontains [string]$_.id })
  $kept = @($known | Where-Object { $currentIds -contains $_ })

  $quiet = $false
  if ($State.lastToastAt) { $quiet = ($Now - (ConvertTo-UtcDate $State.lastToastAt)).TotalHours -lt $RepeatHours }
  $isDue = ($fresh.Count -gt 0) -and (-not $quiet)

  $held = [ordered]@{ lastToastAt = $State.lastToastAt; notifiedIds = $kept }
  $announced = [ordered]@{ lastToastAt = $Now.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", [System.Globalization.CultureInfo]::InvariantCulture); notifiedIds = $currentIds }
  return [pscustomobject]@{
    Due = $(if ($isDue) { $fresh } else { @() })
    NextState = $(if ($isDue) { $announced } else { $held })
    HeldState = $held
  }
}

function New-LeadToastContent {
  param($Due, [string]$BaseUrl)

  $entries = @($Due)
  $title = if ($entries.Count -eq 1) { "1 new lead" } else { "$($entries.Count) new leads" }
  $first = ConvertTo-ToastText ([string]$entries[0].title)
  if ($first.Length -gt 90) { $first = $first.Substring(0, 87) + "..." }
  $more = if ($entries.Count -gt 1) { " and $($entries.Count - 1) more" } else { "" }
  $body = "`"$first`"$more. Open Listening to send them to Outreach."
  $launch = "$($BaseUrl.TrimEnd('/'))/listening"
  $escape = { param($Text) [System.Security.SecurityElement]::Escape((ConvertTo-ToastText $Text)) }
  $xml = "<toast activationType=`"protocol`" launch=`"$(& $escape $launch)`"><visual><binding template=`"ToastGeneric`">" +
    "<text>$(& $escape $title)</text><text>$(& $escape $body)</text></binding></visual></toast>"
  return [ordered]@{
    title = $title
    body = $body
    launch = $launch
    leadIds = @($entries | ForEach-Object { [string]$_.id })
    xml = $xml
  }
}

function Invoke-LeadToast {
  $nowUtc = if ($Now) { ConvertTo-UtcDate $Now } else { [DateTime]::UtcNow }
  $statePath = if ($LeadsStatePath) { $LeadsStatePath } else { Join-Path (Join-Path (Split-Path -Parent $PSScriptRoot) "data") "listening-notified.json" }

  $summary = Read-LeadSummary $LeadsJson $BaseUrl
  if (-not $summary -or $null -eq $summary.leads) { return $null }

  $state = Read-LeadState $statePath
  $decision = Get-LeadToastDecision -Summary $summary -State $state -Now $nowUtc -RepeatHours $LeadsRepeatHours
  $content = if (@($decision.Due).Count -gt 0) { New-LeadToastContent -Due $decision.Due -BaseUrl $BaseUrl } else { $null }

  $shown = $false
  $skippedReason = $null
  if ($content -and -not $DryRun -and -not $NoToast) {
    if ($NoDesktop -or -not [Environment]::UserInteractive) {
      $skippedReason = "no desktop session"
    } else {
      try {
        Show-Toast $content.xml
        $shown = $true
      } catch {
        $skippedReason = $_.Exception.Message
      }
    }
  }

  $recorded = $DryRun -or $NoToast -or $shown -or -not $content
  $nextState = if ($recorded) { $decision.NextState } else { $decision.HeldState }
  if (-not $DryRun) { Write-NotifiedState $statePath $nextState }

  if ($content -and $shown) { Write-HealthLog "Lead toast: showed '$($content.title)'." }
  elseif ($content -and $skippedReason) { Write-HealthLog "Lead toast: could not show '$($content.title)' ($skippedReason); will try again next run." }

  return [ordered]@{ toast = $content; state = $nextState; shown = $shown; skipped = $skippedReason }
}

function Invoke-Main {
  $health = $null
  $leads = $null
  if (-not $SkipHealth) { $health = Invoke-HealthToast }
  $checkLeads = (-not $SkipLeads) -and ($LeadsJson -or -not $HealthJson)
  if ($checkLeads) { $leads = Invoke-LeadToast }

  if ($OutFile) {
    $result = [ordered]@{
      toast = $(if ($health) { $health.toast } else { $null })
      state = $(if ($health) { $health.state } else { $null })
      shown = $(if ($health) { $health.shown } else { $false })
      skipped = $(if ($health) { $health.skipped } else { $null })
      leads = $leads
    }
    [System.IO.File]::WriteAllText($OutFile, (ConvertTo-Json -InputObject $result -Depth 8), (New-Object System.Text.UTF8Encoding($false)))
  }
}

if ($MyInvocation.InvocationName -ne ".") {
  $mutex = New-Object System.Threading.Mutex($false, "Local\CoLateralMarketingHealthToast")
  $held = $false
  try {
    try { $held = $mutex.WaitOne(15000) } catch [System.Threading.AbandonedMutexException] { $held = $true }
    if ($held) { Invoke-Main }
  } finally {
    if ($held) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
  }
}
