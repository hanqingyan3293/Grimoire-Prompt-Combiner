@echo off
chcp 65001 >nul
setlocal
title Grimoire v7.1
cd /d "%~dp0"

echo ================================================
echo  Grimoire v7.1 - source launcher
echo ================================================
echo.

where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm was not found. Please install Node.js 18+ first.
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo [INFO] Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed.
        pause
        exit /b 1
    )
)

if not exist "dist\main\main\index.js" goto build_app
if not exist "dist\renderer\index.html" goto build_app
goto launch_app

:build_app
echo [INFO] Building application...
call npm run build
if errorlevel 1 (
    echo [ERROR] Build failed.
    pause
    exit /b 1
)

:launch_app
echo [INFO] Starting Grimoire...
echo.
call npm start
if errorlevel 1 (
    echo.
    echo [ERROR] Grimoire exited with an error.
    pause
    exit /b 1
)

endlocal
