$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

Write-Host '[Grimoire] Project:' $PSScriptRoot

$stale = @()
try {
  $stale += Get-Process electron -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -and $_.Path.StartsWith($PSScriptRoot, [System.StringComparison]::OrdinalIgnoreCase)
  }
} catch {}
$portOwners = @()
try { $portOwners = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue } catch {}
if ($stale.Count -gt 0 -or $portOwners.Count -gt 0) {
  Write-Host '[Grimoire] 检测到已有开发实例或 5173 端口占用。' -ForegroundColor Yellow
  if ($stale.Count -gt 0) { Write-Host ('[Grimoire] Electron PID: ' + (($stale | Select-Object -ExpandProperty Id) -join ', ')) -ForegroundColor Yellow }
  if ($portOwners.Count -gt 0) { Write-Host ('[Grimoire] 5173 端口 PID: ' + (($portOwners | Select-Object -ExpandProperty OwningProcess -Unique) -join ', ')) -ForegroundColor Yellow }
  Write-Host '[Grimoire] 请先关闭旧的魔导书窗口/进程，再重新运行此脚本。脚本不会自动结束进程。' -ForegroundColor Red
  Read-Host 'Press Enter to close'
  exit 2
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host '[Grimoire] Node.js was not found in PATH.' -ForegroundColor Red
  Read-Host 'Press Enter to close'
  exit 1
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host '[Grimoire] npm was not found in PATH.' -ForegroundColor Red
  Read-Host 'Press Enter to close'
  exit 1
}

if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules'))) {
  Write-Host '[Grimoire] Installing dependencies...' -ForegroundColor Yellow
  & npm install
  if ($LASTEXITCODE -ne 0) {
    Write-Host '[Grimoire] Dependency installation failed.' -ForegroundColor Red
    Read-Host 'Press Enter to close'
    exit $LASTEXITCODE
  }
}

Write-Host '[Grimoire] Building the Electron main process...' -ForegroundColor Yellow
& npm run build:main
if ($LASTEXITCODE -ne 0) {
  Write-Host '[Grimoire] Main process build failed.' -ForegroundColor Red
  Read-Host 'Press Enter to close'
  exit $LASTEXITCODE
}

Write-Host '[Grimoire] Starting development mode...' -ForegroundColor Cyan
& npm run dev
$code = $LASTEXITCODE
if ($code -ne 0) {
  Write-Host "[Grimoire] Development mode exited with code $code" -ForegroundColor Red
  Read-Host 'Press Enter to close'
}
exit $code
