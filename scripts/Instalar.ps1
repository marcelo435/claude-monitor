$ErrorActionPreference = 'Stop'
# Instalador do Claude Monitor.
# Copia o aplicativo e o plugin para %LOCALAPPDATA%\Claude Monitor (a pasta extraída pode ser apagada depois),
# registra o plugin pelo CLI oficial do Claude, instala a extensão do VS Code e cria os atalhos.
$Host.UI.RawUI.WindowTitle = 'Instalação do Claude Monitor'
$taskBundle = $PSScriptRoot
$taskVersion = '0.4.0' # atualizado por scripts/package.py
$taskVsix = Join-Path $taskBundle "claude-monitor-local-$taskVersion.vsix"
$taskDest = Join-Path $env:LOCALAPPDATA 'Claude Monitor'
$taskLog = Join-Path $env:TEMP 'claude-monitor-instalacao.log'
$taskAvisos = New-Object System.Collections.Generic.List[string]
Add-Type -AssemblyName PresentationFramework

function Passo($n, $texto) { Write-Host ''; Write-Host "[$n/6] $texto" -ForegroundColor Cyan }
function Ok($texto) { Write-Host "      $texto" -ForegroundColor Green }
function Aviso($texto) { Write-Host "      $texto" -ForegroundColor Yellow; $taskAvisos.Add($texto) }

function Find-Claude {
    $nativo = Join-Path $env:USERPROFILE '.local\bin\claude.exe'
    if (Test-Path -LiteralPath $nativo) { return $nativo }
    $pasta = Join-Path $env:USERPROFILE '.vscode\extensions'
    if (-not (Test-Path -LiteralPath $pasta)) { return $null }
    $exts = Get-ChildItem -LiteralPath $pasta -Directory -Filter 'anthropic.claude-code-*' |
        Sort-Object { try { [version](($_.Name -replace '^anthropic\.claude-code-', '') -replace '-.*$', '') } catch { [version]'0.0' } } -Descending
    foreach ($e in $exts) {
        $exe = Join-Path $e.FullName 'resources\native-binary\claude.exe'
        if (Test-Path -LiteralPath $exe) { return $exe }
    }
    return $null
}

function Find-Code {
    $cmd = Get-Command code.cmd -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($p in @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Microsoft VS Code\bin\code.cmd'),
        (Join-Path $env:ProgramFiles 'Microsoft VS Code\bin\code.cmd'))) {
        if (Test-Path -LiteralPath $p) { return $p }
    }
    return $null
}

function Find-Node {
    $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $p = Join-Path $env:ProgramFiles 'nodejs\node.exe'
    if (Test-Path -LiteralPath $p) { return $p }
    return $null
}

function New-Atalho($arquivo, $alvo, $pasta) {
    $shell = New-Object -ComObject WScript.Shell
    $s = $shell.CreateShortcut($arquivo)
    $s.TargetPath = $alvo
    $s.WorkingDirectory = $pasta
    $s.IconLocation = (Join-Path $pasta 'claude.ico')
    $s.Description = 'Limites do plano, tokens e agentes do Claude'
    $s.Save()
}

try {
    Start-Transcript -LiteralPath $taskLog -Force | Out-Null
    Write-Host "Claude Monitor $taskVersion - instalação"

    Passo 1 'Conferindo o computador'
    $taskClaude = Find-Claude
    if (-not $taskClaude) { throw 'Não encontrei o Claude Code. Instale a extensão oficial Claude Code no VS Code, faça login e rode o instalador de novo.' }
    Ok 'Claude Code encontrado'
    $taskCode = Find-Code
    if ($taskCode) { Ok 'VS Code encontrado' } else { Aviso 'VS Code não encontrado: a extensão não foi instalada (a janela de desktop funciona mesmo assim).' }
    if (Find-Node) { Ok 'Node.js encontrado' } else { Aviso 'Node.js não encontrado: a janela de desktop precisa do Node.js 22 ou superior (nodejs.org).' }

    Passo 2 "Copiando arquivos para $taskDest"
    # Fecha uma versão anterior aberta, para poder substituir os arquivos.
    Get-Process ClaudeMonitor -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $_.Path.StartsWith($taskDest, [StringComparison]::OrdinalIgnoreCase) } |
        ForEach-Object { $_.CloseMainWindow() | Out-Null; if (-not $_.WaitForExit(3000)) { $_.Kill() } }
    New-Item -ItemType Directory -Force -Path $taskDest | Out-Null
    foreach ($pasta in 'app', 'marketplace') {
        $destino = Join-Path $taskDest $pasta
        if (Test-Path -LiteralPath $destino) { Remove-Item -LiteralPath $destino -Recurse -Force }
        Copy-Item -LiteralPath (Join-Path $taskBundle $pasta) -Destination $destino -Recurse -Force
    }
    Copy-Item -LiteralPath (Join-Path $taskBundle 'Desinstalar.ps1') -Destination $taskDest -Force
    Ok 'Arquivos copiados'

    Passo 3 'Instalando o plugin no Claude'
    # "add" com o mesmo nome só aponta o marketplace para a pasta nova; pode repetir sem erro.
    & $taskClaude plugin marketplace add (Join-Path $taskDest 'marketplace')
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível registrar o plugin no Claude.' }
    & $taskClaude plugin install 'local-monitor-bridge@local-monitor-tools' --scope user
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível instalar o plugin no Claude.' }
    Ok 'Plugin instalado'

    Passo 4 'Instalando a extensão do VS Code'
    if ($taskCode) {
        & $taskCode --install-extension $taskVsix --force
        if ($LASTEXITCODE -eq 0) { Ok 'Extensão instalada' } else { Aviso 'Não foi possível instalar a extensão. No VS Code, use Extensões > ... > Instalar do VSIX.' }
    } else { Write-Host '      Pulado (VS Code não encontrado)' }

    Passo 5 'Criando atalhos'
    $taskApp = Join-Path $taskDest 'app'
    $taskExe = Join-Path $taskApp 'ClaudeMonitor.exe'
    New-Atalho (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Claude Monitor.lnk') $taskExe $taskApp
    New-Atalho (Join-Path ([Environment]::GetFolderPath('Programs')) 'Claude Monitor.lnk') $taskExe $taskApp
    Ok 'Atalhos na área de trabalho e no Menu Iniciar'

    Passo 6 'Registrando em Aplicativos instalados'
    $taskKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ClaudeMonitor'
    New-Item -Path $taskKey -Force | Out-Null
    $taskUninstall = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $taskDest 'Desinstalar.ps1')`""
    $props = [ordered]@{
        DisplayName = 'Claude Monitor'; DisplayVersion = $taskVersion; Publisher = 'Local Tools'
        DisplayIcon = (Join-Path $taskApp 'claude.ico'); InstallLocation = $taskDest
        UninstallString = $taskUninstall; QuietUninstallString = "$taskUninstall -Silencioso"
    }
    foreach ($k in $props.Keys) { New-ItemProperty -Path $taskKey -Name $k -Value $props[$k] -PropertyType String -Force | Out-Null }
    foreach ($k in 'NoModify', 'NoRepair') { New-ItemProperty -Path $taskKey -Name $k -Value 1 -PropertyType DWord -Force | Out-Null }
    Ok 'Para remover: Configurações > Aplicativos > Aplicativos instalados > Claude Monitor'

    Stop-Transcript | Out-Null
    Copy-Item -LiteralPath $taskLog -Destination (Join-Path $taskDest 'instalacao.log') -Force

    $msg = "Instalação concluída!`n`nA pasta extraída já pode ser apagada.`n`nNa conversa do Claude, execute /reload-plugins (ou reabra a conversa) uma vez para ativar o plugin."
    if ($taskAvisos.Count) { $msg += "`n`nAtenção:`n- " + ($taskAvisos -join "`n- ") }
    $msg += "`n`nAbrir o Claude Monitor agora?"
    if ([System.Windows.MessageBox]::Show($msg, 'Claude Monitor', 'YesNo', 'Information') -eq 'Yes') {
        Start-Process -FilePath $taskExe -WorkingDirectory $taskApp
    }
} catch {
    try { Stop-Transcript | Out-Null } catch {}
    Write-Host ''
    Write-Host "ERRO: $($_.Exception.Message)" -ForegroundColor Red
    [System.Windows.MessageBox]::Show("$($_.Exception.Message)`n`nDetalhes em: $taskLog", 'Instalação do Claude Monitor', 'OK', 'Error') | Out-Null
    exit 1
}
