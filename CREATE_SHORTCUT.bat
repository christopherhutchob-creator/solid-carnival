@echo off
:: Creates a desktop shortcut so the user can launch from their desktop
title OutreachPro - Create Desktop Shortcut

set SCRIPT_DIR=%~dp0
set SHORTCUT=%USERPROFILE%\Desktop\OutreachPro.lnk

:: Use PowerShell to create the shortcut
powershell -NoProfile -Command ^
  "$ws = New-Object -ComObject WScript.Shell; ^
   $s  = $ws.CreateShortcut('%SHORTCUT%'); ^
   $s.TargetPath      = '%SCRIPT_DIR%START.bat'; ^
   $s.WorkingDirectory= '%SCRIPT_DIR%'; ^
   $s.WindowStyle     = 1; ^
   $s.IconLocation    = 'shell32.dll,137'; ^
   $s.Description     = 'Launch OutreachPro Email Automation'; ^
   $s.Save()"

if exist "%SHORTCUT%" (
    echo.
    echo  Desktop shortcut created!
    echo  Look for "OutreachPro" on your Desktop.
    echo.
) else (
    echo.
    echo  Could not create shortcut. You can still run START.bat directly.
    echo.
)
timeout /t 3 /nobreak >nul
