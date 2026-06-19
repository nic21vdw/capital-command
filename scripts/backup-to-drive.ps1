$ErrorActionPreference = "Stop"

# ============================================================
#  Nic Vandewetering - back up your local data to Google Drive
#
#  Your whole "database" is a single file: data\capital-command.json
#  (see src\lib\storage\store.ts). This script copies a timestamped
#  snapshot of that file into a folder inside your Google Drive, so
#  Google Drive for Desktop syncs it to the cloud automatically.
#
#  No API keys, no OAuth, no sign-in. It just copies a file.
#
#  Where does it copy to?  The first of these that is set:
#    1. The -Dest argument passed to this script
#    2. BACKUP_DRIVE_DIR in your .env
#    3. CLIPS_DRIVE_DIR in your .env (reuses your existing Drive folder)
#    4. A local "backups\" folder in the project (NOT synced - a warning
#       is shown so you know it stayed on this PC only)
# ============================================================

param(
  [string]$Dest = ""
)

$root = Split-Path -Parent $PSScriptRoot
$dataFile = Join-Path $root "data\capital-command.json"

# --- Helper: read a single key from the .env file -------------
function Get-EnvValue([string]$key) {
  $envPath = Join-Path $root ".env"
  if (-not (Test-Path $envPath)) { return "" }
  foreach ($line in Get-Content $envPath) {
    $trimmed = $line.Trim()
    if ($trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) { continue }
    $name = $trimmed.Substring(0, $trimmed.IndexOf("=")).Trim()
    if ($name -eq $key) {
      return $trimmed.Substring($trimmed.IndexOf("=") + 1).Trim().Trim('"')
    }
  }
  return ""
}

Write-Output ""
Write-Output "============================================"
Write-Output "  Nic Vandewetering - backup to Google Drive"
Write-Output "============================================"
Write-Output ""

# --- Make sure there is data to back up -----------------------
if (-not (Test-Path $dataFile)) {
  Write-Output "[!] No data file found yet at:"
  Write-Output "    $dataFile"
  Write-Output ""
  Write-Output "    Start the app at least once (so it saves some data),"
  Write-Output "    then run this backup again."
  Write-Output ""
  exit 0
}

# --- Decide where backups should go ---------------------------
$syncedToDrive = $true
if (-not $Dest) { $Dest = Get-EnvValue "BACKUP_DRIVE_DIR" }
if (-not $Dest) { $Dest = Get-EnvValue "CLIPS_DRIVE_DIR" }
if (-not $Dest) {
  $Dest = Join-Path $root "backups"
  $syncedToDrive = $false
}

$backupFolder = Join-Path $Dest "Nic Vandewetering Backups"
New-Item -ItemType Directory -Force -Path $backupFolder | Out-Null

# --- Copy a timestamped snapshot ------------------------------
$stamp = Get-Date -Format "yyyy-MM-dd_HHmm"
$target = Join-Path $backupFolder "capital-command-$stamp.json"
Copy-Item -Path $dataFile -Destination $target -Force

Write-Output "[OK] Backed up your data to:"
Write-Output "     $target"
Write-Output ""

if ($syncedToDrive) {
  Write-Output "     Google Drive for Desktop will sync this to the cloud"
  Write-Output "     automatically. You're done."
} else {
  Write-Output "[!] This was saved INSIDE the project only - it is NOT in"
  Write-Output "    Google Drive yet. To send backups to your Drive, set"
  Write-Output "    BACKUP_DRIVE_DIR in your .env to a path inside your"
  Write-Output "    Google Drive for Desktop folder, for example:"
  Write-Output "      BACKUP_DRIVE_DIR=G:\My Drive"
  Write-Output "    then run this backup again."
}
Write-Output ""

# --- Tidy up: keep only the most recent 24 snapshots ----------
$snapshots = Get-ChildItem -Path $backupFolder -Filter "capital-command-*.json" |
  Sort-Object LastWriteTime -Descending
if ($snapshots.Count -gt 24) {
  $snapshots | Select-Object -Skip 24 | ForEach-Object {
    Remove-Item $_.FullName -Force
  }
  Write-Output "(Kept the 24 most recent backups; older ones were removed.)"
  Write-Output ""
}
