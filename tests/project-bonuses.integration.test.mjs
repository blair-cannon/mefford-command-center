import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync,readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harness,owner,pm,superintendent,signature,scenarios,saleToExecutedContract } from "./support/project-workflow-harness.mjs";
import { activateActor,F06_ACTORS } from "./support/f06-runtime-harness.mjs";
import { bonusTier,bonusPayoutMonth,BONUS_TIERS } from "../lib/project-bonuses.ts";
import { BONUS_DOCX_BASE64,BONUS_TEMPLATE_SHA256 } from "../lib/bonus-template.ts";

const get=async(h,id,actor=owner)=>(await h.send(`/api/project-bonuses?projectId=${encodeURIComponent(id)}`,{actor})).agreement;
const action=(h,b,action,payload={},actor=owner,expected=200)=>h.post("/api/project-bonuses",{projectId:b.projectId,id:b.current.id,version:b.current.version,action,...payload},actor,expected);
const sign=(h,b,role,actor,expected=200)=>action(h,b,"sign",{role,hash:b.current.hash,signerName:actor.name,signatureImage:signature,consent:true},actor,expected);
async function start(h,projectId){
  const occurrenceId=h.runtime.database.one("SELECT occurrence_id FROM project_bonus_controls WHERE project_id=?",projectId).occurrence_id;
  const query=new URLSearchParams({projectId:"MEFFORD-COMPANY",meetingType:"Estimating To Operations Turnover",occurrenceId});
  const bundle=await h.send(`/api/meetings?${query}`,{actor:pm});
  await h.post("/api/meetings",{action:"turnover_schedule",occurrenceId,expectedRevision:bundle.turnover.revision,startAt:new Date().toISOString(),location:"SYNTHETIC test turnover"},pm);
  await h.post("/api/meetings",{action:"publish",occurrenceId},pm);
  await h.post("/api/meetings",{action:"start",occurrenceId},pm);
  return occurrenceId;
}

test("exact source policy, all budget tiers and July/December periods preserve ambiguity instead of inventing compensation",()=>{
  const original=readFileSync(new URL("../assets/templates/mefford-bonus-original.docx",import.meta.url));
  assert.equal(createHash("sha256").update(original).digest("hex"),BONUS_TEMPLATE_SHA256);
  assert.deepEqual(Buffer.from(BONUS_DOCX_BASE64,"base64"),original);
  assert.equal(bonusTier(500000),-1);assert.equal(bonusTier(250000.50),-1);assert.equal(bonusTier(0),-1);
  for(const [index,budget] of [100000,300000,750000,2000000,4000000,7500000,15000000].entries())assert.equal(bonusTier(budget),index);
  for(let i=1;i<=100;i++){const budget=i*130019.21,tier=bonusTier(budget);assert.ok(tier>=0);assert.ok(BONUS_TIERS[tier].superintendent>0);}
  assert.equal(bonusPayoutMonth("2026-01-31"),"2026-07");assert.equal(bonusPayoutMonth("2026-08-01"),"2026-12");assert.equal(bonusPayoutMonth("2026-02-30"),"");
});

test("real turnover signatures are role-bound, revision-bound, stored as immutable project files and withheld from the external owner",async()=>{
  const h=await harness();try{
    const job=await saleToExecutedContract(h,scenarios[0],"BONUS-SIGN"),id=job.projectId;
    let b=await get(h,id,pm);assert.equal(b.current.snapshot.budget,job.summary.originalBudget);assert.equal(b.current.snapshot.pm.email,pm.email);assert.equal(b.current.snapshot.superintendent.email,superintendent.email);
    await sign(h,b,"pm",pm,409);await start(h,id);
    await sign(h,b,"pm",owner,403);
    const before=h.runtime.database.one("SELECT COUNT(*) AS n FROM project_files WHERE category='Turnover Bonus Agreement'").n;
    h.runtime.bucket.injectFailure({operation:"put",keyPattern:/\.pdf$/});await sign(h,b,"pm",pm,503);
    assert.equal(h.runtime.database.one("SELECT pm_signature_json FROM project_bonus_agreements WHERE id=?",b.current.id).pm_signature_json,"null");
    h.runtime.database.injectFailure({pattern:/INSERT INTO project_files/});await sign(h,b,"pm",pm,503);
    assert.equal(h.runtime.database.one("SELECT COUNT(*) AS n FROM project_files WHERE category='Turnover Bonus Agreement'").n,before);
    await sign(h,b,"pm",pm);const stale=b;b=await get(h,id,superintendent);assert.ok(b.current.signatures.pm);assert.ok(b.current.fileId);
    await sign(h,stale,"superintendent",superintendent,409);
    await action(h,b,"sign",{role:"superintendent",hash:b.current.hash,signerName:superintendent.name,signatureImage:signature,consent:false},superintendent,400);
    await sign(h,b,"superintendent",superintendent);b=await get(h,id);assert.ok(b.current.signatures.pm&&b.current.signatures.superintendent);
    const fileId=b.current.fileId,bytes=await h.send(`/api/files?id=${fileId}`,{actor:pm,binary:true});assert.equal(Buffer.from(bytes).subarray(0,4).toString(),"%PDF");
    await h.send(`/api/project-owner/files?id=${fileId}`,{actor:null,headers:job.ownerHeaders,expected:403});
    const text=execFileSync("pdftotext",["-","-"],{input:bytes,encoding:"utf8"});assert.match(text,/zero outside-reported OSHA violations/);assert.match(text,/paid out twice per year/);assert.match(text,/More Than 6 Weeks Beyond Schedule/);assert.match(text,/Turnover agreement signature record/);assert.match(text,/SYNTHETIC TEST ONLY/);assert.match(text,new RegExp(pm.email));
    writeFileSync(join(tmpdir(),"bonus-verified-signed.pdf"),bytes);
    const originalCopy=await h.send(`/api/project-bonuses?projectId=${id}&document=original`,{binary:true});assert.deepEqual(Buffer.from(originalCopy),Buffer.from(BONUS_DOCX_BASE64,"base64"));
    const artifacts=h.runtime.database.query("SELECT id,storage_key FROM project_files WHERE project_id=? AND category='Turnover Bonus Agreement'",id);assert.equal(artifacts.length,2);assert.notEqual(artifacts[0].storage_key,artifacts[1].storage_key);
    assert.equal(h.outbound.length,0);
  }finally{await h.close();}
});

test("replacement after turnover creates a real new meeting, keeps former employees' signed evidence and blocks stale signers",async()=>{
  const h=await harness();try{
    const job=await saleToExecutedContract(h,scenarios[0],"BONUS-REPLACE"),id=job.projectId,meetingId=await start(h,id);
    let b=await get(h,id);await sign(h,b,"pm",pm);b=await get(h,id);await sign(h,b,"superintendent",superintendent);b=await get(h,id);
    const oldId=b.current.id,oldFile=b.current.fileId,oldBytes=await h.send(`/api/files?id=${oldFile}`,{binary:true});
    // This fixture represents an already finalized meeting; its minutes must never be edited during employee replacement.
    h.runtime.database.sqlite.prepare("UPDATE meeting_occurrences SET status='Finalized/Distributed',minutes_summary='SYNTHETIC frozen original minutes' WHERE id=?").run(meetingId);
    const replacement={...F06_ACTORS.projectManager,name:"SYNTHETIC Replacement PM",email:"replacement-pm@example.invalid"};
    h.runtime.database.sqlite.prepare("INSERT INTO company_members (email,display_name,company_access_level,designations_json,is_active) VALUES (?,?,'Employee','[\"Project Manager\"]',1)").run(replacement.email,replacement.name);
    await activateActor(h.runtime.database,replacement);
    await action(h,b,"revise",{pmEmail:replacement.email,effectiveDate:"2026-09-16",reason:"SYNTHETIC original PM left employment; replacement assigned"});
    let replacementView=await get(h,id,replacement);assert.equal(replacementView.current.snapshot.pm.email,replacement.email);assert.equal(replacementView.current.signatures.pm,null);assert.equal(replacementView.history.find(r=>r.id===oldId).fileId,oldFile);
    await sign(h,replacementView,"pm",pm,403);await sign(h,replacementView,"pm",replacement,409);
    await action(h,replacementView,"start-replacement");replacementView=await get(h,id,replacement);assert.equal(replacementView.meetingActive,true);
    const secondMeeting=h.runtime.database.one("SELECT occurrence_id FROM project_bonus_controls WHERE project_id=?",id).occurrence_id;assert.notEqual(secondMeeting,meetingId);
    const bundle=await h.send(`/api/meetings?${new URLSearchParams({projectId:"MEFFORD-COMPANY",meetingType:"Estimating To Operations Turnover",occurrenceId:secondMeeting})}`);assert.equal(bundle.bonusProjectId,id);
    await sign(h,replacementView,"pm",replacement);replacementView=await get(h,id);await sign(h,replacementView,"superintendent",superintendent);
    assert.equal(h.runtime.database.one("SELECT minutes_summary FROM meeting_occurrences WHERE id=?",meetingId).minutes_summary,"SYNTHETIC frozen original minutes");
    assert.deepEqual(await h.send(`/api/files?id=${oldFile}`,{binary:true}),oldBytes);
    assert.equal(h.runtime.database.one("SELECT COUNT(*) AS n FROM command_work_items WHERE source_type='Project Bonus' AND recipient_email=? AND status<>'Completed'",pm.email).n,0);
    assert.equal(h.outbound.length,0);
  }finally{await h.close();}
});

test("source changes after a signature require a new revision; missing budget and ambiguous bands cannot be signed",async()=>{
  const h=await harness();try{
    const {projectId:id}=await saleToExecutedContract(h,scenarios[0],"BONUS-BASELINE");await start(h,id);let b=await get(h,id);await sign(h,b,"pm",pm);
    h.runtime.database.sqlite.prepare("UPDATE projects SET final_date='2026-12-15' WHERE number=?").run(id);
    b=await get(h,id);assert.equal(b.sourceChanged,true);await sign(h,b,"superintendent",superintendent,409);
    await action(h,b,"revise",{budget:500000,reason:"SYNTHETIC revised approved project cost baseline",effectiveDate:"2026-09-16"});b=await get(h,id);assert.ok(b.missing.includes("Company Owner bonus-tier decision"));await sign(h,b,"pm",pm,409);
    await action(h,b,"revise",{budget:500000,tier:2,reason:"SYNTHETIC Owner explicitly chose overlapping 500000 tier",effectiveDate:"2026-09-16"});b=await get(h,id);assert.equal(b.current.snapshot.pmBonus,2000);assert.equal(b.current.snapshot.superintendentBonus,4000);assert.equal(b.sourceChanged,false);
    assert.ok(b.history.some(r=>r.signatures.pm));await sign(h,b,"pm",pm);
    assert.equal(h.outbound.length,0);
  }finally{await h.close();}
});
