@echo off
setlocal EnableDelayedExpansion
title OutreachPro - Installer

echo.
echo  ============================================
echo    OutreachPro - Email Outreach Automation
echo    First-Time Setup
echo  ============================================
echo.

:: ── Check Node.js ──────────────────────────────────────────────────────────
echo [1/4] Checking for Node.js...
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  ERROR: Node.js is not installed.
    echo.
    echo  Please download and install Node.js from:
    echo    https://nodejs.org/en/download  (choose the LTS version)
    echo.
    echo  After installing Node.js, run this installer again.
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo    Found Node.js %NODE_VER%  OK

:: ── Install npm packages ────────────────────────────────────────────────────
echo.
echo [2/4] Installing packages (this may take a minute)...
call npm install --loglevel error
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  ERROR: npm install failed. Check your internet connection and try again.
    pause
    exit /b 1
)
echo    Packages installed  OK

:: ── Create .env from .env.example ──────────────────────────────────────────
echo.
echo [3/4] Setting up configuration file...
if not exist ".env" (
    copy ".env.example" ".env" >nul
    echo    Created .env  - please edit it with your email credentials
) else (
    echo    .env already exists  - skipping
)

:: ── Create data directory ───────────────────────────────────────────────────
echo.
echo [4/4] Creating data directories...
if not exist "src\data" mkdir src\data
if not exist "uploads"  mkdir uploads
echo    Directories ready  OK

:: ── Done ────────────────────────────────────────────────────────────────────
echo.
echo  ============================================
echo    Setup complete!
echo  ============================================
echo.
echo  NEXT STEPS:
echo  -----------
echo  1. Open the file ".env" in Notepad
echo  2. Fill in your Gmail address and App Password
echo     (see SETUP_GUIDE.txt for instructions)
echo  3. Double-click "START.bat" to launch the app
echo.
echo  Press any key to open .env in Notepad now...
pause >nul
start notepad .env

endlocal
