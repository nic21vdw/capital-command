@echo off
setlocal enabledelayedexpansion
title Capital Command - Local Launcher

REM ============================================================
REM  Capital Command - one-click local launcher (Windows)
REM
REM  You can run this file two ways:
REM    * From inside a cloned/downloaded Capital Command folder, OR
REM    * On its own (e.g. saved to your Desktop) - it will download
REM      the app for you the first time.
REM
REM  Each launch updates to the latest "main" branch, then starts
REM  the app and opens it in your browser at http://localhost:3000.
REM
REM  Keep the window that opens running while you use the app.
REM  Close it (or press Ctrl+C) to stop the local server.
REM ============================================================

set "REPO_URL=https://github.com/nic21vdw/capital-command.git"
set "BRANCH=main"

REM Always start from the folder this .bat file lives in.
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

REM --- Work out where the app lives ----------------------------
REM If THIS folder is already a proper git copy of the app, use it.
REM Otherwise (e.g. you downloaded a ZIP, or just this .bat alone),
REM download a fresh copy into your user folder and use that.
set "ISREPO="
if exist ".git\config" if exist "package.json" set "ISREPO=1"

if defined ISREPO (
  set "APP_DIR=%CD%"
  echo Using the app files in this folder.
) else (
  set "APP_DIR=%USERPROFILE%\capital-command-app"
  if exist "!APP_DIR!\.git\config" (
    echo Using your existing copy at "!APP_DIR!".
  ) else (
    echo No app files here yet. Downloading Capital Command to:
    echo   !APP_DIR!
    echo This only happens the first time...
    git clone %REPO_URL% "!APP_DIR!"
    if errorlevel 1 (
      echo [ERROR] Download failed. Check your internet connection and try again.
      echo.
      pause
      exit /b 1
    )
  )
)

cd /d "!APP_DIR!"

REM --- Update local files to exactly match the cloud ----------
REM  Your local app data (data\capital-command.json), node_modules
REM  and .env are git-ignored, so they are preserved.
echo.
echo [1/3] Getting the latest changes from GitHub...
git fetch origin %BRANCH%
if errorlevel 1 (
  echo [ERROR] Could not reach GitHub. Check your internet connection.
  echo.
  pause
  exit /b 1
)
git checkout %BRANCH% >nul 2>nul
git reset --hard origin/%BRANCH%
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
    echo Created a .env file from .env.example.
  )
)

REM --- Install dependencies -----------------------------------
echo [2/3] Installing dependencies (this can take a few minutes the
echo       very first time, then it is fast on later runs)...
call npm install
if errorlevel 1 (
  echo [ERROR] "npm install" failed. Scroll up to see the error.
  echo.
  pause
  exit /b 1
)

REM --- Free port 3000 if a previous run is still using it ------
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":3000 .*LISTENING"') do (
  echo Stopping a previous instance still using port 3000 (PID %%P)...
  taskkill /F /PID %%P >nul 2>nul
)

REM --- Start the app and open the browser ---------------------
echo [3/3] Starting the app...
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

echo.
echo The local server has stopped.
pause
endlocal
