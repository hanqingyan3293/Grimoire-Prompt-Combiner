@echo off
setlocal
cd /d "%~dp0"

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
