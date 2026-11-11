'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
const {pluginInstalled,installPlugin,installDir,PLUGIN}=require('../setup');

function spawnStub(calls,codes=[]){
  return (binary,args,options)=>{
    calls.push({binary,args});assert.equal(options.windowsHide,true);
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
    const code=codes.length?codes.shift():0;
    process.nextTick(()=>{child.stderr.write(code?'falhou de verdade\n':'');child.emit('exit',code);});
    return child;
  };
}
async function fakeExtension(){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cm-setup-'));
  const market=path.join(dir,'ext','marketplace');
  await fs.mkdir(path.join(market,'.claude-plugin'),{recursive:true});
  await fs.writeFile(path.join(market,'.claude-plugin','marketplace.json'),'{}');
  await fs.mkdir(path.join(market,'claude-monitor-bridge','hooks'),{recursive:true});
  await fs.writeFile(path.join(market,'claude-monitor-bridge','hooks','register.js'),'// plugin');
  return dir;
}

test('plugin detection reads installed_plugins.json and tolerates missing or broken files',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cm-plugins-'));
  assert.equal(await pluginInstalled(dir),false);
  await fs.mkdir(path.join(dir,'plugins'));
  await fs.writeFile(path.join(dir,'plugins','installed_plugins.json'),'{quebrado');
  assert.equal(await pluginInstalled(dir),false);
  await fs.writeFile(path.join(dir,'plugins','installed_plugins.json'),JSON.stringify({version:2,plugins:{[PLUGIN]:[{scope:'user'}]}}));
  assert.equal(await pluginInstalled(dir),true);
  await fs.rm(dir,{recursive:true,force:true});
});

test('install copies the marketplace to a fixed folder and registers it through the official CLI',async()=>{
  const dir=await fakeExtension();const calls=[];const target=path.join(dir,'fixo','marketplace');
  const out=await installPlugin({extensionPath:path.join(dir,'ext'),binary:'claude.exe',target,spawnImpl:spawnStub(calls)});
  assert.equal(out,target);
  assert.equal(await fs.readFile(path.join(target,'claude-monitor-bridge','hooks','register.js'),'utf8'),'// plugin');
  assert.deepEqual(calls.map(c=>c.args),[['plugin','marketplace','add',target],['plugin','install',PLUGIN,'--scope','user']]);
  await fs.rm(dir,{recursive:true,force:true});
});

test('install reports a missing CLI and a refused command instead of failing silently',async()=>{
  const dir=await fakeExtension();
  await assert.rejects(installPlugin({extensionPath:path.join(dir,'ext'),binary:null}),/CLI oficial do Claude não encontrado/);
  await assert.rejects(installPlugin({extensionPath:path.join(dir,'ext'),binary:'claude.exe',target:path.join(dir,'fixo'),spawnImpl:spawnStub([],[1])}),/código 1\). falhou de verdade/);
  await fs.rm(dir,{recursive:true,force:true});
});

test('fixed install folder uses LOCALAPPDATA on Windows',()=>{
  assert.equal(installDir({LOCALAPPDATA:'C:\\Users\\x\\AppData\\Local'}),path.join('C:\\Users\\x\\AppData\\Local','Claude Monitor'));
  assert.equal(installDir({}),path.join(os.homedir(),'.claude-monitor'));
});
