import assert from 'node:assert/strict';
import test from 'node:test';
import { harness, owner, pm, accountant, superintendent, today } from './support/project-workflow-harness.mjs';
import { F06_ACTORS, activateActor } from './support/f06-runtime-harness.mjs';
async function project(h,name){return (await h.post('/api/projects',{mode:'create',project:{name:`SYNTHETIC FULL AUDIT ${name}`,status:'Active',site:'100 Control Test Way, Lexington, KY 40507',ownerName:'Synthetic Audit Owner LLC',ownerContractDate:today,ownerContractType:'Plan & Spec Lump Sum',projectType:'Commercial',contractAmount:'1000000',startDate:today,substantialDate:'2027-05-01',finalDate:'2027-06-01',projectManager:pm.name,superintendent:superintendent.name}},owner,201)).project;}

test('operational audit: every native company and project workspace can load with its actual scope',async t=>{
 const h=await harness();try{
  const p=await project(h,'Workspace Read Coverage');
  const company=['session','accounting','accounting-controls','financial-reports','assets','vendors','company-calendar','employee-time','employee-resources','employee-goals','employee-lifecycle','onboarding','onboarding/documents','performance-reviews','marketing','review','my-work','integration-health','system-status','microsoft-access','schedule-templates','operating-doctrine','sales-team'];
  const scoped=['notifications','records','files','closeout','closeout/package','contracts','customer-survey-recipients','design-lifecycle','drawing-intelligence','meetings','procurement','project-bonuses','project-correspondence','project-health','purchase-orders','quality-control','safety','schedule-intelligence','selections','team-access','dashboard-preferences'];
  for(const path of company)await t.test(path,async()=>{await h.send(`/api/${path}`);});
  for(const path of scoped)await t.test(path,async()=>{await h.send(`/api/${path}?projectId=${p.number}`,{binary:path==='closeout/package'});});
  assert.equal(h.outbound.length,0);
 }finally{await h.close();}
});

test('operational audit: selection decision becomes a linked purchase order, project release and verified installation',async()=>{
 const h=await harness();try{
  const p=await project(h,'Selection Handoff'),projectId=p.number;
  const vendor=(await h.post('/api/vendors',{action:'create-vendor',legalName:'SYNTHETIC Selection Supplier',vendorType:'Vendor',contactName:'Test Supplier',contactEmail:'selection@example.invalid'},owner,201)).vendorId;
  await h.save(projectId,'Budget','BUD-0131.19','Active',{code:'0131.19',description:'Project management',originalBudget:10000,approvedChanges:0,committedCost:0,selectedForProject:true});
  const act=(action,fields={},actor=pm,status=200)=>h.post('/api/selections',{action,projectId,...fields},actor,status);
  const made=await act('create',{title:'SYNTHETIC Lobby Tile',category:'Finishes',location:'Lobby',description:'Synthetic porcelain flooring choice',responsibleName:'Synthetic Owner',installationDate:'2027-03-01',allowance:1000,quantity:10,options:[{id:'A',label:'Porcelain A',unitCost:100,leadDays:21}]},pm,201);
  const recordId=made.recordId;
  await act('update-procurement-row',{recordId,vendorId:vendor,costCode:'0131.19',materialDescription:'Porcelain A',quantity:10,unitCost:100,requiredDeliveryDate:'2027-02-20',unit:'EA'});
  await act('create-purchase-order',{recordId},pm,409);
  await act('issue',{recordId,distributionReference:'SYNTHETIC selection walkthrough'});
  assert.ok(h.runtime.database.one("SELECT id FROM command_work_items WHERE source_record_id=? AND status<>'Completed'",recordId));
  await act('record-decision',{recordId,selectedOptionId:'A',approverName:'Synthetic Owner',evidenceReference:'SYNTHETIC signed finish selection'});
  const first=await act('create-purchase-order',{recordId},pm,201),repeat=await act('create-purchase-order',{recordId});
  assert.equal(first.purchaseOrderId,repeat.purchaseOrderId);
  const po=h.row(projectId,first.purchaseOrderId);assert.equal(po.data.amount,1000);assert.equal(po.status,'Draft');
  await act('release',{recordId,releaseReference:'SYNTHETIC approved finish schedule'});
  await act('verify-installation',{recordId,installedAt:today,installedBy:superintendent.name,installationEvidence:'SYNTHETIC field photo verification'},superintendent);
  assert.equal(h.row(projectId,recordId).status,'Installed / Verified');
  assert.equal(h.outbound.length,0);
 }finally{await h.close();}
});

test('operational audit: safety incidents route accountable work and preserve human classification and closure',async()=>{
 const h=await harness();try{
  const projectId=(await project(h,'Safety Routing')).number;
  const made=await h.post('/api/safety',{action:'create-incident',projectId,personName:'SYNTHETIC Employee',incidentDate:today,incidentTime:'09:00',location:'Synthetic north access',description:'Synthetic near miss during a controlled training scenario.',immediateActions:'Synthetic area secured and supervisor notified.'},superintendent,201);
  const recordId=made.recordId;
  assert.ok(h.runtime.database.one("SELECT id FROM command_work_items WHERE source_record_id=? AND kind='Safety Incident Review'",recordId));
  await h.post('/api/safety',{action:'close-incident',projectId,recordId,correctiveActions:'Synthetic access lane inspected and cleared.',closureEvidence:'SYNTHETIC inspection'},pm,409);
  await h.post('/api/safety',{action:'classify-incident',projectId,recordId,classification:'Not Recordable',classificationNote:'SYNTHETIC exercise only; no actual injury or incident.'},superintendent,403);
  await h.post('/api/safety',{action:'classify-incident',projectId,recordId,classification:'Not Recordable',classificationNote:'SYNTHETIC exercise only; no actual injury or incident.'});
  await h.post('/api/safety',{action:'close-incident',projectId,recordId,correctiveActions:'Synthetic access lane inspected and cleared.',closureEvidence:'SYNTHETIC inspection'},pm);
  assert.equal(h.row(projectId,recordId).status,'Closed');
  assert.equal(h.runtime.database.one("SELECT COUNT(*) AS n FROM command_work_items WHERE source_record_id=? AND kind='Safety Incident Review' AND status<>'Completed'",recordId).n,0);
 }finally{await h.close();}
});

test('operational audit: equipment safety lock survives ordinary profile edits and check-in',async()=>{
 const h=await harness();try{
  const {assetId}=await h.post('/api/assets',{action:'create-asset',assetTag:'SYNTHETIC-SAFE-01',category:'Vehicle',description:'SYNTHETIC test truck',acquisitionCost:20000,homeLocation:'Synthetic yard'},owner,201);
  const act=(action,fields={},actor=owner,status=200)=>h.post('/api/assets',{action,assetId,...fields},actor,status);
  await act('assign',{assigneeEmail:superintendent.email});
  await act('inspection',{checks:{Brakes:'Fail'},notes:'SYNTHETIC brake defect for safety-control verification'},superintendent);
  await act('update-profile',{description:'SYNTHETIC test truck',category:'Vehicle',status:'Available'});
  assert.equal(h.row('MEFFORD-ASSETS',assetId).status,'Out Of Service','Profile edits must not bypass repair verification');
  await act('check-in',{currentLocation:'Synthetic yard'},superintendent);
  assert.equal(h.row('MEFFORD-ASSETS',assetId).status,'Out Of Service','Returning custody must not clear a safety lock');
  await act('assign',{assigneeEmail:superintendent.email},owner,400);
  await act('service',{workPerformed:'SYNTHETIC repair performed and inspected',amount:125});
  await act('return-to-service',{evidenceNote:'SYNTHETIC independent mechanical verification passed'});
  assert.equal(h.row('MEFFORD-ASSETS',assetId).status,'Available');
  await act('retire',{reason:'SYNTHETIC end of operational life'});
  await act('return-to-service',{evidenceNote:'SYNTHETIC accidental attempt to reactivate retired asset'},owner,409);
 }finally{await h.close();}
});

test('operational audit: drawing files, index and search keep project access aligned for a secondary PM',async()=>{
 const h=await harness();try{
  const projectId=(await project(h,'Drawing Access')).number;
  const secondary={...F06_ACTORS.employee,designations:['Project Manager']};await activateActor(h.runtime.database,secondary);
  await h.post('/api/team-access',{action:'save-designations',projectId,employeeEmail:secondary.email,scope:'project',designations:['Project Manager']});
  const form=new FormData();form.set('projectId',projectId);form.set('category','Drawings');form.set('file',new File(['%PDF-1.7\nSYNTHETIC drawing original'],'synthetic-A101.pdf',{type:'application/pdf'}));
  const file=await h.post('/api/files',form,secondary,201);
  const index=await h.post('/api/drawing-intelligence',{projectId,fileId:file.file.id,ocrText:'SYNTHETIC TEST ONLY\nA101\nFLOOR PLAN\nArchitectural\nREVISION 2\n2026-09-16',ocrStatus:'Synthetic reviewed extraction'},secondary,201);
  assert.ok(index.recordId);
  const drawings=await h.send(`/api/drawing-intelligence?projectId=${projectId}`,{actor:secondary});assert.equal(drawings.drawings.length,1);
  await h.post('/api/team-access',{action:'save-designations',projectId,employeeEmail:secondary.email,scope:'project',designations:[]});
  await h.send(`/api/drawing-intelligence?projectId=${projectId}`,{actor:secondary,expected:403});
 }finally{await h.close();}
});
