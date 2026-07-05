@echo off
setlocal enabledelayedexpansion
title CoLateral Command Dashboard - Local Launcher

REM ============================================================
REM  CoLateral Command Dashboard - simple local launcher
REM
REM  Just double-click this file to start the dashboard on your
REM  own PC. It will:
REM    1. Move into this project folder automatically
REM    2. Install the building blocks (only the first time)
REM    3. Start the local dashboard
REM    4. Open it in your browser at http://localhost:3000
REM
REM  Keep the window that opens RUNNING while you use the app.
REM  Close it (or press Ctrl+C) when you want to stop the server.
REM ============================================================

REM --- Step 0: Always run from the folder this .bat lives in ---
REM  "%~dp0" is a Windows shortcut meaning "the folder this file
REM  is sitting in", so it works no matter where you double-click.
cd /d "%~dp0"

echo.
echo ================================================
echo   CoLateral Command Dashboard - starting up
echo ================================================
echo.

REM --- Step 1: Make sure Node.js is installed ------------------
REM  Node.js runs the dashboard. If it is missing, stop early
REM  with a friendly message instead of a confusing error.
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed, or not found on this PC.
  echo Install the LTS version from https://nodejs.org
  echo then double-click this file again.
  echo.
  pause
  exit /b 1
)

REM --- Step 2: Create a .env file if one is missing ------------
REM  The app reads optional settings from a .env file. If you
REM  don't have one yet, we copy the example so the app can run.
if not exist ".env" (
  if exist ".env.example" (
    copy ".env.example" ".env" >nul
    echo Created a .env file from .env.example. You can edit it
    echo later to add optional API keys - it is fine to skip this.
    echo.
  )
)

REM --- Step 3: Install dependencies ONLY if they are missing ---
REM  "node_modules" is the folder of building blocks the app needs.
REM  If it already exists we skip install so launching stays fast.
if not exist "node_modules" (
  echo [1/2] First-time setup: installing dependencies.
  echo       This can take a few minutes. Later runs skip this step.
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERROR] "npm install" did not finish. Scroll up to read why.
    echo.
    pause
    exit /b 1
  )
) else (
  echo [1/2] Dependencies already installed - skipping setup.
)

REM --- Step 4: Start the dashboard and open the browser --------
echo [2/2] Starting the CoLateral Command Dashboard...
echo.
echo   Your dashboard will open at:  http://localhost:3000
echo.
echo   Keep THIS window open while you use the dashboard.
echo   Press Ctrl+C (or close this window) to stop the server.
echo.

REM  Wait a few seconds for the server to wake up, then open the
REM  browser in the background so you don't have to type the URL.
start "" cmd /c "timeout /t 6 >nul & start "" http://localhost:3000"

REM  Run the local development server in THIS window. This keeps
REM  running (and shows any errors) until you stop it.
call npm run dev

REM  If the server stops, pause so any final messages stay visible.
echo.
echo The dashboard server has stopped.
pause
endlocal
