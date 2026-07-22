@echo off
setlocal enabledelayedexpansion
title CoLateral - Animated Video Studio (Remotion)

REM ============================================================
REM  CoLateral - Animated Video Studio launcher
REM
REM  Double-click this file to open Remotion Studio, where you
REM  preview and export the animated segments you record over.
REM  It will:
REM    1. Move into the remotion\ folder automatically
REM    2. Install the building blocks (only the first time)
REM    3. Open Remotion Studio in your browser
REM
REM  Keep the window that opens RUNNING while you use the studio.
REM  Close it (or press Ctrl+C) when you're done.
REM ============================================================

REM --- Step 0: Always run from the folder this .bat lives in ---
cd /d "%~dp0remotion"

echo.
echo ================================================
echo   CoLateral Animated Video Studio - starting up
echo ================================================
echo.

REM --- Step 1: Make sure Node.js is installed -----------------
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed, or not found on this PC.
  echo Install the LTS version from https://nodejs.org
  echo then double-click this file again.
  echo.
  pause
  exit /b 1
)

REM --- Step 2: First-time setup only --------------------------
if not exist "node_modules" (
  echo First run: installing the animation building blocks.
  echo This can take a few minutes. Later launches skip this step.
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERROR] Setup failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

REM --- Step 3: Open Remotion Studio ---------------------------
echo.
echo Opening Remotion Studio in your browser...
echo Keep THIS window open while you work. Close it to stop.
echo.
call npm run studio

pause
