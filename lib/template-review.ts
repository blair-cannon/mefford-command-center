import { PREWORK_QUALITY_TEMPLATES } from "./quality-control";

export const REVIEW_PROJECT_ID = "MEFFORD-REVIEW";
export const TEMPLATE_REVIEW_RECORD_TYPE = "Template Annual Review";
export const TEMPLATE_REVIEW_FILE_CATEGORY_PREFIX = "Controlled Master · ";

export type ReviewArea =
  | "Legal"
  | "Human Resources"
  | "Benefits"
  | "Accounting"
  | "Preconstruction"
  | "Project Management"
  | "Operations"
  | "Company Administration";

export type ReviewTemplate = {
  id: string;
  name: string;
  area: ReviewArea;
  category: string;
  version: string;
  source: string;
  owner: string;
  standardStructure: string[];
};

export const STANDARD_QUALITY_FORM_STRUCTURE = [
  "Project, Schedule Activity, Quality Category, Attempt Number, Date, And Superintendent",
  "Exact Work Location, Responsible Trade, Responsible Company, And Current References",
  "Grouped Required Responses With Yes, No, Or Justified N/A",
  "Before Evidence, After Evidence, Notes, And Linked Deficiencies",
  "Pass, Failed Follow-Up, Or Qualified Superintendent Override Disposition",
  "PM / Designer Acceptance When Required And Permanent Audit History",
];

function reviewArea(id: string, category: string): ReviewArea {
  if (category === "Benefits") return "Benefits";
  if (category === "Human Resources" || category === "People") return "Human Resources";
  if (category === "Legal & Contracts" || id.startsWith("lien-") || id.includes("-lien")) return "Legal";
  if (category === "Accounting" || category === "Accounting & Closeout") return "Accounting";
  if (["Sales & Estimating", "Procurement"].includes(category)) return "Preconstruction";
  if (["Project Management", "Design & Drawings", "Scheduling", "Closeout"].includes(category)) return "Project Management";
  if (["Quality Control", "Field Operations", "Safety"].includes(category)) return "Operations";
  return "Company Administration";
}

const systemForm = (id: string, name: string, category: string, source: string, owner: string): ReviewTemplate => ({
  id,
  name,
  area: reviewArea(id, category),
  category,
  version: "Master v1",
  source,
  owner,
  standardStructure: ["Controlled Company Master", "Required Fields And Role Gates", "Version, Effective Date, And Prior-Version Retention", "Approval / Signature Requirements", "Permanent Audit History"],
});

export const TEMPLATE_REVIEW_CATALOG: ReviewTemplate[] = [
  ...PREWORK_QUALITY_TEMPLATES.map((template) => ({
    id: `quality-${template.id}`,
    name: template.title,
    area: "Operations" as const,
    category: "Quality Control",
    version: "Digitized Master v1",
    source: template.sourceDocument,
    owner: "Operations / Quality",
    standardStructure: STANDARD_QUALITY_FORM_STRUCTURE,
  })),
  systemForm("employee-handbook", "Mefford Employee Handbook", "Human Resources", "Native Command Center Master", "Owner / Human Resources"),
  systemForm("offer-letter", "Offer Letter & Employment Terms", "Human Resources", "Native Command Center Master", "Owner / Human Resources"),
  systemForm("job-description", "Job Description Template", "Human Resources", "Native Command Center Master", "Human Resources"),
  systemForm("employee-onboarding", "Employee Onboarding Checklist", "Human Resources", "Mefford Onboarding Checklist.docx", "Owner / Human Resources"),
  systemForm("employee-offboarding", "Employee Offboarding Checklist", "Human Resources", "Command Center Standard", "Owner / Human Resources"),
  systemForm("employee-review", "30 / 60 / 90-Day Employee Review", "Human Resources", "Command Center Standard", "Owner / Human Resources"),
  systemForm("benefits-enrollment-guide", "Benefits Enrollment Guide", "Benefits", "Current Carrier Information", "Human Resources / Benefits Administrator"),
  systemForm("benefits-health-plan", "Health Insurance Plan Summary", "Benefits", "UnitedHealthcare Current Plan", "Human Resources / Benefits Administrator"),
  systemForm("benefits-dental-plan", "Dental Insurance Plan Summary", "Benefits", "Current Dental Carrier Plan", "Human Resources / Benefits Administrator"),
  systemForm("benefits-vision-plan", "Vision Insurance Plan Summary", "Benefits", "Current Vision Carrier Plan", "Human Resources / Benefits Administrator"),
  systemForm("benefits-life-plan", "Employee Life Insurance Plan Summary", "Benefits", "Northwestern Mutual Current Plan", "Human Resources / Benefits Administrator"),
  systemForm("benefits-change-notice", "Benefits Carrier Change Notice", "Benefits", "Native Command Center Master", "Human Resources / Benefits Administrator"),
  systemForm("estimate", "Mefford Estimate Template", "Sales & Estimating", "Estimate Template Cost Code Master", "Owner / Estimating"),
  systemForm("sales-proposal", "Sales Proposal", "Sales & Estimating", "Command Center Standard", "Owner / Sales"),
  systemForm("award-handoff", "Awarded Project Handoff", "Sales & Estimating", "Command Center Standard", "Owner / Project Management"),
  systemForm("daily-log", "Daily Log Form", "Field Operations", "Command Center Standard", "Operations"),
  systemForm("schedule-activity", "Schedule Activity & Quality Category", "Scheduling", "Command Center Standard", "Project Management"),
  systemForm("schedule-baseline", "Project Schedule Baseline", "Scheduling", "Command Center Standard", "Project Management"),
  systemForm("toolbox-talk", "Toolbox Talk & Signature Form", "Safety", "Command Center Standard", "Safety"),
  systemForm("safety-walk", "Jobsite Safety Walk", "Safety", "Command Center Standard", "Safety"),
  systemForm("incident-report", "Incident / Near-Miss Report", "Safety", "Command Center Standard", "Safety"),
  systemForm("site-visitor-waiver", "Site Visitor Waiver", "Safety", "Company Master", "Safety / Legal"),
  systemForm("rfi", "Request For Information", "Project Management", "Command Center Standard", "Project Management"),
  systemForm("submittal", "Submittal Review", "Project Management", "Command Center Standard", "Project Management"),
  systemForm("owner-meeting", "Owner Meeting Minutes", "Project Management", "Command Center Standard", "Project Management"),
  systemForm("design-meeting", "Design Meeting Minutes", "Project Management", "Command Center Standard", "Project Management"),
  systemForm("sub-meeting", "Subcontractor Meeting Minutes", "Project Management", "Command Center Standard", "Project Management"),
  systemForm("quality-item", "Quality Deficiency / Punch Item", "Quality Control", "Command Center Standard", "Operations / Quality"),
  systemForm("design-expectations", "Design Lifecycle Expectations Checklist", "Design & Drawings", "Command Center Standard", "Project Management / Design"),
  systemForm("design-review", "Architect / Engineer Design Review", "Design & Drawings", "Command Center Standard", "Project Management / Design"),
  systemForm("drawing-transmittal", "Drawing Transmittal & Current Set Release", "Design & Drawings", "Command Center Standard", "Project Management"),
  systemForm("bid-package", "Bid Package & Scope Leveling", "Procurement", "Command Center Standard", "Estimating / Project Management"),
  systemForm("bid-addendum", "Bid Addendum & Acknowledgment", "Procurement", "Command Center Standard", "Estimating / Project Management"),
  systemForm("purchase-order", "Purchase Order", "Legal & Contracts", "Company Master", "Owner / Project Management"),
  systemForm("subcontract", "Full Subcontract Agreement", "Legal & Contracts", "Company Master", "Owner / Legal"),
  systemForm("owner-contract", "Owner Contract Template", "Legal & Contracts", "Company Master", "Owner / Legal"),
  systemForm("change-order", "Change Order Template", "Legal & Contracts", "Company Master", "Owner / Project Management"),
  systemForm("owner-aia", "Owner Invoice / AIA Application", "Accounting", "BCSC - 6-31-26 .xlsx Layout Standard", "Owner / Accounting"),
  systemForm("owner-sov", "Owner Schedule Of Values", "Accounting", "Command Center Standard", "Owner / Accounting"),
  systemForm("vendor-aia", "Vendor AIA Pay Application Intake", "Accounting", "Command Center Standard", "Accounting"),
  systemForm("vendor-invoice", "Vendor Invoice Intake", "Accounting", "Command Center Standard", "Accounting"),
  systemForm("vendor-compliance", "Vendor Compliance & Prequalification", "Vendor Management", "Command Center Standard", "Owner / Administrator"),
  systemForm("project-schedule-import", "Project Schedule Import", "Scheduling", "Mefford_Project_Schedule_Import_Template.xlsx", "Project Management"),
  systemForm("contacts-import", "Contacts Import", "Company Data", "Mefford_Contacts_Import_Template.xlsx", "Administrator"),
  systemForm("closeout", "Mefford Standard Commercial Closeout", "Closeout", "Company Master", "Project Management"),
  systemForm("warranty-collection", "Warranty Collection Checklist", "Closeout", "Company Master", "Project Management"),
  systemForm("testing-turnover", "Testing & Commissioning Turnover", "Closeout", "Company Master", "Project Management"),
  systemForm("closeout-owner-punch", "Owner Punch List & Final Acceptance", "Closeout", "Command Center Standard", "Project Management / Owner"),
  systemForm("lien-conditional-progress", "Conditional Waiver And Release On Progress Payment", "Accounting & Closeout", "Mefford Branded Four-Form Master · KY / IN / WV / TN / MN / IL · Counsel Review Required", "Owner / Accounting / Legal"),
  systemForm("lien-unconditional-progress", "Unconditional Waiver And Release On Progress Payment", "Accounting & Closeout", "Mefford Branded Four-Form Master · Cleared-Payment Gate · Counsel Review Required", "Owner / Accounting / Legal"),
  systemForm("closeout-conditional-lien", "Conditional Waiver And Release On Final Payment", "Accounting & Closeout", "Mefford Branded Four-Form Master · Replaces Legacy Conditional Final Lien Release / User Form Pending · Final-Payment Gate · Counsel Review Required", "Owner / Accounting / Legal"),
  systemForm("closeout-unconditional-lien", "Unconditional Waiver And Release On Final Payment", "Accounting & Closeout", "Mefford Branded Four-Form Master · Total-Closeout Gate · Counsel Review Required", "Owner / Accounting / Legal"),
  systemForm("closeout-om", "Operations & Maintenance Manual Requirement", "Closeout", "Command Center Standard", "Project Management"),
  systemForm("closeout-permit", "Permit & Final Inspection Close Record", "Closeout", "Command Center Standard", "Project Management"),
  systemForm("closeout-training", "Owner Training / Instructional Media Acceptance", "Closeout", "Command Center Standard", "Project Management"),
  systemForm("closeout-equipment", "Installed Equipment & Warranty Register", "Closeout", "Command Center Standard", "Project Management"),
  systemForm("closeout-package", "Owner Closeout Package Index & Receipt", "Closeout", "Command Center Standard", "Owner / Project Management"),
  systemForm("warranty-request", "Post-Closeout Warranty Request", "Closeout", "Command Center Standard", "Owner / Project Management"),
];

export function reviewTemplateById(id: string) {
  return TEMPLATE_REVIEW_CATALOG.find((template) => template.id === id) || null;
}

export function reviewTemplateIdFromFileCategory(category: string) {
  return category.startsWith(TEMPLATE_REVIEW_FILE_CATEGORY_PREFIX)
    ? category.slice(TEMPLATE_REVIEW_FILE_CATEGORY_PREFIX.length)
    : "";
}

export function reviewFileCategory(templateId: string) {
  return `${TEMPLATE_REVIEW_FILE_CATEGORY_PREFIX}${templateId}`;
}

export function addReviewYear(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date.toISOString().slice(0, 10);
}
