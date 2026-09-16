import assert from "node:assert/strict";
import test from "node:test";
import { harness, owner, superintendent, today, saleToExecutedContract, scenarios } from "./support/project-workflow-harness.mjs";

function seed(h, projectId, id, type, data, status = "Awarded") {
  h.runtime.database.sqlite.prepare(`INSERT INTO command_records
    (project_id, id, record_type, title, owner, due, status, meta, data_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'Synthetic regression fixture', ?)`)
    .run(projectId, id, type, `SYNTHETIC TEST ONLY ${id}`, owner.name, today, status, JSON.stringify(data));
}

async function fixture(h, type = "Time & Materials") {
  const created = await h.post("/api/projects", { project: {
    name: "SYNTHETIC TEST ONLY Johnstone Bloomington amount regression", status: "Active",
    site: "100 Test Street, Bloomington, IN 47401", ownerName: "Synthetic Owner LLC",
    ownerContractDate: today, ownerContractType: type, projectType: "Commercial",
    contractAmount: "298400.00", currentContractAmount: "298400.00",
    startDate: today, substantialDate: today, finalDate: today,
    projectManager: owner.name, superintendent: superintendent.name,
  } }, owner, 201);
  const id = created.project.number;
  const contractId = `OWNER-CONTRACT-${id}`;
  seed(h, id, "ESTIMATE-REGRESSION", "Awarded Estimates", { contractValue: 298400, originalBudget: 271001.73 });
  seed(h, id, "PROPOSAL-REGRESSION", "Owner Proposals", { contractAmount: 298400, immutable: true }, "Award Basis Of Sale");
  seed(h, id, "BUDGET-REGRESSION", "Budget", { originalBudget: 271001.73, selectedForProject: true }, "Active");
  const save = (amount, expected = 200) => h.post("/api/contracts", {
    action: "save", projectId: id, recordId: contractId, contractType: type,
    fields: { ...h.row(id, contractId).data.fields,
      SMALL_PROJECT_CONTRACT_AMOUNT: String(amount), SMALL_PROJECT_PRICING_METHOD: "Time & Materials Not to Exceed",
      LUMP_SUM_CONTRACT_SUM: String(amount), EXTERNAL_CONTRACT_AMOUNT: String(amount),
      OWNER_TARGET_BUDGET: String(amount), GMP_AMOUNT: String(amount),
    },
    manualFieldKeys: ["SMALL_PROJECT_CONTRACT_AMOUNT", "SMALL_PROJECT_PRICING_METHOD", "LUMP_SUM_CONTRACT_SUM", "EXTERNAL_CONTRACT_AMOUNT", "OWNER_TARGET_BUDGET", "GMP_AMOUNT"],
  }, owner, expected);
  const project = () => h.runtime.database.one("SELECT * FROM projects WHERE number = ?", id);
  return { id, contractId, save, project };
}

test("298400 proposal to 318400 contract updates Accounting, project state, billing, profit and WIP", async () => {
  const h = await harness();
  try {
    const f = await fixture(h);
    seed(h, "MEFFORD-SALES", `SALE-${f.id}`, "Sales Opportunities", { stage: "Awarded", awardedProjectNumber: f.id, estimatedValue: "298400", salesMetrics: { contractValue: 298400 } });
    const result = await f.save(318400);
    const sales = (await h.send("/api/records?projectId=MEFFORD-SALES")).records.find(row => row.id === `SALE-${f.id}`);
    assert.equal(sales.data.contractSales.contractValue, 318400);
    assert.equal(sales.data.contractSales.recognizedValue, 0);
    assert.equal(sales.data.contractSales.pendingSignature, true);
    assert.equal(result.project.currentContractAmount, "318400.00", "The open work screen receives the new current amount immediately");
    assert.equal(f.project().contract_amount, "318400.00");
    assert.equal(f.project().current_contract_amount, "318400.00");
    assert.equal(h.row(f.id, "OWNER-BILLING-SETUP").data.contractAmount, "318400.00");
    assert.equal(h.row("MEFFORD-ACCOUNTING", f.contractId).data.contractAmount, "318400.00");
    seed(h, f.id, "COST-REGRESSION", "Job Cost Actual", { amount: 135500.86 }, "Posted");
    const accounting = (await h.send("/api/accounting")).projects.find(project => project.number === f.id);
    assert.equal(accounting.currentContract, 318400);
    assert.equal(accounting.projectedProfit, 47398.27);
    assert.ok(Math.abs(accounting.projectedMargin - 47398.27 / 318400) < 1e-12);
    assert.equal(accounting.recognizedRevenue, 0, "An unsigned price revision is not earned construction revenue");
    const reports = await h.send(`/api/financial-reports?projectId=${f.id}&asOf=${today}`);
    const financial = reports.reports.find(report => report.type === "project-financials").rows.find(row => row.id === f.id);
    assert.equal(financial.cells[1], 318400);
    assert.equal(financial.cells[7], 47398.27);
    assert.equal(h.row(f.id, "ESTIMATE-REGRESSION").data.contractValue, 298400);
    assert.equal(h.row(f.id, "PROPOSAL-REGRESSION").data.contractAmount, 298400);
    assert.equal(h.row(f.id, "BUDGET-REGRESSION").data.originalBudget, 271001.73);
    assert.notEqual(f.project().owner_contract_status, "Executed", "A price edit does not execute or authorize the contract");
  } finally { await h.close(); }
});

test("all owner contract paths rebase increases and decreases without dropping or doubling current adjustments", async () => {
  const h = await harness();
  try {
    for (const type of ["Time & Materials", "Plan & Spec Lump Sum", "Design-Build GMP", "Design-Build Lump Sum", "External Contract"]) {
      const f = await fixture(h, type);
      seed(h, f.id, "CO-ADD", "Change Orders", { approvedTotal: 12500.37 }, "Executed");
      seed(h, f.id, "CO-DEDUCT", "Change Orders", { approvedTotal: -2500.12 }, "Executed");
      seed(h, f.id, "CO-PENDING", "Change Orders", { approvedTotal: 9999 }, "Draft");
      h.runtime.database.sqlite.prepare("UPDATE projects SET current_contract_amount = '308400.25' WHERE number = ?").run(f.id);
      for (const [base, total] of [[318400, 328400.25], [318400, 328400.25], [280000.53, 290000.78]]) {
        const result = await f.save(base);
        assert.equal(Number(result.project.currentContractAmount), total, type);
        assert.equal(Number(f.project().current_contract_amount), total, type);
      }
      assert.equal(h.row(f.id, "CO-ADD").data.approvedTotal, 12500.37);
      assert.equal(h.row(f.id, "CO-DEDUCT").data.approvedTotal, -2500.12);
    }
  } finally { await h.close(); }
});

test("existing Bloomington-style stale totals repair on load once, including executed change orders", async () => {
  const h = await harness();
  try {
    for (const change of [0, 10000.25, -3000.17]) {
      const f = await fixture(h);
      await f.save(318400);
      if (change) seed(h, f.id, "CO-LEGACY", "Change Orders", { approvedTotal: change }, "Executed");
      h.runtime.database.sqlite.prepare("UPDATE projects SET current_contract_amount = ? WHERE number = ?").run((298400 + change).toFixed(2), f.id);
      const before = h.runtime.database.query("SELECT * FROM command_records WHERE project_id = ?", f.id);
      const projects = (await h.send("/api/projects")).projects;
      assert.equal(Number(projects.find(project => project.number === f.id).currentContractAmount), 318400 + change);
      const accounting = (await h.send("/api/accounting")).projects.find(project => project.number === f.id);
      assert.equal(accounting.currentContract, 318400 + change);
      assert.deepEqual(h.runtime.database.query("SELECT * FROM command_records WHERE project_id = ?", f.id), before);
      const audit = h.runtime.database.query("SELECT old_value, new_value FROM record_audits WHERE project_id = ? AND field_name = 'Current Contract Reconciled'", f.id);
      assert.deepEqual(audit.map(row => ({ ...row })), [{ old_value: (298400 + change).toFixed(2), new_value: (318400 + change).toFixed(2) }]);
    }
  } finally { await h.close(); }
});

test("reconciliation leaves unexplained balances intact and cannot run through unauthorized Accounting access", async () => {
  const h = await harness();
  try {
    const f = await fixture(h);
    await f.save(318400);
    h.runtime.database.sqlite.prepare("UPDATE projects SET current_contract_amount = '298400.00' WHERE number = ?").run(f.id);
    await h.send("/api/accounting", { actor: superintendent, expected: 403 });
    assert.equal(f.project().current_contract_amount, "298400.00");
    h.runtime.database.sqlite.prepare("UPDATE projects SET current_contract_amount = '310000.00' WHERE number = ?").run(f.id);
    await h.send("/api/accounting");
    assert.equal(f.project().current_contract_amount, "310000.00", "Do not guess at an imported or unexplained adjustment");
    const result = await f.save(328400);
    assert.equal(result.project.currentContractAmount, "320000.00", "Preserve the existing adjustment when rebasing");
  } finally { await h.close(); }
});

test("contract save and legacy repair failures cannot leave partial financial writes or phantom audits", async () => {
  const h = await harness();
  try {
    const f = await fixture(h);
    await f.save(318400);
    const before = h.runtime.database.query("SELECT * FROM command_records WHERE project_id IN (?, 'MEFFORD-ACCOUNTING')", f.id);
    h.runtime.database.injectFailure({ pattern: /INSERT INTO owner_contract_revisions/, once: true });
    await f.save(328400, 500);
    assert.equal(f.project().current_contract_amount, "318400.00");
    assert.deepEqual(h.runtime.database.query("SELECT * FROM command_records WHERE project_id IN (?, 'MEFFORD-ACCOUNTING')", f.id), before);
    h.runtime.database.sqlite.prepare("UPDATE projects SET current_contract_amount = '298400.00' WHERE number = ?").run(f.id);
    h.runtime.database.injectFailure({ pattern: /UPDATE projects SET current_contract_amount = \?, updated_at = \? WHERE number =/, once: true });
    await h.send("/api/accounting", { expected: 500 });
    assert.equal(f.project().current_contract_amount, "298400.00");
    assert.equal(h.runtime.database.one("SELECT COUNT(*) AS n FROM record_audits WHERE project_id = ? AND field_name = 'Current Contract Reconciled'", f.id).n, 0);
    await h.send("/api/accounting");
    assert.equal(f.project().current_contract_amount, "318400.00");
  } finally { await h.close(); }
});

test("negotiated pricing survives owner review and both signatures through actual lifecycle handlers", async () => {
  const h = await harness();
  try {
    const deal = await saleToExecutedContract(h, { ...scenarios[3], negotiatedContractValue: 318400 }, "CONTRACT-REPRICE");
    const accounting = (await h.send("/api/accounting")).projects.find(project => project.number === deal.projectId);
    assert.equal(accounting.currentContract, 318400);
    assert.equal(accounting.contractStatus, "Executed");
    assert.equal(h.row(deal.projectId, `ESTIMATE-${deal.opportunityId}`).data.contractValue, deal.summary.contractValue);
    assert.equal(h.outbound.length, 0);
  } finally { await h.close(); }
});
