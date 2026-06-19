@echo off
setlocal
title Nic Vandewetering - Backup to Google Drive

REM ============================================================
REM  Nic Vandewetering - one-click data backup (Windows)
REM
REM  Double-click this file once a month (or whenever you like) to
REM  save a timestamped copy of your dashboard data into your
REM  Google Drive. Nothing is uploaded by this app directly - it
REM  drops a file into your Google Drive for Desktop folder and
REM  Drive syncs it to the cloud for you.
REM
REM  Set BACKUP_DRIVE_DIR in your .env to a path inside your synced
REM  Google Drive folder (for example  G:\My Drive). If you already
REM  set CLIPS_DRIVE_DIR for clip syncing, that is reused.
REM ============================================================

REM Always run from the folder this .bat file lives in.
cd /d "%~dp0"

where powershell >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Windows PowerShell was not found on your PATH.
  echo This backup needs PowerShell, which ships with Windows.
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\backup-to-drive.ps1"

echo.
echo Press any key to close this window.
pause >nul

endlocal
