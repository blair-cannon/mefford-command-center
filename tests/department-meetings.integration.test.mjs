import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { harness, owner, pm, accountant } from "./support/project-workflow-harness.mjs";
import { activateActor, F06_ACTORS } from "./support/f06-runtime-harness.mjs";

const day = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0,10);
const sales = { ...F06_ACTORS.employee, designations: ["Estimator"] };
const path = (type, id) => `/api/meetings?${new URLSearchParams({ projectId: "MEFFORD-COMPANY", meetingType: type, occurrenceId: id })}`;
const create = (h, type = "Operations Department", extra = {}) => h.post("/api/meetings", { action: "create_series", meetingType: type, title: `SYNTHETIC ${type}`, startAt: `${day(1)}T14:00:00Z`, syncMicrosoft: false, ...extra });
const mutation = (h, id, action, extra = {}, actor = owner, expected = 200) => h.post("/api/meetings", { occurrenceId: id, action, ...extra }, actor, expected);
const topicRow = (h, id) => h.runtime.database.one("SELECT * FROM meeting_agenda_items WHERE id = ?", id);
const pdfText = bytes => execFileSync("pdftotext", ["-layout", "-", "-"], { input: Buffer.from(bytes), encoding: "utf8" });

test("all three departments accept editable participant requests and only designated managers may remove them", async () => {
  const h = await harness();
  try {
    await activateActor(h.runtime.database, sales);
    await activateActor(h.runtime.database, F06_ACTORS.blain);
    for (const [type, participant] of [["Sales/Estimating Department",sales],["Operations Department",pm],["Accounting Department",accountant]]) {
      const meeting = await create(h,type, { attendees: [{ name: participant.name, email: participant.email }] });
      const requested = await mutation(h,meeting.occurrenceId,"add_agenda", { title: "SYNTHETIC requested discussion", notes: "Original details", sectionKey: "previous-todos", timeboxMinutes: 6 },participant);
      let item = topicRow(h,requested.id);
      assert.equal(item.status,"Requested");
      assert.equal(JSON.parse(item.source_version).requestedByEmail,participant.email);
      await mutation(h,meeting.occurrenceId,"update_agenda", { entityId: item.id, expectedVersion: item.updated_at, title: "SYNTHETIC updated request", notes: "Revised details", sectionKey: "conclusion", timeboxMinutes: 7 },participant);
      item = topicRow(h,item.id);
      assert.equal(item.notes,"Revised details"); assert.equal(item.section_key,"conclusion");
      await mutation(h,meeting.occurrenceId,"remove_agenda", { entityId: item.id, expectedVersion: item.updated_at, reason: "Not authorized" },participant,403);
      await mutation(h,meeting.occurrenceId,"update_agenda", { entityId: item.id, expectedVersion: item.updated_at, status: "Complete" },participant,403);
      if (type !== "Accounting Department") await mutation(h,meeting.occurrenceId,"remove_agenda", { entityId: item.id, expectedVersion: item.updated_at, reason: "IT is not designated" },F06_ACTORS.blain,403);
      let bundle = await h.send(path(type,meeting.occurrenceId));
      await mutation(h,meeting.occurrenceId,"agenda_settings", { selection: bundle.agendaConfiguration.selection, managerEmails: [participant.email], expectedAccess: bundle.agendaConfiguration.expectedAccess, reason: "Owner designates this meeting participant" });
      bundle = await h.send(path(type,meeting.occurrenceId),{ actor: participant });
      assert.equal(bundle.permissions.canManageAgenda,true);
      item = topicRow(h,item.id);
      await mutation(h,meeting.occurrenceId,"remove_agenda", { entityId: item.id, expectedVersion: item.updated_at },participant,400);
      await mutation(h,meeting.occurrenceId,"remove_agenda", { entityId: item.id, expectedVersion: item.updated_at, reason: "Moved into a separate work item" },participant);
      item = topicRow(h,item.id);
      assert.equal(item.status,"Removed"); assert.equal(item.notes,"Revised details");
      assert.ok(h.runtime.database.one("SELECT id FROM meeting_audits WHERE entity_id = ? AND action = 'Topic Removed' AND reason = ?",item.id,"Moved into a separate work item"));
      await mutation(h,meeting.occurrenceId,"restore_agenda", { entityId: item.id, expectedVersion: item.updated_at, reason: "Discussion still needed" },participant);
      assert.equal(topicRow(h,item.id).status,"Requested");
    }
    assert.equal(h.outbound.length,0);
  } finally { await h.close(); }
});

test("manual topics carry forward once, retain notes, stop after closure, and reject stale or cross-meeting edits", async () => {
  const h = await harness();
  try {
    const first = await create(h);
    const topic = await mutation(h,first.occurrenceId,"add_agenda", { title: "SYNTHETIC unresolved crew planning", notes: "Original discussion", sectionKey: "schedule" },pm);
    let item = topicRow(h,topic.id);
    const concurrent = await Promise.allSettled(["First updated notes","Second updated notes"].map(notes => mutation(h,first.occurrenceId,"update_agenda",{ entityId: item.id, expectedVersion: item.updated_at, notes },pm)));
    assert.equal(concurrent.filter(result => result.status === "fulfilled").length,1);
    const keptNotes = topicRow(h,item.id).notes;
    const second = await h.post("/api/meetings",{ action: "create_occurrence", seriesId: first.seriesId, startAt: `${day(8)}T14:00:00Z` });
    await mutation(h,second.occurrenceId,"refresh_agenda");
    let bundle = await h.send(path("Operations Department",second.occurrenceId));
    const carried = bundle.agenda.filter(row => row.source_type === "User Submitted" && row.source_id === topic.id);
    assert.equal(carried.length,1); assert.equal(carried[0].notes,keptNotes);
    await mutation(h,second.occurrenceId,"update_agenda",{ entityId: topic.id, expectedVersion: item.updated_at, notes: "Wrong meeting" },owner,404);
    await mutation(h,second.occurrenceId,"update_agenda",{ entityId: carried[0].id, expectedVersion: carried[0].updated_at, status: "Complete" });
    const third = await h.post("/api/meetings",{ action: "create_occurrence", seriesId: first.seriesId, startAt: `${day(15)}T14:00:00Z` });
    bundle = await h.send(path("Operations Department",third.occurrenceId));
    assert.equal(bundle.agenda.filter(row => row.source_type === "User Submitted").length,0);
    assert.equal(topicRow(h,topic.id).notes,keptNotes,"Later meetings do not overwrite earlier discussions");
  } finally { await h.close(); }
});

test("selected dashboard and scorecard sources update during department meetings and freeze for minutes", async () => {
  const h = await harness();
  try {
    await h.runtime.database.prepare(`INSERT INTO command_records (project_id,id,record_type,title,owner,due,status,data_json) VALUES ('MEFFORD-COMPANY','SYNTHETIC-SCORE','Scorecard Metrics','SYNTHETIC Weekly Inspections',?,'','Active',?)`).bind(owner.name,JSON.stringify({ actual: 2, target: 9, unit: "Inspections" })).run();
    const meeting = await create(h);
    let bundle = await h.send(path("Operations Department",meeting.occurrenceId));
    const settings = { ...bundle.agendaConfiguration.selection, sections: [], metrics: ["quality-open"], scorecards: ["MEFFORD-COMPANY:Scorecard Metrics:SYNTHETIC-SCORE"] };
    await mutation(h,meeting.occurrenceId,"agenda_settings",{ selection: settings, expectedAccess: bundle.agendaConfiguration.expectedAccess, reason: "Choose this department's scorecard" });
    bundle = await h.send(path("Operations Department",meeting.occurrenceId),{actor:pm});
    let signals = bundle.agenda.filter(row => row.source_type === "Automatic Agenda");
    assert.equal(signals.length,2); assert.ok(signals.some(row => row.source_reason.includes("Actual 2")));
    assert.equal(bundle.agenda.filter(row => row.source_type === "Standard Section").length,8,"Manual discussion sections are retained");
    const removed = signals.find(row => JSON.parse(row.source_version).metric);
    await mutation(h,meeting.occurrenceId,"remove_agenda",{ entityId: removed.id, expectedVersion: removed.updated_at, reason: "This measure is not needed at this meeting" });
    await mutation(h,meeting.occurrenceId,"refresh_agenda");
    assert.equal(topicRow(h,removed.id).status,"Removed");
    assert.equal(JSON.parse(topicRow(h,removed.id).source_version).removalReason,"This measure is not needed at this meeting");
    await mutation(h,meeting.occurrenceId,"publish");
    await mutation(h,meeting.occurrenceId,"start");
    await h.runtime.database.prepare("UPDATE command_records SET data_json = ?, updated_at = ? WHERE id = 'SYNTHETIC-SCORE'").bind(JSON.stringify({ actual: 6, target: 9 }),new Date().toISOString()).run();
    bundle = await h.send(path("Operations Department",meeting.occurrenceId),{actor:pm});
    assert.ok(bundle.agenda.some(row => row.source_reason.includes("Actual 6"))); assert.equal(bundle.refresh.frozen,false);
    await mutation(h,meeting.occurrenceId,"finish");
    await h.runtime.database.prepare("UPDATE command_records SET data_json = ? WHERE id = 'SYNTHETIC-SCORE'").bind(JSON.stringify({ actual: 7, target: 9 })).run();
    bundle = await h.send(path("Operations Department",meeting.occurrenceId));
    assert.ok(bundle.agenda.some(row => row.source_reason.includes("Actual 6"))); assert.equal(bundle.refresh.frozen,true);
  } finally { await h.close(); }
});

test("draft and published agendas print current topics and values, paginate long notes, and retain earlier PDF copies", async () => {
  const h = await harness();
  try {
    const meeting = await create(h);
    const initial = await mutation(h,meeting.occurrenceId,"add_agenda", { title: "SYNTHETIC first printable topic", notes: "Discussion before publication.", sectionKey: "schedule" },pm);
    let pdf = await h.send(`/api/meetings/document?occurrenceId=${meeting.occurrenceId}&kind=agenda`,{binary:true,actor:pm});
    let text = pdfText(pdf);
    assert.match(text,/DRAFT MEETING AGENDA/); assert.match(text,/Discussion before publication/); assert.match(text,/Requested/); assert.doesNotMatch(text,/requestedByEmail/);
    await mutation(h,meeting.occurrenceId,"publish");
    pdf = await h.send(`/api/meetings/document?occurrenceId=${meeting.occurrenceId}&kind=agenda`,{binary:true});
    const oldKey = h.runtime.database.one("SELECT agenda_pdf_key FROM meeting_occurrences WHERE id = ?",meeting.occurrenceId).agenda_pdf_key;
    const oldBytes = Buffer.from(await (await h.runtime.env.BUCKET.get(oldKey)).arrayBuffer());
    const longId = "SYNTHETIC-LONG-REFERENCE-"+"1234567890".repeat(30);
    for (let i=1;i<=12;i++) await mutation(h,meeting.occurrenceId,"add_agenda", { title: `SYNTHETIC Discussion ${i}`, notes: `${"Confirm the responsible person, required delivery, latest site condition and recovery commitment. ".repeat(12)}\n${i === 12 ? longId : ""}`, sectionKey: "schedule" },pm);
    let item = topicRow(h,initial.id);
    await mutation(h,meeting.occurrenceId,"remove_agenda",{ entityId: item.id, expectedVersion: item.updated_at, reason: "Removed topic stays out of the current printed agenda" });
    pdf = await h.send(`/api/meetings/document?occurrenceId=${meeting.occurrenceId}&kind=agenda`,{binary:true,actor:pm});
    text = pdfText(pdf);
    assert.doesNotMatch(text,/first printable topic/); assert.match(text,/SYNTHETIC Discussion 12/);
    assert.ok(text.replace(/\s+/g,"").includes(longId));
    assert.ok(text.split("\f").length>3);
    const newKey = h.runtime.database.one("SELECT agenda_pdf_key FROM meeting_occurrences WHERE id = ?",meeting.occurrenceId).agenda_pdf_key;
    assert.notEqual(newKey,oldKey); assert.deepEqual(Buffer.from(await (await h.runtime.env.BUCKET.get(oldKey)).arrayBuffer()),oldBytes);
    if (process.env.MEETING_PDF_QA_PATH) await writeFile(process.env.MEETING_PDF_QA_PATH,Buffer.from(pdf));
    assert.equal(h.outbound.length,0);
  } finally { await h.close(); }
});
