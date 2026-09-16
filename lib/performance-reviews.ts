export const PERFORMANCE_PROJECT_ID = "MEFFORD-PERFORMANCE";
export const PERFORMANCE_REVIEW_TYPE = "Employee Performance Quarterly Review";
export const PERFORMANCE_METRIC_TYPE = "Employee Performance Metric Definition";
export const CUSTOMER_SURVEY_REQUEST_TYPE = "Marketing Customer Survey Request";
export const CUSTOMER_SURVEY_RESPONSE_TYPE = "Marketing Customer Survey Response";

export type PerformanceEmployee = {
  email: string;
  name: string;
  accessLevel: string;
  designations: string[];
  active: boolean;
};

export type PerformanceProject = {
  number: string;
  name: string;
  status: string;
  startDate: string;
  substantialDate: string;
  finalDate: string;
  contractAmount: number;
  currentContractAmount: number;
  projectManager: string;
  superintendent: string;
};

export type PerformanceRecord = {
  projectId: string;
  id: string;
  type: string;
  title: string;
  owner: string;
  due: string;
  status: string;
  meta?: string;
  recordDate: string;
  createdAt: string;
  updatedAt: string;
  data: Record<string, unknown>;
};

export type PerformanceWorkItem = {
  id: string;
  recipientEmail: string;
  dueAt: string;
  status: string;
  completedAt: string;
  sourceType: string;
  sourceRecordId: string;
  createdAt: string;
};

export type PerformanceMeeting = {
  occurrenceId: string;
  projectId: string;
  meetingType: string;
  scheduledStart: string;
  status: string;
  attendeeEmail: string;
  attendanceStatus: string;
  actionAssigneeEmail: string;
  actionStatus: string;
  actionDueAt: string;
  actionCompletedAt: string;
  sourceId?: string;
};

export type PerformanceScheduledRun = {
  id: string;
  jobName: string;
  scheduledAt: string;
  completedAt: string;
  status: string;
  attempts: number;
  durationMs: number;
  error: string;
};

export type PerformanceMetric = {
  key: string;
  label: string;
  category: string;
  weight: number;
  score: number | null;
  confidence: "High" | "Medium" | "Low" | "Insufficient";
  evidenceCount: number;
  detail: string;
  sourceIds: string[];
  policy: string;
};

export type PerformanceScorecard = {
  employee: PerformanceEmployee;
  quarter: string;
  periodStart: string;
  periodEnd: string;
  systemScore: number | null;
  grade: string;
  evidenceCoverage: number;
  metrics: PerformanceMetric[];
  assignedProjects: Array<{ number: string; name: string; role: string }>;
  evidenceGaps: string[];
  generatedAt: string;
  policy: string;
};

export const PERFORMANCE_GOVERNANCE = {
  visibility: "Company Owners Only",
  finalAuthority: "A Company Owner reviews, calibrates with a written reason, and signs the quarterly review.",
  aiBoundary: "ChatGPT drafts evidence-based narrative and coaching questions only. It cannot alter scores, sign a review, or make an employment decision.",
  fairness: "Protected traits, private medical or benefits information, raw screen time, message volume, and activity for activity's sake are excluded.",
  missingData: "Missing evidence is labeled as insufficient and is not silently scored as failure.",
} as const;

export const PERFORMANCE_METRIC_LIBRARY = [
  { key: "onboarding", label: "Onboarding & Required Training", category: "Process & Development", roles: ["All"], description: "Completed required onboarding, annual acknowledgements, and assigned training." },
  { key: "work-reliability", label: "Assigned Work Timeliness", category: "Reliability", roles: ["All"], description: "Completed owned Command Center work by its recorded due time." },
  { key: "meeting-accountability", label: "Meeting Attendance & Commitments", category: "Reliability", roles: ["All"], description: "Attended required meetings and completed meeting commitments on time." },
  { key: "customer-voice", label: "Customer Satisfaction", category: "Customer & Team", roles: ["All"], description: "Verified customer ratings connected to the employee's project or preconstruction team." },
  { key: "project-health", label: "Assigned Project Health", category: "Company Results", roles: ["Project Manager", "Superintendent"], description: "Quarterly average of the controlled health score for assigned projects." },
  { key: "daily-logs", label: "Daily Log Coverage & Timeliness", category: "Field Execution", roles: ["Superintendent"], description: "Working-day daily log coverage and next-day finalization." },
  { key: "toolbox-talks", label: "Toolbox Talk Cadence", category: "Safety", roles: ["Superintendent", "Safety Director"], description: "Weekly toolbox talks with permanent signature evidence." },
  { key: "field-safety", label: "Safety & Visitor Controls", category: "Safety", roles: ["Superintendent", "Safety Director"], description: "Safety health, incident closure, toolbox signatures, and visitor-waiver evidence." },
  { key: "field-schedule", label: "Schedule Adherence", category: "Schedule & Delivery", roles: ["Superintendent"], description: "Controlled schedule-category health on assigned projects." },
  { key: "field-quality", label: "Quality & Closeout Follow-Through", category: "Schedule & Delivery", roles: ["Superintendent"], description: "Quality and closeout health on assigned projects." },
  { key: "pm-budget", label: "Budget & Forecast Adherence", category: "Financial & Profitability", roles: ["Project Manager"], description: "Forecast performance against the locked revised budget." },
  { key: "pm-buyout", label: "Buyout Coverage", category: "Financial & Profitability", roles: ["Project Manager"], description: "Committed cost coverage at the point in the project when buyout should be established." },
  { key: "pm-controls", label: "RFI, Submittal & Change Control", category: "Process & Development", roles: ["Project Manager"], description: "Timely resolution of project controls and open exposure." },
  { key: "pm-meetings", label: "Required Project Meetings", category: "Customer & Team", roles: ["Project Manager"], description: "Required owner, design, and subcontractor meetings actually held and finalized." },
  { key: "accounting-ar", label: "AR Posting Timeliness", category: "Reliability", roles: ["Accountant", "Financial Administrator", "Accounting Manager"], description: "Owner billings and AR invoices posted within the controlled billing timeline." },
  { key: "accounting-collections", label: "Collections Timeliness", category: "Financial & Profitability", roles: ["Accountant", "Financial Administrator", "Accounting Manager"], description: "Verified receipts and collection cycle time without guessing unrecorded payments." },
  { key: "accounting-ap", label: "AP Processing & Accuracy", category: "Reliability", roles: ["Accountant", "Financial Administrator", "Accounting Manager"], description: "Invoices coded and advanced before due dates without duplicate or correction exceptions." },
  { key: "accounting-close", label: "Reconciliation & Month-End Close", category: "Financial & Profitability", roles: ["Accountant", "Financial Administrator", "Accounting Manager"], description: "Bank reconciliation, WIP, journal, and close-period evidence completed on schedule." },
  { key: "estimating-win", label: "Estimating Win Rate", category: "Company Results", roles: ["Estimator", "Estimating Manager"], description: "Awarded estimates divided by final awarded and lost estimate decisions." },
  { key: "estimating-timeliness", label: "Bid Submission Timeliness", category: "Reliability", roles: ["Estimator", "Estimating Manager"], description: "Proposal submissions recorded by the promised bid date." },
  { key: "estimating-coverage", label: "Bid Coverage & Scope Control", category: "Process & Development", roles: ["Estimator", "Estimating Manager"], description: "Bid packages with target coverage or an approved documented exception." },
  { key: "estimating-handoff", label: "Award & Project Handoff Quality", category: "Customer & Team", roles: ["Estimator", "Estimating Manager"], description: "Awarded estimates carried into a complete controlled project handoff." },
  { key: "sales-goal", label: "Sales Goal Attainment", category: "Company Results", roles: ["Sales Representative", "Sales Manager"], description: "Signed or awarded value against the employee's quarterly share of the approved annual goal." },
  { key: "sales-conversion", label: "Opportunity Conversion", category: "Company Results", roles: ["Sales Representative", "Sales Manager"], description: "Won opportunities divided by final won and lost decisions." },
  { key: "sales-followup", label: "Pipeline Follow-Through", category: "Reliability", roles: ["Sales Representative", "Sales Manager"], description: "Open opportunities with a current recorded next action and follow-up date." },
  { key: "it-uptime", label: "Platform & Connection Uptime", category: "IT Service", roles: ["IT Administrator"], description: "Daily platform and connection health snapshots. Provider-caused downtime is identified separately from Mefford-controlled uptime." },
  { key: "it-incidents", label: "Incident Response & Recovery", category: "IT Service", roles: ["IT Administrator"], description: "Acknowledgement, temporary operating guidance, reconciliation, resolution time, and root-cause follow-through. External provider duration is reported but not treated as employee-controlled downtime." },
  { key: "it-automation", label: "Automation Reliability", category: "IT Service", roles: ["IT Administrator"], description: "Successful scheduled operations, safe retries, and documented recovery from failures." },
  { key: "it-maintenance", label: "Maintenance & Change Control", category: "IT Service", roles: ["IT Administrator"], description: "Scheduled windows completed with restoration verification, user notice when needed, and permanent change evidence." },
] as const;

const WEIGHTS: Record<string, number> = {
  onboarding: 8,
  "work-reliability": 12,
  "meeting-accountability": 8,
  "customer-voice": 12,
  "project-health": 15,
  "daily-logs": 15,
  "toolbox-talks": 10,
  "field-safety": 15,
  "field-schedule": 15,
  "field-quality": 10,
  "pm-budget": 20,
  "pm-buyout": 15,
  "pm-controls": 12,
  "pm-meetings": 10,
  "accounting-ar": 20,
  "accounting-collections": 20,
  "accounting-ap": 15,
  "accounting-close": 15,
  "estimating-win": 25,
  "estimating-timeliness": 20,
  "estimating-coverage": 15,
  "estimating-handoff": 15,
  "sales-goal": 25,
  "sales-conversion": 20,
  "sales-followup": 15,
  "it-uptime": 25,
  "it-incidents": 30,
  "it-automation": 25,
  "it-maintenance": 20,
};

export function currentPerformanceQuarter(now = new Date()) {
  return `${now.getUTCFullYear()}-Q${Math.floor(now.getUTCMonth() / 3) + 1}`;
}

export function performanceQuarterRange(quarter: string) {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarter);
  if (!match) throw new Error("Choose A Valid Quarter Such As 2026-Q3");
  const year = Number(match[1]);
  const index = Number(match[2]) - 1;
  const start = new Date(Date.UTC(year, index * 3, 1));
  const end = new Date(Date.UTC(year, index * 3 + 3, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function performanceReviewId(email: string, quarter: string) {
  return `PERF-${quarter}-${email.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`.slice(0, 160);
}

export function buildPerformanceScorecards(input: {
  quarter: string;
  employees: PerformanceEmployee[];
  projects: PerformanceProject[];
  records: PerformanceRecord[];
  workItems: PerformanceWorkItem[];
  meetings: PerformanceMeeting[];
  scheduledRuns?: PerformanceScheduledRun[];
  now?: string;
}) {
  const now = input.now || new Date().toISOString();
  const quarterRange = performanceQuarterRange(input.quarter);
  const range = { ...quarterRange, end: minDate(quarterRange.end, now.slice(0, 10)) };
  return input.employees.filter((employee) => employee.active).map((employee) => scoreEmployee(employee, input, range, now));
}

function scoreEmployee(employee: PerformanceEmployee, input: Parameters<typeof buildPerformanceScorecards>[0], range: { start: string; end: string }, now: string): PerformanceScorecard {
  const email = employee.email.toLowerCase();
  const name = employee.name.toLowerCase();
  const roles = new Set(employee.designations);
  const assigned = input.projects.flatMap((project) => {
    const matches: string[] = [];
    if (project.projectManager.trim().toLowerCase() === name) matches.push("Project Manager");
    if (project.superintendent.trim().toLowerCase() === name) matches.push("Superintendent");
    return matches.length ? [{ project, roles: matches }] : [];
  });
  const assignedIds = new Set(assigned.map((item) => item.project.number));
  const periodRecords = input.records.filter((record) => inPeriod(record.recordDate || record.updatedAt, range));
  const metrics: PerformanceMetric[] = [];

  const onboarding = input.records.filter((record) => record.type === "Employee Onboarding" && referencesEmployee(record.data, email, name));
  const onboardingRow = onboarding.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const onboardingProgress = number(onboardingRow?.data.progress ?? onboardingRow?.data.completionPercent ?? (/complete|active|ready/i.test(onboardingRow?.status || "") ? 100 : 0));
  metrics.push(metric("onboarding", onboardingRow ? clamp(onboardingProgress) : null, onboardingRow ? 1 : 0, onboardingRow ? `${Math.round(clamp(onboardingProgress))}% of the controlled onboarding and annual requirements are recorded complete.` : "No matching onboarding evidence is available yet.", onboardingRow ? [source(onboardingRow)] : []));

  const work = input.workItems.filter((item) => item.recipientEmail.toLowerCase() === email && inPeriod(item.dueAt || item.createdAt, range));
  metrics.push(rateMetric("work-reliability", work, (item) => /completed/i.test(item.status) && (!item.dueAt || !item.completedAt || item.completedAt <= item.dueAt), `${work.filter((item) => /completed/i.test(item.status)).length} of ${work.length} assigned items are recorded complete; the score uses on-time completion.`));

  const meetingRows = input.meetings.filter((item) => inPeriod(item.scheduledStart, range) && (item.attendeeEmail.toLowerCase() === email || item.actionAssigneeEmail.toLowerCase() === email));
  const attendanceRows = uniqueBy(meetingRows.filter((item) => item.attendeeEmail.toLowerCase() === email), (item) => item.occurrenceId);
  const actionRows = uniqueBy(meetingRows.filter((item) => item.actionAssigneeEmail.toLowerCase() === email), (item) => `${item.occurrenceId}:${item.actionDueAt}:${item.sourceId || ""}`);
  const meetingParts = [
    ...attendanceRows.map((item) => /attended|present|confirmed/i.test(item.attendanceStatus)),
    ...actionRows.map((item) => /complete/i.test(item.actionStatus) && (!item.actionDueAt || !item.actionCompletedAt || item.actionCompletedAt <= item.actionDueAt)),
  ];
  metrics.push(metric("meeting-accountability", meetingParts.length ? percent(meetingParts.filter(Boolean).length, meetingParts.length) : null, meetingParts.length, meetingParts.length ? `${attendanceRows.length} required attendance record(s) and ${actionRows.length} assigned meeting commitment(s) were evaluated.` : "No required attendance or meeting commitment evidence falls in this quarter.", meetingRows.map((item) => `MEETING:${item.occurrenceId}`)));

  const surveys = periodRecords.filter((record) => record.type === CUSTOMER_SURVEY_RESPONSE_TYPE && (assignedIds.has(record.projectId) || assignedIds.has(String(record.data.projectId || "")) || referencesEmployee(record.data, email, name)));
  const surveyScores = surveys.map((record) => surveyRating(record.data)).filter((value): value is number => value !== null);
  metrics.push(metric("customer-voice", surveyScores.length ? average(surveyScores) * 20 : null, surveyScores.length, surveyScores.length ? `${surveyScores.length} verified customer response(s) average ${(average(surveyScores)).toFixed(1)} out of 5.` : "No customer survey response is linked to this employee's work for the quarter.", surveys.map(source)));

  const healthRows = input.records.filter((record) => record.type === "Project Health Daily Snapshots" && assignedIds.has(record.projectId) && inPeriod(record.recordDate || record.updatedAt, range));
  const healthScores = healthRows.map((record) => number(record.data.score ?? record.data.healthScore)).filter((value) => value > 0);
  if (roles.has("Project Manager") || roles.has("Superintendent") || assigned.length) metrics.push(metric("project-health", healthScores.length ? average(healthScores) : null, healthScores.length, healthScores.length ? `${healthScores.length} assigned project health snapshot(s) average ${Math.round(average(healthScores))}.` : "No quarterly project-health snapshot exists for the assigned projects yet.", healthRows.map(source)));

  if (roles.has("Superintendent") || roles.has("Safety Director") || assigned.some((item) => item.roles.includes("Superintendent"))) {
    addSuperintendentMetrics(metrics, assigned.map((item) => item.project), input.records, range);
  }
  if (roles.has("Project Manager") || assigned.some((item) => item.roles.includes("Project Manager"))) {
    addProjectManagerMetrics(metrics, assigned.map((item) => item.project), input.records, input.meetings, range, email);
  }
  if (roles.has("Accountant") || roles.has("Financial Administrator") || roles.has("Accounting Manager")) addAccountingMetrics(metrics, employee, input.records, range, roles.has("Accounting Manager"));
  if (roles.has("Estimator") || roles.has("Estimating Manager")) addEstimatingMetrics(metrics, employee, input.records, range, roles.has("Estimating Manager"));
  if (roles.has("Sales Representative") || roles.has("Sales Manager")) addSalesMetrics(metrics, employee, input.records, range, roles.has("Sales Manager"));
  if (roles.has("IT Administrator")) addItMetrics(metrics, employee, input.records, input.scheduledRuns || [], range);

  const uniqueMetrics = uniqueBy(metrics, (item) => item.key);
  const available = uniqueMetrics.filter((item) => item.score !== null);
  const availableWeight = available.reduce((sum, item) => sum + item.weight, 0);
  const plannedWeight = uniqueMetrics.reduce((sum, item) => sum + item.weight, 0);
  const systemScore = availableWeight ? Math.round(available.reduce((sum, item) => sum + (item.score || 0) * item.weight, 0) / availableWeight) : null;
  const evidenceCoverage = plannedWeight ? Math.round(availableWeight / plannedWeight * 100) : 0;
  return {
    employee,
    quarter: input.quarter,
    periodStart: range.start,
    periodEnd: range.end,
    systemScore,
    grade: performanceGrade(systemScore, evidenceCoverage),
    evidenceCoverage,
    metrics: uniqueMetrics,
    assignedProjects: assigned.map((item) => ({ number: item.project.number, name: item.project.name, role: item.roles.join(" + ") })),
    evidenceGaps: uniqueMetrics.filter((item) => item.score === null).map((item) => `${item.label}: ${item.detail}`),
    generatedAt: now,
    policy: "Evidence-based owner review draft. Missing evidence is not a failing score, and the system score is never overwritten by owner calibration.",
  };
}

function addSuperintendentMetrics(metrics: PerformanceMetric[], projects: PerformanceProject[], records: PerformanceRecord[], range: { start: string; end: string }) {
  const ids = new Set(projects.map((project) => project.number));
  const logs = records.filter((record) => ids.has(record.projectId) && record.type === "Daily Logs" && inPeriod(record.recordDate, range));
  const expectedDays = projects.reduce((total, project) => total + weekdaysBetween(maxDate(project.startDate, range.start), minDate(project.finalDate || range.end, range.end)), 0);
  const logDays = new Set(logs.map((record) => `${record.projectId}:${record.recordDate}`)).size;
  const onTime = logs.filter((record) => !record.createdAt || !record.recordDate || record.createdAt.slice(0, 10) <= addDays(record.recordDate, 1)).length;
  const coverage = expectedDays ? Math.min(100, percent(logDays, expectedDays)) : null;
  const timeliness = logs.length ? percent(onTime, logs.length) : null;
  const logScore = coverage === null ? null : timeliness === null ? coverage : Math.round(coverage * 0.7 + timeliness * 0.3);
  metrics.push(metric("daily-logs", logScore, logs.length, expectedDays ? `${logDays} of ${expectedDays} expected active-project weekdays have a daily log; ${onTime} of ${logs.length} logs were finalized no later than the next day.` : "No active assigned project days fall in this quarter.", logs.map(source)));

  const talks = records.filter((record) => ids.has(record.projectId) && record.type === "Toolbox Talks" && inPeriod(record.recordDate, range));
  const expectedWeeks = Math.ceil(expectedDays / 5);
  const signedTalks = talks.filter((record) => Array.isArray(record.data.signedAttendees) ? record.data.signedAttendees.length > 0 : /complete|signed/i.test(record.status)).length;
  const talkCoverage = expectedWeeks ? Math.min(100, percent(talks.length, expectedWeeks)) : null;
  const talkScore = talkCoverage === null ? null : Math.round(talkCoverage * 0.7 + (talks.length ? percent(signedTalks, talks.length) : 0) * 0.3);
  metrics.push(metric("toolbox-talks", talkScore, talks.length, expectedWeeks ? `${talks.length} toolbox talk(s) are recorded across approximately ${expectedWeeks} active-project week(s); ${signedTalks} contain completion or signature evidence.` : "No active assigned project weeks fall in this quarter.", talks.map(source)));

  const health = records.filter((record) => ids.has(record.projectId) && record.type === "Project Health Daily Snapshots" && inPeriod(record.recordDate || record.updatedAt, range));
  for (const [key, label, categories] of [["field-schedule", "schedule", ["Schedule"]], ["field-safety", "safety", ["Safety"]], ["field-quality", "quality and closeout", ["Quality", "Closeout"]]] as const) {
    const scores = health.flatMap((record) => categoryScores(record.data, categories));
    const related = records.filter((record) => ids.has(record.projectId) && inPeriod(record.recordDate || record.updatedAt, range) && (key !== "field-safety" || ["Safety Incidents", "Visitor Waivers", "Toolbox Talks"].includes(record.type)));
    const visitorTraffic = records.filter((record) => ids.has(record.projectId) && record.type === "Daily Logs" && inPeriod(record.recordDate, range)).reduce((sum, record) => sum + number(record.data.visitorCount), 0);
    const waivers = records.filter((record) => ids.has(record.projectId) && record.type === "Visitor Waivers" && inPeriod(record.recordDate, range));
    const visitorNote = key === "field-safety" ? (visitorTraffic ? ` ${waivers.length} signed waiver(s) are recorded for ${visitorTraffic} logged visitor(s).` : " Visitor compliance is shown as an evidence gap until daily logs record a visitor count denominator.") : "";
    metrics.push(metric(key, scores.length ? average(scores) : null, scores.length || related.length, scores.length ? `Assigned project ${label} health averages ${Math.round(average(scores))}.${visitorNote}` : `No scored ${label} health snapshot is available.${visitorNote}`, [...health.map(source), ...related.slice(0, 20).map(source)]));
  }
}

function addItMetrics(metrics: PerformanceMetric[], employee: PerformanceEmployee, records: PerformanceRecord[], scheduledRuns: PerformanceScheduledRun[], range: { start: string; end: string }) {
  const health = records.filter((record) => record.type === "Integration Health Events" && /daily health snapshot/i.test(record.title) && inPeriod(record.recordDate || record.updatedAt, range));
  const internalHealth = health.filter((record) => String(record.data.integrationKey || "") === "command-center-platform");
  const allHealthy = health.filter((record) => /connected/i.test(record.status));
  const internalHealthy = internalHealth.filter((record) => /connected/i.test(record.status));
  const providerUnhealthy = health.filter((record) => String(record.data.integrationKey || "") !== "command-center-platform" && !/connected/i.test(record.status));
  const uptimeScore = internalHealth.length ? percent(internalHealthy.length, internalHealth.length) : health.length ? percent(allHealthy.length, health.length) : null;
  metrics.push(metric(
    "it-uptime",
    uptimeScore,
    health.length,
    health.length
      ? `${internalHealthy.length} of ${internalHealth.length || 0} Command Center daily snapshot(s) were healthy. ${providerUnhealthy.length} provider-degraded snapshot(s) are reported separately and do not count as Mefford-controlled downtime.`
      : "No daily platform or connection health snapshots fall in this quarter yet.",
    health.map(source),
  ));

  const incidents = records.filter((record) => record.type === "Integration Provider Incidents" && inPeriod(String(record.data.openedAt || record.recordDate || record.updatedAt), range));
  const ownedIncidents = incidents.filter((record) => referencesEmployee(record.data, employee.email.toLowerCase(), employee.name.toLowerCase()) || record.owner.toLowerCase() === employee.name.toLowerCase());
  const evaluatedIncidents = ownedIncidents.length ? ownedIncidents : incidents;
  const incidentParts = evaluatedIncidents.flatMap((record) => {
    const openedAt = String(record.data.openedAt || record.createdAt || "");
    const acknowledgedAt = String(record.data.acknowledgedAt || "");
    const closedAt = String(record.data.closedAt || "");
    const internal = String(record.data.integrationKey || "") === "command-center-platform";
    const responseMinutes = minutesBetween(openedAt, acknowledgedAt);
    const resolutionMinutes = minutesBetween(openedAt, closedAt);
    const responseScore = responseMinutes === null ? null : responseMinutes <= 15 ? 100 : responseMinutes <= 30 ? 90 : responseMinutes <= 60 ? 75 : responseMinutes <= 240 ? 55 : 25;
    const temporaryGuidance = String(record.data.temporaryInstructions || "").trim().length >= 10 ? 100 : 70;
    const closureEvidence = closedAt && String(record.data.closureNote || "").trim().length >= 10 ? 100 : closedAt ? 75 : 0;
    const resolutionScore = !internal || resolutionMinutes === null ? closureEvidence : resolutionMinutes <= 240 ? 100 : resolutionMinutes <= 480 ? 85 : resolutionMinutes <= 1_440 ? 65 : 40;
    return responseScore === null ? [temporaryGuidance * 0.3 + resolutionScore * 0.7] : [responseScore * 0.4 + temporaryGuidance * 0.2 + resolutionScore * 0.4];
  });
  const responseTimes = evaluatedIncidents.map((record) => minutesBetween(String(record.data.openedAt || record.createdAt || ""), String(record.data.acknowledgedAt || ""))).filter((value): value is number => value !== null);
  const resolutionTimes = evaluatedIncidents.map((record) => minutesBetween(String(record.data.openedAt || record.createdAt || ""), String(record.data.closedAt || ""))).filter((value): value is number => value !== null);
  metrics.push(metric(
    "it-incidents",
    incidentParts.length ? average(incidentParts) : null,
    evaluatedIncidents.length,
    evaluatedIncidents.length
      ? `${evaluatedIncidents.length} incident(s) evaluated. Average acknowledgement ${durationLabel(average(responseTimes))}; average recorded resolution ${durationLabel(average(resolutionTimes))}. Provider outage duration remains visible but is not scored as employee-controlled downtime.`
      : "No IT incident response evidence falls in this quarter.",
    evaluatedIncidents.map(source),
  ));

  const quarterRuns = scheduledRuns.filter((run) => inPeriod(run.scheduledAt, range));
  const succeeded = quarterRuns.filter((run) => run.status === "Succeeded").length;
  const recovered = quarterRuns.filter((run) => run.status === "Succeeded" && run.attempts > 1).length;
  metrics.push(metric(
    "it-automation",
    quarterRuns.length ? percent(succeeded, quarterRuns.length) : null,
    quarterRuns.length,
    quarterRuns.length ? `${succeeded} of ${quarterRuns.length} scheduled operation run(s) succeeded; ${recovered} recovered through an isolated safe retry.` : "No scheduled-operation run evidence falls in this quarter.",
    quarterRuns.map((run) => `SCHEDULED:${run.id}`),
  ));

  const maintenance = records.filter((record) => record.type === "Integration Maintenance Windows" && inPeriod(record.recordDate || record.updatedAt, range));
  metrics.push(rateMetric(
    "it-maintenance",
    maintenance,
    (record) => /complete/i.test(record.status) && String(record.data.completionNote || "").trim().length >= 8,
    `${maintenance.filter((record) => /complete/i.test(record.status)).length} of ${maintenance.length} maintenance window(s) are complete; the score requires restoration verification evidence.`,
  ));
}

function addProjectManagerMetrics(metrics: PerformanceMetric[], projects: PerformanceProject[], records: PerformanceRecord[], meetings: PerformanceMeeting[], range: { start: string; end: string }, email: string) {
  const ids = new Set(projects.map((project) => project.number));
  const budgets = records.filter((record) => ids.has(record.projectId) && record.type === "Budget" && record.data.selectedForProject !== false);
  const revised = budgets.reduce((sum, record) => sum + number(record.data.originalBudget) + number(record.data.approvedChanges), 0);
  const forecast = budgets.reduce((sum, record) => sum + (number(record.data.forecastCost) || Math.max(number(record.data.actualCost), number(record.data.committedCost)) + number(record.data.approvedChanges)), 0);
  const budgetScore = revised > 0 ? clamp(100 - Math.max(0, forecast - revised) / revised * 500) : null;
  metrics.push(metric("pm-budget", budgetScore, budgets.length, revised > 0 ? `Forecast is ${money(forecast)} against a revised budget of ${money(revised)}.` : "A locked revised budget is not available for the assigned projects.", budgets.map(source)));
  const committed = budgets.reduce((sum, record) => sum + number(record.data.committedCost), 0);
  metrics.push(metric("pm-buyout", revised > 0 ? Math.min(100, percent(committed, revised)) : null, budgets.length, revised > 0 ? `${money(committed)} of ${money(revised)} is recorded as committed.` : "Committed-cost and revised-budget evidence is not available.", budgets.map(source)));

  const controls = records.filter((record) => ids.has(record.projectId) && ["RFIs", "Submittals", "Change Orders"].includes(record.type) && inPeriod(record.recordDate || record.updatedAt, range));
  metrics.push(rateMetric("pm-controls", controls, (record) => closed(record.status) && (!record.due || record.updatedAt.slice(0, 10) <= record.due.slice(0, 10)), `${controls.filter((record) => closed(record.status)).length} of ${controls.length} quarterly RFI, submittal, and change records are closed; the score also requires due-date compliance.`));
  const projectMeetings = uniqueBy(meetings.filter((item) => ids.has(item.projectId) && inPeriod(item.scheduledStart, range) && /owner|design|subcontractor/i.test(item.meetingType)), (item) => item.occurrenceId);
  metrics.push(rateMetric("pm-meetings", projectMeetings, (item) => /held|final|complete|distributed/i.test(item.status), `${projectMeetings.filter((item) => /held|final|complete|distributed/i.test(item.status)).length} of ${projectMeetings.length} scheduled required project meetings are recorded held or finalized.`));
  void email;
}

function addAccountingMetrics(metrics: PerformanceMetric[], employee: PerformanceEmployee, records: PerformanceRecord[], range: { start: string; end: string }, departmentWide = false) {
  const accounting = records.filter((record) => inPeriod(record.recordDate || record.updatedAt, range) && (departmentWide || record.owner.toLowerCase() === employee.name.toLowerCase() || referencesEmployee(record.data, employee.email.toLowerCase(), employee.name.toLowerCase())));
  const ar = accounting.filter((record) => ["AR Invoice", "Owner Billing"].includes(record.type));
  metrics.push(rateMetric("accounting-ar", ar, (record) => /posted|sent|approved|paid/i.test(record.status) && (!record.due || record.updatedAt.slice(0, 10) <= record.due.slice(0, 10)), `${ar.filter((record) => /posted|sent|approved|paid/i.test(record.status)).length} of ${ar.length} owned AR or owner-billing records reached a posted, sent, approved, or paid state.`));
  const collectionRecords = accounting.filter((record) => ["Owner Receipt", "AR Invoice"].includes(record.type) && (/paid|posted/i.test(record.status) || record.type === "Owner Receipt"));
  metrics.push(rateMetric("accounting-collections", collectionRecords, (record) => record.type === "Owner Receipt" || number(record.data.balanceRemaining) === 0 || /paid/i.test(record.status), `${collectionRecords.length} verified receipt or closed-balance record(s) are available; unrecorded collections are never assumed.`));
  const ap = accounting.filter((record) => /AP Invoice|Vendor Invoice|Pay Application/i.test(record.type));
  metrics.push(rateMetric("accounting-ap", ap, (record) => !/duplicate|correction|rejected/i.test(`${record.status} ${record.meta || ""}`) && (!record.due || record.updatedAt.slice(0, 10) <= record.due.slice(0, 10)), `${ap.length} owned AP item(s) were checked for due-date and duplicate/correction exceptions.`));
  const close = accounting.filter((record) => /Cash Account|Reconciliation|WIP|Close Period|Journal Entry/i.test(record.type));
  metrics.push(rateMetric("accounting-close", close, (record) => /reconciled|posted|closed|complete|approved/i.test(record.status), `${close.filter((record) => /reconciled|posted|closed|complete|approved/i.test(record.status)).length} of ${close.length} reconciliation, WIP, journal, or close records are complete.`));
}

function addEstimatingMetrics(metrics: PerformanceMetric[], employee: PerformanceEmployee, records: PerformanceRecord[], range: { start: string; end: string }, departmentWide = false) {
  const owned = records.filter((record) => inPeriod(record.recordDate || record.updatedAt, range) && (departmentWide || record.owner.toLowerCase() === employee.name.toLowerCase() || referencesEmployee(record.data, employee.email.toLowerCase(), employee.name.toLowerCase())));
  const decisions = owned.filter((record) => /Estimate|Sales Opportunit/i.test(record.type) && /award|won|lost|declined/i.test(record.status));
  const wins = decisions.filter((record) => /award|won/i.test(record.status)).length;
  metrics.push(metric("estimating-win", decisions.length ? percent(wins, decisions.length) : null, decisions.length, decisions.length ? `${wins} of ${decisions.length} final estimate decisions were awarded.` : "No final awarded-or-lost estimate decisions fall in this quarter.", decisions.map(source)));
  const submitted = owned.filter((record) => /Estimate|Sales Opportunit/i.test(record.type) && /submitted|approved|award|won|lost/i.test(record.status));
  metrics.push(rateMetric("estimating-timeliness", submitted, (record) => !record.due || String(record.data.submittedAt || record.updatedAt).slice(0, 10) <= record.due.slice(0, 10), `${submitted.length} submitted or finalized estimate(s) were compared with their recorded due date.`));
  const packages = owned.filter((record) => record.type === "Bid Packages");
  metrics.push(rateMetric("estimating-coverage", packages, (record) => bidderCount(record.data) >= 3 || record.data.coverageExceptionApproved === true, `${packages.filter((record) => bidderCount(record.data) >= 3).length} of ${packages.length} bid package(s) have three received bids; approved exceptions also earn compliance.`));
  const awards = owned.filter((record) => /Estimate|Sales Opportunit/i.test(record.type) && /award|won/i.test(record.status));
  metrics.push(rateMetric("estimating-handoff", awards, (record) => Boolean(record.data.projectId || record.data.projectNumber || record.data.projectCreatedAt || record.data.awardedProjectNumber), `${awards.filter((record) => Boolean(record.data.projectId || record.data.projectNumber || record.data.projectCreatedAt || record.data.awardedProjectNumber)).length} of ${awards.length} awards contain a controlled project handoff reference.`));
}

function addSalesMetrics(metrics: PerformanceMetric[], employee: PerformanceEmployee, records: PerformanceRecord[], range: { start: string; end: string }, departmentWide = false) {
  const owned = records.filter((record) => departmentWide || record.owner.toLowerCase() === employee.name.toLowerCase() || referencesEmployee(record.data, employee.email.toLowerCase(), employee.name.toLowerCase()));
  const decisions = owned.filter((record) => /Sales Opportunit|Estimate/i.test(record.type) && inPeriod(record.recordDate || record.updatedAt, range) && /award|won|lost|declined/i.test(record.status));
  const wins = decisions.filter((record) => /award|won/i.test(record.status));
  metrics.push(metric("sales-conversion", decisions.length ? percent(wins.length, decisions.length) : null, decisions.length, decisions.length ? `${wins.length} of ${decisions.length} final opportunity decisions were won.` : "No final won-or-lost opportunity decisions fall in this quarter.", decisions.map(source)));
  const wonValue = wins.reduce((sum, record) => sum + number(record.data.contractValue || record.data.estimatedValue || record.data.totalContractPrice), 0);
  const goals = records.filter((record) => record.type === "Sales Goals");
  const annualGoal = goals.flatMap((record) => Array.isArray(record.data.salespersonGoals) ? record.data.salespersonGoals as Array<Record<string, unknown>> : []).filter((goal) => departmentWide || String(goal.email || "").toLowerCase() === employee.email.toLowerCase() || String(goal.name || "").toLowerCase() === employee.name.toLowerCase()).reduce((sum, goal) => sum + number(goal.goal), 0);
  metrics.push(metric("sales-goal", annualGoal > 0 ? Math.min(120, percent(wonValue, annualGoal / 4)) : null, wins.length, annualGoal > 0 ? `${money(wonValue)} won against a quarterly goal share of ${money(annualGoal / 4)}.` : "An approved employee sales goal is not recorded yet.", [...wins.map(source), ...goals.map(source)]));
  const open = owned.filter((record) => record.type === "Sales Opportunities" && !closed(record.status));
  metrics.push(rateMetric("sales-followup", open, (record) => Boolean(String(record.data.nextAction || record.data.nextStep || "").trim()) && Boolean(String(record.data.nextFollowUpDate || record.data.nextActionDate || record.due || "").trim()), `${open.filter((record) => Boolean(String(record.data.nextAction || record.data.nextStep || "").trim()) && Boolean(String(record.data.nextFollowUpDate || record.data.nextActionDate || record.due || "").trim())).length} of ${open.length} open opportunities have both a next action and follow-up date.`));
}

function metric(key: string, scoreValue: number | null, evidenceCount: number, detail: string, sourceIds: string[]): PerformanceMetric {
  const definition = PERFORMANCE_METRIC_LIBRARY.find((item) => item.key === key);
  return {
    key,
    label: definition?.label || key,
    category: definition?.category || "Company Results",
    weight: WEIGHTS[key] || 10,
    score: scoreValue === null || !Number.isFinite(scoreValue) ? null : Math.round(clamp(scoreValue)),
    confidence: evidenceCount >= 5 ? "High" : evidenceCount >= 2 ? "Medium" : evidenceCount === 1 ? "Low" : "Insufficient",
    evidenceCount,
    detail,
    sourceIds: [...new Set(sourceIds)].slice(0, 50),
    policy: definition?.description || "Controlled Command Center evidence.",
  };
}

function rateMetric<T extends { id?: string; sourceId?: string }>(key: string, rows: T[], pass: (row: T) => boolean, detail: string) {
  return metric(key, rows.length ? percent(rows.filter(pass).length, rows.length) : null, rows.length, rows.length ? detail : "No qualifying evidence falls in this quarter.", rows.map((row) => String(row.sourceId || row.id || "")).filter(Boolean));
}

function performanceGrade(score: number | null, coverage: number) {
  if (score === null || coverage < 35) return "Developing Evidence";
  if (score >= 93) return "A";
  if (score >= 85) return "B";
  if (score >= 75) return "C";
  if (score >= 65) return "D";
  return "Needs Improvement";
}

export function calibratedPerformanceGrade(score: number | null) {
  return performanceGrade(score, 100);
}

function categoryScores(data: Record<string, unknown>, names: readonly string[]) {
  const categories = Array.isArray(data.categories) ? data.categories as Array<Record<string, unknown>> : [];
  return categories.filter((category) => names.includes(String(category.category))).map((category) => {
    const weight = number(category.weight);
    return weight ? number(category.earned) / weight * 100 : number(category.score);
  }).filter((score) => score >= 0);
}

function surveyRating(data: Record<string, unknown>) {
  const direct = number(data.overallRating || data.overallScore);
  if (direct > 0) return Math.min(5, direct);
  const values = ["communication", "quality", "schedule", "professionalism", "value", "recommendation"].map((key) => number(data[key])).filter((value) => value > 0);
  return values.length ? average(values) : null;
}

function bidderCount(data: Record<string, unknown>) {
  const bidders = Array.isArray(data.bidders) ? data.bidders as Array<Record<string, unknown>> : [];
  return bidders.filter((bidder) => Array.isArray(bidder.revisions) ? bidder.revisions.length > 0 : Boolean(bidder.receivedAt || bidder.quoteId)).length;
}

function referencesEmployee(data: Record<string, unknown>, email: string, name: string) {
  const text = JSON.stringify(data).toLowerCase();
  return Boolean(email && text.includes(email)) || Boolean(name && text.includes(name));
}

function inPeriod(value: string, range: { start: string; end: string }) {
  const date = String(value || "").slice(0, 10);
  return Boolean(date && date >= range.start && date <= range.end);
}

function uniqueBy<T>(items: T[], key: (item: T) => string) {
  return [...new Map(items.map((item) => [key(item), item])).values()];
}

function percent(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator * 100 : 0;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function minutesBetween(start: string, end: string) {
  if (!start || !end) return null;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
  return Math.round((endMs - startMs) / 60_000);
}

function durationLabel(minutes: number) {
  if (!Number.isFinite(minutes) || minutes <= 0) return "not yet recorded";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  if (minutes < 1_440) return `${(minutes / 60).toFixed(1)} hr`;
  return `${(minutes / 1_440).toFixed(1)} days`;
}

function number(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}

function closed(status: string) {
  return /closed|complete|approved|executed|paid|awarded|won|lost|cancelled/i.test(status);
}

function source(record: PerformanceRecord) {
  return `${record.projectId}:${record.type}:${record.id}`;
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);
}

function maxDate(a: string, b: string) {
  return !a ? b : a > b ? a : b;
}

function minDate(a: string, b: string) {
  return !a ? b : a < b ? a : b;
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekdaysBetween(start: string, end: string) {
  if (!start || !end || start > end) return 0;
  let count = 0;
  const cursor = new Date(`${start}T12:00:00Z`);
  const stop = new Date(`${end}T12:00:00Z`);
  while (cursor <= stop) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}
