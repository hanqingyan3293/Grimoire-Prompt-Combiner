@echo off
chcp 65001 >nul
setlocal
title Build Grimoire Portable
cd /d "%~dp0"

echo ================================================
echo  Grimoire v7.1 - portable EXE builder
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

echo [INFO] Building portable package...
call npm run pack:portable
if errorlevel 1 (
    echo [ERROR] Portable package build failed.
    pause
    exit /b 1
)

echo.
echo [OK] Portable EXE has been generated under the release folder.
echo Open: release
pause
endlocal
