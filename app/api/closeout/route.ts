import { projectDesignationsFor } from "../../../lib/project-access";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  commandRecords,
  companyMembers,
  projectFiles,
  projectBonusControls,
  projects,
  recordAudits,
  vendorProfiles,
  vendorProjectAccess,
  vendorSubmissions,
} from "../../../db/schema";
import {
  CLOSEOUT_CONTROL_TYPE,
  CLOSEOUT_EQUIPMENT_TYPE,
  CLOSEOUT_REQUIREMENT_TYPE,
  CLOSEOUT_STANDARD_REQUIREMENTS,
  CLOSEOUT_WARRANTY_TYPE,
  calculateCloseoutProgress,
  closeoutHealthPoints,
  closeoutStatusCredit,
  expectedCloseoutProgress,
  nextApproval,
  parseCloseoutData,
  permitOcrSuggestions,
  vendorCloseoutTemplates,
} from "../../../lib/closeout";
import { recordCompletedWorkflowHandoff } from "../../../lib/domain-outbox";
import { toCents } from "../../../lib/accounting-ledger";
import { isIssuedOwnerBilling, isOpenPayable } from "../../../lib/accounting-states";
import { ensureMyWorkTables, upsertWorkItem } from "../../../lib/my-work";
import { enforceOnboardingAccess } from "../../../lib/onboarding";
import { QUALITY_ITEM_RECORD_TYPE } from "../../../lib/quality-control";
import { getCommandActor, resolveCommandActor } from "../../../lib/server-actor";
import { seedProposalExperienceAtCloseout } from "../../../lib/proposal-team";
import { synchronizeBonusWork } from "../../../lib/bonus-server";
import { ensureVendorSchema, parseStringArray } from "../../../lib/vendor-portal";

type Db = ReturnType<(typeof import("../../../db"))["getDb"]>;
type Project = typeof projects.$inferSelect;
type Requirement = typeof commandRecords.$inferSelect;

type CloseoutPayload = {
  action?: string;
  projectId?: string;
  recordId?: string;
  title?: string;
  category?: string;
  responsibleRole?: string;
  responsibleName?: string;
  dueDate?: string;
  weight?: number;
  critical?: boolean;
  instructions?: string;
  vendorId?: string;
  approvalFlow?: string[];
  fileIds?: number[];
  fileNames?: string[];
  notes?: string;
  extractedText?: string;
  permitNumber?: string;
  jurisdiction?: string;
  inspectionDate?: string;
  closureStatus?: string;
  decision?: "Approved" | "Rejected";
  reason?: string;
  signerName?: string;
  signerTitle?: string;
  signerEmail?: string;
  signatureConsent?: boolean;
  hasPhases?: boolean;
  phases?: string[];
  phase?: string;
  equipmentType?: string;
  location?: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  startupDate?: string;
  warrantyStart?: string;
  warrantyEnd?: string;
  warrantyManager?: string;
  urgency?: string;
  description?: string;
  ownerName?: string;
  correctionAccepted?: boolean;
};

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  try {
    const projectId = new URL(request.url).searchParams.get("projectId")?.trim() || "";
    if (!projectId) return Response.json({ error: "Project Is Required" }, { status: 400 });
    await ensureMyWorkTables();
    await ensureVendorSchema();
    const { getDb } = await import("../../../db");
    const db = getDb();
    const project = (await db.select().from(projects).where(eq(projects.number, projectId)).limit(1))[0];
    if (!project) return Response.json({ error: "Project Not Found" }, { status: 404 });
    const permissions = await closeoutPermissions(db, actor, project);
    if (!permissions.canView) return Response.json({ error: "Project Closeout Access Is Required" }, { status: 403 });
    await ensureProjectCloseout(db, project, actor);
    await syncCloseoutWork(db, project);
    return Response.json(await closeoutPayload(db, project, permissions));
  } catch (error) {
    return closeoutError(error);
  }
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  try {
    await ensureMyWorkTables();
    await ensureVendorSchema();
    const input = await request.json() as CloseoutPayload;
    const projectId = input.projectId?.trim() || "";
    const { getDb } = await import("../../../db");
    const db = getDb();
    const project = (await db.select().from(projects).where(eq(projects.number, projectId)).limit(1))[0];
    if (!project) return Response.json({ error: "Project Not Found" }, { status: 404 });
    const permissions = await closeoutPermissions(db, actor, project);
    if (!permissions.canView) return Response.json({ error: "Project Closeout Access Is Required" }, { status: 403 });
    await ensureProjectCloseout(db, project, actor);
    const now = new Date().toISOString();

    if (input.action === "configure-project") {
      if (!permissions.canManage) return Response.json({ error: "Project Manager Owner Or Administrator Access Is Required" }, { status: 403 });
      const phases = input.hasPhases ? normalizeStrings(input.phases) : [];
      if (input.hasPhases && !phases.length) return Response.json({ error: "Add At Least One Project Phase Or Turnover Area" }, { status: 400 });
      const control = await controlRecord(db, projectId);
      const data = { ...parseCloseoutData(control?.dataJson), hasPhases: input.hasPhases === true, phases, configuredBy: actor.name, configuredAt: now };
      await db.update(commandRecords).set({ dataJson: JSON.stringify(data), meta: phases.length ? `${phases.length} Controlled Phases` : "Single Project Closeout", updatedAt: now }).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, "CLOSEOUT-CONTROL")));
      await audit(db, projectId, "CLOSEOUT-CONTROL", actor, "Project Closeout Configuration", control?.meta || "Not Configured", phases.length ? phases.join(", ") : "Single Project", "Project setup phase decision recorded");
      return Response.json({ saved: true, phases });
    }

    if (input.action === "add-requirement" || input.action === "add-owner-punch") {
      if (!permissions.canManage && !(input.action === "add-owner-punch" && permissions.isSuperintendent)) return Response.json({ error: "PM Superintendent Owner Or Administrator Access Is Required" }, { status: 403 });
      const isPunch = input.action === "add-owner-punch";
      const title = input.title?.trim() || "";
      const reason = input.description?.trim() || input.instructions?.trim() || "";
      if (title.length < 4 || reason.length < 8) return Response.json({ error: "A Specific Title And Requirement Description Are Required" }, { status: 400 });
      const id = await nextId(db, projectId, isPunch ? "OPL" : "CLS", CLOSEOUT_REQUIREMENT_TYPE);
      const due = validDate(input.dueDate) ? input.dueDate! : project.finalDate;
      const approvalFlow = isPunch ? ["Superintendent", "Project Manager", "Project Owner"] : normalizeStrings(input.approvalFlow).length ? normalizeStrings(input.approvalFlow) : ["Project Manager"];
      const data = {
        templateKey: "custom",
        category: isPunch ? "Punch & Acceptance" : input.category?.trim() || "Project-Specific",
        responsibleRole: isPunch ? "Superintendent" : input.responsibleRole?.trim() || "Project Manager",
        responsibleName: input.responsibleName?.trim() || "",
        approvalFlow,
        approvals: [],
        weight: Math.min(5, Math.max(1, Number(input.weight || (isPunch ? 5 : 2)))),
        critical: isPunch || input.critical === true,
        instructions: reason,
        vendorId: input.vendorId?.trim() || "",
        phase: input.phase?.trim() || "Master Project",
        fileVersions: [],
        timeline: [{ action: isPunch ? "Owner Punch Item Created" : "Project Requirement Added", actor: actor.name, at: now, detail: reason }],
      };
      await db.insert(commandRecords).values({ projectId, id, recordType: CLOSEOUT_REQUIREMENT_TYPE, title, owner: String(data.responsibleName || data.responsibleRole), due, status: "Not Started", meta: `${data.category} · Weight ${data.weight} · ${data.critical ? "Critical" : "Standard"}`, recordDate: now.slice(0, 10), recordTime: now.slice(11, 16), dateLocked: true, dataJson: JSON.stringify(data), updatedAt: now });
      await audit(db, projectId, id, actor, "Closeout Requirement", "None", "Not Started", `${title} added to the permanent project closeout plan`);
      await reconcile(projectId, actor);
      return Response.json({ saved: true, recordId: id }, { status: 201 });
    }

    if (input.action === "add-equipment") {
      if (!permissions.canManage && !permissions.isSuperintendent) return Response.json({ error: "PM Superintendent Owner Or Administrator Access Is Required" }, { status: 403 });
      if (!input.equipmentType?.trim() || !input.location?.trim() || !input.manufacturer?.trim() || !input.model?.trim() || !input.serialNumber?.trim()) return Response.json({ error: "Equipment Type Location Manufacturer Model And Serial Number Are Required" }, { status: 400 });
      const id = await nextId(db, projectId, "EQ", CLOSEOUT_EQUIPMENT_TYPE);
      const data = { equipmentType: input.equipmentType.trim(), location: input.location.trim(), manufacturer: input.manufacturer.trim(), model: input.model.trim(), serialNumber: input.serialNumber.trim(), startupDate: input.startupDate || "", warrantyStart: input.warrantyStart || project.substantialDate, warrantyEnd: input.warrantyEnd || "", warrantyManager: input.warrantyManager?.trim() || project.projectManager, vendorId: input.vendorId?.trim() || "", manualRequirementId: "", trainingRequirementId: "", createdBy: actor.name, createdAt: now };
      await db.insert(commandRecords).values({ projectId, id, recordType: CLOSEOUT_EQUIPMENT_TYPE, title: `${data.equipmentType} · ${data.location}`, owner: data.warrantyManager, due: data.warrantyEnd || project.finalDate, status: "Active", meta: `${data.manufacturer} ${data.model} · S/N ${data.serialNumber}`, recordDate: now.slice(0, 10), dateLocked: true, dataJson: JSON.stringify(data), updatedAt: now });
      await audit(db, projectId, id, actor, "Equipment Register", "None", "Active", "Installed equipment added with warranty and turnover data");
      return Response.json({ saved: true, recordId: id }, { status: 201 });
    }

    if (input.action === "add-warranty-request") {
      if (!permissions.canManage && !permissions.leadership) return Response.json({ error: "Mefford Warranty Manager Access Is Required" }, { status: 403 });
      if (!input.title?.trim() || !input.description?.trim() || !input.location?.trim()) return Response.json({ error: "Title Description And Exact Location Are Required" }, { status: 400 });
      const id = await nextId(db, projectId, "WR", CLOSEOUT_WARRANTY_TYPE);
      const due = addDays(now.slice(0, 10), String(input.urgency || "").toLowerCase() === "urgent" ? 1 : 7);
      const data = { description: input.description.trim(), location: input.location.trim(), urgency: input.urgency || "Normal", ownerName: input.ownerName?.trim() || project.ownerName, vendorId: input.vendorId?.trim() || "", equipmentId: input.recordId?.trim() || "", timeline: [{ action: "Warranty Request Received", actor: actor.name, at: now, detail: input.description.trim() }] };
      await db.insert(commandRecords).values({ projectId, id, recordType: CLOSEOUT_WARRANTY_TYPE, title: input.title.trim(), owner: input.warrantyManager?.trim() || project.projectManager, due, status: "Open", meta: `${data.urgency} · ${data.location}`, recordDate: now.slice(0, 10), recordTime: now.slice(11, 16), dateLocked: true, dataJson: JSON.stringify(data), updatedAt: now });
      await audit(db, projectId, id, actor, "Warranty Request", "None", "Open", "Warranty request routed to Mefford before any subcontractor action");
      await assignWork(db, project, id, input.title.trim(), "Warranty", project.projectManager, due, data.urgency === "Urgent" ? "Critical" : "High");
      return Response.json({ saved: true, recordId: id }, { status: 201 });
    }

    if (input.action === "authorize-total-closeout") {
      if (!permissions.leadership) return Response.json({ error: "Company Owner Or Administrator Authorization Is Required" }, { status: 403 });
      const state = await totalCloseoutState(db, project);
      if (!state.ready) return Response.json({ error: `Total Closeout Blocked: ${state.blockers.join("; ")}` }, { status: 409 });
      const reason = input.reason?.trim() || "";
      if (reason.length < 10) return Response.json({ error: "Record The Final Closeout Authorization Note" }, { status: 400 });
      const control = await controlRecord(db, projectId);
      const controlData = { ...parseCloseoutData(control?.dataJson), totalCloseout: { authorized: true, actor: actor.name, email: actor.email, at: now, reason } };
      await db.batch([
        db.update(commandRecords).set({ status: "Closed", dataJson: JSON.stringify(controlData), meta: "Total Project Closeout Authorized", updatedAt: now }).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, "CLOSEOUT-CONTROL"))),
        db.update(projects).set({ status: "Completed", updatedAt: now }).where(eq(projects.number, projectId)),
        db.update(projectBonusControls).set({closeoutAt:now,paymentStatus:"Review Required",updatedAt:now}).where(eq(projectBonusControls.projectId,projectId)),
        db.insert(recordAudits).values({ projectId, recordId: "CLOSEOUT-CONTROL", fieldName: "Project Status", oldValue: project.status, newValue: "Completed", reason, actorName: actor.name, actorEmail: actor.email, summary: "Authorized total closeout retired the project from active operations; all records remain permanent." }),
      ]);
      await audit(db, projectId, "CLOSEOUT-CONTROL", actor, "Total Project Closeout", "Open", "Closed", reason);
      await seedProposalExperienceAtCloseout(db, project);
      await synchronizeBonusWork(projectId);
      const { env } = await import("cloudflare:workers");
      const handoff = await recordCompletedWorkflowHandoff(env.DB, { workflowId: "closeout-payment", eventId: `closeout-final-payment-released:${projectId}`, aggregateType: CLOSEOUT_CONTROL_TYPE, aggregateId: "CLOSEOUT-CONTROL", projectId, actorName: actor.name, actorEmail: actor.email, occurredAt: now, payload: { projectId, status: "Closed", authorizationReason: reason } });
      return Response.json({ saved: true, status: "Closed", handoff });
    }

    const recordId = input.recordId?.trim() || "";
    const row = (await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, recordId))).limit(1))[0];
    if (!row || ![CLOSEOUT_REQUIREMENT_TYPE, CLOSEOUT_WARRANTY_TYPE].includes(row.recordType)) return Response.json({ error: "Closeout Record Not Found" }, { status: 404 });
    const data = parseCloseoutData(row.dataJson);

    if (input.action === "submit-requirement") {
      if (!permissions.canManage && !permissions.isSuperintendent && !permissions.isAccountant) return Response.json({ error: "Authorized Project Team Access Is Required" }, { status: 403 });
      const fileIds = validFileIds(input.fileIds);
      const existingVersions = Array.isArray(data.fileVersions) ? data.fileVersions as Array<Record<string, unknown>> : [];
      if (!fileIds.length && !existingVersions.length) return Response.json({ error: "At Least One Supporting File Is Required" }, { status: 400 });
      const fileRows = fileIds.length ? await db.select().from(projectFiles).where(inArray(projectFiles.id, fileIds)) : [];
      if (fileRows.length !== new Set(fileIds).size) return Response.json({ error: "One Or More Supporting Files Could Not Be Found. Upload Valid Project Evidence Before Submitting." }, { status: 409 });
      if (fileRows.some((file) => file.projectId !== projectId)) return Response.json({ error: "A File Does Not Belong To This Project" }, { status: 403 });
      const ocr = permitOcrSuggestions({ fileName: fileRows.map((file) => file.name).join(" "), extractedText: input.extractedText });
      const nextData = {
        ...data,
        approvals: [],
        ownerSignature: null,
        fileVersions: [
          ...existingVersions,
          ...fileRows.map((file, index) => ({ fileId: file.id, fileName: file.name, uploadedBy: actor.name, uploadedAt: now, version: existingVersions.length + index + 1, supersedes: existingVersions.at(-1)?.fileId || null })),
        ],
        notes: input.notes?.trim() || String(data.notes || ""),
        permitMetadata: String(data.category || "").includes("Permit") || String(row.title).includes("Permit") ? {
          permitNumber: input.permitNumber?.trim() || ocr.permitNumber,
          jurisdiction: input.jurisdiction?.trim() || ocr.jurisdiction,
          inspectionDate: input.inspectionDate || ocr.inspectionDate,
          closureStatus: input.closureStatus?.trim() || ocr.closureStatus,
          ocrConfidence: ocr.confidence,
          pmVerified: false,
        } : data.permitMetadata,
        submittedBy: actor.name,
        submittedAt: now,
        timeline: [...timeline(data), { action: "Requirement Submitted", actor: actor.name, at: now, detail: `${fileRows.length} new file(s) · ${input.notes?.trim() || "Review requested"}` }],
      };
      await updateRequirement(db, row, "Submitted", nextData, now);
      await audit(db, projectId, row.id, actor, "Closeout Submission", row.status, "Submitted", "Supporting files entered the controlled approval flow");
      await routeNextApproval(db, project, row.id, row.title, nextData, now.slice(0, 10));
      await reconcile(projectId, actor);
      return Response.json({ saved: true, status: "Submitted", ocrSuggestions: nextData.permitMetadata || null });
    }

    if (input.action === "mark-not-applicable") {
      if (!permissions.isPm && !permissions.leadership) return Response.json({ error: "Only The Project Manager Owner Or Administrator May Mark A Requirement Not Applicable" }, { status: 403 });
      const reason = input.reason?.trim() || "";
      if (reason.length < 20) return Response.json({ error: "A Specific Audited Not-Applicable Reason Of At Least 20 Characters Is Required" }, { status: 400 });
      const nextData = { ...data, notApplicable: { reason, actor: actor.name, email: actor.email, at: now }, timeline: [...timeline(data), { action: "Marked Not Applicable", actor: actor.name, at: now, detail: reason }] };
      await updateRequirement(db, row, "Not Applicable", nextData, now);
      await audit(db, projectId, row.id, actor, "Applicability Decision", row.status, "Not Applicable", reason);
      await reconcile(projectId, actor);
      return Response.json({ saved: true, status: "Not Applicable" });
    }

    if (input.action === "record-approval") {
      if (!["Submitted", "Under Review"].includes(row.status) || !Array.isArray(data.fileVersions) || data.fileVersions.length === 0) return Response.json({ error: "Submit Supporting Evidence Before Recording An Approval. Corrections And New Versions Must Be Resubmitted For Review." }, { status: 409 });
      const role = currentInternalRole(permissions);
      const nextRole = nextApproval(data.approvalFlow, data.approvals);
      if (nextRole === "Project Owner") return Response.json({ error: "Use The Electronic Project Owner Signoff Gate" }, { status: 409 });
      if (!role || (role !== nextRole && !permissions.leadership)) return Response.json({ error: `${nextRole} Approval Is Required Next` }, { status: 403 });
      const decision = input.decision || "Approved";
      const reason = input.reason?.trim() || "";
      if (decision === "Rejected" && reason.length < 10) return Response.json({ error: "Explain What Must Be Corrected" }, { status: 400 });
      const approvals = Array.isArray(data.approvals) ? data.approvals as Array<Record<string, unknown>> : [];
      const approvalRole = permissions.leadership && role !== nextRole ? nextRole : role;
      const nextApprovals = [...approvals.filter((item) => String(item.role || "") !== approvalRole), { role: approvalRole, decision, actor: actor.name, email: actor.email, at: now, comments: reason, recordedByLeadership: permissions.leadership && role !== nextRole }];
      const remaining = nextApproval(data.approvalFlow, nextApprovals);
      const status = decision === "Rejected" ? "Corrections Required" : remaining === "Complete" ? "Approved" : "Under Review";
      const permitMetadata = data.permitMetadata && typeof data.permitMetadata === "object" && approvalRole === "Project Manager" ? { ...(data.permitMetadata as Record<string, unknown>), pmVerified: true, verifiedBy: actor.name, verifiedAt: now } : data.permitMetadata;
      const nextData = { ...data, approvals: nextApprovals, permitMetadata, timeline: [...timeline(data), { action: `${approvalRole} ${decision}`, actor: actor.name, at: now, detail: reason || (status === "Approved" ? "Every required approval gate is complete." : `${remaining} remains.`) }] };
      await updateRequirement(db, row, status, nextData, now);
      await audit(db, projectId, row.id, actor, `${approvalRole} Decision`, row.status, status, reason || `${decision}; ${remaining === "Complete" ? "all approvals complete" : `${remaining} remains`}`);
      if (status !== "Approved" && status !== "Corrections Required") await routeNextApproval(db, project, row.id, row.title, nextData, row.due);
      if (status === "Approved" && String(data.templateKey || "").endsWith("final-invoice")) await requestUnconditionalWaiver(db, project, data, actor, now);
      await reconcile(projectId, actor);
      return Response.json({ saved: true, status, remaining });
    }

    if (input.action === "record-owner-signoff") {
      if (!permissions.canManage) return Response.json({ error: "PM Owner Or Administrator Access Is Required To Record The Controlled Owner Signoff" }, { status: 403 });
      if (nextApproval(data.approvalFlow, data.approvals) !== "Project Owner") return Response.json({ error: "All Prior Approval Gates Must Be Complete Before Owner Signoff" }, { status: 409 });
      if (!input.signerName?.trim() || !input.signerTitle?.trim() || !input.signerEmail?.trim() || input.signatureConsent !== true) return Response.json({ error: "Owner Name Title Email And Electronic Signature Consent Are Required" }, { status: 400 });
      const approvals = Array.isArray(data.approvals) ? data.approvals as Array<Record<string, unknown>> : [];
      const ownerApproval = { role: "Project Owner", decision: "Approved", actor: input.signerName.trim(), email: input.signerEmail.trim().toLowerCase(), title: input.signerTitle.trim(), at: now, electronicSignatureConsent: true, recordedBy: actor.name, recordedByEmail: actor.email };
      const nextApprovals = [...approvals.filter((item) => String(item.role || "") !== "Project Owner"), ownerApproval];
      const remaining = nextApproval(data.approvalFlow, nextApprovals);
      const status = remaining === "Complete" ? "Approved" : "Under Review";
      const nextData = { ...data, approvals: nextApprovals, ownerSignature: ownerApproval, timeline: [...timeline(data), { action: "Project Owner Electronic Signoff", actor: input.signerName.trim(), at: now, detail: `${input.signerTitle.trim()} · ${input.signerEmail.trim()} · Consent recorded by ${actor.name}` }] };
      await updateRequirement(db, row, status, nextData, now);
      await audit(db, projectId, row.id, { name: input.signerName.trim(), email: input.signerEmail.trim() }, "Project Owner Signoff", row.status, status, `Electronic acceptance recorded by ${actor.name}`);
      await reconcile(projectId, actor);
      return Response.json({ saved: true, status, remaining });
    }

    if (input.action === "close-warranty-request") {
      if (row.recordType !== CLOSEOUT_WARRANTY_TYPE || (!permissions.canManage && !permissions.leadership)) return Response.json({ error: "Warranty Manager Access Is Required" }, { status: 403 });
      const reason = input.reason?.trim() || "";
      if (reason.length < 10 || input.correctionAccepted !== true) return Response.json({ error: "Repair Notes And Acceptance Confirmation Are Required" }, { status: 400 });
      const nextData = { ...data, closedBy: actor.name, closedAt: now, acceptance: reason, timeline: [...timeline(data), { action: "Warranty Repair Accepted", actor: actor.name, at: now, detail: reason }] };
      await db.update(commandRecords).set({ status: "Closed", dataJson: JSON.stringify(nextData), updatedAt: now }).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, row.id)));
      await audit(db, projectId, row.id, actor, "Warranty Closure", row.status, "Closed", reason);
      return Response.json({ saved: true, status: "Closed" });
    }

    return Response.json({ error: "A Valid Closeout Action Is Required" }, { status: 400 });
  } catch (error) {
    return closeoutError(error);
  }
}

export async function reconcileAllCloseoutAutomation() {
  const { getDb } = await import("../../../db");
  const db = getDb();
  const rows = await db.select().from(projects).where(inArray(projects.status, ["Active", "Preconstruction"]));
  for (const project of rows) {
    const systemActor = { name: "Closeout Automation", email: "system@meffcon.com" };
    await ensureProjectCloseout(db, project, systemActor);
    await activateCloseoutWindow(db, project, systemActor);
    await syncCloseoutWork(db, project);
    await syncWarrantyExpirationWork(db, project);
    await reconcile(project.number, systemActor);
  }
}

async function closeoutPayload(db: Db, project: Project, permissions: Awaited<ReturnType<typeof closeoutPermissions>>) {
  const rows = await db.select().from(commandRecords).where(eq(commandRecords.projectId, project.number)).orderBy(commandRecords.due);
  const requirements = rows.filter((row) => row.recordType === CLOSEOUT_REQUIREMENT_TYPE);
  const equipment = rows.filter((row) => row.recordType === CLOSEOUT_EQUIPMENT_TYPE);
  const warranty = rows.filter((row) => row.recordType === CLOSEOUT_WARRANTY_TYPE);
  const control = rows.find((row) => row.recordType === CLOSEOUT_CONTROL_TYPE)!;
  const audits = await db.select().from(recordAudits).where(eq(recordAudits.projectId, project.number)).orderBy(desc(recordAudits.id));
  const auditMap = new Map<string, typeof audits>();
  for (const auditRow of audits) auditMap.set(auditRow.recordId, [...(auditMap.get(auditRow.recordId) || []), auditRow]);
  const fileRows = await db.select().from(projectFiles).where(eq(projectFiles.projectId, project.number)).orderBy(desc(projectFiles.id));
  const progress = calculateCloseoutProgress(requirements.map(clientProgressRecord));
  const expected = expectedCloseoutProgress(project.finalDate);
  const healthPoints = closeoutHealthPoints(progress.progress, expected.expected, expected.active);
  const total = await totalCloseoutState(db, project);
  const categories = Array.from(new Set(requirements.map((row) => String(parseCloseoutData(row.dataJson).category || "Other")))).map((category) => {
    const categoryRows = requirements.filter((row) => String(parseCloseoutData(row.dataJson).category || "Other") === category);
    const categoryProgress = calculateCloseoutProgress(categoryRows.map(clientProgressRecord));
    return { category, ...categoryProgress, open: categoryRows.length - categoryProgress.approved };
  }).sort((a, b) => a.category.localeCompare(b.category));
  return {
    project: { number: project.number, name: project.name, ownerName: project.ownerName, status: project.status, site: project.site, startDate: project.startDate, substantialDate: project.substantialDate, finalDate: project.finalDate, projectManager: project.projectManager, superintendent: project.superintendent, timeZone: project.timeZone },
    permissions,
    policy: {
      reminders: "90, 60, and 30 days; weekly in the final 30 days; overdue until complete",
      paymentGate: "Approved closeout requirements plus conditional final lien release before final payment; unconditional release requested after payment",
      approvals: "Superintendent verifies field work; PM approves technical documents; Accountant approves financial and lien records; Company Owner authorizes Total Project Closeout",
      package: "Individual print, consolidated master packet, and thumb-drive export with original files, media, photos, and searchable index",
      automationSafeguard: "No invoice, payment, posting, contract, or approval is sent or completed automatically",
    },
    control: { ...parseCloseoutData(control.dataJson), status: control.status, auditHistory: clientAudits(auditMap.get(control.id) || []) },
    progress: { ...progress, expected: expected.expected, daysRemaining: expected.daysRemaining, activeWindow: expected.active, milestone: expected.milestone, healthPoints, healthWeight: 5 },
    totalCloseout: total,
    categories,
    requirements: requirements.map((row) => clientRequirement(row, auditMap.get(row.id) || [])),
    equipment: equipment.map((row) => clientRecord(row, auditMap.get(row.id) || [])),
    warrantyRequests: warranty.map((row) => clientRecord(row, auditMap.get(row.id) || [])),
    files: fileRows.filter((file) => file.category.startsWith("Closeout")).map((file) => ({ id: file.id, name: file.name, category: file.category, revision: file.revision, contentType: file.contentType, sizeBytes: file.sizeBytes, uploadedBy: file.uploadedBy, createdAt: file.createdAt })),
  };
}

async function ensureProjectCloseout(db: Db, project: Project, actor: { name: string; email: string }) {
  const now = new Date().toISOString();
  await db.insert(commandRecords).values({ projectId: project.number, id: "CLOSEOUT-CONTROL", recordType: CLOSEOUT_CONTROL_TYPE, title: `${project.name} Closeout Control`, owner: project.projectManager, due: project.finalDate, status: "Open", meta: "Single Project Closeout · Checklist Created At Project Award", recordDate: now.slice(0, 10), dateLocked: true, dataJson: JSON.stringify({ hasPhases: false, phases: [], createdAt: now, createdBy: actor.name, reminderPolicy: { startDays: 90, milestones: [90, 60, 30], weeklyFinalDays: 30 }, packageVersions: [] }), updatedAt: now }).onConflictDoNothing();
  const existing = await db.select({ id: commandRecords.id }).from(commandRecords).where(and(eq(commandRecords.projectId, project.number), eq(commandRecords.recordType, CLOSEOUT_REQUIREMENT_TYPE)));
  const ids = new Set(existing.map((row) => row.id));
  for (const template of CLOSEOUT_STANDARD_REQUIREMENTS) {
    const id = `CLS-${template.key.toUpperCase()}`;
    if (ids.has(id)) continue;
    await insertTemplate(db, project, id, template, now);
  }
  const accessRows = await db.select().from(vendorProjectAccess).where(eq(vendorProjectAccess.projectId, project.number));
  const vendorIds = accessRows.map((row) => row.vendorId);
  const vendors = vendorIds.length ? await db.select().from(vendorProfiles).where(inArray(vendorProfiles.id, vendorIds)) : [];
  for (const access of accessRows) {
    const vendor = vendors.find((item) => item.id === access.vendorId);
    if (!vendor) continue;
    const permissions = parseStringArray(access.permissionsJson);
    if (permissions.includes("Owner Closeout Read Only")) continue;
    for (const template of vendorCloseoutTemplates({ id: vendor.id, name: vendor.legalName, trade: access.trade })) {
      const id = `CLS-${template.key.toUpperCase()}`;
      if (ids.has(id)) continue;
      await insertTemplate(db, project, id, template, now, { vendorId: vendor.id, vendorName: vendor.legalName, vendorEmail: vendor.contactEmail });
      ids.add(id);
    }
    const shared = parseStringArray(access.sharedRecordsJson);
    if (!permissions.includes("Closeout Submission") || !shared.includes("Closeout Requirements")) {
      await db.update(vendorProjectAccess).set({ permissionsJson: JSON.stringify(Array.from(new Set([...permissions, "Closeout Submission"]))), sharedRecordsJson: JSON.stringify(Array.from(new Set([...shared, "Closeout Requirements"]))), updatedAt: now }).where(eq(vendorProjectAccess.id, access.id));
    }
  }
}

async function insertTemplate(db: Db, project: Project, id: string, template: (typeof CLOSEOUT_STANDARD_REQUIREMENTS)[number], now: string, extras: Record<string, unknown> = {}) {
  const data = { ...template, ...extras, approvals: [], fileVersions: [], phase: "Master Project", source: "Mefford Standard Closeout Library", templateReview: "Annual Owner Review Required", timeline: [{ action: "Requirement Created At Project Award", actor: "Command Center", at: now, detail: template.instructions }] };
  const owner = extras.vendorName
    ? String(extras.vendorName)
    : template.responsibleRole === "Project Manager"
      ? project.projectManager
      : template.responsibleRole === "Superintendent"
        ? project.superintendent
        : template.responsibleRole;
  await db.insert(commandRecords).values({ projectId: project.number, id, recordType: CLOSEOUT_REQUIREMENT_TYPE, title: template.title, owner, due: project.finalDate, status: "Not Started", meta: `${template.category} · Weight ${template.weight} · ${template.critical ? "Critical" : "Standard"}`, recordDate: now.slice(0, 10), dateLocked: true, dataJson: JSON.stringify(data), updatedAt: now }).onConflictDoNothing();
}

async function activateCloseoutWindow(db: Db, project: Project, actor: { name: string; email: string }) {
  const expected = expectedCloseoutProgress(project.finalDate);
  if (!expected.active) return;
  const rows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, project.number), eq(commandRecords.recordType, CLOSEOUT_REQUIREMENT_TYPE)));
  const now = new Date().toISOString();
  for (const row of rows.filter((item) => item.status === "Not Started")) {
    const data = parseCloseoutData(row.dataJson);
    const nextData = { ...data, requestedAt: now, requestMilestone: expected.milestone, timeline: [...timeline(data), { action: "Closeout Collection Requested", actor: actor.name, at: now, detail: `${expected.daysRemaining} days remain before final completion.` }] };
    await db.update(commandRecords).set({ status: "Requested", dataJson: JSON.stringify(nextData), updatedAt: now }).where(and(eq(commandRecords.projectId, project.number), eq(commandRecords.id, row.id)));
  }
}

async function syncCloseoutWork(db: Db, project: Project) {
  const requirements = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, project.number), eq(commandRecords.recordType, CLOSEOUT_REQUIREMENT_TYPE)));
  const expected = expectedCloseoutProgress(project.finalDate);
  for (const row of requirements) {
    if (["Approved", "Not Applicable"].includes(row.status)) continue;
    const data = parseCloseoutData(row.dataJson);
    const role = row.status === "Submitted" || row.status === "Under Review" ? nextApproval(data.approvalFlow, data.approvals) : String(data.responsibleRole || "Project Manager");
    if (role === "Subcontractor" || role === "Project Owner" || (!expected.active && !["Submitted", "Under Review", "Corrections Required"].includes(row.status))) continue;
    const recipient = await personForRole(db, project, role);
    if (!recipient) continue;
    await upsertWorkItem(db, { dedupeKey: `closeout:${project.number}:${row.id}:${recipient.email}`, projectId: project.number, recipientName: recipient.name, recipientEmail: recipient.email, kind: "Closeout", title: row.title, message: `${row.id} · ${row.status}. ${String(data.instructions || "Complete the assigned closeout requirement.")} Click the requirement to see every completed and remaining approval gate.`, priority: data.critical === true || ["Submitted", "Corrections Required"].includes(row.status) ? "High" : "Normal", sourceType: "Closeout", sourceRecordId: row.id, actionTarget: "Closeout", dueAt: `${row.due}T17:00:00-04:00`, createdBy: "Closeout Automation" });
  }
}

async function syncWarrantyExpirationWork(db: Db, project: Project) {
  const equipment = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, project.number), eq(commandRecords.recordType, CLOSEOUT_EQUIPMENT_TYPE)));
  const today = new Date().toISOString().slice(0, 10);
  for (const row of equipment) {
    const data = parseCloseoutData(row.dataJson);
    const warrantyEnd = String(data.warrantyEnd || "");
    if (!validDate(warrantyEnd)) continue;
    const daysRemaining = Math.ceil((new Date(`${warrantyEnd}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 86_400_000);
    if (daysRemaining > 90) continue;
    const milestone = daysRemaining <= 0 ? "Expired" : daysRemaining <= 30 ? "30-Day" : daysRemaining <= 60 ? "60-Day" : "90-Day";
    const manager = await memberByName(db, String(data.warrantyManager || project.projectManager)) || await memberByName(db, project.projectManager);
    if (!manager) continue;
    await upsertWorkItem(db, {
      dedupeKey: `warranty-expiration:${project.number}:${row.id}`,
      projectId: project.number,
      recipientName: manager.name,
      recipientEmail: manager.email,
      kind: "Warranty",
      title: `${row.title} Warranty ${milestone === "Expired" ? "Expired" : "Expiration"}`,
      message: `${milestone} warranty alert. Coverage ends ${warrantyEnd}. Review the equipment record, notify the project owner when appropriate, and preserve the permanent warranty history.`,
      priority: daysRemaining <= 0 ? "Critical" : daysRemaining <= 30 ? "High" : "Normal",
      sourceType: "Closeout Warranty",
      sourceRecordId: row.id,
      actionTarget: "Closeout",
      dueAt: `${warrantyEnd}T17:00:00-04:00`,
      createdBy: "Warranty Automation",
    });
  }
}

async function routeNextApproval(db: Db, project: Project, recordId: string, title: string, data: Record<string, unknown>, due: string) {
  const role = nextApproval(data.approvalFlow, data.approvals);
  const recipient = await personForRole(db, project, role);
  if (!recipient) return;
  await assignWork(db, project, recordId, title, "Closeout Approval", recipient.name, due, data.critical === true ? "High" : "Normal");
}

async function assignWork(db: Db, project: Project, recordId: string, title: string, kind: string, recipientName: string, due: string, priority: "Normal" | "High" | "Critical") {
  const member = (await db.select().from(companyMembers).where(eq(companyMembers.displayName, recipientName)).limit(1))[0];
  if (!member) return;
  await upsertWorkItem(db, { dedupeKey: `closeout:${project.number}:${recordId}:${member.email}`, projectId: project.number, recipientName: member.displayName, recipientEmail: member.email, kind, title, message: `${recordId} requires your controlled closeout action. Open it to see the complete approval path and audit history.`, priority, sourceType: "Closeout", sourceRecordId: recordId, actionTarget: "Closeout", dueAt: validDate(due) ? `${due}T17:00:00-04:00` : due, createdBy: "Closeout Automation" });
}

async function requestUnconditionalWaiver(db: Db, project: Project, sourceData: Record<string, unknown>, actor: { name: string; email: string }, now: string) {
  const vendorId = String(sourceData.vendorId || "");
  if (!vendorId) return;
  const rows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, project.number), eq(commandRecords.recordType, CLOSEOUT_REQUIREMENT_TYPE)));
  const waiver = rows.find((row) => {
    const data = parseCloseoutData(row.dataJson);
    return String(data.vendorId || "") === vendorId && String(data.templateKey || "").endsWith("unconditional-waiver");
  });
  if (!waiver || ["Approved", "Submitted", "Under Review"].includes(waiver.status)) return;
  const data = parseCloseoutData(waiver.dataJson);
  const nextData = { ...data, requestedAt: now, paymentConfirmedAt: now, paymentConfirmedBy: actor.name, timeline: [...timeline(data), { action: "Automatically Requested After Final Payment Confirmation", actor: "Closeout Automation", at: now, detail: `Payment confirmation recorded by ${actor.name}; waiver remains a separate approval gate.` }] };
  await db.update(commandRecords).set({ status: "Requested", dataJson: JSON.stringify(nextData), updatedAt: now }).where(and(eq(commandRecords.projectId, project.number), eq(commandRecords.id, waiver.id)));
  await audit(db, project.number, waiver.id, actor, "Unconditional Lien Release", waiver.status, "Requested", "Payment confirmation triggered a request only; no document was approved automatically");
}

async function totalCloseoutState(db: Db, project: Project) {
  const requirements = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, project.number), eq(commandRecords.recordType, CLOSEOUT_REQUIREMENT_TYPE)));
  const openCritical = requirements.filter((row) => parseCloseoutData(row.dataJson).critical === true && !["Approved", "Not Applicable"].includes(row.status));
  const quality = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, project.number), eq(commandRecords.recordType, QUALITY_ITEM_RECORD_TYPE)));
  const openQuality = quality.filter((row) => row.status !== "Closed");
  const vendorRows = await db.select().from(vendorSubmissions).where(eq(vendorSubmissions.projectId, project.number));
  const unpaidFinals = vendorRows.filter((row) => parseCloseoutData(row.payloadJson).finalApplication === true && row.status !== "Paid");
  const waiverRows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, project.number), eq(commandRecords.recordType, "Lien Waiver")));
  const conditionalFinals = waiverRows.filter((row) => String(parseCloseoutData(row.dataJson).formType || "") === "conditional-final");
  const unconditionalFinals = waiverRows.filter((row) => String(parseCloseoutData(row.dataJson).formType || "") === "unconditional-final");
  const waiverBlockers = conditionalFinals.flatMap((conditional) => {
    const unconditional = unconditionalFinals.find((row) => String(parseCloseoutData(row.dataJson).conditionalSourceId || "") === conditional.id);
    if (!["Effective — Payment Cleared"].includes(conditional.status)) return [`${conditional.id} conditional final release is ${conditional.status}`];
    if (!unconditional || unconditional.status !== "Approved — Unconditional") return [`${unconditional?.id || conditional.id} unconditional final release is ${unconditional?.status || "not requested"}`];
    return [];
  });
  // Uploaded reconciliation evidence cannot override outstanding source balances.
  const invoices = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, "MEFFORD-ACCOUNTING"), eq(commandRecords.recordType, "AP Invoice")));
  const payableBlockers = invoices.filter((invoice) => {
    if (!isOpenPayable(invoice.status)) return false;
    const allocations = parseCloseoutData(invoice.dataJson).allocations;
    return Array.isArray(allocations) && allocations.some((allocation) => allocation && typeof allocation === "object" && String(allocation.destination || "") === project.number && toCents(allocation.amount) !== 0);
  }).map((invoice) => `${invoice.id} AP invoice remains payable (${invoice.status})`);
  const ownerInvoices = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, project.number), eq(commandRecords.recordType, "Owner Billing")));
  const receivableBlockers = ownerInvoices.filter((invoice) => {
    const invoiceData = parseCloseoutData(invoice.dataJson);
    return isIssuedOwnerBilling(invoice.status) && toCents(invoiceData.currentPaymentDue) > toCents(invoiceData.receivedToDate);
  }).map((invoice) => `${invoice.id} owner invoice has an outstanding receivable`);
  const blockers = [
    ...openCritical.map((row) => `${row.id} ${row.title}`),
    ...openQuality.map((row) => `${row.id} ${row.title}`),
    ...unpaidFinals.map((row) => `${row.id} final ${row.submissionType} is ${row.status}`),
    ...waiverBlockers,
    ...payableBlockers,
    ...receivableBlockers,
  ];
  const latestBilling = ownerInvoices.filter(invoice => isIssuedOwnerBilling(invoice.status)).sort((a, b) =>
    String(parseCloseoutData(b.dataJson).sentAt || b.recordDate || b.updatedAt).localeCompare(String(parseCloseoutData(a.dataJson).sentAt || a.recordDate || a.updatedAt)) ||
    b.id.localeCompare(a.id, undefined, { numeric: true }))[0];
  const retainedCents = toCents(parseCloseoutData(latestBilling?.dataJson).retainageToDate);
  if (retainedCents > 0) blockers.push("Owner retainage remains unreleased: $" + (retainedCents / 100).toFixed(2));
  const progress = calculateCloseoutProgress(requirements.map(clientProgressRecord));
  const control = await controlRecord(db, project.number);
  return { ready: blockers.length === 0 && progress.progress === 100, blockers, progress: progress.progress, ownerAuthorization: parseCloseoutData(control?.dataJson).totalCloseout || null, closed: control?.status === "Closed" };
}

async function closeoutPermissions(db: Db, actor: ReturnType<typeof getCommandActor>, project: Project) {
  const member = actor.email ? (await db.select().from(companyMembers).where(eq(companyMembers.email, actor.email)).limit(1))[0] : null;
  const accessLevel = member?.companyAccessLevel || actor.accessLevel;
  const designations = parseStringArray(member?.designationsJson || "[]");
  const leadership = ["Company Owner", "Administrator"].includes(accessLevel);
  const projectRoles = await projectDesignationsFor(db, actor, project, designations);
  const isPm = projectRoles.includes("Project Manager");
  const isSuperintendent = projectRoles.includes("Superintendent");
  const isAccountant = designations.includes("Accountant") || designations.includes("Office Staff");
  return { canView: leadership || isPm || isSuperintendent || isAccountant, canManage: leadership || isPm, leadership, isPm, isSuperintendent, isAccountant, role: leadership ? "Company Owner" : isPm ? "Project Manager" : isSuperintendent ? "Superintendent" : isAccountant ? "Accountant" : "Viewer", actorName: member?.displayName || actor.name };
}

function currentInternalRole(permissions: Awaited<ReturnType<typeof closeoutPermissions>>) {
  return permissions.isPm ? "Project Manager" : permissions.isSuperintendent ? "Superintendent" : permissions.isAccountant ? "Accountant" : permissions.leadership ? "Company Owner" : "";
}

async function personForRole(db: Db, project: Project, role: string) {
  if (role === "Project Manager") return memberByName(db, project.projectManager);
  if (role === "Superintendent") return memberByName(db, project.superintendent);
  const members = await db.select().from(companyMembers).where(eq(companyMembers.isActive, true));
  if (role === "Accountant") {
    const member = members.find((item) => {
      const designations = parseStringArray(item.designationsJson);
      return designations.includes("Accountant") || designations.includes("Office Staff");
    });
    return member ? { name: member.displayName, email: member.email } : null;
  }
  if (role === "Company Owner") {
    const member = members.find((item) => item.companyAccessLevel === "Company Owner");
    return member ? { name: member.displayName, email: member.email } : null;
  }
  return null;
}

async function memberByName(db: Db, name: string) {
  const member = (await db.select().from(companyMembers).where(eq(companyMembers.displayName, name)).limit(1))[0];
  return member ? { name: member.displayName, email: member.email } : null;
}

async function controlRecord(db: Db, projectId: string) {
  return (await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, "CLOSEOUT-CONTROL"))).limit(1))[0];
}

async function nextId(db: Db, projectId: string, prefix: string, recordType: string) {
  const rows = await db.select({ id: commandRecords.id }).from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, recordType)));
  const largest = rows.reduce((max, row) => Math.max(max, Number(row.id.match(/(\d+)$/)?.[1] || 0)), 0);
  return `${prefix}-${String(largest + 1).padStart(4, "0")}`;
}

async function updateRequirement(db: Db, row: Requirement, status: string, data: Record<string, unknown>, now: string) {
  const credit = closeoutStatusCredit(status, data.approvalFlow, data.approvals);
  await db.update(commandRecords).set({ status, owner: nextApproval(data.approvalFlow, data.approvals), meta: `${String(data.category || "Closeout")} · ${credit}% Credit · ${status}`, dataJson: JSON.stringify(data), updatedAt: now }).where(and(eq(commandRecords.projectId, row.projectId), eq(commandRecords.id, row.id)));
}

async function audit(db: Db, projectId: string, recordId: string, actor: { name: string; email: string }, fieldName: string, oldValue: string, newValue: string, summary: string) {
  await db.insert(recordAudits).values({ projectId, recordId, fieldName, oldValue, newValue, reason: summary, actorName: actor.name, actorEmail: actor.email, summary: `${recordId} · ${summary}` });
}

async function reconcile(projectId: string, actor: { name: string; email: string }) {
  const { reconcileProjectHealthAfterUpdate } = await import("../project-health/route");
  await reconcileProjectHealthAfterUpdate(projectId, actor);
}

function clientRequirement(row: Requirement, audits: Array<typeof recordAudits.$inferSelect>) {
  const data = parseCloseoutData(row.dataJson);
  return { ...clientRecord(row, audits), progressCredit: closeoutStatusCredit(row.status, data.approvalFlow, data.approvals), nextApproval: nextApproval(data.approvalFlow, data.approvals) };
}

function clientRecord(row: Requirement, audits: Array<typeof recordAudits.$inferSelect>) {
  return { id: row.id, title: row.title, owner: row.owner, due: row.due, status: row.status, meta: row.meta, updatedAt: row.updatedAt, data: parseCloseoutData(row.dataJson), auditHistory: clientAudits(audits) };
}

function clientProgressRecord(row: Requirement) {
  return { status: row.status, data: parseCloseoutData(row.dataJson) };
}

function clientAudits(audits: Array<typeof recordAudits.$inferSelect>) {
  return audits.map((item) => ({ id: item.id, action: item.fieldName, actor: item.actorName, actorEmail: item.actorEmail, at: item.createdAt, summary: item.summary }));
}

function timeline(data: Record<string, unknown>) {
  return Array.isArray(data.timeline) ? data.timeline as Array<Record<string, unknown>> : [];
}

function validFileIds(value: unknown) {
  return Array.isArray(value) ? value.map(Number).filter((id) => Number.isInteger(id) && id > 0) : [];
}

function normalizeStrings(value: unknown) {
  return Array.isArray(value) ? Array.from(new Set(value.map(String).map((item) => item.trim()).filter(Boolean))) : [];
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function closeoutError(error: unknown) {
  return Response.json({ error: error instanceof Error ? error.message : "Project Closeout Is Unavailable" }, { status: 500 });
}
