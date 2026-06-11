@echo off
chcp 65001 >nul
title 魔导书 - AI绘画提示词组合器
cd /d "D:\File\Data\魔法书"

echo ================================================
echo   魔导书 - AI绘画提示词组合器
echo   正在启动...
echo ================================================
echo.

REM 安装依赖 (静默)
pip install -q flask openpyxl 2>nul

echo 正在启动服务...
start "" http://127.0.0.1:5800
python server.py

pause
