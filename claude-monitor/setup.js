'use strict';
// Instala o plugin Local Monitor Bridge pelo CLI oficial do Claude, a partir do marketplace
// que acompanha a extensão. O marketplace é copiado para uma pasta fixa porque o Claude lê
// plugins de marketplace local direto dessa pasta: ela precisa continuar existindo.
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
const {configDir}=require('./bridge');
const PLUGIN='local-monitor-bridge@local-monitor-tools';
const MARKETPLACE='local-monitor-tools';

function installDir(env=process.env){
  return env.LOCALAPPDATA?path.join(env.LOCALAPPDATA,'Claude Monitor'):path.join(os.homedir(),'.claude-monitor');
}
async function pluginInstalled(root=configDir()){
  try{
    const data=JSON.parse(await fs.readFile(path.join(root,'plugins','installed_plugins.json'),'utf8'));
    const entries=data?.plugins?.[PLUGIN];
    return Array.isArray(entries)&&entries.length>0;
  }catch{return false;}
}
function run(binary,args,spawnImpl=spawn){
  return new Promise((resolve,reject)=>{
    let output='';
    const child=spawnImpl(binary,args,{cwd:os.tmpdir(),windowsHide:true,stdio:['ignore','pipe','pipe']});
    const timer=setTimeout(()=>{try{child.kill();}catch{}reject(new Error('O Claude demorou demais para responder.'));},120000);
    const keep=t=>{output=(output+t).slice(-4000);};
    child.stdout.on('data',keep);child.stderr.on('data',keep);
    child.on('error',()=>{clearTimeout(timer);reject(new Error('Não foi possível iniciar o CLI oficial do Claude.'));});
    child.on('exit',code=>{clearTimeout(timer);code===0?resolve(output):reject(new Error(`O Claude recusou a instalação (código ${code}). ${output.trim().split('\n').pop()||''}`.trim()));});
  });
}
async function installPlugin({extensionPath,binary,target=path.join(installDir(),'marketplace'),spawnImpl=spawn}){
  if(!binary)throw new Error('CLI oficial do Claude não encontrado. Instale a extensão Claude Code e faça login.');
  const source=path.join(extensionPath,'marketplace');
  await fs.access(path.join(source,'.claude-plugin','marketplace.json'));
  await fs.rm(target,{recursive:true,force:true});
  await fs.mkdir(path.dirname(target),{recursive:true});
  await fs.cp(source,target,{recursive:true});
  // "add" com o mesmo nome apenas aponta o marketplace para a nova pasta; pode repetir sem erro.
  await run(binary,['plugin','marketplace','add',target],spawnImpl);
  await run(binary,['plugin','install',PLUGIN,'--scope','user'],spawnImpl);
  return target;
}
module.exports={PLUGIN,MARKETPLACE,installDir,pluginInstalled,installPlugin,run};
