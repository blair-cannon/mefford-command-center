import { projectDesignationsFor } from "../../../lib/project-access";
import { and, desc, eq } from "drizzle-orm";
import {
  commandRecords,
  commandWorkItems,
  companyMembers,
  projectFiles,
  projects,
  recordAudits,
  vendorAudits,
  vendorInvites,
  vendorProfiles,
  vendorProjectAccess,
} from "../../../db/schema";
import { enforceOnboardingAccess } from "../../../lib/onboarding";
import { ensureMyWorkTables } from "../../../lib/my-work";
import { sendOperationalEmail } from "../../../lib/operational-email";
import { recordCompletedWorkflowHandoff } from "../../../lib/domain-outbox";
import {
  PREWORK_QUALITY_TEMPLATES,
  QUALITY_INSPECTION_RECORD_TYPE,
  QUALITY_ITEM_RECORD_TYPE,
  SCHEDULE_QUALITY_CATEGORIES,
  inspectionResult,
  normalizeStringArray,
  parseQualityData,
  templateById,
  type QualityResponse,
} from "../../../lib/quality-control";
import { getCommandActor, resolveCommandActor } from "../../../lib/server-actor";
import { complianceState, ensureVendorSchema, hashSecret, parseStringArray } from "../../../lib/vendor-portal";

type QualityInput = {
  action?: string;
  projectId?: string;
  recordId?: string;
  title?: string;
  description?: string;
  exactLocation?: string;
  inspectionStage?: "Preparatory" | "Work-In-Place" | "Final";
  dueDate?: string;
  responsibleTrade?: string;
  responsibleVendorId?: string;
  reference?: string;
  requiresDesignerAcceptance?: boolean;
  designerVendorId?: string;
  beforePhotoFileIds?: number[];
  afterPhotoFileIds?: number[];
  responses?: QualityResponse[];
  generalNotes?: string;
  alternateChecklist?: string;
  overrideTrade?: string;
  overrideCompletionDate?: string;
  overrideReason?: string;
  overrideAttestation?: boolean;
  decision?: "Accept" | "Reject";
  comments?: string;
  vendorId?: string;
  portalRole?: "Proposal" | "Correction" | "Designer Acceptance";
};

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  await ensureVendorSchema();
  const projectId = new URL(request.url).searchParams.get("projectId")?.trim() || "";
  if (!projectId) return Response.json({ error: "Project Is Required" }, { status: 400 });
  const { getDb } = await import("../../../db");
  const db = getDb();
  const projectRows = await db.select().from(projects).where(eq(projects.number, projectId)).limit(1);
  const project = projectRows[0];
  if (!project) return Response.json({ error: "Project Not Found" }, { status: 404 });
  const permissions = await qualityPermissions(db, actor, project);
  if (!permissions.canView) return Response.json({ error: "Project Quality Access Is Required" }, { status: 403 });
  const [qualityRows, vendors, accessRows, auditRows, fileRows] = await Promise.all([
    db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, QUALITY_INSPECTION_RECORD_TYPE))).orderBy(desc(commandRecords.updatedAt)),
    db.select().from(vendorProfiles).orderBy(vendorProfiles.legalName),
    db.select().from(vendorProjectAccess).where(eq(vendorProjectAccess.projectId, projectId)),
    db.select().from(recordAudits).where(eq(recordAudits.projectId, projectId)).orderBy(recordAudits.id),
    db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId)).orderBy(desc(projectFiles.id)),
  ]);
  const itemRows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, QUALITY_ITEM_RECORD_TYPE))).orderBy(desc(commandRecords.updatedAt));
  const auditMap = new Map<string, typeof auditRows>();
  for (const audit of auditRows) auditMap.set(audit.recordId, [...(auditMap.get(audit.recordId) || []), audit]);
  const reachedSubstantialCompletion = Boolean(project.substantialDate && project.substantialDate <= new Date().toISOString().slice(0, 10));
  return Response.json({
    project,
    permissions,
    controls: {
      initiation: "PM + Superintendent; Others Submit For PM Validation",
      closure: "Trade Corrects → Superintendent Verifies → PM And Required Designer Accept",
      evidence: "Exact Location + Responsible Trade + Before And After Photos",
      progressBilling: "Open Quality Items Warn",
      finalPayment: "Open Quality Items Hard Block",
      scheduleAutomation: "Every Schedule Activity Requires A Quality Category",
      override: "Superintendent Must Identify Alternate Full-Scope Checklist, Trade, Date, Reason, And Attest",
    },
    templates: PREWORK_QUALITY_TEMPLATES,
    scheduleCategories: SCHEDULE_QUALITY_CATEGORIES,
    inspections: qualityRows.map((row) => clientRecord(row, auditMap.get(row.id) || [])),
    items: itemRows.map((row) => ({ ...clientRecord(row, auditMap.get(row.id) || []), closeoutTracking: reachedSubstantialCompletion && row.status !== "Closed" })),
    vendors: await Promise.all(vendors.map(async (vendor) => {
      const access = accessRows.find((item) => item.vendorId === vendor.id);
      const compliance = await complianceState(db, vendor.id, projectId);
      return {
        id: vendor.id,
        name: vendor.legalName,
        type: vendor.vendorType,
        contactName: vendor.contactName,
        contactEmail: vendor.contactEmail,
        trade: access?.trade || parseStringArray(vendor.tradesJson)[0] || "",
        projectStatus: access?.status || "Not Shared",
        permissions: access ? parseStringArray(access.permissionsJson) : [],
        qualityRole: access ? parseStringArray(access.permissionsJson).filter((item) => item.startsWith("Quality ")) : [],
        complianceBlocked: false,
        paymentBlocked: compliance.paymentBlocked,
        temporaryApproval: Boolean(compliance.activeOverride),
      };
    })),
    files: fileRows.filter((file) => file.category.startsWith("Quality Control")).map((file) => ({ id: file.id, name: file.name, category: file.category, revision: file.revision, uploadedBy: file.uploadedBy, createdAt: file.createdAt })),
    closeout: { reachedSubstantialCompletion, openItemCount: itemRows.filter((row) => row.status !== "Closed").length },
  });
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  await ensureVendorSchema();
  const input = await request.json() as QualityInput;
  const projectId = input.projectId?.trim() || "";
  const { getDb } = await import("../../../db");
  const db = getDb();
  const projectRows = await db.select().from(projects).where(eq(projects.number, projectId)).limit(1);
  const project = projectRows[0];
  if (!project) return Response.json({ error: "Project Not Found" }, { status: 404 });
  const permissions = await qualityPermissions(db, actor, project);
  if (!permissions.canView) return Response.json({ error: "Project Quality Access Is Required" }, { status: 403 });
  const now = new Date();
  const nowIso = now.toISOString();

  if (input.action === "create-item") {
    const title = input.title?.trim() || "";
    const description = input.description?.trim() || "";
    const exactLocation = input.exactLocation?.trim() || "";
    const responsibleTrade = input.responsibleTrade?.trim() || "";
    const beforePhotoFileIds = validFileIds(input.beforePhotoFileIds);
    if (!title || !description || !exactLocation || !responsibleTrade || !input.inspectionStage || !input.dueDate || !beforePhotoFileIds.length) {
      return Response.json({ error: "Title Description Exact Location Stage Due Date Responsible Trade And A Before Photo Are Required" }, { status: 400 });
    }
    const id = await nextQualityId(db, projectId, "QI", QUALITY_ITEM_RECORD_TYPE);
    const formal = permissions.canInitiate;
    const vendor = input.responsibleVendorId ? await db.select().from(vendorProfiles).where(eq(vendorProfiles.id, input.responsibleVendorId)).limit(1) : [];
    const status = formal ? "Assigned — Acknowledgment Required" : "Proposed — PM Validation";
    const data = {
      category: "Deficiency",
      description,
      exactLocation,
      inspectionStage: input.inspectionStage,
      responsibleTrade,
      responsibleVendorId: vendor[0]?.id || "",
      responsibleVendorName: vendor[0]?.legalName || "",
      reference: input.reference?.trim() || "",
      requiresDesignerAcceptance: input.requiresDesignerAcceptance === true,
      designerVendorId: input.designerVendorId?.trim() || "",
      beforePhotoFileIds,
      afterPhotoFileIds: [],
      submittedBy: actor.name,
      submittedByEmail: actor.email,
      submittedAt: nowIso,
      formalizedBy: formal ? actor.name : "",
      formalizedAt: formal ? nowIso : "",
      pmAcceptance: null,
      designerAcceptance: null,
      superintendentVerification: null,
      closeoutTracking: project.substantialDate <= nowIso.slice(0, 10),
      timeline: [{ action: formal ? "Formal Quality Item Initiated" : "Submitted For PM Validation", actor: actor.name, at: nowIso, detail: `${input.inspectionStage} · ${exactLocation}` }],
    };
    await db.insert(commandRecords).values({ projectId, id, recordType: QUALITY_ITEM_RECORD_TYPE, title, owner: formal ? responsibleTrade : project.projectManager, due: input.dueDate, status, meta: `${input.inspectionStage} · ${exactLocation} · ${responsibleTrade}`, recordDate: nowIso.slice(0, 10), recordTime: nowIso.slice(11, 16), dateLocked: true, dataJson: JSON.stringify(data), updatedAt: nowIso });
    await qualityAudit(db, projectId, id, actor, "Quality Initiation", "None", status, formal ? "PM or Superintendent formal initiation" : "Non-authorized party submitted for PM validation");
    await createQualityWork(db, project, id, title, status, formal ? project.superintendent : project.projectManager, input.dueDate, formal ? "Quality" : "Quality Validation");
    return Response.json({ saved: true, recordId: id, status }, { status: 201 });
  }

  if (input.action === "grant-quality-access") {
    if (!permissions.isPm) return Response.json({ error: "Only The Project Manager May Grant Quality Portal Participation" }, { status: 403 });
    const vendor = await db.select().from(vendorProfiles).where(eq(vendorProfiles.id, input.vendorId?.trim() || "")).limit(1);
    if (!vendor[0] || !input.portalRole) return Response.json({ error: "Vendor Directory Company And Quality Portal Role Are Required" }, { status: 400 });
    const permission = `Quality ${input.portalRole}`;
    const accessId = `${vendor[0].id}:${projectId}`;
    const existingAccess = await db.select().from(vendorProjectAccess).where(eq(vendorProjectAccess.id, accessId)).limit(1);
    const nextPermissions = Array.from(new Set([...(existingAccess[0] ? parseStringArray(existingAccess[0].permissionsJson) : []), permission]));
    const nextShared = Array.from(new Set([...(existingAccess[0] ? parseStringArray(existingAccess[0].sharedRecordsJson) : []), "Quality Items"]));
    await db.insert(vendorProjectAccess).values({ id: accessId, vendorId: vendor[0].id, projectId, projectName: project.name, status: existingAccess[0]?.status === "Revoked" ? "Revoked" : "Active", trade: existingAccess[0]?.trade || parseStringArray(vendor[0].tradesJson)[0] || input.portalRole, contractReference: existingAccess[0]?.contractReference || "", costCode: existingAccess[0]?.costCode || "Unassigned", committedAmount: existingAccess[0]?.committedAmount || "0", permissionsJson: JSON.stringify(nextPermissions), sharedRecordsJson: JSON.stringify(nextShared), grantedBy: actor.email, updatedAt: nowIso }).onConflictDoUpdate({ target: vendorProjectAccess.id, set: { status: existingAccess[0]?.status === "Revoked" ? "Revoked" : "Active", permissionsJson: JSON.stringify(nextPermissions), sharedRecordsJson: JSON.stringify(nextShared), updatedAt: nowIso } });
    const invite = await activeOrNewInvite(db, request, vendor[0], actor, now);
    await db.insert(vendorAudits).values({ vendorId: vendor[0].id, actorName: actor.name, actorEmail: actor.email, action: `${permission} Granted`, detail: `${project.name} · Least-privilege quality access · ${invite.emailDelivery}.` });
    const { reconcileProjectHealthAfterUpdate } = await import("../project-health/route");
    await reconcileProjectHealthAfterUpdate(projectId, actor);
    return Response.json({ saved: true, permission, inviteId: invite.inviteId, emailDelivery: invite.emailDelivery }, { status: 201 });
  }

  const recordId = input.recordId?.trim() || "";
  const rows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, recordId))).limit(1);
  const row = rows[0];
  if (!row || ![QUALITY_INSPECTION_RECORD_TYPE, QUALITY_ITEM_RECORD_TYPE].includes(row.recordType)) return Response.json({ error: "Quality Record Not Found" }, { status: 404 });
  const data = parseQualityData(row.dataJson);

  if (input.action === "complete-inspection") {
    if (!permissions.canCompleteInspection) return Response.json({ error: "Only The Assigned Site Superintendent May Complete A Pre-Work Checklist" }, { status: 403 });
    if (!["Superintendent Action Required", "Follow-Up Required"].includes(row.status)) return Response.json({ error: "This Inspection Attempt Is Locked Or No Longer Open" }, { status: 423 });
    const template = templateById(String(data.templateId || ""));
    if (!template) return Response.json({ error: "The Linked Mefford Checklist Template Was Not Found" }, { status: 409 });
    const responses = Array.isArray(input.responses) ? input.responses : [];
    const result = inspectionResult(template, responses);
    if (!result.complete) return Response.json({ error: "Answer Every Checklist Item. N/A Requires A Written Justification." }, { status: 400 });
    const failed = result.failed.map((question) => ({ id: question.id, label: question.label, response: responses.find((item) => item.questionId === question.id) }));
    const exactLocation = input.exactLocation?.trim() || String(data.scheduleActivityTitle || "");
    const responsibleTrade = input.responsibleTrade?.trim() || String(data.responsibleTrade || "");
    const beforePhotoFileIds = validFileIds(input.beforePhotoFileIds);
    if (failed.length && (!exactLocation || !responsibleTrade || !beforePhotoFileIds.length)) return Response.json({ error: "An Unsatisfactory Attempt Requires Exact Location Responsible Trade And A Before Photo For The Linked Deficiency" }, { status: 400 });
    const status = result.satisfactory ? "Passed" : "Failed — Follow-Up Required";
    const nextData = { ...data, responses, generalNotes: input.generalNotes?.trim() || "", result: result.satisfactory ? "Satisfactory" : "Unsatisfactory", failedItems: failed, exactLocation, responsibleTrade, beforePhotoFileIds, completedBy: actor.name, completedByEmail: actor.email, completedAt: nowIso, immutableAfterDisposition: true, timeline: [...asTimeline(data.timeline), { action: status, actor: actor.name, at: nowIso, detail: result.satisfactory ? "Every required checklist response passed or had a justified N/A." : `${failed.length} unsatisfactory item(s); a new attempt is required.` }] };
    await updateQualityRecord(db, row, status, nextData, nowIso);
    await syncLinkedScheduleReadiness(db, projectId, nextData, status, nowIso, actor);
    await qualityAudit(db, projectId, row.id, actor, "Inspection Attempt", row.status, status, `${template.title} completed as ${result.satisfactory ? "satisfactory" : "unsatisfactory"}; attempt is now immutable`);
    let deficiencyId = "";
    if (!result.satisfactory) deficiencyId = await createInspectionDeficiency(db, project, row, nextData, input, actor, nowIso);
    return Response.json({ saved: true, status, deficiencyId, followUpRequired: !result.satisfactory });
  }

  if (input.action === "record-inspection-override") {
    if (!permissions.canCompleteInspection) return Response.json({ error: "Only The Assigned Site Superintendent May Document This Override" }, { status: 403 });
    if (!["Superintendent Action Required", "Follow-Up Required"].includes(row.status)) return Response.json({ error: "This Inspection Request Is Locked Or No Longer Open" }, { status: 423 });
    const alternateChecklist = input.alternateChecklist?.trim() || "";
    const trade = input.overrideTrade?.trim() || "";
    const completionDate = input.overrideCompletionDate?.trim() || "";
    const reason = input.overrideReason?.trim() || "";
    if (alternateChecklist.length < 8 || !trade || !/^\d{4}-\d{2}-\d{2}$/.test(completionDate) || completionDate > nowIso.slice(0, 10) || reason.length < 20 || input.overrideAttestation !== true) {
      return Response.json({ error: "Override Requires The Alternate Full-Scope Checklist Or Meeting Trade Past Completion Date Specific Reason And Superintendent Attestation" }, { status: 400 });
    }
    const override = { alternateChecklist, trade, completionDate, reason, attested: true, superintendent: actor.name, superintendentEmail: actor.email, recordedAt: nowIso };
    const nextData = { ...data, override, disposition: "Qualified Superintendent Override", immutableAfterDisposition: true, timeline: [...asTimeline(data.timeline), { action: "Override Documented", actor: actor.name, at: nowIso, detail: `${alternateChecklist} · ${trade} · Completed ${completionDate} · ${reason}` }] };
    await updateQualityRecord(db, row, "Override Documented", nextData, nowIso);
    await syncLinkedScheduleReadiness(db, projectId, nextData, "Override Documented", nowIso, actor);
    await qualityAudit(db, projectId, row.id, actor, "Superintendent Override", row.status, "Override Documented", `${alternateChecklist} with ${trade} completed ${completionDate}. ${reason}`);
    return Response.json({ saved: true, status: "Override Documented" });
  }

  if (input.action === "repeat-inspection") {
    if (!permissions.canCompleteInspection) return Response.json({ error: "Only The Assigned Site Superintendent May Start The Required New Attempt" }, { status: 403 });
    if (row.status !== "Failed — Follow-Up Required") return Response.json({ error: "A New Attempt Is Available Only After An Unsatisfactory Attempt" }, { status: 409 });
    const baseId = String(data.baseRequestId || row.id.replace(/-A\d+$/, ""));
    const related = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, QUALITY_INSPECTION_RECORD_TYPE)));
    const attemptNumber = related.filter((item) => String(parseQualityData(item.dataJson).baseRequestId || item.id.replace(/-A\d+$/, "")) === baseId).length + 1;
    const id = `${baseId}-A${attemptNumber}`;
    const nextData = { ...data, baseRequestId: baseId, attemptNumber, priorAttemptId: row.id, responses: [], result: "", failedItems: [], completedBy: "", completedByEmail: "", completedAt: "", override: null, immutableAfterDisposition: false, timeline: [{ action: "Follow-Up Attempt Requested", actor: actor.name, at: nowIso, detail: `Attempt ${attemptNumber} follows unsatisfactory ${row.id}. Prior attempt remains permanent.` }] };
    await db.insert(commandRecords).values({ projectId, id, recordType: QUALITY_INSPECTION_RECORD_TYPE, title: `${row.title} · Attempt ${attemptNumber}`, owner: project.superintendent, due: nowIso.slice(0, 10), status: "Follow-Up Required", meta: `${row.id} · Repeat Attempt ${attemptNumber} · Prior Failure Preserved`, recordDate: nowIso.slice(0, 10), recordTime: nowIso.slice(11, 16), dateLocked: true, dataJson: JSON.stringify(nextData), updatedAt: nowIso });
    await syncLinkedScheduleReadiness(db, projectId, nextData, "Follow-Up Required", nowIso, actor);
    await qualityAudit(db, projectId, id, actor, "Repeat Inspection", row.id, id, `Attempt ${attemptNumber} created; ${row.id} remains immutable`);
    await createQualityWork(db, project, id, row.title, "Follow-Up Required", project.superintendent, nowIso.slice(0, 10), "Quality Inspection");
    return Response.json({ saved: true, recordId: id, attemptNumber }, { status: 201 });
  }

  if (input.action === "validate-proposal") {
    if (!permissions.isPm) return Response.json({ error: "Only The Project Manager May Validate And Assign A Proposed Quality Item" }, { status: 403 });
    if (row.recordType !== QUALITY_ITEM_RECORD_TYPE || row.status !== "Proposed — PM Validation") return Response.json({ error: "This Item Is Not Waiting For PM Validation" }, { status: 409 });
    const responsibleTrade = input.responsibleTrade?.trim() || String(data.responsibleTrade || "");
    const vendor = input.responsibleVendorId ? await db.select().from(vendorProfiles).where(eq(vendorProfiles.id, input.responsibleVendorId)).limit(1) : [];
    if (!responsibleTrade) return Response.json({ error: "Responsible Trade Is Required Before Assignment" }, { status: 400 });
    const nextData = { ...data, responsibleTrade, responsibleVendorId: vendor[0]?.id || "", responsibleVendorName: vendor[0]?.legalName || "", requiresDesignerAcceptance: input.requiresDesignerAcceptance === true, designerVendorId: input.designerVendorId?.trim() || "", formalizedBy: actor.name, formalizedAt: nowIso, timeline: [...asTimeline(data.timeline), { action: "PM Validated And Assigned", actor: actor.name, at: nowIso, detail: `${responsibleTrade}${vendor[0] ? ` · ${vendor[0].legalName}` : ""}` }] };
    await updateQualityRecord(db, row, "Assigned — Acknowledgment Required", nextData, nowIso, responsibleTrade);
    await qualityAudit(db, projectId, row.id, actor, "PM Validation", row.status, "Assigned — Acknowledgment Required", `Proposal validated and assigned to ${responsibleTrade}`);
    return Response.json({ saved: true, status: "Assigned — Acknowledgment Required" });
  }

  if (input.action === "superintendent-verify") {
    if (!permissions.canCompleteInspection) return Response.json({ error: "Only The Assigned Site Superintendent May Verify The Correction" }, { status: 403 });
    if (row.recordType !== QUALITY_ITEM_RECORD_TYPE || row.status !== "Verification Requested") return Response.json({ error: "The Trade Has Not Submitted A Complete Correction Package" }, { status: 409 });
    const afterPhotos = normalizeStringArray(data.afterPhotoFileIds).map(Number).filter((id) => Number.isInteger(id) && id > 0);
    if (!afterPhotos.length) return Response.json({ error: "After Photos Are Required Before Superintendent Verification" }, { status: 400 });
    const accepted = input.decision === "Accept";
    const comments = input.comments?.trim() || "";
    if (!accepted && comments.length < 10) return Response.json({ error: "Explain Why The Correction Is Being Returned" }, { status: 400 });
    const status = accepted ? "PM / Designer Acceptance" : "Correction In Progress";
    const nextData = { ...data, superintendentVerification: { decision: input.decision, comments, superintendent: actor.name, at: nowIso }, timeline: [...asTimeline(data.timeline), { action: accepted ? "Superintendent Verified" : "Correction Returned", actor: actor.name, at: nowIso, detail: comments || "Before and after evidence verified in the field." }] };
    await updateQualityRecord(db, row, status, nextData, nowIso, accepted ? project.projectManager : String(data.responsibleTrade || row.owner));
    await qualityAudit(db, projectId, row.id, actor, "Superintendent Verification", row.status, status, comments || "Field correction verified against before and after evidence");
    return Response.json({ saved: true, status });
  }

  if (input.action === "pm-accept") {
    if (!permissions.isPm) return Response.json({ error: "Only The Project Manager May Record Mefford Final Acceptance" }, { status: 403 });
    if (row.recordType !== QUALITY_ITEM_RECORD_TYPE || row.status !== "PM / Designer Acceptance") return Response.json({ error: "Superintendent Verification Is Required First" }, { status: 409 });
    const accepted = input.decision === "Accept";
    const comments = input.comments?.trim() || "";
    if (!accepted && comments.length < 10) return Response.json({ error: "Explain Why The Item Is Being Returned" }, { status: 400 });
    const designerRequired = data.requiresDesignerAcceptance === true;
    const designerAccepted = (data.designerAcceptance as Record<string, unknown> | null)?.decision === "Accept";
    const status = accepted ? (designerRequired && !designerAccepted ? "Designer Acceptance Required" : "Closed") : "Correction In Progress";
    const nextData = { ...data, pmAcceptance: { decision: input.decision, comments, projectManager: actor.name, at: nowIso }, closedAt: status === "Closed" ? nowIso : "", timeline: [...asTimeline(data.timeline), { action: accepted ? "PM Accepted" : "PM Returned", actor: actor.name, at: nowIso, detail: comments || (status === "Closed" ? "All required closure gates satisfied." : "Designer portal acceptance remains required.") }] };
    await updateQualityRecord(db, row, status, nextData, nowIso, status === "Closed" ? actor.name : status === "Designer Acceptance Required" ? "Assigned Designer" : String(data.responsibleTrade || row.owner));
    await qualityAudit(db, projectId, row.id, actor, "PM Acceptance", row.status, status, comments || "Mefford PM closure review recorded");
    let handoff = null;
    if (status === "Closed") {
      const { env } = await import("cloudflare:workers");
      handoff = await recordCompletedWorkflowHandoff(env.DB, { workflowId: "schedule-to-quality", eventId: `schedule-readiness-verified:${projectId}:${row.id}`, aggregateType: QUALITY_ITEM_RECORD_TYPE, aggregateId: row.id, projectId, actorName: actor.name, actorEmail: actor.email, occurredAt: nowIso, payload: { qualityItemId: row.id, scheduleRecordId: data.scheduleRecordId || "", status } });
    }
    return Response.json({ saved: true, status, handoff });
  }

  return Response.json({ error: "A Valid Quality Control Action Is Required" }, { status: 400 });
}

async function qualityPermissions(
  db: ReturnType<(typeof import("../../../db"))["getDb"]>,
  actor: ReturnType<typeof getCommandActor>,
  project: typeof projects.$inferSelect,
) {
  const member = actor.email ? await db.select().from(companyMembers).where(eq(companyMembers.email, actor.email)).limit(1) : [];
  const accessLevel = member[0]?.companyAccessLevel || actor.accessLevel;
  const designations = member[0] ? parseStringArray(member[0].designationsJson) : [];
  const projectRoles = await projectDesignationsFor(db, actor, project, designations);
  const isPm = projectRoles.includes("Project Manager");
  const isSuperintendent = projectRoles.includes("Superintendent");
  const leadership = ["Company Owner", "Administrator"].includes(accessLevel);
  return { canView: leadership || isPm || isSuperintendent || designations.some((item) => ["Office Staff", "Safety Director", "Safety"].includes(item)), canInitiate: isPm || isSuperintendent, canCompleteInspection: isSuperintendent, isPm, isSuperintendent, leadership };
}

function clientRecord(row: typeof commandRecords.$inferSelect, audits: Array<typeof recordAudits.$inferSelect>) {
  return { id: row.id, title: row.title, owner: row.owner, due: row.due, status: row.status, meta: row.meta, recordDate: row.recordDate, updatedAt: row.updatedAt, data: parseQualityData(row.dataJson), auditHistory: audits.map((audit) => ({ id: audit.id, action: audit.fieldName, actor: audit.actorName, at: audit.createdAt, summary: audit.summary })) };
}

async function nextQualityId(db: ReturnType<(typeof import("../../../db"))["getDb"]>, projectId: string, prefix: string, recordType: string) {
  const rows = await db.select({ id: commandRecords.id }).from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, recordType)));
  const largest = rows.reduce((max, row) => Math.max(max, Number(row.id.match(/(\d+)$/)?.[1] || 0)), 0);
  return `${prefix}-${String(largest + 1).padStart(4, "0")}`;
}

async function updateQualityRecord(db: ReturnType<(typeof import("../../../db"))["getDb"]>, row: typeof commandRecords.$inferSelect, status: string, data: Record<string, unknown>, now: string, owner = row.owner) {
  await db.update(commandRecords).set({ status, owner, meta: `${String(data.inspectionStage || "Quality")} · ${String(data.exactLocation || data.scheduleActivityId || "Controlled Record")} · ${status}`, dataJson: JSON.stringify(data), updatedAt: now }).where(and(eq(commandRecords.projectId, row.projectId), eq(commandRecords.id, row.id)));
}

async function qualityAudit(db: ReturnType<(typeof import("../../../db"))["getDb"]>, projectId: string, recordId: string, actor: { name: string; email: string }, fieldName: string, oldValue: string, newValue: string, summary: string) {
  await db.insert(recordAudits).values({ projectId, recordId, fieldName, oldValue, newValue, reason: summary, actorName: actor.name, actorEmail: actor.email, summary: `${recordId} · ${summary}` });
  const { reconcileProjectHealthAfterUpdate } = await import("../project-health/route");
  await reconcileProjectHealthAfterUpdate(projectId, actor);
}

async function syncLinkedScheduleReadiness(
  db: ReturnType<(typeof import("../../../db"))["getDb"]>,
  projectId: string,
  qualityData: Record<string, unknown>,
  inspectionStatus: string,
  nowIso: string,
  actor: { name: string; email: string },
) {
  const scheduleActivityId = String(qualityData.scheduleActivityId || "").trim();
  if (!scheduleActivityId) return;
  const rows = await db.select().from(commandRecords).where(and(
    eq(commandRecords.projectId, projectId),
    eq(commandRecords.id, scheduleActivityId),
  )).limit(1);
  const schedule = rows[0];
  if (!schedule || schedule.recordType !== "Schedule") return;
  const scheduleData = parseQualityData(schedule.dataJson);
  const cleared = ["Passed", "Override Documented"].includes(inspectionStatus);
  const preWorkStatus = cleared ? "Cleared" : inspectionStatus === "Failed — Follow-Up Required" || inspectionStatus === "Follow-Up Required" ? "Blocked - Follow-Up Required" : "Required Before Start";
  await db.update(commandRecords).set({
    dataJson: JSON.stringify({
      ...scheduleData,
      preWorkStatus,
      preWorkClearedAt: cleared ? nowIso : "",
      preWorkInspectionStatus: inspectionStatus,
    }),
    updatedAt: nowIso,
  }).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, scheduleActivityId)));
  await db.insert(recordAudits).values({
    projectId,
    recordId: scheduleActivityId,
    fieldName: "Pre-Work Readiness",
    oldValue: String(scheduleData.preWorkStatus || "Required Before Start"),
    newValue: preWorkStatus,
    reason: `Linked quality inspection changed to ${inspectionStatus}`,
    actorName: actor.name,
    actorEmail: actor.email,
    summary: `${scheduleActivityId} pre-work readiness is ${preWorkStatus}. ${cleared ? "Field progress is now allowed." : "Field progress remains blocked."}`,
  });
}

async function createInspectionDeficiency(
  db: ReturnType<(typeof import("../../../db"))["getDb"]>,
  project: typeof projects.$inferSelect,
  inspection: typeof commandRecords.$inferSelect,
  inspectionData: Record<string, unknown>,
  input: QualityInput,
  actor: { name: string; email: string },
  now: string,
) {
  const id = await nextQualityId(db, project.number, "QI", QUALITY_ITEM_RECORD_TYPE);
  const vendor = input.responsibleVendorId ? await db.select().from(vendorProfiles).where(eq(vendorProfiles.id, input.responsibleVendorId)).limit(1) : [];
  const failedItems = Array.isArray(inspectionData.failedItems) ? inspectionData.failedItems as Array<Record<string, unknown>> : [];
  const data = { category: "Deficiency", sourceInspectionId: inspection.id, description: `Unsatisfactory ${String(inspectionData.templateTitle || inspection.title)} items: ${failedItems.map((item) => String(item.label || "Checklist item")).join("; ")}`, exactLocation: input.exactLocation?.trim() || String(inspectionData.exactLocation || ""), inspectionStage: "Preparatory", responsibleTrade: input.responsibleTrade?.trim() || String(inspectionData.responsibleTrade || ""), responsibleVendorId: vendor[0]?.id || "", responsibleVendorName: vendor[0]?.legalName || "", reference: inspection.id, requiresDesignerAcceptance: input.requiresDesignerAcceptance === true, designerVendorId: input.designerVendorId?.trim() || "", beforePhotoFileIds: validFileIds(input.beforePhotoFileIds), afterPhotoFileIds: [], submittedBy: actor.name, submittedByEmail: actor.email, submittedAt: now, formalizedBy: actor.name, formalizedAt: now, closeoutTracking: project.substantialDate <= now.slice(0, 10), timeline: [{ action: "Created From Unsatisfactory Pre-Work Attempt", actor: actor.name, at: now, detail: `${inspection.id} · ${failedItems.length} failed item(s).` }] };
  await db.insert(commandRecords).values({ projectId: project.number, id, recordType: QUALITY_ITEM_RECORD_TYPE, title: `${inspection.title} · Correct Before Work`, owner: String(data.responsibleTrade), due: now.slice(0, 10), status: "Assigned — Acknowledgment Required", meta: `Preparatory · ${data.exactLocation} · ${data.responsibleTrade}`, recordDate: now.slice(0, 10), recordTime: now.slice(11, 16), dateLocked: true, dataJson: JSON.stringify(data), updatedAt: now });
  await qualityAudit(db, project.number, id, actor, "Automatic Deficiency", inspection.id, "Assigned — Acknowledgment Required", `Unsatisfactory pre-work evidence created this linked deficiency; ${inspection.id} remains permanent`);
  return id;
}

async function createQualityWork(db: ReturnType<(typeof import("../../../db"))["getDb"]>, project: typeof projects.$inferSelect, recordId: string, title: string, status: string, recipientName: string, dueDate: string, kind: string) {
  await ensureMyWorkTables();
  const member = await db.select().from(companyMembers).where(eq(companyMembers.displayName, recipientName)).limit(1);
  if (!member[0]) return;
  await db.insert(commandWorkItems).values({ id: `QWI-${crypto.randomUUID()}`, dedupeKey: `quality:${project.number}:${recordId}:${member[0].email}`, projectId: project.number, recipientName, recipientEmail: member[0].email, kind, title, message: `${recordId} · ${status}. Complete the required quality action with permanent evidence.`, priority: /failed|validation|required/i.test(status) ? "High" : "Normal", sourceType: kind, sourceRecordId: recordId, actionTarget: "Quality", dueAt: /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? `${dueDate}T17:00:00-04:00` : dueDate, createdBy: "Quality Control", updatedAt: new Date().toISOString() }).onConflictDoNothing({ target: commandWorkItems.dedupeKey });
}

async function activeOrNewInvite(db: ReturnType<(typeof import("../../../db"))["getDb"]>, request: Request, vendor: typeof vendorProfiles.$inferSelect, actor: { email: string }, now: Date) {
  const invites = await db.select().from(vendorInvites).where(eq(vendorInvites.vendorId, vendor.id)).orderBy(desc(vendorInvites.createdAt));
  const active = invites.find((invite) => !invite.revokedAt && new Date(invite.expiresAt) > now);
  if (active) return { inviteId: active.id, emailDelivery: "Existing Secure Portal Invite" };
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
  const inviteId = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + 7 * 86_400_000).toISOString();
  await db.insert(vendorInvites).values({ id: inviteId, vendorId: vendor.id, email: vendor.contactEmail.toLowerCase(), codeHash: await hashSecret(code), expiresAt, createdBy: actor.email });
  const emailDelivery = await sendQualityPortalEmail(request, vendor, inviteId, code, expiresAt);
  return { inviteId, emailDelivery };
}

async function sendQualityPortalEmail(request: Request, vendor: typeof vendorProfiles.$inferSelect, inviteId: string, code: string, expiresAt: string) {
  const delivery = await sendOperationalEmail({ to: vendor.contactEmail, subject: "Mefford Quality Portal Access", text: `${vendor.legalName}\n\nOpen the secure project portal: ${new URL(request.url).origin}/?vendorPortal=${inviteId}\nOne-time code: ${code}\nExpires: ${expiresAt}\n\nUse the Quality workspace only for records explicitly shared with your company.`, idempotencyKey: `quality-invite:${inviteId}`, safeguards: { approveQuality: false, closeDeficiency: false, releasePayment: false } });
  return delivery.outcome === "Provider Accepted" ? `Provider Accepted · ${delivery.providerReceiptId}` : delivery.outcome === "Deferred" ? "Delivery Deferred · Connection Required" : `${delivery.outcome} · ${delivery.error}`;
}

function validFileIds(value: unknown) {
  return Array.isArray(value) ? value.map(Number).filter((id) => Number.isInteger(id) && id > 0) : [];
}

function asTimeline(value: unknown) {
  return Array.isArray(value) ? value as Array<Record<string, unknown>> : [];
}
