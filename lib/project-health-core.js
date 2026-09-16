export const PROJECT_HEALTH_WEIGHTS = Object.freeze({
  Financial: 25,
  Schedule: 25,
  Safety: 15,
  Quality: 10,
  "Project Controls": 10,
  "Vendor / Procurement": 10,
  Closeout: 5,
});

export const PROJECT_HEALTH_BANDS = Object.freeze({ green: 90, yellow: 75 });
export const PROJECT_PROFITABILITY_FLOOR_BASIS_POINTS = 1500;

export const PROTECTED_HEALTH_RULES = Object.freeze([
  { id: "financial-budget-control", category: "Financial", name: "Locked Budget And Forecast", description: "Require a locked original budget and compare current forecast to the revised budget.", protected: true },
  { id: "financial-projected-overrun", category: "Financial", name: "Projected Budget Overrun", description: "Force Red when projected cost exceeds revised budget by more than 1% or $25,000.00, whichever threshold is reached first.", protected: true, critical: true },
  { id: "financial-project-loss", category: "Financial", name: "Project Loss Guardrail", description: "Force Red whenever the latest project forecast is at or below zero gross profit; PM recovery and Accounting reconciliation are mandatory.", protected: true, critical: true },
  { id: "schedule-current-baseline", category: "Schedule", name: "Current Baseline And Activity Progress", description: "Measure overdue activities, expected progress, and final completion against the current schedule.", protected: true },
  { id: "schedule-final-completion", category: "Schedule", name: "Final Completion Guardrail", description: "Force Red when final completion is overdue on an unfinished project.", protected: true, critical: true },
  { id: "safety-critical-condition", category: "Safety", name: "Critical Safety Condition", description: "Force Red while a reported safety incident or critical safety condition remains unresolved.", protected: true, critical: true },
  { id: "quality-open-deficiencies", category: "Quality", name: "Quality And Punch Exposure", description: "Measure failed inspections, overdue deficiencies, verification, and designer acceptance.", protected: true },
  { id: "controls-overdue-work", category: "Project Controls", name: "Project-Control Timeliness", description: "Measure overdue RFIs, submittals, required daily logs, and missing schedule quality categories.", protected: true },
  { id: "vendor-compliance", category: "Vendor / Procurement", name: "Vendor Payment Readiness", description: "Warn when an assigned vendor has a payment hold without slowing project work.", protected: true, critical: false },
  { id: "procurement-bid-coverage", category: "Vendor / Procurement", name: "Competitive Bid Coverage", description: "Target three bids before recommendation unless an approved documented exception exists.", protected: true },
  { id: "closeout-readiness", category: "Closeout", name: "Continuous Closeout Readiness", description: "Measure open final punch and required closeout work as substantial completion approaches.", protected: true },
]);

const CLOSED = new Set([
  "approved", "closed", "complete", "completed", "executed", "final", "passed",
  "released", "rejected", "void", "voided", "owner signed off", "current set",
  "record set", "override documented",
]);

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function data(record) {
  return record?.data && typeof record.data === "object" ? record.data : {};
}

function dateValue(value) {
  if (!value) return null;
  const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function daysBetween(from, to) {
  const start = dateValue(from);
  const end = dateValue(to);
  return start && end ? Math.round((end.getTime() - start.getTime()) / 86_400_000) : 0;
}

function isClosed(record) {
  return CLOSED.has(String(record?.status || "").trim().toLowerCase());
}

function closeoutCredit(record) {
  const status = String(record?.status || "");
  if (["Approved", "Not Applicable"].includes(status)) return 100;
  const base = { "Not Started": 0, Requested: 10, "Corrections Required": 25, Submitted: 60, "Under Review": 80 }[status] || 0;
  const row = data(record);
  const flow = Array.isArray(row.approvalFlow) ? row.approvalFlow : [];
  const completed = Array.isArray(row.approvals) ? row.approvals.filter((approval) => approval?.decision === "Approved").length : 0;
  return flow.length && completed ? Math.min(99, Math.max(base, 80 + Math.round((completed / flow.length) * 19))) : base;
}

function expectedCloseout(finalDate, today) {
  const remaining = daysBetween(today, finalDate);
  if (!finalDate || remaining > 90) return { active: false, remaining, expected: 0 };
  if (remaining <= 0) return { active: true, remaining, expected: 100 };
  const anchors = [[90, 10], [60, 35], [30, 70], [0, 100]];
  for (let index = 0; index < anchors.length - 1; index += 1) {
    const [upperDays, upperExpected] = anchors[index];
    const [lowerDays, lowerExpected] = anchors[index + 1];
    if (remaining <= upperDays && remaining >= lowerDays) {
      const ratio = (upperDays - remaining) / (upperDays - lowerDays);
      return { active: true, remaining, expected: Math.round(upperExpected + (lowerExpected - upperExpected) * ratio) };
    }
  }
  return { active: true, remaining, expected: 100 };
}

function factor(id, category, deduction, title, explanation, action, owner, due, critical = false) {
  return {
    id,
    ruleId: id,
    category,
    deduction: Math.max(0, number(deduction)),
    title,
    explanation,
    action,
    owner,
    due,
    critical,
    protected: true,
    exceptionActive: false,
  };
}

function activeException(exceptions, ruleId, today) {
  return exceptions.find((item) =>
    item.ruleId === ruleId &&
    item.status === "Approved" &&
    String(item.startsAt || "0000-00-00") <= today &&
    String(item.expiresAt || "0000-00-00") >= today,
  );
}

function addFactor(factors, exceptions, entry, today) {
  const exception = activeException(exceptions, entry.ruleId, today);
  if (exception && !entry.critical) {
    factors.push({ ...entry, deduction: 0, exceptionActive: true, exceptionId: exception.id, explanation: `${entry.explanation} Approved exception active through ${exception.expiresAt}.` });
    return;
  }
  factors.push(entry);
}

function finishCategory(category, factors) {
  const weight = PROJECT_HEALTH_WEIGHTS[category];
  const lost = Math.min(weight, factors.filter((item) => item.category === category).reduce((sum, item) => sum + item.deduction, 0));
  const earned = Math.max(0, weight - lost);
  return { category, weight, earned, lost, status: earned / weight >= 0.9 ? "Green" : earned / weight >= 0.75 ? "Yellow" : "Red" };
}

export function calculateProjectHealth(input) {
  const today = String(input.today || new Date().toISOString().slice(0, 10));
  const project = input.project || {};
  const records = Array.isArray(input.records) ? input.records : [];
  const exceptions = Array.isArray(input.exceptions) ? input.exceptions : [];
  const factors = [];
  const pm = project.projectManager || "Project Manager";
  const superintendent = project.superintendent || "Superintendent";
  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const dueTomorrow = tomorrow.toISOString().slice(0, 10);

  const budget = records.filter((record) => record.type === "Budget" && data(record).selectedForProject !== false);
  const budgetControl = records.find((record) => record.type === "Budget Control");
  const revisedBudget = budget.reduce((sum, record) => sum + number(data(record).originalBudget) + number(data(record).approvedChanges), 0);
  const forecastCost = budget.reduce((sum, record) => {
    const row = data(record);
    return sum + (number(row.forecastCost) || Math.max(number(row.actualCost), number(row.committedCost)) + number(row.approvedChanges));
  }, 0);
  const committedCost = budget.reduce((sum, record) => sum + number(data(record).committedCost), 0);
  const forecastCandidate = input.financialForecast && typeof input.financialForecast === "object" ? input.financialForecast : null;
  const financialForecast = forecastCandidate && ["Accounting Reviewed", "Owner Approved", "Locked"].includes(String(forecastCandidate.status || "")) ? forecastCandidate : null;
  const forecastProfitCents = financialForecast ? number(financialForecast.forecastProfitCents) : null;
  const forecastMarginBasisPoints = financialForecast ? number(financialForecast.projectedMarginBasisPoints) : null;
  if (forecastProfitCents !== null && forecastProfitCents <= 0) {
    addFactor(factors, exceptions, factor("financial-project-loss", "Financial", 25, "Project is forecast to lose money", `The latest ${financialForecast.periodId || "current"} WIP forecast shows ${Math.abs(forecastProfitCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 })} of projected loss.`, "Publish the PM recovery plan now; Accounting reconciles job cost, commitments, billing, and forecast inputs before the decision is closed.", pm, today, true), today);
  } else if (forecastMarginBasisPoints !== null && forecastMarginBasisPoints < PROJECT_PROFITABILITY_FLOOR_BASIS_POINTS) {
    addFactor(factors, exceptions, factor("financial-project-loss", "Financial", 8, "Forecast margin is below the company floor", `The latest WIP forecast is ${(forecastMarginBasisPoints / 100).toFixed(1)}% gross margin against the ${(PROJECT_PROFITABILITY_FLOOR_BASIS_POINTS / 100).toFixed(0)}% company floor.`, "Document the PM margin-recovery action and the Accounting cost reconciliation before the next forecast review.", pm, dueTomorrow), today);
  }
  const overrun = Math.max(0, forecastCost - revisedBudget);
  const overrunThreshold = revisedBudget > 0 ? Math.min(revisedBudget * 0.01, 25_000) : 0;
  if (!budget.length || revisedBudget <= 0 || data(budgetControl).locked !== true) {
    addFactor(factors, exceptions, factor("financial-budget-control", "Financial", 10, "Budget control is incomplete", "The original project budget is not both positive and locked, so forecast reliability cannot be confirmed.", "Complete and lock the original budget, then review every forecast line.", pm, dueTomorrow), today);
  }
  if (revisedBudget > 0 && overrun > overrunThreshold) {
    addFactor(factors, exceptions, factor("financial-projected-overrun", "Financial", 15, "Projected cost exceeds the Red threshold", `Forecast is ${Math.round(overrun)} above revised budget; the critical threshold is ${Math.round(overrunThreshold)}.`, "Prepare a recovery plan and route required budget or change action through its existing approval workflow.", pm, today, true), today);
  } else if (overrun > 0) {
    addFactor(factors, exceptions, factor("financial-projected-overrun", "Financial", 6, "Forecast is above revised budget", `Projected cost is ${Math.round(overrun)} above the revised budget but has not crossed the critical threshold.`, "Review forecast exposure and document the recovery plan.", pm, dueTomorrow), today);
  }
  const projectElapsed = Math.max(0, daysBetween(project.startDate, today));
  const projectDuration = Math.max(1, daysBetween(project.startDate, project.finalDate));
  if (revisedBudget > 0 && projectElapsed / projectDuration >= 0.25 && committedCost / revisedBudget < 0.5) {
    addFactor(factors, exceptions, factor("financial-budget-control", "Financial", 4, "Buyout coverage is trailing project time", "Less than half of the revised budget is committed after at least one quarter of the contract duration.", "Review uncommitted buyout and assign remaining procurement packages.", pm, dueTomorrow), today);
  }
  const openChanges = records.filter((record) => record.type === "Change Orders" && !isClosed(record));
  const changeExposure = openChanges.reduce((sum, record) => sum + Math.abs(number(data(record).approvedTotal || data(record).amount || data(record).estimatedAmount)), 0);
  if (changeExposure > Math.max(10_000, number(project.currentContractAmount || project.contractAmount) * 0.02)) {
    addFactor(factors, exceptions, factor("financial-budget-control", "Financial", 3, "Open change exposure needs resolution", `${openChanges.length} unresolved change item(s) represent material cost exposure.`, "Price, approve, reject, or formally carry each change exposure.", pm, dueTomorrow), today);
  }

  const schedule = records.filter((record) => record.type === "Schedule");
  if (!schedule.length) {
    addFactor(factors, exceptions, factor("schedule-current-baseline", "Schedule", 12, "No measurable project schedule", "No schedule activities are available for progress and completion analysis.", "Create or import the current baseline schedule.", pm, today), today);
  } else {
    const overdue = schedule.filter((record) => {
      const row = data(record);
      const finish = String(row.finish || row.end || record.due || "").slice(0, 10);
      return finish && finish < today && number(row.progress) < 100;
    });
    if (overdue.length) addFactor(factors, exceptions, factor("schedule-current-baseline", "Schedule", Math.min(10, 3 + overdue.length * 2), `${overdue.length} schedule activit${overdue.length === 1 ? "y is" : "ies are"} overdue`, "Past-due activities remain below 100% complete.", "Update actual progress and publish a recovery sequence for each late activity.", pm, today), today);
    const expected = Math.min(100, Math.max(0, (projectElapsed / projectDuration) * 100));
    const actual = schedule.reduce((sum, record) => sum + number(data(record).progress), 0) / schedule.length;
    if (expected - actual > 10) addFactor(factors, exceptions, factor("schedule-current-baseline", "Schedule", Math.min(8, Math.ceil((expected - actual) / 8)), "Reported progress trails elapsed contract time", `Average activity progress trails elapsed contract time by ${Math.round(expected - actual)} points.`, "Validate progress, critical path, and recovery ownership with the field team.", pm, dueTomorrow), today);
  }
  if (project.status !== "Completed" && project.finalDate && String(project.finalDate) < today) {
    addFactor(factors, exceptions, factor("schedule-final-completion", "Schedule", 25, "Final completion is overdue", `Contract final completion was ${project.finalDate} and the project is not marked complete.`, "Establish an approved recovery plan and updated completion commitment.", pm, today, true), today);
  }

  const safetyRecords = records.filter((record) => ["Safety Incidents", "Safety", "Daily Logs"].includes(record.type));
  const openIncident = safetyRecords.find((record) => {
    const row = data(record);
    return (row.incidentReported === true || /incident|critical|stop work/i.test(`${record.title || ""} ${record.status || ""}`)) && row.incidentResolved !== true && !isClosed(record);
  });
  if (openIncident) addFactor(factors, exceptions, factor("safety-critical-condition", "Safety", 15, "Critical safety condition is unresolved", `${openIncident.id || openIncident.title || "A safety record"} requires documented resolution.`, "Secure the condition, complete the incident workflow, and document corrective action.", superintendent, today, true), today);
  const overdueSafety = records.filter((record) => ["Toolbox Talks", "Safety"].includes(record.type) && !isClosed(record) && record.due && String(record.due).slice(0, 10) < today);
  if (overdueSafety.length && !openIncident) addFactor(factors, exceptions, factor("safety-critical-condition", "Safety", Math.min(7, overdueSafety.length * 2), "Safety actions are overdue", `${overdueSafety.length} required safety action(s) are past due.`, "Complete the required safety action and signatures.", superintendent, today), today);

  const quality = records.filter((record) => ["Quality Items", "Quality Inspections"].includes(record.type));
  const openQuality = quality.filter((record) => !isClosed(record));
  const overdueQuality = openQuality.filter((record) => record.due && String(record.due).slice(0, 10) < today);
  const failedInspections = quality.filter((record) => /failed|unsatisfactory|follow-up/i.test(String(record.status || "")));
  if (openQuality.length) addFactor(factors, exceptions, factor("quality-open-deficiencies", "Quality", Math.min(7, 2 + openQuality.length), `${openQuality.length} quality item${openQuality.length === 1 ? " remains" : "s remain"} open`, `${overdueQuality.length} are overdue and ${failedInspections.length} involve failed or follow-up inspection work.`, "Correct, verify, and obtain PM/designer acceptance where required.", superintendent, overdueQuality.length ? today : dueTomorrow), today);

  const overdueControls = records.filter((record) => ["RFIs", "Submittals"].includes(record.type) && !isClosed(record) && record.due && String(record.due).slice(0, 10) < today);
  if (overdueControls.length) addFactor(factors, exceptions, factor("controls-overdue-work", "Project Controls", Math.min(7, 2 + overdueControls.length), `${overdueControls.length} RFI or submittal action${overdueControls.length === 1 ? " is" : "s are"} overdue`, "Open project correspondence has passed its required response date.", "Advance the response, document the delay, and escalate after 24 hours.", pm, today), today);
  const missingCategories = schedule.filter((record) => !String(data(record).qualityCategoryId || "").trim());
  if (missingCategories.length) addFactor(factors, exceptions, factor("controls-overdue-work", "Project Controls", Math.min(3, missingCategories.length), "Schedule quality categories are incomplete", `${missingCategories.length} schedule activit${missingCategories.length === 1 ? "y has" : "ies have"} no controlling quality category.`, "Assign a required quality category so pre-work prompts can be generated.", superintendent, dueTomorrow), today);
  const recentCutoff = new Date(`${today}T12:00:00Z`); recentCutoff.setUTCDate(recentCutoff.getUTCDate() - 7);
  const dailyLogs = records.filter((record) => record.type === "Daily Logs" && String(record.recordDate || "") >= recentCutoff.toISOString().slice(0, 10));
  if (project.startDate <= today && project.status === "Active" && !dailyLogs.length) addFactor(factors, exceptions, factor("controls-overdue-work", "Project Controls", 3, "Recent daily-log coverage is missing", "No daily log is recorded in the last seven days for an active project.", "Complete the current daily log and document any non-working days.", superintendent, today), today);

  const blockedVendors = (input.vendorCompliance || []).filter((item) => item.blocked);
  if (blockedVendors.length) addFactor(factors, exceptions, factor("vendor-compliance", "Vendor / Procurement", 2, "Assigned vendor payment readiness needs attention", `${blockedVendors.map((item) => item.name).join(", ")} may continue bidding, award, contracting, access, and project work; payment remains held until compliance is current or temporarily approved.`, "Resolve missing or expired compliance before payment approval.", pm, today, false), today);
  const bidPackages = records.filter((record) => record.type === "Bid Packages" && !isClosed(record));
  const uncovered = bidPackages.filter((record) => {
    const row = data(record);
    const bidders = Array.isArray(row.bidders) ? row.bidders : [];
    const received = bidders.filter((bidder) => Array.isArray(bidder?.revisions) && bidder.revisions.length).length;
    return received < 3 && row.coverageExceptionApproved !== true;
  });
  if (uncovered.length) addFactor(factors, exceptions, factor("procurement-bid-coverage", "Vendor / Procurement", Math.min(6, 2 + uncovered.length), "Bid coverage is below the Mefford target", `${uncovered.length} open bid package(s) have fewer than three received bids without an approved exception.`, "Invite additional bidders or route a documented coverage exception to the Owner.", pm, dueTomorrow), today);

  const closeoutRequirements = records.filter((record) => record.type === "Closeout Requirements");
  const legacyCloseout = records.filter((record) => record.type === "Closeout" && !isClosed(record));
  const atSubstantial = Boolean(project.substantialDate && String(project.substantialDate) <= today);
  const approachingSubstantial = Boolean(project.substantialDate && daysBetween(today, project.substantialDate) <= 30);
  const closeoutPunch = openQuality.filter((record) => data(record).closeoutTracking === true || atSubstantial);
  const closeoutWindow = expectedCloseout(project.finalDate, today);
  if (closeoutRequirements.length && closeoutWindow.active) {
    const applicable = closeoutRequirements.filter((record) => record.status !== "Not Applicable");
    const totalWeight = applicable.reduce((sum, record) => sum + Math.max(1, number(data(record).weight) || 1), 0);
    const earnedWeight = applicable.reduce((sum, record) => sum + Math.max(1, number(data(record).weight) || 1) * closeoutCredit(record) / 100, 0);
    const actualProgress = totalWeight ? Math.round((earnedWeight / totalWeight) * 100) : 0;
    const healthEarned = closeoutWindow.expected > 0 ? Math.min(5, Math.max(0, 5 * actualProgress / closeoutWindow.expected)) : 5;
    const deduction = Math.round((5 - healthEarned) * 10) / 10;
    if (deduction > 0) {
      const criticalOpen = applicable.filter((record) => data(record).critical === true && !isClosed(record)).length;
      addFactor(factors, exceptions, factor("closeout-readiness", "Closeout", deduction, "Closeout progress trails the required completion curve", `Weighted closeout is ${actualProgress}% complete against ${closeoutWindow.expected}% expected with ${closeoutWindow.remaining} day(s) remaining. ${criticalOpen} higher-weight inspection, O&M, warranty, permit, lien, financial, or acceptance requirement(s) remain open.`, "Advance the next visible approval gate for the highest-weight open requirements.", pm, dueTomorrow), today);
    }
  } else if ((atSubstantial || approachingSubstantial) && (legacyCloseout.length || closeoutPunch.length)) {
    addFactor(factors, exceptions, factor("closeout-readiness", "Closeout", Math.min(5, 1 + legacyCloseout.length + closeoutPunch.length), "Closeout readiness has open requirements", `${legacyCloseout.length} closeout record(s) and ${closeoutPunch.length} final punch item(s) remain open.`, "Assign and approve required closeout documents before final payment.", pm, dueTomorrow), today);
  }

  for (const rule of Array.isArray(input.customRules) ? input.customRules : []) {
    if (rule.enabled === false || !PROJECT_HEALTH_WEIGHTS[rule.category]) continue;
    const matching = records.filter((record) => {
      if (rule.recordType && record.type !== rule.recordType) return false;
      if (rule.statusIncludes && !String(record.status || "").toLowerCase().includes(String(rule.statusIncludes).toLowerCase())) return false;
      if (rule.overdueOnly && (!record.due || String(record.due).slice(0, 10) >= today || isClosed(record))) return false;
      return true;
    });
    if (!matching.length) continue;
    addFactor(factors, exceptions, {
      id: rule.id,
      ruleId: rule.id,
      category: rule.category,
      deduction: Math.min(number(rule.deduction) || 1, PROJECT_HEALTH_WEIGHTS[rule.category]),
      title: rule.name,
      explanation: `${rule.description} ${matching.length} matching record(s) currently trigger this company rule.`,
      action: rule.action || "Review the triggering records and document resolution.",
      owner: rule.targetRole === "Superintendent" ? superintendent : pm,
      due: today,
      critical: false,
      protected: false,
      exceptionActive: false,
    }, today);
  }

  const categories = Object.keys(PROJECT_HEALTH_WEIGHTS).map((category) => finishCategory(category, factors));
  const numericScore = Math.max(0, Math.round(categories.reduce((sum, category) => sum + category.earned, 0)));
  const criticalTriggers = factors.filter((item) => item.critical && !item.exceptionActive);
  const color = criticalTriggers.length ? "Red" : numericScore >= PROJECT_HEALTH_BANDS.green ? "Green" : numericScore >= PROJECT_HEALTH_BANDS.yellow ? "Yellow" : "Red";
  const sortedFactors = [...factors].sort((a, b) => Number(b.critical) - Number(a.critical) || b.deduction - a.deduction || a.title.localeCompare(b.title));
  return {
    score: numericScore,
    color,
    calculatedAt: input.calculatedAt || new Date().toISOString(),
    categories,
    factors: sortedFactors,
    criticalTriggers,
    recommendations: sortedFactors.filter((item) => item.deduction > 0).slice(0, 5).map((item) => ({ id: item.id, title: item.title, explanation: item.explanation, category: item.category, action: item.action, owner: item.owner, due: item.due, priority: item.critical ? "Critical" : item.deduction >= 5 ? "High" : "Normal" })),
    financial: { revisedBudget, forecastCost, committedCost, overrun, overrunThreshold, changeExposure, forecastProfitCents, forecastMarginBasisPoints, forecastPeriodId: financialForecast?.periodId || "" },
  };
}
