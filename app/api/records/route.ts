import { normalizeSalesFunnelStage } from "../../../lib/sales-opportunity-value";
import { reconcileAwardContractTotals } from "../../../lib/project-contract-financials";
import { loadSalesContracts } from "../../../lib/sales-contract-server";
import { withSalesContract } from "../../../lib/sales-contract";
import { loadOwnerBillingAuthority, ownerBillingReleaseError, phaseOneCreditError } from "../../../lib/owner-billing-control";
import { ownerBillingPhaseError, PHASE_ONE_BILLING, PHASE_ONE_SOV_ID } from "../../../lib/owner-billing-authority";
import { accountNumberError, currentAccountNumber, ACCOUNT_NUMBER_POLICY, normalizeAccountReferences } from "../../../lib/accounting-numbering";
import { buildAccountCatalog, selectableLedgerAccounts } from "../../../lib/accounting-catalog";
import { canReadProjectId } from "../../../lib/project-access";
import { and, desc, eq, or, sql } from "drizzle-orm";
import {
  commandNotifications,
  commandRecords,
  companyMembers,
  projectFiles,
  projects,
  recordAudits,
  vendorProfiles,
  vendorProjectAccess,
} from "../../../db/schema";
import { getCommandActor, resolveCommandActor } from "../../../lib/server-actor";
import { enforceOnboardingAccess } from "../../../lib/onboarding";
import { companyMatchScore } from "../../../lib/company-matching";
import { complianceState, ensureVendorSchema } from "../../../lib/vendor-portal";
import { ensureConditionalWaiverForBilling, projectBillingWaiverGate } from "../../../lib/lien-waivers-server";
import { apAccrualLines, postAccountingEvent, stableAccountingKey, toCents } from "../../../lib/accounting-ledger";
import {
  PREWORK_QUALITY_TEMPLATES,
  QUALITY_INSPECTION_RECORD_TYPE,
  qualityChecklistDueDate,
  scheduleQualityCategory,
} from "../../../lib/quality-control";
import { recordCompletedWorkflowHandoff, ensureDomainOutboxSchema, domainEventStatements, reconcileDomainEvent } from "../../../lib/domain-outbox";
import { salesOpportunityQualification } from "../../../lib/sales-opportunity.js";
import { normalizeOwnerContractType, type OwnerContractType } from "../../../lib/owner-contracts";

const MASTER_RECORD_TYPE = "Master Cost Codes";
const BUDGET_CONTROL_TYPE = "Budget Control";
const BUDGET_CONTROL_ID = "BUDGET-CONTROL";
const SALES_PROJECT_ID = "MEFFORD-SALES";
const SALES_GOAL_RECORD_TYPE = "Sales Goals";
const SALES_OPPORTUNITY_RECORD_TYPE = "Sales Opportunities";
const OWNER_PROPOSAL_RECORD_TYPE = "Owner Proposals";
const DESIGN_TEAM_RECORD_TYPE = "Design Team";
const ACCOUNTING_PROJECT_ID = "MEFFORD-ACCOUNTING";
const CONTROLLED_COMPANY_PROJECTS = new Set(["MEFFORD-PERFORMANCE"]);
const HEALTH_INTERNAL_TYPES = new Set([
  "Project Health Rules",
  "Project Health Rule Exceptions",
  "Project Health Daily Snapshots",
  "Project Health Events",
  "Closeout Project Control",
  "Closeout Requirements",
  "Closeout Equipment",
  "Warranty Requests",
  "Closeout Packages",
  "Morning Work Digest History",
  "Schedule Template",
  "Dashboard Preferences",
]);
const CONTROLLED_SAFETY_TYPES = new Set([
  "Safety Incidents",
  "Visitor Safety Walk",
  "Visitor Waiver",
  "Safety Control",
]);
const CONTROLLED_FINANCIAL_TYPES = new Set(["Financial Report Run", "Owner Receipt", "AR Invoice", "Job Cost Actual", "Payroll Report", "Paylocity Payroll Return", "Journal Entry"]);
const excludedProfitCostCodes = new Set([
  "0135.00",
  "0143.00",
  "0143.12",
  "0143.15",
]);

type RecordPayload = {
  projectId?: string;
  recordType?: string;
  record?: {
    id: string;
    title: string;
    owner: string;
    due: string;
    status: string;
    meta?: string;
    recordDate?: string;
    recordTime?: string;
    dateLocked?: boolean;
    data?: Record<string, unknown>;
    initialAudit?: string;
  };
};

function isDesignBuildSalesOpportunity(recordType: string, record: NonNullable<RecordPayload["record"]>) {
  if (recordType !== SALES_OPPORTUNITY_RECORD_TYPE || String(record.status || record.data?.stage || "") !== "Estimating") return false;
  const deliveryMethod = String(record.data?.deliveryMethod || "").trim().toLowerCase();
  return deliveryMethod === "design-build" || deliveryMethod === "design-build gmp" || deliveryMethod === "design-build lump sum";
}

function opportunityOwnerContractType(data: Record<string, unknown>): OwnerContractType {
  const handoff = data.proposalHandoff && typeof data.proposalHandoff === "object" && !Array.isArray(data.proposalHandoff)
    ? data.proposalHandoff as Record<string, unknown>
    : {};
  return normalizeOwnerContractType(data.ownerContractType)
    || normalizeOwnerContractType(data.deliveryMethod)
    || normalizeOwnerContractType(handoff.ownerContractType)
    || (String(data.deliveryMethod || "").toLowerCase().includes("design-build") ? "Design-Build Lump Sum" : "Plan & Spec Lump Sum");
}

async function synchronizeOpportunityProposalContractType(
  db: ReturnType<typeof import("../../../db")["getDb"]>,
  opportunityId: string,
  ownerContractType: OwnerContractType,
  actor: { name: string; email: string },
) {
  const rows = await db.select({ id: commandRecords.id, status: commandRecords.status, dataJson: commandRecords.dataJson })
    .from(commandRecords)
    .where(and(eq(commandRecords.projectId, SALES_PROJECT_ID), eq(commandRecords.recordType, OWNER_PROPOSAL_RECORD_TYPE)));
  const now = new Date().toISOString();
  for (const row of rows) {
    const proposal = parseRecordData(row.dataJson);
    if (row.status === "Issued" || String(proposal.opportunityId || "") !== opportunityId || String(proposal.packetType || "") !== "Construction Proposal") continue;
    const previous = normalizeOwnerContractType(proposal.recommendedContractType);
    if (previous === ownerContractType) continue;
    await db.update(commandRecords).set({
      dataJson: JSON.stringify({ ...proposal, recommendedContractType: ownerContractType, updatedAt: now, updatedBy: actor.name }),
      updatedAt: now,
    }).where(and(eq(commandRecords.projectId, SALES_PROJECT_ID), eq(commandRecords.id, row.id)));
    await db.insert(recordAudits).values({
      projectId: SALES_PROJECT_ID,
      recordId: row.id,
      fieldName: "Owner Contract Type",
      oldValue: previous || String(proposal.recommendedContractType || "Not Set"),
      newValue: ownerContractType,
      reason: "Project Info And Proposal Contract Type Synchronization",
      actorName: actor.name,
      actorEmail: actor.email,
      summary: `${actor.name} changed Project Info to ${ownerContractType}; the editable construction proposal was updated to match.`,
    });
  }
}

async function ensureSalesDesignTrack(
  db: ReturnType<typeof import("../../../db")["getDb"]>,
  record: NonNullable<RecordPayload["record"]>,
  actor: { name: string; email: string },
) {
  const now = new Date().toISOString();
  const trackId = `DESIGN-TEAM-${record.id}`;
  const deliveryMethod = String(record.data?.deliveryMethod || "Design-Build");
  await db.insert(commandRecords).values({
    projectId: SALES_PROJECT_ID,
    id: trackId,
    recordType: DESIGN_TEAM_RECORD_TYPE,
    title: `${record.title} Sales Design Track`,
    owner: String(record.data?.assignedRep || record.owner || actor.name),
    due: String(record.data?.bidDueDate || record.data?.expectedAwardDate || record.due || ""),
    status: "Design Brief Required",
    meta: `${deliveryMethod} · Created At Estimating Handoff`,
    dataJson: JSON.stringify({
      opportunityId: record.id,
      deliveryMethod,
      initiatedAt: now,
      initiatedBy: actor.name,
      initiatedByEmail: actor.email,
      sourceStage: "Estimating",
      purpose: "Develop The Minimum Floor Plans Renderings Owner Criteria Scope And Pricing Basis Needed To Sell The Job",
      assignments: [],
      checklist: [],
      timeline: [{ action: "Sales Design Track Created", actor: actor.name, at: now, detail: `${deliveryMethod} Opportunity Entered Estimating` }],
    }),
  }).onConflictDoNothing();
  record.data = {
    ...(record.data || {}),
    estimatingRequestedAt: String(record.data?.estimatingRequestedAt || now),
    estimatingLockedAt: String(record.data?.estimatingLockedAt || now),
    estimatingLockedBy: String(record.data?.estimatingLockedBy || actor.name),
    salesDesignTrackId: trackId,
    salesDesignTrackStatus: "Design Brief Required",
    salesDesignInitiatedAt: String(record.data?.salesDesignInitiatedAt || now),
  };
}

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  const search = new URL(request.url).searchParams;
  const projectId = search.get("projectId")?.trim();
  const ownerBillingView = search.get("view") === "owner-billing";
  if (!projectId) {
    return Response.json({ error: "projectId is required" }, { status: 400 });
  }

  try {
    const db = await commandDatabase();
    const authorization = await recordAuthorization(db, actor);
    if (CONTROLLED_COMPANY_PROJECTS.has(projectId)) {
      return Response.json({ error: "Use The Owner-Only Performance Review Center" }, { status: 403 });
    }
    if (!projectId.startsWith("MEFFORD-") && !(await canAccessProjectScope(db, actor, projectId))) {
      return Response.json({ error: "This Project Is Restricted To Its Assigned Project Manager Or Superintendent" }, { status: 403 });
    }
    if (projectId === SALES_PROJECT_ID && !authorization.canAccessSales) {
      return Response.json(
        { error: "Sales Access Requires An Estimator Sales Representative Administrator Or Company Owner" },
        { status: 403 },
      );
    }
    if (
      projectId === ACCOUNTING_PROJECT_ID &&
      !authorization.canAccessAccounting &&
      !(ownerBillingView && authorization.canAccessOwnerBilling)
    ) {
      return Response.json(
        { error: "Accounting Access Requires A Company Owner Accountant Or Financial Administrator" },
        { status: 403 },
      );
    }
    if (projectId === SALES_PROJECT_ID && new URL(request.url).searchParams.get("view") === "contract-sales") {
      const contracts = await loadSalesContracts((await import("cloudflare:workers")).env.DB);
      return Response.json({ contracts: [...contracts.values()] }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const [rows, audits] = await Promise.all([
      db
        .select()
        .from(commandRecords)
        .where(eq(commandRecords.projectId, projectId))
        .orderBy(desc(commandRecords.updatedAt)),
      db
        .select()
        .from(recordAudits)
        .where(eq(recordAudits.projectId, projectId))
        .orderBy(recordAudits.id),
    ]);
    const auditMap = new Map<string, string[]>();
    for (const audit of audits) {
      auditMap.set(audit.recordId, [
        ...(auditMap.get(audit.recordId) ?? []),
        audit.summary,
      ]);
    }

    const assignedProjectNumbers = new Set<string>();
    if (
      ownerBillingView &&
      projectId === ACCOUNTING_PROJECT_ID &&
      !authorization.canViewAllOwnerBilling
    ) {
      const assignedProjects = await db
        .select({ number: projects.number })
        .from(projects)
        .where(eq(projects.projectManager, actor.name));
      assignedProjects.forEach((project) => assignedProjectNumbers.add(project.number));
    }

    const visibleRows = rows.filter((row) => {
      if (row.status === "Deletion Quarantine") return false;
      if (projectId === "MEFFORD-COMPANY" && row.recordType !== MASTER_RECORD_TYPE) return false;
      if (HEALTH_INTERNAL_TYPES.has(row.recordType)) return false;
      if (ownerBillingView && projectId === ACCOUNTING_PROJECT_ID) {
        if (row.recordType !== "AP Invoice") return false;
        if (authorization.canViewAllOwnerBilling) return true;
        const allocations = Array.isArray(parseRecordData(row.dataJson).allocations)
          ? parseRecordData(row.dataJson).allocations as Array<Record<string, unknown>>
          : [];
        return allocations.some((allocation) =>
          assignedProjectNumbers.has(String(allocation.destination || "")),
        );
      }
      if (row.recordType === MASTER_RECORD_TYPE) {
        return true;
      }
      if (row.recordType === "Budget" || row.recordType === BUDGET_CONTROL_TYPE) {
        return authorization.canViewFinancials;
      }
      if (row.recordType === "Safety Incidents") {
        return authorization.canViewSafetyIncidents;
      }
      return true;
    });

    const salesContracts = projectId === SALES_PROJECT_ID
      ? await loadSalesContracts((await import("cloudflare:workers")).env.DB) : null;
    return Response.json({
      ...(salesContracts ? { contracts: [...salesContracts.values()] } : {}),
      records: visibleRows.map((row) => ({
        id: row.id,
        type: row.recordType,
        title: row.title,
        owner: row.owner,
        due: row.due,
        status: row.status,
        meta: row.meta,
        recordDate: row.recordDate,
        recordTime: row.recordTime,
        dateLocked: row.dateLocked,
        data: salesContracts && row.recordType === SALES_OPPORTUNITY_RECORD_TYPE
          ? withSalesContract(parseRecordData(row.dataJson), salesContracts)
          : ownerBillingView && !authorization.canViewAllOwnerBilling
          ? ownerBillingInvoiceData(parseRecordData(row.dataJson), assignedProjectNumbers)
          : ["Chart Of Accounts", "Journal Entry", "AP Invoice", "Recurring Payment"].includes(row.recordType) ? normalizeAccountReferences(parseRecordData(row.dataJson)) : parseRecordData(row.dataJson),
        auditHistory: auditMap.get(row.id) ?? [],
      })),
    });
  } catch (error) {
    return databaseError(error);
  }
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;

  try {
    const payload = (await request.json()) as RecordPayload;
    const projectId = payload.projectId?.trim() ?? "";
    const recordType = payload.recordType?.trim() ?? "";
    const record = payload.record;
    if (
      !projectId ||
      !recordType ||
      !record?.id ||
      !record.title ||
      !record.owner ||
      !record.due ||
      !record.status
    ) {
      return Response.json(
        { error: "Complete record information is required" },
        { status: 400 },
      );
    }

    if (projectId === SALES_PROJECT_ID && recordType === SALES_OPPORTUNITY_RECORD_TYPE) {
      const stage = normalizeSalesFunnelStage(record.data?.stage || record.status);
      record.status = stage;
      record.data = { ...record.data, stage };
      delete record.data.contractSales;
    }

    const db = await commandDatabase();
    const authorization = await recordAuthorization(db, actor);
    if (CONTROLLED_COMPANY_PROJECTS.has(projectId)) {
      return Response.json({ error: "Use The Owner-Only Performance Review Workflow" }, { status: 403 });
    }
    if (
      projectId === "MEFFORD-COMPANY" &&
      (recordType !== MASTER_RECORD_TYPE || !["Company Owner", "Administrator"].includes(authorization.accessLevel))
    ) {
      return Response.json(
        { error: "Company Master Cost Codes Require Company Owner Or Administrator Access" },
        { status: 403 },
      );
    }
    if (!projectId.startsWith("MEFFORD-") && !(await canAccessProjectScope(db, actor, projectId))) {
      return Response.json({ error: "This Project Is Restricted To Its Assigned Project Manager Or Superintendent" }, { status: 403 });
    }
    if (HEALTH_INTERNAL_TYPES.has(recordType)) {
      return Response.json(
        { error: "This Record Must Use Its Controlled Project Health Closeout Or Notification Workflow" },
        { status: 403 },
      );
    }
    if (CONTROLLED_SAFETY_TYPES.has(recordType)) {
      return Response.json(
        { error: "This Record Must Use The Controlled Safety Workflow" },
        { status: 403 },
      );
    }
    if (CONTROLLED_FINANCIAL_TYPES.has(recordType)) {
      return Response.json(
        { error: "This Record Must Use Its Controlled Accounting Or Financial Reports Workflow" },
        { status: 403 },
      );
    }
    if (projectId === SALES_PROJECT_ID && !authorization.canAccessSales) {
      return Response.json(
        { error: "Sales Access Requires An Estimator Sales Representative Administrator Or Company Owner" },
        { status: 403 },
      );
    }
    if (
      projectId === ACCOUNTING_PROJECT_ID &&
      !authorization.canAccessAccounting
    ) {
      return Response.json(
        { error: "Accounting Access Requires A Company Owner Accountant Or Financial Administrator" },
        { status: 403 },
      );
    }
    if (
      projectId === SALES_PROJECT_ID &&
      recordType === SALES_GOAL_RECORD_TYPE &&
      authorization.accessLevel !== "Company Owner"
    ) {
      return Response.json(
        { error: "Only A Company Owner Can Set Company And Salesperson Goals" },
        { status: 403 },
      );
    }
    if (recordType === "Schedule") {
      const qualityCategoryId = String(record.data?.qualityCategoryId || "").trim();
      if (!scheduleQualityCategory(qualityCategoryId)) {
        return Response.json(
          { error: "Every Schedule Activity Requires A Valid Quality Category" },
          { status: 400 },
        );
      }
    }
    const existing = await db
      .select({
        id: commandRecords.id,
        recordType: commandRecords.recordType,
        status: commandRecords.status,
        dataJson: commandRecords.dataJson,
        recordDate: commandRecords.recordDate,
      })
      .from(commandRecords)
      .where(
        and(
          eq(commandRecords.projectId, projectId),
          eq(commandRecords.id, record.id),
        ),
      )
      .limit(1);
    if (existing[0] && existing[0].recordType !== recordType) return Response.json({ error: "A Record's Type Cannot Be Changed. Use Its Existing Workflow." }, { status: 409 });
    if (recordType === "Chart Of Accounts") {
      const accountNumber = currentAccountNumber(record.id);
      if (!existing[0] && !/^[1-9]\d{3}$/.test(record.id)) return Response.json({ error: "New Accounts Require Exactly Four Digits From 1000 Through 9999" }, { status: 400 });
      const numberError = accountNumberError(accountNumber, String(record.data?.category || ""));
      if (numberError) return Response.json({ error: numberError }, { status: 400 });
      const chartRows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, ACCOUNTING_PROJECT_ID), eq(commandRecords.recordType, "Chart Of Accounts")));
      const account = buildAccountCatalog(chartRows).find(item => item.accountNumber === accountNumber);
      if (!existing[0] && account?.legacyAccountNumber && record.status === "Proposed") return Response.json({ error: `Account Number ${accountNumber} Already Exists In The Opening Chart` }, { status: 409 });
      if (account?.persistedId && account.persistedId !== record.id) return Response.json({ error: `Account Number ${accountNumber} Already Exists. Reload Its Existing Record.` }, { status: 409 });
      if (account?.isSystemControl && (record.status !== "Active" || record.title !== account.legacyName)) return Response.json({ error: "System Clearing Accounts Must Keep Their Controlled Name And Active Status" }, { status: 409 });
      if (Number(accountNumber) >= 4950 && Number(accountNumber) <= 4999 && !account?.isSystemControl) return Response.json({ error: "4950 Through 4999 Are Reserved For System Control And Clearing Accounts" }, { status: 400 });
      record.data = { ...record.data, accountNumber, numberingPolicy: ACCOUNT_NUMBER_POLICY, ...(account?.legacyAccountNumber ? { legacyAccountNumber: account.legacyAccountNumber } : {}) };
      if (!["Proposed", "Pending Review", "Active", "Inactive"].includes(record.status) || !String(record.data?.category || "").trim() || !["Debit", "Credit"].includes(String(record.data?.normalBalance || ""))) return Response.json({ error: "An Account Category, Normal Balance And Valid Review Status Are Required" }, { status: 400 });
      if (authorization.accessLevel !== "Company Owner" && (record.status !== "Proposed" || existing[0] && existing[0].status !== "Proposed")) return Response.json({ error: "Only A Company Owner Can Activate, Deactivate Or Change An Approved Account" }, { status: 403 });
    }
    if (recordType === "Change Orders" && record.status === "Executed" && !authorization.canManageMaster && !authorization.designations.includes("Project Manager")) return Response.json({ error: "The Assigned Project Manager Or Company Leadership Must Record Execution" }, { status: 403 });
    if (recordType === "Change Orders" && ["Converted", "Awaiting Owner Signature"].includes(record.status) && !authorization.canManageMaster) {
      return Response.json({ error: "Company Owner Or Administrator Approval Is Required To Release A Change Order" }, { status: 403 });
    }
    if (recordType === "Change Orders" && record.status === "Executed" && !["Awaiting Owner Signature", "Executed"].includes(existing[0]?.status || "")) {
      return Response.json({ error: "Release The Change Order For Owner Signature Before Executing It" }, { status: 409 });
    }
    if (projectId === SALES_PROJECT_ID && recordType === SALES_OPPORTUNITY_RECORD_TYPE && existing[0]) {
      const prior = parseRecordData(existing[0].dataJson);
      const enteredEstimating = Boolean(prior.estimatingLockedAt || prior.estimatingRequestedAt || prior.directEstimate);
      const nextStage = String(record.data?.stage || record.status || "");
      if (enteredEstimating && !["Estimating", "Proposal Submitted", "Negotiation", "Lost", "Awarded"].includes(nextStage)) {
        return Response.json(
          { error: "This Opportunity Is Permanently Locked In Estimating Until It Is Recorded As Won Or Lost. Its Estimate History And Files Cannot Be Moved Backward Into Sales." },
          { status: 409 },
        );
      }
      if (enteredEstimating) {
        record.data = {
          ...(record.data || {}),
          estimatingRequestedAt: String(prior.estimatingRequestedAt || prior.estimatingLockedAt || record.data?.estimatingRequestedAt || new Date().toISOString()),
          estimatingLockedAt: String(prior.estimatingLockedAt || prior.estimatingRequestedAt || new Date().toISOString()),
          estimatingLockedBy: String(prior.estimatingLockedBy || record.data?.estimatingLockedBy || actor.name),
        };
      }
    }
    if (
      recordType === "Change Orders" &&
      existing[0]?.status === "Executed"
    ) {
      const prior = parseRecordData(existing[0].dataJson);
      const sameExecutedSnapshot =
        record.status === "Executed" &&
        JSON.stringify(immutableChangeOrderSnapshot(prior)) === JSON.stringify(immutableChangeOrderSnapshot(record.data || {}));
      if (!sameExecutedSnapshot) {
        return Response.json(
          { error: "An Executed Change Order And Its Contract Amendment Are Immutable. Create A New Change Order For Any Further Contract Change." },
          { status: 423 },
        );
      }
    }
    if (recordType === "Schedule") {
      const qualityCategory = scheduleQualityCategory(String(record.data?.qualityCategoryId || ""));
      const progress = Math.max(0, Number(record.data?.progress || 0));
      let preWorkStatus = qualityCategory?.templateId ? "Required Before Start" : "Not Required";
      let preWorkClearedAt = "";
      if (qualityCategory?.templateId) {
        const inspections = await db.select({ status: commandRecords.status, dataJson: commandRecords.dataJson, updatedAt: commandRecords.updatedAt })
          .from(commandRecords)
          .where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, QUALITY_INSPECTION_RECORD_TYPE)));
        const cleared = inspections.find((inspection) =>
          String(parseRecordData(inspection.dataJson).scheduleActivityId || "") === record.id &&
          ["Passed", "Override Documented"].includes(inspection.status),
        );
        if (cleared) {
          preWorkStatus = "Cleared";
          preWorkClearedAt = cleared.updatedAt;
        } else if (progress > 0) {
          return Response.json(
            { error: `Pre-Work Checklist Required Before ${record.title} Can Start. Complete The Linked ${qualityCategory.label} Checklist Or Record A Qualified Superintendent Override.` },
            { status: 409 },
          );
        }
      }
      record.data = { ...(record.data || {}), preWorkStatus, preWorkClearedAt };
    }
    if (recordType === "Daily Logs") {
      const weatherSnapshot = record.data?.weatherSnapshot as
        | Record<string, unknown>
        | undefined;
      const validWeatherSnapshot =
        record.status === "Final" &&
        record.dateLocked === true &&
        Boolean(record.initialAudit) &&
        weatherSnapshot?.schemaVersion === "DAILY-WEATHER-1" &&
        weatherSnapshot.locked === true &&
        String(weatherSnapshot.date || "") === String(record.recordDate || "") &&
        String(weatherSnapshot.averageConditions || "").trim().length > 0 &&
        String(weatherSnapshot.source || "").trim().length > 0 &&
        String(weatherSnapshot.capturedAt || "").trim().length > 0 &&
        String(weatherSnapshot.finalizedAt || "").trim().length > 0 &&
        Number.isFinite(Number(weatherSnapshot.rainfallInches)) &&
        Number(weatherSnapshot.rainfallInches) >= 0 &&
        Number.isFinite(Number(weatherSnapshot.averageTemperatureF)) &&
        Number.isFinite(Number(weatherSnapshot.averageWindSpeedMph)) &&
        Number(weatherSnapshot.averageWindSpeedMph) >= 0;
      if (!validWeatherSnapshot) {
        return Response.json(
          {
            error:
              "A Final Daily Log Requires A Locked Weather Report With Daily Rainfall Average Temperature Average Wind Speed Average Conditions Source And Capture Time",
          },
          { status: 400 },
        );
      }
      if (existing.length) {
        const priorSnapshot = parseRecordData(existing[0].dataJson).weatherSnapshot;
        if (
          existing[0].status === "Final" &&
          JSON.stringify(priorSnapshot) === JSON.stringify(weatherSnapshot)
        ) {
          return Response.json(
            { saved: true, id: record.id, idempotent: true },
            { status: 200 },
          );
        }
        return Response.json(
          {
            error:
              "This Daily Log And Its Weather Report Are Finalized And Locked. Use The Audited Correction Workflow.",
          },
          { status: 409 },
        );
      }
    }
    if (
      projectId === SALES_PROJECT_ID &&
      recordType === "Sales Contacts" &&
      (!String(record.data?.firstName || "").trim() ||
        !String(record.data?.lastName || "").trim() ||
        !String(record.data?.company || "").trim())
    ) {
      return Response.json(
        { error: "Every Sales Contact Requires A First Name Last Name And Company" },
        { status: 400 },
      );
    }
    if (projectId === SALES_PROJECT_ID && ["Sales Contacts", "Sales Opportunities"].includes(recordType) && String(record.data?.company || "").trim()) {
      const companyName = String(record.data?.company || "").trim();
      const companyRows = await db.select({ id: commandRecords.id, dataJson: commandRecords.dataJson }).from(commandRecords).where(and(eq(commandRecords.projectId, SALES_PROJECT_ID), or(eq(commandRecords.recordType, "Sales Contacts"), eq(commandRecords.recordType, "Sales Opportunities"))));
      const matches = new Map<string, { company: string; score: number }>();
      companyRows.filter((row) => row.id !== record.id).forEach((row) => {
        const data = parseRecordData(row.dataJson);
        const canonical = String(data.company || "").trim();
        if (!canonical || canonical.toLowerCase() === companyName.toLowerCase()) return;
        const resolution = data.companyResolution && typeof data.companyResolution === "object" ? data.companyResolution as Record<string, unknown> : null;
        const aliases = [canonical, ...(Array.isArray(data.companyNameHistory) ? data.companyNameHistory.map(String) : []), ...(resolution?.decision === "Reuse Existing" && String(resolution.input || "").trim() ? [String(resolution.input).trim()] : [])];
        const score = Math.max(...aliases.map((alias) => companyMatchScore(companyName, alias)));
        if (score < 72) return;
        const prior = matches.get(canonical.toLowerCase());
        if (!prior || score > prior.score) matches.set(canonical.toLowerCase(), { company: canonical, score });
      });
      if (matches.size) {
        const resolution = record.data?.companyResolution && typeof record.data.companyResolution === "object" ? record.data.companyResolution as Record<string, unknown> : null;
        const separateConfirmed = resolution?.decision === "Confirmed Separate" && String(resolution.input || "").trim().toLowerCase() === companyName.toLowerCase();
        const existingReused = resolution?.decision === "Reuse Existing" && String(resolution.canonical || "").trim().toLowerCase() === companyName.toLowerCase();
        if (!separateConfirmed && !existingReused) return Response.json({ error: "This Company Looks Like An Existing Company. Reuse The Existing Company Or Confirm That It Is Truly Separate.", companyMatches: [...matches.values()].sort((left, right) => right.score - left.score).slice(0, 3) }, { status: 409 });
      }
    }
    if (projectId === ACCOUNTING_PROJECT_ID && recordType === "AP Invoice") {
      if (["Payment Released", "Paid"].includes(record.status)) return Response.json({ error: "Release And Clear Payments Through The Controlled Accounting Workflow; Invoice Editing Cannot Mark A Payment Executed." }, { status: 409 });
      const previous = existing[0];
      if (!previous || !["Approved Unpaid", "Payment Released", "Paid"].includes(previous.status)) {
        record.data = normalizeAccountReferences(record.data || {});
        const overhead = (Array.isArray(record.data.allocations) ? record.data.allocations as Array<Record<string, unknown>> : []).filter(line => line.destination === "Company Overhead");
        if (overhead.length) {
          const chartRows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, ACCOUNTING_PROJECT_ID), eq(commandRecords.recordType, "Chart Of Accounts")));
          const accounts = selectableLedgerAccounts(buildAccountCatalog(chartRows));
          for (const line of overhead) {
            const account = accounts.find(item => item.accountNumber === line.code && ["Administrative Expense", "Overhead Expense", "Direct Expense"].includes(item.category));
            if (!account) return Response.json({ error: "Choose An Available Four-Digit Expense Account For Company Overhead" }, { status: 400 });
            line.accountName = account.legacyName;
          }
        }
      }
      if (previous && ["Approved Unpaid", "Payment Released", "Paid"].includes(previous.status)) {
        const priorData = parseRecordData(previous.dataJson);
        if (previous.status !== "Approved Unpaid" || record.status !== previous.status || previous.recordDate !== record.recordDate || apInvoiceFinancialSnapshot(priorData) !== apInvoiceFinancialSnapshot(record.data || {})) {
          return Response.json({ error: "Posted Invoice Amounts Vendors Allocations And Payment Status Are Locked. Use The Controlled Payment Workflow Or An Audited Accounting Correction." }, { status: 409 });
        }
        // Payment-method preparation may change, but it cannot erase the posting.
        record.data = { ...(record.data || {}), livePosting: priorData.livePosting, costRecognition: priorData.costRecognition, costRecognitionDate: priorData.costRecognitionDate, accountingEntryId: priorData.accountingEntryId };
      }
      const vendor = String(record.data?.vendor || "").trim();
      const invoiceNumber = String(record.data?.invoiceNumber || "").trim();
      const invoiceDate = String(record.recordDate || "").trim();
      const dueDate = String(record.due || "").trim();
      const total = Number(record.data?.total || 0);
      const allocations = Array.isArray(record.data?.allocations)
        ? record.data.allocations as Array<Record<string, unknown>>
        : [];
      const allocationTotal = allocations.reduce(
        (sum, allocation) => sum + Number(allocation.amount || 0),
        0,
      );
      if (
        !vendor ||
        !invoiceNumber ||
        !invoiceDate ||
        !dueDate ||
        !Number.isFinite(total) ||
        total <= 0 ||
        !allocations.length ||
        allocations.some(
          (allocation) =>
            !String(allocation.destination || "").trim() ||
            !String(allocation.code || "").trim() ||
            Number(allocation.amount || 0) <= 0,
        ) ||
        Math.abs(total - allocationTotal) > 0.005
      ) {
        return Response.json(
          { error: "The Invoice And All Allocation Lines Must Be Complete And Balanced" },
          { status: 400 },
        );
      }
      const invoiceRows = await db
        .select({ id: commandRecords.id, dataJson: commandRecords.dataJson })
        .from(commandRecords)
        .where(
          and(
            eq(commandRecords.projectId, ACCOUNTING_PROJECT_ID),
            eq(commandRecords.recordType, "AP Invoice"),
          ),
        );
      const duplicate = invoiceRows.some((row) => {
        if (row.id === record.id) return false;
        const data = parseRecordData(row.dataJson);
        return (
          String(data.vendor || "").trim().toLowerCase() === vendor.toLowerCase() &&
          String(data.invoiceNumber || "").trim().toLowerCase() === invoiceNumber.toLowerCase()
        );
      });
      if (duplicate) {
        return Response.json(
          { error: "This Vendor Invoice Number Already Exists And Was Blocked As A Duplicate" },
          { status: 409 },
        );
      }
      if (
        String(record.data?.paymentMethod || "") === "Credit Card" &&
        (!["Ramp", "Chase"].includes(String(record.data?.cardProvider || "")) ||
          !String(record.data?.cardholder || "").trim() ||
          !/^\d{4}$/.test(String(record.data?.cardLastFour || "")))
      ) {
        return Response.json(
          { error: "Credit Card Payments Require Ramp Or Chase A Cardholder And The Last Four Digits" },
          { status: 400 },
        );
      }
      if (
        record.status === "Approved Unpaid" &&
        existing[0]?.status !== "Approved Unpaid" &&
        (existing[0]?.status === "Owner Approval" || total > 200000) &&
        authorization.accessLevel !== "Company Owner"
      ) {
        return Response.json(
          { error: "A Company Owner Must Approve This Invoice For Payment" },
          { status: 403 },
        );
      }
      if (
        record.status === "Approved Unpaid" &&
        String(record.data?.vendorId || "").trim()
      ) {
        await ensureVendorSchema();
        const compliance = await complianceState(
          db,
          String(record.data?.vendorId || "").trim(),
          String(allocations[0]?.destination || "ALL"),
        );
        if (compliance.blocked) {
          return Response.json(
            { error: `Vendor Payment Hold: ${[...compliance.missing, ...compliance.expired].join(", ")}. Project work and AP review remain active; payment requires current compliance or an active temporary approval.` },
            { status: 409 },
          );
        }
      }
      if (record.status === "Approved Unpaid") {
        const projectDestinations = Array.from(new Set(allocations.map((allocation) => String(allocation.destination || "").trim()).filter((destination) => destination && destination !== "Company Overhead")));
        for (const destination of projectDestinations) {
          const gate = await projectBillingWaiverGate(db, destination, record.id);
          if (!gate.allowed) {
            return Response.json(
              { error: `Lien Waiver Payment Hard Block · ${destination}: ${gate.reason}. Complete The Conditional Waiver Or Record An Audited Company Owner Override.` },
              { status: 409 },
            );
          }
        }
      }
    }
    if (
      projectId === ACCOUNTING_PROJECT_ID &&
      recordType === "Recurring Payment" &&
      (!String(record.data?.vendor || "").trim() ||
        !String(record.data?.description || "").trim() ||
        Number(record.data?.amount || 0) <= 0 ||
        !String(record.data?.startDate || "").trim() ||
        !String(record.data?.destination || "").trim() ||
        !String(record.data?.code || "").trim())
    ) {
      return Response.json(
        { error: "Complete Recurring Payment Schedule Information Is Required" },
        { status: 400 },
      );
    }
    if (
      projectId === ACCOUNTING_PROJECT_ID &&
      recordType === "Payment Batch" &&
      record.status === "Released" &&
      authorization.accessLevel !== "Company Owner"
    ) {
      return Response.json(
        { error: "Only A Company Owner Can Release A Payment Batch" },
        { status: 403 },
      );
    }
    if (
      projectId === ACCOUNTING_PROJECT_ID &&
      recordType === "Wire Request" &&
      ["Approved", "Second Owner Approval"].includes(record.status) &&
      authorization.accessLevel !== "Company Owner"
    ) {
      return Response.json(
        { error: "A Company Owner Must Approve Every Wire Request" },
        { status: 403 },
      );
    }
    if (recordType === "Owner Billing Setup") {
      const { env } = await import("cloudflare:workers");
      const authority = await loadOwnerBillingAuthority(env.DB, projectId);
      const phaseOne = record.data?.billingPhase === PHASE_ONE_BILLING;
      if (record.id !== (phaseOne ? PHASE_ONE_SOV_ID : "OWNER-BILLING-SETUP")) {
        return Response.json({ error: "Use The Schedule Of Values For The Selected Billing Phase." }, { status: 409 });
      }
      const sovLines = Array.isArray(record.data?.sovLines)
        ? record.data.sovLines as Array<Record<string, unknown>>
        : [];
      const [project] = await db
        .select({ contractAmount: projects.contractAmount, ownerContractType: projects.ownerContractType, ownerContractStatus: projects.ownerContractStatus })
        .from(projects)
        .where(eq(projects.number, projectId))
        .limit(1);
      const sovTotal = sovLines.reduce(
        (sum, line) => sum + Number(line.scheduledValue || 0),
        0,
      );
      if (record.status === "Locked") {
        const error = ownerBillingPhaseError(authority, record.data?.billingPhase);
        if (error) return Response.json({ error }, { status: 409 });
        if (!phaseOne) {
          const creditError = await phaseOneCreditError(env.DB, projectId, record.data || {});
          if (creditError) return Response.json({ error: creditError }, { status: 409 });
        }
      }
      if (
        record.status === "Locked" &&
        authorization.accessLevel !== "Company Owner"
      ) {
        return Response.json(
          { error: "A Company Owner Must Lock The First Owner Invoice Structure" },
          { status: 403 },
        );
      }
      if (
        record.status === "Locked" &&
        (!sovLines.length ||
          !Number.isFinite(sovTotal) ||
          Math.abs(sovTotal - (phaseOne ? authority.phaseOneAmount : Number(project?.contractAmount || 0))) > 0.01)
      ) {
        return Response.json(
          { error: "The Base Schedule Of Values Must Equal The Original Contract" },
          { status: 409 },
        );
      }
    }
    if (recordType === "Owner Billing") {
      const lines = Array.isArray(record.data?.lines)
        ? record.data.lines as Array<Record<string, unknown>>
        : [];
      if (
        !String(record.data?.projectNumber || "").trim() ||
        !String(record.data?.billingPeriod || "").trim() ||
        !lines.length ||
        lines.some(
          (line) =>
            !String(line.id || "").trim() ||
            Number(line.totalThisPeriod || 0) < 0,
        )
      ) {
        return Response.json(
          { error: "Complete Owner Billing Period And SOV Information Is Required" },
          { status: 400 },
        );
      }
      if (
        !authorization.canAccessOwnerBilling
      ) {
        return Response.json(
          { error: "Owner Billing Access Requires The Assigned Project Manager Administrator Accountant Or Company Owner" },
          { status: 403 },
        );
      }
      const [billingProject] = await db
        .select({ projectManager: projects.projectManager })
        .from(projects)
        .where(eq(projects.number, projectId))
        .limit(1);
      const assignedProjectManager =
        Boolean(billingProject?.projectManager) &&
        billingProject.projectManager.trim().toLowerCase() === actor.name.trim().toLowerCase();
      const canPrepareBilling =
        authorization.accessLevel === "Company Owner" ||
        authorization.accessLevel === "Administrator" ||
        assignedProjectManager;
      const canCompleteAccountingReview =
        authorization.accessLevel === "Company Owner" ||
        authorization.designations.includes("Accountant") ||
        authorization.designations.includes("Financial Administrator");
      const priorStatus = existing[0]?.status || "";
      const allowedTransition =
        (!priorStatus && record.status === "PM Preparation") ||
        (priorStatus === "PM Preparation" && ["PM Preparation", "Accountant Review"].includes(record.status)) ||
        (priorStatus === "Accountant Review" && ["Accountant Review", "Owner Approval"].includes(record.status)) ||
        (priorStatus === "Owner Approval" && ["Owner Approval", "Ready To Send"].includes(record.status)) ||
        priorStatus === "Ready To Send" && record.status === "Ready To Send";
      if (!allowedTransition) {
        return Response.json(
          { error: "Owner Billing Must Follow PM Preparation Accountant Review Owner Approval And Ready To Send" },
          { status: 409 },
        );
      }
      if (record.status !== "PM Preparation") {
        const { env } = await import("cloudflare:workers");
        const { error } = await ownerBillingReleaseError(env.DB, projectId, { id: record.id, data: record.data || {} });
        if (error) return Response.json({ error }, { status: 409 });
      }
      if (
        ["PM Preparation", "Accountant Review"].includes(record.status) &&
        (!priorStatus || priorStatus === "PM Preparation") &&
        !canPrepareBilling
      ) {
        return Response.json(
          { error: "The Assigned Project Manager Must Complete The PM Billing Review" },
          { status: 403 },
        );
      }
      if (
        existing[0]?.status === "Accountant Review" &&
        record.status === "Owner Approval" &&
        !canCompleteAccountingReview
      ) {
        return Response.json(
          { error: "An Accountant Must Complete The Accounting Signoff" },
          { status: 403 },
        );
      }
      if (
        record.status === "Ready To Send" &&
        authorization.accessLevel !== "Company Owner"
      ) {
        return Response.json(
          { error: "A Company Owner Must Finalize The Owner Invoice" },
          { status: 403 },
        );
      }
      if (
        record.status === "Ready To Send" &&
        record.data?.documentationRequired === true &&
        record.data?.documentationAlert === true &&
        !String(record.data?.documentationOverrideReason || "").trim()
      ) {
        return Response.json(
          { error: "Resolve The Documentation Discrepancy Or Add An Owner Override Reason" },
          { status: 409 },
        );
      }
    }
    if (projectId === SALES_PROJECT_ID && recordType === SALES_OPPORTUNITY_RECORD_TYPE) {
      record.data = {
        ...(record.data || {}),
        ownerContractType: opportunityOwnerContractType(record.data || {}),
      };
      const directEstimate = record.data?.directEstimate === true;
      const qualificationInput = { ...(record.data || {}), projectName: String(record.data?.projectName || record.title) };
      const qualification = directEstimate
        ? {
            status: String(record.data?.assignedEstimator || "").trim() ? "Ready For Estimating" : "Incomplete",
            missingFields: String(record.data?.assignedEstimator || "").trim() ? [] : ["Assigned Estimator"],
          }
        : salesOpportunityQualification(qualificationInput);
      record.data = {
        ...(record.data || {}),
        qualificationStatus: qualification.status,
        qualificationMissingFields: qualification.missingFields,
      };
      const nextStage = String(record.data.stage || record.status || "");
      if (nextStage === "Estimating" && qualification.missingFields.length) {
        return Response.json(
          { error: `Complete These Fields Before Estimating: ${qualification.missingFields.join(", ")}` },
          { status: 400 },
        );
      }
    }
    if (
      projectId === SALES_PROJECT_ID &&
      recordType === "Sales Opportunities" &&
      String(record.data?.stage || record.status) === "Lost" &&
      String(parseRecordData(existing[0]?.dataJson || "{}").stage || "") !== "Lost" &&
      !String(record.data?.lostReason || "").trim()
    ) {
      return Response.json(
        { error: "A Lost Opportunity Reason Is Required" },
        { status: 400 },
      );
    }
    if (recordType === MASTER_RECORD_TYPE && !authorization.canManageMaster) {
      return Response.json(
        { error: "Company Owner Or Administrator access is required" },
        { status: 403 },
      );
    }
    if (recordType === "Budget" && !authorization.canViewFinancials) {
      return Response.json(
        { error: "Project financial access is required" },
        { status: 403 },
      );
    }
    if (recordType === BUDGET_CONTROL_TYPE && !authorization.canViewFinancials) {
      return Response.json(
        { error: "Project financial access is required" },
        { status: 403 },
      );
    }
    if (
      recordType === "Budget" &&
      isExcludedProfitBudgetRecord(record.id, record.title, record.data)
    ) {
      return Response.json(
        { error: "Contract Fees And Profit Stay On The Estimate And Cannot Be Added To The Job-Cost Budget" },
        { status: 400 },
      );
    }
    const budgetControl = await getBudgetControl(db, projectId);
    if (
      recordType === BUDGET_CONTROL_TYPE &&
      budgetControl.locked &&
      record.data?.locked !== true &&
      !authorization.canManageMaster
    ) {
      return Response.json(
        { error: "Only A Company Owner Or Administrator Can Unlock The Original Budget" },
        { status: 403 },
      );
    }
    if (recordType === BUDGET_CONTROL_TYPE && record.data?.locked === true) {
      const readiness = await projectBudgetReadiness(db, projectId);
      if (!readiness.hasBudget) {
        return Response.json(
          { error: "Select Cost Codes And Enter A Positive Original Budget Before Locking It" },
          { status: 409 },
        );
      }
    }
    if (recordType === "Budget" && budgetControl.locked) {
      const existingData = parseRecordData(existing[0]?.dataJson || "{}");
      const existingOriginal = Number(existingData.originalBudget || 0);
      const nextOriginal = Number(record.data?.originalBudget || 0);
      const existingSelected = existingData.selectedForProject === true;
      const nextSelected = record.data?.selectedForProject === true;
      if (
        (existing.length &&
          (existingOriginal !== nextOriginal || existingSelected !== nextSelected)) ||
        (!existing.length && nextOriginal !== 0)
      ) {
        return Response.json(
          { error: "Unlock The Original Budget Before Changing Cost Codes Or Original Amounts" },
          { status: 409 },
        );
      }
    }
    if (["Subcontracts", "Change Orders"].includes(recordType)) {
      const readiness = await projectBudgetReadiness(db, projectId);
      if (!readiness.ready) {
        return Response.json(
          { error: "A Positive Locked Original Budget Is Required Before Subcontracts Or Change Orders Can Be Created Or Updated" },
          { status: 409 },
        );
      }
    }
    if (
      recordType === "Subcontracts" &&
      ["Approved", "Awaiting Signatures", "Awaiting Mefford Signature", "Executed"].includes(record.status)
    ) {
      await ensureVendorSchema();
      const signerEmail = String(record.data?.signerEmail || "").trim().toLowerCase();
      const subcontractorName = String(record.data?.subcontractor || record.title).trim().toLowerCase();
      const vendorRows = await db
        .select()
        .from(vendorProfiles)
        .where(
          or(
            eq(vendorProfiles.contactEmail, signerEmail),
            eq(vendorProfiles.legalName, String(record.data?.subcontractor || record.title).trim()),
          ),
        );
      const vendor = vendorRows.find(
        (item) => item.contactEmail.toLowerCase() === signerEmail || item.legalName.toLowerCase() === subcontractorName,
      );
      if (!vendor) {
        return Response.json(
          { error: "Create And Onboard This Subcontractor In Vendor Management Before Contract Release" },
          { status: 409 },
        );
      }
      const projectScope = await db
        .select()
        .from(vendorProjectAccess)
        .where(and(eq(vendorProjectAccess.vendorId, vendor.id), eq(vendorProjectAccess.projectId, projectId)))
        .limit(1);
      if (!projectScope[0]) {
        return Response.json(
          { error: "Subcontract Release Requires A Project Assignment In Vendor Management" },
          { status: 409 },
        );
      }
    }
    if (projectId === SALES_PROJECT_ID && recordType === SALES_OPPORTUNITY_RECORD_TYPE && String(record.data?.stage || record.status || "") === "Estimating") {
      const now = new Date().toISOString();
      record.data = {
        ...(record.data || {}),
        estimatingRequestedAt: String(record.data?.estimatingRequestedAt || now),
        estimatingLockedAt: String(record.data?.estimatingLockedAt || now),
        estimatingLockedBy: String(record.data?.estimatingLockedBy || actor.name),
      };
    }
    if (projectId === SALES_PROJECT_ID && isDesignBuildSalesOpportunity(recordType, record)) {
      await ensureSalesDesignTrack(db, record, actor);
    }
    const recordWrite = db
      .insert(commandRecords)
      .values({
        projectId,
        id: record.id,
        recordType,
        title: record.title,
        owner: record.owner,
        due: record.due,
        status: record.status,
        meta: record.meta ?? "",
        recordDate: record.recordDate || null,
        recordTime: record.recordTime || null,
        dateLocked: Boolean(record.dateLocked),
        dataJson: JSON.stringify(record.data ?? {}),
      })
      .onConflictDoUpdate({
        target: [commandRecords.projectId, commandRecords.id],
        set: {
          recordType,
          title: record.title,
          owner: record.owner,
          due: record.due,
          status: record.status,
          meta: record.meta ?? "",
          recordDate: record.recordDate || null,
          recordTime: record.recordTime || null,
          dateLocked: Boolean(record.dateLocked),
          dataJson: JSON.stringify(record.data ?? {}),
          updatedAt: new Date().toISOString(),
        },
      });

    const firstApApproval = projectId === ACCOUNTING_PROJECT_ID && recordType === "AP Invoice" && record.status === "Approved Unpaid" && !["Approved Unpaid", "Payment Released", "Paid"].includes(existing[0]?.status || "");
    let contractAmendmentId = "";
    if (firstApApproval) {
      await accrueApprovedApInvoice(db, record, actor, recordWrite.toSQL(), existing[0]);
    } else if (recordType === "Change Orders" && record.status === "Executed") {
      contractAmendmentId = await syncExecutedChangeOrderContract(db, projectId, record, actor, recordWrite.toSQL(), existing[0]);
    } else if (projectId === SALES_PROJECT_ID && recordType === SALES_OPPORTUNITY_RECORD_TYPE && record.data?.estimatingRequestedAt) {
      const { env } = await import("cloudflare:workers");
      await ensureDomainOutboxSchema(env.DB);
      const write = recordWrite.toSQL(), eventId = `sales-turnover:${record.id}`;
      await env.DB.batch([
        env.DB.prepare(write.sql).bind(...write.params),
        ...domainEventStatements(env.DB, { id: eventId, idempotencyKey: eventId, eventType: "sales.estimating-requested", aggregateType: "Sales Opportunity", aggregateId: record.id, projectId: SALES_PROJECT_ID, payload: { opportunityId: record.id }, actorName: actor.name, actorEmail: actor.email, consumers: [{ key: "source-estimating-request", completedInSourceTransaction: true, result: { opportunityId: record.id } }, { key: "sales-turnover-meeting" }] }),
      ]);
      await reconcileDomainEvent(env.DB, eventId);
    } else {
      await recordWrite;
    }

    if (projectId === SALES_PROJECT_ID && recordType === SALES_OPPORTUNITY_RECORD_TYPE) {
      await synchronizeOpportunityProposalContractType(
        db,
        record.id,
        opportunityOwnerContractType(record.data || {}),
        actor,
      );
    }

    if (firstApApproval) {
      const { env } = await import("cloudflare:workers");
      await recordCompletedWorkflowHandoff(env.DB, { workflowId: "ap-to-job-cost", eventId: `ap-invoice-posted:${record.id}`, aggregateType: "AP Invoice", aggregateId: record.id, projectId: String(record.data?.projectId || ACCOUNTING_PROJECT_ID), actorName: actor.name, actorEmail: actor.email, payload: { invoiceId: record.id, status: record.status, allocations: record.data?.allocations || [] } });
    }

    if (recordType === "Schedule") {
      await syncScheduleQualityRequest(db, projectId, record, actor);
    }
    if (recordType === "Change Orders" && record.status === "Executed") {
      const { env } = await import("cloudflare:workers");
      await recordCompletedWorkflowHandoff(env.DB, { workflowId: "change-order-control", eventId: `change-order-executed:${projectId}:${record.id}`, aggregateType: "Change Orders", aggregateId: record.id, projectId, actorName: actor.name, actorEmail: actor.email, payload: { changeOrderId: record.id, contractAmendmentId, approvedTotal: record.data?.approvedTotal, scheduleDays: record.data?.scheduleDays } });
    }

    const previousData = parseRecordData(existing[0]?.dataJson || "{}");
    if (
      recordType === "Owner Billing" &&
      record.data?.documentationAlert === true &&
      previousData.documentationAlert !== true
    ) {
      const managerName = String(record.data?.projectManager || "Project Manager");
      const financialLeaders = await db
        .select({
          name: companyMembers.displayName,
          email: companyMembers.email,
          accessLevel: companyMembers.companyAccessLevel,
        })
        .from(companyMembers)
        .where(eq(companyMembers.isActive, true));
      const recipients = [
        { name: managerName, email: "" },
        ...financialLeaders
          .filter((member) => ["Company Owner", "Administrator"].includes(member.accessLevel))
          .map((member) => ({ name: member.name, email: member.email })),
      ].filter(
        (recipient, index, list) =>
          list.findIndex((item) => item.name === recipient.name) === index,
      );
      await db.insert(commandNotifications).values(recipients.map((recipient) => ({
        projectId,
        recipientName: recipient.name,
        recipientEmail: recipient.email || null,
        kind: "Owner Billing Documentation",
        title: "Owner Invoice Documentation Discrepancy",
        message: String(record.data?.alertReason || "Supporting cost documentation is below the approved threshold."),
        isRead: false,
      })));
    }

    if (
      projectId === SALES_PROJECT_ID &&
      recordType === "Sales Opportunities" &&
      String(record.data?.stage || record.status) === "Lost"
    ) {
      const archiveYear = String(
        record.recordDate || new Date().toISOString().slice(0, 10),
      ).slice(0, 4);
      const archivePrefix = `${archiveYear} / ${record.id} - ${record.title} / `;
      await db
        .update(projectFiles)
        .set({
          projectId: "MEFFORD-BID-ARCHIVE",
          category: sql`${archivePrefix} || ${projectFiles.category}`,
          revision: sql`${projectFiles.revision} || ' · Archived Lost Bid'`,
        })
        .where(eq(projectFiles.projectId, `ESTIMATE-${record.id}`));
    }

    if (!existing.length && record.initialAudit) {
      await db.insert(recordAudits).values({
        projectId,
        recordId: record.id,
        fieldName: "Finalization",
        oldValue: "Draft",
        newValue: record.status,
        reason: "Record finalized",
        actorName: actor.name,
        actorEmail: actor.email,
        summary: record.initialAudit,
      });
    }

    if (projectId === ACCOUNTING_PROJECT_ID && recordType === "AP Invoice" && record.status !== "Draft") {
      const invoiceData = record.data || {};
      const allocations = Array.isArray(invoiceData.allocations) ? invoiceData.allocations as Array<Record<string, unknown>> : [];
      const destinations = Array.from(new Set(allocations.map((allocation) => String(allocation.destination || "").trim()).filter((destination) => destination && destination !== "Company Overhead")));
      for (const destination of destinations) {
        const projectAllocations = allocations.filter((allocation) => String(allocation.destination || "").trim() === destination);
        await ensureConditionalWaiverForBilling(db, {
          projectId: destination,
          vendorId: String(invoiceData.vendorId || ""),
          vendorName: String(invoiceData.vendor || record.title),
          vendorEmail: String(invoiceData.vendorEmail || ""),
          commitmentReference: Array.from(new Set(projectAllocations.map((allocation) => String(allocation.commitmentReference || "Direct Project Expense")).filter(Boolean))).join(", "),
          payApplicationReference: `Invoice ${String(invoiceData.invoiceNumber || record.id)}`,
          linkedApRecordId: record.id,
          amount: projectAllocations.reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0),
          retainage: Number(invoiceData.retainage || 0),
          throughDate: String(record.recordDate || new Date().toISOString().slice(0, 10)),
          finalApplication: invoiceData.finalApplication === true,
          createdBy: actor.name,
          actorEmail: actor.email,
        });
      }
    }

    if (!projectId.startsWith("MEFFORD-")) {
      const { reconcileProjectHealthAfterUpdate } = await import("../project-health/route");
      await reconcileProjectHealthAfterUpdate(projectId, actor);
    }

    let microsoftFileWorkspace: Awaited<ReturnType<(typeof import("../../../lib/sharepoint-storage"))["registerSharePointWorkspace"]>> | null = null;
    let microsoftFileWarning = "";
    if (projectId === SALES_PROJECT_ID && recordType === "Sales Opportunities") {
      try {
        const { registerSharePointWorkspace } = await import("../../../lib/sharepoint-storage");
        microsoftFileWorkspace = await registerSharePointWorkspace({
          entityType: "Estimate",
          entityId: record.id,
          displayName: record.title,
          sourceProjectId: projectId,
          sourceRecordId: record.id,
          actorName: actor.name,
          actorEmail: actor.email,
        });
      } catch (error) {
        microsoftFileWarning = error instanceof Error ? error.message : "Microsoft Estimate File Mapping Could Not Be Registered";
      }
    }

    let changeOrderEffects;
    if (contractAmendmentId) {
      const project = (await db.select().from(projects).where(eq(projects.number, projectId)).limit(1))[0];
      const budgets = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, "Budget")));
      changeOrderEffects = { projectUpdate: { currentContractAmount: project.currentContractAmount, substantialDate: project.substantialDate, finalDate: project.finalDate }, budgetUpdates: budgets.map(row => ({ id: row.id, data: ["Chart Of Accounts", "Journal Entry", "AP Invoice", "Recurring Payment"].includes(row.recordType) ? normalizeAccountReferences(parseRecordData(row.dataJson)) : parseRecordData(row.dataJson), meta: row.meta })) };
    }
    return Response.json({ saved: true, id: record.id, contractAmendmentId, changeOrderEffects, microsoftFileWorkspace, microsoftFileWarning }, { status: 201 });
  } catch (error) {
    return databaseError(error);
  }
}

function immutableChangeOrderSnapshot(data: Record<string, unknown>) {
  const contractTerms = { ...data };
  delete contractTerms.scheduleUpdateStatus;
  delete contractTerms.workflowHistory;
  return contractTerms;
}

async function syncExecutedChangeOrderContract(
  db: Awaited<ReturnType<typeof commandDatabase>>,
  projectId: string,
  changeOrder: NonNullable<RecordPayload["record"]>,
  actor: ReturnType<typeof getCommandActor>,
  recordWrite: { sql: string; params: unknown[] },
  previous?: { status: string; dataJson: string },
) {
  const data = changeOrder.data || {};
  const amendmentId = `AMEND-${changeOrder.id}`;
  const existing = await db.select({ status: commandRecords.status, dataJson: commandRecords.dataJson })
    .from(commandRecords)
    .where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, amendmentId)))
    .limit(1);
  if (existing[0]?.status === "Executed") {
    const existingData = parseRecordData(existing[0].dataJson);
    if (String(existingData.sourceChangeOrderId || "") !== changeOrder.id) {
      throw new Error("The Reserved Contract Amendment Number Is Already In Use");
    }
    const { env } = await import("cloudflare:workers");
    await env.DB.prepare(recordWrite.sql).bind(...recordWrite.params).run();
    return amendmentId;
  }
  const now = new Date().toISOString();
  const changeAmount = Number(data.approvedTotal || 0);
  const { env } = await import("cloudflare:workers");
  await reconcileAwardContractTotals(env.DB, [projectId]);
  const project = (await db.select().from(projects).where(eq(projects.number, projectId)).limit(1))[0];
  if (!project || !previous) throw new RecordConflict("The Existing Project And Released Change Order Are Required");
  const pricingLines = (Array.isArray(data.pricingLines) ? data.pricingLines : []) as Array<Record<string, unknown>>;
  const direction = data.changeType === "Deductive" ? -1 : data.changeType === "No Cost" ? 0 : 1;
  if (pricingLines.some(line => !String(line.costCode || "").trim() || !Number.isFinite(Number(line.cost)) || Number(line.cost) < 0 || !Number.isFinite(Number(line.markupPercent || 0)) || Number(line.markupPercent || 0) < 0)) throw new RecordConflict("Every Change Order Price Requires A Valid Cost Code, Cost And Markup");
  const adjustments = new Map<string, number>();
  for (const line of pricingLines) {
    const code = String(line.costCode);
    adjustments.set(code, (adjustments.get(code) || 0) + direction * toCents(Number(line.cost) * (1 + Number(line.markupPercent || 0) / 100)));
  }
  if (!Number.isFinite(changeAmount) || toCents(changeAmount) !== [...adjustments.values()].reduce((sum, amount) => sum + amount, 0)) throw new RecordConflict("The Change Amount Must Match Its Priced Cost-Code Lines Exactly");
  const priorData = parseRecordData(previous.dataJson);
  if (toCents(priorData.approvedTotal) !== toCents(changeAmount) || JSON.stringify(priorData.pricingLines || []) !== JSON.stringify(pricingLines)) throw new RecordConflict("Released Pricing Cannot Change During Execution. Return It For Release Approval.");
  const revisedAmount = (toCents(project.currentContractAmount || project.contractAmount) + toCents(changeAmount)) / 100;
  if (revisedAmount < 0 || toCents(data.contractValueAfterThisChange) !== toCents(revisedAmount)) throw new RecordConflict("The Contract Value Changed. Reload And Review The Change Order Before Execution.");
  const file = (await db.select().from(projectFiles).where(and(eq(projectFiles.projectId, projectId), Number(data.executedFileId) > 0 ? eq(projectFiles.id, Number(data.executedFileId)) : eq(projectFiles.name, String(data.executedFileName || "")))).orderBy(desc(projectFiles.id)).limit(1))[0];
  if (!String(data.ownerSignatureName || "").trim() || !file || file.contentType !== "application/pdf" || !(await env.BUCKET.head(file.storageKey))) throw new RecordConflict("An Owner Signer And Stored Executed PDF Are Required");
  const budgets = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, "Budget")));
  if ([...adjustments.keys()].some(code => !budgets.some(budget => budget.id === code && parseRecordData(budget.dataJson).selectedForProject === true))) throw new RecordConflict("Every Change Order Cost Code Must Be Selected In The Project Budget");
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`INSERT INTO record_audits (project_id, record_id, field_name, old_value, new_value, reason, actor_name, actor_email, summary)
      VALUES (?, (SELECT r.id FROM command_records r JOIN projects p ON p.number = r.project_id WHERE r.project_id = ? AND r.id = ? AND r.status = ? AND r.data_json = ? AND p.current_contract_amount = ?), 'Change Order Execution', ?, 'Executed', 'Atomic contract budget and schedule handoff', ?, ?, ?)`)
      .bind(projectId, projectId, changeOrder.id, previous.status, previous.dataJson, project.currentContractAmount, previous.status, actor.name, actor.email, changeOrder.id + " executed with its project financial controls"),
    env.DB.prepare(recordWrite.sql).bind(...recordWrite.params),
  ];
  const amendmentData = {
    contractDocumentType: "Executed Change Order Amendment",
    amendmentNumber: changeOrder.id,
    sourceChangeOrderId: changeOrder.id,
    sourceChangeOrderTitle: changeOrder.title,
    originalContractValue: Number(data.originalContractValue || 0),
    previousApprovedChangeOrders: Number(data.previousApprovedChangeOrders || 0),
    changeAmount,
    contractValueAfterThisChange: Number(data.contractValueAfterThisChange || 0),
    changeType: String(data.changeType || "Additive"),
    pricingLines: Array.isArray(data.pricingLines) ? data.pricingLines : [],
    ownerSignatureName: String(data.ownerSignatureName || ""),
    ownerSignatureTitle: String(data.ownerSignatureTitle || ""),
    ownerSignatureDate: String(data.ownerSignatureDate || changeOrder.recordDate || now.slice(0, 10)),
    ownerSignatureMethod: String(data.ownerSignatureMethod || ""),
    executedAt: String(data.executedAt || now),
    executedFileName: String(data.executedFileName || `${changeOrder.id} Executed.pdf`),
    filedProjectPath: String(data.filedProjectPath || `Financial Info / Change Orders / ${changeOrder.id} Executed.pdf`),
    priorSubstantialDate: String(data.priorSubstantialDate || ""),
    newSubstantialDate: String(data.newSubstantialDate || ""),
    priorFinalDate: String(data.priorFinalDate || ""),
    newFinalDate: String(data.newFinalDate || ""),
    immutable: true,
    version: 1,
    createdFromExecutedChangeOrderAt: now,
  };
  const amendmentWrite = db.insert(commandRecords).values({
    projectId,
    id: amendmentId,
    recordType: "Contracts",
    title: `Contract Amendment ${changeOrder.id} · ${changeOrder.title}`,
    owner: changeOrder.owner,
    due: changeOrder.due,
    status: "Executed",
    meta: `${changeOrder.id} · ${changeAmount.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 })} · Permanent Contract Amendment`,
    recordDate: String(data.ownerSignatureDate || changeOrder.recordDate || now.slice(0, 10)),
    recordTime: changeOrder.recordTime || now.slice(11, 16),
    dateLocked: true,
    dataJson: JSON.stringify(amendmentData),
    updatedAt: now,
  });
  const auditWrite = db.insert(recordAudits).values([
    {
      projectId, recordId: amendmentId, fieldName: "Contract Amendment Created", oldValue: "None", newValue: "Executed",
      reason: "Executed change order became part of the owner contract",
      actorName: actor.name, actorEmail: actor.email,
      summary: `${amendmentId} was created automatically from ${changeOrder.id}. The executed document, signature, value, dates, and source link are immutable.`,
    },
    {
      projectId, recordId: changeOrder.id, fieldName: "Contract Link", oldValue: "Unlinked", newValue: amendmentId,
      reason: "Every executed change order must be part of the contract record",
      actorName: actor.name, actorEmail: actor.email,
      summary: `${changeOrder.id} is permanently linked to contract amendment ${amendmentId}.`,
    },
  ]);
  const projectWrite = db.update(projects).set({ currentContractAmount: String(revisedAmount), substantialDate: String(data.newSubstantialDate || project.substantialDate), finalDate: String(data.newFinalDate || project.finalDate), updatedAt: now }).where(eq(projects.number, projectId));
  for (const write of [amendmentWrite, auditWrite, projectWrite]) {
    const query = write.toSQL();
    statements.push(env.DB.prepare(query.sql).bind(...query.params));
  }
  for (const budget of budgets) {
    const adjustment = adjustments.get(budget.id) || 0;
    if (!adjustment) continue;
    const budgetData = parseRecordData(budget.dataJson);
    // Compare the exact source before replacing it so a concurrent budget edit cannot be lost.
    statements.push(env.DB.prepare(`INSERT INTO record_audits (project_id, record_id, field_name, old_value, new_value, reason, actor_name, actor_email, summary)
      VALUES (?, (SELECT id FROM command_records WHERE project_id = ? AND id = ? AND data_json = ?), 'Approved Change', ?, ?, ?, ?, ?, ?)`).bind(projectId, projectId, budget.id, budget.dataJson, String(budgetData.approvedChanges || 0), String((toCents(budgetData.approvedChanges) + adjustment) / 100), changeOrder.id, actor.name, actor.email, changeOrder.id + " applied once to " + budget.id));
    const write = db.update(commandRecords).set({ dataJson: JSON.stringify({ ...budgetData, approvedChanges: (toCents(budgetData.approvedChanges) + adjustment) / 100, forecastCost: (toCents(budgetData.forecastCost) + adjustment) / 100 }), meta: String(budgetData.division || "") + " · Updated By " + changeOrder.id, updatedAt: now }).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, budget.id))).toSQL();
    statements.push(env.DB.prepare(write.sql).bind(...write.params));
  }
  await env.DB.batch(statements);
  return amendmentId;
}

async function syncScheduleQualityRequest(
  db: Awaited<ReturnType<typeof commandDatabase>>,
  projectId: string,
  scheduleRecord: NonNullable<RecordPayload["record"]>,
  actor: ReturnType<typeof getCommandActor>,
) {
  const categoryId = String(scheduleRecord.data?.qualityCategoryId || "");
  const category = scheduleQualityCategory(categoryId);
  if (!category) return;
  const now = new Date().toISOString();
  const projectRows = await db.select().from(projects).where(eq(projects.number, projectId)).limit(1);
  const project = projectRows[0];
  if (!project) return;
  const existingRows = await db.select().from(commandRecords).where(and(
    eq(commandRecords.projectId, projectId),
    eq(commandRecords.recordType, QUALITY_INSPECTION_RECORD_TYPE),
  ));
  const linkedRequests = existingRows.filter((row) => String(parseRecordData(row.dataJson).scheduleActivityId || "") === scheduleRecord.id);
  const requestId = category.templateId ? `QIR-${scheduleRecord.id}-${category.id}` : "";
  for (const linked of linkedRequests.filter((row) => row.id !== requestId && !["Passed", "Override Documented", "Superseded"].includes(row.status))) {
    await db.update(commandRecords).set({ status: "Superseded", meta: `${linked.meta} · Schedule Category Changed`, updatedAt: now }).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, linked.id)));
    await db.insert(recordAudits).values({
      projectId,
      recordId: linked.id,
      fieldName: "Schedule Quality Category",
      oldValue: String(parseRecordData(linked.dataJson).qualityCategoryId || ""),
      newValue: category.id,
      reason: "Schedule activity quality category changed",
      actorName: actor.name,
      actorEmail: actor.email,
      summary: `${linked.id} superseded after ${scheduleRecord.id} was categorized as ${category.label}. The prior request and history remain permanent.`,
    });
  }
  if (!category.templateId) return;
  const template = PREWORK_QUALITY_TEMPLATES.find((item) => item.id === category.templateId);
  if (!template) return;
  const existing = linkedRequests.find((row) => row.id === requestId);
  const previousData = parseRecordData(existing?.dataJson || "{}");
  const locked = ["Passed", "Override Documented"].includes(existing?.status || "");
  const due = qualityChecklistDueDate(String(scheduleRecord.data?.start || scheduleRecord.recordDate || ""), category.id) || String(scheduleRecord.recordDate || new Date().toISOString().slice(0, 10));
  const data = {
    ...previousData,
    requestType: "Schedule Triggered Pre-Work",
    scheduleActivityId: scheduleRecord.id,
    scheduleActivityTitle: scheduleRecord.title,
    scheduleStart: String(scheduleRecord.data?.start || scheduleRecord.recordDate || ""),
    responsibleTrade: String(scheduleRecord.data?.trade || scheduleRecord.owner || ""),
    qualityCategoryId: category.id,
    qualityCategoryLabel: category.label,
    templateId: template.id,
    templateTitle: template.title,
    leadDays: category.leadDays,
    promptCreatedBy: "Schedule Quality Automation",
    promptCreatedAt: String(previousData.promptCreatedAt || now),
    completionChoices: ["Complete Full Mefford Checklist", "Document Qualified Superintendent Override"],
    overrideRequirements: ["Alternate Full-Scope Checklist Or Meeting", "Affected Trade", "Completion Date", "Specific Explanation", "Superintendent Attestation"],
    immutableAfterDisposition: true,
  };
  if (existing && locked) return;
  await db.insert(commandRecords).values({
    projectId,
    id: requestId,
    recordType: QUALITY_INSPECTION_RECORD_TYPE,
    title: `${template.shortTitle} Pre-Work · ${scheduleRecord.title}`,
    owner: project.superintendent,
    due,
    status: "Superintendent Action Required",
    meta: `${scheduleRecord.id} · ${String(scheduleRecord.data?.trade || scheduleRecord.owner)} · Checklist Or Documented Override`,
    recordDate: now.slice(0, 10),
    recordTime: now.slice(11, 16),
    dateLocked: true,
    dataJson: JSON.stringify(data),
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [commandRecords.projectId, commandRecords.id],
    set: {
      title: `${template.shortTitle} Pre-Work · ${scheduleRecord.title}`,
      owner: project.superintendent,
      due,
      status: "Superintendent Action Required",
      meta: `${scheduleRecord.id} · ${String(scheduleRecord.data?.trade || scheduleRecord.owner)} · Checklist Or Documented Override`,
      dataJson: JSON.stringify(data),
      updatedAt: now,
    },
  });
  if (!existing) {
    await db.insert(recordAudits).values({
      projectId,
      recordId: requestId,
      fieldName: "Automatic Pre-Work Request",
      oldValue: "None",
      newValue: "Superintendent Action Required",
      reason: "Upcoming categorized schedule activity",
      actorName: "Schedule Quality Automation",
      actorEmail: actor.email,
      summary: `${scheduleRecord.id} was categorized ${category.label}. ${template.title} was requested from ${project.superintendent} for ${due}; completion or a qualified documented override is required.`,
    });
  }
}

function apInvoiceFinancialSnapshot(data: Record<string, unknown>) {
  const allocations = Array.isArray(data.allocations) ? data.allocations as Array<Record<string, unknown>> : [];
  return JSON.stringify({
    vendor: String(data.vendor || "").trim(), vendorId: String(data.vendorId || ""), invoiceNumber: String(data.invoiceNumber || "").trim(), total: toCents(data.total), retainage: toCents(data.retainage),
    allocations: allocations.map((item) => ({ id: String(item.id || ""), destination: String(item.destination || ""), code: item.destination === "Company Overhead" ? currentAccountNumber(item.code) : String(item.code || ""), amount: toCents(item.amount), commitmentType: String(item.commitmentType || ""), commitmentReference: String(item.commitmentReference || "") })),
  });
}

async function accrueApprovedApInvoice(
  db: Awaited<ReturnType<typeof commandDatabase>>,
  record: NonNullable<RecordPayload["record"]>,
  actor: ReturnType<typeof getCommandActor>,
  recordWrite: { sql: string; params: unknown[] },
  previous?: { status: string; dataJson: string },
) {
  const invoiceData = record.data || {};
  const invoiceAllocations = Array.isArray(invoiceData.allocations)
    ? invoiceData.allocations as Array<Record<string, unknown>>
    : [];
  const invoiceDate = record.recordDate || new Date().toISOString().slice(0, 10);
  const vendor = String(invoiceData.vendor || record.title);
  const invoiceNumber = String(invoiceData.invoiceNumber || record.id);
  const { env } = await import("cloudflare:workers");
  const statements: D1PreparedStatement[] = [env.DB.prepare(recordWrite.sql).bind(...recordWrite.params)];
  const postingEntryId = `AUTO-${stableAccountingKey(`AP_ACCRUAL:${record.id}`)}`;
  const now = new Date().toISOString();
  for (const [index, allocation] of invoiceAllocations.entries()) {
    const destination = String(allocation.destination || "").trim();
    if (!destination || destination === "Company Overhead") continue;
    const allocationId = String(allocation.id || index).replace(/[^a-zA-Z0-9_-]/g, "-");
    const amount = Number(allocation.amount || 0);
    const jobCostWrite = db.insert(commandRecords).values({
      projectId: destination,
      id: `JOB-COST-${record.id}-${allocationId}`,
      recordType: "Job Cost Actual",
      title: `${vendor} · ${invoiceNumber}`,
      owner: actor.name,
      due: invoiceDate,
      status: "Posted",
      meta: `${String(allocation.code || "Uncoded")} · ${amount.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      recordDate: invoiceDate,
      dateLocked: true,
      dataJson: JSON.stringify({ source: "Accounts Payable Accrual", invoiceId: record.id, vendor: invoiceData.vendor, invoiceNumber, costCode: allocation.code, commitmentType: allocation.commitmentType, commitmentReference: allocation.commitmentReference, amount, recognizedAtApproval: true, postedBy: actor.name, postedAt: now }),
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [commandRecords.projectId, commandRecords.id],
      set: {
        title: `${vendor} · ${invoiceNumber}`,
        owner: actor.name,
        due: invoiceDate,
        status: "Posted",
        meta: `${String(allocation.code || "Uncoded")} · ${amount.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        recordDate: invoiceDate,
        dateLocked: true,
        dataJson: JSON.stringify({ source: "Accounts Payable Accrual", invoiceId: record.id, vendor: invoiceData.vendor, invoiceNumber, costCode: allocation.code, commitmentType: allocation.commitmentType, commitmentReference: allocation.commitmentReference, amount, recognizedAtApproval: true, postedBy: actor.name, postedAt: now }),
        updatedAt: now,
      },
    });
    const query = jobCostWrite.toSQL();
    statements.push(env.DB.prepare(query.sql).bind(...query.params));
  }
  const invoiceWrite = db.update(commandRecords).set({
    dataJson: JSON.stringify({ ...invoiceData, livePosting: true, costRecognition: "Approval Accrual", costRecognitionDate: invoiceDate, accountingEntryId: postingEntryId }),
    updatedAt: now,
  }).where(and(eq(commandRecords.projectId, ACCOUNTING_PROJECT_ID), eq(commandRecords.id, record.id)));
  const auditWrite = db.insert(recordAudits).values({
    projectId: ACCOUNTING_PROJECT_ID,
    recordId: record.id,
    fieldName: "Accounting Accrual",
    oldValue: "Unposted",
    newValue: "Posted",
    reason: "Invoice approved for payment",
    actorName: actor.name,
    actorEmail: actor.email,
    summary: `${vendor} invoice ${invoiceNumber} was recognized as project cost or overhead and credited to Accounts Payable on approval. Payment will clear the liability without creating duplicate cost.`,
  });
  for (const write of [invoiceWrite, auditWrite]) {
    const query = write.toSQL();
    statements.push(env.DB.prepare(query.sql).bind(...query.params));
  }
  await postAccountingEvent(env.DB, {
    idempotencyKey: `AP_ACCRUAL:${record.id}`,
    eventType: "AP Invoice Approved",
    sourceType: "AP Invoice",
    sourceProjectId: ACCOUNTING_PROJECT_ID,
    sourceRecordId: record.id,
    eventDate: invoiceDate,
    reference: invoiceNumber,
    description: `${vendor} · Invoice ${invoiceNumber}`,
    actor,
    metadata: { vendorId: invoiceData.vendorId, vendor, approvalStatus: record.status },
    lines: apAccrualLines({ id: record.id, vendor, invoiceNumber, allocations: invoiceAllocations }),
    sourceSnapshot: previous ? { projectId: ACCOUNTING_PROJECT_ID, recordId: record.id, status: previous.status, dataJson: previous.dataJson } : undefined,
    relatedStatements: statements,
  });
}

async function commandDatabase() {
  const { env } = await import("cloudflare:workers");
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS command_records (
      project_id text NOT NULL,
      id text NOT NULL,
      record_type text NOT NULL,
      title text NOT NULL,
      owner text NOT NULL,
      due text NOT NULL,
      status text NOT NULL,
      meta text DEFAULT '' NOT NULL,
      record_date text,
      record_time text,
      date_locked integer DEFAULT false NOT NULL,
      data_json text DEFAULT '{}' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      PRIMARY KEY(project_id, id)
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS record_audits (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      project_id text NOT NULL,
      record_id text NOT NULL,
      field_name text NOT NULL,
      old_value text NOT NULL,
      new_value text NOT NULL,
      reason text NOT NULL,
      actor_name text NOT NULL,
      actor_email text NOT NULL,
      summary text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS company_members (
      email text PRIMARY KEY NOT NULL,
      display_name text NOT NULL,
      company_access_level text NOT NULL,
      designations_json text DEFAULT '[]' NOT NULL,
      is_active integer DEFAULT true NOT NULL,
      identity_provider text DEFAULT 'microsoft_entra_pending' NOT NULL,
      provider_subject text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
  ]);
  const { getDb } = await import("../../../db");
  return getDb();
}

async function recordAuthorization(
  db: Awaited<ReturnType<typeof commandDatabase>>,
  actor: ReturnType<typeof getCommandActor>,
) {
  let accessLevel = actor.accessLevel;
  let designations: string[] = [];
  if (actor.email) {
    const member = await db
      .select({
        accessLevel: companyMembers.companyAccessLevel,
        designationsJson: companyMembers.designationsJson,
      })
      .from(companyMembers)
      .where(eq(companyMembers.email, actor.email))
      .limit(1);
    if (member[0]?.accessLevel === "Administrator") {
      accessLevel = "Administrator";
    } else if (member[0]?.accessLevel === "Company Owner") {
      accessLevel = "Company Owner";
    }
    try {
      const parsed = JSON.parse(member[0]?.designationsJson || "[]") as unknown;
      designations = Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : [];
    } catch {
      designations = [];
    }
  }
  const canManageMaster = ["Company Owner", "Administrator"].includes(
    accessLevel,
  );
  return {
    canManageMaster,
    accessLevel,
    designations,
    canAccessSales:
      canManageMaster ||
      designations.includes("Estimator") ||
      designations.includes("Sales Representative") ||
      designations.includes("Marketing"),
    canAccessAccounting:
      accessLevel === "Company Owner" ||
      designations.includes("Accountant") ||
      designations.includes("Financial Administrator"),
    canAccessOwnerBilling:
      ["Company Owner", "Administrator"].includes(accessLevel) ||
      designations.includes("Project Manager") ||
      designations.includes("Accountant") ||
      designations.includes("Financial Administrator"),
    canViewAllOwnerBilling:
      ["Company Owner", "Administrator"].includes(accessLevel) ||
      designations.includes("Accountant") ||
      designations.includes("Financial Administrator"),
    canViewFinancials:
      canManageMaster || designations.includes("Project Manager"),
    canViewSafetyIncidents:
      canManageMaster ||
      designations.includes("Project Manager") ||
      designations.some((designation) => ["Safety Director", "Safety"].includes(designation)),
  };
}

async function canAccessProjectScope(
  db: Awaited<ReturnType<typeof commandDatabase>>,
  actor: ReturnType<typeof getCommandActor>,
  projectId: string,
) {
  return canReadProjectId(db, actor, projectId);
}

function ownerBillingInvoiceData(
  data: Record<string, unknown>,
  allowedProjectNumbers: Set<string>,
) {
  const allocations = Array.isArray(data.allocations)
    ? data.allocations as Array<Record<string, unknown>>
    : [];
  return {
    ...data,
    allocations: allocations.filter((allocation) =>
      allowedProjectNumbers.has(String(allocation.destination || "")),
    ),
    bankAccount: undefined,
    bankRouting: undefined,
    cardholder: undefined,
    cardLastFour: undefined,
  };
}

async function getBudgetControl(
  db: Awaited<ReturnType<typeof commandDatabase>>,
  projectId: string,
) {
  const rows = await db
    .select({ dataJson: commandRecords.dataJson })
    .from(commandRecords)
    .where(
      and(
        eq(commandRecords.projectId, projectId),
        eq(commandRecords.id, BUDGET_CONTROL_ID),
      ),
    )
    .limit(1);
  const data = parseRecordData(rows[0]?.dataJson || "{}");
  return { locked: data.locked === true };
}

async function projectBudgetReadiness(
  db: Awaited<ReturnType<typeof commandDatabase>>,
  projectId: string,
) {
  const [control, budgetRows] = await Promise.all([
    getBudgetControl(db, projectId),
    db
      .select({ id: commandRecords.id, dataJson: commandRecords.dataJson })
      .from(commandRecords)
      .where(
        and(
          eq(commandRecords.projectId, projectId),
          eq(commandRecords.recordType, "Budget"),
        ),
      ),
  ]);
  const selectedRows = budgetRows.filter((row) => {
    const data = parseRecordData(row.dataJson);
    return (
      data.selectedForProject === true &&
      !excludedProfitCostCodes.has(String(data.code || row.id))
    );
  });
  const originalBudget = selectedRows.reduce(
    (total, row) =>
      total + Number(parseRecordData(row.dataJson).originalBudget || 0),
    0,
  );
  return {
    hasBudget: selectedRows.length > 0 && originalBudget > 0,
    ready: control.locked && selectedRows.length > 0 && originalBudget > 0,
  };
}

function isExcludedProfitBudgetRecord(
  id: string,
  title: string,
  data?: Record<string, unknown>,
) {
  const code = String(data?.code || id);
  const description = String(data?.description || title);
  return (
    excludedProfitCostCodes.has(code) ||
    /(^|\b)(overhead\s*&?\s*profit|buy\s*out\s*\(profit\))/i.test(
      description,
    )
  );
}

class RecordConflict extends Error {}

function databaseError(error: unknown) {
  if (error instanceof RecordConflict) return Response.json({ error: error.message }, { status: 409 });
  const message = error instanceof Error ? error.message : "Unexpected error";
  const detail =
    error instanceof Error && error.cause instanceof Error
      ? error.cause.message
      : "";
  const combined = `${message}\n${detail}`;
  const friendly = combined.includes("no such table")
    ? "Command Center storage is initializing. Publish the generated database migration before saving records."
    : "Command Center could not reach permanent storage.";
  return Response.json({ error: friendly }, { status: 500 });
}

function parseRecordData(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
