'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {clean} = require('./core');
const configDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(),'.claude');
const bridgeDir = () => path.join(configDir(),'claude-monitor','sessions');
const validNumber = n => Number.isFinite(n) && n >= 0;
const time = s => typeof s === 'string' && Number.isFinite(Date.parse(s)) ? s : undefined;
const STATUSES = new Set(['pending','running','waiting','idle','completed','failed','killed']);
const labels = {pending:'Na fila',running:'Trabalhando',waiting:'Aguardando',idle:'Ocioso',completed:'Concluído',failed:'Erro',killed:'Interrompido',unknown:'Desconhecido'};
const limitLabel = kind => ({five_hour:'Últimas 5 horas',seven_day:'Semana',seven_day_sonnet:'Semana · Sonnet',seven_day_opus:'Semana · Opus',spend_limit:'Limite de gasto'})[kind] || clean(kind,60);
function validate(raw) {
  if(raw?.schema!==1 || typeof raw.sessionId!=='string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(raw.sessionId) || !time(raw.publishedAt)) return null;
  if(Date.parse(raw.publishedAt)>Date.now()+300000) return null;
  const context={};
  for(const key of ['tokens','window','percent'])if(validNumber(raw.context?.[key]))context[key]=raw.context[key];
  return {schema:1,sessionId:raw.sessionId,cwd:clean(raw.cwd,1000),model:clean(raw.model),publishedAt:raw.publishedAt,
    limitsChangedAt:time(raw.limitsChangedAt),ended:raw.ended===true,phase:['working','idle','ended'].includes(raw.phase)?raw.phase:'unknown',context,
    rateLimits:(Array.isArray(raw.rateLimits)?raw.rateLimits:[]).slice(0,20)
      .filter(w=>typeof w?.kind==='string'&&validNumber(w.percentUsed)).map(w=>({kind:clean(w.kind,64),percentUsed:w.percentUsed,resetsAt:time(w.resetsAt)})),
    agents:(Array.isArray(raw.agents)?raw.agents:[]).slice(0,100).filter(a=>typeof a?.id==='string').map(a=>({id:clean(a.id,128),name:clean(a.name),type:clean(a.type),status:STATUSES.has(a.status)?a.status:'unknown',parentId:clean(a.parentId,128)})),
    activity:(Array.isArray(raw.activity)?raw.activity:[]).slice(0,40).filter(a=>typeof a?.name==='string').map(a=>({id:clean(a.id,128),agentId:clean(a.agentId,128),name:clean(a.name,80),detail:clean(a.detail),time:time(a.time),status:STATUSES.has(a.status)?a.status:'unknown'}))};
}
function decorate(snapshot,now=Date.now()) {
  if(!snapshot)return null;
  const online=!snapshot.ended && now-Date.parse(snapshot.publishedAt)<15000;
  return {...snapshot,online,rateLimits:snapshot.rateLimits.map(w=>({...w,label:limitLabel(w.kind),expired:!!w.resetsAt&&Date.parse(w.resetsAt)<=now})),
    agents:snapshot.agents.map(a=>({...a,statusLabel:labels[a.status] || labels.unknown})),
    activity:snapshot.activity.map(a=>({...a,statusLabel:labels[a.status] || labels.unknown}))};
}
class BridgeStore {
  constructor(){this.sessions=new Map();this.error='';}
  async scan(root=bridgeDir()) {
    let entries;try{entries=await fs.readdir(root,{withFileTypes:true});}catch(e){if(e.code!=='ENOENT')this.error='Não foi possível ler a conexão do Claude.';else this.error='';return;}
    this.error='';const seen=new Set();
    for(const e of entries.filter(e=>e.isFile()&&!e.isSymbolicLink()&&e.name.endsWith('.json')).slice(0,300)){
      try {
        const f=path.join(root,e.name),stat=await fs.stat(f);if(stat.size>512*1024)continue;
        const raw=validate(JSON.parse(await fs.readFile(f,'utf8')));if(!raw)continue;
        // A per-session filename prevents sessions from overwriting each other.
        if(e.name!==`${raw.sessionId}.json`)continue;
        this.sessions.set(raw.sessionId,raw);seen.add(raw.sessionId);
      } catch { // $.fs.write is non-atomic: retain the last complete read for one poll.
        const id=e.name.slice(0,-5);if(this.sessions.has(id))seen.add(id);
      }
    }
    for(const id of this.sessions.keys())if(!seen.has(id))this.sessions.delete(id);
  }
  get(id){return decorate(this.sessions.get(id));}
}
module.exports={BridgeStore,bridgeDir,configDir,validate,decorate,labels,limitLabel};
