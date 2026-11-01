# Kills Electron processes that belong to this repo's audit/journey runs. They are identified by
# `--remote-debugging-port` (only our harness passes it) plus a path containing 'grimoire', so a normal
# dev instance or another project's Electron is left alone.
$procs = Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*remote-debugging-port*' -and $_.CommandLine -like '*grimoire*' }
Write-Output ('matched: ' + ($procs | Measure-Object).Count)
$procs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
Write-Output ('remaining electron: ' + ((Get-Process electron -ErrorAction SilentlyContinue) | Measure-Object).Count)