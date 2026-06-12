@echo off
chcp 65001 >nul
title 魔导书 Grimoire v6.0

cd /d "%~dp0"

echo.
echo ╔══════════════════════════════════╗
echo ║   魔导书 Grimoire v6.0           ║
echo ║   AI绘画提示词工作站              ║
echo ╚══════════════════════════════════╝
echo.

REM Clean cache
if exist ".vite" rmdir /s /q ".vite" 2>nul

REM Check node_modules
if not exist "node_modules\electron\dist\electron.exe" (
    echo [错误] 缺少 Electron 运行环境
    echo 请先运行: npm install
    pause
    exit /b 1
)

echo [1/2] 启动开发服务器...
start "Grimoire-Vite" /min cmd /c "npx vite --host --port 5173"

REM Wait for Vite
echo [2/2] 等待服务器就绪...
:wait
timeout /t 2 /nobreak >nul
powershell -Command "try { $r = Invoke-WebRequest 'http://localhost:5173' -TimeoutSec 3 -UseBasicParsing; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 goto wait

echo [启动] 启动魔导书...
start "" "node_modules\electron\dist\electron.exe" .

echo.
echo 魔导书已启动！关闭此窗口不影响使用。
timeout /t 2 /nobreak >nul
exit