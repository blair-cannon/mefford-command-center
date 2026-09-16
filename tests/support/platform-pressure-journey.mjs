import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { zipSync, unzipSync, strFromU8, strToU8 } from 'fflate';
import { extractQuoteFields } from '../../lib/quote-ocr.js';
import { owner, pm, superintendent, accountant, today, signature, scenarios, saleToExecutedContract } from './project-workflow-harness.mjs';
import { runOperationsAndFinance, runCloseout } from './project-closeout-workflow.mjs';

export const PRESSURE_SEED = 20260916;
export const cash = n => Math.round(n * 100) / 100;
export function pressureScenarios(count = 1000) {
  let seed = PRESSURE_SEED;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  return Array.from({length:count}, (_,i) => {
    const cost = cash(10000 + random() * 900000);
    return {...scenarios[i % scenarios.length], index:i, name:`Pressure ${i+1}`, cost, publicBid:i%4===0,
      negotiatedContractValue:cash(cost * (1.12 + random() * .18)), suffix:`PRESSURE-${String(i+1).padStart(4,'0')}`};
  });
}
export async function preparePressureVendors(h) {
  const vendors=[];
  for(let i=0;i<3;i++) vendors.push((await h.post('/api/procurement',{action:'create-prospective-vendor',scope:'Sales',legalName:`SYNTHETIC PRESSURE Bidder ${i+1}`,contactName:`Synthetic Bidder ${i+1}`,contactEmail:`pressure-bid-${i+1}@example.invalid`,trade:'Commercial Fit Out'},owner,201)).vendorId);
  return vendors;
}
async function reviewQuotes(h, fixture, vendors, opportunityId) {
  const scope=['Furnish commercial fit out materials','Install and commission complete systems','Protect occupied spaces and remove debris'];
  const current=h.row('MEFFORD-SALES',opportunityId).data;
  current.estimate.entries['0131.19'].subcontract=0;
  current.estimate.status='Draft';current.estimateStatus='In Progress';
  await h.save('MEFFORD-SALES','Sales Opportunities',opportunityId,'Estimating',current);
  const act=(action,fields={},status=200)=>h.post('/api/procurement',{action,scope:'Sales',...fields},owner,status);
  const pkg=await act('create-package',{opportunityId,title:`SYNTHETIC scope ${fixture.suffix}`,trade:'Commercial Fit Out',costCode:'0131.19',scopeDescription:scope.join('\n'),scopeNature:'Labor And Material',budgetAmount:fixture.cost,deadline:'2099-12-31T17:00:00Z'},201);
  for(let i=0;i<3;i++) {
    const price=cash(fixture.cost*[.8,1,1.15][i]),lines=i===0?scope.slice(0,2):scope;
    const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),page=pdf.addPage();
    const text=['SYNTHETIC TEST ONLY',`Project ${fixture.suffix}`,'Scope of Work:',...lines,'Exclusions:',i===0?scope[2]:'Permit fees paid by owner',`Grand Total: $${price.toFixed(2)}`];
    text.forEach((line,index)=>page.drawText(line,{x:40,y:760-index*24,font,size:10}));
    const bytes=await pdf.save();
    const extracted=extractQuoteFields(execFileSync('pdftotext',['-layout','-','-'],{input:bytes,encoding:'utf8'}));
    assert.equal(extracted.price,price);
    const form=new FormData();form.set('projectId',`ESTIMATE-${opportunityId}`);form.set('category','03-Estimating - Quotes');form.set('access','Internal Procurement');form.set('file',new File([bytes],`bid-${i}.pdf`,{type:'application/pdf'}));
    const uploaded=await h.post('/api/files',form,owner,201);
    await act('record-quote',{recordId:pkg.recordId,vendorId:vendors[i],quote:{fileId:uploaded.file.id,confirmed:true,reviewedPrice:price,reviewedScope:extracted.scope,extractedPrice:price,extractedScope:extracted.scope,characterCount:extracted.characterCount,exclusions:i===0?scope[2]:'Permit fees paid by owner',alternates:'None',clarifications:'Synthetic scope and lead time reviewed',schedule:'Six weeks',acknowledgedAddenda:[]}},201);
    await act('update-leveling',{recordId:pkg.recordId,vendorId:vendors[i],leveling:{scopeComplete:true,exclusionsReviewed:true,alternatesReviewed:true,clarificationsComplete:true,budgetCompared:true,leveledAmount:price,notes:'Synthetic independent scope and budget verification',scopeResolution:''}});
    assert.deepEqual(await h.send(`/api/files?id=${uploaded.file.id}`,{binary:true}),bytes);
  }
  const review=(await h.send('/api/procurement?scope=Sales')).packages.find(p=>p.id===pkg.recordId).review;
  assert.equal(review.lowestQuoted.vendorId,vendors[0]);assert.equal(review.recommended.vendorId,vendors[1]);
  await act('select-proposal-basis',{recordId:pkg.recordId,vendorId:vendors[0]},409);
  await act('select-proposal-basis',{recordId:pkg.recordId,vendorId:vendors[1]});
  await act('select-proposal-basis',{recordId:pkg.recordId,vendorId:vendors[1]});
  const selected=h.row('MEFFORD-SALES',opportunityId).data;
  assert.equal(selected.estimate.entries['0131.19'].subcontract,fixture.cost);
  await h.save('MEFFORD-SALES','Sales Opportunities',opportunityId,'Estimating',{...selected,estimate:{...selected.estimate,status:'Ready For Review',submittedAt:new Date().toISOString()},estimateStatus:'Ready For Review'});
}
async function wordRoundTrip({h,opportunityId,generated,proposalData,summary}) {
  await h.post('/api/proposals',{action:'save',opportunityId,packetType:'Construction Proposal',data:proposalData});
  const bytes=await h.send(`/api/proposals/document?opportunityId=${opportunityId}&recordId=${generated.record.id}&format=docx`,{binary:true});
  const files=unzipSync(bytes);let edited=false;
  files['word/document.xml']=strToU8(strFromU8(files['word/document.xml']).replace(/<w:sdt>[\s\S]*?<\/w:sdt>/g,block=>{
    if(!block.includes('w:val="meffcon:executiveSummary"'))return block;
    edited=true;return block.replace(/<w:sdtContent>[\s\S]*?<\/w:sdtContent>/,`<w:sdtContent><w:p><w:r><w:t>SYNTHETIC reviewed Word scope ${opportunityId}. Protect occupied spaces and remove debris.</w:t></w:r></w:p></w:sdtContent>`);
  }));assert.ok(edited);
  const form=new FormData();form.set('action','import-word');form.set('opportunityId',opportunityId);form.set('packetType','Construction Proposal');form.set('file',new File([zipSync(files)],'synthetic-edited-proposal.docx',{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}));
  const data=(await h.post('/api/proposals',form)).record.data;
  assert.ok(data.executiveSummary.includes(opportunityId));assert.equal(data.contractPrice,summary.contractValue);
  assert.ok(data.scopeSections.some(s=>s.description.includes('Protect occupied spaces')));
  return data;
}
async function completeTurnover(h,job) {
  const occurrenceId=h.runtime.database.one('SELECT occurrence_id FROM project_bonus_controls WHERE project_id=?',job.projectId).occurrence_id;
  const query=new URLSearchParams({projectId:'MEFFORD-COMPANY',meetingType:'Estimating To Operations Turnover',occurrenceId});
  const get=()=>h.send(`/api/meetings?${query}`,{actor:pm});
  let b=await get();
  assert.equal(b.turnover.packet.contractValue,job.fixture.negotiatedContractValue);
  assert.equal(b.turnover.packet.contractSigned,true);
  const act=(action,extra={})=>h.post('/api/meetings',{action,occurrenceId,expectedRevision:b.turnover.revision,...extra},pm);
  await act('turnover_schedule',{startAt:new Date().toISOString(),location:'SYNTHETIC test turnover'});
  for(const role of ['Chief Estimator','Director of Operations'])await act('add_attendee',{assigneeName:owner.name,assigneeEmail:owner.email,value:role});
  await act('add_attendee',{assigneeName:accountant.name,assigneeEmail:accountant.email,value:'Project Accountant'});
  await act('publish');await act('start');
  for(const [role,actor] of [['pm',pm],['superintendent',superintendent]]) {
    const bonus=(await h.send(`/api/project-bonuses?projectId=${job.projectId}`,{actor})).agreement;
    assert.equal(bonus.current.snapshot.budget,job.summary.originalBudget);
    await h.post('/api/project-bonuses',{action:'sign',projectId:job.projectId,id:bonus.current.id,version:bonus.current.version,role,hash:bonus.current.hash,signerName:actor.name,signatureImage:signature,consent:true},actor);
  }
  b=await get();
  for(const section of b.turnover.packet.sections){await act('turnover_review',{sectionKey:section.key,value:true});b=await get();}
  await act('turnover_accept');b=await get();assert.equal(b.turnover.status,'Accepted');
  const buyout=b.actions.find(a=>a.source_id==='buyout');assert.ok(buyout?.work_item_id);
  await act('action_status',{entityId:buyout.id,status:'Complete',evidence:'SYNTHETIC budget and procurement reconciliation complete'});
  await act('finish');
}
export async function runPressureJourney(h,fixture,vendors) {
  const before=h.calls();
  const job=await saleToExecutedContract(h,{...fixture,
    prepareEstimate:({opportunityId})=>reviewQuotes(h,fixture,vendors,opportunityId),
    prepareProposal:wordRoundTrip,
    afterContractSave:async({projectId})=>{
      const data=await h.send('/api/accounting',{actor:accountant});
      const row=data.projects.find(p=>p.number===projectId);
      assert.equal(row.currentContract,fixture.negotiatedContractValue);
    },
  },fixture.suffix);
  await completeTurnover(h,job);
  await runOperationsAndFinance(h,job);
  await runCloseout(h,job);
  assert.equal(h.outbound.length,0);
  return {id:fixture.suffix,projectId:job.projectId,contractType:fixture.type,pricing:fixture.pricing||'',publicBid:fixture.publicBid,cost:fixture.cost,proposalValue:job.summary.contractValue,executedContractValue:fixture.negotiatedContractValue,requests:h.calls()-before,passed:true};
}
