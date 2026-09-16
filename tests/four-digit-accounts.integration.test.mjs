import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { ACCOUNT_NUMBER_RANGES, accountNumberError, currentAccountNumber, normalizeAccountReferences } from "../lib/accounting-numbering.ts";
import { COMMAND_CENTER_CHART_OF_ACCOUNTS } from "../app/accounting-data.ts";
import { buildAccountCatalog } from "../lib/accounting-catalog.ts";
import { postAccountingEvent, ownerBillingLines } from "../lib/accounting-ledger.ts";
import { harness, owner, accountant, today } from "./support/project-workflow-harness.mjs";

test("four-digit account policy covers every number and preserves the opening chart", () => {
  let next = 1000;
  for (const range of ACCOUNT_NUMBER_RANGES) { assert.equal(range.start, next); next = range.end + 1; }
  assert.equal(next, 10000);
  assert.equal(COMMAND_CENTER_CHART_OF_ACCOUNTS.length, 285);
  assert.equal(new Set(COMMAND_CENTER_CHART_OF_ACCOUNTS.map(account => account.accountNumber)).size, 285);
  for (const account of COMMAND_CENTER_CHART_OF_ACCOUNTS) {
    assert.equal(account.accountNumber, `${account.legacyAccountNumber}0`);
    assert.equal(accountNumberError(account.accountNumber, account.category), "");
  }
  assert.deepEqual(COMMAND_CENTER_CHART_OF_ACCOUNTS.filter(a => a.defaultStatus === "Inactive").map(a => a.accountNumber).sort(), ["1030", "4350", "6550"]);
  assert.equal(currentAccountNumber("111"), "1110"); assert.equal(currentAccountNumber("1111"), "1111");
  const value = normalizeAccountReferences({ accountNumber: "111", costCode: "0131.19", allocations: [{ destination: "26-001", code: "160" }, { destination: "Company Overhead", code: "960" }] });
  assert.equal(value.accountNumber, "1110"); assert.equal(value.originalAccountNumber, "111"); assert.equal(value.costCode, "0131.19");
  assert.equal(value.allocations[0].code, "160"); assert.equal(value.allocations[1].code, "9600");
  assert.throws(() => buildAccountCatalog([{ id: "111", title: "Legacy", status: "Active", type: "Chart Of Accounts" }, { id: "1110", title: "Collision", status: "Active", type: "Chart Of Accounts" }]), /Conflicting/);
});

test("account migration preserves posted history and combines legacy/current trial balances", async () => {
  const h = await harness();
  try {
    const db = h.runtime.database;
    await postAccountingEvent(db, { idempotencyKey: "LEGACY-RECEIVABLE", eventType: "Owner Invoice Issued", sourceType: "Owner Billing", sourceProjectId: "SYNTHETIC-LEGACY", sourceRecordId: "BILL-1", reference: "BILL-1", eventDate: today, description: "Legacy fixture", actor: owner, lines: ownerBillingLines(123.45, "Legacy fixture", "SYNTHETIC-LEGACY") });
    db.sqlite.exec("UPDATE accounting_journal_lines SET account_number = substr(account_number, 1, 3)");
    const originalLines = db.query("SELECT * FROM accounting_journal_lines ORDER BY id");
    const originalEvents = db.query("SELECT * FROM accounting_events ORDER BY id");
    const legacyJournal = JSON.stringify({ entryDate: today, reference: "LEGACY-ONLY", description: "Older record-format journal", totals: { debit: 5, credit: 5 }, lines: [{ accountNumber: "702", accountName: "Job Materials", debit: 5 }, { accountNumber: "402", accountName: "Accounts Payable", credit: 5 }] });
    db.sqlite.prepare("INSERT INTO command_records (project_id,id,record_type,title,owner,due,status,data_json) VALUES (?,?,?,?,?,?,?,?)").run("MEFFORD-ACCOUNTING", "LEGACY-ONLY", "Journal Entry", "Older Journal", owner.name, today, "Posted", legacyJournal);
    db.sqlite.prepare("INSERT INTO command_records (project_id,id,record_type,title,owner,due,status,data_json) VALUES (?,?,?,?,?,?,?,?)").run("MEFFORD-ACCOUNTING", "111", "Chart Of Accounts", "Accounts Receivable", owner.name, today, "Active", JSON.stringify({ category: "Current Assets", normalBalance: "Debit", note: "Retain review evidence" }));
    db.sqlite.exec("DROP TABLE accounting_account_number_crosswalk");
    const migration = await readFile(new URL("../drizzle/0034_four_digit_accounts.sql", import.meta.url), "utf8");
    await db.batch(migration.split("--> statement-breakpoint").map(sql => db.prepare(sql)));
    assert.equal(db.one("SELECT count(*) AS count FROM accounting_account_number_crosswalk").count, 900);
    assert.equal(db.one("SELECT account_number FROM accounting_account_number_crosswalk WHERE legacy_number = '111'").account_number, "1110");
    assert.deepEqual(db.query("SELECT * FROM accounting_journal_lines ORDER BY id"), originalLines);
    assert.deepEqual(db.query("SELECT * FROM accounting_events ORDER BY id"), originalEvents);
    const migrated = h.row("MEFFORD-ACCOUNTING", "111");
    assert.equal(migrated.status, "Active"); assert.equal(migrated.data.accountNumber, "1110"); assert.equal(migrated.data.note, "Retain review evidence");
    await h.save("MEFFORD-ACCOUNTING", "Chart Of Accounts", "1110", "Active", { category: "Current Assets", normalBalance: "Debit" }, owner, 409);
    await postAccountingEvent(db, { idempotencyKey: "CURRENT-RECEIVABLE", eventType: "Owner Invoice Issued", sourceType: "Owner Billing", sourceProjectId: "SYNTHETIC-CURRENT", sourceRecordId: "BILL-2", reference: "BILL-2", eventDate: today, description: "Current fixture", actor: owner, lines: ownerBillingLines(76.55, "Current fixture", "SYNTHETIC-CURRENT") });
    const result = await h.send("/api/accounting");
    const ar = result.trialBalance.filter(row => row.accountNumber === "1110");
    assert.equal(ar.length, 1); assert.equal(ar[0].netDebit, 200);
    assert.ok(result.trialBalance.every(row => /^[1-9]\d{3}$/.test(row.accountNumber)));
    assert.equal(result.journalEntries.find(entry => entry.data.reference === "BILL-1" || entry.data.sourceRecordId === "BILL-1").data.lines[0].originalAccountNumber, "111");
    assert.equal(result.ledgerAccounts.filter(account => account.accountNumber === "1110").length, 1);
    assert.equal(result.trialBalance.find(row => row.accountNumber === "7020").netDebit, 5);
    assert.equal(result.journalEntries.find(entry => entry.id === "LEGACY-ONLY").data.lines[0].originalAccountNumber, "702");
    assert.equal(h.row("MEFFORD-ACCOUNTING", "LEGACY-ONLY").data_json, legacyJournal);
    assert.equal(h.outbound.length, 0);
  } finally { await h.close(); }
});

test("new accounts validate their ranges, appear in journals, and drive overhead posting", async () => {
  const h = await harness();
  try {
    const company = "MEFFORD-ACCOUNTING";
    for (const [number, category] of [["123", "Current Assets"], ["10001", "Cash Accounts"], ["A100", "Cash Accounts"], ["1002", "Current Assets"], ["4951", "System Control / Clearing"]]) {
      await h.save(company, "Chart Of Accounts", number, "Proposed", { category, normalBalance: "Debit" }, accountant, 400);
    }
    const account = { category: "Cash Accounts", normalBalance: "Debit" };
    await h.save(company, "Chart Of Accounts", "1001", "Proposed", account, accountant);
    const journal = { entryDate: today, entryType: "Opening Balance", reference: "FOUR-DIGIT-OPENING", description: "Synthetic new account opening", supportReference: "Synthetic workpaper", lines: [{ accountNumber: "1001", accountName: "New Account", debit: 12.34 }, { accountNumber: "550", accountName: "Legacy Equity", credit: 12.34 }] };
    await h.post("/api/accounting", { action: "save-journal-entry", journal }, accountant, 400);
    await h.save(company, "Chart Of Accounts", "1001", "Active", account, owner);
    const workspace = await h.send("/api/accounting");
    assert.ok(workspace.ledgerAccounts.some(item => item.accountNumber === "1001"));
    const saved = await h.post("/api/accounting", { action: "save-journal-entry", journal }, accountant);
    assert.deepEqual(h.row(company, saved.id).data.lines.map(line => line.accountNumber), ["1001", "5500"]);
    await h.post("/api/accounting", { action: "submit-journal-entry", recordId: saved.id }, accountant);
    await h.post("/api/accounting", { action: "approve-journal-entry", recordId: saved.id }, owner);
    await h.post("/api/accounting", { action: "post-journal-entry", recordId: saved.id }, accountant);
    assert.equal(h.runtime.database.one("SELECT count(*) AS count FROM accounting_journal_lines WHERE account_number = '1001'").count, 1);
    await h.save(company, "Chart Of Accounts", "9501", "Active", { category: "Overhead Expense", normalBalance: "Debit" }, owner, 201, { title: "Synthetic New Overhead" });
    const invoice = { vendor: "Synthetic Office Supplier", invoiceNumber: "FOUR-DIGIT-AP", total: 20.01, allocations: [{ id: "OH", destination: "Company Overhead", code: "9501", amount: 20.01 }] };
    await h.save(company, "AP Invoice", "FOUR-DIGIT-AP", "Draft", invoice, accountant);
    await h.save(company, "AP Invoice", "FOUR-DIGIT-AP", "Approved Unpaid", invoice, owner);
    const posted = h.runtime.database.one("SELECT account_number, account_name, debit_cents FROM accounting_journal_lines WHERE account_number = '9501'");
    assert.equal(posted.debit_cents, 2001); assert.equal(posted.account_name, "Synthetic New Overhead");
    assert.equal(h.outbound.length, 0);
  } finally { await h.close(); }
});
