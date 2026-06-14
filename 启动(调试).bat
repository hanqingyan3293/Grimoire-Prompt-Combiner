@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ================================================
echo  魔导书 Grimoire v7 (调试模式)
echo ================================================
echo.
echo 当前目录: %CD%
echo.

if not exist "node_modules" (
    echo [ERROR] 找不到 node_modules
    pause
    exit /b 1
)

echo 检查 electron...
if exist "node_modules\.bin\electron.cmd" (
    echo [OK] electron.cmd 存在
) else (
    echo [WARN] node_modules\.bin\electron.cmd 不存在
)

echo.
echo 检查 dist...
if exist "dist\renderer\index.html" (
    echo [OK] dist/renderer/index.html 存在
) else (
    echo [WARN] dist/renderer/index.html 不存在，请先构建
)

if exist "dist\main\main\index.js" (
    echo [OK] dist/main/main/index.js 存在
) else (
    echo [WARN] dist/main/main/index.js 不存在，请先构建
)

if exist "dist\main\preload\index.js" (
    echo [OK] dist/main/preload/index.js 存在
) else (
    echo [WARN] dist/main/preload/index.js 不存在，请先构建
)

if exist "dist\main\data\tags.json" (
    echo [OK] dist/main/data/tags.json 存在
) else (
    echo [WARN] dist/main/data/tags.json 不存在
)

echo.
echo 正在构建...
call npm run build
if errorlevel 1 (
    echo [ERROR] 构建失败！
    pause
    exit /b 1
)

echo.
echo 启动应用中...
echo.
call npx electron .
echo.
echo 应用已退出
pause