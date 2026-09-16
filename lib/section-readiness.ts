import {
  evaluateEvidenceStatus,
  normalizeEvidenceCheck,
  overallEvidenceStatus,
  statusCounts,
  type SystemHealthEvidenceCheck,
  type SystemHealthStatus,
} from "./system-health-evidence.js";

export type SectionReadiness = {
  id: string;
  name: string;
  scope: "Company" | "Project";
  persistence: string;
  automation: string;
  authority: string;
  connectionBoundary: string;
};

export type MeasuredSectionReadiness = SectionReadiness & {
  status: SystemHealthStatus;
  evidence: SystemHealthEvidenceCheck[];
  verifiedEvidence: number;
  requiredEvidence: number;
  lastObservedAt: string;
};

const company = (id: string, name: string, persistence: string, automation: string, authority: string, connectionBoundary = "Core workflow does not require an external connection"): SectionReadiness => ({ id, name, scope: "Company", persistence, automation, authority, connectionBoundary });
const project = (id: string, name: string, persistence: string, automation: string, authority: string, connectionBoundary = "Core workflow does not require an external connection"): SectionReadiness => ({ id, name, scope: "Project", persistence, automation, authority, connectionBoundary });

export const SECTION_READINESS: SectionReadiness[] = [
  company("company-dashboard", "Company Dashboard", "D1 project and record portfolio", "Decision queue and portfolio metrics recompute from current records", "Role-filtered company and project visibility"),
  company("my-work", "My Work", "Permanent D1 work items, delivery events, and preferences", "Escalations, digests, notice delivery, and source links", "Users act only on their assigned or permitted work", "Email and push delivery remain connection-gated; the in-app queue is live"),
  company("project-health", "Project Health", "Permanent weighted snapshots, rules, exceptions, and audit", "Nightly and event-driven recalculation", "Protected critical rules cannot be bypassed"),
  company("quarterly-review", "Quarterly Rock/Review", "Permanent meeting series, occurrences, decisions, files, and audits", "Agenda rules, carry-forward, action routing, and publication timing", "Leaders confirm decisions and final minutes", "Microsoft calendar, Teams, recording, and email remain connection-gated"),
  company("weekly-l10", "Weekly L10", "Permanent meeting series, occurrences, decisions, files, and audits", "Scorecard agenda rules, carry-forward, action routing, and publication timing", "Leaders confirm decisions and final minutes", "Microsoft calendar, Teams, recording, and email remain connection-gated"),
  company("sales-turnover", "Sales To Estimating Turnover", "Durable source packet, meeting, acceptance revisions and recovery queue", "Estimating requests create the agenda, attachments and assigned gaps", "The assigned estimator reviews and accepts the current revision"),
  company("operations-turnover", "Estimating To Operations Turnover", "Award packet, source references, review history and buyout actions", "Awards prepare the Operations meeting; buyout dates follow the meeting and requirements feed department agendas", "Named PM acceptance and complete required participants; signed-contract sales and billing gates remain separate"),
  company("sales-dashboard", "Sales Dashboard", "D1 sales portfolio records", "Goals, awards, funnel pace, and follow-up indicators", "Sales and leadership scope is enforced"),
  company("sales-contacts", "Sales Contacts", "Permanent canonical company names, aliases, company-resolution decisions, original business-card images, and reviewed OCR evidence", "Phone-camera card OCR prefills contact details while universal acronym, legal-suffix, punctuation, word-overlap, and typo matching prevents duplicate companies before opportunity linking", "A person confirms every OCR suggestion and every potentially separate company; Owner/Admin merges preserve the old name as an alias; Pre-Construction Sales visibility is enforced"),
  company("sales-funnel", "Sales Funnel", "Permanent opportunities, stages, files, and audit", "Follow-up, bid-date, and award/loss routing", "Award remains a controlled human decision"),
  company("sales-design", "Sales Design", "Permanent packages, revisions, approvals, and files", "Award copies the locked basis forward", "Designer approval and PM release stay separate"),
  company("estimating", "Estimating", "Permanent estimate workbooks, versions, and handoff data", "Workbook formulas, alternates, scope, and award handoff", "Estimator and owner controls remain human-gated"),
  company("bid-management", "Bid Management", "Permanent bid packages, original quote files, OCR fields, human review, bidders, revisions, and selected proposal basis in the estimate Quotes folder", "PDF/image OCR extracts price and scope before mandatory review; side-by-side leveling selects one quote into its CSI estimate line and owner-scope draft", "Human quote confirmation and estimate/proposal selection remain separate from Company Owner award and PM commitment confirmation", "Operational email delivery remains connection-gated; secure quote intake and recorded manual transmission are supported"),
  company("marketing", "Marketing", "Permanent campaigns, content drafts, original images, newsletters, calendar events, customer voice, provider references, analytics snapshots, and audit history", "Campaign, calendar, content, employee/contact audience, customer milestone, and channel-performance views recalculate from live records", "External posting, newsletter and survey delivery, and provider analytics require healthy authenticated connections plus explicit approval", "LinkedIn, Facebook, Google Analytics, marketing mailbox, and secure survey delivery remain truthfully connection-gated until configured"),
  company("customer-voice", "Customer Voice", "Permanent milestone requests, verified ratings, written feedback, separate marketing consent, original customer videos, and audit", "Contract signing, Design-Build design release, project midpoint, and closeout create one idempotent request each", "Customer responses inform work and owner reviews; public use requires separate consent and AI never makes an employment decision", "Secure links and external email delivery remain connection-gated; direct verified response capture is live"),
  company("sales-goals", "Sales Goals", "Permanent company and salesperson goals", "Pace and attainment metrics", "Company Owner controls the targets"),
  company("employee-portal", "My Employee Home", "Permanent employee cycle, completion evidence, and administrator-managed work, payroll, and benefits links", "One-next-action onboarding, role-aware requirements, renewal countdowns, and live resource updates", "Each employee sees only their record; provider links never run payroll or change plan coverage"),
  company("employee-onboarding", "Employee Onboarding", "Permanent employee, requirement, content-version, and audit records", "Hire-date cycles, reminders, expirations, and access locks", "Administrator onboarding verification and Company Owner access approval are mandatory; locked users cannot self-unlock"),
  company("accounting-command", "Accounting Command", "Coordinated D1 accounting ledger", "AP, billing, cash, payroll, WIP, and reporting handoffs", "Accounting and owner approval gates remain separate", "External accounting and banking posting remain connection-gated"),
  company("chart-of-accounts", "Chart Of Accounts", "Permanent controlled company account master", "Account validation and coordinated selection lists", "Restricted accounting roles manage accounts", "External accounting synchronization remains connection-gated"),
  company("general-ledger", "General Ledger", "Permanent journal entries, opening balances, posting snapshots, reversals, and audit", "Balanced-entry validation, trial balance, spreadsheet insertion, and export", "Preparer, independent approver, and poster controls are enforced"),
  company("accounts-payable", "Accounts Payable", "Permanent invoices, original supporting files, human-reviewed OCR evidence, allocations, commitments, batches, and audit", "Invoice OCR suggestions, duplicate detection, commitment matching, PO warnings, routing, and job-cost handoff", "Accounting verifies OCR and allocations; review, approval, payment preparation, and payment remain separate", "Bank, card, and accounting posting remain connection-gated"),
  company("company-lien-waivers", "Lien Waivers", "Permanent requests, signatures, reviews, payment evidence, and controlled PDFs", "State and payment-stage routing", "No automatic signature, approval, or unconditional release"),
  company("owner-billing", "Owner Billing", "Permanent draft, review, finalization, and receipt records", "Monthly draft coordination and project cost updates", "PM, Accounting, Owner, distribution, and payment steps stay separate", "Email and accounting posting remain connection-gated"),
  company("cash-management", "Cash Management", "Permanent batch, wire, card, and receipt coordination records", "Expected cash and approval routing", "Company Owner release remains mandatory", "Bank execution remains connection-gated"),
  company("payroll-reports", "Payroll Reports", "Permanent period-specific Paylocity packet records and returned-report reconciliations", "Manual period-file creation and returned labor-cost distribution", "Accounting access and returned-report posting remain role-restricted", "Paylocity is intentionally not connected; files move manually and only reconciled returns post job cost"),
  company("wip-close", "WIP And Close", "Permanent close-period and WIP records", "Project-to-company financial reconciliation", "Accounting review and owner signoff remain explicit", "External accounting posting remains connection-gated"),
  company("financial-reports", "Financial Reports", "Immutable D1 report-run snapshots", "As-of recomputation, comparisons, drilldown, and exports", "Financial visibility is role-restricted", "Statutory books remain connection-gated and are never fabricated"),
  company("vendor-management", "Vendor Management", "Permanent vendor, compliance, invite, project-scope, and audit records", "Expiration creates a payment-only hold without slowing project workflows", "Temporary approvals require authenticated Owner identity, scope, reason, expiration, and permanent audit", "Operational email remains connection-gated; secure invite creation is live"),
  company("assets-fleet", "Assets & Fleet", "Permanent asset profiles, custody, inspections, maintenance, issues, private R2 documents, reviewed OCR evidence, costs, and audit history", "Document OCR fills only confirmed empty identity/expiration fields; hourly service, registration, insurance, inspection, meter, stale-tracker, geofence, loss, and lockout work routing", "Field users confirm OCR, inspect, and report; authorized asset managers control assignments and return to service; accounting costs remain restricted", "Core register and field workflows are live; GPS and geofences remain truthfully connection-gated until a tested provider is connected"),
  company("review-center", "Review Center", "Permanent Legal, HR, Benefits, and company-wide controlled masters, versions, files, review, and signoff", "Department upload routing, employee benefit publication, annual inventory, and due-review routing", "No uploaded change publishes without Company Owner signoff; prior versions remain permanent"),
  company("performance-reviews", "Company Performance Center", "Owner-only quarterly employee scorecards, evidence links, owner calibration reasons, AI drafts, final reviews, and permanent audit", "Role-specific evidence, project health, customer voice, service metrics, and quarterly snapshots", "Only a Company Owner can review, calibrate, or finalize; AI cannot alter scores or make an employment decision", "ChatGPT narrative generation remains connection-gated; deterministic scoring and owner review are live"),
  company("it-integrations", "IT & Integrations Center", "Permanent complete connection inventory, uptime snapshots, incident clocks, maintenance, conflicts, replay, and scheduler ledgers", "Reconciliation, safe retry, acknowledgement timing, recovery monitoring, and scheduled-run evidence", "Financial replay and provider recovery retain approval gates; external provider downtime is distinguished from IT response", "This is the single truthful management boundary for every external service and automation"),
  project("project-overview", "Project Overview", "D1 project profile, accessible records, and R2 photo evidence", "Current attention, schedule, cost, field, weather, and camera-readiness summaries", "Project assignment and financial visibility are enforced", "Live weather and cameras remain provider-dependent; stored project work is live"),
  project("owner-contract", "Owner Contract", "Permanent clause-level revisions, owner requests, secure project-only access, signatures, documents, and audit", "Award, Project Owner Portal, project setup, accounting, owner billing, and contract schedule milestone synchronization", "PM/Admin preparation, Company Owner customer release and final freeze, Project Owner signature, then Mefford countersignature are required"),
  project("subcontracts", "Subcontracts", "Owner project award prepares exact selected-bid drafts with permanent scope, pricing, quote, compliance, documents, signatures, and audit", "Estimate/proposal basis, project procurement, budget commitment, and vendor-status validation", "The PM may revise or mark Do Not Award; release and both signatures remain human-gated"),
  project("change-orders", "Change Orders", "Permanent PCO/CO lifecycle, pricing, files, and audit", "Cost, schedule, budget, and contract updates after controlled execution", "Pricing, release, and owner execution remain separate"),
  project("purchase-orders", "Purchase Orders", "Permanent PO lifecycle, revisions, documents, and audit", "Budget and vendor revalidation plus AP matching", "Approval and release thresholds are enforced"),
  project("project-meetings", "Project Meetings", "Permanent meeting series, occurrences, decisions, actions, files, and audit", "Agenda rules, carry-forward, and My Work routing", "Attendance, decisions, publication, and finalization remain human-confirmed", "Microsoft calendar, Teams, recording, and email remain connection-gated"),
  project("daily-logs", "Daily Logs", "Permanent dated field records and R2 originals", "Weather lookup, field capture, offline queue, and photo indexing", "Finalized records require controlled correction history", "Automatic weather is provider-dependent; manual evidence entry is live"),
  project("safety", "Safety", "Permanent documents, signed walks, incidents, restricted files, and audit", "Confidential routing, corrective work, and closeout carry-forward", "OSHA classification, filing, waiver approval, and closure remain human-controlled"),
  project("rfis", "RFIs", "Permanent correspondence, revisions, attachments, and audit", "Impact linking, response routing, and connected controls", "PM issuance and impact decisions are enforced", "Operational email is connection-gated; recorded manual transmission is live"),
  project("submittals", "Submittals", "Permanent correspondence, revisions, attachments, and audit", "Impact linking, response routing, and connected controls", "PM issuance and final review stay human-controlled", "Operational email is connection-gated; recorded manual transmission is live"),
  project("schedule", "Schedule", "Permanent activities, dependencies, baselines, templates, and audit", "Date propagation, progress, health, quality prompts, and Excel round trips", "Baseline and controlled edits retain human authority"),
  project("selections", "Selections", "Permanent options, decisions, releases, revisions, and evidence", "Lead-time decision dates, variance routing, and PM follow-up", "Owner decision, PM release, and change authorization remain separate"),
  project("budget", "Budget", "Permanent project codes, company master, locks, and audit", "Forecast, commitments, approved changes, and health updates", "Original budget lock and financial permissions are enforced"),
  project("procurement", "Procurement", "Permanent packages, bidders, revisions, questions, addenda, files, and audit", "Coverage, deadline, compliance, leveling, and award handoff", "Owner award and PM commitment confirmation remain required", "Operational email is connection-gated; recorded transmission remains available"),
  project("quality", "Quality Control", "Permanent checklists, deficiencies, proposals, photos, and audit", "Schedule prompts, billing warnings, correction routing, and closeout transfer", "Superintendent verification and PM/designer acceptance remain human-controlled"),
  project("design-drawings", "Design & Drawings", "Permanent team, packages, revisions, files, approvals, and current-set history", "Award handoff, impact linking, and supersession", "Designer approval and PM release are required"),
  project("project-files", "Project Files", "Permanent R2 files with D1 metadata, categories, revisions, and access", "Workflow filing, search, multipart upload, and source linking", "File access is project- and role-filtered"),
  project("closeout", "Closeout", "Permanent requirements, approvals, files, packages, warranty, and audit", "90/60/30-day requests, weekly final-period follow-up, payment gates, and warranty routing", "Document approval, owner acceptance, and final payment remain human-controlled"),
  project("project-lien-waivers", "Project Lien Waivers", "Permanent project-specific requests, signatures, reviews, and PDFs", "Jurisdiction and payment-stage routing", "No automatic signature, approval, payment, or unconditional release"),
  project("team-access", "Team & Access", "Permanent employees, designations, requests, invites, and audit", "Default-role carry-forward, project overrides, and immediate revocation", "Company Owner access authority, IT directory visibility, project overrides, and least-privilege vendor access are server-enforced", "Microsoft employee sign-in remains connection-gated; current session verification is fail-closed"),
];

const REQUIRED_SECTION_EVIDENCE: SystemHealthEvidenceCheck[] = [
  { key: "persistence", label: "Persistent Data Probe", status: "Unknown", source: "Independent Runtime Probe", detail: "No current database or file-store proof has been recorded." },
  { key: "runtime-workflow", label: "Runtime Workflow Evidence", status: "Unknown", source: "Production Activity", detail: "No successful production activity has been linked to this section." },
  { key: "authorization", label: "Authorization Boundary Test", status: "Unknown", source: "Executable Permission Test", detail: "No executable role and project-isolation test has been recorded for the current release." },
  { key: "release-test", label: "Current Release Test", status: "Unknown", source: "Release Verification", detail: "No passing end-to-end test evidence has been attached to the current deployed version." },
];

export function applicationReadinessSnapshot(input: { evidenceBySection?: Record<string, SystemHealthEvidenceCheck[]>; now?: Date } = {}) {
  const now = input.now || new Date();
  const sections: MeasuredSectionReadiness[] = SECTION_READINESS.map((section) => {
    const supplied = input.evidenceBySection?.[section.id] || [];
    const suppliedByKey = new Map(supplied.map((check) => [check.key, check]));
    const evidence = [
      ...REQUIRED_SECTION_EVIDENCE.map((check) => normalizeEvidenceCheck(suppliedByKey.get(check.key) || check, now)),
      ...supplied.filter((check) => !REQUIRED_SECTION_EVIDENCE.some((required) => required.key === check.key)).map((check) => normalizeEvidenceCheck(check, now)),
    ];
    const observed = evidence.map((check) => check.observedAt).filter(Boolean).sort().at(-1) || "";
    return {
      ...section,
      status: evaluateEvidenceStatus(evidence, now),
      evidence,
      verifiedEvidence: evidence.filter((check) => check.required && check.status === "Verified").length,
      requiredEvidence: evidence.filter((check) => check.required).length,
      lastObservedAt: observed,
    };
  });
  const counts = statusCounts(sections);
  return {
    overall: overallEvidenceStatus(sections),
    verified: counts.Verified,
    degraded: counts.Degraded,
    failed: counts.Failed,
    unknown: counts.Unknown,
    notConfigured: counts["Not Configured"],
    total: sections.length,
    principle: "A section is Verified only when current independent persistence, workflow, authorization, and release-test evidence exists. Missing proof remains Unknown.",
    sections,
  };
}
