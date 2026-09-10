$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = Join-Path $root 'data\default-prompt-assets'
New-Item -ItemType Directory -Force -Path $target | Out-Null

$base = 'https://raw.githubusercontent.com/yukkcat/image-prompts/main/dist/sources'
$sources = @(
  'banana-prompt-quicker',
  'davidwu-gpt-image2-prompts',
  'freestylefly-gpt-image-2',
  'awesome-gpt-image',
  'awesome-gpt4o-image-prompts',
  'youmind-gpt-image-2',
  'youmind-nano-banana-pro'
)

Write-Host "Target folder: $target"
Write-Host 'Downloading built-in prompt libraries...'

$failed = @()
foreach ($source in $sources) {
  $url = "$base/$source.json"
  $destination = Join-Path $target "$source.json"
  try {
    Invoke-WebRequest -Uri $url -OutFile $destination -UseBasicParsing -TimeoutSec 30
    Write-Host "OK   $source.json"
  } catch {
    $failed += $url
    Write-Host "FAIL $url" -ForegroundColor Red
  }
}

if ($failed.Count -gt 0) {
  Write-Host ''
  Write-Host 'Automatic download failed for these URLs. Download them manually in a browser and save each file into:' -ForegroundColor Yellow
  Write-Host $target -ForegroundColor Yellow
  $failed | ForEach-Object { Write-Host $_ }
  Read-Host 'Press Enter to close'
  exit 1
}

Write-Host ''
Write-Host 'Download complete. Restart Grimoire to import the files into SQLite.' -ForegroundColor Green
Read-Host 'Press Enter to close'
