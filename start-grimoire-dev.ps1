$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

Write-Host '[Grimoire] Project:' $PSScriptRoot

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
