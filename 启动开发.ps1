# 魔导书 Grimoire v7 — 开发模式启动脚本 (PowerShell)
Set-Location $PSScriptRoot

if (-not (Test-Path "node_modules")) {
    Write-Host "正在安装依赖..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "依赖安装失败！" -ForegroundColor Red
        exit 1
    }
}

Write-Host "启动开发模式..." -ForegroundColor Green
$env:VITE_DEV_SERVER_URL = "http://localhost:5173"
npx concurrently "npx vite" "wait-on http://localhost:5173 && npx electron ."
