import { enforceOnboardingAccess } from "../../../lib/onboarding";
import { getCommandActor, resolveCommandActor } from "../../../lib/server-actor";
import { toCents, periodBounds, isAccountingDate, accountingGuard } from "../../../lib/accounting-ledger";
import { isOpenPayable, isOpenReceivable } from "../../../lib/accounting-states";

const ACCOUNTING_PROJECT_ID = "MEFFORD-ACCOUNTING";

type D1Row = { project_id: string; id: string; record_type: string; title: string; owner: string; due: string; status: string; meta: string; record_date: string | null; data_json: string; updated_at: string };
type ProjectRow = { number: string; name: string; status: string; current_contract_amount: string; contract_amount: string; project_manager: string };
type ControlPayload = {
  action?: "save-wip-forecast" | "reopen-wip-forecast" | "import-bank-transactions" | "match-bank-transactions" | "save-bank-reconciliation" | "approve-bank-reconciliation" | "save-cash-forecast-item" | "remove-cash-forecast-item" | "update-close-task" | "save-cutover-control" | "record-collection-action";
  wip?: { projectId?: string; periodId?: string; estimateToComplete?: number; riskReserve?: number; recognitionMethod?: string; notes?: string; status?: string; reason?: string };
  transactionImport?: { cashAccountId?: string; transactions?: Array<{ id?: string; transactionDate?: string; source?: string; reference?: string; description?: string; amount?: number }> };
  match?: { bookTransactionId?: string; bankTransactionId?: string };
  reconciliation?: { id?: string; cashAccountId?: string; statementStart?: string; statementEnd?: string; statementEndingBalance?: number; bookEndingBalance?: number; outstandingDeposits?: number; outstandingPayments?: number; adjustment?: number };
  forecastItem?: { id?: string; weekStart?: string; direction?: string; category?: string; description?: string; amount?: number; projectId?: string; confidence?: string };
  closeTask?: { periodId?: string; code?: string; status?: string; evidence?: string };
  cutover?: { cutoverDate?: string; sourceSystem?: string; openingBalanceEntryId?: string; apReconciled?: boolean; arReconciled?: boolean; cashReconciled?: boolean; assetsReconciled?: boolean; payrollReconciled?: boolean; equityReconciled?: boolean; evidence?: string; status?: string };
  collection?: { projectId?: string; billingId?: string; actionDate?: string; method?: string; note?: string; promiseDate?: string; promisedAmount?: number };
  recordId?: string;
};

const closeTemplates = [
  ["CASH", "Cash", "Reconcile every bank and credit-card account", "Accountant"],
  ["AP", "Payables", "Complete AP cutoff, duplicates, approvals, and unpaid liability review", "Accountant"],
  ["AR", "Receivables", "Complete owner billing cutoff, receipts, retainage, and collection review", "Accountant"],
  ["PAYROLL", "Payroll", "Reconcile Paylocity return, payroll clearing, taxes, benefits, and project labor", "Accountant"],
  ["WIP", "Projects", "Complete ETC, EAC, risk reserve, earned revenue, and over/under billing review", "Financial Administrator"],
  ["ASSETS", "Assets", "Post additions, disposals, depreciation, write-offs, and Section 179 decisions", "Accountant"],
  ["JE", "General Ledger", "Post approved accruals, adjustments, allocations, and recurring journals", "Accountant"],
  ["TB", "General Ledger", "Review trial balance, unusual balances, suspense, and clearing accounts", "Financial Administrator"],
  ["PACKAGE", "Reporting", "Issue management financials, WIP, aging, backlog, and cash forecast", "Financial Administrator"],
  ["OWNER", "Certification", "Owner reviews exceptions and authorizes the hard close", "Company Owner"],
] as const;

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  try {
    const { env } = await import("cloudflare:workers");
    const database = env.DB;
    const authorization = await accountingAuthorization(database, actor);
    if (!authorization.canAccess) return Response.json({ error: "Accounting Access Requires A Company Owner Accountant Or Financial Administrator" }, { status: 403 });
    const [projectResult, recordResult, wipResult, transactionResult, reconciliationResult, forecastResult, closeResult, cutoverResult, collectionResult, vendorResult, complianceResult] = await Promise.all([
      database.prepare(`SELECT number, name, status, current_contract_amount, contract_amount, project_manager FROM projects ORDER BY status = 'Active' DESC, number`).all<ProjectRow>(),
      database.prepare(`SELECT project_id, id, record_type, title, owner, due, status, meta, record_date, data_json, updated_at FROM command_records WHERE record_type IN ('AP Invoice', 'Owner Billing', 'Cash Account', 'Job Cost Actual', 'Budget', 'Subcontracts', 'Purchase Orders') ORDER BY updated_at DESC`).all<D1Row>(),
      database.prepare(`SELECT * FROM accounting_wip_forecasts ORDER BY period_id DESC, project_id`).all<Record<string, unknown>>(),
      database.prepare(`SELECT * FROM accounting_bank_transactions ORDER BY transaction_date DESC, created_at DESC LIMIT 1000`).all<Record<string, unknown>>(),
      database.prepare(`SELECT * FROM accounting_bank_reconciliations ORDER BY statement_end DESC, updated_at DESC`).all<Record<string, unknown>>(),
      database.prepare(`SELECT * FROM accounting_cash_forecast_items WHERE status = 'Active' ORDER BY week_start, created_at`).all<Record<string, unknown>>(),
      database.prepare(`SELECT * FROM accounting_close_tasks ORDER BY period_id DESC, code`).all<Record<string, unknown>>(),
      database.prepare(`SELECT * FROM accounting_cutover_controls ORDER BY updated_at DESC LIMIT 1`).all<Record<string, unknown>>(),
      database.prepare(`SELECT * FROM accounting_collection_actions ORDER BY action_date DESC, created_at DESC`).all<Record<string, unknown>>(),
      database.prepare(`SELECT id, legal_name, dba_name, vendor_type, status, payment_terms, tax_id_last_four FROM vendor_profiles ORDER BY legal_name`).all<Record<string, unknown>>(),
      database.prepare(`SELECT vendor_id, kind, status, effective_date, expiration_date FROM vendor_compliance_documents WHERE kind = 'W-9' ORDER BY created_at DESC`).all<Record<string, unknown>>(),
    ]);
    const projects = projectResult.results ?? [];
    const records = recordResult.results ?? [];
    const currentPeriod = easternDate().slice(0, 7);
    const currentPeriodRow = await database.prepare(`SELECT status FROM accounting_periods WHERE id = ?`).bind(currentPeriod).first<{ status: string }>();
    const closeTasks = closeTasksForPeriod(currentPeriod, closeResult.results ?? []);
    const arAging = buildArAging(records, collectionResult.results ?? []);
    const apAging = buildApAging(records);
    const cashForecast = buildCashForecast(records, forecastResult.results ?? []);
    return Response.json({
      generatedAt: new Date().toISOString(),
      currentPeriod,
      currentPeriodStatus: currentPeriodRow?.status || "Open",
      isOwner: authorization.isOwner,
      projects,
      wipForecasts: wipResult.results ?? [],
      bankTransactions: transactionResult.results ?? [],
      bankReconciliations: reconciliationResult.results ?? [],
      cashForecastItems: forecastResult.results ?? [],
      cashForecast,
      closeTasks,
      cutover: cutoverResult.results?.[0] ?? null,
      collectionActions: collectionResult.results ?? [],
      arAging,
      apAging,
      vendorTaxReadiness: buildVendorTaxReadiness(vendorResult.results ?? [], complianceResult.results ?? [], records),
      cashAccounts: records.filter((row) => row.project_id === ACCOUNTING_PROJECT_ID && row.record_type === "Cash Account").map(publicRecord),
    });
  } catch (error) {
    return accountingError(error);
  }
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  try {
    const payload = await request.json() as ControlPayload;
    const { env } = await import("cloudflare:workers");
    const database = env.DB;
    const authorization = await accountingAuthorization(database, actor);
    if (!authorization.canAccess) return Response.json({ error: "Accounting Access Requires A Company Owner Accountant Or Financial Administrator" }, { status: 403 });
    switch (payload.action) {
      case "reopen-wip-forecast": return await reopenWipForecast(database, payload, actor, authorization.isOwner);
      case "save-wip-forecast": return await saveWipForecast(database, payload, actor, authorization.isOwner);
      case "import-bank-transactions": return await importBankTransactions(database, payload, actor);
      case "match-bank-transactions": return await matchBankTransactions(database, payload, actor);
      case "save-bank-reconciliation": return await saveBankReconciliation(database, payload, actor);
      case "approve-bank-reconciliation": return await approveBankReconciliation(database, payload, actor, authorization.isOwner);
      case "save-cash-forecast-item": return await saveCashForecastItem(database, payload, actor);
      case "remove-cash-forecast-item": return await removeCashForecastItem(database, payload, actor);
      case "update-close-task": return await updateCloseTask(database, payload, actor, authorization.isOwner);
      case "save-cutover-control": return await saveCutoverControl(database, payload, actor, authorization.isOwner);
      case "record-collection-action": return await recordCollectionAction(database, payload, actor);
      default: return Response.json({ error: "A Valid Accounting Control Action Is Required" }, { status: 400 });
    }
  } catch (error) {
    return accountingError(error);
  }
}

async function saveWipForecast(database: D1Database, payload: ControlPayload, actor: ReturnType<typeof getCommandActor>, isOwner: boolean) {
  const input = payload.wip;
  const projectId = input?.projectId?.trim() || "";
  const periodId = input?.periodId?.trim() || "";
  if (!projectId || !/^\d{4}-\d{2}$/.test(periodId)) return bad("A Project And Accounting Period Are Required");
  periodBounds(periodId);
  if (![input?.estimateToComplete ?? 0, input?.riskReserve ?? 0].every(value => Number.isFinite(Number(value)) && Number(value) >= 0 && Number.isSafeInteger(toCents(value)))) return bad("ETC And Risk Reserve Must Be Valid Non-Negative Amounts");
  const project = await database.prepare(`SELECT number, current_contract_amount, contract_amount FROM projects WHERE number = ? LIMIT 1`).bind(projectId).first<{ number: string; current_contract_amount: string; contract_amount: string }>();
  if (!project) return bad("The WIP Project Does Not Exist");
  const period = await database.prepare(`SELECT status FROM accounting_periods WHERE id = ? LIMIT 1`).bind(periodId).first<{ status: string }>();
  if (period?.status === "Hard Closed") return Response.json({ error: `${periodId} Is Hard Closed And Its WIP Forecast Is Locked` }, { status: 409 });
  const status = ["Draft", "Accounting Reviewed", "Owner Approved", "Locked"].includes(String(input?.status)) ? String(input?.status) : "Draft";
  if (["Owner Approved", "Locked"].includes(status) && !isOwner) return Response.json({ error: "Only A Company Owner Can Approve Or Lock A WIP Forecast" }, { status: 403 });
  const actualCost = await projectActualCost(database, projectId, periodBounds(periodId).end);
  const estimateToComplete = Math.max(0, Number(input?.estimateToComplete || 0));
  const riskReserve = Math.max(0, Number(input?.riskReserve || 0));
  const eac = actualCost + estimateToComplete + riskReserve;
  const contract = Number(project.current_contract_amount || project.contract_amount || 0);
  const profit = contract - eac;
  const marginBps = contract > 0 ? Math.round((profit / contract) * 10000) : 0;
  const id = `${periodId}:${projectId}`;
  const now = new Date().toISOString();
  const existing = await database.prepare(`SELECT * FROM accounting_wip_forecasts WHERE id = ? LIMIT 1`).bind(id).first<Record<string, string | number | null>>();
  if (existing?.status === "Locked") return Response.json({ error: "A Locked WIP Forecast Is Immutable. Reopen The Accounting Period Before A Controlled Adjustment." }, { status: 423 });
  if (["Owner Approved", "Locked"].includes(status) && (!existing || existing.status !== "Accounting Reviewed" || !existing.reviewed_email || String(existing.reviewed_email).toLowerCase() === actor.email.toLowerCase())) {
    return Response.json({ error: "Owner Approval Requires A Completed WIP Accounting Review By Another Person" }, { status: 409 });
  }
  const recognitionMethod = input?.recognitionMethod === "Approved Earned Override" ? "Approved Earned Override" : "Cost To Cost";
  if (["Owner Approved", "Locked"].includes(status) && existing && (Number(existing.actual_cost_cents) !== toCents(actualCost) || Number(existing.estimate_to_complete_cents) !== toCents(estimateToComplete) || Number(existing.risk_reserve_cents) !== toCents(riskReserve) || Number(existing.forecast_profit_cents) !== toCents(profit) || existing.recognition_method !== recognitionMethod || existing.notes !== (input?.notes?.trim() || ""))) return Response.json({ error: "The WIP Numbers Or Notes Changed After Accounting Review. Save And Review The Revised Forecast Before Approval." }, { status: 409 });
  await database.batch([
    accountingGuard(database, { recordId: id, actor, summary: `WIP forecast ${id}: ${existing?.status || "New"} to ${status}.`, condition: `NOT EXISTS (SELECT 1 FROM accounting_periods WHERE id = ? AND status = 'Hard Closed') AND ${existing ? "EXISTS (SELECT 1 FROM accounting_wip_forecasts WHERE id = ? AND status = ? AND updated_at = ?)" : "NOT EXISTS (SELECT 1 FROM accounting_wip_forecasts WHERE id = ?)"}`, bindings: [periodId, id, ...(existing ? [existing.status, existing.updated_at] : [])] }),
    database.prepare(`INSERT INTO accounting_wip_forecasts (id, project_id, period_id, actual_cost_cents, estimate_to_complete_cents, risk_reserve_cents, estimate_at_completion_cents, forecast_profit_cents, projected_margin_basis_points, recognition_method, notes, status, prepared_by, prepared_email, reviewed_by, reviewed_email, reviewed_at, approved_by, approved_email, approved_at, locked_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET actual_cost_cents = excluded.actual_cost_cents, estimate_to_complete_cents = excluded.estimate_to_complete_cents, risk_reserve_cents = excluded.risk_reserve_cents, estimate_at_completion_cents = excluded.estimate_at_completion_cents, forecast_profit_cents = excluded.forecast_profit_cents, projected_margin_basis_points = excluded.projected_margin_basis_points, recognition_method = excluded.recognition_method, notes = excluded.notes, status = excluded.status, reviewed_by = excluded.reviewed_by, reviewed_email = excluded.reviewed_email, reviewed_at = excluded.reviewed_at, approved_by = excluded.approved_by, approved_email = excluded.approved_email, approved_at = excluded.approved_at, locked_at = excluded.locked_at, updated_at = excluded.updated_at`).bind(id, projectId, periodId, toCents(actualCost), toCents(estimateToComplete), toCents(riskReserve), toCents(eac), toCents(profit), marginBps, input?.recognitionMethod === "Approved Earned Override" ? "Approved Earned Override" : "Cost To Cost", input?.notes?.trim() || "", status, existing?.prepared_by || actor.name, existing?.prepared_email || actor.email, status === "Accounting Reviewed" ? actor.name : status === "Draft" ? "" : existing?.reviewed_by || "", status === "Accounting Reviewed" ? actor.email : status === "Draft" ? "" : existing?.reviewed_email || "", status === "Accounting Reviewed" ? now : status === "Draft" ? null : existing?.reviewed_at || null, ["Owner Approved", "Locked"].includes(status) ? actor.name : "", ["Owner Approved", "Locked"].includes(status) ? actor.email : "", ["Owner Approved", "Locked"].includes(status) ? now : null, status === "Locked" ? now : null, now),
  ]);
  return Response.json({ saved: true, id, status, notice: `${projectId} ${periodId} WIP Forecast Saved At ${money(eac)} EAC And ${money(profit)} Forecast Profit.` });
}

async function reopenWipForecast(database: D1Database, payload: ControlPayload, actor: ReturnType<typeof getCommandActor>, isOwner: boolean) {
  if (!isOwner) return Response.json({ error: "Only A Company Owner Can Reopen A WIP Forecast" }, { status: 403 });
  const input = payload.wip;
  const periodId = input?.periodId || "";
  periodBounds(periodId);
  const reason = input?.reason?.trim() || "";
  if (reason.length < 8) return bad("A Specific Reason Is Required To Reopen The Forecast");
  const id = `${periodId}:${input?.projectId || ""}`;
  const prior = await database.prepare(`SELECT * FROM accounting_wip_forecasts WHERE id = ?`).bind(id).first<Record<string, string | number | null>>();
  if (!prior || !["Locked", "Owner Approved"].includes(String(prior.status))) return Response.json({ error: "Select A Locked Or Owner-Approved Forecast" }, { status: 409 });
  const period = await database.prepare(`SELECT status FROM accounting_periods WHERE id = ?`).bind(periodId).first<{ status: string }>();
  if (period?.status === "Hard Closed") return Response.json({ error: "Reopen The Accounting Period Before Adjusting Its WIP" }, { status: 423 });
  await database.batch([
    accountingGuard(database, { recordId: id, actor, summary: JSON.stringify({ action: "WIP Reopened", reason, prior }), condition: "NOT EXISTS (SELECT 1 FROM accounting_periods WHERE id = ? AND status = 'Hard Closed') AND EXISTS (SELECT 1 FROM accounting_wip_forecasts WHERE id = ? AND status = ? AND updated_at = ?)", bindings: [periodId, id, prior.status, prior.updated_at] }),
    database.prepare(`UPDATE accounting_wip_forecasts SET status = 'Draft', reviewed_by = '', reviewed_email = '', reviewed_at = NULL, approved_by = '', approved_email = '', approved_at = NULL, locked_at = NULL, updated_at = ? WHERE id = ?`).bind(new Date().toISOString(), id),
  ]);
  return Response.json({ saved: true, id, status: "Draft", notice: "Forecast Reopened. Revised Numbers Require A New Accounting Review And Owner Approval." });
}

async function importBankTransactions(database: D1Database, payload: ControlPayload, actor: ReturnType<typeof getCommandActor>) {
  const cashAccountId = payload.transactionImport?.cashAccountId?.trim() || "";
  const transactions = payload.transactionImport?.transactions ?? [];
  if (!cashAccountId || !transactions.length || transactions.length > 500) return bad("Choose A Cash Account And Import Between 1 And 500 Transactions");
  const cash = await database.prepare(`SELECT id FROM command_records WHERE project_id = ? AND record_type = 'Cash Account' AND id = ? LIMIT 1`).bind(ACCOUNTING_PROJECT_ID, cashAccountId).first<{ id: string }>();
  if (!cash) return bad("The Cash Account Does Not Exist");
  if (transactions.some((item) => !isAccountingDate(item.transactionDate || "") || !["Book", "Bank"].includes(item.source || "") || !item.reference?.trim() || !item.description?.trim() || (!Number.isFinite(Number(item.amount)) || !Number.isSafeInteger(toCents(item.amount)) || toCents(item.amount) === 0))) return bad("Every Transaction Requires Date Book Or Bank Source Reference Description And A Non-Zero Amount");
  const batchId = `BANK-IMPORT-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await database.batch(transactions.map((item, index) => database.prepare(`INSERT INTO accounting_bank_transactions (id, cash_account_id, transaction_date, source, reference, description, amount_cents, status, imported_batch_id, created_by, created_email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'Unmatched', ?, ?, ?, ?, ?)`).bind(item.id?.trim() || `${batchId}:${index + 1}`, cashAccountId, item.transactionDate, item.source, item.reference?.trim(), item.description?.trim(), toCents(item.amount), batchId, actor.name, actor.email, now, now)));
  return Response.json({ saved: true, batchId, notice: `${transactions.length} Book And Bank Transactions Imported For Matching.` });
}

async function matchBankTransactions(database: D1Database, payload: ControlPayload, actor: ReturnType<typeof getCommandActor>) {
  const bookId = payload.match?.bookTransactionId || "";
  const bankId = payload.match?.bankTransactionId || "";
  const rows = await database.prepare(`SELECT id, cash_account_id, source, amount_cents, status FROM accounting_bank_transactions WHERE id IN (?, ?)`).bind(bookId, bankId).all<{ id: string; cash_account_id: string; source: string; amount_cents: number; status: string }>();
  const book = rows.results?.find((row) => row.id === bookId);
  const bank = rows.results?.find((row) => row.id === bankId);
  if (!book || !bank || book.source !== "Book" || bank.source !== "Bank" || book.cash_account_id !== bank.cash_account_id || book.status !== "Unmatched" || bank.status !== "Unmatched" || book.amount_cents !== bank.amount_cents) return Response.json({ error: "Matching Requires One Unmatched Book Transaction And One Equal Bank Transaction From The Same Account" }, { status: 409 });
  const now = new Date().toISOString();
  await database.batch([
    accountingGuard(database, { recordId: book.id, actor, summary: `Matched book ${book.id} to bank ${bank.id}.`, condition: "EXISTS (SELECT 1 FROM accounting_bank_transactions b JOIN accounting_bank_transactions k ON k.id = ? WHERE b.id = ? AND b.status = 'Unmatched' AND k.status = 'Unmatched' AND b.source = 'Book' AND k.source = 'Bank' AND b.cash_account_id = k.cash_account_id AND b.amount_cents = k.amount_cents)", bindings: [bank.id, book.id] }),
    database.prepare(`UPDATE accounting_bank_transactions SET status = 'Matched', matched_transaction_id = ?, updated_at = ? WHERE id = ?`).bind(bank.id, now, book.id),
    database.prepare(`UPDATE accounting_bank_transactions SET status = 'Matched', matched_transaction_id = ?, updated_at = ? WHERE id = ?`).bind(book.id, now, bank.id),
  ]);
  return Response.json({ saved: true, notice: `Book And Bank Transactions Matched By ${actor.name}.` });
}

async function saveBankReconciliation(database: D1Database, payload: ControlPayload, actor: ReturnType<typeof getCommandActor>) {
  const input = payload.reconciliation;
  if (!input?.cashAccountId || !isAccountingDate(input.statementStart || "") || !isAccountingDate(input.statementEnd || "") || String(input.statementEnd) < String(input.statementStart)) return bad("Cash Account And A Valid Statement Date Range Are Required");
  const cash = await database.prepare(`SELECT id FROM command_records WHERE project_id = ? AND record_type = 'Cash Account' AND id = ? LIMIT 1`).bind(ACCOUNTING_PROJECT_ID, input.cashAccountId).first<{ id: string }>();
  if (!cash) return bad("The Cash Account Does Not Exist");
  if (![input.statementEndingBalance ?? 0, input.bookEndingBalance ?? 0, input.outstandingDeposits ?? 0, input.outstandingPayments ?? 0, input.adjustment ?? 0].every(value => Number.isFinite(Number(value)) && Number.isSafeInteger(toCents(value))) || Number(input.outstandingDeposits || 0) < 0 || Number(input.outstandingPayments || 0) < 0) return bad("Reconciliation Amounts Must Be Finite And Outstanding Amounts Cannot Be Negative");
  const statement = Number(input.statementEndingBalance || 0);
  const book = Number(input.bookEndingBalance || 0);
  const deposits = Math.max(0, Number(input.outstandingDeposits || 0));
  const payments = Math.max(0, Number(input.outstandingPayments || 0));
  const adjustment = Number(input.adjustment || 0);
  const difference = statement + deposits - payments + adjustment - book;
  const status = Math.abs(difference) <= 0.005 ? "Reconciled" : "Needs Review";
  const id = input.id?.trim() || `BANK-REC-${input.cashAccountId}-${input.statementEnd}`;
  const existing = await database.prepare(`SELECT status, updated_at FROM accounting_bank_reconciliations WHERE id = ? LIMIT 1`).bind(id).first<{ status: string; updated_at: string }>();
  if (existing?.status === "Approved") return Response.json({ error: "An Approved Bank Reconciliation Is Locked. Record A Controlled Adjustment In A Later Period." }, { status: 423 });
  const now = new Date().toISOString();
  await database.batch([
    accountingGuard(database, { recordId: id, actor, summary: `Bank reconciliation ${id} saved as ${status}.`, condition: existing ? "EXISTS (SELECT 1 FROM accounting_bank_reconciliations WHERE id = ? AND status <> 'Approved' AND updated_at = ?)" : "NOT EXISTS (SELECT 1 FROM accounting_bank_reconciliations WHERE id = ?)", bindings: existing ? [id, existing.updated_at] : [id] }),
    database.prepare(`INSERT INTO accounting_bank_reconciliations (id, cash_account_id, statement_start, statement_end, statement_ending_balance_cents, book_ending_balance_cents, outstanding_deposits_cents, outstanding_payments_cents, adjustment_cents, difference_cents, status, prepared_by, prepared_email, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET statement_start = excluded.statement_start, statement_end = excluded.statement_end, statement_ending_balance_cents = excluded.statement_ending_balance_cents, book_ending_balance_cents = excluded.book_ending_balance_cents, outstanding_deposits_cents = excluded.outstanding_deposits_cents, outstanding_payments_cents = excluded.outstanding_payments_cents, adjustment_cents = excluded.adjustment_cents, difference_cents = excluded.difference_cents, status = excluded.status, prepared_by = excluded.prepared_by, prepared_email = excluded.prepared_email, approved_by = '', approved_email = '', approved_at = NULL, updated_at = excluded.updated_at`).bind(id, input.cashAccountId, input.statementStart, input.statementEnd, toCents(statement), toCents(book), toCents(deposits), toCents(payments), toCents(adjustment), toCents(difference), status, actor.name, actor.email, now),
  ]);
  return Response.json({ saved: true, id, status, notice: status === "Reconciled" ? "Bank Reconciliation Balances To The Cent And Is Ready For Owner Approval." : `Bank Reconciliation Has A ${money(difference)} Difference.` });
}

async function approveBankReconciliation(database: D1Database, payload: ControlPayload, actor: ReturnType<typeof getCommandActor>, isOwner: boolean) {
  if (!isOwner) return Response.json({ error: "Only A Company Owner Can Approve A Bank Reconciliation" }, { status: 403 });
  const id = payload.recordId || "";
  const row = await database.prepare(`SELECT difference_cents, status, prepared_email, updated_at FROM accounting_bank_reconciliations WHERE id = ? LIMIT 1`).bind(id).first<{ difference_cents: number; status: string; prepared_email: string; updated_at: string }>();
  if (!row || row.difference_cents !== 0 || row.status !== "Reconciled" || row.prepared_email.toLowerCase() === actor.email.toLowerCase()) return Response.json({ error: "Approval Requires A Balanced Reconciliation And Independent Owner Review" }, { status: 409 });
  const now = new Date().toISOString();
  const saved = await database.prepare(`UPDATE accounting_bank_reconciliations SET status = 'Approved', approved_by = ?, approved_email = ?, approved_at = ?, updated_at = ? WHERE id = ? AND status = 'Reconciled' AND difference_cents = 0 AND prepared_email = ? AND updated_at = ?`).bind(actor.name, actor.email, now, now, id, row.prepared_email, row.updated_at).run();
  if (saved.meta.changes !== 1) return Response.json({ error: "The Reconciliation Changed During Review. Reload And Review The Current Numbers." }, { status: 409 });
  return Response.json({ saved: true, notice: "Bank Reconciliation Independently Approved And Locked For The Close." });
}

async function saveCashForecastItem(database: D1Database, payload: ControlPayload, actor: ReturnType<typeof getCommandActor>) {
  const input = payload.forecastItem;
  if (!input || !isAccountingDate(input.weekStart || "") || !["Inflow", "Outflow"].includes(input.direction || "") || !input.category?.trim() || !input.description?.trim() || (!Number.isFinite(Number(input.amount)) || !Number.isSafeInteger(toCents(input.amount)) || Number(input.amount || 0) <= 0)) return bad("Week Direction Category Description And Positive Amount Are Required");
  const weekStart = mondayStart(input.weekStart || "");
  const id = input.id?.trim() || `CASH-FORECAST-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await database.prepare(`INSERT INTO accounting_cash_forecast_items (id, week_start, direction, category, description, amount_cents, project_id, confidence, source_type, source_record_id, status, created_by, created_email, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Manual Forecast', '', 'Active', ?, ?, ?) ON CONFLICT(id) DO UPDATE SET week_start = excluded.week_start, direction = excluded.direction, category = excluded.category, description = excluded.description, amount_cents = excluded.amount_cents, project_id = excluded.project_id, confidence = excluded.confidence, status = 'Active', updated_at = excluded.updated_at`).bind(id, weekStart, input.direction, input.category.trim(), input.description.trim(), toCents(input.amount), input.projectId?.trim() || "", ["Committed", "Expected", "Possible"].includes(input.confidence || "") ? input.confidence : "Expected", actor.name, actor.email, now).run();
  return Response.json({ saved: true, id, notice: "Cash Forecast Item Added To The Thirteen-Week View." });
}

async function removeCashForecastItem(database: D1Database, payload: ControlPayload, actor: ReturnType<typeof getCommandActor>) {
  await database.prepare(`UPDATE accounting_cash_forecast_items SET status = 'Removed', updated_at = ? WHERE id = ? AND source_type = 'Manual Forecast'`).bind(new Date().toISOString(), payload.recordId || "").run();
  return Response.json({ saved: true, notice: `Forecast Item Removed By ${actor.name}.` });
}

async function updateCloseTask(database: D1Database, payload: ControlPayload, actor: ReturnType<typeof getCommandActor>, isOwner: boolean) {
  const input = payload.closeTask;
  const template = closeTemplates.find((item) => item[0] === input?.code);
  if (!input || !template || !/^\d{4}-\d{2}$/.test(input.periodId || "") || !["Open", "Completed", "Reviewed"].includes(input.status || "")) return bad("A Valid Close Task Period And Status Are Required");
  if (input.status !== "Open" && !input.evidence?.trim()) return bad("Completion And Review Require Evidence Or A Reconciliation Reference");
  periodBounds(input.periodId || "");
  const period = await database.prepare(`SELECT status FROM accounting_periods WHERE id = ?`).bind(input.periodId).first<{ status: string }>();
  if (period?.status === "Hard Closed") return Response.json({ error: "Closed Period Evidence Is Locked. An Owner Must Reopen The Period With A Reason." }, { status: 423 });
  if (template[0] === "OWNER" && input.status === "Completed" && !isOwner) return Response.json({ error: "Owner Certification Must Be Completed By A Company Owner" }, { status: 403 });
  const id = `${input.periodId}:${template[0]}`;
  const due = closeDueDate(input.periodId || "");
  const now = new Date().toISOString();
  const existing = await database.prepare(`SELECT status, completed_by, completed_email, completed_at, updated_at FROM accounting_close_tasks WHERE id = ? LIMIT 1`).bind(id).first<{ status: string; completed_by: string; completed_email: string; completed_at: string | null; updated_at: string }>();
  if (input.status === "Reviewed" && (existing?.status !== "Completed" || !existing?.completed_email || existing.completed_email.toLowerCase() === actor.email.toLowerCase())) return Response.json({ error: "Close Task Review Must Be Independent From The Person Who Completed It" }, { status: 409 });
  await database.batch([
    accountingGuard(database, { recordId: id, actor, summary: `Close control ${id}: ${existing?.status || "New"} to ${input.status}; ${input.evidence || ""}`, condition: `NOT EXISTS (SELECT 1 FROM accounting_periods WHERE id = ? AND status = 'Hard Closed') AND ${existing ? "EXISTS (SELECT 1 FROM accounting_close_tasks WHERE id = ? AND status = ? AND updated_at = ?)" : "NOT EXISTS (SELECT 1 FROM accounting_close_tasks WHERE id = ?)"}`, bindings: [input.periodId || "", id, ...(existing ? [existing.status, existing.updated_at] : [])] }),
    database.prepare(`INSERT INTO accounting_close_tasks (id, period_id, code, category, description, assigned_role, due_date, status, evidence, completed_by, completed_email, completed_at, reviewed_by, reviewed_email, reviewed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, evidence = excluded.evidence, completed_by = excluded.completed_by, completed_email = excluded.completed_email, completed_at = excluded.completed_at, reviewed_by = excluded.reviewed_by, reviewed_email = excluded.reviewed_email, reviewed_at = excluded.reviewed_at, updated_at = excluded.updated_at`).bind(id, input.periodId, template[0], template[1], template[2], template[3], due, input.status, input.evidence?.trim() || "", input.status === "Completed" ? actor.name : input.status === "Reviewed" ? existing?.completed_by || "" : "", input.status === "Completed" ? actor.email : input.status === "Reviewed" ? existing?.completed_email || "" : "", input.status === "Completed" ? now : input.status === "Reviewed" ? existing?.completed_at || null : null, input.status === "Reviewed" ? actor.name : "", input.status === "Reviewed" ? actor.email : "", input.status === "Reviewed" ? now : null, now),
  ]);
  return Response.json({ saved: true, notice: `${template[0]} Close Control Is ${input.status}.` });
}

async function saveCutoverControl(database: D1Database, payload: ControlPayload, actor: ReturnType<typeof getCommandActor>, isOwner: boolean) {
  const input = payload.cutover;
  if (!isAccountingDate(input?.cutoverDate || "") || !input || !input.sourceSystem?.trim()) return bad("Cutover Date And Source Accounting System Are Required");
  const existing = await database.prepare(`SELECT status FROM accounting_cutover_controls WHERE id = 'ACCOUNTING-CUTOVER' LIMIT 1`).bind().first<{ status: string }>();
  if (existing?.status === "Locked") return Response.json({ error: "The Accounting Cutover Is Locked And Cannot Be Rewritten" }, { status: 423 });
  const status = input.status === "Locked" ? "Locked" : input.status === "Owner Approved" ? "Owner Approved" : "Draft";
  if (["Owner Approved", "Locked"].includes(status) && !isOwner) return Response.json({ error: "Only A Company Owner Can Approve Or Lock The Accounting Cutover" }, { status: 403 });
  const checks = [input.apReconciled, input.arReconciled, input.cashReconciled, input.assetsReconciled, input.payrollReconciled, input.equityReconciled];
  if (["Owner Approved", "Locked"].includes(status) && (!checks.every(Boolean) || !input.openingBalanceEntryId?.trim() || !input.evidence?.trim())) return bad("Every Subsidiary Ledger Opening Balances And Cutover Evidence Must Be Reconciled Before Owner Approval");
  if (["Owner Approved", "Locked"].includes(status)) {
    const journal = await database.prepare(`SELECT status, entry_type FROM accounting_journal_entries WHERE id = ? LIMIT 1`).bind(input.openingBalanceEntryId).first<{ status: string; entry_type: string }>();
    if (!journal || journal.status !== "Posted" || journal.entry_type !== "Opening Balance") return bad("The Cutover Must Reference A Posted Opening Balance Journal Entry");
  }
  const now = new Date().toISOString();
  await database.prepare(`INSERT INTO accounting_cutover_controls (id, cutover_date, source_system, opening_balance_entry_id, ap_reconciled, ar_reconciled, cash_reconciled, assets_reconciled, payroll_reconciled, equity_reconciled, evidence, status, prepared_by, prepared_email, approved_by, approved_email, approved_at, locked_at, updated_at) VALUES ('ACCOUNTING-CUTOVER', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET cutover_date = excluded.cutover_date, source_system = excluded.source_system, opening_balance_entry_id = excluded.opening_balance_entry_id, ap_reconciled = excluded.ap_reconciled, ar_reconciled = excluded.ar_reconciled, cash_reconciled = excluded.cash_reconciled, assets_reconciled = excluded.assets_reconciled, payroll_reconciled = excluded.payroll_reconciled, equity_reconciled = excluded.equity_reconciled, evidence = excluded.evidence, status = excluded.status, approved_by = excluded.approved_by, approved_email = excluded.approved_email, approved_at = excluded.approved_at, locked_at = excluded.locked_at, updated_at = excluded.updated_at`).bind(input.cutoverDate, input.sourceSystem.trim(), input.openingBalanceEntryId?.trim() || "", input.apReconciled ? 1 : 0, input.arReconciled ? 1 : 0, input.cashReconciled ? 1 : 0, input.assetsReconciled ? 1 : 0, input.payrollReconciled ? 1 : 0, input.equityReconciled ? 1 : 0, input.evidence?.trim() || "", status, actor.name, actor.email, ["Owner Approved", "Locked"].includes(status) ? actor.name : "", ["Owner Approved", "Locked"].includes(status) ? actor.email : "", ["Owner Approved", "Locked"].includes(status) ? now : null, status === "Locked" ? now : null, now).run();
  return Response.json({ saved: true, status, notice: status === "Locked" ? "Accounting Cutover Locked. Historical Balances Must Now Be Corrected Through Audited Journal Entries." : `Accounting Cutover Saved As ${status}.` });
}

async function recordCollectionAction(database: D1Database, payload: ControlPayload, actor: ReturnType<typeof getCommandActor>) {
  const input = payload.collection;
  if (!input?.projectId || !input.billingId || !isAccountingDate(input.actionDate || "") || !["Email", "Call", "Meeting", "Notice", "Promise To Pay"].includes(input.method || "") || !input.note?.trim()) return bad("Project Billing Date Method And Collection Note Are Required");
  if ((input.promiseDate && !isAccountingDate(input.promiseDate)) || !Number.isFinite(Number(input.promisedAmount ?? 0)) || Number(input.promisedAmount || 0) < 0) return bad("Promise Date And Amount Must Be Valid");
  const billing = await database.prepare(`SELECT id FROM command_records WHERE project_id = ? AND id = ? AND record_type = 'Owner Billing' LIMIT 1`).bind(input.projectId, input.billingId).first<{ id: string }>();
  if (!billing) return bad("The Owner Billing Record Does Not Exist");
  const id = `COLLECTION-${crypto.randomUUID()}`;
  await database.prepare(`INSERT INTO accounting_collection_actions (id, project_id, billing_id, action_date, method, note, promise_date, promised_amount_cents, created_by, created_email) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, input.projectId, input.billingId, input.actionDate, input.method, input.note.trim(), input.promiseDate || "", toCents(input.promisedAmount), actor.name, actor.email).run();
  return Response.json({ saved: true, id, notice: "Collection Activity Added To The Permanent AR History." });
}

async function projectActualCost(database: D1Database, projectId: string, periodEnd: string) {
  const result = await database.prepare(`SELECT data_json FROM command_records WHERE project_id = ? AND record_type = 'Job Cost Actual' AND status = 'Posted' AND COALESCE(record_date, due) <= ?`).bind(projectId, periodEnd).all<{ data_json: string }>();
  return (result.results ?? []).reduce((sum, row) => sum + Number(data(row).amount || 0), 0);
}

function closeTasksForPeriod(periodId: string, stored: Array<Record<string, unknown>>) {
  const byCode = new Map(stored.filter((row) => row.period_id === periodId).map((row) => [row.code, row]));
  return closeTemplates.map(([code, category, description, assignedRole]) => byCode.get(code) || { id: `${periodId}:${code}`, period_id: periodId, code, category, description, assigned_role: assignedRole, due_date: closeDueDate(periodId), status: "Open", evidence: "" });
}

function closeDueDate(periodId: string) {
  const [year, month] = periodId.split("-").map(Number);
  return new Date(Date.UTC(year, month, 10)).toISOString().slice(0, 10);
}

function mondayStart(date: string) {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() - ((parsed.getUTCDay() + 6) % 7));
  return parsed.toISOString().slice(0, 10);
}

function buildArAging(records: D1Row[], collectionActions: Array<Record<string, unknown>>) {
  const latest = new Map<string, Record<string, unknown>>();
  collectionActions.forEach((action) => { if (!latest.has(`${String(action.project_id)}:${String(action.billing_id)}`)) latest.set(`${String(action.project_id)}:${String(action.billing_id)}`, action); });
  const today = new Date().toISOString().slice(0, 10);
  return records.filter((row) => row.record_type === "Owner Billing" && isOpenReceivable(row.status)).map((row) => {
    const rowData = data(row);
    const openAmount = Math.max(0, Number(rowData.currentPaymentDue || 0) - Number(rowData.receivedToDate || 0));
    const days = daysBetween(row.due, today);
    return { id: row.id, projectId: row.project_id, title: row.title, due: row.due, days, bucket: agingBucket(days), openAmount, status: row.status, latestAction: latest.get(`${row.project_id}:${row.id}`) || null };
  }).sort((left, right) => right.days - left.days);
}

function buildApAging(records: D1Row[]) {
  const today = new Date().toISOString().slice(0, 10);
  return records.filter((row) => row.project_id === ACCOUNTING_PROJECT_ID && row.record_type === "AP Invoice" && isOpenPayable(row.status)).map((row) => { const rowData = data(row); const days = daysBetween(row.due, today); return { id: row.id, vendor: String(rowData.vendor || row.title), invoiceNumber: String(rowData.invoiceNumber || row.id), due: row.due, days, bucket: agingBucket(days), amount: Number(rowData.total || 0), status: row.status }; }).sort((left, right) => right.days - left.days);
}

function buildCashForecast(records: D1Row[], manual: Array<Record<string, unknown>>) {
  const today = new Date(`${easternDate()}T12:00:00Z`);
  const day = today.getUTCDay();
  const monday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - ((day + 6) % 7)));
  const starts = Array.from({ length: 13 }, (_, index) => new Date(monday.getTime() + index * 7 * 86400000).toISOString().slice(0, 10));
  const cashAccounts = records.filter((row) => row.project_id === ACCOUNTING_PROJECT_ID && row.record_type === "Cash Account");
  const openingCash = cashAccounts.reduce((sum, row) => sum + Number(data(row).bookBalance || 0), 0);
  const items = [...manual.map((item) => ({ id: item.id, weekStart: item.week_start, direction: item.direction, category: item.category, description: item.description, amount: Number(item.amount_cents || 0) / 100, projectId: item.project_id, confidence: item.confidence, sourceType: item.source_type, manual: true }))];
  records.filter((row) => row.record_type === "Owner Billing" && ["Sent", "Partially Paid"].includes(row.status)).forEach((row) => { const rowData = data(row); const amount = Math.max(0, Number(rowData.currentPaymentDue || 0) - Number(rowData.receivedToDate || 0)); if (amount > 0) items.push({ id: `AR:${row.project_id}:${row.id}`, weekStart: forecastWeek(row.due, starts), direction: "Inflow", category: "Owner Collections", description: row.title, amount, projectId: row.project_id, confidence: row.due < starts[0] ? "At Risk" : "Expected", sourceType: "Owner Billing", manual: false }); });
  records.filter((row) => row.project_id === ACCOUNTING_PROJECT_ID && row.record_type === "AP Invoice" && ["Approved Unpaid", "Payment Released"].includes(row.status)).forEach((row) => { const rowData = data(row); items.push({ id: `AP:${row.id}`, weekStart: forecastWeek(row.due, starts), direction: "Outflow", category: "Vendor Payments", description: `${String(rowData.vendor || row.title)} · ${String(rowData.invoiceNumber || row.id)}`, amount: Number(rowData.total || 0), projectId: "", confidence: row.status === "Payment Released" ? "Committed" : "Expected", sourceType: "AP Invoice", manual: false }); });
  let ending = openingCash;
  const weeks = starts.map((weekStart) => { const weekItems = items.filter((item) => item.weekStart === weekStart); const inflow = weekItems.filter((item) => item.direction === "Inflow").reduce((sum, item) => sum + item.amount, 0); const outflow = weekItems.filter((item) => item.direction === "Outflow").reduce((sum, item) => sum + item.amount, 0); const beginning = ending; ending += inflow - outflow; return { weekStart, beginning, inflow, outflow, net: inflow - outflow, ending, items: weekItems }; });
  return { openingCash, weeks, minimumCash: Math.min(openingCash, ...weeks.map((week) => week.ending)), items };
}

function forecastWeek(date: string, starts: string[]) {
  if (!date || date <= starts[0]) return starts[0];
  if (date >= new Date(Date.parse(`${starts[0]}T12:00:00Z`) + 13 * 7 * 86400000).toISOString().slice(0, 10)) return "Outside Forecast";
  for (let index = starts.length - 1; index >= 0; index -= 1) if (date >= starts[index]) return starts[index];
  return starts.at(-1) || starts[0];
}

function easternDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function buildVendorTaxReadiness(vendors: Array<Record<string, unknown>>, documents: Array<Record<string, unknown>>, records: D1Row[]) {
  const w9 = new Map<string, Record<string, unknown>>();
  documents.forEach((row) => { if (!w9.has(String(row.vendor_id))) w9.set(String(row.vendor_id), row); });
  const paid = new Map<string, number>();
  const currentYear = easternDate().slice(0, 4);
  records.filter((row) => row.project_id === ACCOUNTING_PROJECT_ID && row.record_type === "AP Invoice" && row.status === "Paid" && String(data(row).paidAt || data(row).paymentClearedAt || row.record_date || row.due).startsWith(currentYear)).forEach((row) => { const rowData = data(row); const id = String(rowData.vendorId || ""); if (id) paid.set(id, (paid.get(id) || 0) + Number(rowData.total || 0)); });
  return vendors.map((vendor) => { const doc = w9.get(String(vendor.id)); const ytdPaid = paid.get(String(vendor.id)) || 0; return { vendorId: vendor.id, legalName: vendor.legal_name, vendorType: vendor.vendor_type, status: vendor.status, paymentTerms: vendor.payment_terms, taxIdLastFour: vendor.tax_id_last_four, w9Status: doc?.status || "Missing", w9Expiration: doc?.expiration_date || "", ytdPaid, review1099: ytdPaid >= 600 && ["Subcontractor", "Consultant", "Professional Services"].includes(String(vendor.vendor_type)) }; });
}

async function accountingAuthorization(database: D1Database, actor: ReturnType<typeof getCommandActor>) {
  const member = actor.email ? await database.prepare(`SELECT company_access_level, designations_json FROM company_members WHERE email = ? LIMIT 1`).bind(actor.email).first<{ company_access_level: string; designations_json: string }>() : null;
  const accessLevel = member?.company_access_level || actor.accessLevel;
  const designations = parseArray(member?.designations_json || "[]");
  return { isOwner: accessLevel === "Company Owner", canAccess: accessLevel === "Company Owner" || designations.includes("Accountant") || designations.includes("Financial Administrator") };
}

function publicRecord(row: D1Row) { return { id: row.id, title: row.title, status: row.status, data: data(row) }; }
function data(row: D1Row | { data_json?: unknown }) { try { const parsed = JSON.parse(String(row.data_json || "{}")) as unknown; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; } }
function parseArray(value: string) { try { const parsed = JSON.parse(value) as unknown; return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; } catch { return []; } }
function daysBetween(date: string, today: string) { return Math.floor((Date.parse(today) - Date.parse(date)) / 86400000); }
function agingBucket(days: number) { if (days <= 0) return "Current"; if (days <= 30) return "1–30"; if (days <= 60) return "31–60"; if (days <= 90) return "61–90"; return "90+"; }
function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value); }
function bad(error: string) { return Response.json({ error }, { status: 400 }); }
function accountingError(error: unknown) { const message = error instanceof Error ? error.message : "Accounting Controls Are Unavailable"; if (/A Valid Accounting (Date|Period) Is Required/.test(message)) return bad(message); if (/NOT NULL constraint failed: record_audits\.record_id/.test(message)) return Response.json({ error: "The Accounting Record Or Period Changed. Refresh And Retry; No Partial Change Was Saved." }, { status: 409 }); console.error("Accounting controls error", error); return Response.json({ error: message }, { status: 500 }); }
