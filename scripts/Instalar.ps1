$ErrorActionPreference = 'Stop'
$taskBundle = $PSScriptRoot
$taskLog = Join-Path $taskBundle 'instalacao.log'
try {
    Start-Transcript -LiteralPath $taskLog -Force | Out-Null
    $taskClaude = Join-Path $env:USERPROFILE '.local\bin\claude.exe'
    if (-not (Test-Path -LiteralPath $taskClaude)) {
        $taskExt = Get-ChildItem -LiteralPath (Join-Path $env:USERPROFILE '.vscode\extensions') -Directory -Filter 'anthropic.claude-code-*' |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if (-not $taskExt) { throw 'Instale primeiro a extensão oficial Claude Code no VS Code.' }
        $taskClaude = Join-Path $taskExt.FullName 'resources\native-binary\claude.exe'
    }
    $taskMarketplace = Join-Path $taskBundle 'marketplace'
    $taskConfig = if($env:CLAUDE_CONFIG_DIR){$env:CLAUDE_CONFIG_DIR}else{Join-Path $env:USERPROFILE '.claude'}
    $taskKnownFile = Join-Path $taskConfig 'plugins\known_marketplaces.json'
    $taskRegistered = $false
    if(Test-Path -LiteralPath $taskKnownFile){
        try { $taskKnown = Get-Content -LiteralPath $taskKnownFile -Raw | ConvertFrom-Json; $taskRegistered = $taskKnown.PSObject.Properties.Name -contains 'local-monitor-tools' } catch {}
    }
    if(-not $taskRegistered){
        & $taskClaude plugin marketplace add $taskMarketplace
        if ($LASTEXITCODE -ne 0) { throw 'Não foi possível registrar o marketplace local do monitor. Confira instalacao.log.' }
    }
    & $taskClaude plugin install 'local-monitor-bridge@local-monitor-tools' --scope user
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível instalar o plugin de observação. Confira instalacao.log.' }
    $taskCode = Get-Command code.cmd -ErrorAction SilentlyContinue
    if (-not $taskCode) { throw 'O comando code.cmd do VS Code não foi encontrado.' }
    & $taskCode.Source --install-extension (Join-Path $taskBundle 'claude-monitor-local-0.3.0.vsix') --force
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível atualizar a extensão do VS Code. Confira instalacao.log.' }
    $taskDesktop = [Environment]::GetFolderPath('Desktop')
    $taskShell = New-Object -ComObject WScript.Shell
    $taskShortcut = $taskShell.CreateShortcut((Join-Path $taskDesktop 'Claude Monitor.lnk'))
    $taskShortcut.TargetPath = Join-Path $taskBundle 'app\ClaudeMonitor.exe'
    $taskShortcut.WorkingDirectory = Join-Path $taskBundle 'app'
    $taskShortcut.Description = 'Limites do plano, tokens e agentes do Claude'
    $taskShortcut.Save()
    Stop-Transcript | Out-Null
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show("Instalação concluída. Abra o atalho Claude Monitor na área de trabalho. Reabra a conversa do Claude uma vez para carregar o plugin.", 'Claude Monitor') | Out-Null
} catch {
    try { Stop-Transcript | Out-Null } catch {}
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($_.Exception.Message, 'Instalação do Claude Monitor', 'OK', 'Error') | Out-Null
    exit 1
}
