param([switch]$Silencioso)
# Remove o Claude Monitor: aplicativo, plugin do Claude, extensão do VS Code, atalhos e dados do monitor.
# Não mexe no login, nas conversas nem em outras configurações do Claude.
$ErrorActionPreference = 'Continue'
$Host.UI.RawUI.WindowTitle = 'Desinstalação do Claude Monitor'
$taskDest = Join-Path $env:LOCALAPPDATA 'Claude Monitor'
Add-Type -AssemblyName PresentationFramework

if (-not $Silencioso) {
    $r = [System.Windows.MessageBox]::Show('Remover o Claude Monitor deste computador?', 'Claude Monitor', 'YesNo', 'Question')
    if ($r -ne 'Yes') { exit 0 }
}
Set-Location $env:TEMP

Write-Host 'Fechando o Claude Monitor...'
Get-Process ClaudeMonitor -ErrorAction SilentlyContinue | ForEach-Object { $_.CloseMainWindow() | Out-Null; if (-not $_.WaitForExit(3000)) { $_.Kill() } }

Write-Host 'Removendo o plugin do Claude...'
$taskClaude = Join-Path $env:USERPROFILE '.local\bin\claude.exe'
if (-not (Test-Path -LiteralPath $taskClaude)) {
    $taskClaude = Get-ChildItem -LiteralPath (Join-Path $env:USERPROFILE '.vscode\extensions') -Directory -Filter 'anthropic.claude-code-*' -ErrorAction SilentlyContinue |
        ForEach-Object { Join-Path $_.FullName 'resources\native-binary\claude.exe' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if ($taskClaude) {
    & $taskClaude plugin uninstall 'local-monitor-bridge@local-monitor-tools' --scope user
    & $taskClaude plugin marketplace remove 'local-monitor-tools'
}

Write-Host 'Removendo a extensão do VS Code...'
$taskCode = Get-Command code.cmd -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
if (-not $taskCode) { $taskCode = @((Join-Path $env:LOCALAPPDATA 'Programs\Microsoft VS Code\bin\code.cmd'), (Join-Path $env:ProgramFiles 'Microsoft VS Code\bin\code.cmd')) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1 }
if ($taskCode) { & $taskCode --uninstall-extension local-tools.claude-monitor-local }

Write-Host 'Removendo atalhos e registro...'
foreach ($lnk in @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Claude Monitor.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'Claude Monitor.lnk'))) {
    Remove-Item -LiteralPath $lnk -Force -ErrorAction SilentlyContinue
}
Remove-Item -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ClaudeMonitor' -Recurse -Force -ErrorAction SilentlyContinue

Write-Host 'Removendo dados do monitor...'
$taskConfig = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $env:USERPROFILE '.claude' }
Remove-Item -LiteralPath (Join-Path $taskConfig 'claude-monitor') -Recurse -Force -ErrorAction SilentlyContinue

# Este script está dentro da pasta de instalação: apaga a pasta depois que ele terminar.
if (Test-Path -LiteralPath $taskDest) {
    Start-Process -FilePath cmd.exe -ArgumentList "/c timeout /t 2 /nobreak >nul & rmdir /s /q `"$taskDest`"" -WindowStyle Hidden
}

if (-not $Silencioso) { [System.Windows.MessageBox]::Show('Claude Monitor removido.', 'Claude Monitor', 'OK', 'Information') | Out-Null }
