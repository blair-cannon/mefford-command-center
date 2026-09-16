import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  apAccrualLines,
  apPaymentLines,
  ownerBillingLines,
  ownerReceiptLines,
  payrollReturnLines,
  periodBounds,
  postAccountingEvent,
  toCents,
} from "../lib/accounting-ledger.ts";

const accountingApi = readFileSync(new URL("../app/api/accounting/route.ts", import.meta.url), "utf8");
const recordsApi = readFileSync(new URL("../app/api/records/route.ts", import.meta.url), "utf8");
const ledgerSource = readFileSync(new URL("../lib/accounting-ledger.ts", import.meta.url), "utf8");
const schemaSource = readFileSync(new URL("../db/schema.ts", import.meta.url), "utf8");
const ledgerUi = readFileSync(new URL("../app/general-ledger.tsx", import.meta.url), "utf8");

function totals(lines) {
  return lines.reduce((result, line) => ({ debit: result.debit + Number(line.debitCents || 0), credit: result.credit + Number(line.creditCents || 0) }), { debit: 0, credit: 0 });
}

class FakeD1 {
  constructor() {
    this.periods = new Map();
    this.events = new Map();
    this.entries = new Map();
    this.lines = [];
  }

  prepare(sql) {
    return {
      bind: (...params) => ({
        run: async () => this.execute(sql, params),
        first: async () => this.first(sql, params),
        all: async () => ({ results: [] }),
        sql,
        params,
      }),
    };
  }

  async batch(statements) {
    for (const statement of statements) await this.execute(statement.sql, statement.params);
    return [];
  }

  async first(sql, params) {
    if (sql.includes("FROM accounting_periods WHERE id")) return this.periods.get(params[0]) || null;
    if (sql.includes("FROM accounting_events WHERE idempotency_key")) return this.events.get(params[0]) || null;
    return null;
  }

  async execute(sql, params) {
    if (sql.startsWith("INSERT INTO accounting_periods")) {
      if (!this.periods.has(params[0])) this.periods.set(params[0], { id: params[0], period_start: params[1], period_end: params[2], status: "Open", soft_closed_by: "", soft_closed_email: "", soft_closed_at: null, hard_closed_by: "", hard_closed_email: "", hard_closed_at: null, reopened_by: "", reopened_email: "", reopened_at: null, reopen_reason: "", updated_at: "now" });
    } else if (sql.startsWith("INSERT INTO accounting_events")) {
      this.events.set(params[1], { id: params[0], idempotencyKey: params[1], amountCents: params[8] });
    } else if (sql.startsWith("INSERT INTO accounting_journal_entries")) {
      this.entries.set(params[0], { id: params[0], eventId: params[1], debitCents: params[16], creditCents: params[17] });
    } else if (sql.startsWith("INSERT INTO accounting_journal_lines")) {
      this.lines.push({ id: params[0], entryId: params[1], debitCents: params[10], creditCents: params[11] });
    }
    return { success: true };
  }
}

test("money is normalized to integer cents and periods have exact calendar bounds", () => {
  assert.equal(toCents(1234.56), 123456);
  assert.equal(toCents("1,234.56"), 0);
  assert.deepEqual(periodBounds("2028-02"), { start: "2028-02-01", end: "2028-02-29" });
});

test("automatic AP AR receipt and payroll postings are balanced to the cent", () => {
  const ap = apAccrualLines({ id: "AP-1", vendor: "Trade Partner", invoiceNumber: "INV-9", allocations: [
    { id: "a", destination: "26001", code: "2600.00", commitmentType: "Subcontract", amount: 1250.35 },
    { id: "b", destination: "Company Overhead", code: "OFFICE", amount: 49.65 },
  ] });
  assert.deepEqual(totals(ap), { debit: 130000, credit: 130000 });
  assert.equal(ap.at(-1).accountNumber, "4020");
  assert.deepEqual(totals(apPaymentLines(1300, "Payment")), { debit: 130000, credit: 130000 });
  assert.deepEqual(totals(ownerBillingLines(8000.01, "26001", "Billing 1")), { debit: 800001, credit: 800001 });
  assert.deepEqual(totals(ownerReceiptLines(2500, "26001", "Deposit")), { debit: 250000, credit: 250000 });
  assert.deepEqual(totals(payrollReturnLines([{ id: "p", destination: "26001", code: "LABOR", amount: 950.25 }, { id: "o", destination: "Company Overhead", code: "OFFICE", amount: 49.75 }], "Payroll")), { debit: 100000, credit: 100000 });
});

test("posting is idempotent and creates one immutable balanced event", async () => {
  const database = new FakeD1();
  const input = { idempotencyKey: "OWNER_BILLING:BILL-1", eventType: "Owner Invoice Sent", sourceType: "Owner Billing", sourceProjectId: "26001", sourceRecordId: "BILL-1", eventDate: "2026-08-22", reference: "BILL-1", description: "Owner Invoice", actor: { name: "Amanda Neal", email: "amanda@meffcon.com" }, lines: ownerBillingLines(1000, "26001", "Owner Invoice") };
  const first = await postAccountingEvent(database, input);
  const second = await postAccountingEvent(database, input);
  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(database.events.size, 1);
  assert.equal(database.entries.size, 1);
  assert.equal(database.lines.length, 2);
  assert.deepEqual([...database.entries.values()][0], { id: first.entryId, eventId: first.eventId, debitCents: 100000, creditCents: 100000 });
});

test("hard-closed periods reject both automatic and manual posting paths", async () => {
  const database = new FakeD1();
  const bounds = periodBounds("2026-07");
  database.periods.set("2026-07", { id: "2026-07", period_start: bounds.start, period_end: bounds.end, status: "Hard Closed" });
  await assert.rejects(() => postAccountingEvent(database, { idempotencyKey: "AP_ACCRUAL:AP-7", eventType: "AP Invoice Approved", sourceType: "AP Invoice", sourceRecordId: "AP-7", eventDate: "2026-07-31", reference: "AP-7", description: "Closed Period Invoice", actor: { name: "Amanda Neal", email: "amanda@meffcon.com" }, lines: apPaymentLines(10, "Closed") }), /Hard Closed/);
  assert.match(ledgerSource, /postManualJournalSnapshot[\s\S]*ensureAccountingPeriod\(database, entry\.entry_date\)/);
});

test("AP cost accrues on approval and payment clearing only reduces AP and cash", () => {
  assert.match(recordsApi, /record\.status === "Approved Unpaid"[\s\S]*accrueApprovedApInvoice/);
  assert.match(recordsApi, /source: "Accounts Payable Accrual"/);
  assert.match(accountingApi, /idempotencyKey: `AP_ACCRUAL:\$\{invoice\.id\}`/);
  assert.match(accountingApi, /idempotencyKey: `AP_PAYMENT:\$\{invoice\.id\}`/);
  assert.match(accountingApi, /Accounts Payable Was Cleared Without Duplicating Project Cost/);
});

test("the normalized ledger has dedicated event header line and period storage", () => {
  for (const table of ["accountingPeriods", "accountingEvents", "accountingJournalEntries", "accountingJournalLines"]) assert.match(schemaSource, new RegExp(`export const ${table}`));
  assert.match(schemaSource, /idempotencyKey: text\("idempotency_key"\)\.notNull\(\)\.unique\(\)/);
  assert.match(schemaSource, /debitCents: integer\("debit_cents"\)/);
  assert.match(schemaSource, /creditCents: integer\("credit_cents"\)/);
  assert.match(ledgerUi, /Accounting Period Control/);
  assert.match(ledgerUi, /periodAction\(period.id, "Hard Closed"\)/);
  assert.match(ledgerUi, /Open Source Workspace/);
});
