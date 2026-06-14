@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist "node_modules" (
    echo 正在安装依赖...
    call npm install
)

echo 正在构建...
call npm run build

echo 启动应用...
npx electron .
exit
