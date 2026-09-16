export type OnboardingDocumentField = {
  id: string;
  label: string;
  type: "text" | "date" | "email" | "tel" | "number" | "select" | "textarea" | "checkbox";
  required?: boolean;
  sensitive?: boolean;
  role?: "Employee" | "Employer";
  options?: string[];
  placeholder?: string;
  help?: string;
  fixedValue?: string;
  roleBinding?: string;
  actorName?: boolean;
};

export type OnboardingDocumentDefinition = {
  id: string;
  title: string;
  category: "Federal" | "Kentucky" | "Payroll" | "Benefits" | "Company" | "Safety" | "Vehicle" | "Legal";
  kind: "Official Form" | "Native Form" | "Native Policy";
  version: string;
  phase: "Before Start" | "First Day" | "Role Based";
  applicability: string;
  sourceAuthority: string;
  sourceUrl?: string;
  sourceVerifiedAt: string;
  defaultReleaseStatus: "Ready" | "Provider Confirmation Required" | "Outside Counsel Review Required" | "Safety Review Required";
  reviewer: "Administrator" | "Outside Counsel" | "Safety Director";
  internalReviewerDesignation: "Administrator" | "Accountant" | "Safety Director";
  requiredSigners: Array<"Employee" | "Employer">;
  restricted: boolean;
  retention: string;
  notice: string;
  sections: Array<{ title: string; text: string }>;
  fields: OnboardingDocumentField[];
};

const employeeIdentity: OnboardingDocumentField[] = [
  { id: "firstName", label: "First Name", type: "text", required: true },
  { id: "middleInitial", label: "Middle Initial", type: "text" },
  { id: "lastName", label: "Last Name", type: "text", required: true },
  { id: "address", label: "Street Address", type: "text", required: true },
  { id: "city", label: "City", type: "text", required: true },
  { id: "state", label: "State", type: "text", required: true },
  { id: "zip", label: "ZIP Code", type: "text", required: true },
];

const employerIdentity: OnboardingDocumentField[] = [
  { id: "employerRepresentative", label: "Employer Representative", type: "text", required: true, role: "Employer", actorName: true, help: "Filled from the authenticated reviewer applying the employer signature." },
  { id: "employerTitle", label: "Representative Title", type: "text", required: true, role: "Employer" },
  { id: "employerName", label: "Employer Name", type: "text", required: true, role: "Employer", placeholder: "Mefford Contracting, LLC" },
  { id: "employerAddress", label: "Employer Address", type: "text", required: true, role: "Employer" },
  { id: "employerCityStateZip", label: "Employer City, State And ZIP", type: "text", required: true, role: "Employer" },
];

export const ONBOARDING_DOCUMENTS: OnboardingDocumentDefinition[] = [
  {
    id: "federal-w4-2026",
    title: "Federal Form W-4",
    category: "Federal",
    kind: "Official Form",
    version: "2026",
    phase: "Before Start",
    applicability: "All W-2 Employees",
    sourceAuthority: "Internal Revenue Service",
    sourceUrl: "https://www.irs.gov/pub/irs-pdf/fw4.pdf",
    sourceVerifiedAt: "2026-08-16",
    defaultReleaseStatus: "Ready",
    reviewer: "Administrator",
    internalReviewerDesignation: "Accountant",
    requiredSigners: ["Employee"],
    restricted: true,
    retention: "Keep the signed W-4 for at least four years and retain a printable hardcopy of the electronic submission.",
    notice: "The attached scan contained the obsolete 2020 edition. Command Center uses the current 2026 IRS source and preserves the official instructions link.",
    sections: [
      { title: "Employee Certification", text: "Under penalties of perjury, I declare that this certificate, to the best of my knowledge and belief, is true, correct, and complete." },
      { title: "Official Instructions", text: "Review the complete current IRS form, worksheets, exemption rules, and Privacy Act notice before signing." },
    ],
    fields: [
      ...employeeIdentity,
      { id: "ssn", label: "Social Security Number", type: "text", required: true, sensitive: true, help: "Restricted payroll data." },
      { id: "filingStatus", label: "Filing Status", type: "select", required: true, options: ["Single Or Married Filing Separately", "Married Filing Jointly Or Qualifying Surviving Spouse", "Head Of Household"] },
      { id: "twoJobs", label: "Step 2(c) - Only Two Jobs Total", type: "checkbox" },
      { id: "dependentCredits", label: "Step 3 - Dependent And Other Credits", type: "number", sensitive: true },
      { id: "otherIncome", label: "Step 4(a) - Other Income", type: "number", sensitive: true },
      { id: "deductions", label: "Step 4(b) - Deductions", type: "number", sensitive: true },
      { id: "extraWithholding", label: "Step 4(c) - Extra Withholding Per Pay Period", type: "number", sensitive: true },
      { id: "exempt2026", label: "I Claim Exemption From Withholding For 2026 And Meet Both IRS Conditions", type: "checkbox" },
    ],
  },
  {
    id: "kentucky-k4-2026",
    title: "Kentucky Form K-4",
    category: "Kentucky",
    kind: "Official Form",
    version: "2026",
    phase: "Before Start",
    applicability: "Kentucky Employees Requesting An Exemption Or Additional Withholding",
    sourceAuthority: "Kentucky Department of Revenue",
    sourceUrl: "https://revenue.ky.gov/Forms/42A804%20%28K-4%29%20%282026%29.pdf",
    sourceVerifiedAt: "2026-08-16",
    defaultReleaseStatus: "Ready",
    reviewer: "Administrator",
    internalReviewerDesignation: "Accountant",
    requiredSigners: ["Employee"],
    restricted: true,
    retention: "Retain every K-4 received from an employee.",
    notice: "The 2026 Kentucky instructions say K-4 is required only for an exemption request or additional withholding.",
    sections: [
      { title: "Employee Certification", text: "Under penalties of perjury, I declare that I have examined this certificate and, to the best of my knowledge and belief, it is true, correct, and complete." },
      { title: "Conditional Form", text: "Employees without an exemption or additional withholding request may mark this item not applicable." },
    ],
    fields: [
      ...employeeIdentity,
      { id: "ssn", label: "Social Security Number", type: "text", required: true, sensitive: true },
      { id: "requestType", label: "Kentucky Request", type: "select", required: true, options: ["No K-4 Required", "No Kentucky Income Tax Liability Expected", "Fort Campbell Exemption", "Nonresident Military Spouse Exemption", "Reciprocal State Exemption", "Additional Withholding"] },
      { id: "reciprocalState", label: "Reciprocal State Or Military Domicile", type: "text" },
      { id: "additionalWithholding", label: "Additional Withholding Per Pay Period", type: "number", sensitive: true },
    ],
  },
  {
    id: "uscis-i9-current",
    title: "USCIS Form I-9",
    category: "Federal",
    kind: "Official Form",
    version: "08/01/23 Edition · Current USCIS Extension",
    phase: "Before Start",
    applicability: "All Employees Hired For Employment In The United States",
    sourceAuthority: "U.S. Citizenship and Immigration Services",
    sourceUrl: "https://www.uscis.gov/sites/default/files/document/forms/i-9.pdf",
    sourceVerifiedAt: "2026-08-16",
    defaultReleaseStatus: "Ready",
    reviewer: "Administrator",
    internalReviewerDesignation: "Administrator",
    requiredSigners: ["Employee", "Employer"],
    restricted: true,
    retention: "Retain for three years after hire or one year after employment ends, whichever is later, using an inspectable electronic record.",
    notice: "The scanned packet used an expired 2017 edition. Employees choose which acceptable documents to present; Mefford must not direct document selection.",
    sections: [
      { title: "Anti-Discrimination Notice", text: "Mefford cannot specify which acceptable identity and work-authorization documents an employee must present." },
      { title: "Two-Part Completion", text: "The employee completes and signs Section 1. An authorized employer representative separately reviews original acceptable documents and completes Section 2." },
    ],
    fields: [
      ...employeeIdentity,
      { id: "otherLastNames", label: "Other Last Names Used", type: "text" },
      { id: "birthDate", label: "Date Of Birth", type: "date", required: true, sensitive: true },
      { id: "ssn", label: "Social Security Number", type: "text", sensitive: true },
      { id: "employeeEmail", label: "Employee Email", type: "email", required: true },
      { id: "employeePhone", label: "Employee Telephone", type: "tel", required: true },
      { id: "citizenshipStatus", label: "Citizenship Or Immigration Status", type: "select", required: true, sensitive: true, options: ["Citizen Of The United States", "Noncitizen National Of The United States", "Lawful Permanent Resident", "Noncitizen Authorized To Work"] },
      { id: "uscisOrI94", label: "USCIS, A-Number, I-94, Or Foreign Passport Information When Applicable", type: "text", sensitive: true },
      { id: "preparerTranslator", label: "Preparer Or Translator Used", type: "select", required: true, options: ["No", "Yes"] },
      { id: "firstDay", label: "Employee First Day Of Employment", type: "date", required: true, role: "Employer" },
      { id: "documentPath", label: "Document Path Reviewed", type: "select", required: true, role: "Employer", options: ["One List A Document", "One List B And One List C Document"] },
      { id: "documentTitles", label: "Document Titles And Issuing Authorities", type: "textarea", required: true, role: "Employer" },
      { id: "documentNumbers", label: "Document Numbers And Expiration Dates", type: "textarea", required: true, role: "Employer", sensitive: true },
      { id: "alternativeProcedure", label: "Authorized E-Verify Alternative Procedure Used", type: "checkbox", role: "Employer" },
      ...employerIdentity,
    ],
  },
  {
    id: "direct-deposit",
    title: "Paylocity Account And Direct Deposit Setup",
    category: "Payroll",
    kind: "Native Form",
    version: "Paylocity Boundary 2026.2",
    phase: "Before Start",
    applicability: "All Employees Using Paylocity Payroll",
    sourceAuthority: "Mefford Contracting · Paylocity Is The Payroll System Of Execution",
    sourceVerifiedAt: "2026-08-17",
    defaultReleaseStatus: "Ready",
    reviewer: "Administrator",
    internalReviewerDesignation: "Accountant",
    requiredSigners: ["Employee", "Employer"],
    restricted: true,
    retention: "Retain the setup acknowledgment and Paylocity employee-reference last four. Banking credentials and account numbers stay out of Command Center.",
    notice: "Paylocity is confirmed. Employees enter and maintain banking information directly in Paylocity; Command Center stores only setup acknowledgment and verification evidence.",
    sections: [
      { title: "Employee Boundary", text: "I understand Paylocity is the payroll system. I will enter or update direct-deposit and payroll account information inside my Paylocity account, not in Command Center." },
      { title: "Accounting Verification", text: "The live employee holding the Accountant designation confirms account activation using only the Paylocity employee-reference last four and verification date." },
    ],
    fields: [
      { id: "paylocityAccountActivated", label: "I Activated Or Confirmed Access To My Paylocity Account", type: "checkbox", required: true },
      { id: "directDepositConfigured", label: "I Entered Or Confirmed My Direct-Deposit Instructions Inside Paylocity", type: "checkbox", required: true },
      { id: "bankingBoundary", label: "I Did Not Enter Banking Credentials Or Account Numbers In Command Center", type: "checkbox", required: true },
      { id: "payrollProvider", label: "Payroll System Of Execution", type: "text", required: true, role: "Employer", fixedValue: "Paylocity" },
      { id: "paylocityEmployeeLastFour", label: "Paylocity Employee Reference · Last Four Only", type: "text", required: true, role: "Employer", sensitive: true },
      { id: "paylocityAccountStatus", label: "Paylocity Account Status", type: "select", required: true, role: "Employer", options: ["Active And Verified", "Invite Pending", "Employee Action Required"] },
      { id: "payrollVerifiedBy", label: "Verified By", type: "text", required: true, role: "Employer", roleBinding: "Accountant" },
      { id: "payrollVerificationDate", label: "Verification Date", type: "date", required: true, role: "Employer" },
    ],
  },
  {
    id: "beneficiary-designation",
    title: "Life Insurance Beneficiary Designation",
    category: "Benefits",
    kind: "Native Form",
    version: "Northwestern Mutual Life Draft 2026.2",
    phase: "Before Start",
    applicability: "Employees Enrolled In Northwestern Mutual Employee Life Insurance",
    sourceAuthority: "Northwestern Mutual · Employee Life Insurance Only",
    sourceVerifiedAt: "2026-08-17",
    defaultReleaseStatus: "Provider Confirmation Required",
    reviewer: "Administrator",
    internalReviewerDesignation: "Accountant",
    requiredSigners: ["Employee"],
    restricted: true,
    retention: "Retain the latest signed designation and preserve superseded designations in the audit history.",
    notice: "Northwestern Mutual is confirmed for employee life insurance only. Health coverage is UnitedHealthcare. This form remains held only until the current group life policy number and plan language are confirmed.",
    sections: [{ title: "Designation Rule", text: "Primary and contingent beneficiary percentages must each total 100%. A new signed designation supersedes the prior designation." }],
    fields: [
      { id: "employeeBirthDate", label: "Employee Birth Date", type: "date", required: true, sensitive: true },
      { id: "carrier", label: "Life Insurance Carrier", type: "text", required: true, role: "Employer", fixedValue: "Northwestern Mutual" },
      { id: "policyNumber", label: "Confirmed Policy Number", type: "text", required: true, role: "Employer", sensitive: true },
      { id: "primaryBeneficiary", label: "Primary Beneficiary - Name, Address, Birth Date, Phone, Relationship And Percentage", type: "textarea", required: true, sensitive: true },
      { id: "primaryTotal", label: "Primary Percentage Total", type: "number", required: true },
      { id: "contingentBeneficiary", label: "Contingent Beneficiary - Name, Address, Birth Date, Phone, Relationship And Percentage", type: "textarea", sensitive: true },
      { id: "contingentTotal", label: "Contingent Percentage Total", type: "number" },
    ],
  },
  {
    id: "emergency-contact",
    title: "Employee Emergency Contacts",
    category: "Company",
    kind: "Native Form",
    version: "2026.1",
    phase: "Before Start",
    applicability: "All Employees · Review Annually",
    sourceAuthority: "Mefford Contracting",
    sourceVerifiedAt: "2026-08-16",
    defaultReleaseStatus: "Ready",
    reviewer: "Administrator",
    internalReviewerDesignation: "Administrator",
    requiredSigners: ["Employee"],
    restricted: true,
    retention: "Retain while employed; replace through a new signed revision when contact information changes.",
    notice: "Recreated as a native private form. The scanned page is not stored.",
    sections: [{ title: "Authorization", text: "I voluntarily provide this information and authorize Mefford Contracting representatives to contact the listed people on my behalf during an emergency." }],
    fields: [
      { id: "homeAddress", label: "Home Address", type: "text", required: true, sensitive: true },
      { id: "personalPhone", label: "Personal Phone", type: "tel", required: true, sensitive: true },
      { id: "contact1", label: "Primary Contact - Name And Relationship", type: "text", required: true, sensitive: true },
      { id: "contact1Phone", label: "Primary Contact Phone", type: "tel", required: true, sensitive: true },
      { id: "contact1Address", label: "Primary Contact Address", type: "text", sensitive: true },
      { id: "contact2", label: "Secondary Contact - Name And Relationship", type: "text", sensitive: true },
      { id: "contact2Phone", label: "Secondary Contact Phone", type: "tel", sensitive: true },
      { id: "doctor", label: "Doctor Name And Phone (Optional)", type: "text", sensitive: true },
      { id: "dentist", label: "Dentist Name And Phone (Optional)", type: "text", sensitive: true },
    ],
  },
  {
    id: "background-authorization",
    title: "Background And Motor Vehicle Report Authorization",
    category: "Legal",
    kind: "Native Form",
    version: "FCRA Stand-Alone Draft 2026.1",
    phase: "Before Start",
    applicability: "Only Roles With An Approved Job-Related Screening Requirement",
    sourceAuthority: "Mefford Contracting · FTC/EEOC Guidance Applied",
    sourceUrl: "https://www.ftc.gov/business-guidance/resources/background-checks-what-employers-need-know",
    sourceVerifiedAt: "2026-08-16",
    defaultReleaseStatus: "Outside Counsel Review Required",
    reviewer: "Outside Counsel",
    internalReviewerDesignation: "Administrator",
    requiredSigners: ["Employee"],
    restricted: true,
    retention: "Apply the approved screening-provider and employment-record retention policy; securely dispose when retention ends.",
    notice: "The scan bundled broad releases and sensitive questions. This replacement keeps the FCRA disclosure and authorization stand-alone pending attorney approval.",
    sections: [
      { title: "Disclosure", text: "Mefford Contracting may obtain a consumer report for employment purposes from an approved consumer reporting agency. The report may include identity, employment, criminal-history, driving-record, or other job-related background information permitted by law." },
      { title: "Authorization", text: "I authorize Mefford Contracting to obtain the described employment-purpose consumer report after receiving this stand-alone disclosure." },
    ],
    fields: [
      { id: "legalName", label: "Legal Name", type: "text", required: true },
      { id: "currentAddress", label: "Current Address", type: "text", required: true, sensitive: true },
      { id: "formerNames", label: "Former Names Used For Identification", type: "text", sensitive: true },
      { id: "driverLicense", label: "Driver License Number And State When An MVR Is Authorized", type: "text", sensitive: true },
      { id: "screeningScope", label: "Authorized Screening Scope", type: "select", required: true, options: ["Employment Background Report", "Motor Vehicle Report", "Employment Background And Motor Vehicle Reports"] },
    ],
  },
  {
    id: "safety-handbook-acknowledgment",
    title: "Construction Safety Handbook Acknowledgment",
    category: "Safety",
    kind: "Native Policy",
    version: "Reconstructed From 02/11/2019 Source · Draft 2026.1",
    phase: "First Day",
    applicability: "Field Employees And Project Leadership",
    sourceAuthority: "Mefford Contracting",
    sourceVerifiedAt: "2026-08-16",
    defaultReleaseStatus: "Safety Review Required",
    reviewer: "Safety Director",
    internalReviewerDesignation: "Safety Director",
    requiredSigners: ["Employee", "Employer"],
    restricted: false,
    retention: "Retain the signed acknowledgment with the employee lifecycle record.",
    notice: "The safety handbook has been reconstructed into web sections, but the 2019 policy content remains held until the current Safety Reviewer approves it.",
    sections: [
      { title: "Core Responsibilities", text: "Employees must follow company and site safety rules, use required protective equipment, report hazards and injuries immediately, request help when unsure, and stop work when unsafe conditions exist." },
      { title: "Workplace Controls", text: "The handbook addresses housekeeping, fall protection, scaffolds, ladders, machinery, excavations, electrical tools, hot work, compressed gas, fire prevention, public protection, material handling, hazardous materials, and emergency response." },
      { title: "Acknowledgment", text: "I received access to the current Mefford Construction Employee Safety Handbook, received orientation on its contents, and agree to follow the handbook and later communicated safety requirements." },
    ],
    fields: [
      { id: "position", label: "Employee Position", type: "text", required: true },
      { id: "orientationDate", label: "Orientation Date", type: "date", required: true },
      { id: "orientationDeliveredBy", label: "Orientation Delivered By", type: "text", required: true, role: "Employer", roleBinding: "Safety Director" },
      { id: "reviewerPosition", label: "Reviewer Position", type: "text", required: true, role: "Employer", fixedValue: "Safety Director" },
    ],
  },
  {
    id: "vehicle-policy",
    title: "Company Vehicle Policy And Driver Authorization",
    category: "Vehicle",
    kind: "Native Policy",
    version: "Reconstructed From 09/30/2020 Source · Draft 2026.1",
    phase: "Role Based",
    applicability: "Employees Assigned Or Authorized To Drive A Company Vehicle",
    sourceAuthority: "Mefford Contracting",
    sourceVerifiedAt: "2026-08-16",
    defaultReleaseStatus: "Outside Counsel Review Required",
    reviewer: "Outside Counsel",
    internalReviewerDesignation: "Safety Director",
    requiredSigners: ["Employee", "Employer"],
    restricted: true,
    retention: "Retain the current authorization and audit every superseded version.",
    notice: "Vehicle rules were recreated as native text. The separate background-report authorization remains a separate document.",
    sections: [
      { title: "Driver Duties", text: "Drivers must maintain a valid license, operate safely and soberly, follow traffic and distracted-driving laws, document expenses, inspect the vehicle, maintain required records, and report accidents and maintenance needs immediately." },
      { title: "Prohibited Use", text: "No smoking, unauthorized drivers, lending or selling, impaired driving, illegal drug use, unsafe parking, or personal use outside the approved policy. Driving privileges may be suspended or revoked for violations." },
    ],
    fields: [
      { id: "employeePosition", label: "Employee Position", type: "text", required: true },
      { id: "driverLicense", label: "Driver License Number", type: "text", required: true, sensitive: true },
      { id: "licenseState", label: "License State", type: "text", required: true },
      { id: "birthDate", label: "Birth Date", type: "date", required: true, sensitive: true },
      { id: "approvalStatus", label: "Driver Approval Status", type: "select", required: true, role: "Employer", options: ["Approved", "Approved With Restrictions", "Not Approved"] },
      { id: "verificationReference", label: "License And MVR Verification Reference", type: "text", required: true, role: "Employer", sensitive: true },
    ],
  },
  {
    id: "employee-handbook-acknowledgment",
    title: "Employee Handbook Acknowledgment",
    category: "Company",
    kind: "Native Policy",
    version: "Reconstructed From 07/16/2025 Source · Draft 2026.1",
    phase: "First Day",
    applicability: "All Employees",
    sourceAuthority: "Mefford Contracting",
    sourceVerifiedAt: "2026-08-16",
    defaultReleaseStatus: "Outside Counsel Review Required",
    reviewer: "Outside Counsel",
    internalReviewerDesignation: "Administrator",
    requiredSigners: ["Employee"],
    restricted: false,
    retention: "Retain the signed acknowledgment for the applicable handbook version.",
    notice: "The handbook text was reconstructed as native, searchable policy content. It is held for attorney review because several employment-law provisions require current confirmation.",
    sections: [
      { title: "Company Foundation", text: "Mission, values, equal opportunity, employment classifications, work schedules, dress, personnel records, evaluations, holidays, PTO, attendance, jury duty, leave, benefits, outside employment, resignation, and disciplinary expectations." },
      { title: "Workplace Standards", text: "At-will employment, anti-harassment, reimbursements, smoking, injury reporting, return-to-work, alcohol and drug testing, vehicle rules, safety, cell phones, education, weapons, and employee suggestions." },
      { title: "Acknowledgment", text: "I received access to, read, and understand the current Mefford Contracting Employee Handbook. I understand it is not an employment contract and that only the published current version governs." },
    ],
    fields: [{ id: "employeePosition", label: "Employee Position", type: "text", required: true }],
  },
];

export function onboardingDocumentById(id: string) {
  return ONBOARDING_DOCUMENTS.find((document) => document.id === id);
}

export function onboardingDocumentRecordId(employeeEmail: string, documentId: string) {
  return `ONBOARDING-FORM-${employeeEmail.trim().toLowerCase()}-${documentId}`;
}

export function onboardingTemplateRecordId(documentId: string) {
  return `ONBOARDING-DOC-${documentId}`;
}

export function requiredFieldsForRole(document: OnboardingDocumentDefinition, role: "Employee" | "Employer") {
  return document.fields.filter((field) => field.required && (field.role || "Employee") === role);
}
