import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { buildMeetingAgenda, compactAgendaData } from "../lib/meeting-agenda.ts";
import { MEETING_TYPES, MEETING_SECTIONS, MEETING_DEFAULTS } from "../lib/meetings.ts";
import { harness, owner, pm, accountant, superintendent } from "./support/project-workflow-harness.mjs";
import { activateActor, F06_ACTORS } from "./support/f06-runtime-harness.mjs";

const today = new Date().toISOString().slice(0, 10);
const day = offset => new Date(Date.parse(`${today}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
const project = { number: "MEETING-TEST-001", name: "Synthetic Meeting Site", status: "Active", site: "100 Test Way", projectType: "Commercial", ownerName: "Synthetic Owner", ownerContractDate: day(-90), ownerContractType: "Plan & Spec Lump Sum", ownerContractStatus: "Executed", startDate: day(-60), substantialDate: day(14), finalDate: day(21), projectManager: pm.name, superintendent: superintendent.name, contractAmount: "1000000" };
const sourceProjectId = project.number;
const record = (id, recordType, data, status = "Open", due = day(3), projectId = project.number) => ({ projectId, id, recordType, title: `Synthetic ${id}`, owner: pm.name, due, status, updatedAt: `${today}T10:00:00.000Z`, recordDate: today, data });
const records = [
  record("SCHEDULE-SLIP", "Schedule", { start: day(-10), days: 5, baselineStart: day(-15), baselineDays: 5, progress: 10, trade: "Framing" }),
  record("SELECTION-LATE", "Selections", { requiredDeliveryDate: day(5), installationDate: day(7), options: [{ id: "ONE", leadDays: 30 }], decisionType: "Owner" }),
  record("RFI-BLOCK", "RFIs", { requiresOwnerDecision: true, scheduleImpactDays: 8 }, "Open", day(-9)),
  record("QUALITY-OPEN", "Quality Items", {}, "Open", day(-2)),
  { ...record("SAFETY-PRIVATE", "Safety Incidents", { personName: "DO-NOT-EXPOSE-PERSON", treatment: "DO-NOT-EXPOSE-TREATMENT", description: "DO-NOT-EXPOSE-MEDICAL" }, "Safety Review Required"), title: "DO-NOT-EXPOSE-PERSON · Injury Location" },
  record("BILL-1", "Owner Billing", { currentPaymentDue: 40000, receivedToDate: 10000 }, "Sent", day(-35)),
  record("AR-1", "AR Invoice", { projectId: project.number, billingId: "BILL-1", amount: 40000, receivedToDate: 10000, balance: 30000 }, "Partially Paid", day(-35), "MEFFORD-ACCOUNTING"),
  record("BILL-DRAFT", "Owner Billing", { currentPaymentDue: 20000, internalProfit: "DO-NOT-EXPOSE-PROFIT" }, "Owner Review", day(-20)),
  record("AP-1", "AP Invoice", { amount: 5000 }, "Owner Approval", day(-1), "MEFFORD-ACCOUNTING"),
  record("BIDS-1", "Bid Packages", { lifecycleScope: "Sales", deadline: day(2), bidders: [{ revisions: [{ id: "Q1" }], leveling: { scopeComplete: false } }] }, "Open", day(2), "MEFFORD-SALES"),
  record("OPP-1", "Sales Opportunities", { stage: "Estimating", bidDueDate: day(3), nextFollowUpDate: day(-2), estimatedValue: 500000, assignedEstimator: "", estimateStatus: "Ready For Review" }, "Estimating", day(3), "MEFFORD-SALES"),
  record("PROP-1", "Owner Proposals", {}, "Company Owner Review", day(3), "MEFFORD-SALES"),
  record("SCORE-1", "Scorecard Metrics", { actual: 3, target: 8, unit: "Proposals" }, "Active", today, "MEFFORD-COMPANY"),
  record("HEALTH-OLD", "Project Health Daily Snapshots", { color: "Red", score: 30, calculatedAt: `${day(-2)}T12:00:00Z` }, "Red"),
  { ...record("HEALTH-NEW", "Project Health Daily Snapshots", { color: "Green", score: 98, calculatedAt: `${today}T12:00:00Z` }, "Green"), updatedAt: `${today}T12:00:00Z` },
  record("DONE-SCHEDULE", "Schedule", { start: day(-100), days: 1, progress: 100 }, "Complete", day(-90)),
];
const build = (type, inputRecords = records) => buildMeetingAgenda({ type, projectId: type.startsWith("Project ") ? project.number : "MEFFORD-COMPANY", projects: [project], records: inputRecords.map(r => ({ ...r, data: compactAgendaData(r.data) })), today });

test("meeting audiences receive the correct operational issues and valid agenda sections", () => {
  const sub = build("Project Subcontractor"), client = build("Project Owner"), design = build("Project Design"), l10 = build("Weekly L10");
  assert.ok(sub.some(s => s.category === "Schedule Creep" && s.sectionKey === "lookahead"));
  assert.ok(sub.some(s => s.category === "Lead Time" && s.sectionKey === "procurement"));
  assert.ok(sub.some(s => s.source.id === "RFI-BLOCK" && s.sectionKey === "documents"));
  assert.ok(client.some(s => s.category === "Owner Payment" && s.sectionKey === "billing"));
  assert.ok(client.some(s => s.source.id === "SELECTION-LATE" && s.sectionKey === "owner-decisions"));
  assert.ok(design.some(s => s.source.id === "RFI-BLOCK" && s.sectionKey === "rfis"));
  assert.ok(l10.some(s => s.category === "Scorecard Exception" && s.sectionKey === "ids"));
  assert.ok(l10.some(s => s.category === "Owner Payment"));
  assert.ok(l10.filter(s => s.metric).length >= 7);
  for (const type of MEETING_TYPES) {
    const agenda = build(type), sections = new Set(MEETING_SECTIONS[type].map(s => s.key));
    assert.ok(agenda.every(s => sections.has(s.sectionKey)), type);
    assert.equal(new Set(agenda.map(s => s.key)).size, agenda.length, "Source identities must be unique");
    assert.doesNotMatch(JSON.stringify(agenda), /DO-NOT-EXPOSE/);
    assert.ok(!agenda.some(s => s.source.id === "DONE-SCHEDULE"));
  }
  assert.ok(!sub.some(s => /Payment|Payable|Billing|Scorecard/.test(s.category)));
  assert.ok(!client.some(s => s.source.id === "BILL-DRAFT" || s.source.id === "AP-1"));
  assert.equal(client.filter(s => s.category === "Owner Payment").length, 1, "AR and source billing must not double count");
  assert.equal(l10.find(s => s.source.id === "ar-overdue").metric.value, 30000);
  assert.ok(!l10.some(s => s.category === "Project Health"), "Old red snapshots cannot override the latest green snapshot");
});

test("department agendas have usable preset timeboxes and distinct work queues", () => {
  for (const type of MEETING_TYPES) assert.equal(MEETING_SECTIONS[type].reduce((sum, s) => sum + s.minutes, 0), MEETING_DEFAULTS[type].durationMinutes);
  const sales = build("Sales/Estimating Department"), ops = build("Operations Department"), accounting = build("Accounting Department");
  for (const category of ["Bid Deadline", "Sales Follow-Up", "Quote Coverage", "Proposal Review", "Estimate Approval"]) assert.ok(sales.some(s => s.category === category), category);
  assert.ok(ops.some(s => s.category === "Quality"));
  assert.ok(!ops.some(s => ["Payables", "Owner Payment"].includes(s.category)));
  for (const category of ["Owner Payment", "Payables", "Billing Approval"]) assert.ok(accounting.some(s => s.category === category), category);
  assert.ok(!accounting.some(s => s.category === "Information Blocker"));
});

test("resolved sources, unrelated projects, upcoming releases and missing scorecard actuals stay truthful", () => {
  const changed = records.map(r => r.id === "AR-1" ? { ...r, status: "Paid", data: { ...r.data, balance: 0 } } : r.id === "SELECTION-LATE" ? { ...r, data: { ...r.data, releasedAt: today, expectedDeliveryDate: day(4), selectedOptionId: "ONE" } } : r);
  assert.equal(build("Project Owner", changed).filter(s => s.category === "Owner Payment").length, 0);
  assert.ok(!build("Project Owner", changed).some(s => s.source.id === "SELECTION-LATE" && s.priority === "High"));
  const other = record("OTHER-JOB", "RFIs", { requiresOwnerDecision: true }, "Open", day(-20), "OTHER-PROJECT");
  assert.ok(!build("Project Owner", [...changed, other]).some(s => s.source.id === "OTHER-JOB"));
  const missing = record("NO-ACTUAL", "Scorecard Metrics", { target: 20 }, "Active", today, "MEFFORD-COMPANY");
  assert.ok(!build("Weekly L10", [missing]).some(s => s.category === "Scorecard Exception"));
});

test("scorecards use issued balances, verified signed sales, current WIP and persistent commitment escalations", () => {
  const award = record("WON", "Sales Opportunities", { stage: "Awarded", awardedProjectNumber: project.number, awardDate: today, salesMetrics: { contractValue: 300000 }, contractSales: { projectNumber: project.number, signed: true, signedDate: today, recognizedValue: 350000 } }, "Awarded", today, "MEFFORD-SALES");
  const goal = record("GOAL", "Sales Goals", { year: Number(today.slice(0, 4)), companyGoal: 5000000 }, "Active", today, "MEFFORD-SALES");
  const wip = record("FORECAST", "WIP Forecast", { period: today.slice(0, 7), forecastProfitCents: -250000, riskReserveCents: 500000 }, "Approved");
  const commitment = record("UNRESOLVED", "Escalated Meeting Action", { meetingType: "Operations Department", carryCount: 2, priority: "High" }, "Blocked", day(-15), "MEFFORD-COMPANY");
  const inputs = [...records.filter(r => r.recordType !== "AR Invoice"), award, goal, wip, commitment];
  const agenda = build("Weekly L10", inputs);
  assert.equal(agenda.find(s => s.source.id === "ar-overdue").metric.value, 30000, "An issued bill without an AR mirror still counts once");
  assert.equal(agenda.find(s => s.source.id === "sales-awarded").metric.value, 350000);
  assert.ok(!agenda.some(s => s.source.id === "WON" && s.category === "Award Handoff"));
  assert.ok(agenda.some(s => s.category === "Sales Goal" && s.reason.includes("$5,000,000.00")));
  assert.ok(agenda.some(s => s.category === "WIP Exception" && s.priority === "Critical"));
  assert.ok(agenda.some(s => s.category === "Unresolved Commitment"));
  const quarantined = buildMeetingAgenda({ type: "Weekly L10", projectId: "MEFFORD-COMPANY", projects: [{ ...project, status: "Deletion Quarantine" }], records, today });
  assert.ok(!quarantined.some(s => s.source.id === "SCHEDULE-SLIP" || s.source.id === "BILL-1"));
  assert.equal(quarantined.find(s => s.source.id === "ar-overdue").metric.value, 0, "Quarantined job AR mirrors are excluded");
});

async function seed(h) {
  h.runtime.database.maxBindings = 100;
  const createdProject = await h.post("/api/projects", { project }, owner, 201);
  project.number = createdProject.project.number;
  await activateActor(h.runtime.database, F06_ACTORS.employee);
  await activateActor(h.runtime.database, F06_ACTORS.blain);
  for (const r of records) await h.runtime.database.prepare(`INSERT INTO command_records (project_id,id,record_type,title,owner,due,status,updated_at,record_date,data_json) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(r.projectId === sourceProjectId ? project.number : r.projectId,r.id,r.recordType,r.title,r.owner,r.due,r.status,r.updatedAt,r.recordDate,JSON.stringify({ ...r.data, ...(r.data.projectId === sourceProjectId ? { projectId: project.number } : {}) })).run();
}
const getPath = (type, id = "") => `/api/meetings?${new URLSearchParams({ projectId: type.startsWith("Project ") ? project.number : "MEFFORD-COMPANY", meetingType: type, ...(id ? { occurrenceId: id } : {}) })}`;
async function create(h, type, actor = owner, extra = {}) {
  return h.post("/api/meetings", { action: "create_series", projectId: project.number, meetingType: type, startAt: `${day(1)}T14:00:00Z`, title: `Synthetic ${type}`, syncMicrosoft: false, ...extra }, actor);
}

test("real meeting handlers prepopulate all audiences, refresh without duplicates, and preserve discussion and publication history", async () => {
  const h = await harness();
  try {
    await seed(h);
    const created = {};
    for (const type of MEETING_TYPES) {
      if (type.endsWith("Turnover")) {
        await h.post("/api/meetings", { action: "create_series", meetingType: type, startAt: new Date().toISOString() }, owner, 409);
        continue; // Automatic creation and source lifecycle are exercised by turnovers.integration.test.mjs.
      }
      const result = await create(h, type); created[type] = result;
      const bundle = await h.send(getPath(type, result.occurrenceId));
      assert.equal(bundle.agenda.filter(r => r.source_type === "Standard Section").length, MEETING_SECTIONS[type].length);
      assert.ok(bundle.agenda.filter(r => r.source_type === "Standard Section").every(r => r.status === "Open" && r.notes === ""), "New headings must not claim review");
      assert.ok(bundle.agenda.some(r => r.source_type === "Automatic Agenda"));
      assert.equal(bundle.refresh.error, undefined);
    }
    const sub = created["Project Subcontractor"];
    let bundle = await h.send(getPath("Project Subcontractor", sub.occurrenceId));
    const slip = bundle.agenda.find(r => r.source_type === "Automatic Agenda" && JSON.parse(r.source_version).source.id === "SCHEDULE-SLIP");
    assert.ok(slip);
    const mutate = (action, extra = {}, expected = 200) => h.post("/api/meetings", { action, occurrenceId: sub.occurrenceId, ...extra }, owner, expected);
    await mutate("update_agenda", { entityId: slip.id, notes: "Keep this recovery commitment through every source refresh.", status: "Discussed", timeboxMinutes: 8 });
    const count = bundle.agenda.length;
    await Promise.all([mutate("refresh_agenda"), mutate("refresh_agenda", {}, 409)]);
    bundle = await h.send(getPath("Project Subcontractor", sub.occurrenceId));
    assert.equal(bundle.agenda.length, count);
    assert.equal(bundle.agenda.find(r => r.id === slip.id).notes, "Keep this recovery commitment through every source refresh.");
    assert.equal(bundle.agenda.find(r => r.id === slip.id).timebox_minutes, 8);
    await mutate("publish");
    const pdf = await h.send(`/api/meetings/document?occurrenceId=${sub.occurrenceId}&kind=agenda`, { binary: true });
    assert.equal(Buffer.from(pdf).subarray(0, 4).toString(), "%PDF");
    const oldPdfKey = h.runtime.database.one("SELECT agenda_pdf_key FROM meeting_occurrences WHERE id = ?", sub.occurrenceId).agenda_pdf_key;
    await h.runtime.database.prepare("UPDATE command_records SET status = 'Complete', data_json = ?, updated_at = ? WHERE project_id = ? AND id = 'SCHEDULE-SLIP'").bind(JSON.stringify({ start: day(-10), days: 5, progress: 100 }), `${today}T15:00:00Z`, project.number).run();
    await mutate("refresh_agenda");
    bundle = await h.send(getPath("Project Subcontractor", sub.occurrenceId));
    const cleared = bundle.agenda.find(r => r.id === slip.id);
    assert.equal(JSON.parse(cleared.source_version).active, false);
    assert.equal(cleared.notes, "Keep this recovery commitment through every source refresh.");
    assert.ok(cleared.addendum_number > 0);
    assert.equal(h.runtime.database.one("SELECT agenda_pdf_key FROM meeting_occurrences WHERE id = ?", sub.occurrenceId).agenda_pdf_key, "");
    assert.ok(await h.runtime.bucket.get(oldPdfKey), "Previously published PDF must remain retained");
    await mutate("start");
    await mutate("refresh_agenda", {}, 409);
    await mutate("finish");
    const longMinutes = Array.from({ length: 130 }, (_, i) => `Discussion ${i + 1}: The framing lead will confirm delivery, crane access, predecessor completion and the recovery commitment with the superintendent. Résumé of next steps retained.`).join("\n\n");
    await mutate("save_minutes", { minutesSummary: longMinutes });
    bundle = await h.send(getPath("Project Subcontractor", sub.occurrenceId));
    assert.equal(bundle.occurrences.find(r => r.id === sub.occurrenceId).minutes_summary, longMinutes);
    const finalMinutes = `${longMinutes}\n\nFINAL-DISCUSSION-MARKER: Owner-authorized changes still require the normal approval workflow.`;
    await mutate("finalize", { minutesSummary: finalMinutes });
    assert.equal(h.runtime.database.one("SELECT minutes_summary FROM meeting_occurrences WHERE id = ?", sub.occurrenceId).minutes_summary, finalMinutes);
    const minutesPdf = await h.send(`/api/meetings/document?occurrenceId=${sub.occurrenceId}&kind=minutes`, { binary: true });
    assert.ok((await PDFDocument.load(minutesPdf)).getPageCount() > 5, "All reviewed minutes must survive final PDF pagination");
    await mutate("save_minutes", { minutesSummary: "Forbidden rewrite" }, 409);
    await mutate("update_agenda", { entityId: slip.id, notes: "Forbidden rewrite" }, 409);
    assert.equal(h.outbound.length, 0, "Meeting tests must not send any real email or calendar invitation");
  } finally { await h.close(); }
});

test("meeting permissions protect departments, PDFs, and cross-occurrence requests", async () => {
  const h = await harness();
  try {
    await seed(h);
    const accounting = await create(h, "Accounting Department", accountant);
    const ops = await create(h, "Operations Department", pm);
    const opsBundle = await h.send(getPath("Operations Department", ops.occurrenceId), { actor: superintendent });
    assert.ok(opsBundle.attendees.some(a => a.email === superintendent.email));
    assert.equal(opsBundle.permissions.canEdit, false, "An attendee does not gain chair authority from a global job title");
    await h.send(getPath("Accounting Department", accounting.occurrenceId), { actor: pm, expected: 403 });
    await h.send(getPath("Accounting Department", accounting.occurrenceId), { actor: F06_ACTORS.blain, expected: 403 });
    await h.send(getPath("Operations Department", accounting.occurrenceId), { actor: pm, expected: 403 });
    await h.send(`/api/meetings/document?occurrenceId=${accounting.occurrenceId}&kind=agenda`, { actor: pm, expected: 403 });
    await h.post("/api/meetings", { action: "refresh_agenda", occurrenceId: accounting.occurrenceId }, pm, 403);
    await h.post("/api/meetings", { action: "create_series", meetingType: "Accounting Department", startAt: `${day(1)}T15:00:00Z`, syncMicrosoft: false }, pm, 403);
    await h.post("/api/meetings", { action: "add_attendee", occurrenceId: accounting.occurrenceId, assigneeName: pm.name, assigneeEmail: pm.email }, accountant, 400);
    await h.post("/api/meetings", { action: "add_attendee", occurrenceId: ops.occurrenceId, assigneeName: "External", assigneeEmail: "external@example.invalid", reason: "external" }, pm, 400);
    const first = await h.post("/api/meetings", { action: "add_action", occurrenceId: accounting.occurrenceId, title: "Reconcile synthetic invoice", assigneeName: accountant.name, assigneeEmail: accountant.email, dueAt: `${day(1)}T12:00:00Z` }, accountant);
    await h.post("/api/meetings", { action: "action_status", occurrenceId: ops.occurrenceId, entityId: first.id, status: "Complete" }, pm, 404);
    const decision = await h.post("/api/meetings", { action: "add_decision", occurrenceId: accounting.occurrenceId, statement: "Synthetic collection plan", decisionMakerName: owner.name, decisionMakerEmail: owner.email }, accountant);
    await h.post("/api/meetings", { action: "confirm_decision", occurrenceId: ops.occurrenceId, entityId: decision.id }, owner, 404);
  } finally { await h.close(); }
});

test("carryforward stays one reference per occurrence and never pulls commitments backward in time", async () => {
  const h = await harness();
  try {
    await seed(h);
    const first = await create(h, "Operations Department", pm, { startAt: `${today}T14:00:00Z` });
    const action = await h.post("/api/meetings", { action: "add_action", occurrenceId: first.occurrenceId, title: "Confirm crane delivery", definitionOfDone: "Recorded supplier commitment", assigneeName: superintendent.name, assigneeEmail: superintendent.email, dueAt: `${day(1)}T12:00:00Z` }, pm);
    const second = await h.post("/api/meetings", { action: "create_occurrence", seriesId: first.seriesId, startAt: `${day(7)}T14:00:00Z` }, pm);
    for (let i = 0; i < 3; i++) await h.post("/api/meetings", { action: "refresh_agenda", occurrenceId: second.occurrenceId }, pm);
    assert.equal(h.runtime.database.one("SELECT carry_count FROM meeting_action_items WHERE id = ?", action.id).carry_count, 1);
    let bundle = await h.send(getPath("Operations Department", second.occurrenceId), { actor: pm });
    assert.equal(bundle.agenda.filter(r => r.source_type === "Meeting Action" && r.source_id === action.id).length, 1);
    const earlier = await h.post("/api/meetings", { action: "create_occurrence", seriesId: first.seriesId, startAt: `${day(-7)}T14:00:00Z` }, pm);
    bundle = await h.send(getPath("Operations Department", earlier.occurrenceId), { actor: pm });
    assert.equal(bundle.agenda.filter(r => r.source_id === action.id).length, 0);
    await h.post("/api/meetings", { action: "action_status", occurrenceId: second.occurrenceId, entityId: action.id, status: "Complete" }, superintendent);
    bundle = await h.send(getPath("Operations Department", second.occurrenceId), { actor: pm });
    assert.equal(bundle.agenda.find(r => r.source_id === action.id).status, "Source Cleared");
  } finally { await h.close(); }
});
