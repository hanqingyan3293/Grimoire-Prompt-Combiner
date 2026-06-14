# 魔导书 Grimoire v7 — 启动脚本
Set-Location $PSScriptRoot

Write-Host "正在启动魔导书 Grimoire v7..." -ForegroundColor Green
Write-Host "窗口即将打开，请稍候..." -ForegroundColor Yellow

$env:VITE_DEV_SERVER_URL = "http://localhost:5173"

# 后台启动 Vite
$viteJob = Start-Job -ScriptBlock {
    Set-Location $using:PSScriptRoot
    npx vite --port 5173 2>&1
} | Out-Null

# 等待 Vite 就绪
Write-Host "等待开发服务器就绪..." -ForegroundColor Gray
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        $null = Invoke-WebRequest -Uri "http://localhost:5173" -TimeoutSec 1 -UseBasicParsing
        $ready = $true
        break
    } catch {
        Start-Sleep -Milliseconds 500
    }
}

if (-not $ready) {
    Write-Host "开发服务器启动超时，尝试直接启动..." -ForegroundColor Red
}

# 启动 Electron（直接运行，不等待退出）
Start-Process -FilePath "npx" -ArgumentList "electron", "." -WindowStyle Normal

Write-Host "已启动！如果窗口没有出现，请检查是否有错误弹窗。" -ForegroundColor Green
Write-Host "关闭本窗口不会关闭应用。" -ForegroundColor Gray
