chcp 65001 >nul
@echo off
cd /d "%~dp0"

echo ================================================
echo  魔导书 Grimoire v7
echo ================================================
echo.

if not exist "node_modules" (
    echo [ERROR] node_modules not found
    pause
    exit /b 1
)

echo Building...
call npm run build
if errorlevel 1 (
    echo [ERROR] Build failed!
    pause
    exit /b 1
)

echo.
echo Starting...
npx electron .
echo.
echo App exited
pause
