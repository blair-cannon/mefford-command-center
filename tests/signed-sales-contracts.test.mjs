import assert from "node:assert/strict";
import test from "node:test";
import { resolveSalesContract, withSalesContract, opportunityContract, signedSalesRecords } from "../lib/sales-contract.ts";
import { salesOpportunityValue } from "../lib/sales-opportunity-value.ts";
import { createDashboardSession } from "../lib/dashboard-display-auth.ts";
import { harness, owner, pm, today, scenarios, saleToExecutedContract } from "./support/project-workflow-harness.mjs";

const project = { number: "SYNTHETIC-ONLY", status: "Active", ownerContractRecordId: "CONTROLLED",
  ownerContractType: "Plan & Spec Lump Sum", ownerContractStatus: "Executed",
  contractAmount: "318400.00", currentContractAmount: "318400.00" };
const execution = { executionHash: "synthetic-test-evidence", executedAt: "2027-01-01T05:01:00.000Z",
  signatures: { owner: { signedAt: "2026-12-31T14:00:00.000Z" }, mefford: { signedAt: "2027-01-01T05:01:00.000Z" } } };
const award = { stage: "Awarded", awardedProjectNumber: project.number, awardDate: "2026-12-01",
  estimatedValue: "298400", salesMetrics: { contractValue: 298400 } };

test("a negotiated contract replaces award value while unsigned, one-signature and unsupported execution states sell nothing", () => {
  for (const [status, data] of [["Draft", {}], ["Owner Signed", { ...execution, signatures: { owner: execution.signatures.owner } }],
    ["Executed", {}], ["Executed", { ...execution, signatures: { owner: execution.signatures.owner } }]]) {
    const contract = resolveSalesContract({ ...project, ownerContractStatus: status }, { status, data });
    const record = { data: withSalesContract(award, new Map([[project.number, contract]])) };
    assert.equal(salesOpportunityValue(record.data), 318400);
    assert.equal(contract.recognizedValue, 0);
    assert.equal(contract.pendingSignature, true);
    assert.equal(signedSalesRecords([record]).length, 0);
  }
  assert.equal(signedSalesRecords([{ data: award }]).length, 0, "An award alone never authorizes a sale");
  assert.equal(withSalesContract({ ...award, contractSales: { signed: true, recognizedValue: 999999 } }, new Map()).contractSales, null);
});

test("signed sales use the completed-signature year, current contract cents and one entry per project", () => {
  const signed = resolveSalesContract(project, { status: "Executed", data: execution });
  const record = { id: "FIRST", data: withSalesContract(award, new Map([[project.number, signed]])) };
  assert.equal(signed.signedDate, "2027-01-01");
  assert.equal(signedSalesRecords([record], 2026).length, 0);
  assert.equal(signedSalesRecords([record, { ...record, id: "DUPLICATE" }], 2027).length, 1);
  assert.equal(opportunityContract(record.data).recognizedValue, 318400);
  assert.equal(resolveSalesContract({ ...project, status: "Completed" }, { status: "Executed", data: execution }).recognizedValue, 318400, "Completed jobs remain historical sales");
  assert.equal(resolveSalesContract({ ...project, status: "Deletion Quarantine" }, { status: "Executed", data: execution }).recognizedValue, 0);
  const changed = resolveSalesContract({ ...project, currentContractAmount: "328400.25" }, { status: "Executed", data: execution });
  assert.equal(changed.recognizedValue, 328400.25, "Executed adjustments stay aligned with the current contract");
  assert.equal(changed.signedDate, signed.signedDate);
  const easternBoundary = resolveSalesContract(project, { status: "Executed", data: { ...execution, executedAt: "2027-01-01T04:59:00.000Z" } });
  assert.equal(easternBoundary.signedDate, "2026-12-31");
});

test("signed Phase 1 design authority cannot count the unsigned construction GMP as sales", () => {
  const state = resolveSalesContract({ ...project, ownerContractType: "Design-Build GMP", ownerContractStatus: "Phase 1 Executed" }, {
    status: "Phase 1 Executed", data: { contractType: "Design-Build GMP", phaseExecutions: { phase1: { ...execution, fields: { PHASE_ONE_DESIGN_AND_PRECONSTRUCTION_FEE: "2500.00" } } } },
  });
  assert.equal(state.signed, false);
  assert.equal(state.recognizedValue, 0);
  assert.equal(state.pendingSignature, true);
});

test("real award, repricing, one signature and countersignature agree across sales, display, meetings and accounting", async () => {
  const h = await harness();
  try {
    const display = await createDashboardSession();
    const headers = { cookie: `mefford_dashboard_session=${display.token}` };
    await h.save("MEFFORD-SALES", "Sales Goals", `SALES-GOALS-${today.slice(0,4)}`, "Active", { year: Number(today.slice(0,4)), companyGoal: 500000 });
    const checked = [];
    async function check(stage, info, signed, expectedValue) {
      const sales = await h.send("/api/records?projectId=MEFFORD-SALES");
      const record = sales.records.find(row => row.id === info.opportunityId);
      const state = opportunityContract(record.data);
      assert.equal(state.contractValue, expectedValue, stage);
      assert.equal(state.signed, signed, stage);
      assert.equal(state.recognizedValue, signed ? expectedValue : 0, stage);
      assert.equal(state.pendingSignature, !signed, stage);
      assert.equal(salesOpportunityValue(record.data), expectedValue, stage);
      const compact = await h.send("/api/records?projectId=MEFFORD-SALES&view=contract-sales");
      assert.deepEqual(compact.contracts.find(row => row.projectNumber === info.projectId), state);
      assert.ok(!JSON.stringify(compact).includes("signatureImage"), "Refresh never exposes signature images");
      const screens = await h.send("/api/dashboard-display", { headers });
      const board = screens.dashboards.find(row => row.id === "sales");
      const money = value => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
      assert.equal(board.metrics.find(row => row.label === "Signed Sales").value, money(signed ? expectedValue : 0), stage);
      assert.equal(board.sections.find(row => row.title === "Contracts To Sign").rows.length, signed ? 0 : 1, stage);
      if (!signed) assert.equal(board.sections.find(row => row.title === "Contracts To Sign").rows[0].value, money(expectedValue));
      for (const meetingType of ["Weekly L10", "Sales/Estimating Department"]) {
        const meeting = await h.send(`/api/meetings?projectId=MEFFORD-COMPANY&meetingType=${encodeURIComponent(meetingType)}`);
        assert.equal(meeting.refresh.error, undefined);
        assert.equal(meeting.agendaPreview.find(row => row.source.id === "sales-awarded").metric.value, signed ? expectedValue : 0, `${stage} ${meetingType}`);
      }
      const doctrine = await h.send("/api/operating-doctrine");
      const metrics = doctrine.scorecards.find(row => row.doctrine.role === "Sales").metrics;
      assert.equal(metrics.find(row => row.label === "Contracts To Sign").value, signed ? "0" : "1", stage);
      const accounting = await h.send("/api/accounting");
      assert.equal(accounting.summary.currentContracts, signed ? expectedValue : 0, stage);
      assert.equal(accounting.summary.pendingContractValue, signed ? 0 : expectedValue, stage);
      const visibleProject = (await h.send("/api/projects")).projects.find(row => row.number === info.projectId);
      assert.equal(visibleProject.contractAuthorized, signed, stage);
      assert.equal(Number(visibleProject.currentContractAmount), expectedValue, stage);
      if (!signed) {
        await h.save(info.projectId, "Owner Billing Setup", "OWNER-BILLING-SETUP", "Locked", { sovLines: [{ id: "SOV-1", scheduledValue: expectedValue }] }, owner, 409);
        const invoice = { projectNumber: info.projectId, billingPeriod: today.slice(0, 7), currentEarned: 100,
          currentPaymentDue: 100, cumulativeEarned: 100, retainageThisPeriod: 0,
          lines: [{ id: "SOV-1", scheduledValue: expectedValue, totalThisPeriod: 100 }] };
        await h.save(info.projectId, "Owner Billing", `BLOCKED-${stage}`, "PM Preparation", invoice, pm);
        await h.save(info.projectId, "Owner Billing", `BLOCKED-${stage}`, "Accountant Review", invoice, pm, 409);
      }
      checked.push(stage);
    }
    const job = await saleToExecutedContract(h, {
      ...scenarios[0], negotiatedContractValue: 318400,
      afterAward: info => check("AWARD", info, false, info.summary.contractValue),
      afterContractSave: info => check("NEGOTIATED", info, false, 318400),
      afterOwnerSignature: info => check("OWNER-SIGNED", info, false, 318400),
    }, "SIGNED-SALES");
    await check("EXECUTED", job, true, 318400);
    assert.deepEqual(checked, ["AWARD", "NEGOTIATED", "OWNER-SIGNED", "EXECUTED"]);
    assert.equal(h.row("MEFFORD-SALES", job.opportunityId).data.salesMetrics.contractValue, job.summary.contractValue, "The immutable award history is retained");
    assert.equal(h.row("MEFFORD-SALES", job.opportunityId).data.contractSales, undefined, "Live contract truth is never stored as another stale copy");
    assert.equal(h.outbound.length, 0);
  } finally { await h.close(); }
});
