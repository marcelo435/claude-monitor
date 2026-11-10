'use strict';
const path=require('node:path');
const {clean}=require('./core');
const {decorate}=require('./bridge');
const {decoratePlan}=require('./quota');
const sum=u=>u.input+u.output+u.cacheRead+u.cacheWrite;
function buildSnapshot(monitor,bridge,plan){
  const map=new Map();
  for(const s of monitor.sessions){
    const t=s.main,id=t.sessionId||path.basename(t.file,'.jsonl');
    const tokens=t.totals();
    map.set(id,{id,cwd:clean(t.cwd,1000),model:clean(t.model),lastTime:t.lastTime,tokens,total:sum(tokens),
      allTokens:s.agents.reduce((v,a)=>v+sum(a.totals()),sum(tokens)),partial:t.partial||s.agents.some(a=>a.partial),moreAgents:s.moreAgents,
      logAgents:s.agents.map(a=>({id:path.basename(a.file,'.jsonl').replace(/^agent-/,''),model:a.model,tokens:sum(a.totals()),lastTime:a.lastTime})),
      logActivity:[...t.tools.values()].sort((a,b)=>b.time-a.time).slice(0,25).map(a=>({name:a.name,detail:a.detail,time:new Date(a.time||0).toISOString(),statusLabel:a.error?'Erro':a.done?'Concluída':'Sem resultado registrado'}))});
  }
  for(const [id,raw] of bridge.sessions){
    const live=decorate(raw);let s=map.get(id);
    if(!s){s={id,cwd:raw.cwd,model:raw.model,lastTime:0,tokens:null,total:null,allTokens:null,partial:false,moreAgents:0,logAgents:[],logActivity:[]};map.set(id,s);}
    s.live=live;s.cwd=raw.cwd||s.cwd;s.model=raw.model||s.model;
  }
  const sessions=[...map.values()].sort((a,b)=>Number(!!b.live?.online)-Number(!!a.live?.online)||(Date.parse(b.live?.publishedAt)||b.lastTime)-(Date.parse(a.live?.publishedAt)||a.lastTime));
  return {schema:1,updatedAt:new Date().toISOString(),warning:[monitor.error,bridge.error].filter(Boolean).join(' '),plan:decoratePlan(plan),sessions};
}
module.exports={buildSnapshot};
