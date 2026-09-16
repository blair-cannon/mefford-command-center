export type OperatingRole =
  | "Superintendent"
  | "Project Manager"
  | "Estimator"
  | "Sales"
  | "Accounting"
  | "Company Leadership";

export type OperatingOutcome =
  | "Safe Field Execution"
  | "Schedule Reliability"
  | "Profit Protection"
  | "Proposal Reliability"
  | "Pipeline Growth"
  | "Financial Decision Support"
  | "Company Control";

export type OperatingDoctrine = {
  role: OperatingRole;
  shortRole: string;
  mission: string;
  promise: string;
  measures: string[];
  ownerEscalation: string[];
  defaultTarget: string;
};

export const PROFITABILITY_FLOOR_BASIS_POINTS = 1_500;

export const ROLE_DOCTRINE: Record<OperatingRole, OperatingDoctrine> = Object.freeze({
  Superintendent: {
    role: "Superintendent",
    shortRole: "SITE SUP",
    mission: "Build safely and keep field production on the current schedule.",
    promise: "No silent safety condition. No silent schedule miss.",
    measures: ["Safe work", "Current field plan", "Daily production truth", "First-time quality"],
    ownerEscalation: ["Unresolved incident or critical hazard", "Unrecovered critical-path miss", "Repeated missing field visibility"],
    defaultTarget: "Project Health",
  },
  "Project Manager": {
    role: "Project Manager",
    shortRole: "PM",
    mission: "Hit the contract schedule and protect or improve forecast profit.",
    promise: "No project is allowed to drift into a loss without immediate recovery action.",
    measures: ["Contract schedule", "Current EAC", "Forecast profit", "Change recovery"],
    ownerEscalation: ["Projected project loss", "Material margin erosion", "Unrecovered final-completion risk", "Unpriced or unapproved cost exposure"],
    defaultTarget: "Project Health",
  },
  Estimator: {
    role: "Estimator",
    shortRole: "ESTIMATING",
    mission: "Deliver complete, competitive, defensible proposals by the promised deadline.",
    promise: "The company puts its best foot forward on every qualified opportunity.",
    measures: ["On-time proposals", "Complete scope", "Competitive bid coverage", "Defensible fee and margin"],
    ownerEscalation: ["Proposal deadline at risk", "Material scope or bid-coverage gap", "Unreviewed pricing before submission"],
    defaultTarget: "Estimating",
  },
  Sales: {
    role: "Sales",
    shortRole: "SALES",
    mission: "Maintain a qualified pipeline large enough to hit the goal and convert it into profitable work.",
    promise: "Every real opportunity has an owner, a next move, and a close strategy.",
    measures: ["Qualified pipeline", "Weighted goal coverage", "Follow-up discipline", "Closed profitable work"],
    ownerEscalation: ["Weighted pipeline cannot cover the remaining goal", "Material opportunity has no next move", "Close pace falls behind the approved goal"],
    defaultTarget: "Sales Dashboard",
  },
  Accounting: {
    role: "Accounting",
    shortRole: "ACCOUNTING",
    mission: "Give PMs current, reconciled cost and cash truth early enough to change the outcome.",
    promise: "Accounting information exists to improve project decisions, not merely report history.",
    measures: ["Current job cost", "Current WIP and EAC", "Decision-ready exceptions", "Billing and collection support"],
    ownerEscalation: ["Project loss signal not reconciled with the PM", "Decision data is missing or stale", "Cash, billing, or cost exception threatens project action"],
    defaultTarget: "Accounting Command",
  },
  "Company Leadership": {
    role: "Company Leadership",
    shortRole: "LEADERSHIP",
    mission: "Remove barriers, enforce accountability, and act only where operating risk requires leadership.",
    promise: "Ownership sees the consequence, accountable role, recovery action, and deadline—not undifferentiated noise.",
    measures: ["Critical operating risk", "Role accountability", "Recovery timing", "Permanent decision record"],
    ownerEscalation: ["Safety", "Projected loss", "Contract completion", "Persistent role inaction"],
    defaultTarget: "Dashboard",
  },
});

const SUPERINTENDENT_TARGETS = new Set(["Daily Logs", "Safety", "Quality"]);
const PM_TARGETS = new Set([
  "Budget",
  "Contracts",
  "Subcontracts",
  "Change Orders",
  "Purchase Orders",
  "Procurement",
  "Design & Drawings",
  "RFIs",
  "Submittals",
  "Schedule",
  "Selections",
  "Closeout",
  "Owner Billing",
  "Project Overview",
  "Project Health",
]);
const ESTIMATING_TARGETS = new Set(["Estimating", "Estimating Calendar", "Bid Management"]);
const SALES_TARGETS = new Set(["Sales Dashboard", "Sales Funnel", "Sales Contacts", "Sales Design", "Sales Goals"]);
const ACCOUNTING_TARGETS = new Set([
  "Accounting Command",
  "Accounts Payable",
  "Cash Management",
  "Payroll Reports",
  "WIP And Close",
  "Financial Reports",
  "General Ledger",
  "Chart Of Accounts",
  "Vendor Management",
  "Lien Waivers",
]);

export function primaryOperatingRole(accessLevel: string, designations: string[] = []): OperatingRole {
  if (["Company Owner", "Administrator"].includes(accessLevel)) return "Company Leadership";
  if (designations.includes("Superintendent")) return "Superintendent";
  if (designations.includes("Project Manager")) return "Project Manager";
  if (designations.some((item) => ["Estimator", "Estimating Manager"].includes(item))) return "Estimator";
  if (designations.some((item) => ["Sales Representative", "Sales Manager"].includes(item))) return "Sales";
  if (designations.some((item) => ["Accountant", "Financial Administrator", "Accounting Manager"].includes(item))) return "Accounting";
  return "Company Leadership";
}

export function operatingRoleForSection(target: string, sourceType = "", kind = "", title = ""): OperatingRole {
  const combined = `${target} ${sourceType} ${kind} ${title}`.toLowerCase();
  if (/incident|hazard|toolbox|daily log|quality|field report/.test(combined)) return "Superintendent";
  if (/sales|pipeline|opportunit|contact follow-up|client follow-up/.test(combined)) return "Sales";
  if (/estimat|proposal|bid package|bid coverage|quote leveling/.test(combined)) return "Estimator";
  if (/accounting|accounts payable|payroll|cash|bank|journal|wip|receivable|collection|lien waiver/.test(combined)) return "Accounting";
  if (/budget|contract|change order|purchase order|procurement|rfi|submittal|schedule|selection|closeout|owner billing|project health/.test(combined)) return "Project Manager";
  if (SUPERINTENDENT_TARGETS.has(target)) return "Superintendent";
  if (SALES_TARGETS.has(target)) return "Sales";
  if (ESTIMATING_TARGETS.has(target)) return "Estimator";
  if (ACCOUNTING_TARGETS.has(target)) return "Accounting";
  if (PM_TARGETS.has(target)) return "Project Manager";
  return "Company Leadership";
}

export function outcomeForRole(role: OperatingRole, target = "", title = ""): OperatingOutcome {
  const combined = `${target} ${title}`.toLowerCase();
  if (role === "Superintendent") return /schedule|production|daily log/.test(combined) ? "Schedule Reliability" : "Safe Field Execution";
  if (role === "Project Manager") return /schedule|rfi|submittal|selection|closeout/.test(combined) ? "Schedule Reliability" : "Profit Protection";
  if (role === "Estimator") return "Proposal Reliability";
  if (role === "Sales") return "Pipeline Growth";
  if (role === "Accounting") return "Financial Decision Support";
  return "Company Control";
}

export function alignOperatingWork(input: {
  actionTarget?: string;
  sourceType?: string;
  kind?: string;
  title?: string;
  priority?: string;
}) {
  const role = operatingRoleForSection(input.actionTarget || "", input.sourceType || "", input.kind || "", input.title || "");
  const outcome = outcomeForRole(role, input.actionTarget, input.title);
  const doctrine = ROLE_DOCTRINE[role];
  const businessImpact: Record<OperatingOutcome, string> = {
    "Safe Field Execution": "Protect people, production continuity, and the permanent field record.",
    "Schedule Reliability": "Protect the contract completion commitment and the cost of time.",
    "Profit Protection": "Protect forecast gross profit and prevent unrecovered project loss.",
    "Proposal Reliability": "Protect the submission deadline, scope completeness, and the company’s competitive position.",
    "Pipeline Growth": "Protect backlog, goal coverage, and the next profitable award.",
    "Financial Decision Support": "Give the PM current cost, billing, cash, and forecast truth for a timely decision.",
    "Company Control": "Protect company authority, compliance, and the permanent decision record.",
  };
  return {
    accountableRole: role,
    operatingOutcome: outcome,
    roleMission: doctrine.mission,
    businessImpact: businessImpact[outcome],
    ownerEscalationReason: input.priority === "Critical"
      ? `Ownership visibility is required because this condition threatens ${outcome.toLowerCase()} and the accountable role needs a documented recovery action.`
      : `Escalate to ownership only if the accountable role cannot recover ${outcome.toLowerCase()} within the required time.`,
  };
}

export function parseDesignationJson(value: string | null | undefined) {
  try {
    const parsed = JSON.parse(value || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
