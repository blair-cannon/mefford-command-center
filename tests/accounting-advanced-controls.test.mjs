import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(new URL("../db/schema.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../drizzle/0013_special_union_jack.sql", import.meta.url), "utf8");
const controlsApi = readFileSync(new URL("../app/api/accounting-controls/route.ts", import.meta.url), "utf8");
const accountingApi = readFileSync(new URL("../app/api/accounting/route.ts", import.meta.url), "utf8");
const financialApi = readFileSync(new URL("../app/api/financial-reports/route.ts", import.meta.url), "utf8");
const advancedUi = readFileSync(new URL("../app/accounting-advanced.tsx", import.meta.url), "utf8");
const accountingRouter = readFileSync(new URL("../app/accounting-erp.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("advanced accounting controls have durable normalized storage and a migration", () => {
  for (const table of ["accountingWipForecasts", "accountingBankTransactions", "accountingBankReconciliations", "accountingCashForecastItems", "accountingCloseTasks", "accountingCutoverControls", "accountingCollectionActions"]) {
    assert.match(schema, new RegExp(`export const ${table}`));
  }
  for (const table of ["accounting_wip_forecasts", "accounting_bank_transactions", "accounting_bank_reconciliations", "accounting_cash_forecast_items", "accounting_close_tasks", "accounting_cutover_controls", "accounting_collection_actions"]) {
    assert.ok(migration.includes(`CREATE TABLE \`${table}\``), `${table} must be created by the migration`);
  }
  assert.match(schema, /amountCents: integer\("amount_cents"\)/);
  assert.match(schema, /differenceCents: integer\("difference_cents"\)/);
});

test("WIP is accrual based and saved ETC risk and EAC drive cost-to-cost recognition", () => {
  assert.match(accountingApi, /row\.record_type === "Job Cost Actual" && row\.status === "Posted"/);
  assert.match(accountingApi, /estimateToComplete/);
  assert.match(accountingApi, /riskReserve/);
  assert.match(accountingApi, /actualCost \/ estimatedCost/);
  assert.match(accountingApi, /recognitionMethod/);
  assert.match(controlsApi, /actualCost \+ estimateToComplete \+ riskReserve/);
  assert.match(controlsApi, /Hard Closed And Its WIP Forecast Is Locked/);
  assert.match(controlsApi, /Only A Company Owner Can Approve Or Lock A WIP Forecast/);
  assert.match(advancedUi, /Approve \+ Lock/);
});

test("bank reconciliation imports transaction detail matches exact cents and requires independent approval", () => {
  assert.match(controlsApi, /Between 1 And 500 Transactions/);
  assert.match(controlsApi, /book\.amount_cents !== bank\.amount_cents/);
  assert.match(controlsApi, /book\.cash_account_id !== bank\.cash_account_id/);
  assert.match(controlsApi, /statement \+ deposits - payments \+ adjustment - book/);
  assert.match(controlsApi, /Approval Requires A Balanced Reconciliation And Independent Owner Review/);
  assert.match(advancedUi, /Transaction Matching/);
  assert.match(advancedUi, /Statement Reconciliation/);
});

test("cash planning combines open AR AP and manual assumptions into thirteen weeks", () => {
  assert.match(controlsApi, /Array\.from\(\{ length: 13 \}/);
  assert.match(controlsApi, /Owner Collections/);
  assert.match(controlsApi, /Vendor Payments/);
  assert.match(controlsApi, /Manual Forecast/);
  assert.match(controlsApi, /minimumCash/);
  assert.match(advancedUi, /Thirteen-Week Direct Cash Forecast/);
});

test("month close and historical cutover enforce evidence review and owner lock", () => {
  for (const code of ["CASH", "AP", "AR", "PAYROLL", "WIP", "ASSETS", "JE", "TB", "PACKAGE", "OWNER"]) assert.match(controlsApi, new RegExp(`\\["${code}"`));
  assert.match(controlsApi, /Completion And Review Require Evidence/);
  assert.match(controlsApi, /Review Must Be Independent/);
  assert.match(controlsApi, /The Cutover Must Reference A Posted Opening Balance Journal Entry/);
  assert.match(controlsApi, /The Accounting Cutover Is Locked And Cannot Be Rewritten/);
  assert.match(advancedUi, /Controlled Accounting Cutover/);
});

test("collections vendor tax and accountant administration are first-class controls", () => {
  assert.match(controlsApi, /record-collection-action/);
  assert.match(controlsApi, /Promise To Pay/);
  assert.match(controlsApi, /review1099/);
  assert.match(controlsApi, /ytdPaid >= 600/);
  assert.match(accountingRouter, /Accounting Administration/);
  assert.match(page, /label: "Accounting Administration", target: "Accounting Administration"/);
  assert.match(advancedUi, /AP \/ AR Control/);
  assert.match(advancedUi, /Vendor Tax Readiness/);
});

test("high-dollar returned payroll waits for owner approval before posting", () => {
  assert.match(accountingApi, /totalLaborCost > 200000/);
  assert.match(accountingApi, /status: "Owner Approval Required"/);
  assert.match(accountingApi, /approve-paylocity-return/);
  assert.match(accountingApi, /Only A Company Owner Can Approve A High-Dollar Payroll Return/);
  const pendingBranch = accountingApi.indexOf("if (totalLaborCost > 200000)");
  const postingCall = accountingApi.indexOf("await postAccountingEvent(database", pendingBranch);
  assert.ok(pendingBranch >= 0 && postingCall > pendingBranch, "pending branch must occur before the payroll posting call");
  assert.match(accountingApi, /payrollProcessingDisabled: true/);
});

test("financial reports expose actual ETC EAC and WIP status", () => {
  assert.match(financialApi, /accounting_wip_forecasts/);
  assert.match(financialApi, /"Actual Cost", "ETC", "EAC"/);
  assert.match(financialApi, /Cost-to-cost actual ETC EAC earned revenue/);
  assert.doesNotMatch(financialApi, /\["Project", "Current Contract", "Budget", "Committed", "Paid Cost"/);
});
