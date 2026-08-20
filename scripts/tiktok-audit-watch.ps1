# Watches for the TikTok app audit to clear, and says so loudly when it does.
#
# TikTok has no "is my app approved yet" endpoint, so this asks the question
# that matters: it opens a Direct Post and reads the answer. Init only - no
# bytes are uploaded, so nothing is posted and nothing lands in the inbox.
#
# It cannot tell a queued review from a rejected one - both refuse Direct Post
# with the same code, and a rejection arrives only in the developer portal. If
# this has logged NOT_APPROVED for weeks, read docs/TIKTOK.md and open the
# portal before assuming anyone is still reviewing anything.
#
# It logs SANDBOX instead when the configured client key belongs to the sandbox
# app. That answer can never change: approval lands on the production app, so
# the production client key and secret have to reach .env before this watcher
# is watching anything at all.
#
# Register it to check every few hours:
#
#   npm run tiktok:watch:register
#
# When the audit clears it writes TIKTOK-APPROVED.txt to the Desktop, pops a
# message box, and logs it. It deliberately does NOT flip TIKTOK_AUDITED or
# publish anything - going live should be a decision someone makes awake.

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $root "tiktok-audit-watch.log"

Set-Location $root

if ((Test-Path $log) -and ((Get-Item $log).Length -gt 1MB)) {
  Move-Item $log "$log.old" -Force
}

$stamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
$output = & npx.cmd tsx src/lib/publisher/auditCheck.ts 2>&1 | Out-String
$code = $LASTEXITCODE
$line = "$stamp  exit=$code  $($output.Trim())"
Write-Host $line
Add-Content -Path $log -Value $line -Encoding utf8

if ($code -ne 0) { exit $code }

# Approved. Make it impossible to miss.
$marker = Join-Path ([Environment]::GetFolderPath("Desktop")) "TIKTOK-APPROVED.txt"
@(
  "TikTok approved the Capital Command app on $stamp.",
  "",
  "Direct Post is now open. To publish scheduled clips automatically:",
  "  1. Set TIKTOK_AUDITED=true in .env, alongside the production TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET",
  "  2. Restart the app (or let the publish runner restart it)",
  "",
  "Scheduled clips will then post straight to the profile - no inbox tap.",
  "",
  "Remove this watcher with:",
  '  Unregister-ScheduledTask -TaskName "Capital Command tiktok audit watch" -Confirm:$false'
) | Set-Content -Path $marker -Encoding utf8

try {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show(
    "TikTok approved the Capital Command app. Set TIKTOK_AUDITED=true to start publishing automatically.",
    "TikTok audit cleared") | Out-Null
} catch {
  # Headless or no desktop session - the marker file and the log still carry it.
}

exit 0
