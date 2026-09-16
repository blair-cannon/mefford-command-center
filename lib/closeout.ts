export const CLOSEOUT_CONTROL_TYPE = "Closeout Project Control";
export const CLOSEOUT_REQUIREMENT_TYPE = "Closeout Requirements";
export const CLOSEOUT_EQUIPMENT_TYPE = "Closeout Equipment";
export const CLOSEOUT_WARRANTY_TYPE = "Warranty Requests";
export const CLOSEOUT_PACKAGE_TYPE = "Closeout Packages";

export const CLOSEOUT_INTERNAL_TYPES = new Set([
  CLOSEOUT_CONTROL_TYPE,
  CLOSEOUT_REQUIREMENT_TYPE,
  CLOSEOUT_EQUIPMENT_TYPE,
  CLOSEOUT_WARRANTY_TYPE,
  CLOSEOUT_PACKAGE_TYPE,
  "Morning Work Digest History",
]);

export type CloseoutApprovalRole =
  | "Subcontractor"
  | "Superintendent"
  | "Project Manager"
  | "Accountant"
  | "Company Owner"
  | "Project Owner";

export type CloseoutRequirementTemplate = {
  key: string;
  title: string;
  category: string;
  responsibleRole: CloseoutApprovalRole;
  approvalFlow: CloseoutApprovalRole[];
  weight: number;
  critical: boolean;
  appliesTo?: string;
  instructions: string;
};

export const CLOSEOUT_STATUS_CREDIT: Record<string, number> = {
  "Not Started": 0,
  Requested: 10,
  "Corrections Required": 25,
  Submitted: 60,
  "Under Review": 80,
  Approved: 100,
  "Not Applicable": 100,
};

export const CLOSEOUT_STANDARD_REQUIREMENTS: CloseoutRequirementTemplate[] = [
  requirement("owner-punch", "Owner Punch List — Final Acceptance", "Punch & Acceptance", "Project Manager", ["Superintendent", "Project Manager", "Project Owner"], 5, true, "Track every Owner item through correction, verification, individual acceptance, and final electronic signoff."),
  requirement("mefford-warranty", "Mefford Contracting Warranty", "Warranties", "Project Manager", ["Project Manager", "Company Owner", "Project Owner"], 4, true, "Issue the governing Mefford warranty with the contract-defined start date and recorded Owner receipt."),
  requirement("certificate-occupancy", "Certificate Of Occupancy / Final Building Approval", "Permits & Inspections", "Project Manager", ["Project Manager"], 5, true, "Upload the official certificate or final approval and verify its number, jurisdiction, and date."),
  ...["Building", "Electrical", "Plumbing", "HVAC", "Fire Alarm", "Fire Sprinkler"].map((permit) =>
    requirement(`permit-${slug(permit)}`, `${permit} Permit — Closed`, "Permits & Inspections", "Project Manager", ["Project Manager"], 4, true, "Upload the official closed permit or final inspection. OCR suggestions require PM confirmation.", permit),
  ),
  requirement("final-inspections", "Final Inspection & Testing Register", "Permits & Inspections", "Superintendent", ["Superintendent", "Project Manager"], 4, true, "Collect final inspections, test reports, commissioning results, and any authority acceptance."),
  requirement("om-master", "O&M Manual Master Index", "O&M Manuals", "Project Manager", ["Project Manager", "Project Owner"], 5, true, "Confirm every applicable trade manual is approved and indexed for individual or master-package printing."),
  requirement("as-builts", "Record Drawings / As-Builts", "Drawings", "Project Manager", ["Superintendent", "Project Manager", "Project Owner"], 4, true, "Collect field redlines and final record drawings with permanent version history."),
  requirement("owner-training", "Owner Training & Instructional Media", "Training & Media", "Project Manager", ["Superintendent", "Project Manager", "Project Owner"], 3, false, "Record attendees and acceptance; include required system-control videos, photos, and instructions."),
  requirement("keys-stock", "Keys, Access, Spare Materials & Attic Stock", "Turnover", "Superintendent", ["Superintendent", "Project Manager", "Project Owner"], 2, false, "Record quantities, locations, transfer date, and Owner receipt."),
  requirement("financial-reconciliation", "Project Financial Reconciliation", "Financial Close", "Accountant", ["Accountant", "Company Owner"], 5, true, "Reconcile commitments, AP, change orders, retainage, subcontractor billing, and Owner billing."),
  requirement("final-owner-invoice", "Final Owner Invoice Approved & Paid", "Financial Close", "Accountant", ["Accountant", "Company Owner"], 5, true, "The existing billing workflow must reach approval and payment. Nothing is sent, posted, or paid automatically."),
  requirement("owner-package", "Owner Closeout Package — Receipt & Acceptance", "Final Package", "Project Manager", ["Project Manager", "Project Owner", "Company Owner"], 5, true, "Deliver the indexed originals, master packet, and media package; preserve receipt and acceptance."),
];

export function vendorCloseoutTemplates(vendor: { id: string; name: string; trade: string }) {
  const suffix = `${vendor.name}${vendor.trade ? ` · ${vendor.trade}` : ""}`;
  return [
    vendorRequirement("conditional-waiver", "Conditional Final Lien Release", "Lien Releases", vendor, 5, true, "Required before final payment release."),
    vendorRequirement("final-invoice", "Final Invoice Approved & Paid", "Financial Close", vendor, 4, true, "Final billing must complete the controlled AP workflow and be paid."),
    vendorRequirement("unconditional-waiver", "Unconditional Final Lien Release", "Lien Releases", vendor, 5, true, "Automatically requested after final payment is confirmed; Total Project Closeout remains blocked until approved."),
    vendorRequirement("warranty", "Subcontractor Warranty", "Warranties", vendor, 5, true, `Trade warranty for ${suffix}, including governing start and expiration dates.`),
    vendorRequirement("om", "Operations & Maintenance Manuals", "O&M Manuals", vendor, 5, true, `Applicable manuals, product data, maintenance instructions, and contacts for ${suffix}.`),
    vendorRequirement("as-built", "Trade As-Builts / Record Information", "Drawings", vendor, 3, false, `Final trade record information for ${suffix}; mark Not Applicable only with an audited PM reason.`),
    vendorRequirement("training", "Owner Instruction / Training Media", "Training & Media", vendor, 3, false, `Required equipment demonstrations, such as thermostat or system-control instruction, for ${suffix}.`),
  ];
}

function vendorRequirement(key: string, title: string, category: string, vendor: { id: string; name: string }, weight: number, critical: boolean, instructions: string): CloseoutRequirementTemplate & { vendorId: string; vendorName: string } {
  return {
    key: `vendor-${vendor.id}-${key}`,
    title: `${title} · ${vendor.name}`,
    category,
    responsibleRole: "Subcontractor",
    approvalFlow: category === "Financial Close" || category === "Lien Releases"
      ? ["Subcontractor", "Accountant", "Project Manager"]
      : ["Subcontractor", "Project Manager"],
    weight,
    critical,
    instructions,
    vendorId: vendor.id,
    vendorName: vendor.name,
  };
}

function requirement(key: string, title: string, category: string, responsibleRole: CloseoutApprovalRole, approvalFlow: CloseoutApprovalRole[], weight: number, critical: boolean, instructions: string, appliesTo = "All Projects"): CloseoutRequirementTemplate {
  return { key, title, category, responsibleRole, approvalFlow, weight, critical, instructions, appliesTo };
}

export function closeoutStatusCredit(status: string, approvalFlow: unknown, approvals: unknown) {
  if (status === "Approved" || status === "Not Applicable") return 100;
  const base = CLOSEOUT_STATUS_CREDIT[status] ?? 0;
  const flow = Array.isArray(approvalFlow) ? approvalFlow.map(String) : [];
  const completed = Array.isArray(approvals)
    ? approvals.filter((approval) => approval && typeof approval === "object" && String((approval as Record<string, unknown>).decision || "") === "Approved").length
    : 0;
  if (!flow.length || !completed) return base;
  return Math.min(99, Math.max(base, 80 + Math.round((completed / flow.length) * 19)));
}

export function calculateCloseoutProgress(requirements: Array<{ status: string; data?: Record<string, unknown> }>) {
  const applicable = requirements.filter((item) => item.status !== "Not Applicable");
  const totalWeight = applicable.reduce((sum, item) => sum + Math.max(1, Number(item.data?.weight || 1)), 0);
  const earnedWeight = applicable.reduce((sum, item) => {
    const weight = Math.max(1, Number(item.data?.weight || 1));
    return sum + weight * closeoutStatusCredit(item.status, item.data?.approvalFlow, item.data?.approvals) / 100;
  }, 0);
  const progress = totalWeight ? Math.round((earnedWeight / totalWeight) * 100) : 0;
  return {
    progress,
    totalWeight,
    earnedWeight: Math.round(earnedWeight * 10) / 10,
    approved: requirements.filter((item) => ["Approved", "Not Applicable"].includes(item.status)).length,
    total: requirements.length,
    criticalOpen: requirements.filter((item) => item.data?.critical === true && !["Approved", "Not Applicable"].includes(item.status)).length,
  };
}

export function expectedCloseoutProgress(finalDate: string, today = new Date().toISOString().slice(0, 10)) {
  const remaining = calendarDays(today, finalDate);
  if (!Number.isFinite(remaining) || remaining > 90) return { active: false, daysRemaining: remaining, expected: 0, milestone: "Not Yet Due" };
  if (remaining <= 0) return { active: true, daysRemaining: remaining, expected: 100, milestone: "Final Completion" };
  const anchors = [
    { days: 90, expected: 10, milestone: "90-Day Collection Start" },
    { days: 60, expected: 35, milestone: "60-Day Review" },
    { days: 30, expected: 70, milestone: "30-Day Assembly" },
    { days: 0, expected: 100, milestone: "Final Completion" },
  ];
  let upper = anchors[0];
  let lower = anchors[1];
  for (let index = 0; index < anchors.length - 1; index += 1) {
    if (remaining <= anchors[index].days && remaining >= anchors[index + 1].days) {
      upper = anchors[index];
      lower = anchors[index + 1];
      break;
    }
  }
  const range = upper.days - lower.days || 1;
  const ratio = (upper.days - remaining) / range;
  return {
    active: true,
    daysRemaining: remaining,
    expected: Math.round(upper.expected + (lower.expected - upper.expected) * ratio),
    milestone: upper.milestone,
  };
}

export function closeoutHealthPoints(progress: number, expected: number, active: boolean) {
  if (!active || expected <= 0) return 5;
  return Math.round(Math.min(5, Math.max(0, 5 * progress / expected)) * 10) / 10;
}

export function nextApproval(approvalFlow: unknown, approvals: unknown) {
  const flow = Array.isArray(approvalFlow) ? approvalFlow.map(String) : [];
  const approvedRoles = new Set(Array.isArray(approvals) ? approvals.filter((item) => item && typeof item === "object" && String((item as Record<string, unknown>).decision || "") === "Approved").map((item) => String((item as Record<string, unknown>).role || "")) : []);
  return flow.find((role) => !approvedRoles.has(role)) || "Complete";
}

export function permitOcrSuggestions(input: { fileName?: string; extractedText?: string }) {
  const source = `${input.fileName || ""}\n${input.extractedText || ""}`;
  const permitNumber = source.match(/(?:permit|number|no\.?)\s*[:#-]?\s*([A-Z0-9-]{4,})/i)?.[1] || "";
  const date = source.match(/\b(20\d{2})[-/]([01]?\d)[-/]([0-3]?\d)\b/)?.slice(1, 4);
  const jurisdiction = source.match(/(?:city|county|jurisdiction)\s+(?:of\s+)?([A-Za-z ]{3,40})/i)?.[1]?.trim() || "";
  const closed = /final\s+(?:inspection\s+)?(?:approved|passed)|permit\s+closed|certificate\s+of\s+occupancy/i.test(source);
  return {
    permitNumber,
    jurisdiction,
    inspectionDate: date ? `${date[0]}-${date[1].padStart(2, "0")}-${date[2].padStart(2, "0")}` : "",
    closureStatus: closed ? "Closed / Final Approved" : "Review Required",
    confidence: permitNumber || jurisdiction || date || closed ? "Suggested — PM Verification Required" : "No Reliable Text Detected — Manual Verification Required",
  };
}

export function parseCloseoutData(value: string | Record<string, unknown> | null | undefined) {
  if (value && typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value || "{}")) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function calendarDays(from: string, to: string) {
  const start = new Date(`${from}T12:00:00Z`).getTime();
  const end = new Date(`${to}T12:00:00Z`).getTime();
  return Math.ceil((end - start) / 86_400_000);
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
