@echo off
setlocal EnableDelayedExpansion
title OutreachPro - Starting...

echo.
echo  ============================================
echo    OutreachPro - Email Outreach Automation
echo  ============================================
echo.

:: ── Check Node.js ──────────────────────────────────────────────────────────
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo  ERROR: Node.js not found. Please run INSTALL.bat first.
    pause
    exit /b 1
)

:: ── Check npm packages installed ───────────────────────────────────────────
if not exist "node_modules" (
    echo  node_modules not found. Running installer first...
    call INSTALL.bat
)

:: ── Check .env exists ──────────────────────────────────────────────────────
if not exist ".env" (
    echo  ERROR: .env file not found. Please run INSTALL.bat first.
    pause
    exit /b 1
)

:: ── Kill any existing process on port 3000 ─────────────────────────────────
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    taskkill /PID %%p /F >nul 2>&1
)

:: ── Start server ───────────────────────────────────────────────────────────
echo  Starting server...
echo  Press Ctrl+C in this window to stop.
echo.

:: Start server in background and capture port
start "OutreachPro Server" /min cmd /c "node server.js > server.log 2>&1"

:: Wait for server to be ready (up to 10 seconds)
set /a TRIES=0
:WAIT_LOOP
timeout /t 1 /nobreak >nul
set /a TRIES+=1
netstat -ano 2>nul | findstr ":3000 " | findstr "LISTENING" >nul
if %ERRORLEVEL% EQU 0 goto SERVER_READY
if %TRIES% LSS 10 goto WAIT_LOOP

echo  WARNING: Server may not have started. Check server.log for errors.
goto OPEN_BROWSER

:SERVER_READY
echo  Server is running at http://localhost:3000
echo.

:OPEN_BROWSER
echo  Opening browser...
start "" "http://localhost:3000"

echo.
echo  ============================================
echo    OutreachPro is running!
echo    http://localhost:3000
echo  ============================================
echo.
echo  To STOP the app: double-click STOP.bat
echo      or close the "OutreachPro Server" taskbar window
echo.
echo  (This window can be minimised)
echo.
pause
endlocal
