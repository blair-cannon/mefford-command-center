import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { zipSync, unzipSync, strFromU8, strToU8 } from 'fflate';
import { harness, owner, today } from './support/project-workflow-harness.mjs';
import { activateActor } from './support/f06-runtime-harness.mjs';
import { newEstimateData, calculateEstimateSummary, ESTIMATE_TEMPLATE_COST_CODES } from '../app/estimate-template.ts';

// Fixed random seed makes all 100 independently varied jobs reproducible.
const SEED = 20260911;
const sales = { name:'Taylor Sales', email:'sales.pressure@meffcon.com', accessLevel:'Employee', designations:['Sales Representative'] };
const estimator = { name:'Morgan Estimator', email:'estimate.pressure@meffcon.com', accessLevel:'Employee', designations:['Estimator'] };
function scenarios() {
  let s=SEED; const random=()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};
  const pick=a=>a[Math.floor(random()*a.length)];
  const names=['School Addition','Municipal Garage','Brewery Fit Out','Medical Office','Warehouse Expansion','Library Renovation','Retail Buildout','Community Center'];
  const types=['Plan & Spec Lump Sum','Design-Build GMP','Design-Build Lump Sum','Time & Materials'];
  return Array.from({length:100},(_,i)=>({id:`PRESSURE-${String(i+1).padStart(3,'0')}`,kind:i<25?'public':i<40?'direct':'contact',name:`SYNTHETIC ${pick(names)} ${i+1}`,type:pick(types),duration:1+Math.floor(random()*18),probability:Math.floor(random()*101),cost:Math.round((10000+random()*5000000)*100)/100,credit:Math.round(random()*250000)/100,lines:2+Math.floor(random()*7),finish:pick(['Negotiation','Proposal Submitted','Lost']),month:1+Math.floor(random()*12)}));
}
function editWord(bytes, changes) {
  const files=unzipSync(bytes); assert.ok(files['word/document.xml'],'Export must be an actual editable Word file');
  let xml=strFromU8(files['word/document.xml']);
  for(const [key,value] of Object.entries(changes)) {
    // Keep neighboring controls untouched; target using the full single-control match.
    let found=false;
    xml=xml.replace(/<w:sdt>[\s\S]*?<\/w:sdt>/g,block=>{
      if(!block.includes(`w:val="meffcon:${key}"`)) return block;
      found=true;
      const escaped=String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
      return block.replace(/<w:sdtContent>[\s\S]*?<\/w:sdtContent>/,`<w:sdtContent><w:p><w:r><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p></w:sdtContent>`);
    });
    assert.ok(found,`Word field ${key} is editable`);
  }
  files['word/document.xml']=strToU8(xml); return zipSync(files);
}
const form=(id,bytes)=>{const f=new FormData();f.set('action','import-word');f.set('opportunityId',id);f.set('packetType','Construction Proposal');f.set('file',new File([bytes],'Edited-Proposal.docx',{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}));return f;};

async function exerciseWordGuards(h, id, recordId, original, checks) {
  const snapshot=()=>JSON.stringify({proposal:h.row('MEFFORD-SALES',recordId),opportunity:h.row('MEFFORD-SALES',id),files:h.runtime.database.query('SELECT * FROM project_files'),audits:h.runtime.database.query('SELECT * FROM record_audits'),objects:[...h.runtime.bucket.objects.keys()].sort()});
  async function rejected(name, bytes, expected=409, actor=estimator) {
    if(process.env.PRESSURE_TRACE)console.log('guard',name);const before=snapshot();const result=await h.post('/api/proposals',form(id,bytes),actor,expected);assert.ok(result.error,name);assert.equal(snapshot(),before,`${name} must leave no partial writes`);checks.push(name);
  }
  await rejected('invalid ZIP',new TextEncoder().encode('This is not a Word document'));
  await rejected('oversized upload',new Uint8Array(8*1024*1024+1),400);
  for(const [name,transform] of [
    ['wrong proposal identity',files=>{files['docProps/custom.xml']=strToU8(strFromU8(files['docProps/custom.xml']).replace(id,'OTHER-OPPORTUNITY'));}],
    ['missing content control',files=>{files['word/document.xml']=strToU8(strFromU8(files['word/document.xml']).replace(/<w:sdt>[\s\S]*?<\/w:sdt>/,''));}],
    ['duplicate content control',files=>{const xml=strFromU8(files['word/document.xml']);files['word/document.xml']=strToU8(xml.replace('</w:body>',xml.match(/<w:sdt>[\s\S]*?<\/w:sdt>/)[0]+'</w:body>'));}],
    ['tracked changes',files=>{files['word/document.xml']=strToU8(strFromU8(files['word/document.xml']).replace('<w:body>','<w:body><w:ins/>'));}],
    ['unsupported edits outside fields',files=>{files['word/document.xml']=strToU8(strFromU8(files['word/document.xml']).replace('Edit the fields below','Unmapped custom text. Edit the fields below'));}],
    ['embedded program',files=>{files['word/vbaProject.bin']=new Uint8Array([1,2,3]);}],
  ]) {const files=unzipSync(original);transform(files);await rejected(name,zipSync(files));}
  for(const [name,change] of [
    ['invalid deposit',{depositPercent:'101'}],['invalid date',{validThrough:'2026-02-30'}],['invalid amount',{'scopeSections.0.amount':'$1,2.33'}],
  ])await rejected(name,editWord(original,change));
  const employee=(await import('./support/f06-runtime-harness.mjs')).F06_ACTORS.employee;
  await activateActor(h.runtime.database,employee);
  await rejected('unprivileged upload',original,403,employee);
  await h.send(`/api/proposals/document?opportunityId=${id}&recordId=${recordId}&format=docx`,{actor:employee,expected:403});checks.push('unprivileged export');
  await h.send(`/api/files?projectId=DESIGN-${id}`,{actor:employee,expected:403});checks.push('unprivileged design-file access');
  const before=snapshot();const unchanged=await h.post('/api/proposals',form(id,original),estimator);assert.equal(unchanged.changes.length,0);assert.equal(snapshot(),before);checks.push('unchanged copy is a no-op');
  const edited=editWord(original,{executiveSummary:'Word guard successful edit'});
  h.runtime.bucket.injectFailure({operation:'put',keyPattern:/word-imports/});await rejected('object storage failure',edited,503);
  h.runtime.database.injectFailure({pattern:/UPDATE command_records SET data_json=/});await rejected('database failure rolls back all import writes',edited);
  await h.post('/api/proposals',{action:'save',opportunityId:id,packetType:'Construction Proposal',data:{...h.row('MEFFORD-SALES',recordId).data,executiveSummary:'Newer Studio edit'}},estimator);
  await rejected('stale Word copy',edited);
  let current=await h.send(`/api/proposals/document?opportunityId=${id}&recordId=${recordId}&format=docx`,{actor:estimator,binary:true});
  // Force two requests to validate the same base before either attempts its D1
  // transaction. The production compare-and-save must accept exactly one.
  const realPut=h.runtime.bucket.put.bind(h.runtime.bucket);let arrived=0;let release;const both=new Promise(resolve=>{release=resolve;});
  h.runtime.bucket.put=async (...args)=>{if(String(args[0]).includes('word-imports')){arrived++;if(process.env.PRESSURE_TRACE)console.log('competing upload',arrived);if(arrived===2)release();await both;}return realPut(...args);};
  const results=await Promise.allSettled(['First competing edit','Second competing edit'].map(executiveSummary=>h.post('/api/proposals',form(id,editWord(current,{executiveSummary})),estimator).catch(error=>{release();throw error;})));
  h.runtime.bucket.put=realPut;
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);const loser=results.find(x=>x.status==='rejected');assert.match(loser.reason.message,/Changed While|Out Of Date/);assert.equal(h.runtime.database.one('SELECT COUNT(*) count FROM proposal_write_guards').count,0);checks.push('simultaneous imports accept exactly one version');
  current=await h.send(`/api/proposals/document?opportunityId=${id}&recordId=${recordId}&format=docx`,{actor:estimator,binary:true});
  // Word commonly splits text into multiple runs during normal editing.
  const files=unzipSync(current);files['word/document.xml']=strToU8(strFromU8(files['word/document.xml']).replace(/(<w:t[^>]*>)(First competing edit|Second competing edit)(<\/w:t>)/,'$1Split$3</w:r><w:r><w:t> run edit</w:t>'));
  const split=await h.post('/api/proposals',form(id,zipSync(files)),estimator);assert.equal(split.record.data.executiveSummary,'Split run edit');checks.push('Word split text runs');
  return h.send(`/api/proposals/document?opportunityId=${id}&recordId=${recordId}&format=docx`,{actor:estimator,binary:true});
}

test('100 randomized sales and estimating projects complete the contact-to-proposal round trip', {timeout:150000}, async t=>{
  const h=await harness(); const results=[]; const checks=[]; const start=Date.now();
  for(const actor of [sales,estimator]) {
    await h.runtime.database.prepare("INSERT INTO company_members (email,display_name,company_access_level,designations_json,is_active,identity_provider,provider_subject) VALUES (?,?,?,?,1,'f06_test_identity',?)").bind(actor.email,actor.name,actor.accessLevel,JSON.stringify(actor.designations),actor.email).run();
    await activateActor(h.runtime.database,actor);
  }
  h.runtime.database.maxBindings=100;
  await h.runtime.database.prepare("INSERT INTO company_members (email,display_name,company_access_level,designations_json,is_active) VALUES ('disabled.pressure@meffcon.com','Disabled Sales','Employee','[\"Sales Representative\",\"Estimator\"]',0)").run();
  for (const actor of [sales, estimator]) {
    const roster = await h.send('/api/sales-team', { actor });
    assert.ok(roster.salespeople.some(person => person.email === sales.email));
    assert.ok(roster.estimators.some(person => person.email === estimator.email));
    assert.ok(!roster.salespeople.some(person => person.email === estimator.email));
    assert.ok(!roster.estimators.some(person => person.email === sales.email));
    assert.ok(![...roster.salespeople, ...roster.estimators].some(person => person.email === 'disabled.pressure@meffcon.com'));
  }
  const unprivileged = (await import('./support/f06-runtime-harness.mjs')).F06_ACTORS.employee;
  await activateActor(h.runtime.database, unprivileged);
  await h.send('/api/sales-team', { actor: unprivileged, expected: 403 });
  checks.push('active role-qualified assignment roster and access checks');
  const costs=ESTIMATE_TEMPLATE_COST_CODES.filter(x=>x.calculation==='direct_cost' && !x.children.length && !/^01/.test(x.code));
  try {
    for(const scenario of scenarios()) {
      let step='contact and assignment'; const before=h.calls();
      try {
        const {id}=scenario; const company=scenario.kind==='public'?'SYNTHETIC City Government':scenario.kind==='direct'?'SYNTHETIC Summit Properties':'SYNTHETIC Cardinal Manufacturing';const contactId=`CONTACT-${id}`;
        if(scenario.kind==='contact') {
          await h.save('MEFFORD-SALES','Sales Contacts',contactId,'Active',{firstName:'Casey',lastName:id,company,email:`client-${id.toLowerCase()}@example.invalid`,phone:'859-555-0100',assignedRep:sales.name,source:'Referral'},sales,201,{title:`Casey ${id}`});
          await h.save('MEFFORD-SALES','Sales Contacts',contactId,'Active',{...h.row('MEFFORD-SALES',contactId).data,jobTitle:'Facilities Director',assignedRep:sales.name},sales,201,{title:`Casey ${id}`});
        }
        let opp={projectName:scenario.name,company,contactId:scenario.kind==='contact'?contactId:'',assignedRep:sales.name,assignedEstimator:estimator.name,leadSource:scenario.kind==='public'?'Public Bid':'Referral',expectedAwardDate:`${today.slice(0,4)}-${String(scenario.month).padStart(2,'0')}-20`,ownerContractType:scenario.type,deliveryMethod:scenario.type,projectType:'Commercial',projectLocation:'200 Synthetic Way, Lexington, KY 40507',projectAddress:'200 Synthetic Way, Lexington, KY 40507',projectDescription:`Furnish ${scenario.lines} scopes for ${scenario.name}.`,stage:'New Lead',estimatedValue:scenario.cost.toFixed(2),probability:String(scenario.probability),targetStartDate:today,durationMonths:scenario.duration};
        if(scenario.kind==='direct') opp={...opp,stage:'Estimating',directEstimate:true};
        await h.save('MEFFORD-SALES','Sales Opportunities',id,opp.stage,opp,scenario.kind==='direct'?estimator:sales,201,{title:scenario.name});
        if(scenario.kind!=='direct') for(const stage of ['Qualified Opportunity','Site Visit And Discovery']) await h.save('MEFFORD-SALES','Sales Opportunities',id,stage,{...h.row('MEFFORD-SALES',id).data,stage},sales,201,{title:scenario.name});
        step='estimating handoff';
        await h.save('MEFFORD-SALES','Sales Opportunities',id,'Estimating',{...h.row('MEFFORD-SALES',id).data,stage:'Estimating'},sales,201,{title:scenario.name});
        assert.ok(h.row('MEFFORD-SALES',id).data.estimatingLockedAt);
        step='estimate entry and revision';
        const estimate=newEstimateData();estimate.projectInputs.projectDurationMonths=scenario.duration;estimate.projectInputs.architecturalFeeOverride=0;estimate.projectInputs.cleanupFeeOverride=125.25;estimate.settings.includePerformanceBond=scenario.kind==='public';
        for(let j=0;j<scenario.lines;j++)estimate.entries[costs[j].code]={quantity:j+1,unit:'LS',material:Math.round(scenario.cost/(scenario.lines*(j+1))*100)/100,labor:j*12.35,equipment:j*3.67,subcontract:0,other:j===0?-scenario.credit:0};
        estimate.notes=`Pressure seed ${SEED}; negative credit ${scenario.credit}`;
        let data={...h.row('MEFFORD-SALES',id).data,estimate,estimateStatus:'Draft'};
        await h.save('MEFFORD-SALES','Sales Opportunities',id,'Estimating',data,estimator,201,{title:scenario.name});
        estimate.entries[costs[0].code].labor+=99.99;
        estimate.status='Ready For Review';estimate.submittedAt=new Date().toISOString();
        data={...h.row('MEFFORD-SALES',id).data,estimate,estimateStatus:'Ready For Review'};
        await h.save('MEFFORD-SALES','Sales Opportunities',id,'Estimating',data,estimator,201,{title:scenario.name});
        const summary=calculateEstimateSummary(h.row('MEFFORD-SALES',id).data.estimate);assert.equal(summary.reconciliationDifference,0);assert.ok(summary.contractValue>0);
        await h.post('/api/owner-approvals',{action:'decide',approvalItemId:`estimate:MEFFORD-SALES:${id}`,decision:'Approved',note:'Synthetic pressure review'},owner);
        step='proposal source file access';
        await h.send(`/api/files?projectId=DESIGN-${id}`,{actor:sales});
        await h.send(`/api/files?projectId=ESTIMATE-${id}`,{actor:estimator});
        step='proposal generation and contact prefill';
        const generated=await h.post('/api/proposals',{action:'generate',opportunityId:id,packetType:'Construction Proposal'},estimator,201);
        if(scenario.kind==='contact'){assert.equal(generated.record.data.ownerContactEmail,`client-${id.toLowerCase()}@example.invalid`);assert.equal(generated.record.data.ownerName,company);}
        assert.equal(generated.record.data.contractPrice,summary.contractValue);
        let proposal={...generated.record.data,projectLocation:opp.projectLocation,targetStartDate:today,executiveSummary:opp.projectDescription,projectUnderstanding:opp.projectDescription};
        if(scenario.kind==='direct')proposal.ownerContactName='Synthetic Procurement Desk';
        await h.post('/api/proposals',{action:'save',opportunityId:id,packetType:'Construction Proposal',data:proposal},estimator);
        step='Word export edit and automatic reimport';
        let original=await h.send(`/api/proposals/document?opportunityId=${id}&recordId=${generated.record.id}&format=docx`,{actor:estimator,binary:true});
        if(results.length===0) original=await exerciseWordGuards(h,id,generated.record.id,original,checks);
        const note=`Edited in Word for ${id} — include accessibility coordination & field verification.`;
        const priceDelta=results.length%10===0?125.25:0;
        const expectedPrice=Math.round((summary.contractValue+priceDelta)*100)/100;
        const edited=editWord(original,{...(priceDelta?{'scopeSections.0.amount':(generated.record.data.scopeSections[0].amount+priceDelta).toFixed(2)}:{}),executiveSummary:note,paymentTerms:`Net ${15+(scenario.lines%3)*15}`,nextSteps:`Coordinate ${id} scope review.`});
        const imported=await h.post('/api/proposals',form(id,edited),estimator);
        assert.equal(imported.record.data.executiveSummary,note);assert.equal(imported.record.data.status,'Draft');assert.equal(imported.record.data.contractPrice,expectedPrice);assert.equal(h.row('MEFFORD-SALES',id).data.proposalHandoff.contractAmount,expectedPrice);assert.equal(calculateEstimateSummary(h.row('MEFFORD-SALES',id).data.estimate).contractValue,summary.contractValue);
        const readback=await h.send(`/api/proposals?opportunityId=${id}`,{actor:sales});assert.equal(readback.records.find(r=>r.id===generated.record.id).data.executiveSummary,note);
        if(results.length===0 && process.env.PRESSURE_EVIDENCE_DIR){await mkdir(process.env.PRESSURE_EVIDENCE_DIR,{recursive:true});await writeFile(`${process.env.PRESSURE_EVIDENCE_DIR}/proposal-original.docx`,original);await writeFile(`${process.env.PRESSURE_EVIDENCE_DIR}/proposal-edited.docx`,edited);}
        step='proposal approval and immutable issue';
        await h.post('/api/proposals',{action:'issue',opportunityId:id,packetType:'Construction Proposal'},owner,409);
        await h.post('/api/proposals',{action:'submit-review',opportunityId:id,packetType:'Construction Proposal',data:imported.record.data},estimator);
        if(results.length===0){await h.post('/api/proposals',form(id,edited),estimator,423);checks.push('review-pending import locked');}
        await h.post('/api/owner-approvals',{action:'decide',approvalItemId:`owner-proposal:MEFFORD-SALES:${generated.record.id}`,decision:'Approved',note:'Synthetic Word changes reviewed'},owner);
        if(results.length===0){await h.post('/api/proposals',form(id,edited),estimator,423);checks.push('approved import locked');}
        const issued=await h.post('/api/proposals',{action:'issue',opportunityId:id,packetType:'Construction Proposal'},owner);
        assert.equal(issued.handoff.status,'Completed');assert.equal(h.row('MEFFORD-SALES',id).data.stage,'Proposal Submitted');
        const pdf=await h.send(`/api/proposals/document?opportunityId=${id}&recordId=${generated.record.id}`,{binary:true});assert.equal(Buffer.from(pdf).subarray(0,4).toString(),'%PDF');
        if(results.length===0){await h.post('/api/proposals',form(id,edited),estimator,423);assert.equal(h.row('MEFFORD-SALES',generated.record.id).data.issuedPdfHash,issued.record.data.issuedPdfHash);checks.push('issued import locked and PDF hash preserved');}
        step='funnel movement and live dashboard revision';
        const revision=h.runtime.database.one('SELECT revision FROM dashboard_change_revisions WHERE id=1').revision;
        const next={...h.row('MEFFORD-SALES',id).data,stage:scenario.finish,probability:scenario.finish==='Lost'?'0':scenario.finish==='Negotiation'?'85':'70',...(scenario.finish==='Lost'?{lostReason:'Competitor Selected'}:{})};
        await h.save('MEFFORD-SALES','Sales Opportunities',id,scenario.finish,next,sales,201,{title:scenario.name});
        assert.ok(h.runtime.database.one('SELECT revision FROM dashboard_change_revisions WHERE id=1').revision>revision);
        const finalRead=await h.send('/api/records?projectId=MEFFORD-SALES',{actor:sales});const final=finalRead.records.find(r=>r.id===id);assert.equal(final.data.stage,scenario.finish);assert.equal(Number(final.data.estimatedValue),expectedPrice);assert.ok(final.data.estimatingLockedAt);
        results.push({...scenario,passed:true,requests:h.calls()-before,contractValue:expectedPrice,estimateValue:summary.contractValue,finalStage:scenario.finish});
      } catch(error){results.push({...scenario,passed:false,step,error:error.message,requests:h.calls()-before});}
      if(process.env.PRESSURE_TRACE)console.log('project',results.at(-1));
      if(results.length%10===0)t.diagnostic(`${results.length}/100 exercised; ${results.filter(r=>r.passed).length} complete`);
    }
    const active=results.filter(result=>result.passed && result.finalStage!=='Lost');
    const pipelineCents=active.reduce((total,result)=>total+Math.round(result.contractValue*100),0);
    const weightedCents=Math.round(active.reduce((total,result)=>total+Math.round(result.contractValue*100)*(result.finalStage==='Negotiation'?85:70)/100,0));
    const dashboard=await h.send('/api/operating-doctrine');
    const salesMetrics=dashboard.scorecards.find(card=>card.doctrine.role==='Sales').metrics;
    const money=cents=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
    assert.equal(salesMetrics.find(metric=>metric.label==='Open Pipeline').value,money(pipelineCents));
    assert.equal(salesMetrics.find(metric=>metric.label==='Open Pipeline').detail,`${active.length} active opportunities`);
    assert.equal(salesMetrics.find(metric=>metric.label==='Weighted Pipeline').value,money(weightedCents));
    assert.equal(salesMetrics.find(metric=>metric.label==='Goal Coverage').value,'Goal Not Set');
    checks.push('dashboard aggregate count, pipeline, weighting, and missing-goal state');
    const report={checks,seed:SEED,projects:results.length,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,httpRequests:h.calls(),externalRequests:h.outbound.length,elapsedMs:Date.now()-start,dashboard:{active:active.length,pipelineCents,weightedCents},results};
    if(!process.env.PRESSURE_REPORT)await mkdir(new URL('../work/',import.meta.url),{recursive:true});
    await writeFile(process.env.PRESSURE_REPORT || new URL('../work/sales-pressure-report.json',import.meta.url),JSON.stringify(report,null,2));
    if(process.env.PRESSURE_EVIDENCE_DIR){const tables={};for(const name of ['company_members','command_records','project_files'])tables[name]=h.runtime.database.query(`SELECT * FROM ${name}`);await writeFile(`${process.env.PRESSURE_EVIDENCE_DIR}/browser-fixture.json`,JSON.stringify(tables));}
    t.diagnostic(JSON.stringify({...report,results:undefined}));
    assert.equal(h.outbound.length,0);assert.equal(results.length,100);assert.deepEqual(results.filter(r=>!r.passed).map(({id,step,error})=>({id,step,error})),[]);
  } finally {await h.close();}
});
