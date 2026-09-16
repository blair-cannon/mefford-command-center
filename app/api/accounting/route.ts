import { buildAccountCatalog, selectableLedgerAccounts } from "../../../lib/accounting-catalog";
import { currentAccountNumber, normalizeAccountReferences } from "../../../lib/accounting-numbering";
import { enforceOnboardingAccess } from "../../../lib/onboarding";
import { getCommandActor, resolveCommandActor } from "../../../lib/server-actor";
import {
  apAccrualLines,
  apPaymentLines,
  loadNormalizedLedger,
  ownerBillingLines,
  ownerReceiptLines,
  payrollReturnLines,
  postAccountingEvent,
  postManualJournalSnapshot,
  saveManualJournalSnapshot,
  setAccountingPeriod,
  isAccountingDate,
  periodBounds,
  stableAccountingKey,
  toCents,
  type AccountingLineInput,
} from "../../../lib/accounting-ledger";
import { recordCompletedWorkflowHandoff } from "../../../lib/domain-outbox";
import { PROFITABILITY_FLOOR_BASIS_POINTS } from "../../../lib/operating-doctrine";
import { isContractedActiveProject, needsOwnerContractSignature } from "../../../lib/contracted-projects";
import { ownerBillingReleaseError, ownerBillingPostingGuard } from "../../../lib/owner-billing-control";
import { ownerBillingAuthority, PHASE_ONE_BILLING } from "../../../lib/owner-billing-authority";
import { isOpenPayable, isIssuedOwnerBilling, isOpenReceivable } from "../../../lib/accounting-states";
import { roundMoney } from "../../../lib/money";
import { reconcileAwardContractTotals } from "../../../lib/project-contract-financials";

const ACCOUNTING_PROJECT_ID = "MEFFORD-ACCOUNTING";

type D1Row = {
  project_id: string;
  id: string;
  record_type: string;
  title: string;
  owner: string;
  due: string;
  status: string;
  meta: string;
  record_date: string | null;
  data_json: string;
  updated_at: string;
};

type ProjectRow = {
  number: string;
  name: string;
  status: string;
  owner_name: string;
  owner_contract_type: string;
  owner_contract_status: string;
  owner_contract_record_id: string;
  contract_amount: string;
  current_contract_amount: string;
  project_manager: string;
};

type EmployeeRow = {
  display_name: string;
  email: string;
};

type ActionPayload = {
  action?:
    | "release-payment-batch"
    | "clear-payment-batch"
    | "clear-wire"
    | "send-owner-billing"
    | "record-owner-receipt"
    | "save-cash-account"
    | "save-payroll-report"
    | "record-paylocity-return"
    | "approve-paylocity-return"
    | "save-journal-entry"
    | "submit-journal-entry"
    | "approve-journal-entry"
    | "post-journal-entry"
    | "reverse-journal-entry"
    | "close-accounting-period"
    | "reopen-accounting-period";
  recordId?: string;
  projectId?: string;
  amount?: number;
  receiptDate?: string;
  reference?: string;
  confirmation?: string;
  deliveryReference?: string;
  account?: {
    id?: string;
    name?: string;
    lastFour?: string;
    bookBalance?: number;
    bankBalance?: number;
    statementDate?: string;
  };
  payroll?: {
    id?: string;
    payrollCompany?: string;
    periodStart?: string;
    periodEnd?: string;
    payDate?: string;
    employee?: string;
    employeeIdLastFour?: string;
    regularHours?: number;
    overtimeHours?: number;
    ptoHours?: number;
    holidayHours?: number;
    bonus?: number;
    reimbursement?: number;
    deduction?: number;
    notes?: string;
    allocations?: Array<{
      id?: string;
      destination?: string;
      code?: string;
      description?: string;
      hours?: number;
    }>;
  };
  payrollReturn?: {
    periodStart?: string;
    periodEnd?: string;
    payDate?: string;
    returnReference?: string;
    grossWages?: number;
    employerTaxes?: number;
    employerBenefits?: number;
    employeeDeductions?: number;
    netPay?: number;
    notes?: string;
    allocations?: Array<{ id?: string; destination?: string; code?: string; description?: string; amount?: number }>;
  };
  journal?: {
    id?: string;
    entryDate?: string;
    entryType?: "Standard" | "Adjusting" | "Reclassification" | "Opening Balance";
    reference?: string;
    description?: string;
    supportReference?: string;
    lines?: Array<{
      id?: string;
      accountNumber?: string;
      accountName?: string;
      description?: string;
      projectId?: string;
      department?: string;
      debit?: number;
      credit?: number;
    }>;
  };
  period?: {
    id?: string;
    status?: "Open" | "Soft Closed" | "Hard Closed";
    reason?: string;
  };
};

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;

  try {
    const { env } = await import("cloudflare:workers");
    const database = env.DB;
    if (!(await canAccessAccounting(database, actor))) {
      return Response.json({ error: "Accounting Access Requires A Company Owner Accountant Or Financial Administrator" }, { status: 403 });
    }
    await reconcileAwardContractTotals(database);
    const [projectResult, recordResult, employeeResult, wipResult, normalizedLedger] = await Promise.all([
      database.prepare(
        `SELECT number, name, status, owner_name, owner_contract_type, owner_contract_status, owner_contract_record_id,
                contract_amount, current_contract_amount, project_manager
         FROM projects ORDER BY status = 'Active' DESC, number`,
      ).all<ProjectRow>(),
      database.prepare(
        `SELECT project_id, id, record_type, title, owner, due, status, meta, record_date,
                data_json, updated_at
         FROM command_records ORDER BY updated_at DESC`,
      ).all<D1Row>(),
      database.prepare(
        `SELECT display_name, email FROM company_members WHERE is_active = 1 ORDER BY display_name`,
      ).all<EmployeeRow>(),
      database.prepare(
        `SELECT * FROM accounting_wip_forecasts ORDER BY period_id DESC, updated_at DESC`,
      ).all<Record<string, unknown>>(),
      loadNormalizedLedger(database),
    ]);
    const projects = projectResult.results ?? [];
    const rows = recordResult.results ?? [];
    const accountingRows = rows.filter((row) => row.project_id === ACCOUNTING_PROJECT_ID);
    const apInvoices = accountingRows.filter((row) => row.record_type === "AP Invoice");
    const paymentBatches = accountingRows.filter((row) => row.record_type === "Payment Batch");
    const cashAccounts = accountingRows.filter((row) => row.record_type === "Cash Account");
    const payrollRuns = accountingRows.filter((row) => row.record_type === "Payroll Report");
    const payrollReturns = accountingRows.filter((row) => row.record_type === "Paylocity Payroll Return");
    const journalEntries = accountingRows.filter((row) => row.record_type === "Journal Entry");
    const normalizedIds = new Set(normalizedLedger.entries.map((entry) => entry.id));
    const legacyJournalEntries = journalEntries.filter((entry) => !normalizedIds.has(entry.id));
    const fixedAssets = accountingRows.filter((row) => row.record_type === "Fixed Asset Register");
    const projectFinancials = projects.map((project) => projectFinancial(project, rows, apInvoices, wipResult.results ?? []));
    const issues = buildIssues(projectFinancials, apInvoices, paymentBatches, cashAccounts);

    return Response.json({
      generatedAt: new Date().toISOString(),
      ledgerAccounts: selectableLedgerAccounts(buildAccountCatalog(accountingRows)),
      summary: summarize(projectFinancials, apInvoices, paymentBatches, cashAccounts),
      projects: projectFinancials,
      issues,
      paymentBatches: paymentBatches.map(publicRecord),
      cashAccounts: cashAccounts.map(publicRecord),
      payrollRuns: payrollRuns.map(publicRecord),
      payrollReturns: payrollReturns.map(publicRecord),
      journalEntries: [...normalizedLedger.entries.map(entry => ({ ...entry, data: { ...entry.data, reversedByEntryId: data(journalEntries.find(row => row.id === entry.id)).reversedByEntryId || "" } })), ...legacyJournalEntries.map(publicRecord)]
        .sort((left, right) => String(right.recordDate || "").localeCompare(String(left.recordDate || ""))),
      fixedAssets: fixedAssets.map(publicRecord),
      trialBalance: mergeTrialBalances(normalizedLedger.trialBalance, buildTrialBalance(legacyJournalEntries)),
      accountingPeriods: normalizedLedger.periods.map((period) => ({
        id: period.id,
        periodStart: period.period_start,
        periodEnd: period.period_end,
        status: period.status,
        softClosedBy: period.soft_closed_by,
        softClosedAt: period.soft_closed_at,
        hardClosedBy: period.hard_closed_by,
        hardClosedAt: period.hard_closed_at,
        reopenedBy: period.reopened_by,
        reopenedAt: period.reopened_at,
        reopenReason: period.reopen_reason,
        updatedAt: period.updated_at,
      })),
      employees: (employeeResult.results ?? []).map((employee) => ({ name: employee.display_name, email: employee.email })),
      receivables: rows
        .filter((row) => row.record_type === "Owner Billing" && isOpenReceivable(row.status))
        .map((row) => ({ ...publicRecord(row), projectId: row.project_id })),
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
    const payload = (await request.json()) as ActionPayload;
    const { env } = await import("cloudflare:workers");
    const database = env.DB;
    const authorization = await accountingAuthorization(database, actor);
    if (!authorization.canAccess) {
      return Response.json({ error: "Accounting Access Requires A Company Owner Accountant Or Financial Administrator" }, { status: 403 });
    }
    switch (payload.action) {
      case "release-payment-batch":
        return await releasePaymentBatch(database, payload, actor, authorization.isOwner);
      case "clear-payment-batch":
        return await clearPaymentBatch(database, payload, actor);
      case "clear-wire":
        return await clearWire(database, payload, actor);
      case "send-owner-billing":
        return await sendOwnerBilling(database, payload, actor);
      case "record-owner-receipt":
        return await recordOwnerReceipt(database, payload, actor);
      case "save-cash-account":
        return await saveCashAccount(database, payload, actor);
      case "save-payroll-report":
        return await savePayrollReport(database, payload, actor);
      case "record-paylocity-return":
        return await recordPaylocityReturn(database, payload, actor);
      case "approve-paylocity-return":
        return await approvePaylocityReturn(database, payload, actor, authorization.isOwner);
      case "save-journal-entry":
        return await saveJournalEntry(database, payload, actor);
      case "submit-journal-entry":
        return await submitJournalEntry(database, payload, actor);
      case "approve-journal-entry":
        return await approveJournalEntry(database, payload, actor);
      case "post-journal-entry":
        return await postJournalEntry(database, payload, actor);
      case "reverse-journal-entry":
        return await reverseJournalEntry(database, payload, actor);
      case "close-accounting-period":
        return await closeAccountingPeriod(database, payload, actor, authorization.isOwner);
      case "reopen-accounting-period":
        return await reopenAccountingPeriod(database, payload, actor, authorization.isOwner);
      default:
        return Response.json({ error: "A Valid Accounting Action Is Required" }, { status: 400 });
    }
  } catch (error) {
    return accountingError(error);
  }
}

function projectFinancial(project: ProjectRow, rows: D1Row[], apInvoices: D1Row[], forecasts: Array<Record<string, unknown>>) {
  const projectRows = rows.filter((row) => row.project_id === project.number);
  const controlledContract = projectRows.find(row => row.record_type === "Contracts" && row.id === project.owner_contract_record_id);
  const authority = ownerBillingAuthority({ ownerContractType: project.owner_contract_type, ownerContractStatus: project.owner_contract_status },
    { status: controlledContract?.status, data: controlledContract?.data_json });
  const budgets = projectRows.filter((row) => row.record_type === "Budget" && data(row).selectedForProject === true);
  const budgetControl = projectRows.find((row) => row.record_type === "Budget Control" && row.id === "BUDGET-CONTROL");
  const billings = projectRows.filter((row) => row.record_type === "Owner Billing" && !["Voided", "Archived"].includes(row.status));
  const receipts = projectRows.filter((row) => row.record_type === "Owner Receipt" && row.status === "Posted");
  const commitments = projectRows.filter((row) => ["Subcontracts", "Purchase Orders"].includes(row.record_type) && !["Draft", "Returned", "Rejected", "Cancelled", "Superseded", "Voided", "Archived", "Deleted"].includes(row.status));
  const changes = projectRows.filter((row) => row.record_type === "Change Orders" && row.status === "Executed");
  const originalBudget = budgets.reduce((sum, row) => sum + numeric(data(row).originalBudget), 0);
  const committedCost = commitments.reduce((sum, row) => sum + recordAmount(row), 0);
  const approvedChanges = changes.reduce((sum, row) => sum + numeric(data(row).approvedTotal), 0);
  const projectAp = apInvoices.flatMap((invoice) => allocations(invoice)
    .filter((allocation) => String(allocation.destination || "") === project.number)
    .map((allocation) => ({ invoice, amount: numeric(allocation.amount) })));
  const openAp = projectAp.filter(({ invoice }) => isOpenPayable(invoice.status)).reduce((sum, item) => sum + item.amount, 0);
  const paidCost = projectAp.filter(({ invoice }) => invoice.status === "Paid").reduce((sum, item) => sum + item.amount, 0);
  const actualCost = projectRows
    .filter((row) => row.record_type === "Job Cost Actual" && row.status === "Posted")
    .reduce((sum, row) => sum + numeric(data(row).amount), 0);
  const approvedCost = projectAp.filter(({ invoice }) => ["Approved Unpaid", "Payment Released", "Paid"].includes(invoice.status)).reduce((sum, item) => sum + item.amount, 0);
  const ownerBilled = billings.filter((row) => isIssuedOwnerBilling(row.status)).reduce((sum, row) => sum + numeric(data(row).currentPaymentDue), 0);
  const ownerReceived = receipts.reduce((sum, row) => sum + numeric(data(row).amount), 0);
  const earnedToDate = billings.reduce((largest, row) => Math.max(largest, numeric(data(row).cumulativeEarned)), 0);
  const contractAmount = numeric(project.contract_amount);
  const currentContract = numeric(project.current_contract_amount || project.contract_amount);
  const forecast = forecasts.find((row) => String(row.project_id) === project.number);
  const estimateToComplete = forecast ? numeric(forecast.estimate_to_complete_cents) / 100 : Math.max(0, Math.max(originalBudget, committedCost, approvedCost) - actualCost);
  const riskReserve = forecast ? numeric(forecast.risk_reserve_cents) / 100 : 0;
  const estimatedCost = actualCost + estimateToComplete + riskReserve;
  const costCompletion = estimatedCost > 0 ? Math.min(1, actualCost / estimatedCost) : 0;
  const costToCostRevenue = currentContract * costCompletion;
  const designEarned = Math.min(authority.phaseOneAmount, billings.filter(row => isIssuedOwnerBilling(row.status) && data(row).billingPhase === PHASE_ONE_BILLING)
    .reduce((sum, row) => sum + numeric(data(row).currentEarned), 0));
  const recognizedRevenue = authority.construction
    ? (String(forecast?.recognition_method || "Cost To Cost") === "Approved Earned Override" ? earnedToDate : costToCostRevenue)
    : designEarned;
  const overUnderBilling = ownerBilled - recognizedRevenue;
  const ownerBillingSetup = projectRows.find((row) => row.record_type === "Owner Billing Setup" && row.id === "OWNER-BILLING-SETUP");
  const readyToClose = Boolean(data(budgetControl).locked) && authority.construction && Math.abs(overUnderBilling) <= 0.01;
  return {
    number: project.number,
    name: project.name,
    status: project.status,
    ownerName: project.owner_name,
    projectManager: project.project_manager,
    contractType: project.owner_contract_type,
    contractStatus: controlledContract?.status || project.owner_contract_status,
    contractAuthorized: authority.construction,
    contractAmount,
    currentContract,
    approvedChanges,
    originalBudget,
    budgetLocked: data(budgetControl).locked === true,
    billingSetupLocked: ownerBillingSetup?.status === "Locked",
    committedCost,
    approvedCost,
    paidCost,
    actualCost,
    estimateToComplete,
    riskReserve,
    openAp,
    ownerBilled,
    ownerReceived,
    accountsReceivable: Math.max(0, roundMoney(ownerBilled - ownerReceived)),
    earnedToDate,
    estimatedCost,
    wipPeriodId: String(forecast?.period_id || ""),
    wipStatus: String(forecast?.status || "Not Forecast"),
    wipNotes: String(forecast?.notes || ""),
    recognitionMethod: String(forecast?.recognition_method || "Cost To Cost"),
    projectedProfit: roundMoney(currentContract - estimatedCost),
    projectedMargin: currentContract > 0 ? (currentContract - estimatedCost) / currentContract : 0,
    costCompletion,
    recognizedRevenue,
    overUnderBilling,
    readyToClose,
  };
}

function summarize(projects: ReturnType<typeof projectFinancial>[], apInvoices: D1Row[], batches: D1Row[], cashAccounts: D1Row[]) {
  const sum = (field: keyof ReturnType<typeof projectFinancial>) => projects.reduce((total, project) => total + numeric(project[field]), 0);
  const signed = projects.filter(isContractedActiveProject);
  const pending = projects.filter(needsOwnerContractSignature);
  return {
    activeProjects: signed.length,
    currentContracts: roundMoney(signed.reduce((total, project) => total + project.currentContract, 0)),
    pendingContractProjects: pending.length,
    pendingContractValue: roundMoney(pending.reduce((total, project) => total + project.currentContract, 0)),
    ownerBilled: sum("ownerBilled"),
    ownerReceived: sum("ownerReceived"),
    accountsReceivable: sum("accountsReceivable"),
    openAp: sum("openAp"),
    paidProjectCost: sum("paidCost"),
    actualProjectCost: sum("actualCost"),
    projectedProfit: roundMoney(signed.reduce((total, project) => total + project.projectedProfit, 0)),
    approvedUnpaid: apInvoices.filter((row) => ["Approved Unpaid", "Payment Released"].includes(row.status)).reduce((total, row) => total + numeric(data(row).total), 0),
    preparedBatches: batches.filter((row) => ["Prepared", "Released"].includes(row.status)).reduce((total, row) => total + numeric(data(row).total), 0),
    reconciledCash: cashAccounts.filter((row) => row.status === "Reconciled").reduce((total, row) => total + numeric(data(row).bookBalance), 0),
  };
}

function buildIssues(projects: ReturnType<typeof projectFinancial>[], invoices: D1Row[], batches: D1Row[], cashAccounts: D1Row[]) {
  const issues: Array<ReturnType<typeof issue>> = [];
  const currentPeriod = easternPeriod();
  for (const project of projects.filter((item) => item.status === "Active")) {
    if (!project.contractAuthorized) issues.push(issue(`contract-${project.number}`, "Critical", "Contract", project.number, `${project.name} cannot bill or govern profit against an unexecuted owner contract. PM must resolve contract authority before cost exposure grows.`, "Owner Billing", "Project Manager", "Accounting verifies the contract and billing basis.", "Confirm signed contract status and stop unauthorized exposure."));
    if (!project.budgetLocked) issues.push(issue(`budget-${project.number}`, "Critical", "Budget", project.number, `${project.name} has no locked cost baseline, so the PM cannot trust variance, ETC, or projected profit.`, "WIP And Close", "Project Manager", "Accounting validates the cost structure and source totals.", "Lock the approved original budget before relying on the forecast."));
    if (!project.billingSetupLocked) issues.push(issue(`sov-${project.number}`, "Review", "Owner Billing", project.number, `${project.name} does not have a locked schedule of values. Accounting must give the PM a billable, contract-backed cash plan.`, "Owner Billing", "Accounting", "PM confirms earned work and billing strategy.", "Lock the SOV before the next owner billing cycle."));
    if (project.wipPeriodId !== currentPeriod) issues.push(issue(`wip-current-${project.number}`, "Review", "WIP", project.number, `${project.name} has no current ${currentPeriod} PM forecast. The PM is missing a current ETC, EAC, risk reserve, and projected-profit decision.`, "WIP And Close", "Accounting + Project Manager", "Accounting supplies reconciled cost, commitments, billing, and exception detail; PM owns forecast assumptions and recovery.", "Create and review the current-period decision pack."));
    if (project.projectedProfit <= 0) issues.push(issue(`loss-${project.number}`, "Critical", "Profit Protection", project.number, `${project.name} is forecast to lose ${money(Math.abs(project.projectedProfit))}. Accounting must reconcile the signal immediately; the PM must publish the recovery plan.`, "WIP And Close", "Project Manager", "Accounting traces cost, commitments, billing, and forecast inputs to permanent records.", "Document recovery through schedule, buyout, changes, productivity, billing, and remaining risk."));
    else if (project.projectedMargin * 10_000 < PROFITABILITY_FLOOR_BASIS_POINTS) issues.push(issue(`margin-${project.number}`, "Review", "Profit Protection", project.number, `${project.name} is forecasting ${(project.projectedMargin * 100).toFixed(1)}% gross margin, below the ${PROFITABILITY_FLOOR_BASIS_POINTS / 100}% company floor.`, "WIP And Close", "Project Manager", "Accounting verifies every cost and exposes the decision-driving variance by cost code.", "PM records a dated margin-recovery action before the next forecast review."));
    if (project.accountsReceivable > 0) issues.push(issue(`ar-${project.number}`, "Review", "Receivable", project.number, `${money(project.accountsReceivable)} remains due from the owner. Accounting must tell the PM which billing or collection action protects project cash and leverage.`, "Cash Management", "Accounting", "PM resolves owner documentation, approval, or relationship blockers.", "Record the collection owner, next action, and date."));
    if (Math.abs(project.overUnderBilling) > 0.01) issues.push(issue(`wip-${project.number}`, "Review", "WIP", project.number, `${money(Math.abs(project.overUnderBilling))} ${project.overUnderBilling > 0 ? "billings in excess" : "costs and earnings in excess"} changes the PM's cash and earnings decision for this period.`, "WIP And Close", "Accounting", "PM confirms forecast progress, billing strategy, and remaining project risk.", "Reconcile earned revenue and decide the next billing action."));
  }
  for (const invoice of invoices.filter((row) => row.status === "Approved Unpaid" && !String(data(row).paymentMethod || "").trim())) {
    issues.push(issue(`payment-${invoice.id}`, "Critical", "Accounts Payable", "Company", `${invoice.title} is approved but has no payment method.`, "Accounts Payable"));
  }
  for (const batch of batches.filter((row) => row.status === "Released")) {
    issues.push(issue(`batch-${batch.id}`, "Critical", "Cash", "Company", `${batch.title} was released but has not been matched to clearing confirmation.`, "Cash Management"));
  }
  for (const account of cashAccounts.filter((row) => row.status !== "Reconciled")) {
    issues.push(issue(`cash-${account.id}`, "Critical", "Reconciliation", "Company", `${account.title} does not reconcile to its latest statement.`, "Cash Management"));
  }
  if (!issues.length) issues.push(issue("accounting-current", "Ready", "Coordination", "Company", "Accounting records are coordinated with no current exceptions.", "Accounting Command"));
  return issues;
}

function issue(id: string, severity: "Critical" | "Review" | "Ready", area: string, project: string, message: string, target: string, accountableRole = "Accounting", supportRole = "Project Manager confirms the operating decision.", decision = "Resolve and preserve the source-backed decision.") {
  return { id, severity, area, project, message, target, accountableRole, supportRole, decision };
}

function easternPeriod() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit" }).formatToParts(new Date()).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}`;
}

async function releasePaymentBatch(database: D1Database, payload: ActionPayload, actor: ReturnType<typeof getCommandActor>, isOwner: boolean) {
  if (!isOwner) return Response.json({ error: "Only A Company Owner Can Release A Payment Batch" }, { status: 403 });
  const batch = await getRecord(database, ACCOUNTING_PROJECT_ID, payload.recordId || "");
  if (!batch || batch.record_type !== "Payment Batch" || batch.status !== "Prepared") return Response.json({ error: "Only A Prepared Payment Batch Can Be Released" }, { status: 409 });
  const batchData = data(batch);
  const invoiceIds = stringArray(batchData.invoiceIds);
  if (!invoiceIds.length) return Response.json({ error: "The Payment Batch Has No Invoices" }, { status: 409 });
  const invoices = await recordsByIds(database, ACCOUNTING_PROJECT_ID, invoiceIds);
  if (invoices.length !== invoiceIds.length || invoices.some((row) => row.status !== "Approved Unpaid" || !String(data(row).paymentMethod || "").trim() || String(data(row).paymentMethod) === "Scheduled Wire")) {
    return Response.json({ error: "Every Batch Invoice Must Be Approved Unpaid And Have A Payment Method" }, { status: 409 });
  }
  const now = new Date().toISOString();
  await database.batch([
    updateRecordStatement(database, batch, "Released", { ...batchData, releasedBy: actor.name, releasedAt: now, externalExecutionRequired: true }),
    ...invoices.map((invoice) => updateRecordStatement(database, invoice, "Payment Released", { ...data(invoice), paymentStatus: "Released", paymentBatchId: batch.id, paymentReleasedBy: actor.name, paymentReleasedAt: now })),
    auditStatement(database, ACCOUNTING_PROJECT_ID, batch.id, "Prepared", "Released", actor, `Payment batch released by ${actor.name}; external bank or card execution remains required.`),
  ]);
  return Response.json({ saved: true, status: "Released", notice: "Payment Batch Released. Match The External Clearing Confirmation To Complete Posting." });
}

async function clearWire(database: D1Database, payload: ActionPayload, actor: ReturnType<typeof getCommandActor>) {
  const wire = await getRecord(database, ACCOUNTING_PROJECT_ID, payload.recordId || "");
  if (!wire || wire.record_type !== "Wire Request" || wire.status !== "Initiated") return Response.json({ error: "Only An Initiated Wire Can Be Matched And Cleared" }, { status: 409 });
  const wireData = data(wire);
  const confirmation = String(wireData.bankConfirmation || payload.confirmation || "").trim();
  if (!confirmation) return Response.json({ error: "The Wire Bank Confirmation Is Required Before Clearing" }, { status: 400 });
  const invoice = await getRecord(database, ACCOUNTING_PROJECT_ID, String(wireData.invoiceId || ""));
  if (!invoice || invoice.record_type !== "AP Invoice" || invoice.status !== "Approved Unpaid") return Response.json({ error: "The Linked Invoice Must Still Be Approved Unpaid" }, { status: 409 });
  const now = new Date().toISOString();
  await ensureApInvoiceAccrued(database, invoice, actor);
  await ensureInvoiceJobCostActuals(database, invoice, actor, now);
  const legacyPayment = await database.prepare(`SELECT id FROM accounting_events WHERE idempotency_key = ? LIMIT 1`).bind(`AP_PAYMENT:${invoice.id}`).first<{ id: string }>();
  if (legacyPayment) return Response.json({ error: "This Invoice Already Has A Payment Posting But Is Not Marked Paid. Accounting Must Reconcile The Existing Posting; No Duplicate Was Posted." }, { status: 409 });
  const statements: D1PreparedStatement[] = [
    updateRecordStatement(database, wire, "Cleared", { ...wireData, clearedBy: actor.name, clearedAt: now }),
    updateRecordStatement(database, invoice, "Paid", { ...data(invoice), paymentStatus: "Paid", paidBy: actor.name, paidAt: now, wireRequestId: wire.id, clearingConfirmation: confirmation }),
    auditStatement(database, ACCOUNTING_PROJECT_ID, wire.id, "Initiated", "Cleared", actor, `Wire matched and cleared with external confirmation ${confirmation}.`),
  ];
  await postAccountingEvent(database, {
    idempotencyKey: `AP_PAYMENT:${invoice.id}`,
    eventType: "AP Payment Cleared",
    sourceType: "AP Invoice",
    sourceProjectId: ACCOUNTING_PROJECT_ID,
    sourceRecordId: invoice.id,
    eventDate: now.slice(0, 10),
    reference: confirmation,
    description: `${String(data(invoice).vendor || invoice.title)} · Invoice ${String(data(invoice).invoiceNumber || invoice.id)} Paid`,
    actor,
    metadata: { wireRequestId: wire.id, clearingConfirmation: confirmation },
    lines: apPaymentLines(recordAmount(invoice), `${String(data(invoice).vendor || invoice.title)} · ${confirmation}`),
    sourceSnapshot: { projectId: ACCOUNTING_PROJECT_ID, recordId: invoice.id, status: invoice.status, dataJson: invoice.data_json },
    relatedStatements: statements,
  });
  return Response.json({ saved: true, status: "Cleared", notice: "Wire Cleared. Accounts Payable Was Reduced And Cash Clearing Was Credited Without Duplicating Project Cost." });
}

async function clearPaymentBatch(database: D1Database, payload: ActionPayload, actor: ReturnType<typeof getCommandActor>) {
  const confirmation = payload.confirmation?.trim() || "";
  if (!confirmation) return Response.json({ error: "A Bank Card Or Check Clearing Confirmation Is Required" }, { status: 400 });
  const batch = await getRecord(database, ACCOUNTING_PROJECT_ID, payload.recordId || "");
  if (!batch || batch.record_type !== "Payment Batch" || batch.status !== "Released") return Response.json({ error: "Only A Released Payment Batch Can Be Cleared" }, { status: 409 });
  const batchData = data(batch);
  const invoiceIds = stringArray(batchData.invoiceIds);
  const invoices = await recordsByIds(database, ACCOUNTING_PROJECT_ID, invoiceIds);
  const alreadyClearedHere = (invoice: D1Row) => invoice.status === "Paid" && data(invoice).paymentBatchId === batch.id && data(invoice).clearingConfirmation === confirmation;
  if (!invoices.length || invoices.length !== invoiceIds.length || invoices.some((row) => row.record_type !== "AP Invoice" || (row.status !== "Payment Released" && !alreadyClearedHere(row)) || data(row).paymentBatchId !== batch.id)) return Response.json({ error: "Every Batch Invoice Must Be Released In This Batch Or Already Cleared With This Exact Confirmation" }, { status: 409 });
  const now = new Date().toISOString();
  for (const invoice of invoices) {
    if (alreadyClearedHere(invoice)) continue;
    await ensureApInvoiceAccrued(database, invoice, actor);
    await ensureInvoiceJobCostActuals(database, invoice, actor, now);
    const legacyPayment = await database.prepare(`SELECT id FROM accounting_events WHERE idempotency_key = ? LIMIT 1`).bind(`AP_PAYMENT:${invoice.id}`).first<{ id: string }>();
    if (legacyPayment) return Response.json({ error: `${invoice.id} Already Has A Payment Posting But Is Not Marked Paid. Accounting Must Reconcile The Existing Posting; No Duplicate Was Posted.` }, { status: 409 });
    await postAccountingEvent(database, {
      idempotencyKey: `AP_PAYMENT:${invoice.id}`,
      eventType: "AP Payment Cleared",
      sourceType: "AP Invoice",
      sourceProjectId: ACCOUNTING_PROJECT_ID,
      sourceRecordId: invoice.id,
      eventDate: now.slice(0, 10),
      reference: confirmation,
      description: `${String(data(invoice).vendor || invoice.title)} · Invoice ${String(data(invoice).invoiceNumber || invoice.id)} Paid`,
      actor,
      metadata: { paymentBatchId: batch.id, clearingConfirmation: confirmation },
      lines: apPaymentLines(recordAmount(invoice), `${String(data(invoice).vendor || invoice.title)} · ${confirmation}`),
      sourceSnapshot: { projectId: ACCOUNTING_PROJECT_ID, recordId: invoice.id, status: invoice.status, dataJson: invoice.data_json },
      relatedStatements: [updateRecordStatement(database, invoice, "Paid", { ...data(invoice), paymentStatus: "Paid", paidBy: actor.name, paidAt: now, clearingConfirmation: confirmation })],
    });
  }
  const statements: D1PreparedStatement[] = [
    updateRecordStatement(database, batch, "Cleared", { ...batchData, clearingConfirmation: confirmation, clearedBy: actor.name, clearedAt: now }),
    auditStatement(database, ACCOUNTING_PROJECT_ID, batch.id, "Released", "Cleared", actor, `Payment batch cleared with external confirmation ${confirmation}.`),
  ];
  // Each payment and its invoice are atomic. If the final batch receipt fails,
  // retry skips invoices already cleared with this same batch and confirmation.
  await database.batch(statements);
  return Response.json({ saved: true, status: "Cleared", notice: `${invoices.length} Invoice${invoices.length === 1 ? "" : "s"} Marked Paid. Accounts Payable Was Cleared Without Duplicating Project Cost.` });
}

async function sendOwnerBilling(database: D1Database, payload: ActionPayload, actor: ReturnType<typeof getCommandActor>) {
  const projectId = payload.projectId?.trim() || "";
  const billing = await getRecord(database, projectId, payload.recordId || "");
  if (!billing || billing.record_type !== "Owner Billing" || billing.status !== "Ready To Send") return Response.json({ error: "Only A Finalized Ready-To-Send Owner Invoice Can Be Marked Sent" }, { status: 409 });
  const billingData = data(billing);
  const authority = await ownerBillingReleaseError(database, projectId, { id: billing.id, data: billingData });
  if (authority.error) return Response.json({ error: authority.error }, { status: 409 });
  const now = new Date().toISOString();
  // Billing numbers are project-local; neither the company AR mirror nor the
  // journal idempotency key may use the number alone.
  const arId = `AR-${projectId}-${billing.id}`;
  const invoiceAmount = toCents(billingData.currentPaymentDue) / 100;
  const legacyPosting = await database.prepare(`SELECT id FROM accounting_events WHERE idempotency_key = ? AND source_project_id = ? LIMIT 1`).bind(`OWNER_BILLING:${billing.id}`, projectId).first<{ id: string }>();
  if (legacyPosting) return Response.json({ error: "This Invoice Has An Earlier Ledger Posting But Is Still Ready To Send. Accounting Must Reconcile That Posting Before Reissuing; No Duplicate Was Posted." }, { status: 409 });
  const statements = [
    ownerBillingPostingGuard(database, authority.authority, { id: billing.id, data: billingData }, authority.setupId!, authority.setupJson!),
    updateRecordStatement(database, billing, "Sent", { ...billingData, sentBy: actor.name, sentAt: now, deliveryReference: payload.deliveryReference?.trim() || "Recorded External Delivery", receivedToDate: numeric(billingData.receivedToDate) }),
    upsertRecordStatement(database, {
      projectId: ACCOUNTING_PROJECT_ID,
      id: arId,
      recordType: "AR Invoice",
      title: billing.title,
      owner: actor.name,
      due: billing.due,
      status: "Open",
      meta: `${projectId} · ${money(invoiceAmount)}`,
      recordDate: now.slice(0, 10),
      data: { projectId, billingId: billing.id, amount: invoiceAmount, receivedToDate: 0, balance: invoiceAmount, sentAt: now, sentBy: actor.name },
    }),
    auditStatement(database, projectId, billing.id, "Ready To Send", "Sent", actor, `Owner invoice delivery was recorded by ${actor.name}.`),
  ];
  await postAccountingEvent(database, {
    idempotencyKey: `OWNER_BILLING:${projectId}:${billing.id}`,
    eventType: "Owner Invoice Sent",
    sourceType: "Owner Billing",
    sourceProjectId: projectId,
    sourceRecordId: billing.id,
    eventDate: now.slice(0, 10),
    reference: arId,
    description: `${billing.title} · Owner Invoice Sent`,
    actor,
    metadata: { deliveryReference: payload.deliveryReference?.trim() || "Recorded External Delivery", revenueRecognition: "Pending WIP close" },
    lines: ownerBillingLines(invoiceAmount, projectId, billing.title),
    sourceSnapshot: { projectId, recordId: billing.id, status: billing.status, dataJson: billing.data_json },
    relatedStatements: statements,
  });
  const handoff = await recordCompletedWorkflowHandoff(database, { workflowId: "owner-billing", eventId: `owner-billing-approved:${projectId}:${billing.id}`, aggregateType: "Owner Billing", aggregateId: billing.id, projectId, actorName: actor.name, actorEmail: actor.email, occurredAt: now, payload: { billingId: billing.id, arId, invoiceAmount, status: "Sent" } });
  return Response.json({ saved: true, status: "Sent", notice: "Owner Invoice Marked Sent And Added To Accounts Receivable.", handoff });
}

async function recordOwnerReceipt(database: D1Database, payload: ActionPayload, actor: ReturnType<typeof getCommandActor>) {
  const projectId = payload.projectId?.trim() || "";
  const billing = await getRecord(database, projectId, payload.recordId || "");
  if (!billing || billing.record_type !== "Owner Billing" || !isIssuedOwnerBilling(billing.status)) return Response.json({ error: "Only A Sent Owner Invoice Can Receive Cash" }, { status: 409 });
  const amountCents = toCents(payload.amount);
  const amount = amountCents / 100;
  const reference = payload.reference?.trim() || "";
  const receiptDate = payload.receiptDate?.trim() || new Date().toISOString().slice(0, 10);
  const billingData = data(billing);
  const invoiceCents = toCents(billingData.currentPaymentDue);
  const priorCents = toCents(billingData.receivedToDate);
  const priorReceived = priorCents / 100;
  const receiptId = `OWNER-RECEIPT-${stableAccountingKey(`${projectId}:${billing.id}:${receiptDate}:${reference}:${amountCents}`)}`;
  const existingReceipt = await database.prepare(`SELECT id, data_json FROM command_records WHERE project_id = ? AND record_type = 'Owner Receipt' AND status = 'Posted' AND json_extract(data_json, '$.billingId') = ? AND json_extract(data_json, '$.receiptDate') = ? AND json_extract(data_json, '$.reference') = ? LIMIT 1`).bind(projectId, billing.id, receiptDate, reference).first<{ id: string; data_json: string }>();
  if (existingReceipt) {
    if (toCents(JSON.parse(existingReceipt.data_json).amount) !== amountCents) return Response.json({ error: "This Deposit Reference Is Already Recorded With A Different Amount. Use An Audited Correction." }, { status: 409 });
    return Response.json({ saved: true, idempotent: true, status: billing.status, receivedToDate: priorReceived, outstandingBalance: Math.max(0, invoiceCents - priorCents) / 100, notice: "This Owner Receipt Was Already Recorded. No Additional Cash Was Applied." });
  }
  if (amountCents <= 0 || amountCents > invoiceCents - priorCents || !reference) return Response.json({ error: "Enter A Positive Receipt Not Greater Than The Outstanding Balance And A Deposit Reference" }, { status: 400 });
  const receivedToDate = (priorCents + amountCents) / 100;
  const status = priorCents + amountCents === invoiceCents ? "Paid" : "Partially Paid";
  const now = new Date().toISOString();
  const receiptData = { projectId, billingId: billing.id, ownerName: billingData.ownerName, amount, receiptDate, reference, recordedBy: actor.name, recordedAt: now };
  const ar = await findOwnerReceivable(database, projectId, billing.id);
  const statements: D1PreparedStatement[] = [
    updateRecordStatement(database, billing, status, { ...billingData, receivedToDate, outstandingBalance: (invoiceCents - priorCents - amountCents) / 100, lastReceiptDate: receiptDate, lastReceiptReference: reference }),
    upsertRecordStatement(database, { projectId, id: receiptId, recordType: "Owner Receipt", title: `Receipt · ${billing.title}`, owner: actor.name, due: receiptDate, status: "Posted", meta: `${money(amount)} · ${reference}`, recordDate: receiptDate, data: receiptData }),
    upsertRecordStatement(database, { projectId: ACCOUNTING_PROJECT_ID, id: receiptId, recordType: "Owner Receipt", title: `Receipt · ${billing.title}`, owner: actor.name, due: receiptDate, status: "Posted", meta: `${projectId} · ${money(amount)} · ${reference}`, recordDate: receiptDate, data: receiptData }),
    auditStatement(database, projectId, billing.id, billing.status, status, actor, `${money(amount)} owner receipt recorded with deposit reference ${reference}.`),
  ];
  if (ar) statements.push(updateRecordStatement(database, ar, status === "Paid" ? "Paid" : "Partially Paid", { ...data(ar), receivedToDate, balance: (invoiceCents - priorCents - amountCents) / 100, lastReceiptDate: receiptDate, lastReceiptReference: reference }));
  const posting = await postAccountingEvent(database, {
    idempotencyKey: `OWNER_RECEIPT:${receiptId}`,
    eventType: "Owner Receipt Posted",
    sourceType: "Owner Receipt",
    sourceProjectId: projectId,
    sourceRecordId: receiptId,
    eventDate: receiptDate,
    reference,
    description: `${billing.title} · Owner Receipt`,
    actor,
    metadata: { billingId: billing.id, depositReference: reference },
    lines: ownerReceiptLines(amount, projectId, `${billing.title} · ${reference}`),
    sourceSnapshot: { projectId, recordId: billing.id, status: billing.status, dataJson: billing.data_json },
    relatedStatements: statements,
  });
  if (posting.idempotent) {
    const current = await getRecord(database, projectId, billing.id);
    return Response.json({ saved: true, idempotent: true, status: current?.status, receivedToDate: numeric(data(current).receivedToDate), outstandingBalance: (invoiceCents - toCents(data(current).receivedToDate)) / 100 });
  }
  return Response.json({ saved: true, status, receivedToDate, outstandingBalance: (invoiceCents - priorCents - amountCents) / 100, notice: `${money(amount)} Owner Receipt Posted To Accounting And ${projectId}.` });
}

async function findOwnerReceivable(database: D1Database, projectId: string, billingId: string) {
  return database.prepare(`SELECT * FROM command_records WHERE project_id = ? AND record_type = 'AR Invoice' AND json_extract(data_json, '$.projectId') = ? AND json_extract(data_json, '$.billingId') = ? LIMIT 1`).bind(ACCOUNTING_PROJECT_ID, projectId, billingId).first<D1Row>();
}

async function saveCashAccount(database: D1Database, payload: ActionPayload, actor: ReturnType<typeof getCommandActor>) {
  const account = payload.account;
  const name = account?.name?.trim() || "";
  const lastFour = account?.lastFour?.trim() || "";
  const statementDate = account?.statementDate?.trim() || "";
  const bookBalance = numeric(account?.bookBalance);
  const bankBalance = numeric(account?.bankBalance);
  if (![account?.bookBalance ?? 0, account?.bankBalance ?? 0].every(value => Number.isFinite(Number(value)) && Number.isSafeInteger(toCents(value)))) return Response.json({ error: "Cash Balances Must Be Valid Amounts" }, { status: 400 });
  if (!name || !/^\d{4}$/.test(lastFour) || !isAccountingDate(statementDate)) return Response.json({ error: "Cash Account Name Last Four Digits And Statement Date Are Required" }, { status: 400 });
  const difference = bookBalance - bankBalance;
  const status = Math.abs(difference) <= 0.01 ? "Reconciled" : "Needs Review";
  const id = account?.id?.trim() || `CASH-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await database.batch([
    upsertRecordStatement(database, { projectId: ACCOUNTING_PROJECT_ID, id, recordType: "Cash Account", title: `${name} · ${lastFour}`, owner: actor.name, due: statementDate, status, meta: `${money(bookBalance)} Book · ${money(bankBalance)} Bank`, recordDate: statementDate, data: { name, lastFour, bookBalance, bankBalance, difference, statementDate, reconciledBy: status === "Reconciled" ? actor.name : "", reconciledAt: status === "Reconciled" ? now : "", noSensitiveAccountData: true } }),
    auditStatement(database, ACCOUNTING_PROJECT_ID, id, "Previous Reconciliation", status, actor, `${name} ending ${lastFour} saved with a ${money(difference)} reconciliation difference.`),
  ]);
  return Response.json({ saved: true, id, status, notice: status === "Reconciled" ? "Cash Account Reconciled." : `Cash Account Saved With A ${money(Math.abs(difference))} Difference.` });
}

async function savePayrollReport(database: D1Database, payload: ActionPayload, actor: ReturnType<typeof getCommandActor>) {
  const payroll = payload.payroll;
  const allocations = payroll?.allocations ?? [];
  if (!payroll?.periodStart || !payroll.periodEnd || !payroll.payDate || !payroll.employee?.trim()) {
    return Response.json({ error: "Period Start Period End Pay Date And Employee Are Required" }, { status: 400 });
  }
  if (payroll.periodEnd < payroll.periodStart) {
    return Response.json({ error: "Payroll Period End Cannot Be Before The Period Start" }, { status: 400 });
  }
  if (![payroll.periodStart, payroll.periodEnd, payroll.payDate].every(isAccountingDate)) return Response.json({ error: "Valid Payroll Dates Are Required" }, { status: 400 });
  if (![payroll.bonus ?? 0, payroll.reimbursement ?? 0, payroll.deduction ?? 0].every(value => Number.isFinite(Number(value)) && Number(value) >= 0)) return Response.json({ error: "Payroll Amounts Must Be Valid Non-Negative Numbers" }, { status: 400 });
  const hours = [payroll.regularHours, payroll.overtimeHours, payroll.ptoHours, payroll.holidayHours].map(value => Number(value || 0));
  if (hours.some(value => !Number.isFinite(value) || value < 0) || allocations.some(line => !Number.isFinite(Number(line.hours))) ||
      Math.round(hours.reduce((sum, value) => sum + value, 0) * 100) !== Math.round(allocations.reduce((sum, line) => sum + Number(line.hours || 0), 0) * 100)) {
    return Response.json({ error: "Payroll Hours Must Be Non-Negative And Fully Distributed To Project Or Overhead Lines" }, { status: 400 });
  }
  if (allocations.some((allocation) => !allocation.destination?.trim() || !allocation.code?.trim() || numeric(allocation.hours) < 0)) {
    return Response.json({ error: "Every Project Distribution Line Requires A Destination Cost Code And Non-Negative Hours" }, { status: 400 });
  }
  const id = payroll.id?.trim() || `PAYROLL-REPORT-${payroll.periodEnd}-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const recordData = {
    ...payroll,
    payrollCompany: "Paylocity",
    employeeIdLastFour: String(payroll.employeeIdLastFour || "").replace(/\D/g, "").slice(-4),
    regularHours: numeric(payroll.regularHours),
    overtimeHours: numeric(payroll.overtimeHours),
    ptoHours: numeric(payroll.ptoHours),
    holidayHours: numeric(payroll.holidayHours),
    bonus: numeric(payroll.bonus),
    reimbursement: numeric(payroll.reimbursement),
    deduction: numeric(payroll.deduction),
    allocations: allocations.map((allocation) => ({ ...allocation, hours: numeric(allocation.hours) })),
    reportOnly: true,
    payrollProcessingDisabled: true,
    paymentExecutionDisabled: true,
    taxFilingDisabled: true,
    preparedBy: actor.name,
    preparedAt: now,
  };
  await database.batch([
    upsertRecordStatement(database, {
      projectId: ACCOUNTING_PROJECT_ID,
      id,
      recordType: "Payroll Report",
      title: `${payroll.employee} · ${payroll.periodStart} Through ${payroll.periodEnd}`,
      owner: actor.name,
      due: payroll.payDate,
      status: "Ready To Share",
      meta: `Paylocity · ${allocations.length} Project Distribution Line${allocations.length === 1 ? "" : "s"}`,
      recordDate: payroll.periodEnd,
      data: recordData,
    }),
    auditStatement(database, ACCOUNTING_PROJECT_ID, id, "New", "Ready To Share", actor, `${payroll.employee} payroll-company report prepared for ${payroll.periodStart} through ${payroll.periodEnd}. No payroll was processed.`),
  ]);
  return Response.json({ saved: true, status: "Ready To Share", id, notice: "Paylocity Payroll Packet Record Saved. Download The Period File When Ready; Nothing Was Sent Or Processed." });
}

async function recordPaylocityReturn(database: D1Database, payload: ActionPayload, actor: ReturnType<typeof getCommandActor>) {
  const returned = payload.payrollReturn;
  const periodStart = returned?.periodStart?.trim() || "";
  const periodEnd = returned?.periodEnd?.trim() || "";
  const payDate = returned?.payDate?.trim() || "";
  const returnReference = returned?.returnReference?.trim() || "";
  const lines = returned?.allocations ?? [];
  if (!periodStart || !periodEnd || !payDate || !returnReference) {
    return Response.json({ error: "Period Start Period End Pay Date And Paylocity Return Reference Are Required" }, { status: 400 });
  }
  if (![periodStart, periodEnd, payDate].every(isAccountingDate) || ![returned?.grossWages ?? 0, returned?.employerTaxes ?? 0, returned?.employerBenefits ?? 0, returned?.employeeDeductions ?? 0, returned?.netPay ?? 0, ...lines.map(line => line.amount)].every(value => Number.isFinite(Number(value)) && Number(value) >= 0 && Number.isSafeInteger(toCents(value)))) return Response.json({ error: "Returned Payroll Dates And Amounts Must Be Valid" }, { status: 400 });
  if (periodEnd < periodStart) return Response.json({ error: "Payroll Period End Cannot Be Before The Period Start" }, { status: 400 });
  if (!lines.length || lines.some((line) => !line.destination?.trim() || !line.code?.trim() || numeric(line.amount) < 0)) {
    return Response.json({ error: "Every Returned-Report Allocation Requires A Destination Cost Code And Non-Negative Amount" }, { status: 400 });
  }

  const grossWages = numeric(returned?.grossWages);
  const employerTaxes = numeric(returned?.employerTaxes);
  const employerBenefits = numeric(returned?.employerBenefits);
  const employeeDeductions = numeric(returned?.employeeDeductions);
  const netPay = numeric(returned?.netPay);
  const totalLaborCost = grossWages + employerTaxes + employerBenefits;
  const allocatedLaborCost = lines.reduce((sum, line) => sum + numeric(line.amount), 0);
  if (grossWages < 0 || employerTaxes < 0 || employerBenefits < 0 || employeeDeductions < 0 || netPay < 0) {
    return Response.json({ error: "Returned Payroll Totals Cannot Be Negative" }, { status: 400 });
  }
  if (toCents(totalLaborCost) !== toCents(allocatedLaborCost)) {
    return Response.json({ error: `Returned Labor Cost Must Be Fully Distributed. Difference ${money(totalLaborCost - allocatedLaborCost)}.` }, { status: 400 });
  }

  const payrollRows = await database.prepare(
    `SELECT project_id, id, record_type, title, owner, due, status, meta, record_date, data_json, updated_at
     FROM command_records WHERE project_id = ? AND record_type = 'Payroll Report'`,
  ).bind(ACCOUNTING_PROJECT_ID).all<D1Row>();
  const periodReports = (payrollRows.results ?? []).filter((row) => {
    const report = data(row);
    return report.periodStart === periodStart && report.periodEnd === periodEnd && report.payDate === payDate;
  });
  if (!periodReports.length) {
    return Response.json({ error: "Create The Paylocity Payroll Packet For This Exact Period And Pay Date Before Recording Its Return" }, { status: 400 });
  }

  const returnId = `PAYLOCITY-RETURN-${periodStart}-${periodEnd}-${payDate}`;
  if (await getRecord(database, ACCOUNTING_PROJECT_ID, returnId)) {
    return Response.json({ error: "This Paylocity Period Is Already Reconciled. Preserve The Original And Record Any Correction As A New Accounting Adjustment." }, { status: 409 });
  }

  const destinations = [...new Set(lines.map((line) => line.destination?.trim() || "").filter((destination) => destination !== "Company Overhead"))];
  if (destinations.length) {
    const placeholders = destinations.map(() => "?").join(",");
    const projectRows = await database.prepare(`SELECT number FROM projects WHERE number IN (${placeholders})`).bind(...destinations).all<{ number: string }>();
    const valid = new Set((projectRows.results ?? []).map((project) => project.number));
    const invalid = destinations.find((destination) => !valid.has(destination));
    if (invalid) return Response.json({ error: `Project ${invalid} Is Not A Valid Job-Cost Destination` }, { status: 400 });
  }

  const reconciledAt = new Date().toISOString();
  const normalizedLines = lines.map((line, index) => ({
    id: line.id?.trim() || `RETURN-LINE-${index + 1}`,
    destination: line.destination?.trim() || "",
    code: line.code?.trim() || "",
    description: line.description?.trim() || "",
    amount: numeric(line.amount),
  }));
  const recordData = {
    provider: "Paylocity",
    periodStart,
    periodEnd,
    payDate,
    returnReference,
    grossWages,
    employerTaxes,
    employerBenefits,
    employeeDeductions,
    netPay,
    totalLaborCost,
    allocatedLaborCost,
    allocations: normalizedLines,
    notes: returned?.notes?.trim() || "",
    sourcePacketIds: periodReports.map((row) => row.id),
    reconciledBy: totalLaborCost > 200000 ? "" : actor.name,
    reconciledAt: totalLaborCost > 200000 ? "" : reconciledAt,
    preparedBy: actor.name,
    preparedByEmail: actor.email,
    preparedAt: reconciledAt,
    ownerApprovalRequired: totalLaborCost > 200000,
    manuallyReceived: true,
    providerConnectionDisabled: true,
  };
  if (totalLaborCost > 200000) {
    await database.batch([
      upsertRecordStatement(database, {
        projectId: ACCOUNTING_PROJECT_ID,
        id: returnId,
        recordType: "Paylocity Payroll Return",
        title: `Paylocity Return · ${periodStart} Through ${periodEnd}`,
        owner: actor.name,
        due: payDate,
        status: "Owner Approval Required",
        meta: `${money(totalLaborCost)} · ${returnReference} · Posting Held`,
        recordDate: periodEnd,
        data: recordData,
      }),
      auditStatement(database, ACCOUNTING_PROJECT_ID, returnId, "Not Received", "Owner Approval Required", actor, `Paylocity return ${returnReference} was manually received for ${money(totalLaborCost)}. Ledger and job-cost posting are held for owner approval.`),
    ]);
    return Response.json({ saved: true, status: "Owner Approval Required", id: returnId, notice: `Paylocity Return Saved. ${money(totalLaborCost)} Requires Owner Approval Before It Posts To The Ledger Or Project Cost.` });
  }
  const statements: D1PreparedStatement[] = [
    upsertRecordStatement(database, {
      projectId: ACCOUNTING_PROJECT_ID,
      id: returnId,
      recordType: "Paylocity Payroll Return",
      title: `Paylocity Return · ${periodStart} Through ${periodEnd}`,
      owner: actor.name,
      due: payDate,
      status: "Reconciled",
      meta: `${money(totalLaborCost)} · ${returnReference}`,
      recordDate: periodEnd,
      data: recordData,
    }),
    auditStatement(database, ACCOUNTING_PROJECT_ID, returnId, "Not Received", "Reconciled", actor, `Paylocity return ${returnReference} was manually received and reconciled for ${money(totalLaborCost)}. No provider connection or payroll execution occurred.`),
  ];
  normalizedLines.forEach((line, index) => {
    if (line.destination === "Company Overhead" || line.amount <= 0) return;
    const actualId = `${returnId}-JOB-COST-${index + 1}`;
    statements.push(upsertRecordStatement(database, {
      projectId: line.destination,
      id: actualId,
      recordType: "Job Cost Actual",
      title: `Payroll · ${line.code} · ${periodEnd}`,
      owner: actor.name,
      due: payDate,
      status: "Posted",
      meta: `${money(line.amount)} · Paylocity ${returnReference}`,
      recordDate: periodEnd,
      data: { source: "Paylocity Return", sourceRecordId: returnId, returnReference, periodStart, periodEnd, payDate, costCode: line.code, description: line.description, amount: line.amount, postedBy: actor.name, postedAt: reconciledAt },
    }));
  });
  await postAccountingEvent(database, {
    idempotencyKey: `PAYLOCITY_RETURN:${returnId}`, eventType: "Payroll Return Reconciled",
    sourceType: "Paylocity Payroll Return", sourceProjectId: ACCOUNTING_PROJECT_ID, sourceRecordId: returnId,
    eventDate: periodEnd, reference: returnReference, description: `Paylocity Return · ${periodStart} Through ${periodEnd}`,
    actor, metadata: { periodStart, periodEnd, payDate, grossWages, employerTaxes, employerBenefits, employeeDeductions, netPay },
    lines: payrollReturnLines(normalizedLines, `Paylocity ${returnReference}`), relatedStatements: statements,
  });
  const handoff = await recordCompletedWorkflowHandoff(database, { workflowId: "payroll-exchange", eventId: `payroll-return-reconciled:${returnId}`, aggregateType: "Paylocity Payroll Return", aggregateId: returnId, projectId: ACCOUNTING_PROJECT_ID, actorName: actor.name, actorEmail: actor.email, occurredAt: reconciledAt, payload: { returnId, totalLaborCost, allocationCount: normalizedLines.length } });
  return Response.json({ saved: true, status: "Reconciled", id: returnId, notice: `Paylocity Return Reconciled. ${money(totalLaborCost)} Was Distributed To Project And Overhead Accounting.`, handoff });
}

async function approvePaylocityReturn(database: D1Database, payload: ActionPayload, actor: ReturnType<typeof getCommandActor>, isOwner: boolean) {
  if (!isOwner) return Response.json({ error: "Only A Company Owner Can Approve A High-Dollar Payroll Return" }, { status: 403 });
  const returnId = payload.recordId?.trim() || "";
  const record = await getRecord(database, ACCOUNTING_PROJECT_ID, returnId);
  if (!record || record.record_type !== "Paylocity Payroll Return" || record.status !== "Owner Approval Required") {
    return Response.json({ error: "A Pending High-Dollar Paylocity Return Is Required" }, { status: 409 });
  }
  const recordData = data(record);
  const preparedBy = String(recordData.preparedBy || record.owner);
  if (String(recordData.preparedByEmail || "").toLowerCase() === actor.email.toLowerCase()) {
    return Response.json({ error: "Owner Approval Must Be Independent From Payroll Return Preparation" }, { status: 409 });
  }
  const lines = Array.isArray(recordData.allocations) ? recordData.allocations.map((line, index) => {
    const item = line && typeof line === "object" ? line as Record<string, unknown> : {};
    return { id: String(item.id || `RETURN-LINE-${index + 1}`), destination: String(item.destination || ""), code: String(item.code || ""), description: String(item.description || ""), amount: numeric(item.amount) };
  }) : [];
  const returnReference = String(recordData.returnReference || record.id);
  const periodStart = String(recordData.periodStart || record.record_date || "");
  const periodEnd = String(recordData.periodEnd || record.record_date || "");
  const payDate = String(recordData.payDate || record.due || "");
  const reconciledAt = new Date().toISOString();
  const updatedData = { ...recordData, reconciledBy: actor.name, reconciledAt, approvedBy: actor.name, approvedAt: reconciledAt, ownerApprovalRequired: false };
  const statements: D1PreparedStatement[] = [
    upsertRecordStatement(database, { projectId: ACCOUNTING_PROJECT_ID, id: returnId, recordType: record.record_type, title: record.title, owner: actor.name, due: record.due, status: "Reconciled", meta: `${money(numeric(recordData.totalLaborCost))} · ${returnReference} · Owner Approved`, recordDate: record.record_date || periodEnd, data: updatedData }),
    auditStatement(database, ACCOUNTING_PROJECT_ID, returnId, "Owner Approval Required", "Reconciled", actor, `Owner approved and posted high-dollar Paylocity return ${returnReference}.`),
  ];
  lines.forEach((line, index) => {
    if (line.destination === "Company Overhead" || line.amount <= 0) return;
    statements.push(upsertRecordStatement(database, { projectId: line.destination, id: `${returnId}-JOB-COST-${index + 1}`, recordType: "Job Cost Actual", title: `Payroll · ${line.code} · ${periodEnd}`, owner: actor.name, due: payDate, status: "Posted", meta: `${money(line.amount)} · Paylocity ${returnReference}`, recordDate: periodEnd, data: { source: "Paylocity Return", sourceRecordId: returnId, returnReference, periodStart, periodEnd, payDate, costCode: line.code, description: line.description, amount: line.amount, postedBy: actor.name, postedAt: reconciledAt } }));
  });
  await postAccountingEvent(database, {
    idempotencyKey: `PAYLOCITY_RETURN:${returnId}`, eventType: "Payroll Return Reconciled",
    sourceType: "Paylocity Payroll Return", sourceProjectId: ACCOUNTING_PROJECT_ID, sourceRecordId: returnId,
    eventDate: periodEnd, reference: returnReference, description: `Paylocity Return · ${periodStart} Through ${periodEnd}`,
    actor, metadata: { periodStart, periodEnd, payDate, ownerApproved: true, preparedBy },
    lines: payrollReturnLines(lines, `Paylocity ${returnReference}`),
    sourceSnapshot: { projectId: ACCOUNTING_PROJECT_ID, recordId: returnId, status: record.status, dataJson: record.data_json },
    relatedStatements: statements,
  });
  const handoff = await recordCompletedWorkflowHandoff(database, { workflowId: "payroll-exchange", eventId: `payroll-return-reconciled:${returnId}`, aggregateType: "Paylocity Payroll Return", aggregateId: returnId, projectId: ACCOUNTING_PROJECT_ID, actorName: actor.name, actorEmail: actor.email, occurredAt: reconciledAt, payload: { returnId, totalLaborCost: numeric(recordData.totalLaborCost), allocationCount: lines.length, ownerApproved: true } });
  return Response.json({ saved: true, status: "Reconciled", id: returnId, notice: `Owner Approved And Posted ${money(numeric(recordData.totalLaborCost))} To Payroll And Project Cost.`, handoff });
}

type NormalizedJournalLine = {
  id: string;
  accountNumber: string;
  accountName: string;
  description: string;
  projectId: string;
  department: string;
  debit: number;
  credit: number;
};

function normalizedJournal(payload: ActionPayload) {
  const journal = payload.journal;
  const lines: NormalizedJournalLine[] = (journal?.lines ?? []).map((line, index) => ({
    id: line.id?.trim() || `LINE-${index + 1}`,
    accountNumber: currentAccountNumber(line.accountNumber),
    accountName: line.accountName?.trim() || "",
    description: line.description?.trim() || "",
    projectId: line.projectId?.trim() || "",
    department: line.department?.trim() || "",
    debit: Number(line.debit ?? 0),
    credit: Number(line.credit ?? 0),
  }));
  return {
    id: journal?.id?.trim() || "",
    entryDate: journal?.entryDate?.trim() || "",
    entryType: journal?.entryType || "Standard",
    reference: journal?.reference?.trim() || "",
    description: journal?.description?.trim() || "",
    supportReference: journal?.supportReference?.trim() || "",
    lines,
  };
}

function journalTotals(lines: NormalizedJournalLine[]) {
  const debit = lines.reduce((sum, line) => sum + toCents(line.debit), 0);
  const credit = lines.reduce((sum, line) => sum + toCents(line.credit), 0);
  return { debit: debit / 100, credit: credit / 100, difference: (debit - credit) / 100 };
}

function ledgerLines(lines: NormalizedJournalLine[]): AccountingLineInput[] {
  return lines.map((line) => ({
    accountNumber: line.accountNumber,
    accountName: line.accountName,
    description: line.description,
    projectId: line.projectId,
    department: line.department,
    debitCents: toCents(line.debit),
    creditCents: toCents(line.credit),
  }));
}

function manualJournalSnapshot(journal: ReturnType<typeof normalizedJournal>, entryData: Record<string, unknown>, status: "Draft" | "Submitted" | "Approved") {
  return {
    id: journal.id,
    entryDate: journal.entryDate,
    entryType: journal.entryType,
    reference: journal.reference,
    description: journal.description,
    supportReference: journal.supportReference,
    status,
    sourceType: "Manual Journal",
    sourceProjectId: ACCOUNTING_PROJECT_ID,
    sourceRecordId: journal.id,
    preparedBy: String(entryData.preparedBy || ""),
    preparedEmail: String(entryData.preparedEmail || ""),
    approvedBy: String(entryData.approvedBy || ""),
    approvedEmail: String(entryData.approvedEmail || ""),
    approvedAt: String(entryData.approvedAt || ""),
    reversesEntryId: String(entryData.reversesEntryId || ""),
    lines: ledgerLines(journal.lines),
  };
}

function journalValidation(journal: ReturnType<typeof normalizedJournal>, readyToSubmit: boolean) {
  if (!journal.entryDate || !journal.reference || !journal.description) return "Entry Date Reference And Description Are Required";
  if (!isAccountingDate(journal.entryDate)) return "A Valid Accounting Date Is Required";
  if (journal.lines.some(line => !Number.isFinite(line.debit) || !Number.isFinite(line.credit) || !Number.isSafeInteger(toCents(line.debit)) || !Number.isSafeInteger(toCents(line.credit)))) return "Journal Amounts Must Be Valid Finite Numbers";
  if (journal.lines.length < 2) return "A Journal Entry Requires At Least Two Lines";
  if (journal.lines.some((line) => !/^[1-9]\d{3}$/.test(line.accountNumber) || !line.accountName)) return "Every Journal Line Requires A Four-Digit General Ledger Account";
  if (journal.lines.some((line) => line.debit < 0 || line.credit < 0 || (line.debit > 0 && line.credit > 0))) return "Each Journal Line May Contain One Non-Negative Debit Or Credit Amount";
  if (!readyToSubmit) return "";
  if (!journal.supportReference) return "A Support Reference Is Required Before Submission";
  if (journal.lines.some((line) => line.debit <= 0 && line.credit <= 0)) return "Every Submitted Journal Line Requires A Debit Or Credit Amount";
  const totals = journalTotals(journal.lines);
  if (totals.debit <= 0 || totals.difference !== 0) return `Debits And Credits Must Balance. Current Difference ${money(totals.difference)}.`;
  return "";
}

function journalSource(entry: D1Row) { return { projectId: entry.project_id, recordId: entry.id, status: entry.status, dataJson: entry.data_json }; }

async function saveJournalEntry(database: D1Database, payload: ActionPayload, actor: ReturnType<typeof getCommandActor>) {
  const journal = normalizedJournal(payload);
  const validation = journalValidation(journal, false);
  if (validation) return Response.json({ error: validation }, { status: 400 });
  const chart = await database.prepare("SELECT * FROM command_records WHERE project_id = ? AND record_type = 'Chart Of Accounts'").bind(ACCOUNTING_PROJECT_ID).all<D1Row>();
  const available = selectableLedgerAccounts(buildAccountCatalog(chart.results || []));
  if (journal.lines.some(line => !available.some(account => account.accountNumber === line.accountNumber))) return Response.json({ error: "Select An Available Account From The Chart. New Accounts Require Owner Activation." }, { status: 400 });
  journal.lines.forEach(line => { line.accountName = available.find(account => account.accountNumber === line.accountNumber)!.legacyName; });
  const existing = journal.id ? await getRecord(database, ACCOUNTING_PROJECT_ID, journal.id) : null;
  if (existing && (existing.record_type !== "Journal Entry" || existing.status !== "Draft")) return Response.json({ error: "Only A Draft Journal Entry Can Be Edited" }, { status: 409 });
  const prior = data(existing);
  if (existing && String(prior.preparedEmail || "").toLowerCase() !== String(actor.email || "").toLowerCase()) return Response.json({ error: "Only The Preparer Can Edit This Draft Journal Entry" }, { status: 403 });
  const id = existing?.id || `JE-${journal.entryDate.replaceAll("-", "")}-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const totals = journalTotals(journal.lines);
  const entryData = {
    ...prior,
    ...journal,
    id,
    totals,
    preparedBy: prior.preparedBy || actor.name,
    preparedEmail: prior.preparedEmail || actor.email,
    preparedAt: prior.preparedAt || now,
    updatedBy: actor.name,
    updatedAt: now,
    immutableAfterPosting: true,
    openingBalanceBatch: journal.entryType === "Opening Balance",
  };
  await saveManualJournalSnapshot(database, manualJournalSnapshot({ ...journal, id }, entryData, "Draft"), { sourceSnapshot: existing ? journalSource(existing) : undefined, relatedStatements: [
    upsertRecordStatement(database, { projectId: ACCOUNTING_PROJECT_ID, id, recordType: "Journal Entry", title: `${journal.entryType} · ${journal.reference}`, owner: String(prior.preparedBy || actor.name), due: journal.entryDate, status: "Draft", meta: `${money(totals.debit)} Debits · ${money(totals.credit)} Credits`, recordDate: journal.entryDate, data: entryData }),
    auditStatement(database, ACCOUNTING_PROJECT_ID, id, existing ? "Draft" : "New", "Draft", actor, `${journal.entryType} journal ${journal.reference} saved as a draft.`),
  ] });
  return Response.json({ saved: true, id, status: "Draft", notice: "Journal Entry Draft Saved." });
}

async function submitJournalEntry(database: D1Database, payload: ActionPayload, actor: ReturnType<typeof getCommandActor>) {
  const entry = await getRecord(database, ACCOUNTING_PROJECT_ID, payload.recordId || "");
  if (!entry || entry.record_type !== "Journal Entry" || entry.status !== "Draft") return Response.json({ error: "Only A Draft Journal Entry Can Be Submitted" }, { status: 409 });
  const entryData = data(entry);
  if (String(entryData.preparedEmail || "").toLowerCase() !== String(actor.email || "").toLowerCase()) return Response.json({ error: "Only The Preparer Can Submit This Journal Entry" }, { status: 403 });
  const journal = normalizedJournal({ journal: entryData as ActionPayload["journal"] });
  const validation = journalValidation(journal, true);
  if (validation) return Response.json({ error: validation }, { status: 400 });
  const now = new Date().toISOString();
  await saveManualJournalSnapshot(database, manualJournalSnapshot(journal, entryData, "Submitted"), { sourceSnapshot: journalSource(entry), relatedStatements: [
    updateRecordStatement(database, entry, "Submitted", { ...entryData, submittedBy: actor.name, submittedEmail: actor.email, submittedAt: now }),
    auditStatement(database, ACCOUNTING_PROJECT_ID, entry.id, "Draft", "Submitted", actor, `Balanced journal ${journal.reference} submitted for independent approval.`),
  ] });
  return Response.json({ saved: true, id: entry.id, status: "Submitted", notice: "Balanced Journal Entry Submitted For Independent Approval." });
}

async function approveJournalEntry(database: D1Database, payload: ActionPayload, actor: ReturnType<typeof getCommandActor>) {
  const entry = await getRecord(database, ACCOUNTING_PROJECT_ID, payload.recordId || "");
  if (!entry || entry.record_type !== "Journal Entry" || entry.status !== "Submitted") return Response.json({ error: "Only A Submitted Journal Entry Can Be Approved" }, { status: 409 });
  const entryData = data(entry);
  if (String(entryData.preparedEmail || "").toLowerCase() === String(actor.email || "").toLowerCase()) return Response.json({ error: "The Preparer Cannot Approve Their Own Journal Entry" }, { status: 403 });
  const journal = normalizedJournal({ journal: entryData as ActionPayload["journal"] });
  const validation = journalValidation(journal, true);
  if (validation) return Response.json({ error: validation }, { status: 400 });
  const now = new Date().toISOString();
  await saveManualJournalSnapshot(database, manualJournalSnapshot(journal, { ...entryData, approvedBy: actor.name, approvedEmail: actor.email, approvedAt: now }, "Approved"), { sourceSnapshot: journalSource(entry), relatedStatements: [
    updateRecordStatement(database, entry, "Approved", { ...entryData, approvedBy: actor.name, approvedEmail: actor.email, approvedAt: now }),
    auditStatement(database, ACCOUNTING_PROJECT_ID, entry.id, "Submitted", "Approved", actor, `Journal ${journal.reference} independently approved by ${actor.name}.`),
  ] });
  return Response.json({ saved: true, id: entry.id, status: "Approved", notice: "Journal Entry Approved And Ready To Post." });
}

async function postJournalEntry(database: D1Database, payload: ActionPayload, actor: ReturnType<typeof getCommandActor>) {
  const entry = await getRecord(database, ACCOUNTING_PROJECT_ID, payload.recordId || "");
  if (!entry || entry.record_type !== "Journal Entry" || entry.status !== "Approved") return Response.json({ error: "Only An Approved Journal Entry Can Be Posted" }, { status: 409 });
  const entryData = data(entry);
  if (!entryData.approvedEmail || String(entryData.approvedEmail).toLowerCase() === String(entryData.preparedEmail || "").toLowerCase()) return Response.json({ error: "Independent Approval Evidence Is Required Before Posting" }, { status: 409 });
  const journal = normalizedJournal({ journal: entryData as ActionPayload["journal"] });
  const validation = journalValidation(journal, true);
  if (validation) return Response.json({ error: validation }, { status: 400 });
  const now = new Date().toISOString();
  await saveManualJournalSnapshot(database, manualJournalSnapshot(journal, entryData, "Approved"), { sourceSnapshot: journalSource(entry) });
  await postManualJournalSnapshot(database, entry.id, actor, { sourceSnapshot: journalSource(entry), relatedStatements: [
    updateRecordStatement(database, entry, "Posted", { ...entryData, postedBy: actor.name, postedEmail: actor.email, postedAt: now, postedSnapshotLocked: true }),
    auditStatement(database, ACCOUNTING_PROJECT_ID, entry.id, "Approved", "Posted", actor, `Journal ${journal.reference} posted to the permanent general ledger.`),
  ] });
  const assetId = String(entryData.assetId || entryData.sourceAssetId || "");
  const handoff = assetId ? await recordCompletedWorkflowHandoff(database, { workflowId: "asset-accounting", eventId: `asset-journal-posted:${assetId}:${entry.id}`, aggregateType: "Journal Entry", aggregateId: entry.id, projectId: ACCOUNTING_PROJECT_ID, actorName: actor.name, actorEmail: actor.email, occurredAt: now, payload: { assetId, journalEntryId: entry.id, reference: journal.reference } }) : null;
  return Response.json({ saved: true, id: entry.id, status: "Posted", notice: "Journal Entry Posted To The Permanent General Ledger.", handoff });
}

async function reverseJournalEntry(database: D1Database, payload: ActionPayload, actor: ReturnType<typeof getCommandActor>) {
  const entry = await getRecord(database, ACCOUNTING_PROJECT_ID, payload.recordId || "");
  if (!entry || entry.record_type !== "Journal Entry" || entry.status !== "Posted") return Response.json({ error: "Only A Posted Journal Entry Can Be Reversed" }, { status: 409 });
  const entryData = data(entry);
  if (entryData.reversedByEntryId) return Response.json({ error: "This Journal Entry Already Has A Reversal Draft" }, { status: 409 });
  const original = normalizedJournal({ journal: entryData as ActionPayload["journal"] });
  const reversalDate = new Date().toISOString().slice(0, 10);
  const reversalId = `JE-${reversalDate.replaceAll("-", "")}-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const lines = original.lines.map((line) => ({ ...line, id: `${line.id}-REV`, debit: line.credit, credit: line.debit }));
  const totals = journalTotals(lines);
  const reversalData = { ...original, id: reversalId, entryDate: reversalDate, entryType: "Adjusting", reference: `REV-${original.reference}`, description: `Reversal Of ${entry.id} · ${original.description}`, supportReference: `Reversal Of Posted Journal ${entry.id}`, lines, totals, reversesEntryId: entry.id, preparedBy: actor.name, preparedEmail: actor.email, preparedAt: now, updatedBy: actor.name, updatedAt: now, immutableAfterPosting: true, openingBalanceBatch: false };
  await saveManualJournalSnapshot(database, manualJournalSnapshot(normalizedJournal({ journal: reversalData as ActionPayload["journal"] }), reversalData, "Draft"), { sourceSnapshot: journalSource(entry), relatedStatements: [
    upsertRecordStatement(database, { projectId: ACCOUNTING_PROJECT_ID, id: reversalId, recordType: "Journal Entry", title: `Adjusting · REV-${original.reference}`, owner: actor.name, due: reversalDate, status: "Draft", meta: `${money(totals.debit)} Debits · ${money(totals.credit)} Credits`, recordDate: reversalDate, data: reversalData }),
    updateRecordStatement(database, entry, "Posted", { ...entryData, reversedByEntryId: reversalId, reversalDraftCreatedBy: actor.name, reversalDraftCreatedAt: now }),
    auditStatement(database, ACCOUNTING_PROJECT_ID, entry.id, "Posted", "Reversal Draft Created", actor, `A separate balanced reversal draft ${reversalId} was created. The original posted entry remains immutable.`),
  ] });
  return Response.json({ saved: true, id: reversalId, status: "Draft", notice: "Balanced Reversal Draft Created. It Requires Independent Approval Before Posting." });
}

async function ensureApInvoiceAccrued(database: D1Database, invoice: D1Row, actor: ReturnType<typeof getCommandActor>) {
  const invoiceData = data(invoice);
  const invoiceAllocations = allocations(invoice);
  await postAccountingEvent(database, {
    idempotencyKey: `AP_ACCRUAL:${invoice.id}`,
    eventType: "AP Invoice Approved",
    sourceType: "AP Invoice",
    sourceProjectId: ACCOUNTING_PROJECT_ID,
    sourceRecordId: invoice.id,
    eventDate: invoice.record_date || new Date().toISOString().slice(0, 10),
    reference: String(invoiceData.invoiceNumber || invoice.id),
    description: `${String(invoiceData.vendor || invoice.title)} · Invoice ${String(invoiceData.invoiceNumber || invoice.id)}`,
    actor,
    metadata: { vendorId: invoiceData.vendorId, vendor: invoiceData.vendor, allocations: invoiceAllocations.length },
    lines: apAccrualLines({ id: invoice.id, vendor: String(invoiceData.vendor || invoice.title), invoiceNumber: String(invoiceData.invoiceNumber || invoice.id), allocations: invoiceAllocations }),
  });
}

async function ensureInvoiceJobCostActuals(database: D1Database, invoice: D1Row, actor: ReturnType<typeof getCommandActor>, postedAt: string) {
  const invoiceData = data(invoice);
  const statements: D1PreparedStatement[] = [];
  allocations(invoice).forEach((allocation, index) => {
    const destination = String(allocation.destination || "").trim();
    if (!destination || destination === "Company Overhead") return;
    const allocationId = String(allocation.id || index).replace(/[^a-zA-Z0-9_-]/g, "-");
    statements.push(upsertRecordStatement(database, {
      projectId: destination,
      id: `JOB-COST-${invoice.id}-${allocationId}`,
      recordType: "Job Cost Actual",
      title: `${String(invoiceData.vendor || invoice.title)} · ${String(invoiceData.invoiceNumber || invoice.id)}`,
      owner: actor.name,
      due: invoice.record_date || postedAt.slice(0, 10),
      status: "Posted",
      meta: `${String(allocation.code || "Uncoded")} · ${money(numeric(allocation.amount))}`,
      recordDate: invoice.record_date || postedAt.slice(0, 10),
      data: { source: "Accounts Payable Accrual", invoiceId: invoice.id, vendor: invoiceData.vendor, invoiceNumber: invoiceData.invoiceNumber, costCode: allocation.code, commitmentType: allocation.commitmentType, commitmentReference: allocation.commitmentReference, amount: numeric(allocation.amount), recognizedAtApproval: true, postedBy: actor.name, postedAt },
    }));
  });
  if (statements.length) await database.batch(statements);
}

async function closeAccountingPeriod(database: D1Database, payload: ActionPayload, actor: ReturnType<typeof getCommandActor>, isOwner: boolean) {
  const periodId = payload.period?.id?.trim() || "";
  const status = payload.period?.status === "Hard Closed" ? "Hard Closed" : "Soft Closed";
  periodBounds(periodId);
  if (status === "Hard Closed") {
    if (!isOwner) return Response.json({ error: "Only A Company Owner Can Hard Close An Accounting Period" }, { status: 403 });
    const reviews = await database.prepare(`SELECT COUNT(DISTINCT code) AS total FROM accounting_close_tasks WHERE period_id = ? AND code IN ('CASH','AP','AR','PAYROLL','WIP','ASSETS','JE','TB','PACKAGE','OWNER') AND status = 'Reviewed' AND completed_email <> '' AND reviewed_email <> '' AND lower(completed_email) <> lower(reviewed_email)`).bind(periodId).first<{ total: number }>();
    if (reviews?.total !== 10) return Response.json({ error: "Complete And Independently Review All Ten Period Close Controls Before Hard Close" }, { status: 409 });
  }
  const period = await setAccountingPeriod(database, { periodId, status, reason: payload.period?.reason, actor, isOwner, requireCloseReview: true });
  return Response.json({ saved: true, period, notice: `${periodId} Is Now ${status}. ${status === "Hard Closed" ? "Posting Is Locked Until An Owner Reopens It With A Reason." : "Adjustments Remain Available Until Final Close."}` });
}

async function reopenAccountingPeriod(database: D1Database, payload: ActionPayload, actor: ReturnType<typeof getCommandActor>, isOwner: boolean) {
  const periodId = payload.period?.id?.trim() || "";
  const period = await setAccountingPeriod(database, { periodId, status: "Open", reason: payload.period?.reason, actor, isOwner });
  return Response.json({ saved: true, period, notice: `${periodId} Was Reopened With A Permanent Owner Reason.` });
}

function mergeTrialBalances(...groups: Array<Array<{ accountNumber: string; accountName: string; debit: number; credit: number; netDebit: number; netCredit: number; entryCount: number }>>) {
  const accounts = new Map<string, { accountNumber: string; accountName: string; debit: number; credit: number; netDebit: number; netCredit: number; entryCount: number }>();
  groups.flat().forEach((row) => {
    const current = accounts.get(row.accountNumber) || { accountNumber: row.accountNumber, accountName: row.accountName, debit: 0, credit: 0, netDebit: 0, netCredit: 0, entryCount: 0 };
    current.debit += row.debit;
    current.credit += row.credit;
    current.entryCount += row.entryCount;
    const net = current.debit - current.credit;
    current.netDebit = net > 0 ? net : 0;
    current.netCredit = net < 0 ? Math.abs(net) : 0;
    accounts.set(row.accountNumber, current);
  });
  return [...accounts.values()].sort((left, right) => left.accountNumber.localeCompare(right.accountNumber, undefined, { numeric: true }));
}

function buildTrialBalance(entries: D1Row[]) {
  const accounts = new Map<string, { accountNumber: string; accountName: string; debit: number; credit: number; netDebit: number; netCredit: number; entryCount: number }>();
  entries.filter((entry) => entry.status === "Posted").forEach((entry) => {
    const journal = normalizedJournal({ journal: data(entry) as ActionPayload["journal"] });
    journal.lines.forEach((line) => {
      const current = accounts.get(line.accountNumber) || { accountNumber: line.accountNumber, accountName: line.accountName, debit: 0, credit: 0, netDebit: 0, netCredit: 0, entryCount: 0 };
      current.debit += line.debit;
      current.credit += line.credit;
      current.entryCount += 1;
      const net = current.debit - current.credit;
      current.netDebit = net > 0 ? net : 0;
      current.netCredit = net < 0 ? Math.abs(net) : 0;
      accounts.set(line.accountNumber, current);
    });
  });
  return [...accounts.values()].sort((a, b) => a.accountNumber.localeCompare(b.accountNumber, undefined, { numeric: true }));
}

async function accountingAuthorization(database: D1Database, actor: ReturnType<typeof getCommandActor>) {
  const member = actor.email ? await database.prepare(`SELECT company_access_level, designations_json FROM company_members WHERE email = ? LIMIT 1`).bind(actor.email).first<{ company_access_level: string; designations_json: string }>() : null;
  const accessLevel = member?.company_access_level || actor.accessLevel;
  const designations = parseArray(member?.designations_json || "[]");
  return { isOwner: accessLevel === "Company Owner", canAccess: accessLevel === "Company Owner" || designations.includes("Accountant") || designations.includes("Financial Administrator") };
}

async function canAccessAccounting(database: D1Database, actor: ReturnType<typeof getCommandActor>) {
  return (await accountingAuthorization(database, actor)).canAccess;
}

async function getRecord(database: D1Database, projectId: string, recordId: string) {
  if (!projectId || !recordId) return null;
  return database.prepare(`SELECT project_id, id, record_type, title, owner, due, status, meta, record_date, data_json, updated_at FROM command_records WHERE project_id = ? AND id = ? LIMIT 1`).bind(projectId, recordId).first<D1Row>();
}

async function recordsByIds(database: D1Database, projectId: string, ids: string[]) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  const result = await database.prepare(`SELECT project_id, id, record_type, title, owner, due, status, meta, record_date, data_json, updated_at FROM command_records WHERE project_id = ? AND id IN (${placeholders})`).bind(projectId, ...ids).all<D1Row>();
  return result.results ?? [];
}

function updateRecordStatement(database: D1Database, row: D1Row, status: string, nextData: Record<string, unknown>) {
  return database.prepare(`UPDATE command_records SET status = ?, meta = ?, data_json = ?, updated_at = ? WHERE project_id = ? AND id = ?`).bind(status, row.meta, JSON.stringify(nextData), new Date().toISOString(), row.project_id, row.id);
}

function upsertRecordStatement(database: D1Database, record: { projectId: string; id: string; recordType: string; title: string; owner: string; due: string; status: string; meta: string; recordDate: string; data: Record<string, unknown> }) {
  return database.prepare(`INSERT INTO command_records (project_id, id, record_type, title, owner, due, status, meta, record_date, data_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, id) DO UPDATE SET record_type = excluded.record_type, title = excluded.title, owner = excluded.owner, due = excluded.due, status = excluded.status, meta = excluded.meta, record_date = excluded.record_date, data_json = excluded.data_json, updated_at = excluded.updated_at`).bind(record.projectId, record.id, record.recordType, record.title, record.owner, record.due, record.status, record.meta, record.recordDate, JSON.stringify(record.data), new Date().toISOString());
}

function auditStatement(database: D1Database, projectId: string, recordId: string, oldValue: string, newValue: string, actor: ReturnType<typeof getCommandActor>, summary: string) {
  return database.prepare(`INSERT INTO record_audits (project_id, record_id, field_name, old_value, new_value, reason, actor_name, actor_email, summary) VALUES (?, ?, 'Accounting Coordination', ?, ?, 'Controlled accounting workflow', ?, ?, ?)`).bind(projectId, recordId, oldValue, newValue, actor.name, actor.email, summary);
}

function publicRecord(row: D1Row) {
  return { id: row.id, type: row.record_type, title: row.title, owner: row.owner, due: row.due, status: row.status, meta: row.meta, recordDate: row.record_date, data: normalizeAccountReferences(data(row)), updatedAt: row.updated_at };
}

function data(row?: D1Row | null) {
  if (!row) return {} as Record<string, unknown>;
  try {
    const parsed = JSON.parse(row.data_json || "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function allocations(row: D1Row) {
  const value = data(row).allocations;
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function recordAmount(row: D1Row) {
  const value = data(row);
  return numeric(value.contractAmount ?? value.purchaseOrderAmount ?? value.approvedTotal ?? value.total ?? value.amount ?? value.value);
}

function numeric(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

function parseArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function accountingError(error: unknown) {
  const message = error instanceof Error ? error.message : "Accounting Coordination Is Unavailable";
  if (/NOT NULL constraint failed: (record_audits\.record_id|accounting_events\.idempotency_key)|Changed During Posting/.test(message)) return Response.json({ error: "The Record Or Accounting Period Changed. Refresh And Review Before Retrying; No Partial Posting Was Saved." }, { status: 409 });
  if (/A Valid Accounting (Date|Period) Is Required/.test(message)) return Response.json({ error: message }, { status: 400 });
  if (/Hard Closed|Must Be Posted Or Moved/.test(message)) return Response.json({ error: message }, { status: 409 });
  if (/Only A Company Owner/.test(message)) return Response.json({ error: message }, { status: 403 });
  console.error("Accounting coordination error", error);
  return Response.json({ error: message }, { status: 500 });
}
