'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {pathToFileURL}=require('node:url');
const {validate,decorate,BridgeStore}=require('../bridge');
const {buildSnapshot}=require('../snapshot');
function fixture(){return {schema:1,sessionId:'session-1',cwd:'C:/Project',model:'model-test',publishedAt:new Date().toISOString(),phase:'working',context:{tokens:1234,window:200000,percent:1},rateLimits:[{kind:'five_hour',percentUsed:0,resetsAt:new Date(Date.now()+3600000).toISOString()},{kind:'seven_day',percentUsed:62.5}],agents:[{id:'agent-1',name:'Review',status:'running'}],activity:[]};}
test('zero percent is valid and missing readings are never invented',()=>{
  const raw=fixture();raw.rateLimits.push({kind:'bad',percentUsed:null});raw.credential='never export';
  const out=validate(raw);assert.equal(out.rateLimits.length,2);assert.equal(out.rateLimits[0].percentUsed,0);assert.ok(!('credential' in out));
  assert.equal(validate({...raw,schema:2}),null);assert.equal(validate({...raw,sessionId:'../escape'}),null);
});
test('stale agent states and expired quota windows are flagged',()=>{
  const raw=fixture();const future=Date.now()+3600001;
  const result=decorate(validate(raw),future);assert.equal(result.online,false);assert.equal(result.rateLimits[0].expired,true);assert.equal(result.agents[0].statusLabel,'Trabalhando');
  assert.equal(decorate(validate({...raw,ended:true})).online,false);
});
test('concurrent partial writes retain last valid snapshot without making it fresh',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'monitor-bridge-'));
  try{const f=path.join(dir,'session-1.json'),store=new BridgeStore();const raw=fixture();await fs.writeFile(f,JSON.stringify(raw));await store.scan(dir);assert.equal(store.sessions.size,1);
    await fs.writeFile(f,'{"schema":');await store.scan(dir);assert.equal(store.sessions.get('session-1').publishedAt,raw.publishedAt);
    await fs.unlink(f);await store.scan(dir);assert.equal(store.sessions.size,0);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('bridge-only session appears on desktop before a transcript exists',()=>{
  const store={sessions:new Map([['session-1',validate(fixture())]])};
  const snapshot=buildSnapshot({sessions:[],error:''},store);assert.equal(snapshot.sessions.length,1);assert.equal(snapshot.sessions[0].total,null);assert.equal(snapshot.sessions[0].live.rateLimits[1].percentUsed,62.5);
});
test('Claude mod exports real measurements and agent statuses without credentials or network',async()=>{
  const url=pathToFileURL(path.resolve(__dirname,'../../claude-monitor-bridge/hooks/register.js')).href;
  const {register}=await import(url+'?test='+Date.now());const hooks={},writes=[];let timer,cancelled=false;
  register((name,fn)=>{hooks[name]=fn;return {catch(){}};});
  const $={session:{id:async()=> 'session-1',cwd:async()=> 'C:/Project',model:async()=> 'model-test',usage:async()=>({context:{tokens:1234,window:200000,percent:1},rateLimits:[{kind:'five_hour',percentUsed:37,resetsAt:'2030-01-01T00:00:00Z'}]})},agent:{list:async()=>[{id:'a',description:'Review',type:'Explore',status:'waiting'}]},env:{get:async key=>key==='CLAUDE_CONFIG_DIR'?'C:/test-config':undefined},fs:{write:async(f,s)=>writes.push({f,data:JSON.parse(s)})},clock:{every:(ms,fn)=>{assert.equal(ms,2000);timer=fn;return{cancel(){cancelled=true;}};}}};
  let count=0;const next=async()=>{count++;return {success:true};};
  await hooks['session.start']($,{},next);assert.equal(writes.at(-1).data.rateLimits[0].percentUsed,37);assert.equal(writes.at(-1).data.agents[0].status,'waiting');assert.ok(writes.at(-1).f.startsWith('C:/test-config/claude-monitor/sessions/'));
  await hooks['session.measure']($,{context:{window:1000000},rateLimits:[{kind:'five_hour',percentUsed:42}]},next);assert.equal(writes.at(-1).data.rateLimits[0].percentUsed,42);
  await hooks['turn.start']($,{},next);assert.equal(writes.at(-1).data.phase,'working');
  await hooks['tool.call']($,{tool:'Bash',tool_use_id:'tool-1',command:'SECRET'},async()=>({isError:false}));assert.equal(writes.at(-1).data.activity[0].status,'completed');assert.ok(!JSON.stringify(writes).includes('SECRET'));
  await hooks['session.end']($,{},next);assert.equal(writes.at(-1).data.ended,true);assert.equal(cancelled,true);assert.equal(count,4);
});
