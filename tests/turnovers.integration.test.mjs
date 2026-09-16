import test from "node:test";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { harness, owner, pm, accountant, scenarios, saleToExecutedContract } from "./support/project-workflow-harness.mjs";
import { SALES_TURNOVER, OPS_TURNOVER, turnoverBuyoutDate } from "../lib/turnovers.ts";
import { activateActor, F06_ACTORS } from "./support/f06-runtime-harness.mjs";

const bundle = (h,type,id,actor=owner) => h.send(`/api/meetings?${new URLSearchParams({ projectId:"MEFFORD-COMPANY",meetingType:type,...(id ? {occurrenceId:id} : {}) })}`,{actor});
const act = (h,b,action,extra={},actor=owner,expected=200) => h.post("/api/meetings",{action,occurrenceId:b.selectedOccurrenceId,expectedRevision:b.turnover.revision,...extra},actor,expected);
const source = (id,extra={}) => ({projectName:`SYNTHETIC Turnover ${id}`,company:"SYNTHETIC Public Owner",leadSource:"Public Bid",assignedRep:owner.name,assignedEstimator:owner.name,expectedAwardDate:"2026-10-01",stage:"Estimating",projectDescription:"SYNTHETIC scope: renovate public library",...extra});

test("100 estimating handoffs create one living meeting each, permit public bids without contacts, and recover without duplicates", async () => {
  const h = await harness();
  try {
    for (let i=0;i<100;i++) await h.save("MEFFORD-SALES","Sales Opportunities",`SYNTHETIC-TURN-${i}`,"Estimating",source(i));
    assert.equal(h.runtime.database.one("SELECT COUNT(*) AS n FROM meeting_turnovers WHERE meeting_type = ?",SALES_TURNOVER).n,100);
    assert.equal(h.runtime.database.one("SELECT COUNT(*) AS n FROM meeting_series WHERE meeting_type = ?",SALES_TURNOVER).n,100);
    let b = await bundle(h,SALES_TURNOVER);
    const id = b.selectedOccurrenceId, original = b.turnover.revision;
    assert.equal(b.turnover.packet.gaps.some(g=>g.key==="contact"),false);
    assert.equal(b.agenda.filter(r=>r.source_type==="Turnover Source").length,7);
    await act(h,b,"add_agenda",{title:"SYNTHETIC owner promise",sectionKey:"scope",notes:"Preserve existing carpet"});
    const opportunityId = b.turnover.packet.opportunityId;
    await h.save("MEFFORD-SALES","Sales Opportunities",opportunityId,"Estimating",{...h.row("MEFFORD-SALES",opportunityId).data,projectDescription:"SYNTHETIC revised scope: carpet replacement"});
    b = await bundle(h,SALES_TURNOVER,id);
    assert.ok(b.turnover.revision>original);
    assert.ok(b.agenda.some(r=>r.notes==="Preserve existing carpet"));
    assert.match(b.turnover.packet.sections.find(s=>s.key==="scope").content,/carpet replacement/);
    await bundle(h,SALES_TURNOVER,id);
    assert.equal(h.runtime.database.one("SELECT COUNT(*) AS n FROM meeting_turnovers").n,100);
    assert.equal(h.outbound.length,0,"Internal preparation never sends invitations or external notices");
  } finally { await h.close(); }
});

test("receiver review, revision checks and meeting controls prevent accidental turnover acceptance", async () => {
  const h = await harness();
  try {
    await h.save("MEFFORD-SALES","Sales Opportunities","SYNTHETIC-ACCEPT","Estimating",source("accept"));
    let b = await bundle(h,SALES_TURNOVER);
    await act(h,b,"turnover_accept",{},owner,409);
    await act(h,b,"turnover_schedule",{startAt:new Date().toISOString(),location:"SYNTHETIC conference room"});
    await act(h,b,"publish"); await act(h,b,"start");
    b = await bundle(h,SALES_TURNOVER,b.selectedOccurrenceId);
    for (const section of b.turnover.packet.sections) {
      await act(h,b,"turnover_review",{sectionKey:section.key,value:true});
      b = await bundle(h,SALES_TURNOVER,b.selectedOccurrenceId);
    }
    await act(h,b,"turnover_accept",{expectedRevision:b.turnover.revision-1},owner,409);
    await act(h,b,"turnover_accept");
    b = await bundle(h,SALES_TURNOVER,b.selectedOccurrenceId);
    assert.equal(b.turnover.status,"Accepted");
    assert.equal(h.runtime.database.one("SELECT status FROM meeting_action_items WHERE source_id='acceptance' AND series_id = ?",b.turnover.id).status,"Complete");
    const accepted = h.runtime.database.one("SELECT accepted_snapshot_json FROM meeting_turnovers WHERE id = ?",b.turnover.id).accepted_snapshot_json;
    await h.save("MEFFORD-SALES","Sales Opportunities","SYNTHETIC-ACCEPT","Estimating",{...h.row("MEFFORD-SALES","SYNTHETIC-ACCEPT").data,projectDescription:"SYNTHETIC materially changed scope"});
    b = await bundle(h,SALES_TURNOVER,b.selectedOccurrenceId);
    assert.equal(b.turnover.status,"Changes Require Review"); assert.equal(b.turnover.reviewed.length,0);
    assert.equal(h.runtime.database.one("SELECT accepted_snapshot_json FROM meeting_turnovers WHERE id = ?",b.turnover.id).accepted_snapshot_json,accepted);
    assert.notEqual(h.runtime.database.one("SELECT status FROM meeting_action_items WHERE source_id='acceptance' AND series_id = ?",b.turnover.id).status,"Complete");
  } finally { await h.close(); }
});

test("award builds the template's eleven sections, current contract value and buyout work without unlocking unsigned billing", async () => {
  const h = await harness();
  try {
    let occurrenceId;
    await saleToExecutedContract(h,{...scenarios[0],negotiatedContractValue:318400,
      afterAward:async ({projectId}) => {
        const b = await bundle(h,OPS_TURNOVER); occurrenceId = b.selectedOccurrenceId;
        assert.equal(b.turnover.packet.projectId,projectId);
        assert.equal(b.turnover.packet.sections.length,11);
        assert.equal(b.turnover.packet.contractSigned,false);
        assert.ok(b.turnover.packet.gaps.some(g=>g.key==="authority"));
        await act(h,b,"turnover_accept",{},owner,403,"Sender cannot accept for PM");
        await act(h,b,"turnover_ntp",{reason:"SYNTHETIC NTP test authority"},pm,403);
        await act(h,b,"turnover_ntp",{reason:"SYNTHETIC NTP 2026-09-16; internal turnover preparation only"});
        const ntp = await bundle(h,OPS_TURNOVER,occurrenceId);
        assert.equal(ntp.turnover.packet.gaps.some(g=>g.key==="authority"),false);
        assert.equal(ntp.turnover.packet.contractSigned,false);
        assert.equal((await h.send("/api/projects")).projects.find(p=>p.number===projectId).contractAuthorized,false);
        await h.save(projectId,"Owner Billing Setup","OWNER-BILLING-SETUP","Locked",{sovLines:[{id:"SOV-1",scheduledValue:100}]},owner,409);
      },
      afterContractSave:async () => {
        const b = await bundle(h,OPS_TURNOVER,occurrenceId);
        assert.equal(b.turnover.packet.contractValue,318400);
        assert.equal(b.turnover.packet.contractSigned,false);
      },
    },"TURNOVER");
    let b = await bundle(h,OPS_TURNOVER,occurrenceId,pm);
    assert.equal(b.turnover.packet.contractSigned,true);
    assert.equal(b.turnover.packet.gaps.some(g=>g.key==="authority"),false);
    await act(h,b,"turnover_schedule",{startAt:new Date().toISOString(),location:"SYNTHETIC jobsite"},pm);
    await act(h,b,"publish",{},pm); await act(h,b,"start",{},pm);
    b = await bundle(h,OPS_TURNOVER,occurrenceId,pm);
    const buyout = b.actions.find(a=>a.source_id==="buyout");
    assert.ok(buyout?.work_item_id);
    assert.equal(buyout.due_at.slice(0,10),b.turnover.buyoutDue);
    await act(h,b,"action_status",{entityId:buyout.id,status:"Complete",evidence:"SYNTHETIC completed buyout"},pm);
    b = await bundle(h,OPS_TURNOVER,occurrenceId,pm);
    assert.equal(b.actions.find(a=>a.id===buyout.id).status,"Complete");
    const pdf = await h.send(`/api/meetings/document?occurrenceId=${encodeURIComponent(occurrenceId)}&kind=agenda`,{actor:pm,binary:true});
    assert.equal(Buffer.from(pdf).subarray(0,4).toString(),"%PDF");
    const printed = execFileSync("pdftotext",["-layout","-","-"],{input:Buffer.from(pdf),encoding:"utf8"});
    assert.match(printed,/318,400/); assert.match(printed,/Scope Responsibility Matrix/); assert.match(printed,/PM hours/);
    assert.ok(b.attachments.length,"Source files are available from the turnover meeting");
    for (const role of ["Chief Estimator","Director of Operations"]) await act(h,b,"add_attendee",{assigneeName:owner.name,assigneeEmail:owner.email,value:role},pm);
    b = await bundle(h,OPS_TURNOVER,occurrenceId,pm);
    assert.equal(b.turnover.packet.gaps.some(g=>["chief-estimator","ops-director"].includes(g.key)),false);
    await h.send(`/api/meetings?${new URLSearchParams({projectId:"MEFFORD-COMPANY",meetingType:SALES_TURNOVER,occurrenceId})}`,{actor:accountant,expected:403});
  } finally { await h.close(); }
});

test("buyout deadline is thirty calendar days across month, year, leap-day and DST boundaries", () => {
  assert.equal(turnoverBuyoutDate("2026-12-20T17:00:00Z"),"2027-01-19");
  assert.equal(turnoverBuyoutDate("2028-02-01T17:00:00Z"),"2028-03-02");
  assert.equal(turnoverBuyoutDate("2026-03-01T03:00:00Z"),"2026-03-30");
  assert.equal(turnoverBuyoutDate("2026-10-20T16:00:00Z"),"2026-11-19");
});

test("an interrupted source handoff is recoverable, and reassignment moves the task and acceptance to the new estimator", async () => {
  const h = await harness();
  try {
    const estimator = {...F06_ACTORS.employee,designations:["Estimator"]};
    await activateActor(h.runtime.database,estimator);
    h.runtime.database.injectFailure({pattern:/INSERT OR IGNORE INTO meeting_series/,once:true});
    await h.save("MEFFORD-SALES","Sales Opportunities","SYNTHETIC-RECOVER","Estimating",source("recover"));
    assert.ok(h.row("MEFFORD-SALES","SYNTHETIC-RECOVER"));
    assert.notEqual(h.runtime.database.one("SELECT status FROM domain_events WHERE id='sales-turnover:SYNTHETIC-RECOVER'").status,"Completed");
    let b = await bundle(h,SALES_TURNOVER);
    assert.equal(b.turnover.packet.opportunityId,"SYNTHETIC-RECOVER");
    const previousWork = b.actions.find(a=>a.source_id==="acceptance").work_item_id;
    await h.save("MEFFORD-SALES","Sales Opportunities","SYNTHETIC-RECOVER","Estimating",{...h.row("MEFFORD-SALES","SYNTHETIC-RECOVER").data,assignedEstimator:estimator.name});
    b = await bundle(h,SALES_TURNOVER,b.selectedOccurrenceId,estimator);
    assert.equal(b.turnover.canAccept,true);
    const action = b.actions.find(a=>a.source_id==="acceptance");
    assert.equal(action.assignee_email,estimator.email);
    assert.equal(h.runtime.database.one("SELECT recipient_email FROM command_work_items WHERE id = ?",action.work_item_id).recipient_email,estimator.email);
    assert.equal(h.runtime.database.one("SELECT status FROM command_work_items WHERE id = ?",previousWork).status,"Completed");
    await h.post("/api/my-work",{action:"complete",itemId:previousWork},owner,409);
    assert.notEqual(h.runtime.database.one("SELECT status FROM meeting_action_items WHERE id = ?",action.id).status,"Complete");
    assert.equal(h.runtime.database.one("SELECT COUNT(*) n FROM notification_delivery_events WHERE work_item_id = ? AND status = 'Queued'",previousWork).n,0);
    const ownerBundle = await bundle(h,SALES_TURNOVER,b.selectedOccurrenceId);
    assert.equal(ownerBundle.turnover.canAccept,false,"Company owner does not silently accept for the named estimator");
    await act(h,ownerBundle,"turnover_review",{sectionKey:"control",value:true},owner,403);
    assert.equal(h.runtime.database.one("SELECT COUNT(*) n FROM meeting_turnovers WHERE opportunity_id = 'SYNTHETIC-RECOVER'").n,1);
  } finally { await h.close(); }
});

test("turnover blockers feed the right departmental agenda without being sent to owner or subcontractor meetings", async () => {
  const h = await harness();
  try {
    await h.save("MEFFORD-SALES","Sales Opportunities","SYNTHETIC-ROUTING","Estimating",source("routing"));
    const created = await h.post("/api/meetings",{action:"create_series",meetingType:"Sales/Estimating Department",title:"SYNTHETIC Sales review",startAt:new Date(Date.now()+86400000).toISOString(),syncMicrosoft:false});
    const sales = await bundle(h,"Sales/Estimating Department",created.occurrenceId);
    assert.ok(sales.agenda.some(a=>a.source_type==="Automatic Agenda" && a.section_key==="handoff" && a.title.includes("turnover")));
    const opsMeeting = await h.post("/api/meetings",{action:"create_series",meetingType:"Operations Department",title:"SYNTHETIC Ops review",startAt:new Date(Date.now()+86400000).toISOString(),syncMicrosoft:false});
    const ops = await bundle(h,"Operations Department",opsMeeting.occurrenceId);
    assert.equal(ops.agenda.some(a=>a.title.includes("SYNTHETIC-ROUTING")),false);
  } finally { await h.close(); }
});
