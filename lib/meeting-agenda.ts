import { MEETING_SECTIONS, type MeetingType } from "./meetings";
import { opportunityContract, signedSalesRecords } from "./sales-contract";
import { isContractedActiveProject } from "./contracted-projects";
import { agendaSignalSelected, isDepartmentMeeting, isSelectableScorecard, scorecardKey, type AgendaSelection } from "./meeting-agenda-settings";

export type AgendaRecord = { projectId: string; id: string; recordType: string; title: string; owner: string; due: string; status: string; updatedAt: string; recordDate?: string | null; data: Record<string, unknown> };
export type AgendaProject = { number: string; name: string; status: string; finalDate: string; startDate: string; projectManager: string; superintendent: string; contractAmount: string; ownerContractStatus: string; contractAuthorized?: boolean };
export type AgendaSignal = {
  key: string; category: string; sectionKey: string; priority: "Critical" | "High" | "Normal" | "Routine";
  title: string; reason: string; nextStep: string; dueAt: string;
  source: { projectId: string; id: string; recordType: string; updatedAt: string; target: string };
  metric?: { value: number; unit: "count" | "currency"; label: string };
};
type Candidate = Omit<AgendaSignal, "sectionKey"> & { routes: Partial<Record<MeetingType, string>> };
const L10 = "Weekly L10", QUARTER = "Quarterly Rock/Review", SALES = "Sales/Estimating Department", OPS = "Operations Department", ACCT = "Accounting Department";
const OWNER = "Project Owner", SUB = "Project Subcontractor", DESIGN = "Project Design";
const DAY = 86_400_000;
const CLOSED = /^(closed|complete|completed|paid|void|voided|cancelled|canceled|rejected|superseded|archived|installed|resolved|waived)$/i;
const ISSUED_BILLING = /^(sent|partially paid|overdue|open|disputed)$/i;
const date = (value: unknown) => { const s = String(value || ""); const d = new Date(s); return s && Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : ""; };
const num = (value: unknown) => { const n = Number(String(value ?? "").replace(/[$,%\s,]/g, "")); return Number.isFinite(n) ? n : 0; };
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown) => Array.isArray(value) ? value.map(object) : [];
const days = (from: string, to: string) => from && to ? Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY) : 0;
const add = (from: string, count: number) => from ? new Date(Date.parse(`${from}T12:00:00Z`) + count * DAY).toISOString().slice(0, 10) : "";
const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const isTrue = (value: unknown) => value === true || value === "true" || value === 1;
const priorityRank = { Critical: 0, High: 1, Normal: 2, Routine: 3 };

// Only operational source types are read. Personnel, legal files, bank details,
// payroll detail and raw quote text are not agenda inputs.
export const MEETING_SOURCE_TYPES = ["Schedule", "Selections", "Purchase Orders", "Bid Packages", "RFIs", "Submittals", "Change Orders", "Owner Billing", "AR Invoice", "AP Invoice", "Payment Batch", "Cash Account", "Quality Items", "Quality Inspections", "Safety Observations", "Visitor Safety Walk", "Safety Incidents", "Safety Inspections", "Site Walks", "Daily Logs", "Closeout", "Project Health Daily Snapshots", "Sales Opportunities", "Owner Proposals", "Sales Goals", "Scorecard", "Company Scorecard", "Scorecard Metrics", "Metrics"];

/** Reduce large estimate/quote payloads before collecting a company agenda. */
export function compactAgendaData(data: Record<string, unknown>): Record<string, unknown> {
  const fields = ["projectId", "projectNumber", "projectName", "start", "days", "progress", "baselineStart", "baselineDays", "forecastFinish", "critical", "milestone", "phase", "trade", "installationDate", "requiredDeliveryDate", "expectedDeliveryDate", "deliveryDate", "leadDays", "leadTimeDays", "selectedOptionId", "releasedAt", "installedAt", "receivedAt", "decisionType", "responsibleName", "purchaseOrderId", "deadline", "estimatedStart", "linkedCommitmentId", "lifecycleScope", "opportunityId", "scopeNature", "requiresOwnerDecision", "ownerDecisionRequired", "blocking", "scheduleImpactDays", "costImpact", "severity", "priority", "amount", "price", "value", "currentPaymentDue", "receivedToDate", "balance", "outstandingBalance", "billingId", "paymentDueDate", "dueDate", "disputed", "paymentStatus", "difference", "documentationAlert", "score", "color", "calculatedAt", "criticalRuleIds", "stage", "estimatedValue", "probability", "assignedEstimator", "assignedRep", "bidDueDate", "nextFollowUpDate", "estimateStatus", "handoffLocked", "awardedProjectId", "awardedProjectNumber", "awardDate", "awardedAt", "companyGoal", "year", "annualRevenueGoal", "revenueGoal", "salesGoal", "target", "actual", "unit", "direction", "period", "issues", "delays", "incident", "incidentReported", "safetyIssue", "manpowerIssue", "accessIssue", "forecastCost", "revisedBudget", "promiseDate", "promisedAmountCents", "assignedRole", "category", "forecastProfitCents", "riskReserveCents", "carryCount", "meetingType"];
  const result: Record<string, unknown> = Object.fromEntries(fields.filter(key => data[key] !== undefined).map(key => [key, data[key]]));
  if (data.salesMetrics) result.salesMetrics = { contractValue: object(data.salesMetrics).contractValue };
  if (data.contractSales) result.contractSales = data.contractSales;
  if (data.estimate) result.estimate = { status: object(data.estimate).status };
  if (data.decision) result.decision = { present: true };
  if (data.commitmentDecision) result.commitmentDecision = { decision: object(data.commitmentDecision).decision };
  if (data.coverageException) result.coverageException = { approvedAt: object(data.coverageException).approvedAt };
  if (Array.isArray(data.options)) result.options = list(data.options).map(option => ({ id: option.id, leadDays: option.leadDays }));
  if (Array.isArray(data.bidders)) result.bidders = list(data.bidders).map(bidder => ({
    revisions: list(bidder.revisions).map(revision => ({ id: revision.id, supersededByRevisionId: revision.supersededByRevisionId })),
    leveling: { scopeComplete: object(bidder.leveling).scopeComplete, exclusionsReviewed: object(bidder.leveling).exclusionsReviewed, clarificationsComplete: object(bidder.leveling).clarificationsComplete },
  }));
  return result;
}

export function buildMeetingAgenda(input: { type: MeetingType; projectId: string; records: AgendaRecord[]; projects: AgendaProject[]; today?: string; selection?: AgendaSelection }): AgendaSignal[] {
  const today = input.today || new Date().toISOString().slice(0, 10);
  const projects = new Map(input.projects.map(project => [project.number, project]));
  const candidates: Candidate[] = [];
  let overdueOwnerBalance = 0;
  const activeProjects = input.projects.filter(isContractedActiveProject);
  const usable = input.records.filter(r => !/quarantine|deleted/i.test(r.status) && ![r.projectId, text(r.data.projectId), text(r.data.projectNumber)].some(scope => /quarantine|deleted/i.test(projects.get(scope)?.status || "")));
  const arKeys = new Set(usable.filter(r => r.recordType === "AR Invoice").map(r => `${text(r.data.projectId)}:${text(r.data.billingId)}`));
  const latestHealth = new Map<string, AgendaRecord>();
  for (const r of usable.filter(r => r.recordType === "Project Health Daily Snapshots")) {
    if (!latestHealth.has(r.projectId) || r.updatedAt > latestHealth.get(r.projectId)!.updatedAt) latestHealth.set(r.projectId, r);
  }
  const realProject = (r: AgendaRecord) => text(r.data.projectId) || text(r.data.projectNumber) || r.projectId;
  const targetFor = (r: AgendaRecord) => ({ "AR Invoice": "Owner Billing", "AP Invoice": "Accounts Payable", "Payment Batch": "Accounts Payable", "Cash Account": "Cash Management", "Quality Items": "Quality", "Quality Inspections": "Quality", "Bid Packages": r.projectId === "MEFFORD-SALES" ? "Estimating" : "Procurement", "Sales Opportunities": "Estimating", "Owner Proposals": "Estimating", "Project Health Daily Snapshots": "Project Health", "Accounting Close Task": "WIP And Close", "Collection Promise": "Owner Billing", "WIP Forecast": "WIP And Close", "Escalated Meeting Action": text(r.data.meetingType) || "Weekly L10" }[r.recordType] || (/^Safety|^Site Walk|^Visitor Safety Walk/.test(r.recordType) ? "Safety" : r.recordType));
  function emit(r: AgendaRecord, kind: string, routes: Candidate["routes"], reason: string, nextStep: string, priority: Candidate["priority"] = "Normal", dueAt = date(r.due), title = r.title) {
    const scope = realProject(r), project = projects.get(scope);
    candidates.push({ key: `${r.projectId}:${r.recordType}:${r.id}:${kind}`, category: kind, routes, priority,
      title: `${project ? `${project.name} · ` : ""}${title}`, reason, nextStep, dueAt,
      source: { projectId: r.recordType === "AR Invoice" ? scope : r.projectId, id: r.recordType === "AR Invoice" ? text(r.data.billingId) || r.id : r.id, recordType: r.recordType, updatedAt: r.updatedAt, target: targetFor(r) },
    });
  }
  for (const r of usable) {
    const d = r.data, scope = realProject(r), project = projects.get(scope);
    if (input.projectId !== "MEFFORD-COMPANY" && scope !== input.projectId) continue;
    const closed = CLOSED.test(r.status), due = date(d.dueDate || r.due), overdue = Boolean(due && due < today), soon = Boolean(due && due <= add(today, 14));
    const explicitCritical = /critical|stop work|life safety/i.test(`${r.status} ${text(d.severity)} ${text(d.priority)}`);
    const majorAmount = Math.abs(num(d.amount ?? d.price ?? d.costImpact));
    const major = explicitCritical || majorAmount >= 25000 || (num(project?.contractAmount) > 0 && majorAmount > num(project?.contractAmount) * .01) || num(d.scheduleImpactDays) >= 7;
    const leadership = (condition: boolean) => condition ? { [L10]: "ids", [QUARTER]: "ids" } : {};
    if (r.recordType === "Schedule" && !closed && num(d.progress) < 100) {
      const start = date(d.start || r.recordDate), baseline = date(d.baselineStart || start), duration = Math.max(1, num(d.days) || 1);
      if (!start) continue;
      const plannedFinish = add(baseline, Math.max(1, num(d.baselineDays) || duration) - 1);
      const currentFinish = add(start, duration - 1);
      const remaining = Math.max(1, Math.ceil(duration * (1 - Math.max(0, num(d.progress)) / 100)));
      const forecast = [currentFinish, date(d.forecastFinish), start <= today ? add(today, remaining - 1) : ""].sort().at(-1)!;
      const slip = Math.max(0, days(plannedFinish, forecast));
      const late = currentFinish < today || slip > 0;
      const critical = explicitCritical || (late && Boolean(project?.finalDate && forecast > date(project.finalDate)));
      const design = /design|permit/i.test(`${text(d.phase)} ${r.title}`);
      if (late || start <= add(today, 14)) emit(r, late ? "Schedule Creep" : "Lookahead", {
        [SUB]: "lookahead", [OPS]: "schedule", ...(late || isTrue(d.milestone) ? { [OWNER]: "schedule" } : {}), ...(design ? { [DESIGN]: "design-schedule" } : {}), ...leadership(critical || slip >= 7),
      }, `Baseline Finish ${plannedFinish}; Current Plan ${currentFinish}; Forecast ${forecast}; ${num(d.progress)}% Complete${slip ? `; ${slip} Day(s) Beyond Baseline` : ""}.`, late ? "Confirm the cause, affected trades, recovery plan, and accountable person." : "Confirm crew, access, predecessors, and delivery readiness.", critical ? "Critical" : late ? "High" : "Routine", plannedFinish);
      continue;
    }
    if ((r.recordType === "Selections" || r.recordType === "Purchase Orders") && !closed && !d.installedAt && !d.receivedAt) {
      const need = date(d.requiredDeliveryDate || d.installationDate || r.due);
      const options = list(d.options), selected = options.find(o => o.id === d.selectedOptionId);
      const lead = Math.max(0, num(d.leadDays ?? d.leadTimeDays ?? selected?.leadDays ?? Math.max(0, ...options.map(o => num(o.leadDays)))));
      const decisionDue = add(need, -lead), expected = date(d.expectedDeliveryDate || d.deliveryDate);
      const notReleased = r.recordType === "Selections" ? !d.releasedAt : !/issued|ordered|released|shipped/i.test(r.status);
      const risk = Boolean(need && ((expected && expected > need) || (notReleased && decisionDue < today) || need < today));
      const ownerDecision = r.recordType === "Selections" && !d.decision && !d.selectedOptionId && !/contractor|internal/i.test(text(d.decisionType));
      if (risk || (need && need <= add(today, 21)) || (ownerDecision && decisionDue && decisionDue <= add(today, 14))) emit(r, "Lead Time", {
        [SUB]: "procurement", [OPS]: "procurement", ...(ownerDecision || risk ? { [OWNER]: "owner-decisions" } : {}), ...(r.recordType === "Selections" ? { [DESIGN]: "selections" } : {}), ...leadership(risk && Boolean(need && (need < today || (expected && days(need, expected) >= 7)))),
      }, `Required On Site ${need || "Not Set"}; Lead Time ${lead} Day(s); Release/Decision Needed ${decisionDue || "Not Set"}; Expected Delivery ${expected || "Not Confirmed"}.`, ownerDecision ? "Obtain the owner's selection and confirm its effect on the required delivery date." : "Confirm release, supplier delivery, substitutions, and affected site work.", risk ? "High" : "Normal", decisionDue || need);
      continue;
    }
    if (r.recordType === "Bid Packages" && !closed && !d.linkedCommitmentId && object(d.commitmentDecision).decision !== "Do Not Award") {
      const bidders = list(d.bidders).filter(b => list(b.revisions).some(rev => !rev.supersededByRevisionId));
      const gaps = bidders.filter(b => !isTrue(object(b.leveling).scopeComplete) || !isTrue(object(b.leveling).exclusionsReviewed) || !isTrue(object(b.leveling).clarificationsComplete)).length;
      const waived = Boolean(object(d.coverageException).approvedAt);
      const sales = r.projectId === "MEFFORD-SALES" || d.lifecycleScope === "Sales";
      const start = date(d.estimatedStart), deadline = date(d.deadline || r.due);
      if ((!waived && bidders.length < 3) || gaps || (deadline && deadline < today)) emit(r, "Quote Coverage", { ...(sales ? { [SALES]: "coverage" } : { [OPS]: "procurement" }), ...leadership(!sales && Boolean(start && start < today)) }, `${bidders.length} Bidder(s) With A Current Quote; ${gaps} Scope Review(s) Incomplete${waived ? "; Coverage Exception Approved" : "; Target 3 Quotes"}; Bid Deadline ${deadline || "Not Set"}.`, "Confirm quote coverage, exclusions, addenda, leveling, and the award recommendation.", deadline && deadline < today ? "High" : "Normal", deadline);
      if (!sales && start && start <= add(today, 21)) emit(r, "Trade Readiness", { [SUB]: "procurement", [OPS]: "procurement", ...(start < today ? { [OWNER]: "schedule" } : {}) }, `Trade Start ${start}; Commitment Has Not Been Linked.`, "Confirm when this trade and its materials will be ready for the site.", start < today ? "High" : "Normal", start, `${text(d.trade) || "Trade"} Readiness`);
      continue;
    }
    if (["RFIs", "Submittals"].includes(r.recordType) && !closed && !/answered|approved|returned|accepted/i.test(r.status)) {
      const ownerNeeded = isTrue(d.requiresOwnerDecision) || isTrue(d.ownerDecisionRequired), blocked = isTrue(d.blocking) || /blocked|overdue/i.test(r.status) || overdue;
      emit(r, "Information Blocker", { [SUB]: "documents", [DESIGN]: r.recordType === "RFIs" ? "rfis" : "submittals", [OPS]: "controls", ...(ownerNeeded || blocked || num(d.scheduleImpactDays) > 0 ? { [OWNER]: "design" } : {}), ...leadership(major || (blocked && Boolean(due && days(due, today) >= 14))) }, `${r.recordType} ${r.status}; Response Due ${due || "Not Set"}${ownerNeeded ? "; Owner Decision Required" : ""}.`, "Confirm the required answer, affected work, responsible decision-maker, and response date.", explicitCritical ? "Critical" : blocked ? "High" : "Normal", due);
      continue;
    }
    if (/^Safety (Observations|Incidents|Inspections)$|^Site Walks$|^Visitor Safety Walk$/.test(r.recordType) && !closed) {
      emit(r, "Safety", { [SUB]: "safety", [OPS]: "safety-quality", ...(explicitCritical || /incident/i.test(r.recordType) ? { [OWNER]: "health-safety" } : {}), ...leadership(explicitCritical || /incident/i.test(r.recordType)) }, `Open ${r.recordType}; Status ${r.status}; Responsible Person ${r.owner || "Unassigned"}.`, "Confirm containment, corrective work, and verification responsibility.", explicitCritical || /incident/i.test(r.recordType) ? "Critical" : overdue ? "High" : "Normal", due, r.recordType === "Safety Incidents" ? "Safety Incident Follow-Up" : r.recordType === "Visitor Safety Walk" ? "Site Hazard Follow-Up" : r.title);
      continue;
    }
    if (/^Quality (Items|Inspections)$/.test(r.recordType) && !closed && !/passed|accepted/i.test(r.status)) {
      emit(r, "Quality", { [SUB]: "quality", [OPS]: "safety-quality", ...(overdue || major || /failed|rejected/i.test(r.status) ? { [OWNER]: "quality-closeout" } : {}), ...leadership(explicitCritical) }, `${r.recordType} ${r.status}; Due ${due || "Not Set"}; Responsible Person ${r.owner || "Unassigned"}.`, "Confirm corrective work, reinspection, and release of affected follow-on work.", explicitCritical ? "Critical" : overdue || /fail/i.test(r.status) ? "High" : "Normal");
      continue;
    }
    if (r.recordType === "Daily Logs" && date(r.recordDate || r.due) >= add(today, -14)) {
      const findings = [d.issues, d.delays, d.incident, d.incidentReported, d.safetyIssue, d.manpowerIssue, d.accessIssue].filter(v => v === true || (typeof v === "string" && v.trim() && !/^(none|no|n\/a|false|no issues|nothing to report)$/i.test(v.trim())));
      if (findings.length) emit(r, "Field Constraint", { [SUB]: "production", [OPS]: "schedule", ...leadership(explicitCritical) }, `The ${date(r.recordDate || r.due)} Daily Log Records A Site Constraint.`, "Review the source log and confirm manpower, access, safety, or delay recovery commitments.", explicitCritical ? "Critical" : "High");
      continue;
    }
    if (r.recordType === "Change Orders" && !closed && !/^(approved|executed|owner approved)$/i.test(r.status)) {
      emit(r, "Change Exposure", { [OWNER]: "changes", [OPS]: "controls", [ACCT]: "billing", ...leadership(major) }, `Pending Change ${r.status}; Recorded Exposure ${money(majorAmount)}${num(d.scheduleImpactDays) ? `; ${num(d.scheduleImpactDays)} Schedule Day(s)` : ""}.`, "Confirm scope, owner authorization, pricing responsibility, and schedule effect.", major ? "High" : "Normal");
      // Trade coordination intentionally excludes owner pricing, margin and billing.
      if (isTrue(d.blocking) || num(d.scheduleImpactDays) > 0) emit(r, "Field Change", { [SUB]: "changes", [DESIGN]: "exposure" }, `Pending Scope Change Affects Site Coordination${num(d.scheduleImpactDays) ? `; ${num(d.scheduleImpactDays)} Schedule Day(s) Recorded` : ""}.`, "Confirm the affected work and instructions needed before proceeding.", "High", due);
      continue;
    }
    if (r.recordType === "AR Invoice" || r.recordType === "Owner Billing") {
      if (closed) continue;
      if (r.recordType === "Owner Billing" && !ISSUED_BILLING.test(r.status)) {
        if (/review|approval|ready to send|revision/i.test(r.status) || overdue) emit(r, "Billing Approval", { [ACCT]: "billing" }, `Internal Billing Status ${r.status}${isTrue(d.documentationAlert) ? "; Supporting Documents Need Review" : ""}.`, "Clear the billing review and required support before sending to the project owner.", overdue ? "High" : "Normal");
        continue;
      }
      if (r.recordType === "Owner Billing" && arKeys.has(`${r.projectId}:${r.id}`)) continue;
      const balance = Math.max(0, num(d.balance ?? d.outstandingBalance ?? (num(d.currentPaymentDue ?? d.amount) - num(d.receivedToDate))));
      const paymentDue = date(d.paymentDueDate || d.dueDate || r.due);
      if (balance > 0 && paymentDue && paymentDue < today) overdueOwnerBalance += balance;
      if (balance > 0 && (paymentDue && paymentDue <= add(today, 7) || isTrue(d.disputed) || /disputed|overdue/i.test(r.status))) emit(r, "Owner Payment", { [OWNER]: "billing", [ACCT]: "collections", ...leadership(balance >= 25000 && Boolean(paymentDue && paymentDue < today) || Boolean(paymentDue && days(paymentDue, today) >= 30) || isTrue(d.disputed)) }, `Outstanding ${money(balance)}; Recorded Due Date ${paymentDue || "Not Set"}; ${paymentDue && paymentDue < today ? `${days(paymentDue, today)} Day(s) Past Due` : r.status}.`, "Confirm the invoice or dispute, payment commitment, and follow-up owner.", paymentDue && paymentDue < today ? "High" : "Normal", paymentDue);
      continue;
    }
    if (["AP Invoice", "Payment Batch"].includes(r.recordType) && !closed) {
      if (soon || /hold|review|approval|discrepancy|duplicate|blocked/i.test(r.status)) emit(r, "Payables", { [ACCT]: "payables", ...leadership(explicitCritical) }, `${r.recordType} ${r.status}; Due ${due || "Not Set"}; Amount ${money(num(d.amount))}.`, "Resolve documentation, invoice discrepancies, approval, and payment timing.", overdue || /hold|discrepancy|duplicate|blocked/i.test(r.status) ? "High" : "Normal");
      continue;
    }
    if (r.recordType === "WIP Forecast" && (!/approved|locked/i.test(r.status) || num(d.forecastProfitCents) < 0 || num(d.riskReserveCents) > 0)) emit(r, "WIP Exception", { [ACCT]: "cash-close", ...leadership(num(d.forecastProfitCents) < 0) }, `Period ${text(d.period)}; Forecast ${r.status}; Forecast Profit ${money(num(d.forecastProfitCents) / 100)}; Risk Reserve ${money(num(d.riskReserveCents) / 100)}.`, "Review cost to complete, risk allowance, forecast margin, and required approval.", num(d.forecastProfitCents) < 0 ? "Critical" : "Normal");
    if (r.recordType === "Escalated Meeting Action" && !closed && /Turnover$/.test(text(d.meetingType))) emit(r, "Turnover Requirement", { [text(d.meetingType).startsWith("Sales") ? SALES : OPS]: "handoff", ...leadership(overdue && days(due, today) >= 7) }, `${text(d.meetingType)}; ${r.owner}; Due ${due || "Not Scheduled"}; ${r.status}.`, "Resolve the turnover requirement or agree on the buyout recovery date.", overdue ? "High" : "Normal");
    if (r.recordType === "Escalated Meeting Action" && !closed && (num(d.carryCount) >= 2 || explicitCritical || (overdue && days(due, today) >= 7))) emit(r, "Unresolved Commitment", { [L10]: "ids", [QUARTER]: "ids" }, `${text(d.meetingType)}; ${r.owner}; Due ${due}; Carried ${num(d.carryCount)} Time(s); Status ${r.status}.`, "Resolve the blocker, confirm accountability, and agree on a recovery commitment.", explicitCritical ? "Critical" : "High");
    if (r.recordType === "Cash Account" && Math.abs(num(d.difference)) > .01) emit(r, "Cash Reconciliation", { [ACCT]: "cash-close", ...leadership(Math.abs(num(d.difference)) >= 25000) }, `Unreconciled Difference ${money(num(d.difference))}.`, "Reconcile the statement and book balance with supporting evidence.", "High");
    if (r.recordType === "Accounting Close Task" && !closed && soon) emit(r, "Close Task", { [ACCT]: "cash-close", ...leadership(overdue && days(due, today) >= 7) }, `Close Task ${r.status}; Due ${due}; Responsible Role ${text(d.assignedRole) || r.owner}.`, "Complete or explain the close exception and assign its recovery date.", overdue ? "High" : "Normal");
    if (r.recordType === "Collection Promise" && date(d.promiseDate) && date(d.promiseDate) < today) {
      const invoice = usable.find(item => item.recordType === "AR Invoice" && text(item.data.projectId) === scope && text(item.data.billingId) === text(d.billingId));
      if (invoice && !CLOSED.test(invoice.status) && num(invoice.data.balance) > 0) emit(r, "Payment Promise", { [ACCT]: "collections", ...leadership(num(invoice.data.balance) >= 25000) }, `Payment Was Promised For ${date(d.promiseDate)}; Invoice Still Has An Outstanding Balance.`, "Verify whether the promised payment arrived and record the next collection commitment.", "High", date(d.promiseDate));
    }
    if (r.recordType === "Project Health Daily Snapshots" && latestHealth.get(r.projectId)?.id === r.id) {
      const age = days(date(d.calculatedAt || r.updatedAt), today);
      if (/red|yellow/i.test(text(d.color) || r.status)) emit(r, "Project Health", { [OPS]: "scorecard", ...leadership(/red/i.test(text(d.color) || r.status)) }, `Recorded Health ${text(d.color) || r.status} ${num(d.score)}/100; Calculated ${date(d.calculatedAt || r.updatedAt)}${age > 1 ? "; Recalculation Needed" : ""}.`, "Review the current health factors, accountable actions, and recovery dates.", /red/i.test(text(d.color) || r.status) ? "Critical" : "High", date(d.calculatedAt || r.updatedAt));
    }
    if (r.recordType === "Closeout" && !closed && (soon || /blocked|missing|overdue/i.test(r.status))) emit(r, "Closeout", { [OWNER]: "quality-closeout", [SUB]: "quality", [OPS]: "handoff", ...leadership(overdue && Boolean(project?.finalDate && date(project.finalDate) < today)) }, `Closeout ${r.status}; Due ${due || "Not Set"}.`, "Confirm remaining punch work, owner turnover requirements, and completion dates.", overdue ? "High" : "Normal");
    if (r.recordType === "Sales Opportunities" && !/lost|no bid|cancelled|archived/i.test(r.status)) {
      const stage = text(d.stage) || r.status, estimateStatus = text(d.estimateStatus) || text(object(d.estimate).status);
      const bid = date(d.bidDueDate), follow = date(d.nextFollowUpDate);
      if (/estimating/i.test(stage) && bid && bid <= add(today, 14) && !/approved|proposal submitted/i.test(estimateStatus)) emit(r, "Bid Deadline", { [SALES]: "bids", ...leadership(bid < today && num(d.estimatedValue) >= 250000) }, `Bid Due ${bid}; Estimator ${text(d.assignedEstimator) || "Unassigned"}; Estimate ${estimateStatus || "Not Started"}.`, "Confirm remaining inputs, estimator capacity, and the review/submission date.", bid < today || !d.assignedEstimator ? "High" : "Normal", bid);
      if (!/awarded|lost/i.test(stage) && follow && follow <= today) emit(r, "Sales Follow-Up", { [SALES]: "pipeline" }, `Follow-Up Due ${follow}; Sales Stage ${stage}; Assigned To ${text(d.assignedRep) || r.owner || "Unassigned"}.`, "Confirm the next client contact and update the opportunity's next step.", follow < today ? "High" : "Normal", follow);
      if (/ready for review|awaiting.*approval|revision/i.test(estimateStatus)) emit(r, "Estimate Approval", { [SALES]: "proposals" }, `Estimate Status ${estimateStatus}; Bid Due ${bid || "Not Set"}.`, "Resolve estimate assumptions, overrides, and approval comments before proposal release.", bid && bid < today ? "High" : "Normal", bid);
      if (/awarded/i.test(stage) && !d.awardedProjectId && !d.awardedProjectNumber) emit(r, "Award Handoff", { [SALES]: "handoff", [OPS]: "handoff", ...leadership(true) }, "Sales Shows An Award Without A Linked Project Handoff.", "Confirm the executed agreement and complete the authorized estimate-to-project handoff.", "High");
    }
    if (r.recordType === "Owner Proposals" && !closed && /review|approval|revision|awaiting|signature/i.test(r.status)) emit(r, "Proposal Review", { [SALES]: "proposals" }, `Proposal Status ${r.status}.`, "Confirm review, owner submission, or signature responsibility and the next deadline.", overdue ? "High" : "Normal");
    if (["Sales Goals", "Scorecard", "Company Scorecard", "Scorecard Metrics", "Metrics"].includes(r.recordType) && !closed && (!d.year || num(d.year) === Number(today.slice(0, 4)))) {
      if (r.recordType === "Sales Goals") {
        emit(r, "Sales Goal", { [L10]: "scorecard", [QUARTER]: "scorecard", [SALES]: "scorecard" }, `Company Sales Goal ${money(num(d.companyGoal))} For ${num(d.year) || today.slice(0, 4)}.`, "Compare awarded sales and upcoming opportunities with the approved annual goal.", "Routine");
        continue;
      }
      const routes: Candidate["routes"] = { [L10]: "scorecard", [QUARTER]: "scorecard", ...(r.recordType === "Sales Goals" ? { [SALES]: "scorecard" } : {}) };
      if (isDepartmentMeeting(input.type) && isSelectableScorecard(r) && input.selection?.scorecards.includes(scorecardKey(r))) routes[input.type] = "scorecard";
      const hasActual = d.actual !== undefined && d.actual !== null && d.actual !== "", hasTarget = d.target !== undefined && d.target !== null && d.target !== "";
      const missed = hasActual && hasTarget && (d.direction === "At Most" ? num(d.actual) > num(d.target) : num(d.actual) < num(d.target));
      emit(r, "Scorecard Source", routes, hasActual && hasTarget ? `Actual ${num(d.actual)}; Target ${num(d.target)}${text(d.unit) ? ` ${text(d.unit)}` : ""}.` : "Review The Saved Company Measure And Its Current Reporting Period; No Missing Actual Has Been Assumed To Be Zero.", missed ? "Identify the reason this measure missed its target and agree on a corrective action." : "Confirm the measure, current result, and accountable owner.", missed ? "High" : "Routine");
      if (missed) emit(r, "Scorecard Exception", { [L10]: "ids", [QUARTER]: "ids" }, `Actual ${num(d.actual)} Against Target ${num(d.target)}.`, "Identify, discuss, and solve the missed scorecard target.", "High");
    }
  }
  if (input.projectId === "MEFFORD-COMPANY") {
    const count = (...categories: string[]) => candidates.filter(c => categories.includes(c.category)).length;
    const countFor = (type: MeetingType, ...categories: string[]) => candidates.filter(c => c.routes[type] && categories.includes(c.category)).length;
    const ap = usable.filter(r => r.recordType === "AP Invoice" && !CLOSED.test(r.status));
    const metric = (key: string, label: string, value: number, types: MeetingType[], unit: "count" | "currency" = "count") => {
      const routes = Object.fromEntries(types.map(type => [type, "scorecard"]));
      candidates.push({ key: `scorecard:${key}`, category: "Live Scorecard", routes, priority: "Routine", title: label,
        reason: `Current Saved Records As Of ${today}.`, nextStep: "Review the supporting agenda items and source workspace.", dueAt: "",
        source: { projectId: "MEFFORD-COMPANY", id: key, recordType: "Live Scorecard", updatedAt: today, target: key.startsWith("sales") ? "Sales Dashboard" : key.startsWith("ar") ? "Owner Billing" : key.startsWith("ap") ? "Accounts Payable" : key.startsWith("close") ? "WIP And Close" : key.startsWith("billing") ? "Owner Billing" : "Project Health" }, metric: { value, unit, label } });
    };
    metric("active-projects", "Active Contracted Projects", activeProjects.length, [L10, QUARTER, OPS]);
    metric("schedule-risks", "Activities With Schedule Creep", count("Schedule Creep"), [L10, QUARTER, OPS]);
    metric("lead-time-risks", "Lead-Time Issues", candidates.filter(c => c.category === "Lead Time" && ["Critical", "High"].includes(c.priority)).length, [L10, QUARTER, OPS]);
    metric("safety-open", "Open Safety Issues", count("Safety"), [L10, QUARTER, OPS]);
    metric("quality-open", "Open Quality Issues", count("Quality"), [OPS]);
    const awarded = signedSalesRecords(usable.filter(r => r.recordType === "Sales Opportunities"), today.slice(0, 4));
    metric("sales-awarded", "Signed Sales This Year", Math.round(awarded.reduce((sum, r) => sum + opportunityContract(r.data)!.recognizedValue, 0) * 100) / 100, [L10, QUARTER, SALES], "currency");
    metric("sales-bids", "Estimates Due Within 14 Days Or Overdue", countFor(SALES, "Bid Deadline"), [L10, QUARTER, SALES]);
    metric("sales-review", "Estimate And Proposal Reviews", count("Estimate Approval", "Proposal Review"), [L10, QUARTER, SALES]);
    metric("sales-coverage", "Bid Packages Requiring Coverage Review", countFor(SALES, "Quote Coverage"), [SALES]);
    metric("sales-followup", "Sales Follow-Ups Due", count("Sales Follow-Up"), [SALES]);
    metric("ar-overdue", "Overdue Owner Receivables", Math.round(overdueOwnerBalance * 100) / 100, [L10, QUARTER, ACCT], "currency");
    metric("ap-open", "Open Payable Amount", Math.round(ap.reduce((sum, r) => sum + Math.max(0, num(r.data.amount)), 0) * 100) / 100, [ACCT], "currency");
    metric("billing-approvals", "Billing Reviews And Release Items", count("Billing Approval"), [ACCT]);
    metric("close-exceptions", "Close Tasks Due Within 14 Days Or Overdue", count("Close Task"), [ACCT]);
  }
  const sections = new Set(MEETING_SECTIONS[input.type].map(s => s.key));
  return candidates.filter(c => c.routes[input.type] && sections.has(c.routes[input.type]!)).map(({ routes, ...c }) => ({ ...c, sectionKey: routes[input.type]! }))
    .filter(signal => !input.selection || agendaSignalSelected(signal, input.selection))
    .sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority] || (a.dueAt || "9999").localeCompare(b.dueAt || "9999") || a.key.localeCompare(b.key));
}
