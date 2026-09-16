import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  activateActor,
  createF06Runtime,
  F06_ACTORS,
} from "./support/f06-runtime-harness.mjs";
import { newEstimateData } from "../app/estimate-template.ts";

let runtime;
let worker;

before(async () => {
  runtime = await createF06Runtime();
  await Promise.all([
    activateActor(runtime.database, F06_ACTORS.blain),
    activateActor(runtime.database, F06_ACTORS.projectManager),
    activateActor(runtime.database, F06_ACTORS.employee),
  ]);
  worker = (await import(`../dist/server/index.js?f06=${Date.now()}`)).default;
});

after(async () => {
  await runtime.dispose();
});

async function send(path, options) {
  return worker.fetch(runtime.request(path, options));
}

async function assertStatus(response, expected) {
  assert.equal(response.status, expected, response.status === expected ? undefined : await response.clone().text());
}

test("real Worker routes fail closed for anonymous high-risk requests", async () => {
  const requests = [
    ["/api/session", {}],
    ["/api/accounting", {}],
    ["/api/assets", {}],
    ["/api/contracts", {}],
    ["/api/financial-reports", {}],
    ["/api/microsoft-access", {}],
    ["/api/meetings", {}],
    ["/api/project-health?projectId=26001", {}],
    ["/api/projects", {}],
    ["/api/records?projectId=26001", {}],
    ["/api/review", {}],
    ["/api/team-access", {}],
    ["/api/owner-delete?kind=project&targetId=26001", {}],
    ["/api/projects", { method: "POST", body: { project: {} } }],
  ];
  for (const [path, options] of requests) {
    const response = await send(path, options);
    assert.equal(response.status, 401, `${path} must reject an anonymous request`);
  }
});

test("permanent deletion remains owner-only even for an Administrator and Project Manager", async () => {
  for (const actor of [F06_ACTORS.blain, F06_ACTORS.projectManager]) {
    const response = await send("/api/owner-delete?kind=project&targetId=26001", { actor });
    assert.equal(response.status, 403, `${actor.accessLevel} unexpectedly opened permanent deletion`);
  }
});

test("session identity is canonical and backed by active database and storage bindings", async () => {
  const response = await send("/api/session", { actor: F06_ACTORS.jordan });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.actor.email, "jmefford@meffcon.com");
  assert.equal(payload.actor.accessLevel, "Company Owner");
  assert.equal(payload.actor.authenticated, true);
  assert.deepEqual(payload.storage, { database: "active", projectFiles: "active" });
});

test("temporary ChatGPT authentication never creates a second Jordan identity or queue", async () => {
  const response = await send("/api/session", {
    actor: { name: "Jordan Mefford", email: "djmeff22@gmail.com" },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.actor.email, "jmefford@meffcon.com");
  assert.equal(payload.actor.authenticationEmail, "djmeff22@gmail.com");
  assert.equal(payload.actor.accessLevel, "Company Owner");
  assert.equal(payload.actor.authorizationStatus, "Active");
  assert.equal(runtime.database.one("SELECT count(*) AS count FROM company_members WHERE lower(email) = 'djmeff22@gmail.com'").count, 0);
});

test("inactive identities fail closed and cannot read project data", async () => {
  const response = await send("/api/projects", { actor: F06_ACTORS.inactive });
  assert.ok(response.status >= 400, `inactive user unexpectedly received ${response.status}`);
  assert.notEqual(response.status, 200);
});

test("ordinary employees cannot create projects", async () => {
  const response = await send("/api/projects", {
    actor: F06_ACTORS.employee,
    method: "POST",
    body: { mode: "create", project: validProject("Forbidden Employee Project") },
  });
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /Project Manager|Administrator|Company Owner/i);
  assert.equal(runtime.database.one("SELECT count(*) AS count FROM projects").count, 0);
});

test("a project manager is restricted to projects where they are the primary PM", async () => {
  const forbidden = await send("/api/projects", {
    actor: F06_ACTORS.projectManager,
    method: "POST",
    body: { mode: "create", project: validProject("Wrong PM", { projectManager: "Someone Else" }) },
  });
  assert.equal(forbidden.status, 403);

  const allowed = await send("/api/projects", {
    actor: F06_ACTORS.projectManager,
    method: "POST",
    body: { mode: "create", project: validProject("PM Controlled Project") },
  });
  await assertStatus(allowed, 201);
  const payload = await allowed.json();
  assert.equal(payload.project.projectManager, F06_ACTORS.projectManager.name);
});

test("owner project creation persists and is returned through the real HTTP route", async () => {
  const created = await send("/api/projects", {
    actor: F06_ACTORS.jordan,
    method: "POST",
    body: { mode: "create", project: validProject("F-06 Runtime Project") },
  });
  await assertStatus(created, 201);
  const saved = await created.json();
  assert.match(saved.project.number, /^\d{2}-\d{3}$/);
  assert.deepEqual(saved.contractWorkflow, {
    contractRecordId: `OWNER-CONTRACT-${saved.project.number}`,
    portalStatus: "Dormant",
    revision: 1,
  });
  assert.equal(runtime.database.one("SELECT name FROM projects WHERE number = ?", saved.project.number).name, "F-06 Runtime Project");
  assert.equal(runtime.database.one("SELECT status FROM command_records WHERE project_id = ? AND id = ?", saved.project.number, `OWNER-CONTRACT-${saved.project.number}`).status, "Draft");
  assert.equal(runtime.database.one("SELECT status FROM owner_portal_access WHERE project_id = ?", saved.project.number).status, "Dormant");
  assert.equal(runtime.database.one("SELECT phase FROM owner_contract_revisions WHERE project_id = ? AND revision_number = 1", saved.project.number).phase, "Draft Preparation");

  const listed = await send("/api/projects", { actor: F06_ACTORS.jordan });
  assert.equal(listed.status, 200);
  const list = await listed.json();
  assert.equal(list.visibility, "Company Wide");
  assert.ok(list.projects.some((project) => project.number === saved.project.number));
});

test("F-10 clean-start award creates one synchronized contract billing accounting and dormant-owner workflow", async () => {
  const opportunityId = "F10-CLEAN-AWARD";
  seedApprovedOpportunity(opportunityId, "F-10 Clean Award");
  const project = validProject("F-10 Awarded Project", {
    ownerContractType: "Time & Materials",
    paymentTerms: "Net 15 after approved monthly billing",
    retainageInitialPercent: 7.5,
    retainageAfterHalfPercent: 2.5,
  });
  const awarded = await send("/api/estimates/award", {
    actor: F06_ACTORS.jordan,
    method: "POST",
    body: { opportunityId, project },
  });
  await assertStatus(awarded, 201);
  const payload = await awarded.json();
  const projectNumber = payload.project.number;
  const contractId = `OWNER-CONTRACT-${projectNumber}`;
  assert.equal(payload.handoff.status, "Completed");
  assert.equal(payload.handoff.consumers.length, 4);
  assert.ok(payload.handoff.consumers.some(consumer => consumer.key === "operations-turnover-meeting" && consumer.status === "Succeeded"));
  assert.ok(payload.handoff.consumers.every((consumer) => consumer.status === "Succeeded"));
  const domainEvent = runtime.database.one("SELECT * FROM domain_events WHERE aggregate_id = ?", opportunityId);
  assert.equal(domainEvent.status, "Completed");
  assert.equal(domainEvent.schema_version, 1);
  assert.equal(runtime.database.one("SELECT count(*) AS count FROM domain_event_consumers WHERE event_id = ?", domainEvent.id).count, 4);
  assert.equal(runtime.database.one("SELECT count(*) AS count FROM domain_event_consumers WHERE event_id = ? AND mandatory = 1 AND status <> 'Succeeded'", domainEvent.id).count, 0);

  const projectRow = runtime.database.one("SELECT * FROM projects WHERE number = ?", projectNumber);
  assert.equal(projectRow.owner_contract_type, "Time & Materials");
  assert.equal(projectRow.payment_terms, project.paymentTerms);
  assert.equal(projectRow.retainage_initial_percent, "7.5");
  assert.equal(projectRow.retainage_after_half_percent, "2.5");

  const contract = runtime.database.one("SELECT * FROM command_records WHERE project_id = ? AND id = ?", projectNumber, contractId);
  const contractData = JSON.parse(contract.data_json);
  assert.equal(contract.status, "Draft");
  assert.equal(contractData.fields.PAYMENT_TERMS, project.paymentTerms);
  assert.equal(contractData.fields.RETAINAGE_TERMS, "7.5% until 50% completion, then 2.5%; release as required by Project-state law.");
  assert.equal(contractData.fields.RETAINAGE_PERCENTAGE, "7.5");

  const billing = JSON.parse(runtime.database.one(
    "SELECT data_json FROM command_records WHERE project_id = ? AND id = 'OWNER-BILLING-SETUP'",
    projectNumber,
  ).data_json);
  const accounting = JSON.parse(runtime.database.one(
    "SELECT data_json FROM command_records WHERE project_id = 'MEFFORD-ACCOUNTING' AND id = ?",
    contractId,
  ).data_json);
  assert.equal(billing.contractType, "Time & Materials");
  assert.equal(billing.paymentTerms, project.paymentTerms);
  assert.equal(billing.retainageInitialPercent, "7.5");
  assert.equal(accounting.contractType, "Time & Materials");
  assert.equal(accounting.paymentTerms, project.paymentTerms);
  assert.equal(accounting.retainageAfterHalfPercent, "2.5");
  assert.equal(runtime.database.one("SELECT status FROM owner_portal_access WHERE project_id = ?", projectNumber).status, "Dormant");
  assert.equal(runtime.database.one("SELECT contract_type FROM owner_contract_revisions WHERE project_id = ? AND revision_number = 1", projectNumber).contract_type, "Time & Materials");

  const retry = await send("/api/estimates/award", {
    actor: F06_ACTORS.jordan,
    method: "POST",
    body: { opportunityId, project },
  });
  await assertStatus(retry, 200);
  const retryPayload = await retry.json();
  assert.equal(retryPayload.idempotent, true);
  assert.equal(retryPayload.handoff.status, "Completed");
  assert.equal(runtime.database.one("SELECT count(*) AS count FROM projects WHERE name = ?", project.name).count, 1);
  assert.equal(runtime.database.one("SELECT count(*) AS count FROM owner_contract_revisions WHERE project_id = ?", projectNumber).count, 1);
});

test("F-10 award rolls back every business record when contract activation fails", async () => {
  const opportunityId = "F10-ROLLBACK-AWARD";
  const project = validProject("F-10 Rollback Project");
  seedApprovedOpportunity(opportunityId, project.name);
  runtime.database.injectFailure({ pattern: /INSERT INTO owner_contract_revisions/, once: true });

  const response = await send("/api/estimates/award", {
    actor: F06_ACTORS.jordan,
    method: "POST",
    body: { opportunityId, project },
  });
  assert.equal(response.status, 500);
  assert.equal(runtime.database.one("SELECT count(*) AS count FROM projects WHERE name = ?", project.name).count, 0);
  assert.equal(runtime.database.one("SELECT status FROM command_records WHERE project_id = 'MEFFORD-SALES' AND id = ?", opportunityId).status, "Estimate");
  assert.equal(runtime.database.one(
    "SELECT count(*) AS count FROM command_records WHERE project_id <> 'MEFFORD-SALES' AND title LIKE ?",
    `%${project.name}%`,
  ).count, 0);
  assert.equal(runtime.database.one("SELECT count(*) AS count FROM domain_events WHERE aggregate_id = ?", opportunityId).count, 0);
});

test("owner deletion requires exact confirmation, quarantines recoverably, and purges only after cooling", async () => {
  const row = runtime.database.one("SELECT number, name FROM projects WHERE name = ?", "F-06 Runtime Project");
  const preview = await send(`/api/owner-delete?kind=project&targetId=${row.number}`, { actor: F06_ACTORS.jordan });
  assert.equal(preview.status, 200);
  assert.equal((await preview.json()).preview.targetName, row.name);

  const blocked = await send("/api/owner-delete", {
    actor: F06_ACTORS.jordan,
    method: "DELETE",
    body: { kind: "project", targetId: row.number, confirmation: "wrong" },
  });
  assert.equal(blocked.status, 400);
  assert.ok(runtime.database.one("SELECT number FROM projects WHERE number = ?", row.number));

  const quarantined = await send("/api/owner-delete", {
    actor: F06_ACTORS.jordan,
    method: "DELETE",
    body: { kind: "project", targetId: row.number, confirmation: row.name },
  });
  await assertStatus(quarantined, 200);
  const quarantine = await quarantined.json();
  assert.equal(quarantine.quarantined, true);
  assert.equal(runtime.database.one("SELECT status FROM projects WHERE number = ?", row.number).status, "Deletion Quarantine");
  assert.equal(runtime.database.one("SELECT id FROM owner_deletion_receipts WHERE target_id = ?", row.number), null);
  const request = runtime.database.one("SELECT * FROM owner_deletion_requests WHERE id = ?", quarantine.requestId);
  assert.equal(request.state, "Quarantined");
  assert.ok(runtime.bucket.objects.has(request.manifest_storage_key));

  const hidden = await send("/api/projects", { actor: F06_ACTORS.jordan });
  assert.equal(hidden.status, 200);
  assert.ok(!(await hidden.json()).projects.some((project) => project.number === row.number));

  const restored = await send("/api/owner-delete", {
    actor: F06_ACTORS.jordan,
    method: "POST",
    body: { action: "restore", requestId: quarantine.requestId },
  });
  await assertStatus(restored, 200);
  assert.equal(runtime.database.one("SELECT status FROM projects WHERE number = ?", row.number).status, "Active");
  const restoredRequest = runtime.database.one("SELECT * FROM owner_deletion_requests WHERE id = ?", quarantine.requestId);
  assert.equal(restoredRequest.state, "Restored");
  assert.equal(restoredRequest.phase, "Restored And Recovery Manifest Destroyed");
  assert.ok(restoredRequest.manifest_purged_at);
  assert.equal(runtime.bucket.objects.has(request.manifest_storage_key), false);

  const second = await send("/api/owner-delete", {
    actor: F06_ACTORS.jordan,
    method: "DELETE",
    body: { kind: "project", targetId: row.number, confirmation: row.name },
  });
  await assertStatus(second, 200);
  const secondQuarantine = await second.json();
  const secondRequest = runtime.database.one("SELECT * FROM owner_deletion_requests WHERE id = ?", secondQuarantine.requestId);
  assert.ok(runtime.bucket.objects.has(secondRequest.manifest_storage_key));
  runtime.database.sqlite.prepare("UPDATE owner_deletion_requests SET purge_after = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(secondQuarantine.requestId);

  const finalConfirmationBlocked = await send("/api/owner-delete", {
    actor: F06_ACTORS.jordan,
    method: "POST",
    body: { action: "purge", requestId: secondQuarantine.requestId, confirmation: row.name },
  });
  assert.equal(finalConfirmationBlocked.status, 400);
  assert.ok(runtime.database.one("SELECT number FROM projects WHERE number = ?", row.number));

  const purged = await send("/api/owner-delete", {
    actor: F06_ACTORS.jordan,
    method: "POST",
    body: { action: "purge", requestId: secondQuarantine.requestId, confirmation: `PERMANENTLY DELETE ${row.name}` },
  });
  await assertStatus(purged, 200);
  assert.equal(runtime.database.one("SELECT number FROM projects WHERE number = ?", row.number), null);
  assert.ok(runtime.database.one("SELECT id FROM owner_deletion_receipts WHERE target_id = ?", row.number));
  const purgedRequest = runtime.database.one("SELECT * FROM owner_deletion_requests WHERE id = ?", secondQuarantine.requestId);
  assert.equal(purgedRequest.state, "Purged");
  assert.equal(purgedRequest.phase, "Reconciled Complete; Recovery Manifest Destroyed");
  assert.equal(purgedRequest.purge_confirmed_by_email, F06_ACTORS.jordan.email);
  assert.ok(purgedRequest.purge_confirmed_at);
  assert.ok(purgedRequest.manifest_purged_at);
  assert.equal(runtime.bucket.objects.has(secondRequest.manifest_storage_key), false);
});

function validProject(name, overrides = {}) {
  return {
    name,
    status: "Active",
    site: "100 Control Test Way, Lexington, KY 40507",
    ownerName: "F-06 Test Owner",
    ownerContractDate: "2026-08-23",
    ownerContractType: "Plan & Spec Lump Sum",
    projectType: "Commercial",
    contractAmount: "1000000",
    startDate: "2026-09-01",
    substantialDate: "2027-05-01",
    finalDate: "2027-06-01",
    projectManager: F06_ACTORS.projectManager.name,
    superintendent: F06_ACTORS.superintendent.name,
    ...overrides,
  };
}

function seedApprovedOpportunity(id, title) {
  const estimate = newEstimateData();
  estimate.status = "Approved";
  estimate.approvedBy = F06_ACTORS.jordan.name;
  estimate.approvedAt = "2026-08-23T12:00:00.000Z";
  estimate.projectInputs.projectDurationMonths = 1;
  runtime.database.sqlite.prepare(
    `INSERT INTO command_records (
      project_id, id, record_type, title, owner, due, status, meta, record_date, data_json
    ) VALUES ('MEFFORD-SALES', ?, 'Sales Opportunities', ?, ?, '2026-08-23', 'Estimate', 'Approved Estimate', '2026-08-23', ?)`,
  ).run(id, title, F06_ACTORS.jordan.name, JSON.stringify({
    stage: "Estimate",
    estimateStatus: "Approved",
    assignedRep: F06_ACTORS.jordan.name,
    company: "F-10 Test Owner",
    estimate,
  }));
}
