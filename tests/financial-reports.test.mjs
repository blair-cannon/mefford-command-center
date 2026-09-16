import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const erp = fs.readFileSync(new URL("../app/accounting-erp.tsx", import.meta.url), "utf8");
const ui = fs.readFileSync(new URL("../app/financial-reports.tsx", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../app/api/financial-reports/route.ts", import.meta.url), "utf8");
const records = fs.readFileSync(new URL("../app/api/records/route.ts", import.meta.url), "utf8");
const policy = fs.readFileSync(new URL("../lib/financial-reports.ts", import.meta.url), "utf8");

test("Financial Reports uses its dedicated permanent workspace", () => {
  assert.match(erp, /mode === "Financial Reports"/);
  assert.match(erp, /<FinancialReportsWorkspace actor=\{actor\}/);
  assert.match(ui, /\/api\/financial-reports/);
  assert.match(api, /FINANCIAL_REPORT_RUN_TYPE/);
  assert.match(records, /CONTROLLED_FINANCIAL_TYPES = new Set\(\["Financial Report Run"/);
  assert.match(records, /Controlled Accounting Or Financial Reports Workflow/);
});

test("report builder covers every internal operational report", () => {
  for (const type of ["project-financials", "management-profitability", "wip", "ap-aging", "ar-aging", "commitment-audit", "cash-movement", "backlog"]) {
    assert.match(policy, new RegExp(`"${type}"`));
  }
  assert.match(api, /projectFinancialReport/);
  assert.match(api, /commitmentAuditReport/);
  assert.match(api, /cashMovementReport/);
});

test("report runs are server-recomputed immutable audited snapshots", () => {
  assert.match(api, /buildSnapshot\(database, asOf, projectId\)/);
  assert.match(api, /immutableSnapshot: true/);
  assert.match(api, /Financial Report Snapshot/);
  assert.match(api, /record_audits/);
  assert.match(ui, /Run Report \+ Save Snapshot/);
  assert.match(ui, /Permanent Snapshot/);
});

test("as-of project comparisons drilldown and exports are operational", () => {
  assert.match(ui, /As-Of Date/);
  assert.match(ui, /Project<select/);
  assert.match(policy, /Current Month/);
  assert.match(policy, /Prior Year/);
  assert.match(ui, /<details[^>]+className="financial-source-row"/);
  assert.match(ui, /row\.sourceType/);
  assert.doesNotMatch(ui, /Open any row to drill down/);
  assert.match(ui, /application\/vnd\.ms-excel/);
  assert.match(ui, /Print \/ Save PDF/);
});

test("statutory reports and scheduled delivery remain truthfully disconnected", () => {
  assert.match(api, /GAAP balance sheet statutory P&L and tax-basis cash flow are not fabricated/);
  assert.match(api, /scheduledDeliveryPerformed: false/);
  assert.doesNotMatch(ui, /Scheduled Delivery Is Intentionally Off/);
  assert.match(ui, /Print \/ Save PDF/);
});
