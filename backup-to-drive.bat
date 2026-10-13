@echo off
setlocal
title Nic Vandewetering - Backup to Google Drive

REM ============================================================
REM  Nic Vandewetering - one-click data backup (Windows)
REM
REM  Double-click this file to zip every queue and setting under
REM  data\ (publish queue, Threads queue, clips, long-form,
REM  automations, agents and the rest) into your Google Drive.
REM  Nothing is uploaded by this app directly - it drops the zip
REM  into your Google Drive for Desktop folder and Drive syncs it
REM  to the cloud for you.
REM
REM  This is the same command the nightly task runs:
REM    npm run backup:state
REM
REM  Set BACKUP_DRIVE_DIR in your .env to a path inside your synced
REM  Google Drive folder (for example  G:\My Drive). If it is blank
REM  the backup looks for Google Drive for Desktop on its own.
REM  Passwords, tokens and .env are never included.
REM ============================================================

REM Always run from the folder this .bat file lives in.
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found on your PATH.
  echo This backup needs Node.js, which the app already requires.
  echo.
  pause
  exit /b 1
)

call npm run backup:state
set "BACKUP_EXIT=%errorlevel%"

echo.
echo Press any key to close this window.
pause >nul

endlocal & exit /b %BACKUP_EXIT%
