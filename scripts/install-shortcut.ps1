# Puts Capital Command on the Desktop and in the Start Menu, with its icon, so
# it launches like any other installed application.
#
#   npm run app:shortcut
#
# The shortcut runs scripts\open-app.ps1 through a hidden console, so there is
# no black window in front of the app while it starts.

param(
  [switch]$Remove
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$icon = Join-Path $root "public\icons\capital-command.ico"
$script = Join-Path $root "scripts\open-app.ps1"

$targets = @(
  (Join-Path ([Environment]::GetFolderPath("Desktop")) "Capital Command.lnk"),
  (Join-Path ([Environment]::GetFolderPath("StartMenu")) "Programs\Capital Command.lnk")
)

if ($Remove) {
  foreach ($target in $targets) {
    if (Test-Path $target) {
      Remove-Item $target -Force
      Write-Host "Removed $target"
    }
  }
  exit 0
}

if (-not (Test-Path $script)) { throw "Could not find $script - run this from the capital-command checkout." }

$shell = New-Object -ComObject WScript.Shell

foreach ($target in $targets) {
  New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null

  $link = $shell.CreateShortcut($target)
  # conhost --headless keeps the console the shortcut needs from ever appearing.
  $link.TargetPath = "$env:SystemRoot\System32\conhost.exe"
  $link.Arguments = "--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$script`""
  $link.WorkingDirectory = $root
  $link.Description = "Open Capital Command"
  if (Test-Path $icon) { $link.IconLocation = $icon }
  $link.Save()

  Write-Host "Created $target"
}

Write-Host ""
Write-Host "Capital Command is on your Desktop and in the Start Menu." -ForegroundColor Green
Write-Host "Remove them again with: npm run app:shortcut -- -Remove"
