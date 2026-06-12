@echo off
set PATH=C:\Program Files\nodejs;%PATH%
echo.
echo ============================================
echo   魔导书 Grimoire v5 - AI绘画提示词工作台
echo ============================================
echo.
echo [1] 开发模式 (需先启动 Vite)
echo [2] 生产模式 (构建后运行)
echo.

cd /d "D:\File\Data\魔法书\v5"

echo 启动 Vite 开发服务器...
start "Vite" /min cmd /c "set PATH=C:\Program Files\nodejs;%%PATH%% && npx vite"

echo 等待 Vite 就绪...
timeout /t 4 /nobreak >nul

echo 启动 Electron...
set PATH=C:\Program Files\nodejs;%PATH%
node_modules\electron\dist\electron.exe .

pause