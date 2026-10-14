$script:LogEncoding = New-Object System.Text.UTF8Encoding($false)

try {
  [Console]::OutputEncoding = $script:LogEncoding
} catch {
}

function Add-LogText {
  param([string]$Path, [string]$Text)

  for ($attempt = 1; $attempt -le 4; $attempt++) {
    try {
      [System.IO.File]::AppendAllText($Path, $Text + "`r`n", $script:LogEncoding)
      return
    } catch {
      Start-Sleep -Milliseconds 150
    }
  }
}

function Get-LogArchivePath {
  param([string]$Path, [datetime]$Date)

  $folder = Split-Path -Parent $Path
  $name = [System.IO.Path]::GetFileNameWithoutExtension($Path)
  $extension = [System.IO.Path]::GetExtension($Path)
  $day = $Date.ToString("yyyy-MM-dd", [System.Globalization.CultureInfo]::InvariantCulture)
  return Join-Path $folder ("{0}.{1}{2}" -f $name, $day, $extension)
}

function Remove-ExpiredLogArchives {
  param([string]$Path, [int]$KeepDays = 14, [datetime]$Today = (Get-Date))

  $folder = Split-Path -Parent $Path
  $name = [System.IO.Path]::GetFileNameWithoutExtension($Path)
  $extension = [System.IO.Path]::GetExtension($Path)
  $pattern = "^" + [regex]::Escape($name) + "\.(\d{4}-\d{2}-\d{2})" + [regex]::Escape($extension) + "$"
  $cutoff = $Today.Date.AddDays(-$KeepDays)

  foreach ($file in @(Get-ChildItem -LiteralPath $folder -File -ErrorAction SilentlyContinue)) {
    if ($file.Name -notmatch $pattern) { continue }
    try {
      $day = [datetime]::ParseExact($Matches[1], "yyyy-MM-dd", [System.Globalization.CultureInfo]::InvariantCulture)
    } catch {
      continue
    }
    if ($day -lt $cutoff) {
      Remove-Item -LiteralPath $file.FullName -Force -ErrorAction SilentlyContinue
    }
  }

  $legacy = "$Path.old"
  if ((Test-Path -LiteralPath $legacy) -and (Get-Item -LiteralPath $legacy).LastWriteTime -lt $cutoff) {
    Remove-Item -LiteralPath $legacy -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-LogRotation {
  param([string]$Path, [switch]$Always, [int]$KeepDays = 14, [datetime]$Today = (Get-Date))

  try {
    if (Test-Path -LiteralPath $Path) {
      $file = Get-Item -LiteralPath $Path
      if ($file.Length -gt 0 -and ($Always -or $file.LastWriteTime.Date -lt $Today.Date)) {
        $archive = Get-LogArchivePath -Path $Path -Date $file.LastWriteTime
        if (Test-Path -LiteralPath $archive) {
          $source = [System.IO.File]::OpenRead($Path)
          try {
            $target = New-Object System.IO.FileStream($archive, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write)
            try { $source.CopyTo($target) } finally { $target.Dispose() }
          } finally {
            $source.Dispose()
          }
          Remove-Item -LiteralPath $Path -Force
        } else {
          Move-Item -LiteralPath $Path -Destination $archive -Force
        }
      }
    }
    Remove-ExpiredLogArchives -Path $Path -KeepDays $KeepDays -Today $Today
  } catch {
  }
}

function Read-SeenState {
  param([string]$Path)

  $seen = @{}
  if (Test-Path -LiteralPath $Path) {
    try {
      foreach ($line in [System.IO.File]::ReadAllLines($Path, $script:LogEncoding)) {
        $tab = $line.IndexOf("`t")
        if ($tab -gt 0) { $seen[$line.Substring(0, $tab)] = $line.Substring($tab + 1) }
      }
    } catch {
    }
  }
  return $seen
}

function Write-SeenState {
  param([string]$Path, [hashtable]$Seen)

  $lines = New-Object System.Collections.Generic.List[string]
  foreach ($key in $Seen.Keys) { $lines.Add("$key`t$($Seen[$key])") }
  try {
    [System.IO.File]::WriteAllLines($Path, $lines.ToArray(), $script:LogEncoding)
  } catch {
  }
}

function Limit-Text {
  param([string]$Text, [int]$Length)

  $flat = ($Text -replace "\s+", " ").Trim()
  if ($flat.Length -le $Length) { return $flat }
  return $flat.Substring(0, $Length) + "..."
}

function Get-StateFingerprint {
  param([string]$Day, [string]$State, [string]$Detail)

  $masked = ($Detail -replace "\s+", " ") -replace "\d+", "#"
  if ($masked.Length -gt 100) { $masked = $masked.Substring(0, 100) }
  return "$Day|$State|$masked"
}

function Get-ChangedLines {
  param([object[]]$Items, [string]$StatePath, [string]$Day)

  $previous = Read-SeenState -Path $StatePath
  $current = @{}
  $changed = New-Object System.Collections.Generic.List[object]
  foreach ($item in $Items) {
    $fingerprint = Get-StateFingerprint -Day $Day -State $item.State -Detail $item.Detail
    $current[$item.Key] = $fingerprint
    if ($previous[$item.Key] -ne $fingerprint) {
      $changed.Add([pscustomobject]@{ Key = $item.Key; State = $item.State; Detail = $item.Detail; Fingerprint = $fingerprint })
    }
  }
  Write-SeenState -Path $StatePath -Seen $current

  $lines = New-Object System.Collections.Generic.List[string]
  foreach ($group in @($changed | Group-Object Fingerprint)) {
    $members = @($group.Group)
    $first = $members[0]
    if ($members.Count -le 3) {
      foreach ($member in $members) {
        $text = Limit-Text -Text $member.Detail -Length 300
        $lines.Add($(if ($member.State -eq "note") { "  $text" } else { "  $($member.State) $($member.Key): $text" }))
      }
    } else {
      $keys = @($members | Select-Object -First 3 | ForEach-Object { $_.Key })
      $lines.Add("  $($first.State) x$($members.Count): $(Limit-Text -Text $first.Detail -Length 300) ($($keys -join ', ') and $($members.Count - 3) more)")
    }
  }
  return [pscustomobject]@{ Count = $changed.Count; Lines = $lines.ToArray() }
}

function Format-StateCounts {
  param([object[]]$Items)

  $groups = @($Items | Group-Object State | Sort-Object @{ Expression = "Count"; Descending = $true }, @{ Expression = "Name"; Descending = $false })
  return (@($groups | ForEach-Object { "$($_.Name) $($_.Count)" }) -join ", ")
}

function Get-PublishRunLines {
  param([string]$Raw, [string]$StatePath, [string]$Day)

  if ([string]::IsNullOrWhiteSpace($Raw)) { return @("no usable response from the app (0 characters)") }

  $parsed = $null
  try { $parsed = $Raw | ConvertFrom-Json } catch { }
  if ($null -eq $parsed) {
    return @("no usable response from the app ($($Raw.Length) characters): $(Limit-Text -Text $Raw -Length 300)")
  }
  if ($parsed.PSObject.Properties["skipped"]) { return @("skipped: $($parsed.reason)") }
  if ($parsed.PSObject.Properties["error"]) { return @("error: $($parsed.error)") }
  $report = $parsed.report
  if ($null -eq $report) { return @("unrecognised response: $(Limit-Text -Text $Raw -Length 300)") }

  $items = New-Object System.Collections.Generic.List[object]
  foreach ($outcome in @($report.outcomes)) {
    if ($null -eq $outcome) { continue }
    $items.Add([pscustomobject]@{ Key = "$($outcome.itemId)/$($outcome.platform)"; State = "$($outcome.outcome)"; Detail = "$($outcome.detail)" })
  }
  $count = $items.Count
  foreach ($outcome in @($report.bufferOutcomes)) {
    if ($null -eq $outcome) { continue }
    $items.Add([pscustomobject]@{ Key = "$($outcome.itemId)/buffer"; State = "buffer-$($outcome.outcome)"; Detail = "$($outcome.detail)" })
  }
  if ($report.bufferError) {
    $items.Add([pscustomobject]@{ Key = "buffer/error"; State = "buffer-error"; Detail = "$($report.bufferError)" })
  }
  foreach ($check in @($report.authChecks)) {
    if ($null -eq $check -or $check.ok) { continue }
    $items.Add([pscustomobject]@{ Key = "auth/$($check.platform)"; State = "auth-failed"; Detail = "$($check.detail)" })
  }
  $queue = "$($report.queue)"
  if ($queue -and $queue -notmatch "^([A-Za-z]:[\\/]|/)") {
    $items.Add([pscustomobject]@{ Key = "queue"; State = "note"; Detail = $queue })
  }

  $changed = Get-ChangedLines -Items $items.ToArray() -StatePath $StatePath -Day $Day
  $counts = Format-StateCounts -Items $items.ToArray()
  $head = "$count outcomes"
  if ($counts) { $head += ": $counts" }
  $head += $(if ($changed.Count -gt 0) { " - $($changed.Count) changed" } else { " - no change" })
  if ($report.dryRun) { $head = "dry run, $head" }
  return @($head) + $changed.Lines
}

function Write-PublishRunSummary {
  param([string]$Log, [string]$ResponseFile, [string]$StatePath, [string]$Day = (Get-Date).ToString("yyyy-MM-dd"))

  $raw = ""
  if (Test-Path -LiteralPath $ResponseFile) {
    $raw = [System.IO.File]::ReadAllText($ResponseFile, $script:LogEncoding)
  }
  foreach ($line in @(Get-PublishRunLines -Raw $raw -StatePath $StatePath -Day $Day)) {
    Add-LogText -Path $Log -Text $line
    Write-Host $line
  }
}

function Get-ThreadsTickLines {
  param([string[]]$Lines, [int]$ExitCode, [string]$StatePath, [string]$Day)

  $items = New-Object System.Collections.Generic.List[object]
  $counts = ""
  foreach ($line in @($Lines)) {
    $text = "$line".Trim()
    if (-not $text) { continue }
    if ($text -match "^\[threads\]\s+(posted \d+, failed \d+, skipped \d+)\s*$") {
      $counts = $Matches[1]
    } elseif ($text -match "^\[threads\]\s+((?:follow-up )?slot\s+\d+\s+\S+)\s+\S+\s+(\w+)\s+\S+\s+(.*)$") {
      $items.Add([pscustomobject]@{ Key = $Matches[1]; State = $Matches[2]; Detail = $Matches[3] })
    } else {
      $key = "note " + (Limit-Text -Text ($text -replace "\d+", "#") -Length 80)
      $items.Add([pscustomobject]@{ Key = $key; State = "note"; Detail = $text })
    }
  }

  $changed = Get-ChangedLines -Items $items.ToArray() -StatePath $StatePath -Day $Day
  $head = if ($counts) { $counts } else { "no result line" }
  if ($ExitCode -ne 0) { $head += ", exit $ExitCode" }
  $head += $(if ($changed.Count -gt 0) { " - $($changed.Count) changed" } else { " - no change" })
  return @($head) + $changed.Lines
}

function Write-ThreadsTickSummary {
  param([string]$Log, [string[]]$Lines, [int]$ExitCode, [string]$StatePath, [string]$Day = (Get-Date).ToString("yyyy-MM-dd"))

  foreach ($line in @(Get-ThreadsTickLines -Lines $Lines -ExitCode $ExitCode -StatePath $StatePath -Day $Day)) {
    Add-LogText -Path $Log -Text $line
    Write-Host $line
  }
}
