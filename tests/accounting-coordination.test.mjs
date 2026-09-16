import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const apiSource = readFileSync(new URL("../app/api/accounting/route.ts", import.meta.url), "utf8");
const controlSource = readFileSync(new URL("../app/accounting-control.tsx", import.meta.url), "utf8");
const apSource = readFileSync(new URL("../app/accounts-payable.tsx", import.meta.url), "utf8");
const billingSource = readFileSync(new URL("../app/owner-billing.tsx", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const ledgerSource = readFileSync(new URL("../app/general-ledger.tsx", import.meta.url), "utf8");

test("Accounting Command is the coordinated accounting landing workspace", () => {
  assert.match(pageSource, /label: "Accounting Command", target: "Accounting Command"/);
  for (const phrase of [
    "SIGNED ACTIVE CONTRACTS",
    "Awaiting Signatures",
    "Accounting Command",
    "Coordination Exceptions",
    "Coordinated Project Ledger",
    "OWNER RECEIVABLES",
  ]) assert.match(controlSource, new RegExp(phrase));
});

test("invoice approval accrues project cost and payment clearing only clears the liability", () => {
  assert.match(apSource, /release-payment-batch/);
  assert.match(apSource, /clear-payment-batch/);
  assert.match(apSource, /Match Clear And Post/);
  assert.match(apiSource, /Only A Company Owner Can Release A Payment Batch/);
  assert.match(apiSource, /clearingConfirmation/);
  assert.match(apiSource, /ensureApInvoiceAccrued/);
  assert.match(apiSource, /source: "Accounts Payable Accrual"/);
  assert.match(apiSource, /apPaymentLines/);
  assert.match(apiSource, /Accounts Payable Was Cleared Without Duplicating Project Cost/);
});

test("Owner billing continues through AR and cash receipt coordination", () => {
  assert.match(billingSource, /Mark Sent And Open AR/);
  assert.match(billingSource, /Record Owner Receipt/);
  assert.match(billingSource, /Post Receipt To Accounting And Project/);
  assert.match(apiSource, /recordType: "AR Invoice"/);
  assert.match(apiSource, /recordType: "Owner Receipt"/);
  assert.match(apiSource, /receivedToDate/);
  assert.match(apiSource, /accountsReceivable/);
});

test("Cash reconciliation Paylocity reporting WIP and reporting use the same accounting endpoint", () => {
  for (const phrase of [
    "Cash Accounts And Reconciliations",
    "Paylocity Payroll Period",
    "Project WIP And Close",
    "Live Financial Report",
    "Returned Paylocity Reports",
    "Download Paylocity CSV",
    "Record Paylocity Return",
  ]) assert.match(controlSource, new RegExp(phrase));
  assert.match(apiSource, /save-cash-account/);
  assert.match(apiSource, /save-payroll-report/);
  assert.match(apiSource, /recordType: "Payroll Report"/);
  assert.match(apiSource, /payrollProcessingDisabled: true/);
  assert.match(apiSource, /paymentExecutionDisabled: true/);
  assert.match(apiSource, /taxFilingDisabled: true/);
  assert.doesNotMatch(apiSource, /post-payroll-allocation/);
  assert.match(apiSource, /noSensitiveAccountData: true/);
});

test("Paylocity packet and returned report have a controlled accounting boundary", () => {
  assert.match(controlSource, /mefford-paylocity-payroll-packet-/);
  assert.match(controlSource, /selectedPayrollRuns\.flatMap/);
  assert.match(controlSource, /FILE HANDOFF ONLY — NOT TRANSMITTED/);
  assert.match(controlSource, /value="Paylocity" disabled/);
  assert.match(controlSource, /Select Active Employee/);
  assert.doesNotMatch(controlSource, /Export All CSV/);
  assert.match(apiSource, /payrollCompany: "Paylocity"/);
  assert.match(apiSource, /record-paylocity-return/);
  assert.match(apiSource, /recordType: "Paylocity Payroll Return"/);
  assert.match(apiSource, /grossWages \+ employerTaxes \+ employerBenefits/);
  assert.match(apiSource, /toCents\(totalLaborCost\) !== toCents\(allocatedLaborCost\)/);
  assert.match(apiSource, /source: "Paylocity Return"/);
  assert.match(apiSource, /recordType: "Job Cost Actual"/);
  assert.match(apiSource, /providerConnectionDisabled: true/);
  assert.match(apiSource, /is_active = 1 ORDER BY display_name/);
});

test("General Ledger supports balanced journals opening balances trial balance and immutable reversals", () => {
  assert.match(pageSource, /label: "General Ledger", target: "General Ledger"/);
  assert.match(ledgerSource, /New Journal Entry/);
  assert.match(ledgerSource, /Enter Opening Balances/);
  assert.match(ledgerSource, /Paste From Spreadsheet/);
  assert.match(ledgerSource, /Trial Balance/);
  assert.match(ledgerSource, /Independent Approval Is Required/);
  assert.match(apiSource, /save-journal-entry/);
  assert.match(apiSource, /submit-journal-entry/);
  assert.match(apiSource, /approve-journal-entry/);
  assert.match(apiSource, /post-journal-entry/);
  assert.match(apiSource, /The Preparer Cannot Approve Their Own Journal Entry/);
  assert.match(apiSource, /Debits And Credits Must Balance/);
  assert.match(apiSource, /postedSnapshotLocked: true/);
  assert.match(apiSource, /A separate balanced reversal draft/);
  assert.match(apiSource, /close-accounting-period/);
  assert.match(apiSource, /reopen-accounting-period/);
  assert.match(ledgerSource, /Period Close/);
});

test("the global shell separates friendly operations from dense accountant mode", () => {
  assert.match(pageSource, /accounting-app-mode/);
  assert.match(pageSource, /operations-app-mode/);
});
