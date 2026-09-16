import { canReadProjectId, projectDesignationsFor } from "../../../lib/project-access";
import { and, eq } from "drizzle-orm";
import {
  commandRecords,
  companyMembers,
  projects,
  recordAudits,
  vendorProfiles,
  vendorProjectAccess,
} from "../../../db/schema";
import { enforceOnboardingAccess } from "../../../lib/onboarding";
import { operationalEmailConnection, sendOperationalEmail } from "../../../lib/operational-email";
import {
  createCorrespondenceImpactActions,
  type ImpactAnswer,
  parseCorrespondenceData,
  updateCorrespondenceRecord,
} from "../../../lib/project-correspondence";
import { getCommandActor, resolveCommandActor } from "../../../lib/server-actor";
import { ensureVendorSchema } from "../../../lib/vendor-portal";

type CorrespondenceType = "RFIs" | "Submittals";

type CorrespondenceInput = {
  action?: "create" | "issue" | "record-response" | "initiate-change-order" | "distribute" | "close";
  projectId?: string;
  recordType?: CorrespondenceType;
  recordId?: string;
  title?: string;
  details?: string;
  specificationReference?: string;
  drawingReference?: string;
  scheduleReference?: string;
  vendorId?: string;
  requiredBy?: string;
  recipientName?: string;
  recipientEmail?: string;
  deliveryMethod?: "Operational Email" | "Recorded Manual Transmission";
  transmissionNote?: string;
  responseText?: string;
  responseStatus?: string;
  costImpact?: ImpactAnswer;
  scheduleImpact?: ImpactAnswer;
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
  if (!(await canReadProjectId(db, actor, projectId))) return Response.json({ error: "Assigned Project Correspondence Access Is Required" }, { status: 403 });
  const project = await db.select().from(projects).where(eq(projects.number, projectId)).limit(1);
  if (!project[0]) return Response.json({ error: "Project Not Found" }, { status: 404 });
  const role = await correspondenceRole(db, actor, project[0]);
  const accessRows = await db.select().from(vendorProjectAccess).where(eq(vendorProjectAccess.projectId, projectId));
  const vendors = await db.select().from(vendorProfiles);
  const vendorMap = new Map(vendors.map((vendor) => [vendor.id, vendor]));
  return Response.json({
    permissions: { canInitiate: role.canInitiate, canIssue: role.canIssue },
    projectManager: project[0].projectManager,
    superintendent: project[0].superintendent,
    emailConnection: await emailConnectionStatus(),
    vendors: accessRows.map((access) => ({
      id: access.vendorId,
      name: vendorMap.get(access.vendorId)?.legalName || access.vendorId,
      contactName: vendorMap.get(access.vendorId)?.contactName || "",
      contactEmail: vendorMap.get(access.vendorId)?.contactEmail || "",
      trade: access.trade,
      status: access.status,
    })),
  });
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  await ensureVendorSchema();
  const input = (await request.json()) as CorrespondenceInput;
  const projectId = input.projectId?.trim() || "";
  const recordType = input.recordType;
  if (!projectId || !recordType || !["RFIs", "Submittals"].includes(recordType)) {
    return Response.json({ error: "A Valid Project And Correspondence Type Are Required" }, { status: 400 });
  }
  const { getDb } = await import("../../../db");
  const db = getDb();
  if (!(await canReadProjectId(db, actor, projectId))) return Response.json({ error: "Assigned Project Correspondence Access Is Required" }, { status: 403 });
  const project = await db.select().from(projects).where(eq(projects.number, projectId)).limit(1);
  if (!project[0]) return Response.json({ error: "Project Not Found" }, { status: 404 });
  const role = await correspondenceRole(db, actor, project[0]);

  if (input.action === "create") {
    if (!role.canInitiate) return Response.json({ error: "Only A Project Manager Or Site Superintendent May Initiate This Record" }, { status: 403 });
    const title = input.title?.trim() || "";
    const details = input.details?.trim() || "";
    const requiredBy = input.requiredBy?.trim() || "";
    if (!title || !details || !requiredBy) return Response.json({ error: "Title Details And Required-By Date Are Required" }, { status: 400 });
    const id = await nextCorrespondenceId(db, projectId, recordType);
    const now = new Date().toISOString();
    const status = role.canIssue ? "Draft" : "PM Review";
    const data = {
      details,
      specificationReference: input.specificationReference?.trim() || "",
      drawingReference: input.drawingReference?.trim() || "",
      scheduleReference: input.scheduleReference?.trim() || "",
      vendorId: input.vendorId?.trim() || "",
      requiredBy,
      initiatedBy: actor.name,
      initiatedByEmail: actor.email,
      initiatedAt: now,
      pmOnlyIssuance: true,
      costImpact: "",
      scheduleImpact: "",
      attachments: [],
      timeline: [{ action: "Initiated", actor: actor.name, at: now, detail: status }],
    };
    await db.insert(commandRecords).values({
      projectId,
      id,
      recordType,
      title,
      owner: project[0].projectManager,
      due: requiredBy,
      status,
      meta: `${recordType === "RFIs" ? "Question" : "Material Package"} · PM-Controlled Issuance`,
      recordDate: now.slice(0, 10),
      recordTime: now.slice(11, 16),
      dateLocked: true,
      dataJson: JSON.stringify(data),
      updatedAt: now,
    });
    await db.insert(recordAudits).values({
      projectId,
      recordId: id,
      fieldName: "Initiation",
      oldValue: "None",
      newValue: status,
      reason: `${recordType.slice(0, -1)} initiated`,
      actorName: actor.name,
      actorEmail: actor.email,
      summary: `${id} initiated by ${actor.name}; formal issuance remains restricted to the Project Manager.`,
    });
    const { reconcileProjectHealthAfterUpdate } = await import("../project-health/route");
    await reconcileProjectHealthAfterUpdate(projectId, actor);
    return Response.json({ saved: true, record: clientRecord(id, recordType, title, project[0].projectManager, requiredBy, status, data) }, { status: 201 });
  }

  const recordId = input.recordId?.trim() || "";
  const row = await db.select().from(commandRecords).where(and(
    eq(commandRecords.projectId, projectId),
    eq(commandRecords.id, recordId),
    eq(commandRecords.recordType, recordType),
  )).limit(1);
  if (!row[0]) return Response.json({ error: "Correspondence Record Not Found" }, { status: 404 });
  const data = parseCorrespondenceData(row[0].dataJson);
  const timeline = Array.isArray(data.timeline) ? data.timeline as Array<Record<string, unknown>> : [];
  const now = new Date().toISOString();

  if (input.action === "initiate-change-order") {
    if (recordType !== "RFIs") return Response.json({ error: "This Direct Change-Order Action Is Available From RFIs" }, { status: 400 });
    if (!role.canInitiate) return Response.json({ error: "Only A Project Manager Or Site Superintendent May Initiate A Change Request From An RFI" }, { status: 403 });
    const impact = await createCorrespondenceImpactActions({
      db, projectId, recordId, recordType, title: row[0].title,
      projectManager: project[0].projectManager,
      projectManagerEmail: role.projectManagerEmail,
      costImpact: "Unknown", scheduleImpact: "No",
      actorName: actor.name, actorEmail: actor.email,
    });
    const nextData = {
      ...data,
      costImpact: data.costImpact || "Unknown",
      changeExposureId: impact.changeExposureId,
      changeOrderInitiatedBy: actor.name,
      changeOrderInitiatedAt: now,
      timeline: [...timeline, { action: "Change Order Initiated", actor: actor.name, at: now, detail: `${impact.changeExposureId} created as an unapproved linked exposure` }],
    };
    await updateCorrespondenceRecord({ db, projectId, recordId, status: row[0].status, data: nextData, actorName: actor.name, actorEmail: actor.email, oldStatus: row[0].status, summary: `Linked unapproved change exposure ${impact.changeExposureId} initiated` });
    return Response.json({ saved: true, status: row[0].status, data: nextData, impact });
  }

  if (input.action === "issue") {
    if (!role.canIssue) return Response.json({ error: "Only A Project Manager May Issue Or Send Formal Correspondence" }, { status: 403 });
    if (!["Draft", "PM Review", "Revise And Resubmit"].includes(row[0].status)) return Response.json({ error: "This Record Is Not Ready For PM Issuance" }, { status: 409 });
    const recipientName = input.recipientName?.trim() || "";
    const recipientEmail = input.recipientEmail?.trim() || "";
    const method = input.deliveryMethod;
    if (!recipientName || !validEmail(recipientEmail) || !method) return Response.json({ error: "Recipient Name Email And Delivery Method Are Required" }, { status: 400 });
    if (method === "Recorded Manual Transmission" && !input.transmissionNote?.trim()) return Response.json({ error: "Record The Manual Transmission Method Or Confirmation" }, { status: 400 });
    if (method === "Operational Email") {
      const delivery = await sendCorrespondenceEmail({
        senderEmail: actor.email,
        to: recipientEmail,
        recipientName,
        recordId,
        recordType,
        title: row[0].title,
        details: String(data.details || ""),
        requiredBy: row[0].due,
        projectName: project[0].name,
      });
      if (!delivery.startsWith("Provider Accepted")) return Response.json({ error: `Operational Email Was Not Accepted By A Provider · ${delivery}` }, { status: 503 });
    }
    const nextStatus = recordType === "RFIs" ? "Issued" : "Design Review";
    const nextData = {
      ...data,
      recipientName,
      recipientEmail,
      deliveryMethod: method,
      transmissionNote: input.transmissionNote?.trim() || "",
      issuedBy: actor.name,
      issuedByEmail: actor.email,
      issuedAt: now,
      timeline: [...timeline, { action: "Issued", actor: actor.name, at: now, detail: `${method} · ${recipientName}` }],
    };
    await updateCorrespondenceRecord({ db, projectId, recordId, status: nextStatus, data: nextData, actorName: actor.name, actorEmail: actor.email, oldStatus: row[0].status, summary: `PM issued to ${recipientName} by ${method}` });
    return Response.json({ saved: true, status: nextStatus, data: nextData });
  }

  if (input.action === "record-response") {
    if (!role.canIssue) return Response.json({ error: "Only The Project Manager May Record A Design-Team Response Internally" }, { status: 403 });
    if (!["Issued", "Design Review"].includes(row[0].status)) return Response.json({ error: "This Record Is Not Awaiting A Response" }, { status: 409 });
    const responseText = input.responseText?.trim() || "";
    if (!responseText || !validImpact(input.costImpact) || !validImpact(input.scheduleImpact)) return Response.json({ error: "Response Cost Impact And Schedule Impact Are Required" }, { status: 400 });
    const responseStatus = recordType === "Submittals" ? input.responseStatus?.trim() || "" : "Answered";
    if (recordType === "Submittals" && !["Approved", "Approved As Noted", "Revise And Resubmit", "Rejected"].includes(responseStatus)) return Response.json({ error: "Choose A Valid Submittal Review Status" }, { status: 400 });
    const impact = await createCorrespondenceImpactActions({
      db, projectId, recordId, recordType, title: row[0].title,
      projectManager: project[0].projectManager,
      projectManagerEmail: role.projectManagerEmail,
      costImpact: input.costImpact!, scheduleImpact: input.scheduleImpact!,
      actorName: actor.name, actorEmail: actor.email,
    });
    const nextStatus = recordType === "RFIs" ? "Response Received" : "Returned To PM";
    const nextData = {
      ...data,
      responseText,
      responseStatus,
      costImpact: input.costImpact,
      scheduleImpact: input.scheduleImpact,
      responseRecordedBy: actor.name,
      responseReceivedAt: now,
      ...impact,
      timeline: [...timeline, { action: "Response Received", actor: actor.name, at: now, detail: `${responseStatus} · Cost ${input.costImpact} · Schedule ${input.scheduleImpact}` }],
    };
    await updateCorrespondenceRecord({ db, projectId, recordId, status: nextStatus, data: nextData, actorName: actor.name, actorEmail: actor.email, oldStatus: row[0].status, summary: "Response and mandatory impacts recorded" });
    return Response.json({ saved: true, status: nextStatus, data: nextData, impact });
  }

  if (input.action === "distribute") {
    if (!role.canIssue) return Response.json({ error: "Only A Project Manager May Distribute The Controlled Response" }, { status: 403 });
    if (!["Response Received", "Returned To PM"].includes(row[0].status)) return Response.json({ error: "A Complete Response Must Be Received Before Distribution" }, { status: 409 });
    const revisionRequired = recordType === "Submittals" && ["Revise And Resubmit", "Rejected"].includes(String(data.responseStatus || ""));
    const nextStatus = revisionRequired ? "Revise And Resubmit" : "Distributed";
    const nextData = { ...data, distributedBy: actor.name, distributedAt: now, timeline: [...timeline, { action: revisionRequired ? "Revision Required" : "Distributed", actor: actor.name, at: now, detail: revisionRequired ? "PM distributed the review and returned the package for vendor revision" : "Controlled response distributed to the project team" }] };
    await updateCorrespondenceRecord({ db, projectId, recordId, status: nextStatus, data: nextData, actorName: actor.name, actorEmail: actor.email, oldStatus: row[0].status, summary: revisionRequired ? "PM distributed review and requested vendor revision" : "PM distributed controlled response" });
    return Response.json({ saved: true, status: nextStatus, data: nextData });
  }

  if (input.action === "close") {
    if (!role.canIssue) return Response.json({ error: "Only A Project Manager May Close Formal Correspondence" }, { status: 403 });
    if (row[0].status !== "Distributed") return Response.json({ error: "The Response Must Be Distributed Before Close" }, { status: 409 });
    const nextData = { ...data, closedBy: actor.name, closedAt: now, timeline: [...timeline, { action: "Closed", actor: actor.name, at: now, detail: "Formal workflow complete; linked exposures remain independent" }] };
    await updateCorrespondenceRecord({ db, projectId, recordId, status: "Closed", data: nextData, actorName: actor.name, actorEmail: actor.email, oldStatus: row[0].status, summary: "PM closed formal correspondence" });
    return Response.json({ saved: true, status: "Closed", data: nextData });
  }

  return Response.json({ error: "A Valid Correspondence Action Is Required" }, { status: 400 });
}

async function correspondenceRole(
  db: ReturnType<(typeof import("../../../db"))["getDb"]>,
  actor: ReturnType<typeof getCommandActor>,
  project: typeof projects.$inferSelect,
) {
  const member = actor.email ? await db.select().from(companyMembers).where(eq(companyMembers.email, actor.email)).limit(1) : [];
  let designations: string[] = [];
  try { designations = JSON.parse(member[0]?.designationsJson || "[]") as string[]; } catch { designations = []; }
  const isAssignedPm = actor.name.trim().toLowerCase() === project.projectManager.trim().toLowerCase();
  const isAssignedSuper = actor.name.trim().toLowerCase() === project.superintendent.trim().toLowerCase();
  const projectRoles = await projectDesignationsFor(db, actor, project, designations);
  const leadership = ["Company Owner", "Administrator"].includes(actor.accessLevel);
  const canIssue = leadership || isAssignedPm || projectRoles.includes("Project Manager");
  const canInitiate = canIssue || isAssignedSuper || projectRoles.includes("Superintendent");
  const pmMember = await db.select().from(companyMembers).where(eq(companyMembers.displayName, project.projectManager)).limit(1);
  return { canInitiate, canIssue, projectManagerEmail: pmMember[0]?.email || actor.email };
}

async function nextCorrespondenceId(
  db: ReturnType<(typeof import("../../../db"))["getDb"]>,
  projectId: string,
  recordType: CorrespondenceType,
) {
  const rows = await db.select({ id: commandRecords.id }).from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, recordType)));
  const prefix = recordType === "RFIs" ? "RFI" : "SUB";
  const next = rows.reduce((maximum, row) => Math.max(maximum, Number(row.id.match(/(\d+)$/)?.[1] || 0)), 0) + 1;
  return `${prefix}-${String(next).padStart(3, "0")}`;
}

function clientRecord(id: string, type: CorrespondenceType, title: string, owner: string, due: string, status: string, data: Record<string, unknown>) {
  return { id, type, title, owner, due, status, meta: `${type === "RFIs" ? "Question" : "Material Package"} · PM-Controlled Issuance`, data, auditHistory: [] };
}

function validEmail(value: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function validImpact(value: unknown): value is ImpactAnswer { return value === "No" || value === "Yes" || value === "Unknown"; }

async function emailConnectionStatus() {
  return (await operationalEmailConnection()).configured ? "Connected" : "Connection Required";
}

async function sendCorrespondenceEmail(input: { to: string; senderEmail?: string; recipientName: string; recordId: string; recordType: CorrespondenceType; title: string; details: string; requiredBy: string; projectName: string }) {
  const delivery = await sendOperationalEmail({ to: input.to, senderEmail: input.senderEmail, subject: `[Mefford ${input.recordId}] ${input.title}`, text: `${input.recipientName}\n\n${input.recordType === "RFIs" ? "Request For Information" : "Submittal Review"} ${input.recordId}\nProject: ${input.projectName}\nRequired By: ${input.requiredBy}\n\n${input.details}\n\nPlease answer both Cost Impact and Schedule Impact.`, idempotencyKey: `correspondence:${input.recordId}:${input.to}`, safeguards: { sendInvoice: false, postInvoice: false, approveCost: false } });
  return delivery.outcome === "Provider Accepted" ? `Provider Accepted · ${delivery.providerReceiptId}` : delivery.outcome === "Deferred" ? "Delivery Deferred · Connection Required" : `${delivery.outcome} · ${delivery.error}`;
}
