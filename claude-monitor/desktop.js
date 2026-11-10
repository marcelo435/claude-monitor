'use strict';
// Desktop collector: local files only. No HTTP server, socket, network or credentials.
const fs=require('node:fs/promises');
const path=require('node:path');
const {Monitor}=require('./core');
const {BridgeStore,configDir}=require('./bridge');
const {buildSnapshot}=require('./snapshot');
const {QuotaStore}=require('./quota');
async function main(){
  const args=process.argv.slice(2),index=args.indexOf('--snapshot'),parentIndex=args.indexOf('--parent');
  if(index<0||!args[index+1])throw new Error('Informe --snapshot <arquivo>.');
  const dest=path.resolve(args[index+1]),parent=parentIndex>=0?Number(args[parentIndex+1]):0;
  const monitor=new Monitor(),bridge=new BridgeStore();
  const quota=new QuotaStore();
  process.on('exit',()=>quota.dispose());
  let stopped=false;
  process.on('SIGTERM',()=>{stopped=true;});process.on('SIGINT',()=>{stopped=true;});
  while(!stopped){
    if(parent){try{process.kill(parent,0);}catch(e){if(e.code==='ESRCH')break;}}
    try{
      await Promise.all([monitor.scan(path.join(configDir(),'projects'),[],false),bridge.scan(),quota.load()]);
      if(!args.includes('--once'))void quota.refresh();
      const snapshot=buildSnapshot(monitor,bridge,quota.plan);
      await fs.mkdir(path.dirname(dest),{recursive:true});
      await fs.writeFile(dest+'.tmp',JSON.stringify(snapshot),'utf8');await fs.rename(dest+'.tmp',dest);
    }catch(e){
      // Only an error code is emitted: never transcripts or auth diagnostics.
      process.stderr.write(`Falha no coletor local (${e.code||'leitura'}).\n`);
    }
    if(args.includes('--once'))break;
    await new Promise(resolve=>setTimeout(resolve,2000));
  }
}
if(require.main===module)main().catch(()=>{process.stderr.write('Não foi possível iniciar o coletor local.\n');process.exitCode=1;});
module.exports={main};
