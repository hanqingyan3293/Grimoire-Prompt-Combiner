@echo off
chcp 65001 >nul
cd /d "D:\File\Data\魔法书\v5.3.2"
set PATH=C:\Program Files\nodejs;%PATH%
echo 魔导书 Grimoire v5.3.2 - 开发模式
echo.
echo 安装依赖...
call npm install
echo.
echo 启动开发服务器...
start "Grimoire-Dev" npx vite
timeout /t 3 /nobreak >nul
echo 启动Electron...
npx electron .
pause
