import { enforceOnboardingAccess } from "../../../lib/onboarding";
import { getCommandActor, resolveCommandActor } from "../../../lib/server-actor";
import { isOpenPayable, isIssuedOwnerBilling, isOpenReceivable } from "../../../lib/accounting-states";
import { roundMoney } from "../../../lib/money";
import { reconcileAwardContractTotals } from "../../../lib/project-contract-financials";
import { isContractedActiveProject, needsOwnerContractSignature } from "../../../lib/contracted-projects";
import { ownerBillingAuthority, PHASE_ONE_BILLING } from "../../../lib/owner-billing-authority";
import {
  FINANCIAL_COMPARISONS,
  FINANCIAL_REPORT_LABELS,
  FINANCIAL_REPORT_RUN_TYPE,
  FINANCIAL_REPORT_TYPES,
  type FinancialComparison,
  type FinancialReportType,
} from "../../../lib/financial-reports";

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

type ReportDatabase = D1Database;

type ReportFormat = "text" | "money" | "percent" | "days";
type ReportRow = {
  id: string;
  label: string;
  project: string;
  status: string;
  cells: Array<string | number>;
  sourceType: string;
  sourceId: string;
  detail: string;
};
type ReportSection = {
  type: FinancialReportType;
  title: string;
  description: string;
  columns: string[];
  formats: ReportFormat[];
  rows: ReportRow[];
  totals: Array<string | number>;
};

type SaveRunPayload = {
  action?: "save-run";
  asOf?: string;
  projectId?: string;
  title?: string;
  selectedReports?: FinancialReportType[];
  comparisons?: FinancialComparison[];
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
      return Response.json({ error: "Financial Reports Require A Company Owner Accountant Or Financial Administrator" }, { status: 403 });
    }
    const search = new URL(request.url).searchParams;
    const asOf = validDate(search.get("asOf")) || easternDate();
    const projectId = String(search.get("projectId") || "").trim();
    const [snapshot, runs] = await Promise.all([
      buildSnapshot(database, asOf, projectId),
      reportRuns(database),
    ]);
    return Response.json({ ...snapshot, runs, permissions: { canRun: true, canSchedule: false } });
  } catch (error) {
    return financialError(error);
  }
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  try {
    const payload = await request.json() as SaveRunPayload;
    if (payload.action !== "save-run") return Response.json({ error: "A Valid Financial Report Action Is Required" }, { status: 400 });
    const { env } = await import("cloudflare:workers");
    const database = env.DB;
    if (!(await canAccessAccounting(database, actor))) {
      return Response.json({ error: "Financial Reports Require A Company Owner Accountant Or Financial Administrator" }, { status: 403 });
    }
    const asOf = validDate(payload.asOf) || easternDate();
    const projectId = String(payload.projectId || "").trim();
    const selectedReports = (payload.selectedReports || []).filter((value): value is FinancialReportType => FINANCIAL_REPORT_TYPES.includes(value));
    const comparisons = (payload.comparisons || []).filter((value): value is FinancialComparison => FINANCIAL_COMPARISONS.includes(value));
    if (!selectedReports.length) return Response.json({ error: "Select At Least One Report" }, { status: 400 });
    const fullSnapshot = await buildSnapshot(database, asOf, projectId);
    const snapshot = { ...fullSnapshot, reports: fullSnapshot.reports.filter((report) => selectedReports.includes(report.type)) };
    const now = new Date().toISOString();
    const id = `FINANCIAL-RUN-${crypto.randomUUID()}`;
    const title = String(payload.title || "").trim() || `Financial Report Pack · ${asOf}`;
    const runData = {
      selectedReports,
      comparisons,
      asOf,
      projectId,
      generatedAt: now,
      generatedBy: actor.name,
      snapshot,
      immutableSnapshot: true,
      scheduledDeliveryPerformed: false,
    };
    await database.batch([
      database.prepare(`INSERT INTO command_records (project_id, id, record_type, title, owner, due, status, meta, record_date, data_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'Saved Snapshot', ?, ?, ?, ?)`).bind(
        ACCOUNTING_PROJECT_ID,
        id,
        FINANCIAL_REPORT_RUN_TYPE,
        title,
        actor.name,
        asOf,
        `${selectedReports.length} Reports · ${projectId || "All Projects"}`,
        asOf,
        JSON.stringify(runData),
        now,
      ),
      database.prepare(`INSERT INTO record_audits (project_id, record_id, field_name, old_value, new_value, reason, actor_name, actor_email, summary)
        VALUES (?, ?, 'Financial Report Snapshot', 'Not Run', 'Saved Snapshot', 'Authorized financial report run', ?, ?, ?)`).bind(
        ACCOUNTING_PROJECT_ID,
        id,
        actor.name,
        actor.email,
        `${actor.name} saved ${selectedReports.length} financial reports as of ${asOf}; no external delivery occurred.`,
      ),
    ]);
    return Response.json({ saved: true, id, run: { id, title, owner: actor.name, status: "Saved Snapshot", recordDate: asOf, data: runData }, notice: "Permanent Financial Report Snapshot Saved. No External Email Or Posting Occurred." });
  } catch (error) {
    return financialError(error);
  }
}

async function buildSnapshot(database: ReportDatabase, asOf: string, projectFilter: string) {
  await reconcileAwardContractTotals(database, projectFilter ? [projectFilter] : undefined);
  const [projectResult, recordResult, wipResult] = await Promise.all([
    database.prepare(`SELECT number, name, status, owner_name, owner_contract_type, owner_contract_status, owner_contract_record_id, contract_amount, current_contract_amount, project_manager FROM projects ORDER BY status = 'Active' DESC, number`).all<ProjectRow>(),
    database.prepare(`SELECT project_id, id, record_type, title, owner, due, status, meta, record_date, data_json, updated_at FROM command_records ORDER BY updated_at DESC`).all<D1Row>(),
    database.prepare(`SELECT * FROM accounting_wip_forecasts WHERE period_id <= ? ORDER BY period_id DESC, updated_at DESC`).bind(asOf.slice(0, 7)).all<Record<string, unknown>>(),
  ]);
  const projects = (projectResult.results || []).filter((project) => !projectFilter || project.number === projectFilter);
  const allRows = recordResult.results || [];
  const rows = recordsAsOf(allRows, asOf).filter(row => row.record_type !== FINANCIAL_REPORT_RUN_TYPE);
  const accountingRows = rows.filter((row) => row.project_id === ACCOUNTING_PROJECT_ID);
  const apInvoices = accountingRows.filter((row) => row.record_type === "AP Invoice");
  const financials = projects.map((project) => projectFinancial(project, rows, apInvoices, wipResult.results || []));
  const reports: ReportSection[] = [
    projectFinancialReport(financials),
    managementProfitabilityReport(financials),
    wipReport(financials),
    apAgingReport(apInvoices, projectFilter, asOf),
    arAgingReport(projects, rows, asOf),
    commitmentAuditReport(projects, rows, apInvoices),
    cashMovementReport(rows, apInvoices, projectFilter),
    backlogReport(financials),
  ];
  const summary = {
    currentContracts: sum(financials.filter(isContractedActiveProject), "currentContract"),
    pendingContractValue: sum(financials.filter(needsOwnerContractSignature), "currentContract"),
    recognizedRevenue: sum(financials, "recognizedRevenue"),
    actualCost: sum(financials, "actualCost"),
    paidCost: sum(financials, "paidCost"),
    openAp: roundMoney(Number(reports.find(report => report.type === "ap-aging")?.totals[4] || 0)),
    accountsReceivable: sum(financials, "accountsReceivable"),
    retainageReceivable: sum(financials, "retainage"),
    projectedProfit: sum(financials.filter(isContractedActiveProject), "projectedProfit"),
    backlog: sum(financials, "backlog"),
  };
  return {
    generatedAt: new Date().toISOString(),
    asOf,
    projectFilter,
    projects: projects.map((project) => ({ number: project.number, name: project.name, status: project.status })),
    summary,
    comparisons: comparisonSummary(rows, apInvoices, financials, asOf, projectFilter),
    reports,
    sourceBoundaries: [
      { status: "Live", title: "Command Center Records", detail: "AP payments, issued owner invoices, receipts and posted job costs honor the as-of date. Operational descriptions and unlocked forecasts reflect their current records; use saved report runs for an exact historical presentation." },
      { status: "Permanent", title: "Saved Report Runs", detail: "Run Report saves an immutable snapshot with operator as-of date filters and report selections." },
      { status: "Connection Required", title: "Statutory General Ledger", detail: "A GAAP balance sheet statutory P&L and tax-basis cash flow are not fabricated before the accounting-system connection." },
    ],
  };
}

function recordsAsOf(rows: D1Row[], asOf: string): D1Row[] {
  return rows.filter(row => effectiveDate(row) <= asOf).flatMap(row => {
    const value = data(row);
    if (row.record_type === "AP Invoice") {
      if (String(value.costRecognitionDate || effectiveDate(row)).slice(0, 10) > asOf) return [];
      if (row.status === "Paid" && String(value.paidAt || "").slice(0, 10) > asOf) return [{ ...row, status: "Approved Unpaid" }];
    }
    if (row.record_type === "Owner Billing") {
      if (isIssuedOwnerBilling(row.status) && String(value.sentAt || effectiveDate(row)).slice(0, 10) > asOf) return [];
      const futureReceipts = rows.filter(receipt => receipt.project_id === row.project_id && receipt.record_type === "Owner Receipt" && receipt.status === "Posted" &&
        String(data(receipt).billingId || "") === row.id && effectiveDate(receipt) > asOf).reduce((sum, receipt) => sum + numeric(data(receipt).amount), 0);
      const received = Math.max(0, roundMoney(numeric(value.receivedToDate) - futureReceipts));
      const status = isIssuedOwnerBilling(row.status) ? received >= numeric(value.currentPaymentDue) ? "Paid" : received > 0 ? "Partially Paid" : "Sent" : row.status;
      return [{ ...row, status, data_json: JSON.stringify({ ...value, receivedToDate: received }) }];
    }
    return [row];
  });
}

function projectFinancial(project: ProjectRow, rows: D1Row[], apInvoices: D1Row[], forecasts: Array<Record<string, unknown>>) {
  const projectRows = rows.filter((row) => row.project_id === project.number);
  const controlledContract = projectRows.find(row => row.record_type === "Contracts" && row.id === project.owner_contract_record_id);
  const authority = ownerBillingAuthority({ ownerContractType: project.owner_contract_type, ownerContractStatus: project.owner_contract_status },
    { status: controlledContract?.status, data: controlledContract?.data_json });
  const budgets = projectRows.filter((row) => row.record_type === "Budget" && data(row).selectedForProject === true);
  const billings = projectRows.filter((row) => row.record_type === "Owner Billing" && isIssuedOwnerBilling(row.status));
  const receipts = projectRows.filter((row) => row.record_type === "Owner Receipt" && row.status === "Posted");
  const commitments = projectRows.filter((row) => ["Subcontracts", "Purchase Orders"].includes(row.record_type) && !inactive(row));
  const changes = projectRows.filter((row) => row.record_type === "Change Orders" && row.status === "Executed");
  const originalBudget = budgets.reduce((total, row) => total + numeric(data(row).originalBudget), 0);
  const committedCost = commitments.reduce((total, row) => total + amount(row), 0);
  const approvedChanges = changes.reduce((total, row) => total + numeric(data(row).approvedTotal), 0);
  const projectAp = apInvoices.flatMap((invoice) => allocations(invoice).filter((line) => String(line.destination || "") === project.number).map((line) => ({ invoice, line, amount: numeric(line.amount) })));
  const openAp = projectAp.filter(({ invoice }) => isOpenPayable(invoice.status)).reduce((total, item) => total + item.amount, 0);
  const paidCost = projectAp.filter(({ invoice }) => invoice.status === "Paid").reduce((total, item) => total + item.amount, 0);
  const actualCost = projectRows.filter((row) => row.record_type === "Job Cost Actual" && row.status === "Posted").reduce((total, row) => total + numeric(data(row).amount), 0);
  const currentContract = numeric(project.current_contract_amount || project.contract_amount);
  const forecast = forecasts.find((row) => String(row.project_id) === project.number);
  const estimateToComplete = forecast ? numeric(forecast.estimate_to_complete_cents) / 100 : Math.max(0, Math.max(originalBudget, committedCost, paidCost + openAp) - actualCost);
  const riskReserve = forecast ? numeric(forecast.risk_reserve_cents) / 100 : 0;
  const estimatedCost = actualCost + estimateToComplete + riskReserve;
  const completion = estimatedCost > 0 ? Math.min(1, actualCost / estimatedCost) : 0;
  const earnedFromBilling = billings.reduce((largest, row) => Math.max(largest, numeric(data(row).cumulativeEarned)), 0);
  const designEarned = Math.min(authority.phaseOneAmount, billings.filter(row => data(row).billingPhase === PHASE_ONE_BILLING)
    .reduce((sum, row) => sum + numeric(data(row).currentEarned), 0));
  const recognizedRevenue = authority.construction
    ? (String(forecast?.recognition_method || "Cost To Cost") === "Approved Earned Override" ? earnedFromBilling : currentContract * completion)
    : designEarned;
  const billed = billings.filter((row) => isIssuedOwnerBilling(row.status)).reduce((total, row) => total + numeric(data(row).currentPaymentDue), 0);
  const received = receipts.reduce((total, row) => total + numeric(data(row).amount), 0);
  const latestBilling = [...billings].sort((a, b) => String(data(b).sentAt || effectiveDate(b)).localeCompare(String(data(a).sentAt || effectiveDate(a))) || b.id.localeCompare(a.id, undefined, { numeric: true }))[0];
  const retainage = numeric(data(latestBilling).retainageToDate);
  return { number: project.number, name: project.name, status: project.status, projectManager: project.project_manager, contractStatus: controlledContract?.status || project.owner_contract_status, contractAuthorized: authority.construction, currentContract, originalBudget, committedCost, approvedChanges, openAp, paidCost, actualCost, estimateToComplete, riskReserve, estimatedCost, completion, recognizedRevenue, billed, received, retainage, accountsReceivable: Math.max(0, roundMoney(billed - received)), overUnderBilling: roundMoney(billed - recognizedRevenue), projectedProfit: roundMoney(currentContract - estimatedCost), projectedMargin: currentContract > 0 ? (currentContract - estimatedCost) / currentContract : 0, backlog: authority.construction ? Math.max(0, roundMoney(currentContract - recognizedRevenue)) : 0, wipPeriodId: String(forecast?.period_id || ""), wipStatus: String(forecast?.status || "Not Forecast") };
}

type Financial = ReturnType<typeof projectFinancial>;

function projectFinancialReport(items: Financial[]): ReportSection {
  return section("project-financials", "Current contract budget commitments actual cost forecast and receivables by project.", ["Project", "Current Contract", "Budget", "Committed", "Actual Cost", "ETC", "EAC", "Projected Profit", "Margin", "Open AR"], ["text", "money", "money", "money", "money", "money", "money", "money", "percent", "money"], items.map((item) => reportRow(item.number, item.name, item.number, item.contractAuthorized ? item.status : "Awaiting Signatures", [item.name, item.currentContract, item.originalBudget, item.committedCost, item.actualCost, item.estimateToComplete, item.estimatedCost, item.projectedProfit, item.projectedMargin, item.accountsReceivable], "Project", item.number, `${item.projectManager} · Contract ${item.contractStatus} · WIP ${item.wipPeriodId || "Not Forecast"}`)));
}

function managementProfitabilityReport(items: Financial[]): ReportSection {
  return section("management-profitability", "Management job profitability from earned revenue and coordinated project cost; this is not a statutory general-ledger P&L.", ["Project", "Earned Revenue", "Actual Cost", "Open AP", "ETC", "EAC", "Projected Profit", "Projected Margin"], ["text", "money", "money", "money", "money", "money", "money", "percent"], items.map((item) => reportRow(item.number, item.name, item.number, item.contractAuthorized ? item.status : "Awaiting Signatures", [item.name, item.recognizedRevenue, item.actualCost, item.openAp, item.estimateToComplete, item.estimatedCost, item.projectedProfit, item.projectedMargin], "Project Financial", item.number, "Management basis · open the source contract budget billing and cost records before external reliance.")));
}

function wipReport(items: Financial[]): ReportSection {
  return section("wip", "Cost-to-cost actual ETC EAC earned revenue and billing position by project.", ["Project", "Contract", "Actual", "ETC", "EAC", "Earned", "Billed", "Over / (Under) Billing", "Cost Complete"], ["text", "money", "money", "money", "money", "money", "money", "money", "percent"], items.map((item) => reportRow(item.number, item.name, item.number, item.contractAuthorized ? item.status : "Awaiting Signatures", [item.name, item.currentContract, item.actualCost, item.estimateToComplete, item.estimatedCost, item.recognizedRevenue, item.billed, item.overUnderBilling, item.completion], "WIP", item.number, `${item.wipStatus} · ${item.overUnderBilling >= 0 ? "Billings in excess of earned revenue." : "Costs and earnings in excess of billings."}`)));
}

function apAgingReport(invoices: D1Row[], projectFilter: string, asOf: string): ReportSection {
  const rows = invoices.filter((invoice) => isOpenPayable(invoice.status)).filter((invoice) => !projectFilter || allocations(invoice).some((line) => String(line.destination || "") === projectFilter)).map((invoice) => {
    const invoiceData = data(invoice);
    const openAmount = projectFilter ? allocations(invoice).filter((line) => String(line.destination || "") === projectFilter).reduce((total, line) => total + numeric(line.amount), 0) : numeric(invoiceData.total);
    return reportRow(invoice.id, String(invoiceData.vendor || invoice.title), allocations(invoice).map((line) => String(line.destination || "")).filter(Boolean).join(", ") || "Company", invoice.status, [String(invoiceData.vendor || invoice.title), String(invoiceData.invoiceNumber || invoice.id), invoice.due, daysBetween(invoice.due, asOf), openAmount, invoice.status], "AP Invoice", invoice.id, `${invoice.meta} · Approval and payment evidence remain on the source invoice.`);
  });
  return section("ap-aging", "Open approved and released vendor liabilities with due-date aging.", ["Vendor", "Invoice", "Due", "Days", "Open Amount", "Status"], ["text", "text", "text", "days", "money", "text"], rows);
}

function arAgingReport(projects: ProjectRow[], rows: D1Row[], asOf: string): ReportSection {
  const projectIds = new Set(projects.map((project) => project.number));
  const reportRows = rows.filter((row) => projectIds.has(row.project_id) && row.record_type === "Owner Billing" && isOpenReceivable(row.status)).map((billing) => {
    const billingData = data(billing);
    const open = Math.max(0, numeric(billingData.currentPaymentDue) - numeric(billingData.receivedToDate));
    return reportRow(billing.id, billing.title, billing.project_id, billing.status, [billing.project_id, billing.title, billing.due, daysBetween(billing.due, asOf), open, billing.status], "Owner Billing", billing.id, `${billing.meta} · Delivery and receipt evidence remain on the source billing.`);
  });
  return section("ar-aging", "Open owner billings and aging from finalized billing and posted receipt records.", ["Project", "Billing", "Due", "Days", "Open Amount", "Status"], ["text", "text", "text", "days", "money", "text"], reportRows);
}

function commitmentAuditReport(projects: ProjectRow[], rows: D1Row[], invoices: D1Row[]): ReportSection {
  const projectIds = new Set(projects.map((project) => project.number));
  const commitments = rows.filter((row) => projectIds.has(row.project_id) && ["Subcontracts", "Purchase Orders"].includes(row.record_type) && !inactive(row));
  const reportRows = commitments.map((commitment) => {
    const billedLines = invoices.flatMap((invoice) => allocations(invoice).filter((line) => String(line.destination || "") === commitment.project_id && String(line.commitmentReference || "") === commitment.id).map((line) => ({ invoice, line, amount: numeric(line.amount) })));
    const contract = amount(commitment);
    const invoiced = billedLines.reduce((total, item) => total + item.amount, 0);
    const paid = billedLines.filter((item) => item.invoice.status === "Paid").reduce((total, item) => total + item.amount, 0);
    const approvedUnpaid = billedLines.filter((item) => ["Approved Unpaid", "Payment Released"].includes(item.invoice.status)).reduce((total, item) => total + item.amount, 0);
    const retainage = billedLines.reduce((total, item) => total + numeric(data(item.invoice).retainage), 0);
    return reportRow(commitment.id, commitment.title, commitment.project_id, commitment.status, [commitment.project_id, commitment.title, commitment.record_type === "Subcontracts" ? "Subcontract" : "Purchase Order", contract, invoiced, paid, approvedUnpaid, retainage, Math.max(0, contract - invoiced)], commitment.record_type, commitment.id, `${commitment.meta} · ${billedLines.length} linked AP allocation${billedLines.length === 1 ? "" : "s"}.`);
  });
  return section("commitment-audit", "Permanent commitment value linked AP paid approved-unpaid retainage and remaining exposure.", ["Project", "Commitment", "Type", "Contract", "Invoiced", "Paid", "Approved Unpaid", "Retainage", "Remaining"], ["text", "text", "text", "money", "money", "money", "money", "money", "money"], reportRows);
}

function cashMovementReport(rows: D1Row[], invoices: D1Row[], projectFilter: string): ReportSection {
  const receiptMap = new Map<string, D1Row>();
  rows.filter((row) => row.record_type === "Owner Receipt" && row.status === "Posted" && (!projectFilter || row.project_id === projectFilter)).forEach((row) => {
    const current = receiptMap.get(row.id);
    if (!current || current.project_id === ACCOUNTING_PROJECT_ID) receiptMap.set(row.id, row);
  });
  const receipts = [...receiptMap.values()].map((row) => reportRow(row.id, row.title, row.project_id, row.status, [effectiveDate(row), "Owner Receipt", row.project_id, numeric(data(row).amount), 0, String(data(row).reference || row.meta)], "Owner Receipt", row.id, "Posted owner receipt; deposit evidence remains on the source record."));
  const payments = invoices.filter((invoice) => invoice.status === "Paid").filter((invoice) => !projectFilter || allocations(invoice).some((line) => String(line.destination || "") === projectFilter)).map((invoice) => {
    const paidAmount = projectFilter ? allocations(invoice).filter((line) => String(line.destination || "") === projectFilter).reduce((total, line) => total + numeric(line.amount), 0) : numeric(data(invoice).total);
    return reportRow(invoice.id, invoice.title, allocations(invoice).map((line) => String(line.destination || "")).filter(Boolean).join(", ") || "Company", invoice.status, [String(data(invoice).paidAt || effectiveDate(invoice)).slice(0, 10), "Vendor Payment", String(data(invoice).vendor || invoice.title), 0, paidAmount, String(data(invoice).clearingConfirmation || "Clearing evidence on invoice")], "AP Invoice", invoice.id, "Paid AP invoice matched to recorded external clearing evidence.");
  });
  return section("cash-movement", "Recorded owner receipts and externally cleared vendor payments. This is not a statutory cash-flow statement.", ["Date", "Movement", "Source", "Inflow", "Outflow", "Reference"], ["text", "text", "text", "money", "money", "text"], [...receipts, ...payments].sort((a, b) => String(b.cells[0]).localeCompare(String(a.cells[0]))));
}

function backlogReport(items: Financial[]): ReportSection {
  return section("backlog", "Current contract value remaining after recognized earned revenue.", ["Project", "Current Contract", "Earned Revenue", "Backlog", "Complete", "Contract Status"], ["text", "money", "money", "money", "percent", "text"], items.map((item) => reportRow(item.number, item.name, item.number, item.contractAuthorized ? item.status : "Awaiting Signatures", [item.name, item.currentContract, item.recognizedRevenue, item.backlog, item.completion, item.contractStatus], "Project Contract", item.number, `${item.projectManager} · ${item.status}`)));
}

function section(type: FinancialReportType, description: string, columns: string[], formats: ReportFormat[], rows: ReportRow[]): ReportSection {
  const totals = columns.map((_, column) => formats[column] === "money" ? rows.reduce((total, row) => total + numeric(row.cells[column]), 0) : "");
  return { type, title: FINANCIAL_REPORT_LABELS[type], description, columns, formats, rows, totals };
}

function reportRow(id: string, label: string, project: string, status: string, cells: Array<string | number>, sourceType: string, sourceId: string, detail: string): ReportRow {
  return { id, label, project, status, cells, sourceType, sourceId, detail };
}

function comparisonSummary(rows: D1Row[], invoices: D1Row[], financials: Financial[], asOf: string, projectFilter: string) {
  const year = Number(asOf.slice(0, 4));
  const monthStart = `${asOf.slice(0, 7)}-01`;
  const yearStart = `${year}-01-01`;
  const priorStart = `${year - 1}-01-01`;
  const priorEnd = `${year - 1}-${asOf.slice(5)}`;
  const movements = cashMovementReport(rows, invoices, projectFilter).rows;
  const cash = (start: string, end: string) => movements.filter((row) => String(row.cells[0]) >= start && String(row.cells[0]) <= end).reduce((result, row) => ({ inflow: result.inflow + numeric(row.cells[3]), outflow: result.outflow + numeric(row.cells[4]) }), { inflow: 0, outflow: 0 });
  return {
    "Current Month": cash(monthStart, asOf),
    "Year-To-Date": cash(yearStart, asOf),
    "Annual Budget": { revenue: sum(financials, "currentContract"), cost: sum(financials, "originalBudget") },
    "Prior Year": cash(priorStart, priorEnd),
  };
}

async function reportRuns(database: ReportDatabase) {
  const result = await database.prepare(`SELECT project_id, id, record_type, title, owner, due, status, meta, record_date, data_json, updated_at FROM command_records WHERE project_id = ? AND record_type = ? ORDER BY updated_at DESC LIMIT 20`).bind(ACCOUNTING_PROJECT_ID, FINANCIAL_REPORT_RUN_TYPE).all<D1Row>();
  return (result.results || []).map((row) => ({ id: row.id, title: row.title, owner: row.owner, status: row.status, meta: row.meta, recordDate: row.record_date, updatedAt: row.updated_at, data: data(row) }));
}

async function canAccessAccounting(database: ReportDatabase, actor: ReturnType<typeof getCommandActor>) {
  const member = actor.email ? await database.prepare(`SELECT company_access_level, designations_json FROM company_members WHERE email = ? LIMIT 1`).bind(actor.email).first<{ company_access_level: string; designations_json: string }>() : null;
  const accessLevel = member?.company_access_level || actor.accessLevel;
  const designations = parseArray(member?.designations_json || "[]");
  return accessLevel === "Company Owner" || designations.includes("Accountant") || designations.includes("Financial Administrator");
}

function data(row?: D1Row | null) {
  try {
    const parsed = JSON.parse(row?.data_json || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {} as Record<string, unknown>; }
}

function allocations(row: D1Row) {
  const value = data(row).allocations;
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function amount(row: D1Row) {
  const value = data(row);
  return numeric(value.contractAmount ?? value.subcontractAmount ?? value.purchaseOrderAmount ?? value.approvedTotal ?? value.total ?? value.amount ?? value.value);
}

function inactive(row: D1Row) {
  return ["Draft", "Returned", "Rejected", "Cancelled", "Superseded", "Voided", "Archived", "Deleted"].includes(row.status);
}

function effectiveDate(row: D1Row) { return String(row.record_date || row.updated_at || "").slice(0, 10); }
function numeric(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function sum(items: Financial[], field: keyof Financial) { return items.reduce((total, item) => total + numeric(item[field]), 0); }
function validDate(value: unknown) { const date = String(value || ""); return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : ""; }
function easternDate() { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function daysBetween(due: string, asOf: string) { const difference = Date.parse(`${asOf}T12:00:00Z`) - Date.parse(`${due}T12:00:00Z`); return Number.isFinite(difference) ? Math.max(0, Math.floor(difference / 86_400_000)) : 0; }
function parseArray(value: string) { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; } catch { return []; } }
function financialError(error: unknown) { const message = error instanceof Error ? error.message : "Financial Reports Are Unavailable"; console.error("Financial reports error", error); return Response.json({ error: message }, { status: 500 }); }
