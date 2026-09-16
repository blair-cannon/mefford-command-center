import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { sourceFingerprint } from './platform-source-fingerprint.mjs';
const root=new URL('../',import.meta.url).pathname,folder=await mkdtemp(`${tmpdir()}/meffcon-1000-`),started=Date.now(),fingerprint=await sourceFingerprint();
let next=0,failed=false;
const reports=[];
async function worker(){
  while(next<20&&!failed){
    const batch=next++,report=`${folder}/${batch}.json`;
    const code=await new Promise(resolve=>{
      const child=spawn(process.execPath,['--experimental-strip-types','--import','./tests/support/f06-cloudflare-loader.mjs','scripts/platform-pressure-audit.mjs'],{cwd:root,env:{...process.env,PRESSURE_COUNT:'50',PRESSURE_OFFSET:String(batch*50),PRESSURE_REPORT:report},stdio:['ignore','pipe','pipe']});
      child.stdout.on('data',s=>process.stdout.write(`Batch ${batch+1}: ${s}`));
      child.stderr.on('data',s=>process.stderr.write(`Batch ${batch+1}: ${s}`));
      child.on('exit',resolve);
    });
    try{reports.push(JSON.parse(await readFile(report,'utf8')));}catch(error){reports.push({offset:batch*50,passed:0,failed:1,results:[{passed:false,error:String(error)}]});}
    if(code!==0)failed=true;
  }
}
await Promise.all(Array.from({length:8},()=>worker()));
reports.sort((a,b)=>a.offset-b.offset);
const results=reports.flatMap(r=>r.results),summary={runAt:new Date().toISOString(),sourceFingerprint:fingerprint,runtime:process.env.LIFECYCLE_SOURCE==='1'?'source handlers':'compiled Worker',requested:1000,projects:results.length,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,durationSeconds:Math.round((Date.now()-started)/1000),httpRequests:reports.reduce((s,r)=>s+(r.httpRequests||0),0),databaseStatements:reports.reduce((s,r)=>s+(r.databaseStatements||0),0),realMessagesSent:0,externalRequestsAttempted:reports.reduce((s,r)=>s+(r.externalRequestsAttempted||0),0),method:'Twenty independent 50-project company databases; eight test processes at a time. Each project executes the full quote-to-closeout workflow. This is functional pressure coverage, not a hosted concurrency benchmark.',batches:reports.map(({results,...r})=>r),results};
if(await sourceFingerprint()!==fingerprint){summary.failed++;summary.sourceChangedDuringRun=true;}
await writeFile('docs/platform-pressure-1000-results-2026-09-16.json',JSON.stringify(summary,null,2)+'\n');
await rm(folder,{recursive:true,force:true});
console.log(JSON.stringify({projects:summary.projects,passed:summary.passed,failed:summary.failed,httpRequests:summary.httpRequests,durationSeconds:summary.durationSeconds}));
if(failed||summary.projects!==1000||summary.failed)process.exitCode=1;
