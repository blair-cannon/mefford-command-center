import {
  evaluateEvidenceStatus,
  normalizeEvidenceCheck,
  overallEvidenceStatus,
  statusCounts,
  type SystemHealthEvidenceCheck,
  type SystemHealthStatus,
} from "./system-health-evidence.js";

export type WorkflowAuditItem = {
  id: string;
  name: string;
  systems: string[];
  trigger: string;
  automation: string;
  result: string;
  humanGate: string;
  externalBoundary: string;
};

export type IntelligenceCoverageItem = {
  id: string;
  name: string;
  kind: "OCR" | "OpenAI" | "Native Data";
  intake: string;
  extraction: string;
  downstream: string[];
  review: string;
  connectionKey: string;
};

type MeasuredWorkflowAuditItem = WorkflowAuditItem & {
  status: SystemHealthStatus;
  evidence: SystemHealthEvidenceCheck[];
  verifiedEvidence: number;
  requiredEvidence: number;
  lastObservedAt: string;
};

type MeasuredIntelligenceCoverageItem = IntelligenceCoverageItem & {
  status: SystemHealthStatus;
  evidence: SystemHealthEvidenceCheck[];
  verifiedEvidence: number;
  requiredEvidence: number;
  lastObservedAt: string;
};

const workflow = (
  id: string,
  name: string,
  systems: string[],
  trigger: string,
  automation: string,
  result: string,
  humanGate: string,
  externalBoundary = "No external connection is required for the internal handoff",
): WorkflowAuditItem => ({ id, name, systems, trigger, automation, result, humanGate, externalBoundary });

export const WORKFLOW_AUDIT: WorkflowAuditItem[] = [
  workflow("sales-to-estimating-turnover", "Sales To Estimating Turnover", ["Sales Funnel", "Estimating", "Meetings", "My Work"], "A qualified opportunity enters estimating", "Creates a deduplicated meeting, live source packet, required participants and assigned gap work; refreshes changed sources and retains prior acceptance evidence", "Receiving estimator accepts the reviewed source revision", "Receiver review and acceptance stay explicit; external invitations are not sent automatically"),
  workflow("crm-to-award", "Contact To Contracted Project", ["Business Card Intake", "Company Identity Guard", "Sales Contacts", "Sales Funnel", "Sales Design", "Estimating", "Owner Proposal", "Project Overview", "Budget", "Owner Contract", "Accounting"], "A business card is reviewed into a contact and resolved to one canonical company, then a qualified opportunity is sent to estimating and later awarded by a Company Owner", "Preserves the original card, prefills reviewed contact details, resolves abbreviations and spelling variations without silent merges, and reuses the company, contacts, project facts, sales design, approved estimate, proposal basis, project team, dates, budget, contract draft, billing setup, closeout plan, and accounting contract setup", "One project record with one canonical company, the approved contact, and the original estimate basis carried forward", "Contact OCR review, company identity resolution, Estimator approval, and Company Owner award remain explicit"),
  workflow("owner-contract-portal", "Awarded Project To Executed Owner Contract", ["Estimating", "Owner Contract", "Project Owner Portal", "Project Overview", "Schedule", "Owner Billing", "Accounting", "Documents"], "The awarded estimate creates a dormant owner-access capability and controlled contract draft", "PM/Admin prepares the draft, Company Owner releases an immutable revision, the Project Owner accepts or requests clause-level changes, Mefford responds through new revisions, Company Owner freezes the final, the Project Owner signs first, and Mefford countersigns", "One executed contract revision updates the project, billing, accounting, milestone dates, owner-visible documents, and permanent audit without exposing internal records", "Customer access, every revision decision, final freeze, and both signatures remain explicit human actions", "Microsoft invitation delivery is connection-gated; a secure manual link remains available"),
  workflow("quotes-to-proposal", "Quote To Proposal Scope", ["Vendor Portal", "Bid Management", "Estimate Files", "Estimating", "Owner Proposal"], "A subcontractor submits a quote", "Preserves the original, extracts price and scope, requires review, compares revisions and bidders, writes the selected price to the estimate line, and drafts the owner-facing CSI scope", "A traceable proposal scope tied to the exact selected quote revision", "Human OCR confirmation, leveling, quote selection, and proposal approval remain separate", "Operational email and external delivery are connection-gated"),
  workflow("award-to-commitment", "Awarded Estimate To Commitment Drafts", ["Estimating", "Bid Management", "Project Procurement", "Subcontracts", "Purchase Orders", "Budget", "Vendor Management"], "The owner awards the project", "Copies selected bid packages and immutable pricing evidence into project procurement and prepares the recommended subcontract or purchase-order draft", "PM-ready commitment drafts without committing Mefford", "The PM may revise or mark Do Not Award; release, signatures, and threshold approvals stay human-gated"),
  workflow("change-order-control", "Executed Change Order Control", ["Change Orders", "Owner Contract", "Budget", "Schedule", "Owner Billing", "Project Health", "Documents"], "A change order completes pricing, internal approval, and owner execution", "Creates the permanent executed document reference and updates current contract value, approved budget changes, schedule impact, owner billing visibility, and project health evidence", "One executed change reflected everywhere downstream", "Pricing, internal release, owner execution, and billing remain distinct decisions"),
  workflow("selection-to-purchase", "Selection To Purchase And Cost", ["Selections", "Budget", "Purchase Orders", "Procurement", "Accounts Payable", "Schedule"], "A project selection is approved and released", "Carries the chosen material, source, cost code, price, required delivery, and variance into a PO draft and procurement tracking; AP can match the resulting commitment", "Ordered/not-ordered status, delivery exposure, and budget effect stay aligned", "Owner selection, PM release, PO approval, and payment remain separate"),
  workflow("schedule-to-quality", "Schedule To Pre-Work Quality", ["Schedule", "Quality", "My Work", "Project Health", "Closeout"], "A schedule activity approaches its planned start", "Maps the activity to the quality category, creates the pre-work checklist prompt, routes accountable work, exposes misses in health, and transfers unresolved evidence to closeout", "No scheduled work starts without visible readiness evidence", "The superintendent verifies field readiness and the PM/designer accepts controlled results"),
  workflow("field-to-performance", "Field Reporting To Company Performance", ["Daily Logs", "Weather", "Safety", "Schedule", "Project Health", "Performance Reviews"], "The field team completes daily work, toolbox talks, inspections, or incident records", "Locks daily rainfall and average conditions, measures timeliness and schedule adherence, routes safety corrections, recalculates project health, and supplies linked quarterly evidence", "Objective project and employee evidence from the same source records", "Safety classifications, corrective closure, and employee review decisions remain human-controlled", "Automatic weather is credential-free but provider availability is monitored"),
  workflow("drawing-intelligence", "Drawing Upload To Project Intelligence", ["Project Files", "Design & Drawings", "Drawing Index", "Search", "Schedule", "Quality", "Procurement"], "A PDF or image is uploaded to any drawing, design, floor-plan, or rendering category", "Runs text-layer extraction plus OCR, indexes sheet numbers, titles, disciplines, revision dates, and review confidence, and makes the controlled metadata available to search and drawing-grounded schedule drafts", "A searchable revision-aware drawing source for downstream work", "Low-confidence metadata and every AI schedule draft require human review", "OpenAI is required only for requested schedule drafting; drawing OCR itself runs inside Command Center"),
  workflow("ap-to-job-cost", "Invoice To Job Cost And Cash", ["Accounts Payable", "Subcontracts", "Purchase Orders", "Budget", "Cash Management", "General Ledger", "Project Health"], "Accounting receives a vendor invoice", "OCR-prefills review fields, finds matching commitments, blocks duplicates, enforces balanced allocations, routes project/accounting/owner approval, prepares payment without executing it, and posts approved cost evidence through the controlled ledger workflow", "One invoice feeds AP, project cost, cash exposure, and financial reporting", "A person verifies OCR and allocations; payment release and posting remain controlled"),
  workflow("owner-billing", "Project Cost To Owner Billing And WIP", ["Budget", "Schedule", "Accounts Payable", "Change Orders", "Owner Billing", "Cash Management", "WIP And Close", "Financial Reports"], "The monthly billing cycle reaches its draft date", "Builds the draft from the locked SOV, current progress, approved changes, retained cost evidence, and prior billing; receipts update AR and cash views", "The same contract and cost facts drive billing, WIP, backlog, and management reporting", "PM preparation, Accounting review, Owner approval, external distribution, and receipt remain separate"),
  workflow("payroll-exchange", "Employee Time To Payroll Cost", ["My Employee Home", "Employee Time", "Payroll Reports", "Accounting", "Project Job Cost", "Paylocity"], "Employees submit time for the 1–15 or 16–month-end period", "Builds the period payroll packet for Accounting and imports the returned Paylocity report into reconciled labor-cost detail", "Time is entered once and returned payroll cost reaches the right projects", "Command Center never runs or approves payroll; Accounting controls the manual Paylocity exchange"),
  workflow("employee-lifecycle", "Hire To Productive Employee", ["Employee Onboarding", "Review Center", "Team & Access", "My Employee Home", "My Work", "Benefits", "Training"], "An employee is hired or a controlled form/resource changes", "Builds the role-aware onboarding cycle, serves native forms and approved resources, locks unrelated access until activation, and carries current email, calendar, payroll, benefits, training, goals, and work links into one employee home", "A first-day path that requires no separate administrator explanation", "Administrator onboarding verification, Company Owner access approval, and controlled-template publication stay human-authorized", "Microsoft, Paylocity, and carrier links remain connection- or provider-managed"),
  workflow("customer-voice", "Project Milestone To Customer Voice", ["Owner Contract", "Design & Drawings", "Schedule", "Closeout", "Customer Surveys", "Marketing", "Performance Reviews"], "Contract signing, Design-Build release, project midpoint, or closeout is reached", "Creates one idempotent secure request, sends it when the mailbox is connected, records the response and consent separately, and feeds project/team evidence and approved marketing use", "Customer feedback improves the current job and future company learning", "Public testimonial use and employee review decisions remain human-controlled", "Automatic email delivery is connection-gated; the secure manual link remains available"),
  workflow("asset-accounting", "Asset Operations To Accounting", ["Assets & Fleet", "My Work", "Projects", "Accounting", "General Ledger"], "An asset is acquired, assigned, serviced, impaired, written off, or retired", "Keeps custody and operational status separate from book/tax treatment, creates service and compliance work, and prepares balanced journal drafts tied to the asset", "Operational and accounting views stay linked without confusing field availability with tax treatment", "Accountant review, tax elections, independent journal approval, and posting remain human-controlled"),
  workflow("closeout-payment", "Closeout Evidence To Final Payment", ["Closeout", "Documents", "Lien Waivers", "Accounts Payable", "Owner Billing", "Warranty", "Project Health"], "The project approaches substantial and final completion", "Creates the 90/60/30-day plan, collects versioned evidence, extracts permit metadata, routes approvals, carries deficiencies forward, and holds final payment gates until required evidence is approved", "A complete owner turnover package and traceable warranty record", "PM, Superintendent, Accounting, Project Owner, and final Company authorization gates remain explicit"),
  workflow("meeting-accountability", "Meeting Decision To Assigned Work", ["Meetings", "Teams", "My Work", "Project Records", "Performance Reviews"], "An agenda item becomes a decision or action", "Carries forward unresolved work, routes assignments and reminders, links source evidence, and measures acknowledgement and completion without inventing attendance", "Meeting commitments appear in the assignee's daily work and quarterly evidence", "Leaders confirm decisions, attendance, publication, and final minutes", "Outlook, Teams, recording, transcript, and email are connection-gated"),
  workflow("integration-accountability", "Integration Incident To IT Accountability", ["IT & Integrations", "My Work", "System Health", "Performance Reviews"], "A provider fails, degrades, requires reauthorization, or produces a sync conflict", "Creates safe retries, preserves both conflict versions, routes incidents and escalations, records response/recovery clocks, and supplies fair IT performance evidence", "No connection failure stays isolated or silently overwrites a record", "Sensitive replay and recovery decisions retain Accounting and Company Owner gates"),
];

const REQUIRED_WORKFLOW_EVIDENCE: SystemHealthEvidenceCheck[] = [
  { key: "runtime-handoff", label: "Upstream-To-Downstream Reconciliation", status: "Unknown", source: "Production Handoff Probe", detail: "No current request-to-result reconciliation has been recorded for this workflow." },
  { key: "authorization", label: "Human Authority Boundary Test", status: "Unknown", source: "Executable Permission Test", detail: "No executable approval and denial-path test has been recorded for the current release." },
  { key: "release-test", label: "Current Release End-To-End Test", status: "Unknown", source: "Release Verification", detail: "No passing end-to-end test evidence has been attached to the current deployed version." },
];

const REQUIRED_INTELLIGENCE_EVIDENCE: SystemHealthEvidenceCheck[] = [
  { key: "runtime-use", label: "Observed Production Result", status: "Unknown", source: "Runtime Evidence", detail: "No current source-to-result production evidence has been recorded." },
  { key: "review-boundary", label: "Human Review Boundary Test", status: "Unknown", source: "Executable Safeguard Test", detail: "No executable test proves the current release preserves the required human review boundary." },
  { key: "release-test", label: "Current Release Test", status: "Unknown", source: "Release Verification", detail: "No passing functional test evidence has been attached to the current deployed version." },
];

function measured<T extends { id: string }>(item: T, required: SystemHealthEvidenceCheck[], supplied: SystemHealthEvidenceCheck[], now: Date) {
  const suppliedByKey = new Map(supplied.map((check) => [check.key, check]));
  const evidence = [
    ...required.map((check) => normalizeEvidenceCheck(suppliedByKey.get(check.key) || check, now)),
    ...supplied.filter((check) => !required.some((requiredCheck) => requiredCheck.key === check.key)).map((check) => normalizeEvidenceCheck(check, now)),
  ];
  return {
    ...item,
    status: evaluateEvidenceStatus(evidence, now),
    evidence,
    verifiedEvidence: evidence.filter((check) => check.required && check.status === "Verified").length,
    requiredEvidence: evidence.filter((check) => check.required).length,
    lastObservedAt: evidence.map((check) => check.observedAt).filter(Boolean).sort().at(-1) || "",
  };
}

export function systemAuditSnapshot(input: { openAiConfigured: boolean; automationOverall: string; evidenceByWorkflow?: Record<string, SystemHealthEvidenceCheck[]>; evidenceByIntelligence?: Record<string, SystemHealthEvidenceCheck[]>; now?: Date }) {
  const now = input.now || new Date();
  const intelligence: IntelligenceCoverageItem[] = [
    { id: "drawing-ocr", name: "Drawings And Design Sets", kind: "OCR", intake: "Every PDF/image in a drawing, design, floor-plan, or rendering category", extraction: "Text layer, sheet number, sheet title, discipline, revision, revision date, confidence, searchable text", downstream: ["Drawing Index", "Search", "Design & Drawings", "Schedule Intelligence", "Quality", "Procurement"], review: "Low-confidence sheets remain flagged for human review; the original file is permanent", connectionKey: "" },
    { id: "business-card-ocr", name: "Business Cards And Contact Intake", kind: "OCR", intake: "Rear-camera capture or selected image in Sales Contact Intake", extraction: "First and last name, company, title, email, preferred phone, street, city, state, postal code, and website suggestions", downstream: ["Sales Contacts", "Sales Funnel", "Estimating", "Marketing Contact Audience"], review: "The original card is restricted and permanent; a person must verify the filled fields before the contact can be saved", connectionKey: "" },
    { id: "quote-ocr", name: "Subcontractor Quotes", kind: "OCR", intake: "Every submitted PDF/image quote and every numbered revision", extraction: "Total price and scope suggestions with source file and character-count evidence", downstream: ["Bid Leveling", "Estimate Line", "Owner Proposal Scope", "Commitment Draft"], review: "A person must confirm price and scope before the quote can enter leveling", connectionKey: "" },
    { id: "invoice-ocr", name: "Vendor Invoices", kind: "OCR", intake: "PDF/image supporting invoice in Accounts Payable", extraction: "Vendor, invoice number, invoice date, due date, total, PO reference, and description suggestions", downstream: ["Accounts Payable", "Commitment Match", "Budget", "Job Cost", "Cash Management"], review: "Accounting verifies every suggestion against the original before saving", connectionKey: "" },
    { id: "mobile-ocr", name: "Field Paper And Mobile Scans", kind: "OCR", intake: "Trusted-device PDF/image capture", extraction: "Searchable text with original and marked copy preserved", downstream: ["Project Files", "Search", "Mobile Scan Review"], review: "The scan is explicitly labeled OCR Review until a person relies on it", connectionKey: "" },
    { id: "closeout-ocr", name: "Permits And Final Inspections", kind: "OCR", intake: "Closeout supporting files and mobile OCR text", extraction: "Permit number, jurisdiction, inspection date, and closure-status suggestions", downstream: ["Closeout", "Final Payment Gate", "Project Health"], review: "The Project Manager must verify the permit metadata", connectionKey: "" },
    { id: "asset-ocr", name: "Asset Registrations, Insurance, Inspections, Warranties And Receipts", kind: "OCR", intake: "PDF/image attached to an asset", extraction: "VIN, license plate, document or policy number, expiration date, service date, and amount suggestions", downstream: ["Assets & Fleet", "Readiness Alerts", "My Work", "Accounting Evidence"], review: "An authorized employee confirms the source; only empty identity or expiration fields may be prefilled", connectionKey: "" },
    { id: "native-forms", name: "Onboarding, Contracts, Proposals, POs And Waivers", kind: "Native Data", intake: "Native web forms and controlled generated documents", extraction: "Structured fields are captured directly instead of OCRing scans", downstream: ["Employee Records", "Contracts", "Accounting", "Project Files", "Audit"], review: "Signatures, legal terms, approvals, and payments are never inferred by OCR", connectionKey: "" },
    { id: "assistant-ai", name: "Always-On Command Center Assistant", kind: "OpenAI", intake: "Permission-filtered projects, records, controlled file metadata, current screen, and user request", extraction: "Source-linked explanations, comparisons, calculations, summaries, and drafts", downstream: ["Employee Guidance", "Search", "Decision Preparation"], review: "Help-only boundary: no record writes, approvals, payments, signatures, payroll, publication, or permission changes", connectionKey: "openai-command-ai" },
    { id: "schedule-ai", name: "Drawing-Grounded Schedule Draft", kind: "OpenAI", intake: "Reviewed drawing index, OCR text, current schedule, project dates, and quality categories", extraction: "Structured activities, dependencies, assumptions, risks, drawing references, and pre-work quality mappings", downstream: ["Schedule Review", "Quality Planning", "Project Health"], review: "Returns a review draft only; a Project Manager must approve every activity before applying it", connectionKey: "openai-command-ai" },
    { id: "performance-ai", name: "Performance Narrative Draft", kind: "OpenAI", intake: "Deterministic role metrics, project health, customer voice, and linked evidence", extraction: "Evidence-grounded quarterly narrative draft", downstream: ["Owner Performance Review"], review: "AI cannot change a score, calibrate an employee, finalize a review, or make an employment decision", connectionKey: "openai-command-ai" },
  ];
  const workflows: MeasuredWorkflowAuditItem[] = WORKFLOW_AUDIT.map((item) => measured(item, REQUIRED_WORKFLOW_EVIDENCE, input.evidenceByWorkflow?.[item.id] || [], now));
  const measuredIntelligence: MeasuredIntelligenceCoverageItem[] = intelligence.map((item) => {
    const supplied = [...(input.evidenceByIntelligence?.[item.id] || [])];
    if (item.connectionKey) supplied.push({ key: "connection", label: "Required Provider Configuration", status: input.openAiConfigured ? "Unknown" : "Not Configured", source: "Runtime Configuration Probe", detail: input.openAiConfigured ? "Required configuration exists, but configuration alone does not prove a successful provider request." : "The required provider configuration is missing.", required: true });
    return measured(item, REQUIRED_INTELLIGENCE_EVIDENCE, supplied, now);
  });
  const isolated = WORKFLOW_AUDIT.filter((item) => item.systems.length < 2);
  const workflowCounts = statusCounts(workflows);
  const intelligenceCounts = statusCounts(measuredIntelligence);
  return {
    overall: overallEvidenceStatus(workflows),
    summary: {
      workflows: WORKFLOW_AUDIT.length,
      verifiedWorkflows: workflowCounts.Verified,
      degradedWorkflows: workflowCounts.Degraded,
      failedWorkflows: workflowCounts.Failed,
      unknownWorkflows: workflowCounts.Unknown,
      notConfiguredWorkflows: workflowCounts["Not Configured"],
      isolatedWorkflows: isolated.length,
      intelligenceUses: intelligence.length,
      verifiedIntelligenceUses: intelligenceCounts.Verified,
      degradedIntelligenceUses: intelligenceCounts.Degraded,
      failedIntelligenceUses: intelligenceCounts.Failed,
      unknownIntelligenceUses: intelligenceCounts.Unknown,
      notConfiguredIntelligenceUses: intelligenceCounts["Not Configured"],
      automationOverall: input.automationOverall,
    },
    principle: "This register describes intended handoffs. A workflow is Verified only when current runtime reconciliation, authority-boundary, and deployed-release test evidence exists.",
    workflows,
    intelligence: measuredIntelligence,
  };
}
