$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

function Pause-Grimoire {
  param([string]$Message = 'Press Enter to close')
  Read-Host $Message | Out-Null
}

function Get-CommandLineForProcess {
  param([int]$ProcessId)
  try {
    $item = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $ProcessId) -ErrorAction Stop
    return [string]$item.CommandLine
  } catch {
    return ''
  }
}

function Test-ProjectProcess {
  param($Process, [string]$ProjectRoot)
  $commandLine = [string]$Process.CommandLine
  $executablePath = [string]$Process.ExecutablePath
  return (($commandLine -and $commandLine.IndexOf($ProjectRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) -or
    ($executablePath -and $executablePath.IndexOf($ProjectRoot, [System.StringComparison]::OrdinalIgnoreCase) -eq 0))
}

Write-Host '[Grimoire] Project:' $PSScriptRoot

$projectElectronOwners = @()
try {
  $projectElectronOwners = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.Name -match '^(electron|grimoire)(\.exe)?$' -and (Test-ProjectProcess $_ $PSScriptRoot)
    } |
    Select-Object -ExpandProperty ProcessId -Unique)
} catch {}

if ($projectElectronOwners.Count -gt 0) {
  Write-Host '[Grimoire] An existing Grimoire Electron process was found.' -ForegroundColor Red
  Write-Host ('[Grimoire] Electron PID: ' + ($projectElectronOwners -join ', ')) -ForegroundColor Red
  Write-Host '[Grimoire] Close the old Grimoire window completely, then run this script again.' -ForegroundColor Yellow
  Write-Host '[Grimoire] This script will not terminate processes automatically.' -ForegroundColor Yellow
  Pause-Grimoire
  exit 2
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host '[Grimoire] Node.js was not found in PATH.' -ForegroundColor Red
  Pause-Grimoire
  exit 1
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host '[Grimoire] npm was not found in PATH.' -ForegroundColor Red
  Pause-Grimoire
  exit 1
}

$portOwners = @()
try {
  $portOwners = @(Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
} catch {}

$projectPortOwners = @()
$foreignPortOwners = @()
foreach ($processId in $portOwners) {
  $commandLine = Get-CommandLineForProcess ([int]$processId)
  if ($commandLine -and $commandLine.IndexOf($PSScriptRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and $commandLine -match 'vite') {
    $projectPortOwners += [int]$processId
  } else {
    $foreignPortOwners += [int]$processId
  }
}

if ($foreignPortOwners.Count -gt 0) {
  Write-Host '[Grimoire] Port 5173 is used by another process.' -ForegroundColor Red
  Write-Host ('[Grimoire] Foreign PID: ' + ($foreignPortOwners -join ', ')) -ForegroundColor Red
  Write-Host '[Grimoire] Stop that process or change the development port, then run this script again.' -ForegroundColor Yellow
  Pause-Grimoire
  exit 2
}

if ($projectPortOwners.Count -gt 0) {
  Write-Host ('[Grimoire] Reusing the existing Grimoire Vite server. PID: ' + ($projectPortOwners -join ', ')) -ForegroundColor Green
} else {
  Write-Host '[Grimoire] No existing Vite server found. A new one will be started.' -ForegroundColor Cyan
}

if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules'))) {
  Write-Host '[Grimoire] Installing dependencies...' -ForegroundColor Yellow
  & npm install
  if ($LASTEXITCODE -ne 0) {
    Write-Host '[Grimoire] Dependency installation failed.' -ForegroundColor Red
    Pause-Grimoire
    exit $LASTEXITCODE
  }
}

Write-Host '[Grimoire] Building the Electron main process...' -ForegroundColor Yellow
& npm run build:main
if ($LASTEXITCODE -ne 0) {
  Write-Host '[Grimoire] Main process build failed.' -ForegroundColor Red
  Pause-Grimoire
  exit $LASTEXITCODE
}

if ($projectPortOwners.Count -gt 0) {
  Write-Host '[Grimoire] Starting Electron against the existing Vite server...' -ForegroundColor Cyan
  & npm run dev:electron
} else {
  Write-Host '[Grimoire] Starting Vite and Electron...' -ForegroundColor Cyan
  & npm run dev
}

$code = $LASTEXITCODE
if ($code -ne 0) {
  Write-Host ('[Grimoire] Development mode exited with code ' + $code) -ForegroundColor Red
  Pause-Grimoire
}
exit $code
