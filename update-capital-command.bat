@echo off
title Capital Command - update to the latest main

REM Double-click this to pull whatever has landed on `main` into the copy of
REM Capital Command that runs your workflow, rebuild it, and restart the server.
REM Nothing changes here until you run it - see scripts\update-app.ps1.

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\update-app.ps1" %*

echo.
pause
