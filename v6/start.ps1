$env:Path = "C:\Program Files\nodejs;" + $env:Path
Set-Location "D:\File\Data\魔法书\v5"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  魔导书 Grimoire v5" -ForegroundColor Magenta
Write-Host "  AI绘画提示词工作台" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "构建项目..." -ForegroundColor Yellow
npm run build

Write-Host "启动 Electron..." -ForegroundColor Green
& "D:\File\Data\魔法书\v5\node_modules\electron\dist\electron.exe" .