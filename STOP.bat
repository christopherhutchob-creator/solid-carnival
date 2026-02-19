@echo off
title OutreachPro - Stopping

echo.
echo  Stopping OutreachPro...

:: Kill the named server window
taskkill /FI "WINDOWTITLE eq OutreachPro Server" /F >nul 2>&1

:: Also kill anything on port 3000
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    taskkill /PID %%p /F >nul 2>&1
    echo  Stopped process %%p
)

echo  OutreachPro stopped.
echo.
timeout /t 2 /nobreak >nul
