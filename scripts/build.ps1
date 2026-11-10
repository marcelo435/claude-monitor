$ErrorActionPreference='Stop'
$taskRepo=Split-Path -Parent $PSScriptRoot
$taskBuild=Join-Path $taskRepo 'build'
New-Item -ItemType Directory -Force -Path $taskBuild | Out-Null
& (Join-Path $taskRepo 'claude-monitor\build.ps1') -OutputPath (Join-Path $taskBuild 'ClaudeMonitor.exe')
if($LASTEXITCODE -ne 0){throw 'A compilação do desktop falhou.'}
Write-Host 'Compilação concluída em build/ClaudeMonitor.exe'
