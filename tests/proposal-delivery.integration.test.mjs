import assert from 'node:assert/strict';
import test from 'node:test';
import { harness, owner, pm, today } from './support/project-workflow-harness.mjs';
import { newEstimateData } from '../app/estimate-template.ts';
import { sendOperationalEmail } from '../lib/operational-email.ts';

async function issuedProposal(h, suffix) {
  const id = `DELIVERY-CHECK-${suffix}`, contactId = `${id}-CONTACT`;
  await h.save('MEFFORD-SALES','Sales Contacts',contactId,'Active',{firstName:'Synthetic',lastName:'Owner',company:'Fictional Delivery Client',email:`delivery-${suffix}@example.invalid`,phone:'859-555-0100',address:'100 Example Way',city:'Lexington',state:'KY',postalCode:'40507'});
  const opportunity = {projectName:`Synthetic Delivery Check ${suffix}`,company:'Fictional Delivery Client',contactId,assignedRep:owner.name,assignedEstimator:owner.name,leadSource:'Existing Client',expectedAwardDate:today,targetStartDate:today,durationMonths:1,ownerContractType:'Plan & Spec Lump Sum',projectType:'Commercial',projectLocation:'100 Example Way, Lexington, KY 40507',projectAddress:'100 Example Way, Lexington, KY 40507',address:'100 Example Way',city:'Lexington',state:'KY',postalCode:'40507',stage:'Lead',projectDescription:'Furnish and install the complete interior office renovation.'};
  await h.save('MEFFORD-SALES','Sales Opportunities',id,'Lead',opportunity);
  const estimate = newEstimateData();estimate.entries['0131.19']={quantity:1,unit:'LS',material:0,labor:0,equipment:0,subcontract:80000,other:0};estimate.projectInputs.architecturalFeeOverride=0;estimate.projectInputs.projectDurationMonths=1;estimate.status='Ready For Review';estimate.submittedAt=new Date().toISOString();
  await h.save('MEFFORD-SALES','Sales Opportunities',id,'Estimating',{...opportunity,stage:'Estimating',estimate,estimateStatus:'Ready For Review'});
  await h.post('/api/owner-approvals',{action:'decide',approvalItemId:`estimate:MEFFORD-SALES:${id}`,decision:'Approved',note:'Fictional delivery fixture estimate checked.'});
  const generated=await h.post('/api/proposals',{action:'generate',opportunityId:id,packetType:'Construction Proposal'},owner,201);
  await h.post('/api/proposals',{action:'submit-review',opportunityId:id,packetType:'Construction Proposal',data:generated.record.data});
  await h.post('/api/owner-approvals',{action:'decide',approvalItemId:`owner-proposal:MEFFORD-SALES:${generated.record.id}`,decision:'Approved',note:'Fictional delivery fixture proposal checked.'});
  const issued=await h.post('/api/proposals',{action:'issue',opportunityId:id,packetType:'Construction Proposal'});
  const payload={action:'send-owner',opportunityId:id,packetType:'Construction Proposal',confirmedRecipient:`delivery-${suffix}@example.invalid`};
  return {id,record:issued.record,payload};
}

test('owner email protects issued bytes, waits after rate limits, rejects duplicates and preserves uncertain attempts', {timeout:90000},async()=>{
  const h=await harness(), blockedFetch=globalThis.fetch;
  try{
    const fixture=await issuedProposal(h,'safe');
    const setup=await h.send(`/api/proposals?opportunityId=${fixture.id}`);
    assert.equal(setup.deliveryConnection.configured,false);
    const deferred=await h.post('/api/proposals',fixture.payload);assert.equal(deferred.delivery.status,'Deferred');
    await h.post('/api/proposals',{...fixture.payload,confirmedRecipient:'wrong@example.invalid'},owner,400);
    await h.post('/api/proposals',fixture.payload,pm,403);
    h.runtime.env.OPERATIONAL_EMAIL_WEBHOOK_URL='https://delivery-test.example.invalid';
    let calls=0, sent=[];
    globalThis.fetch=async(url,options)=>{assert.equal(String(url),'https://delivery-test.example.invalid');calls++;assert.ok(options.signal);const payload=JSON.parse(options.body);sent.push(payload);return new Response(JSON.stringify({error:'Rate limited'}),{status:429,headers:{'content-type':'application/json','retry-after':'1'}});};
    const limited=await h.post('/api/proposals',fixture.payload);assert.equal(limited.delivery.status,'Retry');assert.equal(limited.delivery.safeToRetry,true);assert.ok(limited.delivery.retryAt);assert.equal(limited.delivery.providerStatus,429);
    await h.post('/api/proposals',fixture.payload,owner,429);assert.equal(calls,1);
    await new Promise(resolve=>setTimeout(resolve,1100));
    globalThis.fetch=async(url,options)=>{assert.equal(String(url),'https://delivery-test.example.invalid');calls++;sent.push(JSON.parse(options.body));return new Response(JSON.stringify({receiptId:'controlled-accepted-receipt'}),{status:202,headers:{'content-type':'application/json'}});};
    const accepted=await h.post('/api/proposals',fixture.payload);assert.equal(accepted.delivery.status,'Provider Accepted');assert.equal(accepted.delivery.receiptId,'controlled-accepted-receipt');assert.equal(sent[0].idempotencyKey,sent[1].idempotencyKey);
    const original=await h.runtime.bucket.get(fixture.record.data.issuedPdfKey);assert.deepEqual(Buffer.from(sent[1].attachments[0].base64,'base64'),Buffer.from(await original.arrayBuffer()));
    await h.post('/api/proposals',fixture.payload);assert.equal(calls,2,'Accepted send is not repeated');
    const revision=await h.post('/api/proposals',{action:'start-revision',opportunityId:fixture.id,packetType:'Construction Proposal'});
    assert.equal(revision.record.data.issuedSnapshots.at(-1).ownerDelivery.receiptId,'controlled-accepted-receipt');
    const guarded=await h.post('/api/proposals',{action:'save',opportunityId:fixture.id,packetType:'Construction Proposal',data:{...revision.record.data,revision:500,issuedSnapshots:[]}});
    assert.equal(guarded.record.data.revision,2);
    assert.equal(guarded.record.data.issuedSnapshots.at(-1).ownerDelivery.receiptId,'controlled-accepted-receipt','Editable fields cannot erase previous issued copies or delivery evidence');

    globalThis.fetch=blockedFetch;
    const interrupted=await issuedProposal(h,'uncertain');let attempts=0;
    globalThis.fetch=async()=>{attempts++;throw new Error('Synthetic network interruption after request dispatch');};
    const uncertain=await h.post('/api/proposals',interrupted.payload);assert.equal(uncertain.delivery.status,'Retry');assert.equal(uncertain.delivery.safeToRetry,false);
    await h.post('/api/proposals',interrupted.payload,owner,409);assert.equal(attempts,1);

    globalThis.fetch=blockedFetch;
    const concurrent=await issuedProposal(h,'concurrent');let release, entered;
    const providerEntered=new Promise(resolve=>entered=resolve), providerRelease=new Promise(resolve=>release=resolve);let submitted=0;
    globalThis.fetch=async()=>{submitted++;entered();await providerRelease;return new Response(JSON.stringify({receiptId:'single-concurrent-send'}),{status:202,headers:{'content-type':'application/json'}});};
    const first=h.post('/api/proposals',concurrent.payload);await providerEntered;
    try{
      await h.post('/api/proposals',concurrent.payload,owner,409);
      await h.post('/api/proposals',{action:'start-revision',opportunityId:concurrent.id,packetType:'Construction Proposal'},owner,409);
    }finally{release();}
    const finished=await first;assert.equal(finished.delivery.status,'Provider Accepted');assert.equal(submitted,1);assert.equal(h.row('MEFFORD-SALES',concurrent.record.id).data.ownerDelivery.receiptId,'single-concurrent-send');
  }finally{globalThis.fetch=blockedFetch;await h.close();}
});

test('mail adapter validates every address and distinguishes explicit rejection from an interrupted request',async()=>{
  const h=await harness(),blockedFetch=globalThis.fetch;
  const input={to:'valid@example.invalid',subject:'Synthetic',text:'Test only',idempotencyKey:'synthetic-mail-input'};
  try{
    const invalid=await sendOperationalEmail({...input,to:['valid@example.invalid','invalid address']});assert.equal(invalid.outcome,'Rejected');assert.equal(h.outbound.length,0);
    h.runtime.env.OPERATIONAL_EMAIL_WEBHOOK_URL='https://delivery-test.example.invalid';
    globalThis.fetch=async()=>new Response(JSON.stringify({error:'Sender not permitted'}),{status:403,headers:{'content-type':'application/json'}});
    const denied=await sendOperationalEmail(input);assert.equal(denied.outcome,'Rejected');assert.equal(denied.providerStatus,403);assert.equal(denied.acceptedAt,'');
    globalThis.fetch=async()=>{throw new DOMException('Synthetic request timed out','TimeoutError');};
    const timeout=await sendOperationalEmail(input);assert.equal(timeout.outcome,'Retry');assert.equal(timeout.providerStatus,0);assert.equal(timeout.acceptedAt,'');
  }finally{globalThis.fetch=blockedFetch;await h.close();}
});
