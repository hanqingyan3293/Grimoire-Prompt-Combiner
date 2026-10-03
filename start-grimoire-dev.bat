@echo off
setlocal
cd /d "%~dp0"

echo [Grimoire] Checking for an existing development instance...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$port = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue; if ($port) { Write-Host '[Grimoire] Port 5173 is already in use. Close the old Grimoire instance first.' -ForegroundColor Red; exit 2 }"
if errorlevel 2 (
  pause
  exit /b 2
)

where node >nul 2>nul
if errorlevel 1 (
  echo [Grimoire] Node.js was not found in PATH.
  echo Install Node.js LTS, then run this file again.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [Grimoire] npm was not found in PATH.
  echo Install Node.js LTS, then run this file again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [Grimoire] Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo [Grimoire] Dependency installation failed.
    pause
    exit /b 1
  )
)

echo [Grimoire] Building the Electron main process...
call npm run build:main
if errorlevel 1 (
  echo [Grimoire] Main process build failed.
  pause
  exit /b 1
)

echo [Grimoire] Starting development mode...
call npm run dev > "%~dp0grimoire-dev.log" 2>&1
set EXIT_CODE=%ERRORLEVEL%

if not "%EXIT_CODE%"=="0" (
  echo [Grimoire] Development mode exited with code %EXIT_CODE%.
  echo [Grimoire] Full output was written to grimoire-dev.log.
  pause
)
endlocal & exit /b %EXIT_CODE%
