import { and, desc, eq, inArray, or } from "drizzle-orm";
import {
  commandRecords,
  commandWorkItems,
  companyMembers,
  projectFiles,
  projects,
  recordAudits,
  vendorAudits,
  vendorComplianceDocuments,
  vendorInvites,
  vendorProfiles,
  vendorProjectAccess,
  vendorSubmissions,
} from "../../../db/schema";
import { ensureMyWorkTables, upsertWorkItem } from "../../../lib/my-work";
import { ensureConditionalWaiverForBilling } from "../../../lib/lien-waivers-server";
import { LIEN_WAIVER_RECORD_TYPE, canIssueUnconditionalWaiver, isConditionalWaiver, isLienWaiverType } from "../../../lib/lien-waivers";
import { moneyDecimal, roundMoney } from "../../../lib/money.js";
import { CLOSEOUT_REQUIREMENT_TYPE, CLOSEOUT_WARRANTY_TYPE, nextApproval, parseCloseoutData } from "../../../lib/closeout";
import { normalizeDesignChecklist } from "../../../lib/design-lifecycle";
import {
  createCorrespondenceImpactActions,
  type ImpactAnswer,
  parseCorrespondenceData,
  updateCorrespondenceRecord,
} from "../../../lib/project-correspondence";
import {
  complianceState,
  ensureVendorSchema,
  finalCloseoutState,
  hashSecret,
  parseObject,
  parseStringArray,
  vendorPortalSession,
} from "../../../lib/vendor-portal";
import { QUALITY_ITEM_RECORD_TYPE, parseQualityData } from "../../../lib/quality-control";

type PortalInput = {
  action?: string;
  inviteId?: string;
  code?: string;
  contactPhone?: string;
  address?: Record<string, string>;
  trades?: string[];
  serviceAreas?: string[];
  projectId?: string;
  submissionType?: "Invoice" | "AIA Pay Application";
  invoiceNumber?: string;
  applicationNumber?: string;
  periodEnd?: string;
  amount?: number;
  description?: string;
  finalApplication?: boolean;
  scheduledValue?: number;
  previousPayments?: number;
  workCompleted?: number;
  storedMaterials?: number;
  approvedChangeOrders?: number;
  retainagePercent?: number;
  attachmentStorageKey?: string;
  attachmentName?: string;
  recordId?: string;
  responseText?: string;
  responseStatus?: string;
  costImpact?: ImpactAnswer;
  scheduleImpact?: ImpactAnswer;
  reviewDecision?: "Approved" | "Approved As Noted" | "Revise And Resubmit" | "Rejected";
  reviewComments?: string;
  revisionLabel?: string;
  revisionDescription?: string;
  designFileId?: number;
  designFileName?: string;
  title?: string;
  exactLocation?: string;
  inspectionStage?: "Preparatory" | "Work-In-Place" | "Final";
  reference?: string;
  responsibleTrade?: string;
  beforePhotoFileIds?: number[];
  afterPhotoFileIds?: number[];
  correctionDate?: string;
  correctionNotes?: string;
  acknowledgment?: boolean;
  qualityDecision?: "Accept" | "Reject";
  qualityComments?: string;
  fileIds?: number[];
  fileNames?: string[];
  notes?: string;
  urgency?: "Normal" | "Urgent";
  signerName?: string;
  signerTitle?: string;
  signatureImage?: string;
  signatureConsent?: boolean;
};

export async function GET(request: Request) {
  await ensureVendorSchema();
  const search = new URL(request.url).searchParams;
  const inviteId = search.get("inviteId")?.trim() || "";
  if (!inviteId) return Response.json({ error: "Invite ID Is Required" }, { status: 400 });
  const { getDb } = await import("../../../db");
  const db = getDb();
  const invite = await db.select().from(vendorInvites).where(eq(vendorInvites.id, inviteId)).limit(1);
  if (!invite[0] || invite[0].revokedAt) return Response.json({ error: "This Vendor Invite Is Not Available" }, { status: 404 });
  const vendor = await db.select().from(vendorProfiles).where(eq(vendorProfiles.id, invite[0].vendorId)).limit(1);
  if (!vendor[0]) return Response.json({ error: "Vendor Record Not Found" }, { status: 404 });
  const session = await vendorPortalSession(request);
  if (!session) {
    return Response.json({
      verified: false,
      invite: {
        id: invite[0].id,
        company: vendor[0].legalName,
        emailHint: maskEmail(invite[0].email),
        expiresAt: invite[0].expiresAt,
        locked: invite[0].attempts >= 5,
        expired: new Date(invite[0].expiresAt) <= new Date(),
      },
    });
  }
  return portalPayload(db, vendor[0], invite[0]);
}

export async function POST(request: Request) {
  await ensureVendorSchema();
  const input = (await request.json()) as PortalInput;
  const { getDb } = await import("../../../db");
  const db = getDb();
  const now = new Date();

  if (input.action === "verify-code") {
    const inviteId = input.inviteId?.trim() || "";
    const code = input.code?.replace(/\D/g, "") || "";
    const invite = await db.select().from(vendorInvites).where(eq(vendorInvites.id, inviteId)).limit(1);
    const row = invite[0];
    if (!row || row.revokedAt || new Date(row.expiresAt) <= now || row.attempts >= 5) {
      return Response.json({ error: "This Invite Is Expired Revoked Or Locked" }, { status: 403 });
    }
    if (code.length !== 6 || (await hashSecret(code)) !== row.codeHash) {
      const attempts = row.attempts + 1;
      await db.update(vendorInvites).set({ attempts }).where(eq(vendorInvites.id, row.id));
      await db.insert(vendorAudits).values({
        vendorId: row.vendorId,
        actorName: row.email,
        actorEmail: row.email,
        action: "Portal Code Rejected",
        detail: `Attempt ${attempts} of 5.`,
      });
      return Response.json({ error: attempts >= 5 ? "Invite Locked After Five Attempts" : `Code Not Accepted · ${5 - attempts} Attempts Remain` }, { status: 403 });
    }
    const sessionToken = randomToken();
    const sessionExpiresAt = new Date(now.getTime() + 8 * 3_600_000).toISOString();
    await db.update(vendorInvites).set({
      attempts: 0,
      verifiedAt: now.toISOString(),
      sessionHash: await hashSecret(sessionToken),
      sessionExpiresAt,
    }).where(eq(vendorInvites.id, row.id));
    await db.insert(vendorAudits).values({
      vendorId: row.vendorId,
      actorName: row.email,
      actorEmail: row.email,
      action: "Portal Access Verified",
      detail: `One-time code accepted; controlled session expires ${sessionExpiresAt}.`,
    });
    return Response.json({ verified: true, sessionToken, sessionExpiresAt });
  }

  const session = await vendorPortalSession(request);
  if (!session) return Response.json({ error: "Vendor Session Is Missing Or Expired" }, { status: 401 });
  const vendor = await db.select().from(vendorProfiles).where(eq(vendorProfiles.id, session.vendorId)).limit(1);
  if (!vendor[0]) return Response.json({ error: "Vendor Record Not Found" }, { status: 404 });

  if (input.action === "update-profile") {
    await db.update(vendorProfiles).set({
      contactPhone: input.contactPhone?.trim() || "",
      addressJson: JSON.stringify(input.address || {}),
      tradesJson: JSON.stringify(input.trades || []),
      serviceAreasJson: JSON.stringify(input.serviceAreas || []),
      status: vendor[0].status === "Approved" ? "Approved" : "Onboarding",
      updatedAt: now.toISOString(),
    }).where(eq(vendorProfiles.id, vendor[0].id));
    await db.insert(vendorAudits).values({
      vendorId: vendor[0].id,
      actorName: vendor[0].contactName,
      actorEmail: session.email,
      action: "Vendor Profile Updated",
      detail: "Phone address trades and service areas updated through controlled portal access.",
    });
    return Response.json({ saved: true });
  }

  if (input.action === "submit-design-revision") {
    const projectId = input.projectId?.trim() || "";
    const recordId = input.recordId?.trim() || "";
    const revisionLabel = input.revisionLabel?.trim() || "";
    const revisionDescription = input.revisionDescription?.trim() || "";
    const designFileId = Number(input.designFileId || 0);
    const designFileName = input.designFileName?.trim() || "";
    if (!projectId || !recordId || !revisionLabel || !revisionDescription || !Number.isInteger(designFileId) || designFileId <= 0 || !designFileName) {
      return Response.json({ error: "Package Revision Label Narrative And Design File Are Required" }, { status: 400 });
    }
    const access = await db.select().from(vendorProjectAccess).where(and(eq(vendorProjectAccess.vendorId, vendor[0].id), eq(vendorProjectAccess.projectId, projectId))).limit(1);
    if (!access[0] || !parseStringArray(access[0].permissionsJson).includes("Design Upload")) return Response.json({ error: "Controlled Design Upload Access Is Required" }, { status: 403 });
    const rows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, recordId), eq(commandRecords.recordType, "Design Packages"))).limit(1);
    const record = rows[0];
    const data = record ? parseCorrespondenceData(record.dataJson) : {};
    if (!record || String(data.consultantVendorId || "") !== vendor[0].id) return Response.json({ error: "This Design Package Was Not Assigned To Your Company" }, { status: 403 });
    if (data.basisOfSaleLocked === true) return Response.json({ error: "The Awarded Sales Design Snapshot Is Immutable" }, { status: 423 });
    const versions = Array.isArray(data.versions) ? data.versions as Array<Record<string, unknown>> : [];
    if (versions.some((item) => String(item.label || "").toLowerCase() === revisionLabel.toLowerCase())) return Response.json({ error: "That Revision Label Already Exists In This Package" }, { status: 409 });
    const nowIso = now.toISOString();
    const nextVersion = {
      id: `REV-${crypto.randomUUID()}`,
      label: revisionLabel,
      description: revisionDescription,
      fileId: designFileId,
      fileName: designFileName,
      uploadedBy: `${vendor[0].contactName} · ${vendor[0].legalName}`,
      uploadedAt: nowIso,
      designerDecision: "Pending",
      isCurrent: false,
      isBasisOfSale: false,
      consultantUpload: true,
    };
    const timeline = Array.isArray(data.timeline) ? data.timeline as Array<Record<string, unknown>> : [];
    const nextData = { ...data, versions: [...versions, nextVersion], timeline: [...timeline, { action: "Consultant Revision Uploaded", actor: vendor[0].contactName, at: nowIso, detail: `${revisionLabel} · ${designFileName} · Pending Mefford review` }] };
    await updateCorrespondenceRecord({
      db,
      projectId,
      recordId,
      status: "Consultant Upload Received",
      data: nextData,
      actorName: vendor[0].contactName,
      actorEmail: session.email,
      oldStatus: record.status,
      summary: `Controlled consultant revision ${revisionLabel} uploaded for Mefford review`,
    });
    await db.insert(vendorAudits).values({ vendorId: vendor[0].id, actorName: vendor[0].contactName, actorEmail: session.email, action: "Design Revision Submitted", detail: `${projectId} · ${recordId} · ${revisionLabel}. File remains a working revision until designer approval and PM release.` });
    const project = await db.select().from(projects).where(eq(projects.number, projectId)).limit(1);
    const responsibleName = project[0]?.projectManager || record.owner;
    const pmMember = await db.select().from(companyMembers).where(eq(companyMembers.displayName, responsibleName)).limit(1);
    const recipientEmail = pmMember[0]?.email || "jmefford@meffcon.com";
    await ensureMyWorkTables();
    await db.insert(commandWorkItems).values({
      id: `DUI-${crypto.randomUUID()}`,
      dedupeKey: `design-upload:${projectId}:${recordId}:${nextVersion.id}:${recipientEmail}`,
      projectId,
      recipientName: responsibleName,
      recipientEmail,
      kind: "Design Upload",
      title: `${recordId} Consultant Revision ${revisionLabel} Received`,
      message: `${vendor[0].legalName} uploaded ${designFileName}. Review the permanent revision, then send the appropriate designer review before Current Set release.`,
      priority: "High",
      sourceType: "Design Packages",
      sourceRecordId: recordId,
      actionTarget: projectId === "MEFFORD-SALES" ? "Sales Design" : "Design & Drawings",
      dueAt: nowIso,
      createdBy: "Design Consultant Portal",
      updatedAt: nowIso,
    }).onConflictDoNothing({ target: commandWorkItems.dedupeKey });
    return Response.json({ saved: true, status: "Consultant Upload Received", notice: "Permanent Revision Received For Mefford Review. It Is Not The Official Current Set." }, { status: 201 });
  }

  if (input.action === "submit-design-review") {
    const projectId = input.projectId?.trim() || "";
    const recordId = input.recordId?.trim() || "";
    const reviewDecision = input.reviewDecision;
    const reviewComments = input.reviewComments?.trim() || "";
    if (!projectId || !recordId || !reviewDecision || !reviewComments || !validImpact(input.costImpact) || !validImpact(input.scheduleImpact)) {
      return Response.json({ error: "Decision Comments Cost Impact And Schedule Impact Are Required" }, { status: 400 });
    }
    const access = await db.select().from(vendorProjectAccess).where(and(eq(vendorProjectAccess.vendorId, vendor[0].id), eq(vendorProjectAccess.projectId, projectId))).limit(1);
    if (!access[0] || (!parseStringArray(access[0].sharedRecordsJson).includes("Design Packages") && !parseStringArray(access[0].permissionsJson).includes("Design Review"))) {
      return Response.json({ error: "Controlled Design Review Access Is Required" }, { status: 403 });
    }
    const rows = await db.select().from(commandRecords).where(and(
      eq(commandRecords.projectId, projectId),
      eq(commandRecords.id, recordId),
      eq(commandRecords.recordType, "Design Packages"),
    )).limit(1);
    const record = rows[0];
    const data = record ? parseCorrespondenceData(record.dataJson) : {};
    if (!record || String(data.consultantVendorId || "") !== vendor[0].id) return Response.json({ error: "This Design Package Was Not Assigned To Your Company" }, { status: 403 });
    if (record.status !== "Consultant Review") return Response.json({ error: "This Design Package Is Not Awaiting Your Review" }, { status: 409 });
    const versions = Array.isArray(data.versions) ? data.versions as Array<Record<string, unknown>> : [];
    const latest = versions.at(-1);
    if (!latest) return Response.json({ error: "The Design Revision Is Missing" }, { status: 409 });
    const project = await db.select().from(projects).where(eq(projects.number, projectId)).limit(1);
    const pmMember = await db.select().from(companyMembers).where(eq(companyMembers.displayName, project[0]?.projectManager || record.owner)).limit(1);
    const impact = await createCorrespondenceImpactActions({
      db,
      projectId,
      recordId,
      recordType: "Design Packages",
      title: record.title,
      projectManager: project[0]?.projectManager || record.owner,
      projectManagerEmail: pmMember[0]?.email || "jmefford@meffcon.com",
      costImpact: input.costImpact!,
      scheduleImpact: input.scheduleImpact!,
      actorName: vendor[0].contactName,
      actorEmail: session.email,
    });
    const nowIso = now.toISOString();
    const nextVersions = versions.map((version) => version.id === latest.id ? {
      ...version,
      designerDecision: reviewDecision,
      designerComments: reviewComments,
      designerName: vendor[0].contactName,
      designerCompany: vendor[0].legalName,
      designerReviewedAt: nowIso,
      costImpact: input.costImpact,
      scheduleImpact: input.scheduleImpact,
      reviewAttachment: input.attachmentStorageKey && input.attachmentName ? { storageKey: input.attachmentStorageKey, fileName: input.attachmentName } : null,
    } : version);
    const timeline = Array.isArray(data.timeline) ? data.timeline as Array<Record<string, unknown>> : [];
    const nextStatus = ["Approved", "Approved As Noted"].includes(reviewDecision) ? "Designer Approved" : "Revision Required";
    const nextData = {
      ...data,
      versions: nextVersions,
      latestDesignerDecision: reviewDecision,
      latestCostImpact: input.costImpact,
      latestScheduleImpact: input.scheduleImpact,
      ...impact,
      timeline: [...timeline, { action: "Designer Review Submitted", actor: vendor[0].contactName, at: nowIso, detail: `${reviewDecision} · Cost ${input.costImpact} · Schedule ${input.scheduleImpact}` }],
    };
    await updateCorrespondenceRecord({
      db, projectId, recordId, status: nextStatus, data: nextData,
      actorName: vendor[0].contactName, actorEmail: session.email,
      oldStatus: record.status, summary: `Designer disposition ${reviewDecision} recorded through controlled portal`,
    });
    if (nextStatus === "Designer Approved") {
      const teamRows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, "DESIGN-TEAM"), eq(commandRecords.recordType, "Design Team"))).limit(1);
      if (teamRows[0]) {
        const teamData = parseCorrespondenceData(teamRows[0].dataJson);
        const checklist = normalizeDesignChecklist(teamData.checklist).map((item) => item.id === "designer-approval" ? { ...item, completed: true, completedBy: vendor[0].contactName, completedAt: nowIso, note: `${recordId} · ${reviewDecision}` } : item);
        await db.update(commandRecords).set({ dataJson: JSON.stringify({ ...teamData, checklist }), updatedAt: nowIso }).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, "DESIGN-TEAM")));
      }
    }
    await db.insert(vendorAudits).values({
      vendorId: vendor[0].id,
      actorName: vendor[0].contactName,
      actorEmail: session.email,
      action: "Design Review Submitted",
      detail: `${recordId} · ${reviewDecision} · Cost ${input.costImpact} · Schedule ${input.scheduleImpact}. PM release remains required for Current Set status.`,
    });
    await ensureMyWorkTables();
    const recipientEmail = pmMember[0]?.email || "jmefford@meffcon.com";
    await db.insert(commandWorkItems).values({
      id: `DWI-${crypto.randomUUID()}`,
      dedupeKey: `design-review:${projectId}:${recordId}:${recipientEmail}:${String(latest.id || "latest")}`,
      projectId,
      recipientName: project[0]?.projectManager || record.owner,
      recipientEmail,
      kind: "Design Review",
      title: `${recordId} Designer Review · ${reviewDecision}`,
      message: nextStatus === "Designer Approved" ? "Designer approval is recorded. PM release is required before this revision becomes the official Current Set." : "The consultant returned this revision. Coordinate and upload a new revision before another review.",
      priority: nextStatus === "Designer Approved" ? "High" : "Critical",
      sourceType: "Design Packages",
      sourceRecordId: recordId,
      actionTarget: "Design & Drawings",
      dueAt: nowIso,
      createdBy: "Design Consultant Portal",
      updatedAt: nowIso,
    }).onConflictDoNothing({ target: commandWorkItems.dedupeKey });
    return Response.json({ saved: true, status: nextStatus, impact, notice: "Design Review Recorded. The Mefford PM Controls Current-Set Release." }, { status: 201 });
  }

  if (input.action === "submit-correspondence-response") {
    const projectId = input.projectId?.trim() || "";
    const recordId = input.recordId?.trim() || "";
    const responseText = input.responseText?.trim() || "";
    if (!projectId || !recordId || !responseText || !validImpact(input.costImpact) || !validImpact(input.scheduleImpact)) {
      return Response.json({ error: "Response Cost Impact And Schedule Impact Are Required" }, { status: 400 });
    }
    const access = await db.select().from(vendorProjectAccess).where(and(
      eq(vendorProjectAccess.vendorId, vendor[0].id),
      eq(vendorProjectAccess.projectId, projectId),
    )).limit(1);
    if (!access[0]) return Response.json({ error: "This Project Has Not Been Shared With Your Company" }, { status: 403 });
    const records = await db.select().from(commandRecords).where(and(
      eq(commandRecords.projectId, projectId),
      eq(commandRecords.id, recordId),
      or(eq(commandRecords.recordType, "RFIs"), eq(commandRecords.recordType, "Submittals")),
    )).limit(1);
    const record = records[0];
    const data = record ? parseCorrespondenceData(record.dataJson) : {};
    if (!record || String(data.vendorId || "") !== vendor[0].id) return Response.json({ error: "This Record Was Not Shared With Your Company" }, { status: 403 });
    const vendorResponseOpen = record.recordType === "RFIs" ? record.status === "Issued" : record.status === "Revise And Resubmit";
    if (!vendorResponseOpen) return Response.json({ error: "This Record Is Not Open For A Vendor Response" }, { status: 409 });
    if (record.recordType === "Submittals" && (!input.attachmentStorageKey || !input.attachmentName)) {
      return Response.json({ error: "Attach The Revised Submittal Package Before Submission" }, { status: 400 });
    }
    const responseStatus = record.recordType === "Submittals" ? "Resubmitted Package" : "Answered";
    const project = await db.select().from(projects).where(eq(projects.number, projectId)).limit(1);
    const pmMember = await db.select().from(companyMembers).where(eq(companyMembers.displayName, project[0]?.projectManager || record.owner)).limit(1);
    const impact = await createCorrespondenceImpactActions({
      db,
      projectId,
      recordId,
      recordType: record.recordType as "RFIs" | "Submittals",
      title: record.title,
      projectManager: project[0]?.projectManager || record.owner,
      projectManagerEmail: pmMember[0]?.email || "jmefford@meffcon.com",
      costImpact: input.costImpact!,
      scheduleImpact: input.scheduleImpact!,
      actorName: vendor[0].contactName,
      actorEmail: session.email,
    });
    const nowIso = now.toISOString();
    const timeline = Array.isArray(data.timeline) ? data.timeline as Array<Record<string, unknown>> : [];
    const nextStatus = record.recordType === "RFIs" ? "Response Received" : "PM Review";
    const nextData = {
      ...data,
      responseText,
      responseStatus,
      costImpact: input.costImpact,
      scheduleImpact: input.scheduleImpact,
      responseRecordedBy: vendor[0].contactName,
      responseReceivedAt: nowIso,
      vendorResponse: true,
      responseAttachment: input.attachmentStorageKey && input.attachmentName
        ? { storageKey: input.attachmentStorageKey, fileName: input.attachmentName }
        : null,
      ...impact,
      timeline: [...timeline, { action: "Vendor Response Received", actor: vendor[0].contactName, at: nowIso, detail: `${responseStatus} · Cost ${input.costImpact} · Schedule ${input.scheduleImpact}` }],
    };
    await updateCorrespondenceRecord({
      db, projectId, recordId, status: nextStatus, data: nextData,
      actorName: vendor[0].contactName, actorEmail: session.email,
      oldStatus: record.status, summary: "Controlled vendor response and mandatory impacts received",
    });
    await db.insert(vendorAudits).values({
      vendorId: vendor[0].id,
      actorName: vendor[0].contactName,
      actorEmail: session.email,
      action: `${record.recordType === "RFIs" ? "RFI" : "Submittal"} Response Submitted`,
      detail: `${recordId} · Cost ${input.costImpact} · Schedule ${input.scheduleImpact}. Formal distribution remains with the Mefford Project Manager.`,
    });
    await ensureMyWorkTables();
    await db.insert(commandWorkItems).values({
      id: `CWI-${crypto.randomUUID()}`,
      dedupeKey: `correspondence-response:${projectId}:${recordId}:${pmMember[0]?.email || "jmefford@meffcon.com"}`,
      projectId,
      recipientName: project[0]?.projectManager || record.owner,
      recipientEmail: pmMember[0]?.email || "jmefford@meffcon.com",
      kind: record.recordType,
      title: `${recordId} Response Ready For PM Distribution`,
      message: `${vendor[0].legalName} submitted the controlled response. Review both impacts before distribution and close.`,
      priority: input.costImpact === "Yes" || input.scheduleImpact === "Yes" ? "Critical" : "High",
      sourceType: record.recordType,
      sourceRecordId: recordId,
      actionTarget: record.recordType,
      dueAt: nowIso,
      createdBy: "Vendor Portal",
      updatedAt: nowIso,
    }).onConflictDoNothing({ target: commandWorkItems.dedupeKey });
    return Response.json({ saved: true, status: nextStatus, impact, notice: "Response Received For Mefford PM Review And Controlled Distribution." }, { status: 201 });
  }

  if (input.action === "submit-quality-proposal") {
    const projectId = input.projectId?.trim() || "";
    const access = await db.select().from(vendorProjectAccess).where(and(eq(vendorProjectAccess.vendorId, vendor[0].id), eq(vendorProjectAccess.projectId, projectId))).limit(1);
    if (!access[0] || !parseStringArray(access[0].permissionsJson).includes("Quality Proposal")) return Response.json({ error: "Controlled Quality Proposal Access Is Required" }, { status: 403 });
    const title = input.title?.trim() || "";
    const description = input.description?.trim() || "";
    const exactLocation = input.exactLocation?.trim() || "";
    const responsibleTrade = input.responsibleTrade?.trim() || "";
    const beforePhotoFileIds = validFileIds(input.beforePhotoFileIds);
    if (!title || !description || !exactLocation || !responsibleTrade || !input.inspectionStage || !beforePhotoFileIds.length) return Response.json({ error: "Title Description Exact Location Stage Responsible Trade And A Before Photo Are Required" }, { status: 400 });
    const project = await db.select().from(projects).where(eq(projects.number, projectId)).limit(1);
    if (!project[0]) return Response.json({ error: "Project Not Found" }, { status: 404 });
    const id = await nextPortalQualityId(db, projectId);
    const nowIso = now.toISOString();
    const data = { category: "Deficiency", description, exactLocation, inspectionStage: input.inspectionStage, responsibleTrade, responsibleVendorId: "", responsibleVendorName: "", reference: input.reference?.trim() || "", requiresDesignerAcceptance: false, designerVendorId: "", beforePhotoFileIds, afterPhotoFileIds: [], submittedBy: vendor[0].contactName, submittedByEmail: session.email, submittedVendorId: vendor[0].id, submittedVendorName: vendor[0].legalName, submittedAt: nowIso, formalizedBy: "", formalizedAt: "", pmAcceptance: null, designerAcceptance: null, superintendentVerification: null, timeline: [{ action: "Secure Portal Proposal Submitted", actor: `${vendor[0].contactName} · ${vendor[0].legalName}`, at: nowIso, detail: `${input.inspectionStage} · ${exactLocation}` }] };
    await db.insert(commandRecords).values({ projectId, id, recordType: QUALITY_ITEM_RECORD_TYPE, title, owner: project[0].projectManager, due: nowIso.slice(0, 10), status: "Proposed — PM Validation", meta: `${input.inspectionStage} · ${exactLocation} · Portal Proposal`, recordDate: nowIso.slice(0, 10), recordTime: nowIso.slice(11, 16), dateLocked: true, dataJson: JSON.stringify(data), updatedAt: nowIso });
    await db.insert(recordAudits).values({ projectId, recordId: id, fieldName: "Outside Quality Proposal", oldValue: "None", newValue: "Proposed — PM Validation", reason: "Secure portal submission", actorName: vendor[0].contactName, actorEmail: session.email, summary: `${id} proposed by ${vendor[0].legalName}; PM validation is required before assignment.` });
    await db.insert(vendorAudits).values({ vendorId: vendor[0].id, actorName: vendor[0].contactName, actorEmail: session.email, action: "Quality Proposal Submitted", detail: `${projectId} · ${id} · ${exactLocation}. No trade was formally assigned by the submission.` });
    await portalQualityWork(db, project[0], id, title, project[0].projectManager, "Quality proposal requires PM validation", nowIso);
    return Response.json({ saved: true, recordId: id, status: "Proposed — PM Validation", notice: "Quality Proposal Received. The Mefford PM Must Validate It Before Assignment." }, { status: 201 });
  }

  if (input.action === "submit-quality-correction") {
    const projectId = input.projectId?.trim() || "";
    const recordId = input.recordId?.trim() || "";
    const access = await db.select().from(vendorProjectAccess).where(and(eq(vendorProjectAccess.vendorId, vendor[0].id), eq(vendorProjectAccess.projectId, projectId))).limit(1);
    if (!access[0] || !parseStringArray(access[0].permissionsJson).includes("Quality Correction")) return Response.json({ error: "Controlled Quality Correction Access Is Required" }, { status: 403 });
    const rows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, recordId), eq(commandRecords.recordType, QUALITY_ITEM_RECORD_TYPE))).limit(1);
    const record = rows[0];
    const data = record ? parseQualityData(record.dataJson) : {};
    if (!record || String(data.responsibleVendorId || "") !== vendor[0].id) return Response.json({ error: "This Quality Item Was Not Assigned To Your Company" }, { status: 403 });
    if (!["Assigned — Acknowledgment Required", "Correction In Progress"].includes(record.status)) return Response.json({ error: "This Item Is Not Open For A Trade Correction Package" }, { status: 409 });
    const correctionDate = input.correctionDate?.trim() || "";
    const correctionNotes = input.correctionNotes?.trim() || "";
    const afterPhotoFileIds = validFileIds(input.afterPhotoFileIds);
    if (input.acknowledgment !== true || !/^\d{4}-\d{2}-\d{2}$/.test(correctionDate) || correctionDate > now.toISOString().slice(0, 10) || correctionNotes.length < 10 || !afterPhotoFileIds.length) return Response.json({ error: "Acknowledgment Completed Correction Date Detailed Notes And After Photos Are Required Before Verification" }, { status: 400 });
    const nowIso = now.toISOString();
    const nextData = { ...data, afterPhotoFileIds, tradeCorrection: { acknowledgment: true, acknowledgedBy: vendor[0].contactName, company: vendor[0].legalName, correctionDate, notes: correctionNotes, submittedAt: nowIso }, timeline: [...qualityTimeline(data.timeline), { action: "Trade Correction Submitted", actor: `${vendor[0].contactName} · ${vendor[0].legalName}`, at: nowIso, detail: `${correctionDate} · ${correctionNotes} · ${afterPhotoFileIds.length} after photo(s)` }] };
    const project = await db.select().from(projects).where(eq(projects.number, projectId)).limit(1);
    await db.update(commandRecords).set({ status: "Verification Requested", owner: project[0]?.superintendent || record.owner, meta: `${String(data.inspectionStage || "Quality")} · ${String(data.exactLocation || "")} · Superintendent Verification`, dataJson: JSON.stringify(nextData), updatedAt: nowIso }).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, recordId)));
    await db.insert(recordAudits).values({ projectId, recordId, fieldName: "Trade Correction", oldValue: record.status, newValue: "Verification Requested", reason: correctionNotes, actorName: vendor[0].contactName, actorEmail: session.email, summary: `${recordId} acknowledged and corrected by ${vendor[0].legalName} on ${correctionDate}; after evidence submitted for Superintendent verification.` });
    await db.insert(vendorAudits).values({ vendorId: vendor[0].id, actorName: vendor[0].contactName, actorEmail: session.email, action: "Quality Correction Submitted", detail: `${projectId} · ${recordId} · ${afterPhotoFileIds.length} after photo(s).` });
    if (project[0]) await portalQualityWork(db, project[0], recordId, record.title, project[0].superintendent, "Trade correction requires field verification", nowIso);
    return Response.json({ saved: true, status: "Verification Requested", notice: "Correction Package Submitted For Superintendent Verification." }, { status: 201 });
  }

  if (input.action === "submit-quality-designer-acceptance") {
    const projectId = input.projectId?.trim() || "";
    const recordId = input.recordId?.trim() || "";
    const access = await db.select().from(vendorProjectAccess).where(and(eq(vendorProjectAccess.vendorId, vendor[0].id), eq(vendorProjectAccess.projectId, projectId))).limit(1);
    if (!access[0] || !parseStringArray(access[0].permissionsJson).includes("Quality Designer Acceptance")) return Response.json({ error: "Controlled Designer Acceptance Access Is Required" }, { status: 403 });
    const rows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, recordId), eq(commandRecords.recordType, QUALITY_ITEM_RECORD_TYPE))).limit(1);
    const record = rows[0];
    const data = record ? parseQualityData(record.dataJson) : {};
    if (!record || String(data.designerVendorId || "") !== vendor[0].id) return Response.json({ error: "This Acceptance Was Not Assigned To Your Company" }, { status: 403 });
    if (record.status !== "Designer Acceptance Required" || !input.qualityDecision || (input.qualityDecision === "Reject" && (input.qualityComments?.trim() || "").length < 10)) return Response.json({ error: "This Item Requires A Designer Decision And Rejection Comments" }, { status: 409 });
    const nowIso = now.toISOString();
    const accepted = input.qualityDecision === "Accept";
    const comments = input.qualityComments?.trim() || "";
    const nextStatus = accepted ? "Closed" : "Correction In Progress";
    const nextData = { ...data, designerAcceptance: { decision: input.qualityDecision, comments, designer: vendor[0].contactName, company: vendor[0].legalName, at: nowIso }, closedAt: accepted ? nowIso : "", timeline: [...qualityTimeline(data.timeline), { action: accepted ? "Designer Accepted" : "Designer Returned", actor: `${vendor[0].contactName} · ${vendor[0].legalName}`, at: nowIso, detail: comments || "Design, specification, or commissioning acceptance recorded." }] };
    await db.update(commandRecords).set({ status: nextStatus, owner: accepted ? vendor[0].contactName : String(data.responsibleTrade || record.owner), meta: `${String(data.inspectionStage || "Quality")} · ${String(data.exactLocation || "")} · ${nextStatus}`, dataJson: JSON.stringify(nextData), updatedAt: nowIso }).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, recordId)));
    await db.insert(recordAudits).values({ projectId, recordId, fieldName: "Designer Acceptance", oldValue: record.status, newValue: nextStatus, reason: comments || "Designer acceptance", actorName: vendor[0].contactName, actorEmail: session.email, summary: `${recordId} · ${input.qualityDecision} by ${vendor[0].legalName}. ${accepted ? "All required closure gates are satisfied." : "Returned for another trade correction."}` });
    await db.insert(vendorAudits).values({ vendorId: vendor[0].id, actorName: vendor[0].contactName, actorEmail: session.email, action: `Quality ${input.qualityDecision}`, detail: `${projectId} · ${recordId} · ${nextStatus}.` });
    return Response.json({ saved: true, status: nextStatus, notice: accepted ? "Designer Acceptance Recorded. The Quality Item Is Closed." : "Designer Returned The Item For Another Correction." }, { status: 201 });
  }

  if (input.action === "submit-closeout-requirement") {
    const projectId = input.projectId?.trim() || "";
    const recordId = input.recordId?.trim() || "";
    const fileIds = Array.isArray(input.fileIds) ? input.fileIds.map(Number).filter((id) => Number.isInteger(id) && id > 0) : [];
    const access = await db.select().from(vendorProjectAccess).where(and(eq(vendorProjectAccess.vendorId, vendor[0].id), eq(vendorProjectAccess.projectId, projectId))).limit(1);
    if (!access[0] || !parseStringArray(access[0].permissionsJson).includes("Closeout Submission")) return Response.json({ error: "Controlled Closeout Portal Access Is Required" }, { status: 403 });
    const requirement = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, recordId), eq(commandRecords.recordType, CLOSEOUT_REQUIREMENT_TYPE))).limit(1);
    const row = requirement[0];
    const data = row ? parseCloseoutData(row.dataJson) : {};
    if (!row || String(data.vendorId || "") !== vendor[0].id) return Response.json({ error: "This Closeout Requirement Was Not Assigned To Your Company" }, { status: 403 });
    if (["Approved", "Not Applicable"].includes(row.status)) return Response.json({ error: "This Closeout Requirement Is Already Complete" }, { status: 409 });
    if (!fileIds.length) return Response.json({ error: "At Least One Permanent Supporting File Is Required" }, { status: 400 });
    const files = await db.select().from(projectFiles).where(inArray(projectFiles.id, fileIds));
    if (files.length !== fileIds.length || files.some((file) => file.projectId !== projectId || !file.category.startsWith("Closeout"))) return Response.json({ error: "A Closeout File Is Missing Or Outside This Project" }, { status: 403 });
    const nowIso = now.toISOString();
    const versions = Array.isArray(data.fileVersions) ? data.fileVersions as Array<Record<string, unknown>> : [];
    const approvals = Array.isArray(data.approvals) ? data.approvals as Array<Record<string, unknown>> : [];
    const vendorApproval = { role: "Subcontractor", decision: "Approved", actor: `${vendor[0].contactName} · ${vendor[0].legalName}`, email: session.email, at: nowIso, comments: input.notes?.trim() || "Submitted through verified vendor portal" };
    const nextApprovals = [...approvals.filter((item) => String(item.role || "") !== "Subcontractor"), vendorApproval];
    const remaining = nextApproval(data.approvalFlow, nextApprovals);
    const nextData = {
      ...data,
      approvals: nextApprovals,
      fileVersions: [...versions, ...files.map((file, index) => ({ fileId: file.id, fileName: file.name, uploadedBy: vendorApproval.actor, uploadedAt: nowIso, version: versions.length + index + 1, supersedes: versions.at(-1)?.fileId || null, vendorPortal: true }))],
      submittedBy: vendorApproval.actor,
      submittedAt: nowIso,
      notes: input.notes?.trim() || "",
      timeline: [...(Array.isArray(data.timeline) ? data.timeline as Array<Record<string, unknown>> : []), { action: "Subcontractor Portal Submission", actor: vendorApproval.actor, at: nowIso, detail: `${files.length} permanent file(s); ${remaining} review is next.` }],
    };
    await db.update(commandRecords).set({ status: "Under Review", owner: remaining, meta: `${String(data.category || "Closeout")} · Vendor Submitted · ${remaining} Next`, dataJson: JSON.stringify(nextData), updatedAt: nowIso }).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, recordId)));
    await db.insert(recordAudits).values({ projectId, recordId, fieldName: "Subcontractor Portal Submission", oldValue: row.status, newValue: "Under Review", reason: `${remaining} review required`, actorName: String(vendorApproval.actor), actorEmail: session.email, summary: `${recordId} · ${vendor[0].legalName} submitted ${files.length} permanent closeout file(s); no approval or payment occurred automatically.` });
    await db.insert(vendorAudits).values({ vendorId: vendor[0].id, actorName: vendor[0].contactName, actorEmail: session.email, action: "Closeout Requirement Submitted", detail: `${projectId} · ${recordId} · ${files.length} file(s) · ${remaining} next.` });
    const project = (await db.select().from(projects).where(eq(projects.number, projectId)).limit(1))[0];
    if (project) {
      const recipientName = remaining === "Accountant"
        ? (await db.select().from(companyMembers)).find((member) => { const roles = parseStringArray(member.designationsJson); return roles.includes("Accountant") || roles.includes("Office Staff"); })?.displayName || project.projectManager
        : project.projectManager;
      const recipient = (await db.select().from(companyMembers).where(eq(companyMembers.displayName, recipientName)).limit(1))[0];
      if (recipient) await upsertWorkItem(db, { dedupeKey: `closeout:${projectId}:${recordId}:${recipient.email}`, projectId, recipientName: recipient.displayName, recipientEmail: recipient.email, kind: "Closeout Approval", title: row.title, message: `${vendor[0].legalName} submitted ${recordId}. Open the requirement to review files and every remaining approval gate.`, priority: data.critical === true ? "High" : "Normal", sourceType: "Closeout", sourceRecordId: recordId, actionTarget: "Closeout", dueAt: `${row.due}T17:00:00-04:00`, createdBy: "Vendor Closeout Portal" });
    }
    const { reconcileProjectHealthAfterUpdate } = await import("../project-health/route");
    await reconcileProjectHealthAfterUpdate(projectId, { name: vendor[0].contactName, email: session.email });
    return Response.json({ saved: true, status: "Under Review", nextApproval: remaining, notice: `Closeout Requirement Submitted For ${remaining} Review. Nothing Was Approved Or Paid Automatically.` }, { status: 201 });
  }

  if (input.action === "submit-owner-warranty-request") {
    const projectId = input.projectId?.trim() || "";
    const access = (await db.select().from(vendorProjectAccess).where(and(eq(vendorProjectAccess.vendorId, vendor[0].id), eq(vendorProjectAccess.projectId, projectId))).limit(1))[0];
    const permissions = access ? parseStringArray(access.permissionsJson) : [];
    if (!access || !permissions.includes("Owner Closeout Read Only") || !permissions.includes("Warranty Request")) return Response.json({ error: "Permanent Owner Warranty Access Is Required" }, { status: 403 });
    const title = input.title?.trim() || "";
    const description = input.description?.trim() || "";
    const exactLocation = input.exactLocation?.trim() || "";
    if (title.length < 4 || description.length < 10 || exactLocation.length < 3) return Response.json({ error: "A Specific Title Description And Exact Location Are Required" }, { status: 400 });
    const project = (await db.select().from(projects).where(eq(projects.number, projectId)).limit(1))[0];
    if (!project) return Response.json({ error: "Project Not Found" }, { status: 404 });
    const id = `WR-${crypto.randomUUID()}`;
    const urgent = input.urgency === "Urgent";
    const due = new Date(now.getTime() + (urgent ? 1 : 7) * 86_400_000).toISOString().slice(0, 10);
    const data = { description, location: exactLocation, urgency: urgent ? "Urgent" : "Normal", ownerName: vendor[0].legalName, ownerContact: vendor[0].contactName, ownerEmail: session.email, source: "Permanent Owner Closeout Portal", timeline: [{ action: "Owner Warranty Request Received", actor: `${vendor[0].contactName} · ${vendor[0].legalName}`, at: now.toISOString(), detail: description }] };
    await db.insert(commandRecords).values({ projectId, id, recordType: CLOSEOUT_WARRANTY_TYPE, title, owner: project.projectManager, due, status: "Open", meta: `${data.urgency} · ${exactLocation} · Routed Through Mefford`, recordDate: now.toISOString().slice(0, 10), recordTime: now.toISOString().slice(11, 16), dateLocked: true, dataJson: JSON.stringify(data), updatedAt: now.toISOString() });
    await db.insert(recordAudits).values({ projectId, recordId: id, fieldName: "Owner Warranty Request", oldValue: "None", newValue: "Open", reason: description, actorName: vendor[0].contactName, actorEmail: session.email, summary: `${id} · Owner request routed to Mefford; no subcontractor was contacted automatically.` });
    await db.insert(vendorAudits).values({ vendorId: vendor[0].id, actorName: vendor[0].contactName, actorEmail: session.email, action: "Owner Warranty Request Submitted", detail: `${projectId} · ${id} · ${exactLocation} · Routed to ${project.projectManager}.` });
    const recipient = (await db.select().from(companyMembers).where(eq(companyMembers.displayName, project.projectManager)).limit(1))[0];
    if (recipient) await upsertWorkItem(db, { dedupeKey: `warranty:${projectId}:${id}:${recipient.email}`, projectId, recipientName: recipient.displayName, recipientEmail: recipient.email, kind: "Warranty", title, message: `${vendor[0].contactName} submitted an Owner warranty request at ${exactLocation}. Review and route through Mefford before contacting the responsible trade.`, priority: urgent ? "Critical" : "High", sourceType: "Closeout Warranty", sourceRecordId: id, actionTarget: "Closeout", dueAt: `${due}T17:00:00-04:00`, createdBy: "Owner Closeout Portal" });
    return Response.json({ saved: true, recordId: id, status: "Open", notice: "Warranty Request Routed To Mefford With Permanent History." }, { status: 201 });
  }

  if (input.action === "sign-lien-waiver") {
    const projectId = input.projectId?.trim() || "";
    const recordId = input.recordId?.trim() || "";
    const access = (await db.select().from(vendorProjectAccess).where(and(eq(vendorProjectAccess.vendorId, vendor[0].id), eq(vendorProjectAccess.projectId, projectId))).limit(1))[0];
    if (!access) return Response.json({ error: "This Project Has Not Been Shared With Your Company" }, { status: 403 });
    const row = (await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, recordId), eq(commandRecords.recordType, LIEN_WAIVER_RECORD_TYPE))).limit(1))[0];
    const data = parseObject(row?.dataJson || "{}");
    if (!row || String(data.vendorId || "") !== vendor[0].id) return Response.json({ error: "This Lien Waiver Was Not Assigned To Your Company" }, { status: 403 });
    if (row.status !== "Requested" || !isLienWaiverType(data.formType)) return Response.json({ error: "This Controlled Waiver Is Not Open For Signature" }, { status: 409 });
    if (!isConditionalWaiver(data.formType) && !canIssueUnconditionalWaiver({ clearedPaymentAt: String(data.clearedPaymentAt || ""), clearedPaymentReference: String(data.clearedPaymentReference || "") })) return Response.json({ error: "Unconditional Waiver Blocked Until Mefford Accounting Records Cleared Payment" }, { status: 409 });
    if (!input.signerName?.trim() || !input.signerTitle?.trim() || !validSignatureImage(input.signatureImage) || input.signatureConsent !== true) return Response.json({ error: "Drawn Signature Authorized Signer Name Title And Electronic-Signature Consent Are Required" }, { status: 400 });
    const signedAt = now.toISOString();
    const nextData = { ...data, signature: { signerName: input.signerName.trim(), signerTitle: input.signerTitle.trim(), signatureImage: input.signatureImage, signerEmail: session.email, consent: true, signedAt, recordedBy: `${vendor[0].contactName} · Secure Vendor Portal`, deviceRecord: "Audited One-Time-Code Vendor Session" } };
    await db.update(commandRecords).set({ status: "Signed — Accounting Review", dataJson: JSON.stringify(nextData), updatedAt: signedAt }).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, recordId)));
    await db.insert(recordAudits).values({ projectId, recordId, fieldName: "Secure Vendor Signature", oldValue: row.status, newValue: "Signed — Accounting Review", reason: "Authorized vendor electronic signature", actorName: input.signerName.trim(), actorEmail: session.email, summary: `${input.signerName.trim()} signed ${row.title} through the audited secure vendor portal. Accounting approval remains required.` });
    await db.insert(vendorAudits).values({ vendorId: vendor[0].id, actorName: input.signerName.trim(), actorEmail: session.email, action: "Lien Waiver Signed", detail: `${projectId} · ${recordId} · Routed to Mefford Accounting review.` });
    return Response.json({ saved: true, status: "Signed — Accounting Review", notice: "Signature Recorded. Mefford Accounting Review Is Still Required." });
  }

  if (input.action === "submit-billing") {
    const projectId = input.projectId?.trim() || "";
    const submissionType = input.submissionType;
    const access = await db.select().from(vendorProjectAccess).where(
      and(eq(vendorProjectAccess.vendorId, vendor[0].id), eq(vendorProjectAccess.projectId, projectId)),
    ).limit(1);
    if (!access[0]) return Response.json({ error: "This Project Has Not Been Shared With Your Company" }, { status: 403 });
    const permissions = parseStringArray(access[0].permissionsJson);
    if (!submissionType || !permissions.includes(submissionType)) {
      return Response.json({ error: "This Billing Type Is Not Enabled For The Project" }, { status: 403 });
    }
    const amount = roundMoney(input.amount || 0);
    const reference = String(submissionType === "Invoice" ? input.invoiceNumber : input.applicationNumber).trim();
    if (!reference || !input.periodEnd || !Number.isFinite(amount) || amount <= 0 || !input.attachmentStorageKey || !input.attachmentName) {
      return Response.json({ error: "Reference Period Amount And Supporting File Are Required" }, { status: 400 });
    }
    if (submissionType === "AIA Pay Application") {
      const scheduledValue = Number(input.scheduledValue || 0);
      const approvedChangeOrders = Number(input.approvedChangeOrders || 0);
      const earnedToDate = Number(input.workCompleted || 0) + Number(input.storedMaterials || 0) + approvedChangeOrders;
      if (scheduledValue <= 0 || earnedToDate > scheduledValue + approvedChangeOrders + 0.01) {
        return Response.json({ error: "AIA Work And Stored Materials Cannot Exceed The Scheduled Value Plus Approved Change Orders" }, { status: 400 });
      }
      const expected = aiaCurrentPayment(input);
      if (Math.abs(expected - amount) > 0.01) {
        return Response.json({ error: `Current Payment Due Must Equal ${expected.toFixed(2)} From The AIA Calculation` }, { status: 400 });
      }
    }
    const existing = await db.select().from(vendorSubmissions).where(
      and(eq(vendorSubmissions.vendorId, vendor[0].id), eq(vendorSubmissions.projectId, projectId)),
    );
    if (existing.some((item) => {
      const payload = parseObject(item.payloadJson);
      return String(payload.invoiceNumber || payload.applicationNumber || "").toLowerCase() === reference.toLowerCase();
    })) return Response.json({ error: "That Invoice Or Application Number Already Exists" }, { status: 409 });

    const compliance = await complianceState(db, vendor[0].id, projectId);
    const qualityAndCloseout = await finalCloseoutState(db, vendor[0].id, projectId);
    const closeout = input.finalApplication ? qualityAndCloseout : { blocked: false, missing: [] as string[], openQualityItems: qualityAndCloseout.openQualityItems };
    const previousTotal = existing
      .filter((item) => !["Returned To Vendor", "Rejected"].includes(item.status))
      .reduce((sum, item) => sum + Number(item.amount), 0);
    const commitmentExceeded = Number(access[0].committedAmount) > 0 && previousTotal + amount > Number(access[0].committedAmount) + 0.01;
    const status = closeout.blocked
      ? "Closeout Blocked"
      : commitmentExceeded
        ? "Commitment Review"
        : "Submitted";
    const id = `VS-${crypto.randomUUID()}`;
    const payload = {
      invoiceNumber: submissionType === "Invoice" ? reference : "",
      applicationNumber: submissionType === "AIA Pay Application" ? reference : "",
      description: input.description?.trim() || "",
      finalApplication: input.finalApplication === true,
      scheduledValue: roundMoney(input.scheduledValue || 0),
      previousPayments: roundMoney(input.previousPayments || 0),
      workCompleted: roundMoney(input.workCompleted || 0),
      storedMaterials: roundMoney(input.storedMaterials || 0),
      approvedChangeOrders: roundMoney(input.approvedChangeOrders || 0),
      retainagePercent: Number(input.retainagePercent || 0),
      currentPaymentDue: amount,
      closeoutMissing: closeout.missing,
      commitmentExceeded,
      openQualityItems: closeout.openQualityItems,
      qualityWarning: closeout.openQualityItems.length > 0,
    };
    await db.insert(vendorSubmissions).values({
      id,
      vendorId: vendor[0].id,
      projectId,
      submissionType,
      title: `${submissionType} ${reference}`,
      amount: moneyDecimal(amount),
      periodEnd: input.periodEnd,
      status,
      payloadJson: JSON.stringify(payload),
      attachmentStorageKey: input.attachmentStorageKey,
      attachmentName: input.attachmentName,
      complianceSnapshotJson: JSON.stringify({
        blocked: compliance.blocked,
        missing: compliance.missing,
        expired: compliance.expired,
        overrideId: compliance.activeOverride?.id || "",
        capturedAt: now.toISOString(),
      }),
    });
    const waiverId = await ensureConditionalWaiverForBilling(db, {
      projectId,
      vendorId: vendor[0].id,
      vendorName: vendor[0].legalName,
      vendorEmail: vendor[0].contactEmail,
      commitmentReference: access[0].contractReference || `${access[0].trade || "Project"} Commitment`,
      payApplicationReference: `${submissionType} ${reference}`,
      linkedSubmissionId: id,
      amount,
      retainage: submissionType === "AIA Pay Application"
        ? (Number(payload.workCompleted || 0) + Number(payload.storedMaterials || 0) + Number(payload.approvedChangeOrders || 0)) * Number(payload.retainagePercent || 0) / 100
        : 0,
      throughDate: input.periodEnd,
      finalApplication: input.finalApplication === true,
      createdBy: vendor[0].contactName,
      actorEmail: session.email,
    });
    await db.insert(vendorAudits).values({
      vendorId: vendor[0].id,
      submissionId: id,
      actorName: vendor[0].contactName,
      actorEmail: session.email,
      action: `${submissionType} Submitted`,
      detail: `${reference} · $${amount.toFixed(2)} · ${status}. Intake does not approve, post, or pay the submission.`,
    });
    await createSubmissionWork(db, vendor[0], access[0], id, status, amount, now);
    return Response.json({
      saved: true,
      submissionId: id,
      waiverId,
      status,
      hardBlock: closeout.blocked,
      paymentHold: compliance.paymentBlocked,
      blockers: [...compliance.missing, ...compliance.expired, ...closeout.missing],
      notice: status === "Submitted"
        ? closeout.openQualityItems.length
          ? `Submitted For Mefford Review With ${closeout.openQualityItems.length} Open Quality Item Warning. Nothing Was Approved Posted Or Paid Automatically.`
          : "Submitted For Mefford Review. Nothing Was Approved Posted Or Paid Automatically."
        : `Received Into Controlled Intake With ${status}. Review remains active; only final payment is held by unresolved requirements.`,
    }, { status: 201 });
  }

  return Response.json({ error: "A Valid Portal Action Is Required" }, { status: 400 });
}

async function portalPayload(
  db: ReturnType<(typeof import("../../../db"))["getDb"]>,
  vendor: typeof vendorProfiles.$inferSelect,
  invite: typeof vendorInvites.$inferSelect,
) {
  const ownerPortal = vendor.vendorType === "Project Owner";
  const [access, documents, submissions, compliance] = await Promise.all([
    db.select().from(vendorProjectAccess).where(eq(vendorProjectAccess.vendorId, vendor.id)).orderBy(vendorProjectAccess.projectId),
    db.select().from(vendorComplianceDocuments).where(eq(vendorComplianceDocuments.vendorId, vendor.id)).orderBy(desc(vendorComplianceDocuments.createdAt)),
    db.select().from(vendorSubmissions).where(eq(vendorSubmissions.vendorId, vendor.id)).orderBy(desc(vendorSubmissions.submittedAt)),
    complianceState(db, vendor.id),
  ]);
  const sharedProjectIds = access.map((item) => item.projectId);
  const correspondence = sharedProjectIds.length
    ? await db.select().from(commandRecords).where(and(
        inArray(commandRecords.projectId, sharedProjectIds),
        or(eq(commandRecords.recordType, "RFIs"), eq(commandRecords.recordType, "Submittals")),
      )).orderBy(desc(commandRecords.updatedAt))
    : [];
  const designProjectIds = access.filter((item) => parseStringArray(item.sharedRecordsJson).includes("Design Packages") || parseStringArray(item.permissionsJson).includes("Design Review")).map((item) => item.projectId);
  const designRows = designProjectIds.length
    ? await db.select().from(commandRecords).where(and(inArray(commandRecords.projectId, designProjectIds), eq(commandRecords.recordType, "Design Packages"))).orderBy(desc(commandRecords.updatedAt))
    : [];
  const qualityRows = sharedProjectIds.length
    ? await db.select().from(commandRecords).where(and(inArray(commandRecords.projectId, sharedProjectIds), eq(commandRecords.recordType, QUALITY_ITEM_RECORD_TYPE))).orderBy(desc(commandRecords.updatedAt))
    : [];
  const closeoutRows = sharedProjectIds.length
    ? await db.select().from(commandRecords).where(and(inArray(commandRecords.projectId, sharedProjectIds), eq(commandRecords.recordType, CLOSEOUT_REQUIREMENT_TYPE))).orderBy(desc(commandRecords.updatedAt))
    : [];
  const lienWaiverRows = sharedProjectIds.length
    ? await db.select().from(commandRecords).where(and(inArray(commandRecords.projectId, sharedProjectIds), eq(commandRecords.recordType, LIEN_WAIVER_RECORD_TYPE))).orderBy(desc(commandRecords.updatedAt))
    : [];
  return Response.json({
    verified: true,
    invite: { id: invite.id, email: invite.email, sessionExpiresAt: invite.sessionExpiresAt },
    vendor: {
      id: vendor.id,
      legalName: vendor.legalName,
      dbaName: vendor.dbaName,
      vendorType: vendor.vendorType,
      status: vendor.status,
      contactName: vendor.contactName,
      contactEmail: vendor.contactEmail,
      contactPhone: vendor.contactPhone,
      address: parseObject(vendor.addressJson),
      trades: parseStringArray(vendor.tradesJson),
      serviceAreas: parseStringArray(vendor.serviceAreasJson),
    },
    compliance: {
      blocked: ownerPortal ? false : compliance.blocked,
      paymentBlocked: ownerPortal ? false : compliance.paymentBlocked,
      projectBlocked: false,
      missing: ownerPortal ? [] : compliance.missing,
      expired: ownerPortal ? [] : compliance.expired,
      activeOverride: compliance.activeOverride
        ? { reason: compliance.activeOverride.reason, expiresAt: compliance.activeOverride.expiresAt }
        : null,
    },
    documents: documents.map((document) => ({
      id: document.id,
      vendorId: document.vendorId,
      kind: document.kind,
      effectiveDate: document.effectiveDate,
      expirationDate: document.expirationDate,
      status: document.status,
      fileName: document.fileName,
      contentType: document.contentType,
      sizeBytes: document.sizeBytes,
      reviewedBy: document.reviewedBy,
      reviewedAt: document.reviewedAt,
      reviewNote: document.reviewNote,
      createdAt: document.createdAt,
    })),
    projectAccess: access.map((item) => ({
      ...item,
      permissions: parseStringArray(item.permissionsJson),
      sharedRecords: parseStringArray(item.sharedRecordsJson),
      openQualityItems: qualityRows.filter((record) => record.status !== "Closed" && String(parseQualityData(record.dataJson).responsibleVendorId || "") === vendor.id && record.projectId === item.projectId).length,
    })),
    correspondence: correspondence.flatMap((record) => {
      const data = parseCorrespondenceData(record.dataJson);
      const vendorResponseOpen = record.recordType === "RFIs" ? record.status === "Issued" : record.status === "Revise And Resubmit";
      if (String(data.vendorId || "") !== vendor.id || !vendorResponseOpen) return [];
      return [{
        id: record.id,
        projectId: record.projectId,
        recordType: record.recordType,
        title: record.title,
        status: record.status,
        due: record.due,
        details: String(data.details || ""),
        specificationReference: String(data.specificationReference || ""),
        drawingReference: String(data.drawingReference || ""),
        scheduleReference: String(data.scheduleReference || ""),
      }];
    }),
    designReviews: designRows.flatMap((record) => {
      const data = parseCorrespondenceData(record.dataJson);
      if (record.status !== "Consultant Review" || String(data.consultantVendorId || "") !== vendor.id) return [];
      const versions = Array.isArray(data.versions) ? data.versions as Array<Record<string, unknown>> : [];
      const latest = versions.at(-1);
      if (!latest) return [];
      return [{
        id: record.id,
        projectId: record.projectId,
        title: record.title,
        discipline: String(data.discipline || "Design"),
        phase: String(data.phase || ""),
        due: String(data.reviewDue || record.due),
        instructions: String(data.reviewInstructions || ""),
        revision: {
          id: String(latest.id || ""),
          label: String(latest.label || "Latest Revision"),
          fileId: Number(latest.fileId || 0),
          fileName: String(latest.fileName || "Design File"),
          description: String(latest.description || ""),
        },
      }];
    }),
    designUploads: designRows.flatMap((record) => {
      const data = parseCorrespondenceData(record.dataJson);
      if (String(data.consultantVendorId || "") !== vendor.id || data.basisOfSaleLocked === true) return [];
      const accessRow = access.find((item) => item.projectId === record.projectId);
      if (!accessRow || !parseStringArray(accessRow.permissionsJson).includes("Design Upload")) return [];
      const versions = Array.isArray(data.versions) ? data.versions as Array<Record<string, unknown>> : [];
      const latest = versions.at(-1);
      return [{
        id: record.id,
        projectId: record.projectId,
        title: record.title,
        discipline: String(data.discipline || "Design"),
        phase: String(data.phase || ""),
        status: record.status,
        latestRevision: latest ? String(latest.label || "") : "No Revision Yet",
      }];
    }),
    qualityItems: qualityRows.flatMap((record) => {
      const data = parseQualityData(record.dataJson);
      const accessRow = access.find((item) => item.projectId === record.projectId);
      if (!accessRow) return [];
      const permissions = parseStringArray(accessRow.permissionsJson);
      const isSubmitter = String(data.submittedVendorId || "") === vendor.id;
      const isResponsible = String(data.responsibleVendorId || "") === vendor.id && permissions.includes("Quality Correction");
      const isDesigner = String(data.designerVendorId || "") === vendor.id && permissions.includes("Quality Designer Acceptance");
      if (!isSubmitter && !isResponsible && !isDesigner) return [];
      return [{
        id: record.id,
        projectId: record.projectId,
        title: record.title,
        status: record.status,
        due: record.due,
        description: String(data.description || ""),
        exactLocation: String(data.exactLocation || ""),
        inspectionStage: String(data.inspectionStage || "Quality"),
        responsibleTrade: String(data.responsibleTrade || ""),
        reference: String(data.reference || ""),
        beforePhotoFileIds: validFileIds(data.beforePhotoFileIds),
        afterPhotoFileIds: validFileIds(data.afterPhotoFileIds),
        canCorrect: isResponsible && ["Assigned — Acknowledgment Required", "Correction In Progress"].includes(record.status),
        canDesignerAccept: isDesigner && record.status === "Designer Acceptance Required",
        proposalOnly: isSubmitter && !isResponsible && !isDesigner,
      }];
    }),
    closeoutRequirements: closeoutRows.flatMap((record) => {
      const data = parseCloseoutData(record.dataJson);
      const accessRow = access.find((item) => item.projectId === record.projectId);
      const permissions = accessRow ? parseStringArray(accessRow.permissionsJson) : [];
      const ownerReadOnly = permissions.includes("Owner Closeout Read Only");
      if (!accessRow || (!ownerReadOnly && (!permissions.includes("Closeout Submission") || String(data.vendorId || "") !== vendor.id))) return [];
      const approvals = Array.isArray(data.approvals) ? data.approvals as Array<Record<string, unknown>> : [];
      const files = Array.isArray(data.fileVersions) ? data.fileVersions as Array<Record<string, unknown>> : [];
      return [{
        id: record.id,
        projectId: record.projectId,
        title: record.title,
        category: String(data.category || "Closeout"),
        status: record.status,
        due: record.due,
        instructions: String(data.instructions || ""),
        critical: data.critical === true,
        nextApproval: nextApproval(data.approvalFlow, approvals),
        submittedFiles: files.map((file) => ({ fileId: Number(file.fileId || 0), fileName: String(file.fileName || ""), uploadedAt: String(file.uploadedAt || "") })),
        ownerReadOnly,
      }];
    }),
    lienWaivers: lienWaiverRows.flatMap((record) => {
      const data = parseObject(record.dataJson);
      const formType = String(data.formType || "");
      if (String(data.vendorId || "") !== vendor.id) return [];
      return [{
        id: record.id,
        projectId: record.projectId,
        title: record.title,
        status: record.status,
        formType,
        amount: Number(data.amount || 0),
        throughDate: String(data.throughDate || ""),
        commitmentReference: String(data.commitmentReference || ""),
        payApplicationReference: String(data.payApplicationReference || ""),
        exceptions: String(data.exceptions || "None"),
        canSign: record.status === "Requested" && isLienWaiverType(formType) && (isConditionalWaiver(formType) || canIssueUnconditionalWaiver({ clearedPaymentAt: String(data.clearedPaymentAt || ""), clearedPaymentReference: String(data.clearedPaymentReference || "") })),
      }];
    }),
    submissions: submissions.map((item) => ({ ...item, attachmentStorageKey: "", payload: parseObject(item.payloadJson) })),
  });
}

async function createSubmissionWork(
  db: ReturnType<(typeof import("../../../db"))["getDb"]>,
  vendor: typeof vendorProfiles.$inferSelect,
  access: typeof vendorProjectAccess.$inferSelect,
  submissionId: string,
  status: string,
  amount: number,
  now: Date,
) {
  await ensureMyWorkTables();
  const project = await db.select().from(projects).where(eq(projects.number, access.projectId)).limit(1);
  const members = await db.select().from(companyMembers).where(eq(companyMembers.isActive, true));
  const recipients = members.filter((member) => {
    const designations = parseStringArray(member.designationsJson);
    return member.displayName === project[0]?.projectManager ||
      ["Company Owner", "Administrator"].includes(member.companyAccessLevel) ||
      designations.some((item) => ["Accountant", "Financial Administrator"].includes(item));
  });
  for (const recipient of recipients) {
    const dedupeKey = `vendor-submission:${submissionId}:${recipient.email}`;
    await db.insert(commandWorkItems).values({
      id: `VWI-${crypto.randomUUID()}`,
      dedupeKey,
      projectId: access.projectId,
      recipientName: recipient.displayName,
      recipientEmail: recipient.email,
      kind: "Vendor Billing",
      title: `${vendor.legalName} Submitted Billing`,
      message: `$${amount.toFixed(2)} · ${status}. Review in Vendor Management before AP handoff.`,
      priority: status === "Submitted" ? "High" : "Critical",
      sourceType: "Vendor Submission",
      sourceRecordId: submissionId,
      actionTarget: "Vendor Management",
      dueAt: now.toISOString(),
      createdBy: "Vendor Portal",
      updatedAt: now.toISOString(),
    }).onConflictDoNothing({ target: commandWorkItems.dedupeKey });
  }
}

async function nextPortalQualityId(db: ReturnType<(typeof import("../../../db"))["getDb"]>, projectId: string) {
  const rows = await db.select({ id: commandRecords.id }).from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, QUALITY_ITEM_RECORD_TYPE)));
  const largest = rows.reduce((max, row) => Math.max(max, Number(row.id.match(/(\d+)$/)?.[1] || 0)), 0);
  return `QI-${String(largest + 1).padStart(4, "0")}`;
}

async function portalQualityWork(db: ReturnType<(typeof import("../../../db"))["getDb"]>, project: typeof projects.$inferSelect, recordId: string, title: string, recipientName: string, message: string, now: string) {
  await ensureMyWorkTables();
  const member = await db.select().from(companyMembers).where(eq(companyMembers.displayName, recipientName)).limit(1);
  if (!member[0]) return;
  await db.insert(commandWorkItems).values({ id: `QPW-${crypto.randomUUID()}`, dedupeKey: `portal-quality:${project.number}:${recordId}:${member[0].email}:${message}`, projectId: project.number, recipientName, recipientEmail: member[0].email, kind: "Quality", title: `${recordId} · ${title}`, message, priority: "High", sourceType: QUALITY_ITEM_RECORD_TYPE, sourceRecordId: recordId, actionTarget: "Quality", dueAt: now, createdBy: "Secure Quality Portal", updatedAt: now }).onConflictDoNothing({ target: commandWorkItems.dedupeKey });
}

function qualityTimeline(value: unknown) { return Array.isArray(value) ? value as Array<Record<string, unknown>> : []; }
function validFileIds(value: unknown) { return Array.isArray(value) ? value.map(Number).filter((id) => Number.isInteger(id) && id > 0) : []; }

function aiaCurrentPayment(input: PortalInput) {
  const grossEarned = Number(input.workCompleted || 0) + Number(input.storedMaterials || 0) + Number(input.approvedChangeOrders || 0);
  const retainage = grossEarned * Math.max(0, Number(input.retainagePercent || 0)) / 100;
  return Math.max(0, Math.round((grossEarned - retainage - Number(input.previousPayments || 0)) * 100) / 100);
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function maskEmail(value: string) {
  const [name, domain] = value.split("@");
  return `${name.slice(0, 2)}${"•".repeat(Math.max(2, name.length - 2))}@${domain}`;
}

function validImpact(value: unknown): value is ImpactAnswer {
  return value === "No" || value === "Yes" || value === "Unknown";
}

function validSignatureImage(value: unknown) {
  return typeof value === "string" && value.length < 250_000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value);
}
