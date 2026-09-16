import assert from "node:assert/strict";
import test from "node:test";
import { harness, owner, pm, accountant, today, scenarios, saleToExecutedContract } from "./support/project-workflow-harness.mjs";
import { PHASE_ONE_BILLING, PHASE_ONE_SOV_ID, ownerBillingAuthority } from "../lib/owner-billing-authority.ts";

function seed(h, projectId, id, type, status, data) {
  h.runtime.database.sqlite.prepare(`INSERT INTO command_records
    (project_id,id,record_type,title,owner,due,status,meta,data_json)
    VALUES (?,?,?,?,?,?,?,'SYNTHETIC AUTHORIZATION TEST',?)`)
    .run(projectId,id,type,`SYNTHETIC ${id}`,owner.name,today,status,JSON.stringify(data));
}

async function pendingProject(h, type = "Time & Materials") {
  const result = await h.post("/api/projects", { project: {
    name: `SYNTHETIC pending ${type}`, status: "Active", site: "100 Test Lane, Bloomington, IN 47401",
    ownerName: "Synthetic Owner LLC", ownerContractDate: today, ownerContractType: type,
    projectType: "Commercial", contractAmount: "318400.00", currentContractAmount: "318400.00",
    startDate: today, substantialDate: today, finalDate: today, projectManager: pm.name, superintendent: "Test Superintendent",
  } }, owner, 201);
  return result.project.number;
}

function billing(projectId, earned = 100, extra = {}) {
  return { projectNumber: projectId, billingPeriod: today.slice(0, 7), currentEarned: earned,
    currentPaymentDue: earned, cumulativeEarned: earned, retainageThisPeriod: 0,
    lines: [{ id: "SOV-1", scheduledValue: 318400, totalThisPeriod: earned }], ...extra };
}

async function approve(h, projectId, id, data) {
  await h.save(projectId, "Owner Billing", id, "PM Preparation", data, pm);
  await h.save(projectId, "Owner Billing", id, "Accountant Review", data, pm);
  await h.save(projectId, "Owner Billing", id, "Owner Approval", data, accountant);
  await h.save(projectId, "Owner Billing", id, "Ready To Send", data, owner);
}

async function lock(h, job, extra = {}) {
  await h.save(job.projectId, "Owner Billing Setup", "OWNER-BILLING-SETUP", "Locked", {
    sovLines: [{ id: "SOV-1", scheduledValue: 318400 }], ...extra,
  });
}

test("all five unsigned contract paths permit preparation but block SOV lock, review and posting", async () => {
  const h = await harness();
  try {
    for (const type of ["Time & Materials", "Plan & Spec Lump Sum", "Design-Build Lump Sum", "Design-Build GMP", "External Contract"]) {
      const id = await pendingProject(h, type);
      const sov = { sovLines: [{ id: "SOV-1", scheduledValue: 318400 }] };
      await h.save(id, "Owner Billing Setup", "OWNER-BILLING-SETUP", "Draft", sov);
      await h.save(id, "Owner Billing Setup", "OWNER-BILLING-SETUP", "Locked", sov, owner, 409);
      const invoice = billing(id);
      await h.save(id, "Owner Billing", "BILL-DRAFT", "PM Preparation", invoice, pm);
      await h.save(id, "Owner Billing", "BILL-DRAFT", "Accountant Review", invoice, pm, 409);
      for (const status of ["Accountant Review", "Owner Approval", "Ready To Send"]) {
        h.runtime.database.sqlite.prepare("UPDATE command_records SET status = ? WHERE project_id = ? AND id = 'BILL-DRAFT'").run(status, id);
        await h.save(id, "Owner Billing", "BILL-DRAFT", status, invoice, owner, 409);
      }
      const failed = await h.post("/api/accounting", { action: "send-owner-billing", projectId: id, recordId: "BILL-DRAFT" }, accountant, 409);
      assert.match(failed.error, /Sign|Execute/);
      assert.equal(h.row(id, "BILL-DRAFT").status, "Ready To Send");
      assert.equal(h.row("MEFFORD-ACCOUNTING", `AR-${id}-BILL-DRAFT`), null);
    }
    assert.equal(h.runtime.database.one("SELECT COUNT(*) AS n FROM accounting_events").n, 0);
    assert.equal(h.outbound.length, 0);
  } finally { await h.close(); }
});

test("signed counts and contract dollars exclude pending and closed jobs while keeping pending prices and costs visible", async () => {
  const h = await harness();
  try {
    const pending = await pendingProject(h);
    seed(h, pending, "BUDGET", "Budget", "Active", { selectedForProject: true, originalBudget: 271001.73 });
    seed(h, pending, "COST", "Job Cost Actual", "Posted", { amount: 100 });
    let accounting = await h.send("/api/accounting");
    assert.equal(accounting.summary.activeProjects, 0);
    assert.equal(accounting.summary.currentContracts, 0);
    assert.equal(accounting.summary.pendingContractProjects, 1);
    assert.equal(accounting.summary.pendingContractValue, 318400);
    assert.equal(accounting.summary.actualProjectCost, 100);
    assert.equal(accounting.summary.projectedProfit, 0);
    assert.equal(accounting.projects.find(row => row.number === pending).currentContract, 318400);
    assert.equal(accounting.projects.find(row => row.number === pending).recognizedRevenue, 0);
    const reports = await h.send(`/api/financial-reports?projectId=${pending}`);
    assert.equal(reports.summary.currentContracts, 0);
    assert.equal(reports.summary.pendingContractValue, 318400);
    assert.equal(reports.summary.backlog, 0);
    assert.equal(reports.summary.recognizedRevenue, 0);
    assert.equal(reports.reports.find(report => report.type === "project-financials").rows[0].status, "Awaiting Signatures");
    const job = await saleToExecutedContract(h, { ...scenarios[0], negotiatedContractValue: 318400 }, "SIGNED-TOTAL");
    accounting = await h.send("/api/accounting");
    assert.equal(accounting.summary.activeProjects, 1);
    assert.equal(accounting.summary.currentContracts, 318400);
    assert.equal(accounting.summary.pendingContractProjects, 1);
    h.runtime.database.sqlite.prepare("UPDATE projects SET status = 'Completed' WHERE number = ?").run(job.projectId);
    assert.equal((await h.send("/api/accounting")).summary.currentContracts, 0);
  } finally { await h.close(); }
});

test("an Executed project label and a single signature cannot substitute for the controlled signed contract", async () => {
  const h = await harness();
  try {
    const id = await pendingProject(h);
    h.runtime.database.sqlite.prepare("UPDATE projects SET owner_contract_status = 'Executed' WHERE number = ?").run(id);
    const draft = h.row(id, `OWNER-CONTRACT-${id}`);
    h.runtime.database.sqlite.prepare("UPDATE command_records SET status = 'Executed', data_json = ? WHERE project_id = ? AND id = ?")
      .run(JSON.stringify({ ...draft.data, executionHash: "synthetic", executedAt: today, signatures: { owner: { signedAt: today } } }), id, draft.id);
    await h.save(id, "Owner Billing Setup", "OWNER-BILLING-SETUP", "Locked", { sovLines: [{ id: "SOV-1", scheduledValue: 318400 }] }, owner, 409);
    assert.equal((await h.send("/api/accounting")).summary.currentContracts, 0);
    assert.equal(ownerBillingAuthority({ ownerContractStatus: "Executed" }, { status: "Executed", data: {} }).construction, false);
  } finally { await h.close(); }
});

test("signed Phase 1 billing is capped at the executed fee and credited once when GMP construction billing opens", async () => {
  const h = await harness();
  try {
    let designProject;
    const job = await saleToExecutedContract(h, { ...scenarios[1], negotiatedContractValue: 318400,
      afterPhaseOne: async ({ projectId }) => {
        designProject = projectId;
        assert.equal((await h.send("/api/accounting")).summary.currentContracts, 0);
        await h.save(projectId, "Owner Billing Setup", "OWNER-BILLING-SETUP", "Locked", { sovLines: [{ id: "SOV-1", scheduledValue: 318400 }] }, owner, 409);
        await h.save(projectId, "Owner Billing Setup", PHASE_ONE_SOV_ID, "Locked", {
          billingPhase: PHASE_ONE_BILLING, sovLines: [{ id: "SOV-DESIGN", scheduledValue: 2500 }],
        });
        const design = billing(projectId, 2500, { billingPhase: PHASE_ONE_BILLING,
          currentPaymentDue: 2250, retainageThisPeriod: 250, retainageToDate: 250,
          lines: [{ id: "SOV-DESIGN", scheduledValue: 2500, totalThisPeriod: 2500 }],
        });
        await approve(h, projectId, "DESIGN-001", design);
        await h.post("/api/accounting", { action: "send-owner-billing", projectId, recordId: "DESIGN-001" }, accountant);
        const excess = billing(projectId, 1, { billingPhase: PHASE_ONE_BILLING, lines: [{ id: "SOV-DESIGN", scheduledValue: 2500, totalThisPeriod: 1 }] });
        await h.save(projectId, "Owner Billing", "DESIGN-EXCESS", "PM Preparation", excess, pm);
        await h.save(projectId, "Owner Billing", "DESIGN-EXCESS", "Accountant Review", excess, pm, 409);
        const accounting = await h.send("/api/accounting");
        assert.equal(accounting.summary.currentContracts, 0);
        assert.equal(accounting.summary.ownerBilled, 2250);
        assert.equal(accounting.projects.find(row => row.number === projectId).recognizedRevenue, 2500);
      },
    }, "PHASE-AUTHORITY");
    assert.equal(job.projectId, designProject);
    await h.save(job.projectId, "Owner Billing Setup", "OWNER-BILLING-SETUP", "Locked", { sovLines: [{ id: "SOV-1", scheduledValue: 318400 }] }, owner, 409);
    await lock(h, job, { phaseOneCreditLineId: "SOV-1" });
    const completion = billing(job.projectId, 315900, { currentPaymentDue: 316150, retainageThisPeriod: -250, retainageToDate: 0, cumulativeEarned: 318400 });
    await approve(h, job.projectId, "CONSTRUCTION-001", completion);
    await h.post("/api/accounting", { action: "send-owner-billing", projectId: job.projectId, recordId: "CONSTRUCTION-001" }, accountant);
    const accounting = await h.send("/api/accounting");
    assert.equal(accounting.summary.currentContracts, 318400);
    assert.equal(accounting.summary.ownerBilled, 318400, "Design billing and retainage are not billed twice");
    seed(h, job.projectId, "CONSTRUCTION-EXCESS", "Owner Billing", "Ready To Send", billing(job.projectId, 1));
    await h.post("/api/accounting", { action: "send-owner-billing", projectId: job.projectId, recordId: "CONSTRUCTION-EXCESS" }, accountant, 409);
  } finally { await h.close(); }
});

test("concurrent invoices cannot overspend one signed authorization and failed posting stays atomic", async () => {
  const h = await harness();
  try {
    const job = await saleToExecutedContract(h, { ...scenarios[0], negotiatedContractValue: 318400 }, "CONCURRENT-BILLING");
    await lock(h, job);
    for (const id of ["BILL-A", "BILL-B"]) await approve(h, job.projectId, id, billing(job.projectId, 200000));
    const results = await Promise.allSettled(["BILL-A", "BILL-B"].map(recordId => h.post("/api/accounting", { action: "send-owner-billing", projectId: job.projectId, recordId }, accountant)));
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    const sent = ["BILL-A", "BILL-B"].filter(id => h.row(job.projectId, id).status === "Sent");
    assert.equal(sent.length, 1);
    assert.equal(h.runtime.database.one("SELECT COUNT(*) AS n FROM accounting_events WHERE event_type = 'Owner Invoice Sent'").n, 1);
    assert.equal((await h.send("/api/accounting")).summary.ownerBilled, 200000);
    h.runtime.database.sqlite.prepare("UPDATE projects SET owner_contract_status = 'Draft' WHERE number = ?").run(job.projectId);
    await h.post("/api/accounting", { action: "record-owner-receipt", projectId: job.projectId, recordId: sent[0], amount: 100, receiptDate: today, reference: "SYNTHETIC existing receivable collection" }, accountant);
    assert.equal((await h.send("/api/accounting")).summary.ownerReceived, 100, "Existing issued receivables remain collectible");
  } finally { await h.close(); }
});
