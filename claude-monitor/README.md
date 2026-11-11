# Claude Monitor — versão 0.4

Monitor local em português para acompanhar o Claude Code dentro e fora do VS Code.

## Área de trabalho

Abra **ClaudeMonitor.exe**. É uma janela independente: você pode minimizar o VS Code e continuar acompanhando o trabalho. Marque **Fixar no topo** para mantê-la acima das outras janelas. Ao minimizar, o monitor vira um **widget flutuante** com o símbolo do Claude, os percentuais de 5 horas e da semana e o estado dos agentes. Ele continua atualizado e fica acima das outras janelas. Clique para abrir o painel completo ou arraste para posicionar. O menu do botão direito permite mostrar só o símbolo, mostrar informações, ocultar na bandeja ou fechar. A posição e o modo compacto são salvos localmente. O ícone na bandeja também usa o símbolo do Claude e mostra os percentuais na dica do mouse.

O painel foi reorganizado com limites lado a lado, tema escuro em tons quentes e abas **Visão geral** e **Atividade**. Os agentes e o contexto aparecem antes dos detalhes de tokens.

Requisitos: Windows com .NET Framework 4.8 e Node.js 22 ou superior. Os dois já estavam presentes no computador de desenvolvimento. Não precisa instalar Electron nem abrir um navegador. Ao fechar o monitor, seu coletor de arquivos também é encerrado.

## Limites reais do plano e estados reais dos agentes

Esta versão inclui o plugin **Local Monitor Bridge** para Claude Code 2.1.319 ou superior. Ele usa a API de mods do próprio Claude, `session.usage()` e `agent.list()`, para exportar:

- Percentuais utilizados dos limites de 5 horas e da semana, com horários de renovação.
- Outras janelas de limite que o Claude informar.
- Contexto ocupado e tamanho da janela do modelo.
- Estado real de cada agente: na fila, trabalhando, aguardando, ocioso, concluído, erro ou interrompido.
- Nome da ferramenta, caminho do arquivo e resultado de execução, sem copiar comandos ou respostas.

Os números do plano são os que o Claude informa; não são estimados por tokens. **Não precisa executar `/usage`**. O monitor solicita ao CLI oficial uma consulta automática a cada 5 minutos, inclusive com o VS Code fechado. A primeira consulta pode levar alguns segundos; dado ausente nunca vira 0%. Nenhuma mensagem é enviada ao modelo. O protocolo de controle foi validado com o Claude Code 2.1.319 e pode exigir atualização se o Claude mudar esse formato.

O plugin precisa estar carregado na conversa. Depois da primeira instalação ou atualização, reabra a conversa do Claude ou execute `/reload-plugins` uma única vez. Se o plugin não estiver instalado, a extensão mostra um aviso com o botão **Instalar plugin** (também disponível no painel e no comando **Claude Monitor: Instalar plugin do Claude**). O instalador não envia mensagens ao modelo e não inicia tarefas ou subagentes.

O uso do plano continua sendo consultado com o VS Code fechado. Se a consulta falhar, o monitor identifica os últimos dados como antigos. Uma janela cujo horário de renovação já passou aparece como “Aguardando nova leitura”. Novas ações e estados reais dos agentes exigem uma sessão do Claude ativa com o plugin carregado; estados antigos nunca são apresentados como execução atual.

## Instalar o conjunto

No pacote **Claude-Monitor-0.4.0**, dê dois cliques em `Instalar.cmd`. Uma janela mostra cada passo: o instalador copia o aplicativo e o plugin para `%LOCALAPPDATA%\Claude Monitor`, registra o plugin pelo CLI oficial do Claude, instala a extensão `.vsix` no VS Code (encontra o VS Code mesmo fora do PATH) e cria atalhos na área de trabalho e no Menu Iniciar. Ao final, oferece abrir o monitor. Não altera configurações de segurança e não configura inicialização automática do Windows. O registro fica em `instalacao.log`, na pasta de instalação.

A pasta extraída pode ser apagada depois da instalação. Para atualizar, extraia a versão nova e execute `Instalar.cmd` de novo. Para remover, use **Configurações → Aplicativos → Aplicativos instalados → Claude Monitor**: o desinstalador remove o aplicativo, o plugin, a extensão, os atalhos e os dados em `~/.claude/claude-monitor`, sem tocar no login nem nas conversas.

Para instalar só a extensão: no VS Code abra Extensões → `…` → **Instalar do VSIX**, selecione `claude-monitor-local-0.4.0.vsix` e clique em **Instalar plugin** no aviso que aparecer.

## VS Code

Clique no ícone de monitor na barra lateral. Também pode usar `Ctrl+Shift+P` → **Claude Monitor: Abrir painel**. A barra inferior mostra os limites disponíveis. O botão de seta externa abre a janela de desktop, e o botão de seleção alterna conversas.

O painel do VS Code lista por padrão as conversas das pastas abertas. Desative **Claude Monitor: Workspace Only** para outros projetos. A janela de desktop lista todos os projetos locais, até 30 conversas recentes e 30 transcripts de subagentes por conversa. Arquivos grandes carregam em blocos; as contagens parciais são identificadas.

## Tokens e privacidade

Tokens de entrada, saída, cache lido e cache criado continuam separados. A contagem processada inclui contexto reenviado em cada requisição; não equivale ao percentual do plano nem a palavras únicas. Mensagens repetidas de streaming são consolidadas.

O monitor lê arquivos locais para tokens e atividade. Para os limites do plano, inicia o CLI oficial do Claude em segundo plano, em modo seguro e sem enviar prompts; o próprio CLI usa seu login e consulta os servidores do Claude. O monitor não lê arquivos de credenciais OAuth e não consulta endpoints HTTP privados. A cache compartilhada evita repetir consultas entre a extensão e a janela. O plugin somente observa eventos e exporta metadados para `~/.claude/claude-monitor/sessions` (ou `CLAUDE_CONFIG_DIR`). Não aprova ferramentas, não muda prompts, não altera permissões, não chama modelos e não cria agentes.

Os caminhos de arquivos, nomes dos projetos e descrições de tarefas podem aparecer no painel. O conteúdo dos prompts, do raciocínio, dos comandos e dos resultados das ferramentas não é exportado. O coletor também lê transcripts locais para contar tokens; esses transcripts são um formato de implementação e podem mudar com atualizações do Claude.

Em WSL/SSH, os dados precisam estar disponíveis no ambiente do monitor. A janela de desktop incluída é para Windows e procura os registros do Claude nesse ambiente. A extensão não executa em workspaces não confiáveis. Não há suporte a sessões exclusivamente na nuvem sem exportação local.

## Código e validação

Código aberto no pacote de fontes. Testes: `node --test test/*.test.js`. A compilação Windows usa o compilador C# do .NET Framework e as bibliotecas WPF do sistema, sem dependências baixadas. O plugin passa pela validação estrita do CLI do Claude. Testes com dados fictícios são identificados como demonstração e não representam o uso da sua conta.

Referências: [API de mods do Claude](https://code.claude.com/docs/en/plugins/mods/reference), [Claude no VS Code](https://code.claude.com/docs/en/vs-code), [Tree View do VS Code](https://code.visualstudio.com/api/extension-guides/tree-view).

O símbolo do Claude foi reutilizado dos recursos da extensão oficial instalada. Este monitor é um aplicativo independente.
