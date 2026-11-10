'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {PassThrough,Writable}=require('node:stream');
const {queryUsage,windowsFromUsage,decoratePlan}=require('../quota');
test('subscription windows use utilization as percentage, preserving zero and model limits',()=>{
  const windows=windowsFromUsage({rate_limits:{five_hour:{utilization:0,resets_at:'2030-01-01T00:00:00Z'},seven_day:{utilization:42.5,resets_at:null},seven_day_opus:{utilization:null},model_scoped:[{model:'Sonnet',utilization:12,resets_at:'2030-02-01T00:00:00Z'}]}});
  assert.equal(windows.length,3);assert.equal(windows[0].percentUsed,0);assert.equal(windows[1].percentUsed,42.5);assert.equal(windows[1].resetsAt,undefined);assert.equal(windows[2].label,'Semana · Sonnet');
  assert.deepEqual(windowsFromUsage({rate_limits:null}),[]);
});
test('official CLI receives only initialize and get_usage; no model prompts or auth reads',async()=>{
  const requests=[];
  function spawnStub(binary,args,options){
    assert.ok(args.includes('--safe-mode'));assert.ok(args.includes('--no-session-persistence'));assert.equal(options.windowsHide,true);
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
    child.stdin=new Writable({write(chunk,encoding,cb){const message=JSON.parse(chunk.toString());requests.push(message);assert.equal(message.type,'control_request');
      const data=message.request.subtype==='get_usage'?{rate_limits:{five_hour:{utilization:23,resets_at:null}}}:{};
      process.nextTick(()=>child.stdout.write(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:message.request_id,response:data}})+'\n'));cb();}});
    return child;
  }
  const response=await queryUsage('official-claude.exe',spawnStub);
  assert.equal(windowsFromUsage(response)[0].percentUsed,23);assert.deepEqual(requests.map(r=>r.request.subtype),['initialize','get_usage']);
});
test('stale and expired quota data are identified instead of displaying an invented reset',()=>{
  const p=decoratePlan({schema:1,status:'ok',checkedAt:'2020-01-01T00:00:00Z',windows:[{kind:'five_hour',percentUsed:99,resetsAt:'2020-01-01T01:00:00Z'}]});
  assert.equal(p.stale,true);assert.equal(p.windows[0].expired,true);assert.equal(p.windows[0].percentUsed,99);
});
