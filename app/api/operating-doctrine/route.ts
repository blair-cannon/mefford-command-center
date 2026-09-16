import { salesOpportunityValue } from "../../../lib/sales-opportunity-value";
import { loadSalesContracts } from "../../../lib/sales-contract-server";
import { opportunityContract, signedSalesRecords, withSalesContract } from "../../../lib/sales-contract";
import { eq } from "drizzle-orm";
import {
  accountingWipForecasts,
  commandRecords,
  companyMembers,
  projects,
} from "../../../db/schema";
import { enforceOnboardingAccess } from "../../../lib/onboarding";
import {
  PROFITABILITY_FLOOR_BASIS_POINTS,
  ROLE_DOCTRINE,
  parseDesignationJson,
  primaryOperatingRole,
  type OperatingOutcome,
  type OperatingRole,
} from "../../../lib/operating-doctrine";
import { resolveCommandActor } from "../../../lib/server-actor";
import {
  isContractedActiveProject,
  needsOwnerContractSignature,
} from "../../../lib/contracted-projects";

type Signal = {
  id: string;
  role: OperatingRole;
  outcome: OperatingOutcome;
  severity: "Critical" | "High" | "Watch" | "Good";
  title: string;
  why: string;
  accountable: string;
  assistance: string;
  ownerReason: string;
  projectId: string;
  projectName: string;
  target: string;
  due: string;
  value?: number;
};

type Metric = { label: string; value: string; detail: string; risk?: boolean };

const CLOSED = new Set([
  "approved",
  "closed",
  "complete",
  "completed",
  "executed",
  "final",
  "lost",
  "paid",
  "released",
  "rejected",
  "void",
  "voided",
  "archived",
  "current set",
  "record set",
]);

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;

  try {
    const { getDb } = await import("../../../db");
    const db = getDb();
    const member = (await db.select().from(companyMembers).where(eq(companyMembers.email, actor.email)).limit(1))[0];
    if (member?.isActive === false) return Response.json({ error: "Company Access Is Inactive" }, { status: 403 });
    const accessLevel = member?.companyAccessLevel || actor.accessLevel;
    const designations = parseDesignationJson(member?.designationsJson);
    const actorName = member?.displayName || actor.name;
    const actorRole = primaryOperatingRole(accessLevel, designations);
    const isLeadership = ["Company Owner", "Administrator"].includes(accessLevel);
    const canSeeFinancial = isLeadership || designations.some((item) => ["Project Manager", "Estimator", "Estimating Manager", "Accountant", "Financial Administrator", "Accounting Manager"].includes(item));
    const [storedProjectRows, recordRows, forecastRows] = await Promise.all([
      db.select().from(projects),
      db.select().from(commandRecords),
      db.select().from(accountingWipForecasts),
    ]);
    const salesContracts = await loadSalesContracts((await import("cloudflare:workers")).env.DB);
    const projectRows = storedProjectRows.map(project => {
      const contract = salesContracts.get(project.number);
      return { ...project, currentContractAmount: contract?.contractValue.toFixed(2) || project.currentContractAmount,
        contractAuthorized: contract?.signed === true };
    });
    const today = easternDate();
    const period = today.slice(0, 7);
    const activeProjects = projectRows.filter(isContractedActiveProject);
    const contractsToSign = projectRows.filter(needsOwnerContractSignature);
    const recordsByProject = new Map<string, typeof recordRows>();
    for (const record of recordRows) recordsByProject.set(record.projectId, [...(recordsByProject.get(record.projectId) || []), record]);
    const latestForecastByProject = new Map<string, typeof forecastRows[number]>();
    for (const forecast of [...forecastRows].sort((left, right) => right.periodId.localeCompare(left.periodId) || right.updatedAt.localeCompare(left.updatedAt))) {
      if (!latestForecastByProject.has(forecast.projectId)) latestForecastByProject.set(forecast.projectId, forecast);
    }

    const signals: Signal[] = [];
    const add = (signal: Signal) => signals.push(signal);
    const projectScheduleRisk = new Set<string>();
    let dailyLogsToday = 0;
    let lateActivities = 0;
    let openSafety = 0;
    let openQuality = 0;
    let budgetsUnlocked = 0;
    let projectsAtLoss = 0;
    let marginAtRisk = 0;
    let currentWip = 0;
    let totalAr = 0;

    for (const project of activeProjects) {
      const rows = recordsByProject.get(project.number) || [];
      const pm = project.projectManager || "Project Manager";
      const superintendent = project.superintendent || "Superintendent";
      const todayLog = rows.some((record) => record.recordType === "Daily Logs" && record.recordDate === today);
      if (todayLog) dailyLogsToday += 1;
      else add({ id: `field-log-${project.number}`, role: "Superintendent", outcome: "Safe Field Execution", severity: "Watch", title: `${project.name} Has No Daily Field Truth Today`, why: "Ownership and the PM cannot confirm manpower, production, weather, incidents, or current jobsite conditions.", accountable: superintendent, assistance: "PM confirms whether the site is working; Superintendent files the permanent Daily Log or records the non-working day.", ownerReason: "Escalate only if field visibility remains missing or hides a safety or schedule condition.", projectId: project.number, projectName: project.name, target: "Daily Logs", due: today });

      const scheduleRows = rows.filter((record) => record.recordType === "Schedule");
      const late = scheduleRows.filter((record) => {
        const row = recordData(record.dataJson);
        const finish = String(row.finish || row.end || record.due || "").slice(0, 10);
        return finish && finish < today && number(row.progress) < 100;
      });
      lateActivities += late.length;
      if (!scheduleRows.length || late.length || (project.finalDate && project.finalDate < today)) {
        projectScheduleRisk.add(project.number);
        const finalOverdue = Boolean(project.finalDate && project.finalDate < today);
        add({ id: `schedule-${project.number}`, role: "Project Manager", outcome: "Schedule Reliability", severity: finalOverdue ? "Critical" : "High", title: finalOverdue ? `${project.name} Is Past Final Completion` : !scheduleRows.length ? `${project.name} Has No Measurable Baseline` : `${project.name} Has ${late.length} Late Schedule Activit${late.length === 1 ? "y" : "ies"}`, why: finalOverdue ? "The contract completion commitment is missed and time-related cost exposure is active." : !scheduleRows.length ? "The PM and field team cannot measure completion risk without a current baseline." : "Late work threatens downstream trades, owner commitments, and the cost of time.", accountable: pm, assistance: "Superintendent reports actual field conditions; PM publishes the recovery sequence and protects downstream commitments.", ownerReason: finalOverdue ? "Ownership sees this immediately because an unrecovered contract-completion miss is a protected red flag." : "Escalate if the PM cannot publish and hold a credible recovery plan.", projectId: project.number, projectName: project.name, target: "Schedule", due: today });
      }

      const incident = rows.find((record) => {
        const row = recordData(record.dataJson);
        return ["Safety Incidents", "Safety", "Daily Logs"].includes(record.recordType) && !isClosed(record.status) && (row.incidentReported === true || /incident|critical|stop work/i.test(`${record.title} ${record.status}`)) && row.incidentResolved !== true;
      });
      if (incident) {
        openSafety += 1;
        add({ id: `safety-${project.number}-${incident.id}`, role: "Superintendent", outcome: "Safe Field Execution", severity: "Critical", title: `${project.name} Has An Unresolved Safety Condition`, why: "A reported incident or critical field condition remains open without documented corrective closure.", accountable: superintendent, assistance: "Safety leadership and the PM secure the condition, preserve facts, and verify corrective action.", ownerReason: "Ownership sees this immediately because unresolved safety is a protected red flag.", projectId: project.number, projectName: project.name, target: "Safety", due: today });
      }
      const quality = rows.filter((record) => ["Quality Items", "Quality Inspections"].includes(record.recordType) && !isClosed(record.status));
      openQuality += quality.length;
      if (quality.length) add({ id: `quality-${project.number}`, role: "Superintendent", outcome: "Safe Field Execution", severity: quality.some((record) => record.due && record.due < today) ? "High" : "Watch", title: `${project.name} Has ${quality.length} Open Quality Item${quality.length === 1 ? "" : "s"}`, why: "Uncorrected work creates rework, payment, closeout, and schedule exposure.", accountable: superintendent, assistance: "PM protects payment and schedule leverage while the Superintendent verifies correction before acceptance.", ownerReason: "Escalate only when repeated or overdue quality failures threaten cost, completion, or customer confidence.", projectId: project.number, projectName: project.name, target: "Quality", due: today });

      const budgetControl = rows.find((record) => record.recordType === "Budget Control" && record.id === "BUDGET-CONTROL");
      if (recordData(budgetControl?.dataJson).locked !== true) {
        budgetsUnlocked += 1;
        add({ id: `budget-${project.number}`, role: "Project Manager", outcome: "Profit Protection", severity: "Critical", title: `${project.name} Original Budget Is Not Locked`, why: "Without a locked baseline, commitments, changes, forecast variance, and profit recovery cannot be trusted.", accountable: pm, assistance: "Accounting validates the cost structure and source documents; PM confirms the operating budget before Owner/Admin lock.", ownerReason: "Ownership sees this because profit cannot be governed without an approved baseline.", projectId: project.number, projectName: project.name, target: "Budget", due: today });
      }

      const forecast = latestForecastByProject.get(project.number);
      const authoritativeForecast = forecast && ["Accounting Reviewed", "Owner Approved", "Locked"].includes(forecast.status) ? forecast : null;
      if (authoritativeForecast?.periodId === period) currentWip += 1;
      const projectedProfit = authoritativeForecast ? authoritativeForecast.forecastProfitCents / 100 : null;
      const projectedMarginBps = authoritativeForecast?.projectedMarginBasisPoints ?? null;
      if (!authoritativeForecast || authoritativeForecast.periodId !== period) {
        add({ id: `wip-current-${project.number}`, role: "Accounting", outcome: "Financial Decision Support", severity: "High", title: `${project.name} Does Not Have A Current PM Decision Forecast`, why: "The PM is operating without a current-period ETC, EAC, risk reserve, and projected-margin view.", accountable: "Accounting + " + pm, assistance: "Accounting supplies cost-to-date, commitments, AP, billing, and exception detail; PM owns ETC, risks, and recovery decisions.", ownerReason: "Ownership sees this when current decision data is missing long enough to hide loss or margin erosion.", projectId: project.number, projectName: project.name, target: "WIP And Close", due: today });
      }
      if (projectedProfit !== null && projectedProfit <= 0) {
        projectsAtLoss += 1;
        add({ id: `loss-${project.number}`, role: "Project Manager", outcome: "Profit Protection", severity: "Critical", title: `${project.name} Is Forecast To Lose ${money(Math.abs(projectedProfit))}`, why: "The latest WIP forecast shows estimated cost at completion at or above the current contract value.", accountable: pm, assistance: "Accounting immediately reconciles cost, commitments, billing, and forecast inputs; PM produces the recovery plan, change strategy, and schedule/cost action.", ownerReason: "Ownership sees this immediately because Mefford does not allow a project loss to remain a PM-only problem.", projectId: project.number, projectName: project.name, target: "WIP And Close", due: today, value: projectedProfit });
      } else if (projectedMarginBps !== null && projectedMarginBps < PROFITABILITY_FLOOR_BASIS_POINTS) {
        marginAtRisk += 1;
        add({ id: `margin-${project.number}`, role: "Project Manager", outcome: "Profit Protection", severity: "High", title: `${project.name} Forecast Margin Is ${(projectedMarginBps / 100).toFixed(1)}%`, why: `Projected gross margin is below the ${PROFITABILITY_FLOOR_BASIS_POINTS / 100}% company profitability floor and requires a documented recovery decision.`, accountable: pm, assistance: "Accounting confirms the numbers and exposes cost-code exceptions; PM owns recovery through buyout, productivity, schedule, billing, and change management.", ownerReason: "Ownership sees this when margin erosion becomes material or the recovery plan is not current.", projectId: project.number, projectName: project.name, target: "WIP And Close", due: today, value: projectedProfit || 0 });
      }

      const billings = rows.filter((record) => record.recordType === "Owner Billing" && ["Ready To Send", "Sent", "Partially Paid", "Paid"].includes(record.status));
      const receipts = rows.filter((record) => record.recordType === "Owner Receipt" && record.status === "Posted");
      const billed = billings.reduce((sum, record) => sum + number(recordData(record.dataJson).currentPaymentDue), 0);
      const received = receipts.reduce((sum, record) => sum + number(recordData(record.dataJson).amount), 0);
      totalAr += Math.max(0, billed - received);
    }

    const salesRows = recordsByProject.get("MEFFORD-SALES") || [];
    const opportunities = salesRows.filter((record) => record.recordType === "Sales Opportunities");
    const activeOpportunities = opportunities.filter((record) => !["Awarded", "Lost", "On Hold"].includes(opportunityData(record).stage));
    const pipelineValue = activeOpportunities.reduce((sum, record) => sum + opportunityData(record).value, 0);
    const weightedPipeline = activeOpportunities.reduce((sum, record) => sum + opportunityData(record).value * opportunityData(record).probability / 100, 0);
    const goalRecord = salesRows.find((record) => record.recordType === "Sales Goals" && number(recordData(record.dataJson).year) === number(today.slice(0, 4)));
    const companyGoal = number(recordData(goalRecord?.dataJson).companyGoal);
    const signedSales = signedSalesRecords(opportunities.map(record => ({
      ...record, data: withSalesContract(recordData(record.dataJson), salesContracts),
    })), today.slice(0, 4));
    const awardedValue = signedSales.reduce((sum, record) => sum + opportunityContract(record.data)!.recognizedValue, 0);
    const remainingGoal = Math.max(0, companyGoal - awardedValue);
    const followUpsDue = activeOpportunities.filter((record) => {
      const next = opportunityData(record).nextFollowUp;
      return !next || next <= today;
    });
    if (remainingGoal > 0 && weightedPipeline < remainingGoal) add({ id: `pipeline-gap-${today.slice(0, 7)}`, role: "Sales", outcome: "Pipeline Growth", severity: "High", title: `Weighted Pipeline Is ${money(remainingGoal - weightedPipeline)} Short Of The Remaining Goal`, why: "The current probability-adjusted pipeline cannot cover the remaining approved sales goal.", accountable: "Sales Manager + Assigned Salespeople", assistance: "Estimating protects turnaround capacity; leadership removes target-market or pursuit barriers without replacing sales ownership.", ownerReason: "Ownership sees this because backlog and future operating volume are at risk, not because an individual follow-up is late.", projectId: "MEFFORD-SALES", projectName: "Sales Pipeline", target: "Sales Dashboard", due: today, value: remainingGoal - weightedPipeline });
    for (const record of followUpsDue.slice(0, 20)) {
      const opportunity = opportunityData(record);
      add({ id: `sales-followup-${record.id}`, role: "Sales", outcome: "Pipeline Growth", severity: opportunity.value >= 500_000 ? "High" : "Watch", title: `${record.title} Needs A Defined Sales Move`, why: opportunity.nextFollowUp ? "The saved client follow-up date is due or overdue." : "This active opportunity has no dated next step.", accountable: opportunity.assignedRep || record.owner || "Salesperson", assistance: "Leadership supports strategy only after Sales records the specific client move and close obstacle.", ownerReason: opportunity.value >= 500_000 ? "Ownership sees this only if a material opportunity lacks movement or needs a leadership decision." : "Escalate through Sales management before ownership.", projectId: "MEFFORD-SALES", projectName: record.title, target: "Sales Funnel", due: opportunity.nextFollowUp || today, value: opportunity.value });
    }
    for (const project of contractsToSign) {
      add({
        id: `contract-signature-${project.number}`,
        role: "Sales",
        outcome: "Pipeline Growth",
        severity: "High",
        title: `${project.name} Contract Needs Signatures`,
        why: "Awarded work remains outside Active Projects until the owner contract is fully executed.",
        accountable: "Sales + Company Owner",
        assistance: "Sales keeps the owner handoff moving; Company Owner completes Mefford review and countersignature.",
        ownerReason: "Ownership sees this because the award cannot become active backlog until the owner contract is fully executed.",
        projectId: project.number,
        projectName: project.name,
        target: "Contracts",
        due: project.ownerContractDate || today,
        value: number(project.currentContractAmount || project.contractAmount),
      });
    }

    const estimating = opportunities.filter((record) => {
      const row = opportunityData(record);
      return (Boolean(recordData(record.dataJson).directEstimate) || Boolean(recordData(record.dataJson).estimatingRequestedAt)) && !["Awarded", "Lost"].includes(row.stage) && row.estimateStatus !== "Awarded";
    });
    const overdueEstimates = estimating.filter((record) => opportunityData(record).bidDue && opportunityData(record).bidDue < today && !["Proposal Submitted", "Approved"].includes(opportunityData(record).estimateStatus));
    const dueSeven = estimating.filter((record) => {
      const days = daysUntil(opportunityData(record).bidDue, today);
      return days !== null && days >= 0 && days <= 7 && !["Proposal Submitted", "Approved"].includes(opportunityData(record).estimateStatus);
    });
    const unassignedEstimates = estimating.filter((record) => !opportunityData(record).assignedEstimator);
    for (const record of [...overdueEstimates, ...dueSeven].filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index)) {
      const estimate = opportunityData(record);
      const overdue = estimate.bidDue < today;
      add({ id: `estimate-due-${record.id}`, role: "Estimator", outcome: "Proposal Reliability", severity: overdue || daysUntil(estimate.bidDue, today) === 0 ? "Critical" : "High", title: `${record.title} Proposal ${overdue ? "Is Overdue" : "Is Due Soon"}`, why: "The proposal deadline is inside the active control window and the proposal is not recorded as submitted.", accountable: estimate.assignedEstimator || "Estimating Manager", assistance: "Sales confirms client strategy, inclusions, and close positioning; the Estimator owns complete, reviewed pricing and on-time submission.", ownerReason: overdue ? "Ownership sees an overdue qualified proposal because revenue opportunity and company credibility are at risk." : "Escalate through Estimating management unless scope, price, or authority requires ownership.", projectId: "MEFFORD-SALES", projectName: record.title, target: "Estimating", due: estimate.bidDue || today, value: estimate.value });
    }

    const accountingRows = recordsByProject.get("MEFFORD-ACCOUNTING") || [];
    const noPoCosts = accountingRows.filter((record) => record.recordType === "AP Invoice" && recordData(record.dataJson).noPoAlert === true && !isClosed(record.status));
    const accountingExceptions = signals.filter((signal) => signal.role === "Accounting" || signal.outcome === "Profit Protection").length + noPoCosts.length;

    const roleMetrics: Record<OperatingRole, Metric[]> = {
      Superintendent: [
        { label: "Field Truth Today", value: `${dailyLogsToday} / ${activeProjects.length}`, detail: "Active projects with today’s Daily Log", risk: dailyLogsToday < activeProjects.length },
        { label: "Late Activities", value: String(lateActivities), detail: "Past-due schedule activities below 100%", risk: lateActivities > 0 },
        { label: "Open Safety", value: String(openSafety), detail: "Unresolved incident or critical condition", risk: openSafety > 0 },
        { label: "Open Quality", value: String(openQuality), detail: "Items awaiting correction or acceptance", risk: openQuality > 0 },
      ],
      "Project Manager": canSeeFinancial ? [
        { label: "Projects At Loss", value: String(projectsAtLoss), detail: "Latest forecast profit at or below zero", risk: projectsAtLoss > 0 },
        { label: "Margin At Risk", value: String(marginAtRisk), detail: `Forecast below ${PROFITABILITY_FLOOR_BASIS_POINTS / 100}%`, risk: marginAtRisk > 0 },
        { label: "Schedule Risk", value: String(projectScheduleRisk.size), detail: "Baseline, late activity, or completion risk", risk: projectScheduleRisk.size > 0 },
        { label: "Budget Control", value: String(budgetsUnlocked), detail: "Active original budgets not locked", risk: budgetsUnlocked > 0 },
      ] : restrictedMetrics("Assigned-project financials are restricted"),
      Estimator: [
        { label: "Due In 7 Days", value: String(dueSeven.length), detail: "Active proposal control window", risk: dueSeven.length > 0 },
        { label: "Overdue", value: String(overdueEstimates.length), detail: "Proposal deadline missed", risk: overdueEstimates.length > 0 },
        { label: "Unassigned", value: String(unassignedEstimates.length), detail: "Active estimates without an Estimator", risk: unassignedEstimates.length > 0 },
        { label: "Ready For Review", value: String(estimating.filter((record) => opportunityData(record).estimateStatus === "Ready For Review").length), detail: "Waiting for internal pricing review" },
      ],
      Sales: [
        { label: "Contracts To Sign", value: String(contractsToSign.length), detail: "Awarded jobs awaiting full owner-contract execution", risk: contractsToSign.length > 0 },
        { label: "Open Pipeline", value: money(pipelineValue), detail: `${activeOpportunities.length} active opportunities` },
        { label: "Weighted Pipeline", value: money(weightedPipeline), detail: "Saved probability applied" },
        { label: "Goal Coverage", value: companyGoal <= 0 ? "Goal Not Set" : remainingGoal ? `${(weightedPipeline / remainingGoal).toFixed(2)}×` : "Covered", detail: companyGoal <= 0 ? "Enter the annual sales goal" : "Weighted pipeline ÷ remaining goal", risk: companyGoal <= 0 || remainingGoal > weightedPipeline },
        { label: "Next Moves Due", value: String(followUpsDue.length), detail: "Due, overdue, or missing follow-up", risk: followUpsDue.length > 0 },
      ],
      Accounting: canSeeFinancial ? [
        { label: "PM Forecasts Current", value: `${currentWip} / ${activeProjects.length}`, detail: "Current-period decision packs", risk: currentWip < activeProjects.length },
        { label: "Profit Signals", value: String(projectsAtLoss + marginAtRisk), detail: "Projects requiring PM recovery support", risk: projectsAtLoss + marginAtRisk > 0 },
        { label: "Owner AR", value: money(totalAr), detail: "Billed less posted receipts", risk: totalAr > 0 },
        { label: "Decision Exceptions", value: String(accountingExceptions), detail: "Items Accounting must make actionable", risk: accountingExceptions > 0 },
      ] : restrictedMetrics("Accounting decision data is role restricted"),
      "Company Leadership": [
        { label: "Immediate Red Flags", value: String(signals.filter((signal) => signal.severity === "Critical").length), detail: "Safety, loss, completion, or control failures", risk: signals.some((signal) => signal.severity === "Critical") },
        { label: "Role Recovery", value: String(signals.filter((signal) => signal.severity === "High").length), detail: "High-priority accountable-role actions", risk: signals.some((signal) => signal.severity === "High") },
        { label: "Active Projects", value: String(activeProjects.length), detail: "Current operating portfolio" },
        { label: "Operating Chain", value: "5 Roles", detail: "Field → PM → Estimating → Sales → Accounting" },
      ],
    };

    const projectIsVisible = (projectId: string) => {
      if (isLeadership || projectId.startsWith("MEFFORD-")) return true;
      const project = projectRows.find((row) => row.number === projectId);
      if (!project) return false;
      if (actorRole === "Superintendent") return project.superintendent.toLowerCase() === actorName.toLowerCase();
      if (actorRole === "Project Manager") return project.projectManager.toLowerCase() === actorName.toLowerCase();
      return true;
    };
    const visibleSignals = signals.filter((signal) => {
      if (!projectIsVisible(signal.projectId)) return false;
      if (isLeadership) return true;
      if (actorRole === signal.role) return true;
      if (actorRole === "Superintendent") return signal.role === "Project Manager" && signal.outcome === "Schedule Reliability";
      if (actorRole === "Project Manager") return signal.role === "Superintendent" || (signal.role === "Accounting" && !signal.projectId.startsWith("MEFFORD-"));
      if (actorRole === "Accounting") return signal.role === "Project Manager" || signal.role === "Accounting";
      if (actorRole === "Estimator") return signal.role === "Sales" || signal.role === "Estimator";
      return false;
    });
    const actorSpecificMetrics: Partial<Record<OperatingRole, Metric[]>> = {};
    if (actorRole === "Project Manager") {
      const assigned = activeProjects.filter((project) => project.projectManager.trim().toLowerCase() === actorName.trim().toLowerCase());
      const assignedIds = new Set(assigned.map((project) => project.number));
      const countSignal = (prefix: string) => signals.filter((signal) => assignedIds.has(signal.projectId) && signal.id.startsWith(prefix)).length;
      actorSpecificMetrics["Project Manager"] = [
        { label: "Projects At Loss", value: String(countSignal("loss-")), detail: "Assigned forecast profit at or below zero", risk: countSignal("loss-") > 0 },
        { label: "Margin At Risk", value: String(countSignal("margin-")), detail: `Assigned forecast below ${PROFITABILITY_FLOOR_BASIS_POINTS / 100}%`, risk: countSignal("margin-") > 0 },
        { label: "Schedule Risk", value: String(countSignal("schedule-")), detail: "Assigned baseline, late activity, or completion risk", risk: countSignal("schedule-") > 0 },
        { label: "Budget Control", value: String(countSignal("budget-")), detail: "Assigned original budgets not locked", risk: countSignal("budget-") > 0 },
      ];
    }
    if (actorRole === "Superintendent") {
      const assigned = activeProjects.filter((project) => project.superintendent.trim().toLowerCase() === actorName.trim().toLowerCase());
      const assignedIds = new Set(assigned.map((project) => project.number));
      const roleSignals = signals.filter((signal) => assignedIds.has(signal.projectId));
      actorSpecificMetrics.Superintendent = [
        { label: "Field Truth Today", value: `${assigned.length - roleSignals.filter((signal) => signal.id.startsWith("field-log-")).length} / ${assigned.length}`, detail: "Assigned projects with today's Daily Log", risk: roleSignals.some((signal) => signal.id.startsWith("field-log-")) },
        { label: "Schedule Risk", value: String(roleSignals.filter((signal) => signal.id.startsWith("schedule-")).length), detail: "Assigned schedule conditions requiring PM recovery", risk: roleSignals.some((signal) => signal.id.startsWith("schedule-")) },
        { label: "Open Safety", value: String(roleSignals.filter((signal) => signal.id.startsWith("safety-")).length), detail: "Unresolved assigned safety condition", risk: roleSignals.some((signal) => signal.id.startsWith("safety-")) },
        { label: "Open Quality", value: String(roleSignals.filter((signal) => signal.id.startsWith("quality-")).length), detail: "Assigned projects with open quality work", risk: roleSignals.some((signal) => signal.id.startsWith("quality-")) },
      ];
    }
    const scorecards = (["Superintendent", "Project Manager", "Estimator", "Sales", "Accounting"] as OperatingRole[]).map((role) => ({
      doctrine: ROLE_DOCTRINE[role],
      metrics: isLeadership ? roleMetrics[role] : role === actorRole ? actorSpecificMetrics[role] || roleMetrics[role] : restrictedMetrics("Open this role's authorized workspace for live operating detail"),
      status: (isLeadership ? signals : visibleSignals).some((signal) => signal.role === role && signal.severity === "Critical") ? "Critical" : (isLeadership ? signals : visibleSignals).some((signal) => signal.role === role && signal.severity === "High") ? "Needs Attention" : "On Track",
      signalCount: (isLeadership ? signals : visibleSignals).filter((signal) => signal.role === role && ["Critical", "High"].includes(signal.severity)).length,
    }));

    return Response.json({
      generatedAt: new Date().toISOString(),
      actor: { name: actorName, accessLevel, designations, role: actorRole },
      activeDoctrine: ROLE_DOCTRINE[actorRole],
      leadershipDoctrine: ROLE_DOCTRINE["Company Leadership"],
      scorecards,
      signals: visibleSignals.sort(signalSort),
      ownershipFlags: isLeadership ? signals.filter((signal) => signal.severity === "Critical" || (signal.severity === "High" && /Ownership sees|Ownership visibility/i.test(signal.ownerReason))).sort(signalSort) : [],
      policy: {
        profitFloorBasisPoints: PROFITABILITY_FLOOR_BASIS_POINTS,
        ownerRule: "Immediate for safety, projected loss, overdue final completion, or missing core financial control; otherwise after accountable-role recovery and manager escalation.",
        accountingRule: "Accounting must translate every material exception into the PM decision, amount, source, and required date.",
        alertRule: "Every alert names the accountable role, operating outcome, business consequence, required action, due date, and ownership reason.",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Operating Doctrine Is Unavailable";
    console.error("operating doctrine error", error);
    return Response.json({ error: message }, { status: 500 });
  }
}

function restrictedMetrics(detail: string): Metric[] {
  return [
    { label: "Profit Protection", value: "Restricted", detail },
    { label: "Forecast Risk", value: "Restricted", detail },
    { label: "Schedule Risk", value: "Role View", detail: "Open Project Health for assigned operations" },
    { label: "Decision Support", value: "Role View", detail: "Only information required for your work is shown" },
  ];
}

function recordData(value?: string | null) {
  try {
    const parsed = JSON.parse(value || "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function opportunityData(record: typeof commandRecords.$inferSelect) {
  const row = recordData(record.dataJson);
  return {
    stage: String(row.stage || record.status || "New Lead"),
    value: salesOpportunityValue(row, record.status),
    probability: number(row.probability),
    nextFollowUp: String(row.nextFollowUpDate || ""),
    bidDue: String(row.bidDueDate || record.due || "").slice(0, 10),
    assignedRep: String(row.assignedRep || record.owner || ""),
    assignedEstimator: String(row.assignedEstimator || ""),
    estimateStatus: String(row.estimateStatus || "Not Started"),
  };
}

function number(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isClosed(status: string) {
  return CLOSED.has(String(status || "").trim().toLowerCase());
}

function easternDate() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function daysUntil(value: string, today: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return Math.round((new Date(`${value}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 86_400_000);
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);
}

function signalSort(left: Signal, right: Signal) {
  const priority = { Critical: 0, High: 1, Watch: 2, Good: 3 };
  return priority[left.severity] - priority[right.severity] || left.due.localeCompare(right.due) || left.title.localeCompare(right.title);
}
