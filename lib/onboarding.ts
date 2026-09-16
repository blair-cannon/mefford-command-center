import { and, eq } from "drizzle-orm";
import { commandRecords, companyMembers } from "../db/schema";
import { resolveCommandActor, type CommandActor } from "./server-actor";

export const PEOPLE_PROJECT_ID = "MEFFORD-PEOPLE";
export const ONBOARDING_TEMPLATE_ID = "ONBOARDING-TEMPLATE-MASTER";

export type OnboardingRequirement = {
  id: string;
  title: string;
  category: "Company" | "Safety" | "Legal" | "Technology" | "Equipment" | "Training" | "Payroll" | "Role" | "Follow-Up" | "Signoff";
  section: string;
  method: "Document And Signature" | "Video" | "Quiz" | "Form" | "In-Person Acknowledgement" | "Supervisor Verification" | "Guided Review" | "Signature";
  annual: boolean;
  designations: string[];
  departments: string[];
  reviewer: "Administrator" | "Safety Reviewer" | "Attorney";
  responsible: string;
  dueOffsetDays: number;
  blocksActivation: boolean;
  status: "Draft Content" | "Pending Review" | "Ready";
  instructions?: string;
  contentFiles?: Array<{
    id: number;
    name: string;
    contentType: string;
    uploadedAt: string;
    uploadedBy: string;
  }>;
  contentReview?: {
    fileId: number;
    reviewedAt: string;
    reviewedBy: string;
    reviewNote: string;
  };
};

export type RequirementCompletion = {
  completedAt: string;
  completedBy: string;
  method: string;
  score?: number;
  attestation: string;
};

export type EmployeeOnboardingData = {
  email: string;
  name: string;
  hireDate: string;
  birthDate?: string;
  position?: string;
  department?: "Office" | "Field" | "Leadership";
  supervisor?: string;
  workLocation?: string;
  checklistOwner?: string;
  thirtyDayReviewDate?: string;
  accessLevel: "Company Owner" | "Administrator" | "Employee";
  designations: string[];
  lifecycleStatus: string;
  grandfathered?: boolean;
  initialActivatedAt?: string;
  lastApprovedCycle?: number;
  lastApprovedBy?: string;
  extensionUntil?: string;
  extensionReason?: string;
  extensionGrantedBy?: string;
  terminatedAt?: string;
  completions?: Record<string, RequirementCompletion>;
};

export const DEFAULT_ONBOARDING_REQUIREMENTS: OnboardingRequirement[] = [
  checklist("PRE-01", "Approved Offer Compensation Start Date And Reporting Relationship", "Before The Employee Starts", "Company", "Administrator", -7, true),
  checklist("PRE-02", "Job Description And First-90-Day Expectations Prepared For Supervisor", "Before The Employee Starts", "Role", "Supervisor", -5, true),
  checklist("PRE-03", "Background Driving Record And Required Pre-Employment Reviews", "Before The Employee Starts", "Legal", "Administrator", -5, true),
  checklist("PRE-04", "I-9 W-4 Direct Deposit Emergency Contact And Benefit Forms Prepared", "Before The Employee Starts", "Payroll", "Administrator", -3, true, "Form"),
  checklist("PRE-05", "Email Phone Computer Keys Access Card Vehicle And Equipment Prepared", "Before The Employee Starts", "Equipment", "Checklist Owner", -2, true),
  checklist("PRE-06", "Command Center Email Files Timekeeping And Role Access Requested", "Before The Employee Starts", "Technology", "Checklist Owner", -2, true),
  checklist("PRE-07", "Workspace Or Jobsite Reporting Location Assigned And Ready", "Before The Employee Starts", "Company", "Supervisor", -2, true),
  checklist("PRE-08", "First-Day Schedule Created And Key Contacts Notified", "Before The Employee Starts", "Company", "Supervisor", -2, true),
  checklist("PRE-09", "Orientation Materials Policies Organization Chart And Handbook Assembled", "Before The Employee Starts", "Company", "Checklist Owner", -1, true),

  checklist("DAY1-01", "Welcome And Introductions To Leadership Team And Support Contacts", "First Day · Company And Role Orientation", "Company", "Supervisor", 0, true),
  checklist("DAY1-02", "Mefford Business Customers Active Work Standards And Professionalism", "First Day · Company And Role Orientation", "Company", "Supervisor", 0, true),
  checklist("DAY1-03", "Organization Chart Chain Of Command And Authorized Decision-Makers", "First Day · Company And Role Orientation", "Role", "Supervisor", 0, true),
  checklist("DAY1-04", "Job Duties Schedule Work Hours Attendance And Call-Off Procedure", "First Day · Company And Role Orientation", "Role", "Supervisor", 0, true),
  checklist("DAY1-05", "First-Week Plan And Measurable 30/60/90-Day Expectations", "First Day · Company And Role Orientation", "Role", "Supervisor", 0, true),
  checklist("DAY1-06", "Employment Payroll Emergency Contact And Benefit Documents Verified", "First Day · Company And Role Orientation", "Payroll", "Administrator", 0, true, "Form"),
  checklist("DAY1-07", "Mefford Employee Handbook And Workplace Policies", "First Day · Company And Role Orientation", "Legal", "Administrator", 0, true, "Document And Signature"),
  checklist("DAY1-08", "Payroll Time Entry Expenses Benefits PTO Holidays And Company Property", "First Day · Company And Role Orientation", "Payroll", "Administrator", 0, true),
  checklist("DAY1-09", "Equipment Credentials PPE Keys Vehicles Tools And Uniforms Issued", "First Day · Company And Role Orientation", "Equipment", "Checklist Owner", 0, true, "Supervisor Verification"),
  checklist("DAY1-10", "Office Shop Or Project Site Tour And Emergency Locations", "First Day · Company And Role Orientation", "Company", "Supervisor", 0, true, "In-Person Acknowledgement"),
  checklist("DAY1-11", "Next-Day Reporting Contact And What-To-Bring Confirmed", "First Day · Company And Role Orientation", "Company", "Supervisor", 0, true),

  checklist("SAFE-01", "Stop-Work Authority And Unsafe Work Notification", "Safety Orientation", "Safety", "Safety Reviewer", 0, true, "In-Person Acknowledgement", ["Project Manager", "Superintendent"], ["Field"]),
  checklist("SAFE-02", "PPE Dress Housekeeping Access Control And Prohibited Behaviors", "Safety Orientation", "Safety", "Safety Reviewer", 0, true, "In-Person Acknowledgement", ["Project Manager", "Superintendent"], ["Field"]),
  checklist("SAFE-03", "Emergency Incident Injury Near-Miss And Medical Response Procedures", "Safety Orientation", "Safety", "Safety Reviewer", 0, true, "In-Person Acknowledgement", ["Project Manager", "Superintendent"], ["Field"]),
  checklist("SAFE-04", "Hazcom SDS Fall Protection Ladders Electrical And Equipment Training", "Safety Orientation", "Safety", "Safety Reviewer", 0, true, "Supervisor Verification", ["Project Manager", "Superintendent"], ["Field"]),
  checklist("SAFE-05", "Certifications And Competent-Person Qualifications Verified", "Safety Orientation", "Safety", "Safety Reviewer", 0, true, "Supervisor Verification", ["Project Manager", "Superintendent"], ["Field"]),
  checklist("SAFE-06", "Daily Huddles JHAs Toolbox Talks Inspections And Documentation", "Safety Orientation", "Safety", "Safety Reviewer", 0, true, "In-Person Acknowledgement", ["Project Manager", "Superintendent"], ["Field"]),
  checklist("SAFE-07", "Site Hazards First Aid Extinguishers And Emergency Contacts", "Safety Orientation", "Safety", "Safety Reviewer", 0, true, "In-Person Acknowledgement", ["Project Manager", "Superintendent"], ["Field"]),
  checklist("SAFE-08", "PPE And Safety Equipment Use Demonstrated And Understood", "Safety Orientation", "Safety", "Safety Reviewer", 0, true, "Supervisor Verification", ["Project Manager", "Superintendent"], ["Field"]),

  checklist("SYS-01", "Email Calendar Shared Files Printer Phone And Groups Activated And Tested", "Systems Documentation And Communication", "Technology", "Checklist Owner", 0, true, "Supervisor Verification"),
  checklist("SYS-02", "Command Center Role-Limited Access And Training", "Systems Documentation And Communication", "Technology", "Supervisor", 0, true, "Supervisor Verification"),
  checklist("SYS-03", "Time Entry Process Explained And Practiced", "Systems Documentation And Communication", "Payroll", "Supervisor", 0, true),
  checklist("SYS-04", "Command Center Accounting Access And Responsibilities When Required", "Systems Documentation And Communication", "Technology", "Administrator", 0, true, "Supervisor Verification", ["Accountant", "Financial Administrator"]),
  checklist("SYS-05", "Folder Structure Naming Standards And Document Storage", "Systems Documentation And Communication", "Technology", "Supervisor", 0, true),
  checklist("SYS-06", "Cybersecurity Passwords Phishing Confidential Information And Technology Use", "Systems Documentation And Communication", "Technology", "Administrator", 0, true, "Document And Signature"),
  checklist("SYS-07", "Current Project Information Location And No Unofficial Records", "Systems Documentation And Communication", "Role", "Supervisor", 0, true),
  checklist("SYS-08", "Communication Standards For Email Text Phone Meetings And Stakeholders", "Systems Documentation And Communication", "Company", "Supervisor", 0, true),

  checklist("ROLE-01", "Current Assignments Priorities Critical Dates And Immediate Deliverables", "Role-Specific Training And Expectations", "Role", "Supervisor", 0, true),
  checklist("ROLE-02", "Decision Spending Authority Approval Limits And Escalation Path", "Role-Specific Training And Expectations", "Role", "Supervisor", 0, true),
  checklist("ROLE-03", "Performance Standards And Scorecard", "Role-Specific Training And Expectations", "Role", "Supervisor", 0, true),
  checklist("ROLE-04", "Required Daily Weekly Monthly Reports Meetings And Documentation", "Role-Specific Training And Expectations", "Role", "Supervisor", 0, true),
  checklist("ROLE-05", "Primary Trainer Peer And Daily First-Week Check-Ins Assigned", "Role-Specific Training And Expectations", "Training", "Supervisor", 0, true),
  checklist("ROLE-06", "Key Processes Demonstrated And Performed Under Supervision", "Role-Specific Training And Expectations", "Training", "Supervisor", 0, true, "Supervisor Verification"),
  checklist("ROLE-07", "Quality Standards Customer Expectations And Completion Verification", "Role-Specific Training And Expectations", "Role", "Supervisor", 0, true),
  checklist("ROLE-08", "No Guessing Hiding Problems Or Unowned Follow-Up", "Role-Specific Training And Expectations", "Company", "Supervisor", 0, true),
  checklist("ROLE-09", "Problems Communicated Early With Facts Impact And Proposed Next Action", "Role-Specific Training And Expectations", "Company", "Supervisor", 0, true),

  checklist("OFFICE-01", "Office Workflow File Ownership Meetings Approvals And Production-Accounting Handoffs", "Office Employee Addendum", "Role", "Supervisor", 0, true, "Guided Review", ["Office Staff", "Estimator", "Sales Representative", "Accountant", "Financial Administrator"], ["Office"]),
  checklist("OFFICE-02", "Role-Specific Command Center Estimating Sales Marketing Accounting And Reporting", "Office Employee Addendum", "Training", "Supervisor", 0, true, "Supervisor Verification", ["Office Staff", "Estimator", "Sales Representative", "Accountant", "Financial Administrator"], ["Office"]),
  checklist("OFFICE-03", "Customer Employee Contract Bid And Financial Confidentiality", "Office Employee Addendum", "Legal", "Administrator", 0, true, "Document And Signature", ["Office Staff", "Estimator", "Sales Representative", "Accountant", "Financial Administrator"], ["Office"]),
  checklist("OFFICE-04", "Recurring Office Tasks Completed Through Supervised Examples", "Office Employee Addendum", "Training", "Supervisor", 0, true, "Supervisor Verification", ["Office Staff", "Estimator", "Sales Representative", "Accountant", "Financial Administrator"], ["Office"]),

  checklist("FIELD-01", "Plans Specifications Schedule Scope Logistics Site Rules And Reporting", "Field Employee Addendum", "Role", "Supervisor", 0, true, "Guided Review", ["Project Manager", "Superintendent"], ["Field"]),
  checklist("FIELD-02", "Daily Logs Photos Manpower Deliveries Inspections RFIs Submittals And Change Documentation", "Field Employee Addendum", "Training", "Supervisor", 0, true, "Supervisor Verification", ["Project Manager", "Superintendent"], ["Field"]),
  checklist("FIELD-03", "Equipment Tools Vehicle License And Certification Requirements", "Field Employee Addendum", "Equipment", "Safety Reviewer", 0, true, "Supervisor Verification", ["Project Manager", "Superintendent"], ["Field"]),
  checklist("FIELD-04", "Site-Specific Orientation Completed Before Work", "Field Employee Addendum", "Safety", "Safety Reviewer", 0, true, "In-Person Acknowledgement", ["Project Manager", "Superintendent"], ["Field"]),

  checklist("WEEK1-01", "Daily Supervisor Check-Ins Completed During First Week", "End Of First Week", "Follow-Up", "Supervisor", 7, false, "Supervisor Verification"),
  checklist("WEEK1-02", "Employee Explains Priorities Chain Of Command Safety And Information Location", "End Of First Week", "Follow-Up", "Supervisor", 7, false, "Supervisor Verification"),
  checklist("WEEK1-03", "Systems Work And Basic Entries Completed Without Assistance", "End Of First Week", "Follow-Up", "Supervisor", 7, false, "Supervisor Verification"),
  checklist("WEEK1-04", "Initial Work Product Or Field Performance Reviewed And Coaching Documented", "End Of First Week", "Follow-Up", "Supervisor", 7, false, "Supervisor Verification"),
  checklist("WEEK1-05", "Questions Access Training And Equipment Gaps Assigned", "End Of First Week", "Follow-Up", "Checklist Owner", 7, false, "Supervisor Verification"),
  checklist("WEEK1-06", "First-Week Performance Conversation And Next Two Weeks Priorities", "End Of First Week", "Follow-Up", "Supervisor", 7, false, "In-Person Acknowledgement"),

  checklist("DAY30-01", "30-Day Review · Attendance Safety Culture Knowledge Communication Quality And Expectations", "30/60/90-Day Follow-Up", "Follow-Up", "Supervisor", 30, false, "Supervisor Verification"),
  checklist("DAY30-02", "30-Day Review · Training Gaps And Three Priorities", "30/60/90-Day Follow-Up", "Follow-Up", "Supervisor", 30, false, "Supervisor Verification"),
  checklist("DAY60-01", "60-Day Review · Productivity Independence Documentation Teamwork And Results", "30/60/90-Day Follow-Up", "Follow-Up", "Supervisor", 60, false, "Supervisor Verification"),
  checklist("DAY60-02", "60-Day Review · Chain Of Command And Escalation", "30/60/90-Day Follow-Up", "Follow-Up", "Supervisor", 60, false, "Supervisor Verification"),
  checklist("DAY90-01", "90-Day Formal Review · Employment Status Goals Development And Scorecard Ownership", "30/60/90-Day Follow-Up", "Follow-Up", "Supervisor", 90, false, "Signature"),
  checklist("REVIEW-NOTES", "Supervisor Review Notes · Strengths Gaps Actions Owners And Completion Dates", "Supervisor Review Notes", "Follow-Up", "Supervisor", 30, false, "Form"),

  checklist("SIGN-EMPLOYEE", "Employee Acknowledgment And Signature", "Acknowledgment And Signoff", "Signoff", "Employee", 0, true, "Signature"),
  checklist("SIGN-SUPERVISOR", "Supervisor Acknowledgment And Signature", "Acknowledgment And Signoff", "Signoff", "Supervisor", 0, true, "Signature"),
  checklist("SIGN-OWNER", "Checklist Owner Or HR Acknowledgment And Signature", "Acknowledgment And Signoff", "Signoff", "Checklist Owner", 0, true, "Signature"),

  annual("REQ-HANDBOOK", "Mefford Employee Handbook", "Company", "Document And Signature", "Administrator"),
  annual("REQ-SAFETY-POLICY", "Mefford Safety Policy", "Safety", "Document And Signature", "Safety Reviewer"),
  annual("REQ-SAFETY-VIDEO", "Annual Workplace Safety Training", "Safety", "Video", "Safety Reviewer"),
  annual("REQ-SAFETY-QUIZ", "Annual Safety Knowledge Check", "Training", "Quiz", "Safety Reviewer"),
  annual("REQ-CONFIDENTIALITY", "Confidentiality And Information Protection", "Legal", "Document And Signature", "Attorney"),
  annual("REQ-TECHNOLOGY", "Technology And Acceptable Use Policy", "Technology", "Document And Signature", "Administrator"),
  annual("REQ-EMERGENCY", "Emergency Contact Information", "Company", "Form", "Administrator", []),
  annual("REQ-FIELD-ORIENTATION", "Field Safety Orientation", "Safety", "In-Person Acknowledgement", "Safety Reviewer", ["Superintendent", "Project Manager"], ["Field"]),
  annual("REQ-EQUIPMENT", "Vehicle And Equipment Responsibility", "Equipment", "Document And Signature", "Administrator", ["Superintendent", "Project Manager"], ["Field"]),
  annual("REQ-FINANCIAL-SECURITY", "Financial Security And Privacy", "Technology", "Quiz", "Administrator", ["Accountant", "Financial Administrator"]),
];

function checklist(
  id: string,
  title: string,
  section: string,
  category: OnboardingRequirement["category"],
  responsible: string,
  dueOffsetDays: number,
  blocksActivation: boolean,
  method: OnboardingRequirement["method"] = "Guided Review",
  designations: string[] = [],
  departments: string[] = [],
): OnboardingRequirement {
  return {
    id,
    title,
    section,
    category,
    method,
    annual: false,
    designations,
    departments,
    reviewer: category === "Safety" ? "Safety Reviewer" : category === "Legal" ? "Attorney" : "Administrator",
    responsible,
    dueOffsetDays,
    blocksActivation,
    status: "Ready",
  };
}

function annual(
  id: string,
  title: string,
  category: OnboardingRequirement["category"],
  method: OnboardingRequirement["method"],
  reviewer: OnboardingRequirement["reviewer"],
  designations: string[] = [],
  departments: string[] = [],
): OnboardingRequirement {
  return {
    id,
    title,
    section: "Annual Compliance Renewal",
    category,
    method,
    annual: true,
    designations,
    departments,
    reviewer,
    responsible: reviewer,
    dueOffsetDays: 0,
    blocksActivation: true,
    status: id === "REQ-EMERGENCY" ? "Ready" : "Draft Content",
  };
}

export function employeeRecordId(email: string) {
  return `EMP-${email.trim().toLowerCase()}`;
}

export function requirementsForEmployee(
  requirements: OnboardingRequirement[],
  designations: string[],
  department = "",
) {
  return requirements.filter(
    (requirement) => {
      const roles = requirement.designations || [];
      const departments = requirement.departments || [];
      if (!roles.length && !departments.length) return true;
      return roles.some((designation) => designations.includes(designation)) || departments.includes(department);
    },
  );
}

export function onboardingState(
  employee: EmployeeOnboardingData,
  requirements: OnboardingRequirement[],
  now = new Date(),
) {
  const today = easternDate(now);
  const currentYear = Number(today.slice(0, 4));
  const lastApprovedCycle = Number(employee.lastApprovedCycle || 0);
  const initialRequired = !employee.grandfathered && !employee.initialActivatedAt;
  const currentAnniversary = employee.hireDate
    ? anniversaryForYear(employee.hireDate, currentYear)
    : "";
  const cycleYear = initialRequired
    ? currentYear
    : currentAnniversary && lastApprovedCycle >= currentYear && today > currentAnniversary
      ? currentYear + 1
      : currentYear;
  const deadline = employee.hireDate
    ? anniversaryForYear(employee.hireDate, cycleYear)
    : "";
  const daysRemaining = deadline ? dayDifference(today, deadline) : null;
  const applicable = requirementsForEmployee(requirements, employee.designations, employee.department);
  const completions = employee.completions || {};
  const initialRequirements = applicable.filter((requirement) => !requirement.annual);
  const gateRequirements = applicable.filter((requirement) => requirement.blocksActivation);
  const annualRequirements = applicable.filter((requirement) => requirement.annual);
  const visibleRequirements = initialRequired
    ? [...initialRequirements, ...annualRequirements]
    : [
        ...(!employee.grandfathered
          ? initialRequirements.filter((requirement) => !completions[`initial:${requirement.id}`])
          : []),
        ...annualRequirements,
      ];
  const completionKey = (requirement: OnboardingRequirement) =>
    requirement.annual ? `${cycleYear}:${requirement.id}` : `initial:${requirement.id}`;
  const completedCount = visibleRequirements.filter((requirement) => completions[completionKey(requirement)]).length;
  const progress = visibleRequirements.length ? Math.round((completedCount / visibleRequirements.length) * 100) : 100;
  const allComplete = gateRequirements.every((requirement) => completions[completionKey(requirement)]);
  const annualComplete = annualRequirements.every((requirement) => completions[completionKey(requirement)]);
  const extensionActive = Boolean(
    employee.extensionUntil && employee.extensionUntil >= today && daysRemaining !== null && daysRemaining <= 0,
  );

  let status = "Active";
  let permissionLocked = false;
  if (employee.terminatedAt || employee.lifecycleStatus === "Terminated") {
    status = "Terminated";
    permissionLocked = true;
  } else if (initialRequired) {
    status = allComplete ? "Ready For Activation" : "Onboarding Required";
    permissionLocked = true;
  } else if (!employee.hireDate) {
    status = "Hire Date Required";
  } else if (lastApprovedCycle >= cycleYear) {
    status = "Active";
  } else if (annualComplete) {
    status = "Ready For Reactivation";
    permissionLocked = daysRemaining !== null && daysRemaining <= 0;
  } else if (extensionActive) {
    status = "Extension Active";
  } else if (daysRemaining !== null && daysRemaining <= 0) {
    status = "Locked For Annual Renewal";
    permissionLocked = true;
  } else if (daysRemaining !== null && daysRemaining <= 30) {
    status = "Annual Renewal Due";
  }

  return {
    ...employee,
    status,
    permissionLocked,
    cycleYear,
    deadline,
    daysRemaining,
    progress,
    completedCount,
    requirementCount: visibleRequirements.length,
    cycleKey: initialRequired ? "initial" : String(cycleYear),
    requirements: visibleRequirements.map((requirement) => ({
      ...requirement,
      blocksActivation: initialRequired && requirement.blocksActivation,
      dueAt: requirement.annual
        ? deadline
        : employee.hireDate
          ? dueDateFromOffset(employee.hireDate, requirement.dueOffsetDays)
          : "",
      completion: completions[completionKey(requirement)] || null,
    })),
    reminderSchedule: deadline
      ? [30, 14, 7, 6, 5, 4, 3, 2, 1].map((days) => ({ days, channel: days <= 7 ? "Command Center And Microsoft Email" : "Microsoft Email" }))
      : [],
  };
}

export async function getEmployeeOnboardingData(email: string) {
  const { getDb } = await import("../db");
  const rows = await getDb()
    .select({ dataJson: commandRecords.dataJson })
    .from(commandRecords)
    .where(
      and(
        eq(commandRecords.projectId, PEOPLE_PROJECT_ID),
        eq(commandRecords.id, employeeRecordId(email)),
      ),
    )
    .limit(1);
  if (!rows[0]) return null;
  return parseEmployeeData(rows[0].dataJson);
}

export async function getOnboardingRequirements() {
  const { getDb } = await import("../db");
  const rows = await getDb()
    .select({ dataJson: commandRecords.dataJson })
    .from(commandRecords)
    .where(
      and(
        eq(commandRecords.projectId, PEOPLE_PROJECT_ID),
        eq(commandRecords.id, ONBOARDING_TEMPLATE_ID),
      ),
    )
    .limit(1);
  try {
    const parsed = JSON.parse(rows[0]?.dataJson || "{}") as { requirements?: unknown };
    return mergeOnboardingRequirements(
      Array.isArray(parsed.requirements)
        ? parsed.requirements as OnboardingRequirement[]
        : [],
    );
  } catch {
    return mergeOnboardingRequirements([]);
  }
}

export function mergeOnboardingRequirements(stored: OnboardingRequirement[]) {
  const controlledIds = new Set(DEFAULT_ONBOARDING_REQUIREMENTS.map((item) => item.id));
  const storedById = new Map(stored.filter((item) => item?.id).map((item) => [item.id, item]));
  const controlled = DEFAULT_ONBOARDING_REQUIREMENTS.map((item) => {
    const saved = storedById.get(item.id);
    return {
      ...item,
      status: saved?.contentFiles?.length && saved.status === "Ready" && !saved.contentReview ? "Pending Review" as const : saved?.status || item.status,
      instructions: saved?.instructions || item.instructions,
      contentFiles: saved?.contentFiles || item.contentFiles || [],
    };
  });
  const custom = stored
    .filter((item) => item?.id && !controlledIds.has(item.id))
    .map((item) => ({
      ...item,
      status: item.contentFiles?.length && item.status === "Ready" && !item.contentReview ? "Pending Review" as const : item.status,
      section: item.section || "Company-Added Requirements",
      departments: item.departments || [],
      responsible: item.responsible || item.reviewer || "Administrator",
      dueOffsetDays: Number(item.dueOffsetDays || 0),
      blocksActivation: item.blocksActivation !== false,
      contentFiles: item.contentFiles || [],
    }));
  return [...controlled, ...custom] as OnboardingRequirement[];
}

export type OnboardingAccessState = {
  permissionLocked: boolean;
  status: string;
  progress: number;
  deadline: string;
};

export async function onboardingAccessForActor(
  actor: CommandActor,
): Promise<OnboardingAccessState> {
  if (!actor.authenticated || !actor.email) {
    return {
      permissionLocked: true,
      status: "Authentication Required",
      progress: 0,
      deadline: "",
    };
  }
  const { getDb } = await import("../db");
  const db = getDb();
  const members = await db
    .select({
      isActive: companyMembers.isActive,
    })
    .from(companyMembers)
    .where(eq(companyMembers.email, actor.email))
    .limit(1);
  const member = members[0];
  if (member && !member.isActive) {
    return {
      permissionLocked: true,
      status: "Company Login Not Issued",
      progress: 0,
      deadline: "",
    };
  }
  const employee = await getEmployeeOnboardingData(actor.email);
  if (!employee) {
    // Named owners remain a deliberate bootstrap path during first-run setup.
    // Every non-owner must have an active employee lifecycle record.
    if (actor.accessLevel === "Company Owner") {
      return {
        permissionLocked: false,
        status: "Owner Bootstrap Access",
        progress: 100,
        deadline: "",
      };
    }
    return {
      permissionLocked: true,
      status: "Employee Record Required",
      progress: 0,
      deadline: "",
    };
  }
  const state = onboardingState(employee, await getOnboardingRequirements());
  return {
    permissionLocked: state.permissionLocked,
    status: state.status,
    progress: state.progress,
    deadline: state.deadline,
  };
}

export async function enforceOnboardingAccess(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return null;
  try {
    const state = await onboardingAccessForActor(actor);
    if (!state.permissionLocked) return null;
    return Response.json(
      {
        error: "Employee Onboarding Or Annual Renewal Must Be Approved Before Company Permissions Unlock",
        onboardingRequired: true,
        onboardingStatus: state.status,
      },
      { status: 423 },
    );
  } catch {
    return Response.json(
      {
        error: "Employee Access Status Could Not Be Verified. Company Permissions Remain Locked.",
        onboardingRequired: true,
        onboardingStatus: "Verification Unavailable",
      },
      { status: 503 },
    );
  }
}

export function parseEmployeeData(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object"
      ? parsed as EmployeeOnboardingData
      : null;
  } catch {
    return null;
  }
}

export function easternDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function anniversaryForYear(hireDate: string, year: number) {
  const [, month, day] = hireDate.split("-").map(Number);
  const safeDay = month === 2 && day === 29 && !isLeapYear(year) ? 28 : day;
  return `${year}-${String(month).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
}

function dayDifference(from: string, to: string) {
  return Math.ceil((new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / 86_400_000);
}

function dueDateFromOffset(hireDate: string, offsetDays: number) {
  const date = new Date(`${hireDate}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return `${date.toISOString().slice(0, 10)}T17:00:00-05:00`;
}

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
