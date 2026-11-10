'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {Transcript,Monitor,belongs}=require('../core');
function record(id,output=10) {return {type:'assistant',timestamp:'2026-11-10T12:00:00Z',cwd:'/project',sessionId:'s',message:{id,model:'test-model',usage:{input_tokens:100,output_tokens:output,cache_read_input_tokens:30,cache_creation_input_tokens:20},content:[]}};}
const line=r=>Buffer.from(JSON.stringify(r)+'\n');
test('streaming consolidates message IDs without summing repeated chunks',()=>{
  const t=new Transcript('unused'); t.feed(line(record('a',2)));t.feed(line(record('a',10)));t.feed(line(record('b',5)));
  assert.deepEqual(t.totals(),{input:200,output:15,cacheRead:60,cacheWrite:40});
  assert.equal(t.lastUsage.output,5);
});
test('fragmented UTF-8 and unfinished final JSON wait for next read',()=>{
  const t=new Transcript('unused');const r=record('á');const b=line(r);const cut=b.indexOf(Buffer.from('á'))+1;
  t.feed(b.subarray(0,cut));assert.equal(t.messages.size,0);t.feed(b.subarray(cut,b.length-1));assert.equal(t.messages.size,0);t.feed(b.subarray(b.length-1));assert.equal(t.messages.size,1);assert.ok(t.messages.has('á'));
});
test('tool result completes a call, preserves errors, and excludes commands',()=>{
  const t=new Transcript('unused');const r=record('a');r.message.content=[{type:'tool_use',id:'t',name:'Bash',input:{command:'secret command'}}];t.feed(line(r));
  assert.equal(t.tools.get('t').detail,'');assert.equal(t.tools.get('t').done,false);
  t.feed(line({type:'user',message:{content:[{type:'tool_result',tool_use_id:'t',is_error:true,content:'sensitive result'}]}}));
  assert.equal(t.tools.get('t').done,true);assert.equal(t.tools.get('t').error,true);assert.ok(!JSON.stringify([...t.tools.values()]).includes('sensitive'));
});
test('workspace matching excludes similarly prefixed sibling folders',()=>{
  const root=path.resolve('project');assert.ok(belongs(path.join(root,'src'),[root]));assert.ok(!belongs(root+'-other',[root]));assert.ok(!belongs('',[root]));
});
test('incremental reads and truncation do not double count',async()=>{
  const d=await fs.mkdtemp(path.join(os.tmpdir(),'claude-monitor-test-'));const f=path.join(d,'s.jsonl');
  try {await fs.writeFile(f,line(record('a')));const t=new Transcript(f);await t.update();await t.update();assert.equal(t.totals().input,100);
    await fs.appendFile(f,line(record('b')));await t.update();assert.equal(t.totals().input,200);
    await fs.writeFile(f,line(record('c')));await t.update();assert.equal(t.messages.size,1);assert.ok(t.messages.has('c'));
  } finally {await fs.rm(d,{recursive:true,force:true});}
});
test('scanner discovers main session and agent transcript and filters workspace',async()=>{
  const d=await fs.mkdtemp(path.join(os.tmpdir(),'claude-monitor-test-'));const workspace=path.join(d,'workspace');const encoded=path.resolve(workspace).replace(/[^a-zA-Z0-9]/g,'-');const project=path.join(d,'projects',encoded);
  try {await fs.mkdir(path.join(project,'s','subagents'),{recursive:true});const r=record('main');r.cwd=workspace;
    await fs.writeFile(path.join(project,'s.jsonl'),line(r));await fs.writeFile(path.join(project,'s','subagents','agent-one.jsonl'),line(record('agent')));
    const m=new Monitor();await m.scan(path.join(d,'projects'),[workspace],true);assert.equal(m.sessions.length,1);assert.equal(m.sessions[0].agents.length,1);
    await m.scan(path.join(d,'projects'),[workspace+'-other'],true);assert.equal(m.sessions.length,0);
    await m.scan(path.join(d,'missing'),[],false);assert.match(m.error,/não encontrada/);
  } finally {await fs.rm(d,{recursive:true,force:true});}
});
