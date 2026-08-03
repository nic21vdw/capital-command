@echo off
title Capital Command

REM Double-click this to open Capital Command as a desktop app. It starts the
REM server if it isn't already running, then opens it in its own window.
REM
REM This window closes on its own - the app keeps running behind it, because
REM the publish runner and Threads autopilot post through it all day.
REM
REM To put it on the Desktop and Start Menu with an icon: npm run app:shortcut

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\open-app.ps1" %*

if errorlevel 1 pause
