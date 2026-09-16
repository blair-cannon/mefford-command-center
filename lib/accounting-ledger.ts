import { currentAccountNumber } from "./accounting-numbering";
export type AccountingLedgerActor = {
  name: string;
  email: string;
};

export type AccountingLineInput = {
  accountNumber: string;
  accountName: string;
  description?: string;
  projectId?: string;
  department?: string;
  costCode?: string;
  sourceAllocationId?: string;
  debitCents?: number;
  creditCents?: number;
};

export type ManualJournalSnapshot = {
  id: string;
  entryDate: string;
  entryType: string;
  reference: string;
  description: string;
  supportReference: string;
  status: "Draft" | "Submitted" | "Approved";
  sourceType?: string;
  sourceProjectId?: string;
  sourceRecordId?: string;
  preparedBy: string;
  preparedEmail: string;
  approvedBy?: string;
  approvedEmail?: string;
  approvedAt?: string;
  reversesEntryId?: string;
  lines: AccountingLineInput[];
};

type AccountingPeriodRow = {
  id: string;
  period_start: string;
  period_end: string;
  status: string;
  soft_closed_by: string;
  soft_closed_email: string;
  soft_closed_at: string | null;
  hard_closed_by: string;
  hard_closed_email: string;
  hard_closed_at: string | null;
  reopened_by: string;
  reopened_email: string;
  reopened_at: string | null;
  reopen_reason: string;
  updated_at: string;
};

type JournalEntryRow = {
  id: string;
  event_id: string | null;
  entry_date: string;
  period_id: string;
  entry_type: string;
  reference: string;
  description: string;
  support_reference: string;
  status: string;
  source_type: string;
  source_project_id: string;
  source_record_id: string;
  prepared_by: string;
  prepared_email: string;
  approved_by: string;
  approved_email: string;
  approved_at: string | null;
  posted_by: string;
  posted_email: string;
  posted_at: string | null;
  reverses_entry_id: string;
  total_debit_cents: number;
  total_credit_cents: number;
  updated_at: string;
};

type JournalLineRow = {
  id: string;
  entry_id: string;
  line_number: number;
  account_number: string;
  account_name: string;
  description: string;
  project_id: string;
  department: string;
  cost_code: string;
  source_allocation_id: string;
  debit_cents: number;
  credit_cents: number;
};

export const ACCOUNTING_ACCOUNTS = {
  cashClearing: { accountNumber: "1020", accountName: "Cash Clear" },
  accountsReceivable: { accountNumber: "1110", accountName: "Accounts Receivable" },
  projectPayrollWip: { accountNumber: "1600", accountName: "WIP Payroll" },
  accountsPayable: { accountNumber: "4020", accountName: "Accounts Payable" },
  ownerBillingControl: { accountNumber: "4950", accountName: "Owner Billing Control" },
  payrollClearing: { accountNumber: "4980", accountName: "Payroll Clearing" },
  jobMaterials: { accountNumber: "7020", accountName: "Job Materials" },
  subcontractors: { accountNumber: "7030", accountName: "Subcontractors" },
  otherConstructionCost: { accountNumber: "7040", accountName: "Other Construction Cost" },
  overheadWages: { accountNumber: "8290", accountName: "Salaries & Wages" },
  overheadExpense: { accountNumber: "9600", accountName: "Misc Expense" },
} as const;

export function toCents(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount + Number.EPSILON) * 100);
}

export function isAccountingDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}

export function periodIdForDate(value: string) {
  if (!isAccountingDate(value)) throw new Error("A Valid Accounting Date Is Required");
  return value.slice(0, 7);
}

export function periodBounds(periodId: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodId)) throw new Error("A Valid Accounting Period Is Required");
  const [year, month] = periodId.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: `${periodId}-01`, end: `${periodId}-${String(lastDay).padStart(2, "0")}` };
}

export function stableAccountingKey(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${(hash >>> 0).toString(16).padStart(8, "0")}-${value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 54)}`;
}

function assertBalanced(lines: AccountingLineInput[], draft = false) {
  if (lines.length < 2) throw new Error("A Journal Entry Requires At Least Two Lines");
  let debit = 0;
  let credit = 0;
  for (const line of lines) {
    const lineDebit = Number(line.debitCents || 0);
    const lineCredit = Number(line.creditCents || 0);
    if (!line.accountNumber || !line.accountName || !Number.isSafeInteger(lineDebit) || !Number.isSafeInteger(lineCredit) || lineDebit < 0 || lineCredit < 0 || (lineDebit > 0 && lineCredit > 0) || (!draft && lineDebit === 0 && lineCredit === 0)) {
      throw new Error("Every Journal Line Requires One Valid Debit Or Credit In Whole Cents");
    }
    debit += lineDebit;
    credit += lineCredit;
  }
  if (!draft && (debit <= 0 || debit !== credit)) throw new Error("Debits And Credits Must Balance Exactly To The Cent");
  if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit)) throw new Error("Journal Totals Exceed The Supported Amount");
  return { debit, credit };
}

export function apExpenseAccount(allocation: Record<string, unknown>) {
  if (String(allocation.destination || "") === "Company Overhead") {
    const number = currentAccountNumber(allocation.code);
    return /^[1-9]\d{3}$/.test(number)
      ? { accountNumber: number, accountName: String(allocation.accountName || (number === ACCOUNTING_ACCOUNTS.overheadExpense.accountNumber ? ACCOUNTING_ACCOUNTS.overheadExpense.accountName : "Company Overhead Expense")) }
      : ACCOUNTING_ACCOUNTS.overheadExpense;
  }
  const type = `${String(allocation.commitmentType || "")} ${String(allocation.description || "")}`.toLowerCase();
  if (type.includes("subcontract")) return ACCOUNTING_ACCOUNTS.subcontractors;
  if (type.includes("purchase") || type.includes("material")) return ACCOUNTING_ACCOUNTS.jobMaterials;
  return ACCOUNTING_ACCOUNTS.otherConstructionCost;
}

export function apAccrualLines(invoice: { id: string; vendor: string; invoiceNumber: string; allocations: Array<Record<string, unknown>> }) {
  const debits: AccountingLineInput[] = invoice.allocations.map((allocation, index) => {
    const account = apExpenseAccount(allocation);
    return {
      ...account,
      description: `${invoice.vendor} · Invoice ${invoice.invoiceNumber}`,
      projectId: String(allocation.destination || "") === "Company Overhead" ? "" : String(allocation.destination || ""),
      department: String(allocation.destination || "") === "Company Overhead" ? "Office" : "Field",
      costCode: String(allocation.code || ""),
      sourceAllocationId: String(allocation.id || index + 1),
      debitCents: toCents(allocation.amount),
    };
  });
  const total = debits.reduce((sum, line) => sum + Number(line.debitCents || 0), 0);
  return [...debits, { ...ACCOUNTING_ACCOUNTS.accountsPayable, description: `${invoice.vendor} · Invoice ${invoice.invoiceNumber}`, creditCents: total }];
}

export function apPaymentLines(amount: unknown, description: string) {
  const value = toCents(amount);
  return [
    { ...ACCOUNTING_ACCOUNTS.accountsPayable, description, debitCents: value },
    { ...ACCOUNTING_ACCOUNTS.cashClearing, description, creditCents: value },
  ];
}

export function ownerBillingLines(amount: unknown, projectId: string, description: string) {
  const value = toCents(amount);
  return [
    { ...ACCOUNTING_ACCOUNTS.accountsReceivable, description, projectId, debitCents: value },
    { ...ACCOUNTING_ACCOUNTS.ownerBillingControl, description: `${description} · Revenue Recognition Pending WIP Close`, projectId, creditCents: value },
  ];
}

export function ownerReceiptLines(amount: unknown, projectId: string, description: string) {
  const value = toCents(amount);
  return [
    { ...ACCOUNTING_ACCOUNTS.cashClearing, description, projectId, debitCents: value },
    { ...ACCOUNTING_ACCOUNTS.accountsReceivable, description, projectId, creditCents: value },
  ];
}

export function payrollReturnLines(allocations: Array<Record<string, unknown>>, description: string) {
  const debits: AccountingLineInput[] = allocations.map((allocation, index) => {
    const overhead = String(allocation.destination || "") === "Company Overhead";
    return {
      ...(overhead ? ACCOUNTING_ACCOUNTS.overheadWages : ACCOUNTING_ACCOUNTS.projectPayrollWip),
      description: String(allocation.description || description),
      projectId: overhead ? "" : String(allocation.destination || ""),
      department: overhead ? "Office" : "Field",
      costCode: String(allocation.code || ""),
      sourceAllocationId: String(allocation.id || index + 1),
      debitCents: toCents(allocation.amount),
    };
  });
  const total = debits.reduce((sum, line) => sum + Number(line.debitCents || 0), 0);
  return [...debits, { ...ACCOUNTING_ACCOUNTS.payrollClearing, description, creditCents: total }];
}

export async function ensureAccountingPeriod(database: D1Database, entryDate: string, allowHardClosed = false) {
  const periodId = periodIdForDate(entryDate);
  const bounds = periodBounds(periodId);
  await database.prepare(`INSERT INTO accounting_periods (id, period_start, period_end, status) VALUES (?, ?, ?, 'Open') ON CONFLICT(id) DO NOTHING`).bind(periodId, bounds.start, bounds.end).run();
  const period = await database.prepare(`SELECT id, period_start, period_end, status, soft_closed_by, soft_closed_email, soft_closed_at, hard_closed_by, hard_closed_email, hard_closed_at, reopened_by, reopened_email, reopened_at, reopen_reason, updated_at FROM accounting_periods WHERE id = ? LIMIT 1`).bind(periodId).first<AccountingPeriodRow>();
  if (!period) throw new Error("The Accounting Period Could Not Be Prepared");
  if (period.status === "Hard Closed" && !allowHardClosed) throw new Error(`Accounting Period ${periodId} Is Hard Closed. A Company Owner Must Reopen It With A Reason Before Posting.`);
  return period;
}

type AccountingSourceSnapshot = { projectId: string; recordId: string; status: string; dataJson: string };
type JournalWriteOptions = { relatedStatements?: D1PreparedStatement[]; sourceSnapshot?: AccountingSourceSnapshot };

export function accountingGuard(database: D1Database, input: { recordId: string; actor: AccountingLedgerActor; summary: string; condition: string; bindings: (string | number | null)[] }) {
  return database.prepare(`INSERT INTO record_audits (project_id, record_id, field_name, old_value, new_value, reason, actor_name, actor_email, summary)
    VALUES ('MEFFORD-ACCOUNTING', (SELECT ? WHERE ${input.condition}), 'Accounting Control', '', '', 'Atomic accounting control', ?, ?, ?)`)
    .bind(input.recordId, ...input.bindings, input.actor.name, input.actor.email, input.summary);
}

function sourceGuard(source?: AccountingSourceSnapshot) {
  return source ? { sql: " AND EXISTS (SELECT 1 FROM command_records WHERE project_id = ? AND id = ? AND status = ? AND data_json = ?)", bindings: [source.projectId, source.recordId, source.status, source.dataJson] } : { sql: "", bindings: [] };
}

export async function postAccountingEvent(database: D1Database, input: {
  idempotencyKey: string;
  eventType: string;
  sourceType: string;
  sourceProjectId?: string;
  sourceRecordId: string;
  eventDate: string;
  entryType?: string;
  reference: string;
  description: string;
  supportReference?: string;
  actor: AccountingLedgerActor;
  metadata?: Record<string, unknown>;
  lines: AccountingLineInput[];
  relatedStatements?: D1PreparedStatement[];
  sourceSnapshot?: AccountingSourceSnapshot;
}) {
  const totals = assertBalanced(input.lines);
  const existing = await database.prepare(`SELECT id FROM accounting_events WHERE idempotency_key = ? LIMIT 1`).bind(input.idempotencyKey).first<{ id: string }>();
  const entryId = `AUTO-${stableAccountingKey(input.idempotencyKey)}`;
  if (existing) return { idempotent: true, eventId: existing.id, entryId };
  const period = await ensureAccountingPeriod(database, input.eventDate);
  const eventId = `AE-${stableAccountingKey(input.idempotencyKey)}`;
  const now = new Date().toISOString();
  // The NOT NULL idempotency key also provides an atomic compare-and-swap:
  // a stale source snapshot yields NULL and rolls back the complete D1 batch.
  const source = input.sourceSnapshot;
  const guard = sourceGuard(source);
  const guardedKey = `(SELECT ? WHERE EXISTS (SELECT 1 FROM accounting_periods WHERE id = ? AND status <> 'Hard Closed')${guard.sql})`;
  const keyBindings = [input.idempotencyKey, period.id, ...guard.bindings];
  const statements: D1PreparedStatement[] = [
    database.prepare(`INSERT INTO accounting_events (id, idempotency_key, event_type, source_type, source_project_id, source_record_id, event_date, description, status, amount_cents, actor_name, actor_email, metadata_json, created_at) VALUES (?, ${guardedKey}, ?, ?, ?, ?, ?, ?, 'Posted', ?, ?, ?, ?, ?)`).bind(eventId, ...keyBindings, input.eventType, input.sourceType, input.sourceProjectId || "", input.sourceRecordId, input.eventDate, input.description, totals.debit, input.actor.name, input.actor.email, JSON.stringify(input.metadata || {}), now),
    database.prepare(`INSERT INTO accounting_journal_entries (id, event_id, entry_date, period_id, entry_type, reference, description, support_reference, status, source_type, source_project_id, source_record_id, prepared_by, prepared_email, posted_by, posted_email, posted_at, total_debit_cents, total_credit_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Posted', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(entryId, eventId, input.eventDate, period.id, input.entryType || "Automatic", input.reference, input.description, input.supportReference || `${input.sourceType} · ${input.sourceRecordId}`, input.sourceType, input.sourceProjectId || "", input.sourceRecordId, "Command Center Automation", "automation@meffcon.com", input.actor.name, input.actor.email, now, totals.debit, totals.credit, now, now),
  ];
  input.lines.forEach((line, index) => statements.push(database.prepare(`INSERT INTO accounting_journal_lines (id, entry_id, line_number, account_number, account_name, description, project_id, department, cost_code, source_allocation_id, debit_cents, credit_cents, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(`${entryId}:${index + 1}`, entryId, index + 1, currentAccountNumber(line.accountNumber), line.accountName, line.description || "", line.projectId || "", line.department || "", line.costCode || "", line.sourceAllocationId || "", line.debitCents || 0, line.creditCents || 0, now)));
  try {
    await database.batch([...statements, ...(input.relatedStatements || [])]);
  } catch (error) {
    const duplicate = await database.prepare(`SELECT id FROM accounting_events WHERE idempotency_key = ? LIMIT 1`).bind(input.idempotencyKey).first<{ id: string }>();
    if (duplicate) return { idempotent: true, eventId: duplicate.id, entryId };
    if (source) {
      const current = await database.prepare(`SELECT status, data_json FROM command_records WHERE project_id = ? AND id = ?`).bind(source.projectId, source.recordId).first<{ status: string; data_json: string }>();
      if (!current || current.status !== source.status || current.data_json !== source.dataJson) throw new Error("The Accounting Source Changed During Posting. Refresh And Retry; No Partial Posting Was Saved.");
    }
    throw error;
  }
  return { idempotent: false, eventId, entryId };
}

export async function saveManualJournalSnapshot(database: D1Database, journal: ManualJournalSnapshot, options: JournalWriteOptions = {}) {
  const totals = assertBalanced(journal.lines, journal.status === "Draft");
  const period = await ensureAccountingPeriod(database, journal.entryDate);
  const existing = await database.prepare(`SELECT status FROM accounting_journal_entries WHERE id = ? LIMIT 1`).bind(journal.id).first<{ status: string }>();
  if (existing?.status === "Posted") throw new Error("A Posted Journal Entry Is Immutable");
  const now = new Date().toISOString();
  const source = sourceGuard(options.sourceSnapshot);
  const statements: D1PreparedStatement[] = [
    accountingGuard(database, { recordId: journal.id, actor: { name: journal.preparedBy, email: journal.preparedEmail }, summary: `Journal ${journal.id} saved atomically as ${journal.status}.`, condition: `EXISTS (SELECT 1 FROM accounting_periods WHERE id = ? AND status <> 'Hard Closed') AND NOT EXISTS (SELECT 1 FROM accounting_journal_entries WHERE id = ? AND status = 'Posted')${source.sql}`, bindings: [period.id, journal.id, ...source.bindings] }),
    database.prepare(`INSERT INTO accounting_journal_entries (id, entry_date, period_id, entry_type, reference, description, support_reference, status, source_type, source_project_id, source_record_id, prepared_by, prepared_email, approved_by, approved_email, approved_at, reverses_entry_id, total_debit_cents, total_credit_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET entry_date = excluded.entry_date, period_id = excluded.period_id, entry_type = excluded.entry_type, reference = excluded.reference, description = excluded.description, support_reference = excluded.support_reference, status = excluded.status, source_type = excluded.source_type, source_project_id = excluded.source_project_id, source_record_id = excluded.source_record_id, approved_by = excluded.approved_by, approved_email = excluded.approved_email, approved_at = excluded.approved_at, reverses_entry_id = excluded.reverses_entry_id, total_debit_cents = excluded.total_debit_cents, total_credit_cents = excluded.total_credit_cents, updated_at = excluded.updated_at`).bind(journal.id, journal.entryDate, period.id, journal.entryType, journal.reference, journal.description, journal.supportReference, journal.status, journal.sourceType || "Manual Journal", journal.sourceProjectId || "", journal.sourceRecordId || journal.id, journal.preparedBy, journal.preparedEmail, journal.approvedBy || "", journal.approvedEmail || "", journal.approvedAt || null, journal.reversesEntryId || "", totals.debit, totals.credit, now, now),
    database.prepare(`DELETE FROM accounting_journal_lines WHERE entry_id = ?`).bind(journal.id),
  ];
  journal.lines.forEach((line, index) => statements.push(database.prepare(`INSERT INTO accounting_journal_lines (id, entry_id, line_number, account_number, account_name, description, project_id, department, cost_code, source_allocation_id, debit_cents, credit_cents, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(`${journal.id}:${index + 1}`, journal.id, index + 1, currentAccountNumber(line.accountNumber), line.accountName, line.description || "", line.projectId || "", line.department || "", line.costCode || "", line.sourceAllocationId || "", line.debitCents || 0, line.creditCents || 0, now)));
  await database.batch([...statements, ...(options.relatedStatements || [])]);
}

export async function postManualJournalSnapshot(database: D1Database, entryId: string, actor: AccountingLedgerActor, options: JournalWriteOptions = {}) {
  const entry = await database.prepare(`SELECT id, entry_date, period_id, entry_type, reference, description, support_reference, status, source_type, source_project_id, source_record_id, prepared_by, prepared_email, approved_by, approved_email, approved_at, reverses_entry_id, total_debit_cents, total_credit_cents FROM accounting_journal_entries WHERE id = ? LIMIT 1`).bind(entryId).first<JournalEntryRow>();
  if (!entry || entry.status !== "Approved") throw new Error("Only An Approved Normalized Journal Entry Can Be Posted");
  if (entry.total_debit_cents <= 0 || entry.total_debit_cents !== entry.total_credit_cents) throw new Error("The Normalized Journal Entry Is Not Balanced");
  await ensureAccountingPeriod(database, entry.entry_date);
  const idempotencyKey = `MANUAL_JOURNAL:${entryId}:POST`;
  const existing = await database.prepare(`SELECT id FROM accounting_events WHERE idempotency_key = ? LIMIT 1`).bind(idempotencyKey).first<{ id: string }>();
  if (existing) return { idempotent: true, eventId: existing.id, entryId };
  const eventId = `AE-${stableAccountingKey(idempotencyKey)}`;
  const now = new Date().toISOString();
  const source = sourceGuard(options.sourceSnapshot);
  await database.batch([
    accountingGuard(database, { recordId: entryId, actor, summary: `Journal ${entryId} posted with its source record.`, condition: `EXISTS (SELECT 1 FROM accounting_periods WHERE id = ? AND status <> 'Hard Closed') AND EXISTS (SELECT 1 FROM accounting_journal_entries WHERE id = ? AND status = 'Approved')${source.sql}`, bindings: [entry.period_id, entryId, ...source.bindings] }),
    database.prepare(`UPDATE accounting_journal_lines SET account_number = account_number || '0' WHERE entry_id = ? AND account_number GLOB '[1-9][0-9][0-9]'`).bind(entryId),
    database.prepare(`INSERT INTO accounting_events (id, idempotency_key, event_type, source_type, source_project_id, source_record_id, event_date, description, status, amount_cents, actor_name, actor_email, metadata_json, created_at) VALUES (?, ?, 'Manual Journal Posted', ?, ?, ?, ?, ?, 'Posted', ?, ?, ?, ?, ?)`).bind(eventId, idempotencyKey, entry.source_type, entry.source_project_id, entry.source_record_id || entryId, entry.entry_date, entry.description, entry.total_debit_cents, actor.name, actor.email, JSON.stringify({ entryType: entry.entry_type, reference: entry.reference }), now),
    database.prepare(`UPDATE accounting_journal_entries SET event_id = ?, status = 'Posted', posted_by = ?, posted_email = ?, posted_at = ?, updated_at = ? WHERE id = ? AND status = 'Approved'`).bind(eventId, actor.name, actor.email, now, now, entryId),
    ...(options.relatedStatements || []),
  ]);
  return { idempotent: false, eventId, entryId };
}

export async function setAccountingPeriod(database: D1Database, input: { periodId: string; status: "Open" | "Soft Closed" | "Hard Closed"; reason?: string; actor: AccountingLedgerActor; isOwner: boolean; requireCloseReview?: boolean }) {
  const bounds = periodBounds(input.periodId);
  await database.prepare(`INSERT INTO accounting_periods (id, period_start, period_end, status) VALUES (?, ?, ?, 'Open') ON CONFLICT(id) DO NOTHING`).bind(input.periodId, bounds.start, bounds.end).run();
  const current = await database.prepare(`SELECT id, period_start, period_end, status, soft_closed_by, soft_closed_email, soft_closed_at, hard_closed_by, hard_closed_email, hard_closed_at, reopened_by, reopened_email, reopened_at, reopen_reason, updated_at FROM accounting_periods WHERE id = ? LIMIT 1`).bind(input.periodId).first<AccountingPeriodRow>();
  if (!current) throw new Error("The Accounting Period Could Not Be Loaded");
  const now = new Date().toISOString();
  if (input.status === "Open") {
    if (current.status === "Open") return current;
    if (!input.isOwner || !String(input.reason || "").trim()) throw new Error("Only A Company Owner Can Reopen A Period And A Reason Is Required");
    await database.batch([
      accountingGuard(database, { recordId: input.periodId, actor: input.actor, summary: `Period reopened: ${String(input.reason).trim()}`, condition: "EXISTS (SELECT 1 FROM accounting_periods WHERE id = ? AND status = ? AND updated_at = ?)", bindings: [input.periodId, current.status, current.updated_at] }),
      database.prepare(`UPDATE accounting_periods SET status = 'Open', reopened_by = ?, reopened_email = ?, reopened_at = ?, reopen_reason = ?, updated_at = ? WHERE id = ?`).bind(input.actor.name, input.actor.email, now, String(input.reason).trim(), now, input.periodId),
      database.prepare(`UPDATE accounting_wip_forecasts SET status = 'Draft', reviewed_by = '', reviewed_email = '', reviewed_at = NULL, approved_by = '', approved_email = '', approved_at = NULL, locked_at = NULL, updated_at = ? WHERE period_id = ?`).bind(now, input.periodId),
      database.prepare(`UPDATE accounting_close_tasks SET status = 'Open', completed_by = '', completed_email = '', completed_at = NULL, reviewed_by = '', reviewed_email = '', reviewed_at = NULL, updated_at = ? WHERE period_id = ?`).bind(now, input.periodId),
    ]);
  } else if (input.status === "Hard Closed") {
    if (!input.isOwner) throw new Error("Only A Company Owner Can Hard Close An Accounting Period");
    const openEntry = await database.prepare(`SELECT id FROM accounting_journal_entries WHERE period_id = ? AND status <> 'Posted' LIMIT 1`).bind(input.periodId).first<{ id: string }>();
    if (openEntry) throw new Error(`Journal ${openEntry.id} Must Be Posted Or Moved Before This Period Can Be Hard Closed`);
    const reviewCondition = input.requireCloseReview ? " AND (SELECT COUNT(DISTINCT code) FROM accounting_close_tasks WHERE period_id = ? AND code IN ('CASH','AP','AR','PAYROLL','WIP','ASSETS','JE','TB','PACKAGE','OWNER') AND status = 'Reviewed' AND completed_email <> '' AND reviewed_email <> '' AND lower(completed_email) <> lower(reviewed_email)) = 10" : "";
    await database.batch([
      accountingGuard(database, { recordId: input.periodId, actor: input.actor, summary: `Period hard closed by ${input.actor.name}.`, condition: `EXISTS (SELECT 1 FROM accounting_periods WHERE id = ? AND status = ? AND updated_at = ?) AND NOT EXISTS (SELECT 1 FROM accounting_journal_entries WHERE period_id = ? AND status <> 'Posted')${reviewCondition}`, bindings: [input.periodId, current.status, current.updated_at, input.periodId, ...(input.requireCloseReview ? [input.periodId] : [])] }),
      database.prepare(`UPDATE accounting_periods SET status = 'Hard Closed', hard_closed_by = ?, hard_closed_email = ?, hard_closed_at = ?, updated_at = ? WHERE id = ?`).bind(input.actor.name, input.actor.email, now, now, input.periodId),
    ]);
  } else {
    if (current.status === "Hard Closed") throw new Error("A Hard Closed Period Requires An Owner Reopen With A Reason Before Changing Its Status");
    await database.batch([
      accountingGuard(database, { recordId: input.periodId, actor: input.actor, summary: `Period soft closed by ${input.actor.name}.`, condition: "EXISTS (SELECT 1 FROM accounting_periods WHERE id = ? AND status = ? AND updated_at = ? AND status <> 'Hard Closed')", bindings: [input.periodId, current.status, current.updated_at] }),
      database.prepare(`UPDATE accounting_periods SET status = 'Soft Closed', soft_closed_by = ?, soft_closed_email = ?, soft_closed_at = ?, updated_at = ? WHERE id = ?`).bind(input.actor.name, input.actor.email, now, now, input.periodId),
    ]);
  }
  return database.prepare(`SELECT id, period_start, period_end, status, soft_closed_by, soft_closed_email, soft_closed_at, hard_closed_by, hard_closed_email, hard_closed_at, reopened_by, reopened_email, reopened_at, reopen_reason, updated_at FROM accounting_periods WHERE id = ? LIMIT 1`).bind(input.periodId).first<AccountingPeriodRow>();
}

export async function loadNormalizedLedger(database: D1Database) {
  const [entryResult, lineResult, periodResult] = await Promise.all([
    database.prepare(`SELECT id, event_id, entry_date, period_id, entry_type, reference, description, support_reference, status, source_type, source_project_id, source_record_id, prepared_by, prepared_email, approved_by, approved_email, approved_at, posted_by, posted_email, posted_at, reverses_entry_id, total_debit_cents, total_credit_cents, updated_at FROM accounting_journal_entries ORDER BY entry_date DESC, updated_at DESC`).all<JournalEntryRow>(),
    database.prepare(`SELECT id, entry_id, line_number, account_number, account_name, description, project_id, department, cost_code, source_allocation_id, debit_cents, credit_cents FROM accounting_journal_lines ORDER BY entry_id, line_number`).all<JournalLineRow>(),
    database.prepare(`SELECT id, period_start, period_end, status, soft_closed_by, soft_closed_email, soft_closed_at, hard_closed_by, hard_closed_email, hard_closed_at, reopened_by, reopened_email, reopened_at, reopen_reason, updated_at FROM accounting_periods ORDER BY period_start DESC`).all<AccountingPeriodRow>(),
  ]);
  const linesByEntry = new Map<string, JournalLineRow[]>();
  for (const line of lineResult.results ?? []) linesByEntry.set(line.entry_id, [...(linesByEntry.get(line.entry_id) || []), line]);
  const entries = (entryResult.results ?? []).map((entry) => {
    const lines = (linesByEntry.get(entry.id) || []).map((line) => ({ id: line.id, accountNumber: currentAccountNumber(line.account_number), originalAccountNumber: line.account_number, accountName: line.account_name, description: line.description, projectId: line.project_id, department: line.department, costCode: line.cost_code, sourceAllocationId: line.source_allocation_id, debit: line.debit_cents / 100, credit: line.credit_cents / 100 }));
    return {
      id: entry.id,
      type: "Journal Entry",
      title: `${entry.entry_type} · ${entry.reference}`,
      owner: entry.prepared_by,
      due: entry.entry_date,
      status: entry.status,
      meta: `${(entry.total_debit_cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 })} Debits · ${(entry.total_credit_cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 })} Credits`,
      recordDate: entry.entry_date,
      updatedAt: entry.updated_at,
      data: { entryDate: entry.entry_date, periodId: entry.period_id, entryType: entry.entry_type, reference: entry.reference, description: entry.description, supportReference: entry.support_reference, sourceType: entry.source_type, sourceProjectId: entry.source_project_id, sourceRecordId: entry.source_record_id, preparedBy: entry.prepared_by, preparedEmail: entry.prepared_email, approvedBy: entry.approved_by, approvedEmail: entry.approved_email, approvedAt: entry.approved_at, postedBy: entry.posted_by, postedEmail: entry.posted_email, postedAt: entry.posted_at, reversesEntryId: entry.reverses_entry_id, automatic: Boolean(entry.event_id) && entry.source_type !== "Manual Journal", totals: { debit: entry.total_debit_cents / 100, credit: entry.total_credit_cents / 100 }, lines },
    };
  });
  const accounts = new Map<string, { accountNumber: string; accountName: string; debit: number; credit: number; netDebit: number; netCredit: number; entryCount: number }>();
  for (const entry of (entryResult.results ?? []).filter((row) => row.status === "Posted")) {
    for (const line of linesByEntry.get(entry.id) || []) {
      const current = accounts.get(currentAccountNumber(line.account_number)) || { accountNumber: currentAccountNumber(line.account_number), originalAccountNumber: line.account_number, accountName: line.account_name, debit: 0, credit: 0, netDebit: 0, netCredit: 0, entryCount: 0 };
      current.debit += line.debit_cents / 100;
      current.credit += line.credit_cents / 100;
      current.entryCount += 1;
      const net = current.debit - current.credit;
      current.netDebit = net > 0 ? net : 0;
      current.netCredit = net < 0 ? Math.abs(net) : 0;
      accounts.set(currentAccountNumber(line.account_number), current);
    }
  }
  return { entries, trialBalance: [...accounts.values()].sort((left, right) => left.accountNumber.localeCompare(right.accountNumber, undefined, { numeric: true })), periods: periodResult.results ?? [] };
}
