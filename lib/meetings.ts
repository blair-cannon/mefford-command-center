import { SALES_TURNOVER, OPS_TURNOVER, TURNOVER_SECTIONS } from "./turnovers";
export const MEETING_TYPES = [
  SALES_TURNOVER, OPS_TURNOVER,
  "Quarterly Rock/Review",
  "Weekly L10",
  "Sales/Estimating Department",
  "Operations Department",
  "Accounting Department",
  "Project Design",
  "Project Owner",
  "Project Subcontractor",
] as const;

export type MeetingType = (typeof MEETING_TYPES)[number];

export const DEPARTMENT_MEETING_ROLES: Partial<Record<MeetingType, string[]>> = {
  [SALES_TURNOVER]: ["Sales Representative", "Sales Manager", "Estimator", "Estimating Manager", "Chief Estimator"],
  [OPS_TURNOVER]: ["Estimator", "Estimating Manager", "Chief Estimator", "Director of Operations", "Project Manager", "Superintendent", "Accountant", "Accounting Manager", "Financial Administrator"],
  "Sales/Estimating Department": ["Sales Representative", "Sales Manager", "Estimator", "Estimating Manager"],
  "Operations Department": ["Project Manager", "Superintendent"],
  "Accounting Department": ["Accountant", "Accounting Manager", "Financial Administrator"],
};

export const MEETING_FOCUS: Record<MeetingType, string> = {
  [SALES_TURNOVER]: "Project Scope And Estimator Acceptance",
  [OPS_TURNOVER]: "Award, Buyout And Operations Acceptance",
  "Quarterly Rock/Review": "Quarterly Results, Major Issues And Next-Quarter Rocks",
  "Weekly L10": "Company Scorecard, Rocks And Major Decisions",
  "Sales/Estimating Department": "Pipeline, Bid Deadlines, Scope Coverage And Proposals",
  "Operations Department": "PM And Site Superintendent Coordination Across Projects",
  "Accounting Department": "Collections, Billing, Payables And Financial Close",
  "Project Design": "Design Milestones, Open Questions And Required Selections",
  "Project Owner": "Owner Decisions, Milestones, Contract Changes And Payment",
  "Project Subcontractor": "Field Constraints, Trade Sequencing And Site Commitments",
};

export const COMPANY_MEETING_TYPES: MeetingType[] = [
  SALES_TURNOVER, OPS_TURNOVER,
  "Quarterly Rock/Review",
  "Weekly L10",
  "Sales/Estimating Department",
  "Operations Department",
  "Accounting Department",
];

export const PROJECT_MEETING_TYPES: MeetingType[] = [
  "Project Design",
  "Project Owner",
  "Project Subcontractor",
];

export const MEETING_TARGET_BY_TYPE: Record<MeetingType, string> = {
  [SALES_TURNOVER]: SALES_TURNOVER,
  [OPS_TURNOVER]: OPS_TURNOVER,
  "Quarterly Rock/Review": "Quarterly Rock/Review",
  "Weekly L10": "Weekly L10",
  "Sales/Estimating Department": "Sales/Estimating Department",
  "Operations Department": "Operations Department",
  "Accounting Department": "Accounting Department",
  "Project Design": "Project Design Meetings",
  "Project Owner": "Project Owner Meetings",
  "Project Subcontractor": "Project Subcontractor Meetings",
};

export const MEETING_TYPE_BY_TARGET: Record<string, MeetingType> = Object.fromEntries(
  Object.entries(MEETING_TARGET_BY_TYPE).map(([type, target]) => [target, type]),
) as Record<string, MeetingType>;

export type MeetingSection = {
  key: string;
  title: string;
  minutes: number;
  prompt?: string;
};

export const MEETING_SECTIONS: Record<MeetingType, MeetingSection[]> = {
  [SALES_TURNOVER]: [...TURNOVER_SECTIONS[SALES_TURNOVER]],
  [OPS_TURNOVER]: [...TURNOVER_SECTIONS[OPS_TURNOVER]],
  "Sales/Estimating Department": [
    { key: "previous-todos", title: "Previous Commitments", minutes: 5, prompt: "Confirm completed commitments and assign a recovery date for anything overdue." },
    { key: "scorecard", title: "Sales And Estimating Scorecard", minutes: 5, prompt: "Review pipeline, bids due, estimate workload, and proposals awaiting review." },
    { key: "pipeline", title: "Pipeline And Next Steps", minutes: 10, prompt: "Confirm each priority opportunity's next step, responsible person, and follow-up date." },
    { key: "bids", title: "Bid Calendar And Estimator Capacity", minutes: 10, prompt: "Resolve upcoming deadlines, missing inputs, and estimator workload conflicts." },
    { key: "coverage", title: "Subcontractor Coverage And Scope Gaps", minutes: 10, prompt: "Resolve missing quotes, exclusions, addenda, and lead times before committing a price." },
    { key: "proposals", title: "Estimate Review, Proposals And Signatures", minutes: 10, prompt: "Clear approval blockers and confirm the next owner-facing submission." },
    { key: "handoff", title: "Awards And Operations Handoff", minutes: 5, prompt: "Confirm scope, estimate assumptions, schedule, buyout, and the assigned project team." },
    { key: "conclusion", title: "Decisions And Commitments", minutes: 5, prompt: "Assign one accountable person and a due date to every next step." },
  ],
  "Operations Department": [
    { key: "previous-todos", title: "Previous Commitments", minutes: 5 },
    { key: "scorecard", title: "Operations Scorecard", minutes: 5, prompt: "Review active work, schedule exceptions, safety, quality, and delivery constraints." },
    { key: "schedule", title: "Schedule Recovery And Crew Planning", minutes: 15, prompt: "Resolve slippage, sequencing conflicts, manpower needs, and recovery commitments with PMs and site superintendents." },
    { key: "procurement", title: "Lead Times And Site Readiness", minutes: 10, prompt: "Confirm required-on-site dates against procurement, selections, and delivery commitments." },
    { key: "safety-quality", title: "Safety, Quality And Inspections", minutes: 10, prompt: "Assign corrective actions for open field issues and overdue inspections." },
    { key: "controls", title: "RFIs, Submittals And Change Exposure", minutes: 10, prompt: "Resolve information blockers and confirm scope changes before affected work proceeds." },
    { key: "handoff", title: "Upcoming Starts And Closeout", minutes: 10, prompt: "Confirm new-job handoffs, final completion, punch work, and closeout responsibilities." },
    { key: "conclusion", title: "Escalations And Commitments", minutes: 5 },
  ],
  "Accounting Department": [
    { key: "previous-todos", title: "Previous Commitments", minutes: 5 },
    { key: "scorecard", title: "Accounting Scorecard", minutes: 5, prompt: "Review receivables, payables, billing approvals, and close exceptions." },
    { key: "collections", title: "Owner Payments And Collections", minutes: 15, prompt: "Confirm overdue balances, disputes, promised payment dates, and collection responsibility." },
    { key: "billing", title: "Billing And Change Reconciliation", minutes: 10, prompt: "Clear billing approvals and reconcile contract changes before the next invoice." },
    { key: "payables", title: "Payables And Payment Readiness", minutes: 10, prompt: "Resolve invoice discrepancies, duplicate holds, and required payment evidence." },
    { key: "cash-close", title: "Cash, WIP And Month-End Close", minutes: 10, prompt: "Review cash timing, WIP exceptions, reconciliation, and unfinished close tasks." },
    { key: "conclusion", title: "Owner Decisions And Commitments", minutes: 5 },
  ],
  "Quarterly Rock/Review": [
    { key: "segue", title: "Segue And Check-In", minutes: 10 },
    { key: "scorecard", title: "Scorecard And Prior-Quarter Review", minutes: 15, prompt: "Compare saved quarter-end results with the current live scorecard. Live counts describe today, not a historical quarter." },
    { key: "prior-rocks", title: "Prior Rock Completion", minutes: 15 },
    { key: "headlines", title: "Customer And Employee Headlines", minutes: 15 },
    { key: "ids", title: "Major IDS", minutes: 40 },
    { key: "new-rocks", title: "Set New Rocks", minutes: 35 },
    { key: "confirm-scorecard", title: "Confirm Company Scorecard", minutes: 15 },
    { key: "quarter-actions", title: "Quarterly Actions", minutes: 15 },
    { key: "cascading", title: "Cascading Messages", minutes: 10 },
    { key: "conclusion", title: "Conclusion And Rating", minutes: 10 },
  ],
  "Weekly L10": [
    { key: "segue", title: "Segue", minutes: 5 },
    { key: "scorecard", title: "Scorecard", minutes: 5 },
    { key: "rock-review", title: "Rock Review", minutes: 5 },
    { key: "headlines", title: "Customer And Employee Headlines", minutes: 5 },
    { key: "previous-todos", title: "Previous To-Dos", minutes: 5 },
    { key: "ids", title: "Identify, Discuss And Solve", minutes: 55, prompt: "Prioritize major project and company exceptions, identify the root cause, and record a decision or accountable action." },
    { key: "new-todos", title: "New To-Dos And Decisions", minutes: 5 },
    { key: "conclusion", title: "Conclusion And Rating", minutes: 5 },
  ],
  "Project Design": [
    { key: "previous-actions", title: "Previous Actions", minutes: 5 },
    { key: "design-schedule", title: "Design Schedule And Milestones", minutes: 10 },
    { key: "drawings", title: "Current Drawings And Revisions", minutes: 10 },
    { key: "rfis", title: "RFIs And Open Questions", minutes: 10 },
    { key: "submittals", title: "Submittals", minutes: 10 },
    { key: "decisions", title: "Design Decisions", minutes: 10 },
    { key: "constructability", title: "Constructability", minutes: 10 },
    { key: "selections", title: "Selections", minutes: 5 },
    { key: "exposure", title: "Cost And Schedule Exposure", minutes: 5 },
    { key: "conclusion", title: "Actions And Conclusion", minutes: 5 },
  ],
  "Project Owner": [
    { key: "prior-commitments", title: "Prior Commitments", minutes: 5 },
    { key: "health-safety", title: "Project Health And Safety", minutes: 10 },
    { key: "schedule", title: "Schedule And Milestones", minutes: 10 },
    { key: "changes", title: "Contract Value, Changes And Cost Exposure", minutes: 10 },
    { key: "owner-decisions", title: "Owner Decisions And Selections", minutes: 10 },
    { key: "design", title: "Design, RFIs And Submittals", minutes: 10 },
    { key: "billing", title: "Billing And Payment", minutes: 5 },
    { key: "quality-closeout", title: "Quality And Closeout", minutes: 5 },
    { key: "conclusion", title: "Actions And Conclusion", minutes: 5 },
  ],
  "Project Subcontractor": [
    { key: "prior-commitments", title: "Prior Commitments", minutes: 5 },
    { key: "safety", title: "Safety", minutes: 10 },
    { key: "lookahead", title: "Lookahead And Sequencing", minutes: 10 },
    { key: "production", title: "Manpower And Production", minutes: 10 },
    { key: "procurement", title: "Deliveries And Procurement", minutes: 10 },
    { key: "documents", title: "RFIs, Submittals And Current Drawings", minutes: 10 },
    { key: "quality", title: "Quality, Inspections And Deficiencies", minutes: 10 },
    { key: "logistics", title: "Logistics And Access", minutes: 5 },
    { key: "changes", title: "Potential Changes", minutes: 5 },
    { key: "conclusion", title: "Commitments And Conclusion", minutes: 5 },
  ],
};

export const MEETING_DEFAULTS: Record<MeetingType, { cadence: string; publishHours: number; durationMinutes: number }> = {
  "Sales/Estimating Department": { cadence: "Weekly", publishHours: 24, durationMinutes: 60 },
  "Operations Department": { cadence: "Weekly", publishHours: 24, durationMinutes: 70 },
  "Accounting Department": { cadence: "Weekly", publishHours: 24, durationMinutes: 60 },
  [SALES_TURNOVER]: { cadence: "One Time", publishHours: 24, durationMinutes: 40 },
  [OPS_TURNOVER]: { cadence: "One Time", publishHours: 24, durationMinutes: 90 },
  "Quarterly Rock/Review": { cadence: "Quarterly", publishHours: 72, durationMinutes: 180 },
  "Weekly L10": { cadence: "Weekly", publishHours: 24, durationMinutes: 90 },
  "Project Design": { cadence: "Biweekly", publishHours: 24, durationMinutes: 80 },
  "Project Owner": { cadence: "Monthly", publishHours: 24, durationMinutes: 70 },
  "Project Subcontractor": { cadence: "Weekly", publishHours: 24, durationMinutes: 80 },
};

export function meetingNumber(type: MeetingType, projectId: string, start: string, sequence = 1) {
  const date = new Date(start);
  const year = date.getUTCFullYear();
  if (type === "Quarterly Rock/Review") return `QR-${year}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
  if (type === "Weekly L10") return `L10-${date.toISOString().slice(0, 10)}`;
  const department = ({ "Sales/Estimating Department": "SALES", "Operations Department": "OPS", "Accounting Department": "ACCT" } as Partial<Record<MeetingType, string>>)[type];
  if (department) return `${department}-${date.toISOString().slice(0, 10)}-${String(sequence).padStart(3, "0")}`;
  const suffix = type === "Project Design" ? "DM" : type === "Project Owner" ? "OM" : "SM";
  return `${projectId || "PROJECT"}-${suffix}-${String(sequence).padStart(3, "0")}`;
}

export function isCompanyMeeting(type: MeetingType) {
  return COMPANY_MEETING_TYPES.includes(type);
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  try {
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}
