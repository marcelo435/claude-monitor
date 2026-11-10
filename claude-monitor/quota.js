'use strict';
// Ask Claude Code's own /usage control handler. Never reads OAuth files or calls a private HTTP API.
// This control protocol is version-dependent; failures are reported and never guessed from tokens.
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
const {configDir,limitLabel}=require('./bridge');
const INTERVAL=5*60*1000;
const active=new Set();
function windowsFromUsage(data){
  const source=data?.rate_limits,windows=[];
  if(!source||typeof source!=='object')return windows;
  for(const key of ['five_hour','seven_day','seven_day_sonnet','seven_day_opus','spend_limit']){
    const w=source[key];if(w&&Number.isFinite(w.utilization)&&w.utilization>=0)
      windows.push({kind:key,percentUsed:w.utilization,resetsAt:typeof w.resets_at==='string'&&Number.isFinite(Date.parse(w.resets_at))?w.resets_at:undefined});
  }
  for(const [i,w] of (Array.isArray(source.model_scoped)?source.model_scoped:[]).entries()){
    if(w&&Number.isFinite(w.utilization)&&w.utilization>=0)windows.push({kind:'model_scoped_'+i,label:typeof w.model==='string'?'Semana · '+w.model.slice(0,60):'Limite semanal por modelo',percentUsed:w.utilization,resetsAt:typeof w.resets_at==='string'&&Number.isFinite(Date.parse(w.resets_at))?w.resets_at:undefined});
  }
  return windows;
}
async function findClaude(){
  const native=path.join(os.homedir(),'.local','bin','claude.exe');
  try{await fs.access(native);return native;}catch{}
  const extensions=path.join(os.homedir(),'.vscode','extensions');
  let dirs=[];try{dirs=await fs.readdir(extensions);}catch{}
  dirs=dirs.filter(n=>/^anthropic\.claude-code-[0-9]/.test(n)).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
  for(const d of dirs){const exe=path.join(extensions,d,'resources','native-binary','claude.exe');try{await fs.access(exe);return exe;}catch{}}
  return null;
}
function queryUsage(binary,spawnImpl=spawn){
  return new Promise((resolve,reject)=>{
    let done=false,pending='',count=0,child;
    const finish=(error,value)=>{
      if(done)return;done=true;clearTimeout(timeout);
      if(child){active.delete(child);try{child.stdin.end();}catch{}const closeTimer=setTimeout(()=>{try{child.kill();}catch{}},1000);closeTimer.unref();}
      if(error)reject(new Error(error));else resolve(value);
    };
    const timeout=setTimeout(()=>finish('O Claude não respondeu à consulta de uso.'),25000);
    try{
      child=spawnImpl(binary,['-p','--input-format','stream-json','--output-format','stream-json','--verbose','--safe-mode','--no-session-persistence','--strict-mcp-config','--mcp-config','{"mcpServers":{}}'],{cwd:os.tmpdir(),windowsHide:true,stdio:['pipe','pipe','pipe']});
      active.add(child);
      child.on('error',()=>finish('Não foi possível iniciar o CLI oficial do Claude.'));
      child.on('exit',()=>{if(!done)finish('O Claude encerrou a consulta sem informar os limites.');});
      child.stderr.on('data',()=>{}); // Do not copy application/auth diagnostics into monitor state.
      child.stdin.on('error',()=>finish('A conexão com o CLI do Claude foi encerrada.'));
      const send=(id,request)=>child.stdin.write(JSON.stringify({type:'control_request',request_id:id,request})+'\n');
      child.stdout.setEncoding('utf8');
      child.stdout.on('data',text=>{
        if(done)return;pending+=text;count+=Buffer.byteLength(text);if(count>2*1024*1024)return finish('Resposta de uso maior que o esperado.');
        let pos;
        while((pos=pending.indexOf('\n'))>=0){
          const line=pending.slice(0,pos);pending=pending.slice(pos+1);let message;
          try{message=JSON.parse(line);}catch{continue;}
          if(message.type!=='control_response')continue;
          const r=message.response;
          if(!r||!['monitor-init','monitor-usage'].includes(r.request_id))continue;
          if(r.subtype!=='success')return finish('O CLI do Claude não disponibilizou os limites agora.');
          if(r.request_id==='monitor-init')send('monitor-usage',{subtype:'get_usage',skip_behaviors:true});
          else return finish(null,r.response||{});
        }
      });
      send('monitor-init',{subtype:'initialize'});
    }catch{finish('Não foi possível iniciar a consulta de uso.');}
  });
}
function decoratePlan(plan,now=Date.now()){
  if(!plan)return null;
  return {...plan,stale:plan.status!=='ok'||now-Date.parse(plan.checkedAt)>INTERVAL+30000,
    windows:(plan.windows||[]).map(w=>({...w,label:w.label||limitLabel(w.kind),expired:!!w.resetsAt&&Date.parse(w.resetsAt)<=now}))};
}
class QuotaStore{
  constructor(root=path.join(configDir(),'claude-monitor')){this.root=root;this.file=path.join(root,'plan.json');this.plan=null;this.busy=false;this.closed=false;this.nextAttempt=0;}
  async load(){try{const p=JSON.parse(await fs.readFile(this.file,'utf8'));if(p.schema===1&&typeof p.checkedAt==='string'&&Array.isArray(p.windows)){this.plan=p;this.nextAttempt=Math.max(this.nextAttempt,Number(p.nextAttemptAt)||0);}}catch{}return decoratePlan(this.plan);}
  async refresh(){
    if(this.busy||this.closed||Date.now()<this.nextAttempt)return;
    this.busy=true;let lock;const lockPath=path.join(this.root,'plan.lock');
    try{
      await fs.mkdir(this.root,{recursive:true});
      try{lock=await fs.open(lockPath,'wx');}catch(e){
        if(e.code==='EEXIST'){try{const stat=await fs.stat(lockPath);if(Date.now()-stat.mtimeMs>60000)await fs.unlink(lockPath);}catch{}}
        return;
      }
      await this.load();if(Date.now()<this.nextAttempt)return;
      this.nextAttempt=Date.now()+INTERVAL;
      const binary=await findClaude();if(!binary)throw new Error('CLI oficial do Claude não encontrado.');
      const data=await queryUsage(binary);const windows=windowsFromUsage(data);
      this.plan={schema:1,status:windows.length?'ok':'unavailable',checkedAt:new Date().toISOString(),nextAttemptAt:this.nextAttempt,windows,
        message:windows.length?'':'O Claude ainda não disponibilizou os limites. Confira seu login e plano no Claude Code.'};
    }catch(e){
      this.nextAttempt=Date.now()+INTERVAL;
      this.plan={schema:1,status:'error',checkedAt:this.plan?.checkedAt||new Date().toISOString(),nextAttemptAt:this.nextAttempt,windows:this.plan?.windows||[],message:e.message};
    }finally{
      if(lock){try{if(this.plan){await fs.writeFile(this.file+'.tmp',JSON.stringify(this.plan),'utf8');await fs.rename(this.file+'.tmp',this.file);}}catch{}await lock.close();try{await fs.unlink(lockPath);}catch{}}
      this.busy=false;
    }
  }
  dispose(){this.closed=true;for(const c of active){try{c.kill();}catch{}}active.clear();}
}
module.exports={windowsFromUsage,queryUsage,findClaude,decoratePlan,QuotaStore};
