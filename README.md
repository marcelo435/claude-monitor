# Claude Monitor

Extensão para VS Code e widget de área de trabalho para acompanhar o uso do Claude Code. Interface em português, limites do plano, tokens e atividade dos agentes.

## Instalar em outro VS Code

**Versão atual: Windows.** É necessário ter VS Code, a extensão oficial Claude Code com login ativo e Node.js 22 ou superior. O aplicativo de desktop usa o .NET Framework 4.8 do Windows.

1. Baixe [a extensão `.vsix`](downloads/claude-monitor-local-0.3.0.vsix?raw=true).
2. No outro VS Code, abra **Extensões → ⋯ → Instalar do VSIX** e escolha o arquivo.
3. Para usar também o widget e os estados dos agentes, baixe o [pacote completo para Windows](downloads/Claude-Monitor-0.3.0.zip?raw=true), extraia e execute **Instalar.cmd**.
4. Reabra o VS Code e a conversa do Claude uma vez para carregar a atualização e o plugin.

Mantenha a pasta extraída: o atalho aponta para o aplicativo dentro dela. Cada computador usa seu próprio login do Claude. A extensão não é publicada no Visual Studio Marketplace; a instalação é pelo arquivo `.vsix`.

## Recursos

- Uso real dos limites de 5 horas e da semana, com horários de renovação.
- Consulta automática pelo CLI oficial do Claude, sem enviar prompts ao modelo.
- Tokens de entrada, saída e cache, separados do percentual do plano.
- Agentes e ferramentas em tempo real com o plugin Local Monitor Bridge.
- Painel com abas Visão geral e Atividade.
- Ao minimizar, widget flutuante com o símbolo do Claude, percentuais e status dos agentes.
- Clique para restaurar, arraste para mover e use o botão direito para mostrar só o símbolo.

Os limites atualizam aproximadamente a cada 5 minutos. A atividade local atualiza a cada poucos segundos. Quando os dados estão antigos ou ausentes, a interface identifica isso. Os estados dos agentes exigem uma conversa ativa com o plugin carregado.

## Desenvolver e compilar

Sem dependências npm externas. Na raiz do repositório:

```powershell
npm test
.\scripts\build.ps1
python .\scripts\package.py
```

Para empacotar, também é necessário Python 3.10 ou superior. A compilação usa o compilador C# e o WPF do .NET Framework do Windows. Os arquivos `.vsix`, `.zip` e checksums saem em `dist/`. O fluxo do GitHub Actions executa os testes e gera os pacotes em Windows.

O código da extensão e do desktop fica em `claude-monitor/`. O plugin observador fica em `claude-monitor-bridge/`. [Instruções de instalação e funcionamento](claude-monitor/README.md).

## Dados e compatibilidade

O monitor lê registros locais e solicita ao CLI oficial a consulta autenticada dos limites. Não lê arquivos de credenciais, não envia mensagens ao modelo e não cria agentes. O plugin somente observa eventos e exporta metadados locais. Registros pessoais, caches e credenciais não estão neste repositório.

O protocolo de uso foi validado com Claude Code 2.1.319 e pode mudar em atualizações futuras. A versão completa de desktop é para Windows; não há suporte completo a macOS, Linux ou a sessões exclusivamente na nuvem.

Código sob licença MIT. A marca e o símbolo do Claude pertencem à Anthropic; este projeto é independente. Veja [NOTICE](NOTICE).
