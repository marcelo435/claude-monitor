'use strict';
const vscode = require('vscode');
const path = require('node:path');
const os = require('node:os');
const { Monitor, clean } = require('./core');
const { BridgeStore, configDir } = require('./bridge');
const { spawn } = require('node:child_process');
const { QuotaStore, decoratePlan } = require('./quota');
const format = n => new Intl.NumberFormat('pt-BR').format(n);
const total = t => t.input + t.output + t.cacheRead + t.cacheWrite;

function activate(context) {
  const monitor = new Monitor();
  const bridge = new BridgeStore();
  const quota = new QuotaStore();
  const changed = new vscode.EventEmitter();
  let selected = '', busy = false, stopped = false, lastScan = 0;
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 40);
  status.command = 'claudeMonitor.open'; status.name = 'Claude Monitor';
  const row = (label, description = '', children, tip = '') => ({ label, description, children, tip });
  const chosen = () => monitor.sessions.find(s => s.main.file === selected) || monitor.sessions[0];
  const tools = t => [...t.tools.values()].sort((a,b) => b.time-a.time);
  function usage(t) {
    const u = t.totals();
    return [row('Entrada sem cache', format(u.input)), row('Saída', format(u.output)),
      row('Cache lido', format(u.cacheRead)), row('Cache criado', format(u.cacheWrite)),
      row('Total de tokens processados', format(total(u)), undefined, 'Soma das requisições registradas; inclui releituras do contexto e cache. Não é o percentual do plano.'),
      row('Contexto de entrada na última resposta', t.lastUsage ? format(t.lastUsage.input+t.lastUsage.cacheRead+t.lastUsage.cacheWrite) : 'Sem dados', undefined,
        'Entrada + cache na última resposta registrada. Não inclui saída, não é consumo acumulado e não presume o tamanho máximo da janela.')];
  }
  function activity(t) {
    return tools(t).slice(0,25).map(a => row(a.name, `${a.error ? 'Erro' : a.done ? 'Concluída' : 'Sem resultado registrado'}${a.detail ? ' · '+a.detail : ''}`, undefined,
      `${a.time ? new Date(a.time).toLocaleString('pt-BR') : ''}\n${a.detail}\nA ausência de resultado não confirma que a ferramenta continua em execução.`));
  }
  function roots() {
    const session = chosen();
    const id=session?.main.sessionId || (session ? path.basename(session.main.file,'.jsonl') : '');
    const live=bridge.get(id);
    const out = [row('Fonte', live ? 'Plugin do Claude + registros locais' : 'Registros locais + consulta oficial do plano')];
    const plan=decoratePlan(quota.plan);
    if(plan?.windows.length)out.push(row('Plano · consulta automática pelo Claude',plan.stale?'Últimos dados':'Atualiza a cada 5 minutos',plan.windows.map(w=>row(w.label,w.expired?'Aguardando nova leitura':`${w.percentUsed.toLocaleString('pt-BR')}% usado`,undefined,
      `Renova: ${w.resetsAt?new Date(w.resetsAt).toLocaleString('pt-BR'):'não informado'}\nConsultado: ${new Date(plan.checkedAt).toLocaleString('pt-BR')}`))));
    if(plan?.message)out.push(row('Consulta do plano',plan.message));
    if(live){
      out.push(row('Conexão com Claude',live.online?'Conectado':live.ended?'Sessão encerrada · últimos dados':'Sem sinal recente · últimos dados'));
      if(!plan?.windows.length)out.push(row('Limites do plano',live.rateLimits.length?'Informados pelo Claude':'Aguardando primeira leitura do Claude',live.rateLimits.map(w=>row(w.label,w.expired?'Janela encerrada · aguardando nova leitura':`${w.percentUsed.toLocaleString('pt-BR')}% usado`,undefined,
        `${w.resetsAt?'Renova: '+new Date(w.resetsAt).toLocaleString('pt-BR'): 'Renovação não informada'}\nExportado pelo Claude: ${new Date(live.publishedAt).toLocaleString('pt-BR')}\nNão é uma estimativa por tokens.`))));
      if(live.context.percent!==undefined)out.push(row('Janela de contexto',`${live.context.percent}% · ${format(live.context.tokens||0)} / ${format(live.context.window||0)}`));
      out.push(row('Agentes · estado informado pelo Claude',String(live.agents.length),live.agents.map(a=>row(a.name||a.type||a.id,`${a.statusLabel}${live.online?'':' · último estado conhecido'}`,undefined,a.id))));
    }else out.push(row('Agentes em tempo real','Aguardando conexão do plugin Local Monitor Bridge',undefined,
      'Instale o plugin que acompanha a versão 0.2 e reabra a conversa do Claude. Os percentuais chegam automaticamente, sem executar /usage.'));
    if (monitor.error) out.push(row('Aviso',monitor.error));
    if (!session) return [...out, row('Nenhuma conversa encontrada', 'Envie uma mensagem ao Claude neste projeto'),
      row('Outros projetos', 'Desative Workspace Only nas configurações para listar os demais projetos'),
      row('WSL / SSH', 'Instale no ambiente em que o Claude está executando')];
    const t = session.main;
    const pending = tools(t).filter(a => !a.done).length;
    out.push(row('Conversa',path.basename(t.file,'.jsonl').slice(0,12),undefined,t.cwd+'\n'+t.sessionId));
    out.push(row('Modelo',t.model || 'Ainda não registrado'));
    out.push(row('Última atividade',t.lastTime ? new Date(t.lastTime).toLocaleTimeString('pt-BR') : 'Sem horário',undefined,
      'O painel mostra ações registradas, não o raciocínio interno do modelo.'));
    if (t.partial) out.push(row('Carregando histórico', 'Contagens parciais; aguarde as próximas atualizações'));
    out.push(row('Tokens · agente principal','',usage(t)));
    const sums = session.agents.reduce((s,a)=>s+total(a.totals()),total(t.totals()));
    out.push(row('Principal + subagentes carregados',format(sums),undefined,
      'Tokens processados. Pode ser parcial durante carregamento; até 30 transcripts de subagentes nesta versão.'));
    out.push(row('Ferramentas sem resultado',String(pending),undefined,'Pode incluir chamadas interrompidas ou antigas; não é uma contagem de agentes ativos.'));
    const agentCalls = tools(t).filter(a => ['Agent','Task'].includes(a.name));
    out.push(row('Delegações registradas',String(agentCalls.length),agentCalls.map(a=>row(a.detail || 'Subagente',a.done ? (a.error ? 'Erro' : 'Retornou resultado') : 'Sem resultado registrado'))));
    out.push(row('Transcripts de subagentes',String(session.agents.length),session.agents.map(a=> {
      const recent = Date.now()-a.lastTime < 30000;
      return row(path.basename(a.file,'.jsonl'),`${recent ? 'Atividade recente' : 'Sem atividade recente'} · ${a.model || 'modelo não registrado'}`,
        [...usage(a),row('Atividade','',activity(a)),...(a.partial ? [row('Histórico parcial','Carregando')] : [])],
        'Estado inferido pelo horário do último registro; não confirma execução ou conclusão.');
    })));
    if (session.moreAgents) out.push(row('Outros transcripts',`${session.moreAgents} fora do limite desta versão`));
    out.push(row('Atividade recente','',activity(t)));
    return out;
  }
  const provider = {
    onDidChangeTreeData: changed.event,
    getChildren: item => item ? item.children || [] : roots(),
    getTreeItem: item => {
      const t = new vscode.TreeItem(clean(item.label,250), item.children?.length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
      t.description = clean(item.description,300); t.tooltip = item.tip || `${t.label}: ${t.description}`; return t;
    }
  };
  const view = vscode.window.createTreeView('claudeMonitor.overview',{ treeDataProvider:provider });
  async function refresh(force=false) {
    if (busy || stopped || !vscode.workspace.isTrusted) return;
    const cfg=vscode.workspace.getConfiguration('claudeMonitor');
    if (!force && Date.now()-lastScan < Math.max(2,cfg.get('refreshSeconds',3))*1000) return;
    busy=true; lastScan=Date.now();
    try {
      const root=cfg.get('projectsPath','') || path.join(configDir(),'projects');
      await Promise.all([monitor.scan(root,(vscode.workspace.workspaceFolders || []).map(f=>f.uri.fsPath),cfg.get('workspaceOnly',true)),bridge.scan(),quota.load()]);
      void quota.refresh();
      if (stopped) return;
      changed.fire();
      const session=chosen();
      const live=bridge.get(session?.main.sessionId || (session?path.basename(session.main.file,'.jsonl'):''));
      const plan=decoratePlan(quota.plan);
      const limits=(plan?.windows?.length?plan.windows:live?.rateLimits||[]).filter(w=>!w.expired&&['five_hour','seven_day'].includes(w.kind)).map(w=>`${w.kind==='five_hour'?'5h':'7d'} ${w.percentUsed}%`).join(' · ');
      status.text=limits?`$(pulse) Claude: ${limits}${plan?.windows?.length?!plan.stale?'':' (últimos dados)':live?.online?'':' (últimos dados)'}`:session ? `$(pulse) Claude: ${format(total(session.main.totals()))} tok` : '$(pulse) Claude Monitor';
      status.tooltip='Tokens processados pelo agente principal nesta conversa. Clique para ver detalhes e subagentes.';
      status.show();
      view.description=`${monitor.sessions.length} conversa(s) · ${new Date().toLocaleTimeString('pt-BR')}`;
    } catch (error) {
      monitor.error=`Falha ao atualizar (${error.code || 'erro de leitura'}).`; changed.fire();
      status.text='$(warning) Claude Monitor'; status.tooltip=monitor.error; status.show();
    } finally {busy=false;}
  }
  context.subscriptions.push(changed,status,view,
    vscode.commands.registerCommand('claudeMonitor.desktop',()=>{
      if(process.platform!=='win32')return vscode.window.showInformationMessage('A janela de desktop desta versão é para Windows.');
      const exe=path.join(context.extensionPath,'ClaudeMonitor.exe');
      const child=spawn(exe,[],{cwd:context.extensionPath,detached:true,windowsHide:true,stdio:'ignore'});
      child.on('error',()=>vscode.window.showErrorMessage('Não foi possível abrir a janela. Extraia o pacote Desktop e execute ClaudeMonitor.exe.'));
      child.unref();
    }),
    vscode.commands.registerCommand('claudeMonitor.open',()=>vscode.commands.executeCommand('claudeMonitor.overview.focus')),
    vscode.commands.registerCommand('claudeMonitor.refresh',()=>refresh(true)),
    vscode.commands.registerCommand('claudeMonitor.selectSession',async()=>{
      const items=monitor.sessions.map(s=>({label:`${s.main.model || 'Claude'} · ${path.basename(s.main.file,'.jsonl').slice(0,12)}`,description:s.main.cwd,detail:s.main.lastTime ? new Date(s.main.lastTime).toLocaleString('pt-BR') : '',file:s.main.file}));
      const item=await vscode.window.showQuickPick(items,{placeHolder:'Escolha a conversa que deseja acompanhar'});
      if(item){selected=item.file; await refresh(true);}
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(()=>refresh(true)),
    vscode.workspace.onDidChangeConfiguration(e=>{if(e.affectsConfiguration('claudeMonitor'))refresh(true);})
  );
  const timer=setInterval(()=>{void refresh();},1000);
  context.subscriptions.push({dispose(){stopped=true;clearInterval(timer);quota.dispose();}});
  void refresh(true);
}
module.exports={activate};
