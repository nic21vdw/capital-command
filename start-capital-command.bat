@echo off
setlocal enabledelayedexpansion
title Capital Command - Local Launcher

REM ============================================================
REM  Capital Command - one-click local launcher (Windows)
REM
REM  Double-click this file to:
REM    1. Pull the latest changes from GitHub (the "main" branch)
REM    2. Install/update dependencies
REM    3. Start the app locally and open it in your browser
REM
REM  Keep the window that opens running while you use the app.
REM  Close it (or press Ctrl+C) to stop the local server.
REM ============================================================

REM Always run from the folder this .bat file lives in.
cd /d "%~dp0"

echo.
echo ============================================
echo   Capital Command - starting up
echo ============================================
echo.

REM --- Check prerequisites -------------------------------------
where git >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Git is not installed, or not on your PATH.
  echo Install "Git for Windows" from https://git-scm.com/download/win
  echo then run this file again.
  echo.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed, or not on your PATH.
  echo Install the LTS version from https://nodejs.org
  echo then run this file again.
  echo.
  pause
  exit /b 1
)

REM --- Make sure this folder is the Capital Command git repo ---
if not exist ".git" (
  echo [ERROR] This folder is not a git checkout of Capital Command.
  echo Please follow the first-time steps in LOCAL_SETUP.md.
  echo.
  pause
  exit /b 1
)

REM --- 1/4: Fetch the latest code from GitHub ------------------
echo [1/4] Fetching the latest changes from GitHub...
git fetch origin main
if errorlevel 1 (
  echo [ERROR] Could not reach GitHub. Check your internet connection
  echo and that you are signed in to git, then try again.
  echo.
  pause
  exit /b 1
)

REM --- 2/4: Update local files to exactly match the cloud -----
REM  This makes your PC mirror the latest "main" branch.
REM  Your local app data (data\capital-command.json), node_modules
REM  and .env are git-ignored, so they are preserved.
echo [2/4] Updating local files to match the cloud...
git checkout main >nul 2>nul
git reset --hard origin/main
if errorlevel 1 (
  echo [ERROR] Could not update local files to match the cloud.
  echo.
  pause
  exit /b 1
)

REM --- Make sure an .env exists so the app can run -------------
if not exist ".env" (
  if exist ".env.example" (
    copy ".env.example" ".env" >nul
    echo Created a .env file from .env.example. You can edit it later
    echo to add optional API keys.
  )
)

REM --- 3/4: Install dependencies ------------------------------
echo [3/4] Installing dependencies (this can take a few minutes the
echo       very first time, then it is fast on later runs)...
call npm install
if errorlevel 1 (
  echo [ERROR] "npm install" failed. Scroll up to see the error.
  echo.
  pause
  exit /b 1
)

REM --- Free port 3000 if a previous run is still using it ------
REM  This stops a leftover server from an earlier launch so the app
REM  always opens on the same address (http://localhost:3000).
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":3000 .*LISTENING"') do (
  echo Stopping a previous instance still using port 3000 (PID %%P)...
  taskkill /F /PID %%P >nul 2>nul
)

REM --- 4/4: Start the app and open the browser ----------------
echo [4/4] Starting the app...
echo.
echo   The app will open at http://localhost:3000
echo   Keep THIS window open while you use the app.
echo   Close it (or press Ctrl+C) to stop the local server.
echo.

REM Open the browser shortly after the server has had time to boot.
start "" cmd /c "timeout /t 6 >nul & start "" http://localhost:3000"

REM Run the dev server in this window, pinned to port 3000 so the URL above
REM always matches. This blocks until you close the window.
call npm run dev -- -p 3000

endlocal
