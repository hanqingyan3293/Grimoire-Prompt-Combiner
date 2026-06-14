@echo off
title Grimoire v7
cd /d "%~dp0"

echo ================================================
echo  Grimoire v7 - Mo Dao Shu
echo ================================================
echo.

:: Check if build exists
if not exist "dist\main\main\index.js" goto do_build
if not exist "dist\renderer\index.html" goto do_build
echo [OK] Build found, skipping build step
goto launch

:do_build
echo Building...
call npm run build 2>&1
if errorlevel 1 (
    echo [ERROR] Build failed! Screenshot this window and report.
    pause
    exit /b 1
)
echo Build OK.

:launch
echo.
echo Starting Grimoire...
echo This window can be closed after Grimoire opens.
echo.
start "" "node_modules\.bin\electron.cmd" .
echo Grimoire is running.
echo.
echo Close Grimoire first, then press any key to close this window.
pause >nul