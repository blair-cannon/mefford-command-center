import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { harness, accountant, today } from '../tests/support/project-workflow-harness.mjs';
import { preparePressureVendors, pressureScenarios, runPressureJourney, PRESSURE_SEED } from '../tests/support/platform-pressure-journey.mjs';
const count=Number(process.env.PRESSURE_COUNT||1000);
const offset=Number(process.env.PRESSURE_OFFSET||0);
assert.ok(Number.isInteger(count)&&count>0&&count<=1000);
const started=Date.now(),results=[],requests={},expectedFailures=[];
const h=await harness({observeRequest:r=>{const key=`${r.method} ${r.path} ${r.action}`.trim();const s=requests[key]??={count:0,expectedRejections:0,unexpectedResponses:0,totalMs:0,maxMs:0};s.count++;s.expectedRejections+=r.status>=400&&r.status===r.expected?1:0;s.unexpectedResponses+=r.status!==r.expected?1:0;s.totalMs+=r.milliseconds;s.maxMs=Math.max(s.maxMs,r.milliseconds);}});
h.runtime.database.maxBindings=100;
const originalError=console.error;
console.error=(...args)=>{if(expectedFailures.length<30)expectedFailures.push(args.map(a=>String(a)).join(' ').slice(0,1000));};
try {
  const vendors=await preparePressureVendors(h);
  for(const fixture of pressureScenarios(offset+count).slice(offset)) {
    const began=Date.now();
    try{const r=await runPressureJourney(h,fixture,vendors);r.seconds=(Date.now()-began)/1000;results.push(r);}
    catch(error){results.push({id:fixture.suffix,passed:false,error:error.stack});originalError(`${fixture.suffix}: ${error.stack}`);break;}
    if(results.length%10===0||results.length===count)console.log(`${results.length}/${count} projects passed; ${h.calls()} HTTP requests; ${Math.round((Date.now()-started)/1000)}s elapsed`);
  }
  if(results.length===count&&results.every(r=>r.passed)) {
    const closed=h.runtime.database.one("SELECT COUNT(*) AS n FROM projects WHERE name LIKE 'SYNTHETIC TEST ONLY Pressure%' AND status='Completed'").n;
    assert.equal(closed,count);
    const totals=h.runtime.database.one('SELECT SUM(debit_cents) AS debits,SUM(credit_cents) AS credits FROM accounting_journal_lines');assert.equal(totals.debits,totals.credits);
    const reports=await h.send(`/api/financial-reports?asOf=${today}`,{actor:accountant});
    assert.equal(reports.summary.openAp,0);assert.equal(reports.summary.accountsReceivable,0);
    assert.equal(h.runtime.database.one("SELECT COUNT(*) AS n FROM project_bonus_controls WHERE payment_status='Review Required'").n,count);
    assert.equal(h.runtime.database.one('PRAGMA integrity_check').integrity_check,'ok');
    assert.equal(h.runtime.database.query('PRAGMA foreign_key_check').length,0);
    assert.equal(h.outbound.length,0);
  }
} finally {
  console.error=originalError;
  for(const r of Object.values(requests)){r.totalMs=Math.round(r.totalMs);r.maxMs=Math.round(r.maxMs);}
  const report={seed:PRESSURE_SEED,runAt:new Date().toISOString(),runtime:process.env.LIFECYCLE_SOURCE==='1'?'source handlers':'compiled Worker',requested:count,projects:results.length,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,durationSeconds:Math.round((Date.now()-started)/1000),httpRequests:h.calls(),databaseStatements:h.runtime.database.statementCount,realMessagesSent:0,externalRequestsAttempted:h.outbound.length,offset,scope:'One isolated company database per batch, real application HTTP handlers, synthetic identities and signatures, original PDF quotes and edited DOCX files; no live bank/payroll/email execution.',requests,expectedFaultLogSample:expectedFailures,results};
  await writeFile(process.env.PRESSURE_REPORT || (count===1000?'docs/platform-pressure-1000-results-2026-09-16.json':'/workspace/scratch/810ccaed2080/platform-pressure-debug.json'),JSON.stringify(report,null,2)+'\n');
  await h.close();
}
assert.equal(results.length,count);assert.equal(results.filter(r=>!r.passed).length,0);
