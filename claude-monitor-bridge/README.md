# Claude Monitor Bridge

Plugin observador para Claude Code 2.1.319+. Usa apenas `session.usage`, `agent.list`, eventos do Claude, relógio e gravação de arquivos locais. Exporta dados para `~/.claude/claude-monitor/sessions` (ou `CLAUDE_CONFIG_DIR`). Não lê credenciais, não faz chamadas HTTP e não dispara prompts ou modelos.

Os percentuais são os limites reais informados pelo Claude, não estimativas a partir dos tokens. Atualizam quando o Claude recebe esses dados da conta; não consulta a assinatura enquanto o Claude está fechado. Se os dados ainda não estiverem disponíveis, o monitor mostra “Aguardando dados do Claude”.

Depois de instalar, reabra a conversa no Claude Code ou use `/reload-plugins` uma única vez. Não é necessário executar `/usage` para alimentar o monitor. Ao fechar o Claude, os últimos percentuais continuam visíveis com aviso de desatualização.

Documentação: https://code.claude.com/docs/en/plugins/mods/reference

Instalação pelo marketplace local que acompanha o pacote: `claude plugin install local-monitor-bridge@local-monitor-tools`.
