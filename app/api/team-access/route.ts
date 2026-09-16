import { projectDesignationsFor, resolveProjectDesignations } from "../../../lib/project-access";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  commandRecords,
  commandWorkItems,
  companyMembers,
  projects,
  recordAudits,
  vendorAudits,
  vendorInvites,
  vendorProfiles,
  vendorProjectAccess,
} from "../../../db/schema";
import { ensureMyWorkTables, upsertWorkItem } from "../../../lib/my-work";
import { sendOperationalEmail } from "../../../lib/operational-email";
import { getCommandActor, resolveCommandActor } from "../../../lib/server-actor";
import { enforceOnboardingAccess } from "../../../lib/onboarding";
import {
  DESIGNATION_CHANGE_REQUEST_TYPE,
  PROJECT_TEAM_ASSIGNMENT_TYPE,
  normalizeDesignations,
  parseRecordData,
  parseStringArray,
  projectTeamAssignmentId,
} from "../../../lib/team-access";
import { ensureVendorSchema, hashSecret } from "../../../lib/vendor-portal";

type TeamInput = {
  action?: string;
  projectId?: string;
  employeeEmail?: string;
  scope?: "project" | "default";
  designations?: string[];
  reason?: string;
  requestId?: string;
  decision?: "Approved" | "Rejected";
  decisionNote?: string;
  company?: string;
  contactEmail?: string;
  folder?: string;
  inviteId?: string;
};

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  const projectId = new URL(request.url).searchParams.get("projectId")?.trim() || "";
  if (!projectId) return Response.json({ error: "Project Is Required" }, { status: 400 });
  await ensureVendorSchema();
  const { getDb } = await import("../../../db");
  const db = getDb();
  const context = await teamContext(db, actor, projectId);
  if (!context.project) return Response.json({ error: "Project Not Found" }, { status: 404 });
  if (!context.canView) return Response.json({ error: "Project Team Access Is Required" }, { status: 403 });

  const [members, assignments, requests, audits, accessRows, vendors, invites] = await Promise.all([
    db.select().from(companyMembers).where(eq(companyMembers.isActive, true)),
    db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, PROJECT_TEAM_ASSIGNMENT_TYPE))),
    db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, DESIGNATION_CHANGE_REQUEST_TYPE))).orderBy(desc(commandRecords.updatedAt)),
    db.select().from(recordAudits).where(eq(recordAudits.projectId, projectId)).orderBy(desc(recordAudits.id)),
    db.select().from(vendorProjectAccess).where(eq(vendorProjectAccess.projectId, projectId)).orderBy(desc(vendorProjectAccess.updatedAt)),
    db.select().from(vendorProfiles),
    db.select().from(vendorInvites).orderBy(desc(vendorInvites.createdAt)),
  ]);
  const assignmentMap = new Map(assignments.map((record) => [String(parseRecordData(record.dataJson).employeeEmail || "").toLowerCase(), record]));
  const vendorMap = new Map(vendors.map((vendor) => [vendor.id, vendor]));
  const employees = members.map((member) => {
    const defaults = parseStringArray(member.designationsJson);
    const assignment = assignmentMap.get(member.email.toLowerCase());
    const projectDesignations = resolveProjectDesignations(member.displayName, context.project!, defaults,
      assignment ? normalizeDesignations(parseRecordData(assignment.dataJson).projectDesignations) : null);
    return {
      name: member.displayName,
      email: member.email,
      accessLevel: member.companyAccessLevel,
      defaultDesignations: defaults,
      projectDesignations,
      scope: member.companyAccessLevel === "Company Owner" ? "Complete company access" : projectDesignations.length ? `${projectDesignations.join(" · ")} on this project` : "No project designation",
      status: member.identityProvider === "microsoft_entra_pending" ? "Pending Connection" : "Active",
    };
  });
  const designationRequests = requests.map((record) => {
    const data = parseRecordData(record.dataJson);
    return {
      id: record.id,
      project: context.project!.name,
      employeeName: String(data.employeeName || record.title),
      employeeEmail: String(data.employeeEmail || ""),
      requestedBy: String(data.requestedBy || record.owner),
      currentDesignations: normalizeDesignations(data.currentDesignations),
      requestedDesignations: normalizeDesignations(data.requestedDesignations),
      reason: String(data.reason || ""),
      submitted: String(data.submittedAt || record.createdAt),
      status: record.status,
      decisionNote: String(data.decisionNote || ""),
      reviewedBy: String(data.reviewedBy || ""),
      reviewedAt: String(data.reviewedAt || ""),
    };
  });
  const ownerOverrides = audits
    .filter((audit) => audit.fieldName === "Project Designations" && audit.reason.startsWith("Owner Override:"))
    .map((audit) => ({
      id: `OVR-${audit.id}`,
      project: context.project!.name,
      employeeName: assignments.find((assignment) => assignment.id === audit.recordId)?.title || audit.recordId.replace(/^TEAM-/, ""),
      action: "Owner Override" as const,
      previousDesignations: parseAuditList(audit.oldValue),
      nextDesignations: parseAuditList(audit.newValue),
      requestedBy: audit.actorName,
      reviewedBy: audit.actorName,
      occurredAt: audit.createdAt,
      note: audit.reason.replace(/^Owner Override:\s*/, ""),
    }));
  const projectInvites = accessRows.map((access) => {
    const vendor = vendorMap.get(access.vendorId);
    const invite = invites.find((item) => item.vendorId === access.vendorId && !item.revokedAt);
    return {
      id: invite?.id || "",
      vendorId: access.vendorId,
      company: vendor?.legalName || access.vendorId,
      email: vendor?.contactEmail || invite?.email || "",
      project: context.project!.name,
      folder: parseStringArray(access.sharedRecordsJson).join(", ") || "Subcontractor Inbox",
      status: access.status,
      expires: invite?.expiresAt || "Project closeout",
    };
  });
  return Response.json({
    employees,
    invites: projectInvites,
    designationRequests,
    ownerOverrides,
    permissions: {
      canManageDesignations: context.canManageDesignations,
      canRequestDesignations: context.canRequestDesignations,
      canOwnerOverride: context.level === "Company Owner",
      canInvite: context.canInvite,
    },
    controls: {
      persistence: "D1 permanent project assignments, requests, invitations, and audit history",
      authorization: "Server-enforced company level plus project designation",
      identity: "Sites authentication active; Microsoft Entra remains a future connection",
    },
  });
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  const input = await request.json() as TeamInput;
  const projectId = input.projectId?.trim() || "";
  if (!projectId) return Response.json({ error: "Project Is Required" }, { status: 400 });
  await ensureVendorSchema();
  await ensureMyWorkTables();
  const { getDb } = await import("../../../db");
  const db = getDb();
  const context = await teamContext(db, actor, projectId);
  if (!context.project) return Response.json({ error: "Project Not Found" }, { status: 404 });
  const now = new Date().toISOString();

  if (input.action === "save-designations") {
    if (!context.canManageDesignations) return Response.json({ error: "Owner Or Administrator Authorization Is Required" }, { status: 403 });
    const email = input.employeeEmail?.trim().toLowerCase() || "";
    const member = await db.select().from(companyMembers).where(eq(companyMembers.email, email)).limit(1);
    if (!member[0]) return Response.json({ error: "Active Employee Record Not Found" }, { status: 404 });
    const designations = normalizeDesignations(input.designations);
    if (input.scope === "default") {
      const previous = parseStringArray(member[0].designationsJson);
      if (designations.includes("Safety Director")) {
        const activeMembers = await db.select().from(companyMembers).where(eq(companyMembers.isActive, true));
        for (const other of activeMembers.filter((candidate) => candidate.email !== email && parseStringArray(candidate.designationsJson).includes("Safety Director"))) {
          const priorRoles = parseStringArray(other.designationsJson);
          const nextRoles = priorRoles.filter((designation) => designation !== "Safety Director");
          await db.update(companyMembers).set({ designationsJson: JSON.stringify(nextRoles), updatedAt: now }).where(eq(companyMembers.email, other.email));
          await teamAudit(db, "MEFFORD-COMPANY", `MEMBER-${other.email}`, context, "Company Default Designations", priorRoles, nextRoles, `Safety Director reassigned to ${member[0].displayName}`);
        }
      }
      await db.update(companyMembers).set({ designationsJson: JSON.stringify(designations), updatedAt: now }).where(eq(companyMembers.email, email));
      await teamAudit(db, "MEFFORD-COMPANY", `MEMBER-${email}`, context, "Company Default Designations", previous, designations, "Authorized default designation update");
      return Response.json({ saved: true, scope: "default", designations });
    }
    const assignmentId = projectTeamAssignmentId(email);
    const existing = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, assignmentId))).limit(1);
    const previous = existing[0] ? normalizeDesignations(parseRecordData(existing[0].dataJson).projectDesignations) : parseStringArray(member[0].designationsJson);
    await saveAssignment(db, projectId, assignmentId, member[0], designations, context, now);
    await teamAudit(db, projectId, assignmentId, context, "Project Designations", previous, designations, "Authorized project designation update");
    return Response.json({ saved: true, scope: "project", designations });
  }

  if (input.action === "request-designations") {
    if (!context.canRequestDesignations) return Response.json({ error: "Project Manager, Administrator, Or Owner Authorization Is Required" }, { status: 403 });
    const email = input.employeeEmail?.trim().toLowerCase() || "";
    const reason = input.reason?.trim() || "";
    const member = await db.select().from(companyMembers).where(eq(companyMembers.email, email)).limit(1);
    if (!member[0] || reason.length < 8) return Response.json({ error: "Employee And A Specific Request Reason Are Required" }, { status: 400 });
    const current = await currentProjectDesignations(db, projectId, member[0]);
    const requested = normalizeDesignations(input.designations);
    if (JSON.stringify(current) === JSON.stringify(requested)) return Response.json({ error: "The Requested Designations Match Current Access" }, { status: 409 });
    const id = `DCR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const data = { employeeEmail: email, employeeName: member[0].displayName, currentDesignations: current, requestedDesignations: requested, reason, requestedBy: context.name, requestedByEmail: context.email, submittedAt: now, decisionNote: "", reviewedBy: "", reviewedAt: "" };
    await db.insert(commandRecords).values({ projectId, id, recordType: DESIGNATION_CHANGE_REQUEST_TYPE, title: `${member[0].displayName} Designation Change`, owner: context.name, due: now.slice(0, 10), status: "Pending", meta: `${current.join(" + ") || "None"} → ${requested.join(" + ") || "None"}`, recordDate: now.slice(0, 10), recordTime: now.slice(11, 16), dateLocked: true, dataJson: JSON.stringify(data), updatedAt: now });
    await teamAudit(db, projectId, id, context, "Designation Request", current, requested, reason);
    const reviewers = await db.select().from(companyMembers).where(and(eq(companyMembers.isActive, true), inArray(companyMembers.companyAccessLevel, ["Company Owner", "Administrator"])));
    await Promise.all(reviewers.filter((reviewer) => reviewer.email !== context.email).map((reviewer) => upsertWorkItem(db, { dedupeKey: `team-access:${projectId}:${id}:${reviewer.email}`, projectId, recipientName: reviewer.displayName, recipientEmail: reviewer.email, kind: "Access Approval", title: `Review ${member[0].displayName}'s Project Designations`, message: `${context.name} requested a controlled designation change on ${context.project!.name}.`, priority: "High", sourceType: "Designation Change Request", sourceRecordId: id, actionTarget: "Team", dueAt: now, createdBy: context.name })));
    return Response.json({ saved: true, requestId: id }, { status: 201 });
  }

  if (input.action === "decide-request") {
    if (!context.canManageDesignations) return Response.json({ error: "Owner Or Administrator Authorization Is Required" }, { status: 403 });
    const requestId = input.requestId?.trim() || "";
    const decision = input.decision;
    const rows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, requestId), eq(commandRecords.recordType, DESIGNATION_CHANGE_REQUEST_TYPE))).limit(1);
    if (!rows[0] || rows[0].status !== "Pending" || !decision) return Response.json({ error: "A Pending Designation Request Is Required" }, { status: 409 });
    const data = parseRecordData(rows[0].dataJson);
    const note = input.decisionNote?.trim() || "";
    if (decision === "Rejected" && note.length < 8) return Response.json({ error: "A Specific Rejection Explanation Is Required" }, { status: 400 });
    const member = await db.select().from(companyMembers).where(eq(companyMembers.email, String(data.employeeEmail || ""))).limit(1);
    if (!member[0]) return Response.json({ error: "Employee Record Not Found" }, { status: 404 });
    if (decision === "Approved") {
      await saveAssignment(db, projectId, projectTeamAssignmentId(member[0].email), member[0], normalizeDesignations(data.requestedDesignations), context, now);
    }
    const nextData = { ...data, decisionNote: note || `Approved by ${context.name}.`, reviewedBy: context.name, reviewedByEmail: context.email, reviewedAt: now };
    await db.update(commandRecords).set({ status: decision, dataJson: JSON.stringify(nextData), updatedAt: now }).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, requestId)));
    await teamAudit(db, projectId, requestId, context, "Designation Request Decision", data.currentDesignations, decision === "Approved" ? data.requestedDesignations : data.currentDesignations, `${decision}: ${nextData.decisionNote}`);
    await db.update(commandWorkItems).set({ status: "Completed", completedAt: now, updatedAt: now }).where(and(eq(commandWorkItems.sourceRecordId, requestId), eq(commandWorkItems.sourceType, "Designation Change Request")));
    return Response.json({ saved: true, decision });
  }

  if (input.action === "owner-override") {
    if (context.level !== "Company Owner") return Response.json({ error: "Company Owner Authorization Is Required" }, { status: 403 });
    const email = input.employeeEmail?.trim().toLowerCase() || "";
    const reason = input.reason?.trim() || "";
    if (reason.length < 8) return Response.json({ error: "A Specific Owner Override Reason Is Required" }, { status: 400 });
    const member = await db.select().from(companyMembers).where(eq(companyMembers.email, email)).limit(1);
    if (!member[0]) return Response.json({ error: "Employee Record Not Found" }, { status: 404 });
    const previous = await currentProjectDesignations(db, projectId, member[0]);
    const next = normalizeDesignations(input.designations);
    if (JSON.stringify(previous) === JSON.stringify(next)) return Response.json({ error: "The Override Does Not Change Access" }, { status: 409 });
    const assignmentId = projectTeamAssignmentId(email);
    await saveAssignment(db, projectId, assignmentId, member[0], next, context, now);
    await teamAudit(db, projectId, assignmentId, context, "Project Designations", previous, next, `Owner Override: ${reason}`);
    return Response.json({ saved: true, designations: next });
  }

  if (input.action === "invite-subcontractor") {
    if (!context.canInvite) return Response.json({ error: "Project Manager, Administrator, Or Owner Authorization Is Required" }, { status: 403 });
    const company = input.company?.trim() || "";
    const email = input.contactEmail?.trim().toLowerCase() || "";
    const folder = input.folder?.trim() || "Subcontractor Inbox";
    if (company.length < 2 || !validEmail(email)) return Response.json({ error: "Subcontractor Company And Valid Email Are Required" }, { status: 400 });
    let vendor = (await db.select().from(vendorProfiles).where(eq(vendorProfiles.contactEmail, email)).limit(1))[0];
    if (!vendor) {
      const vendorId = `VND-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      await db.insert(vendorProfiles).values({ id: vendorId, legalName: company, contactName: company, contactEmail: email, status: "Prospective" });
      vendor = (await db.select().from(vendorProfiles).where(eq(vendorProfiles.id, vendorId)).limit(1))[0];
    }
    const accessId = `${vendor.id}:${projectId}`;
    const permissions = folderPermissions(folder);
    await db.insert(vendorProjectAccess).values({ id: accessId, vendorId: vendor.id, projectId, projectName: context.project.name, status: "Invitation Pending", trade: "", permissionsJson: JSON.stringify(permissions), sharedRecordsJson: JSON.stringify([folder]), grantedBy: context.email, updatedAt: now }).onConflictDoUpdate({ target: vendorProjectAccess.id, set: { status: "Invitation Pending", permissionsJson: JSON.stringify(permissions), sharedRecordsJson: JSON.stringify([folder]), grantedBy: context.email, updatedAt: now } });
    const code = secureCode();
    const inviteId = `INV-${crypto.randomUUID().slice(0, 10).toUpperCase()}`;
    const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    await db.insert(vendorInvites).values({ id: inviteId, vendorId: vendor.id, email, codeHash: await hashSecret(code), expiresAt, createdBy: context.email });
    await db.insert(vendorAudits).values({ vendorId: vendor.id, actorName: context.name, actorEmail: context.email, action: "Project Invitation Created", detail: `${context.project.name} · ${folder} · Expires ${expiresAt}` });
    const path = `/?vendorPortal=${encodeURIComponent(inviteId)}`;
    const delivery = await sendOperationalEmail({ to: email, senderEmail: context.email, subject: `${context.project.name} · Mefford Project Portal Invitation`, text: `${company}\n\n${context.name} invited you to the controlled ${folder} workspace for ${context.project.name}.\n\nOpen: ${new URL(request.url).origin}${path}\nOne-time code: ${code}\nExpires: ${expiresAt}`, idempotencyKey: `team-access:${inviteId}`, safeguards: { approveWork: false, approveCost: false, releasePayment: false } });
    await db.insert(vendorAudits).values({ vendorId: vendor.id, actorName: context.name, actorEmail: context.email, action: `Project Invitation ${delivery.outcome}`, detail: `${delivery.provider || "No Provider"} · ${delivery.providerReceiptId || delivery.error}` });
    return Response.json({ saved: true, inviteId, code, url: path, delivery: delivery.outcome === "Provider Accepted" ? `Provider Accepted · ${delivery.providerReceiptId}` : `${delivery.outcome} · ${delivery.error}`, providerReceipt: delivery.outcome === "Provider Accepted" ? delivery : null }, { status: 201 });
  }

  if (input.action === "revoke-invite") {
    if (!context.canInvite) return Response.json({ error: "Project Manager, Administrator, Or Owner Authorization Is Required" }, { status: 403 });
    const inviteId = input.inviteId?.trim() || "";
    const invite = await db.select().from(vendorInvites).where(eq(vendorInvites.id, inviteId)).limit(1);
    if (!invite[0]) return Response.json({ error: "Active Invitation Not Found" }, { status: 404 });
    await db.update(vendorInvites).set({ revokedAt: now, sessionHash: null, sessionExpiresAt: null }).where(eq(vendorInvites.id, inviteId));
    await db.update(vendorProjectAccess).set({ status: "Revoked", updatedAt: now }).where(and(eq(vendorProjectAccess.vendorId, invite[0].vendorId), eq(vendorProjectAccess.projectId, projectId)));
    await db.insert(vendorAudits).values({ vendorId: invite[0].vendorId, actorName: context.name, actorEmail: context.email, action: "Project Invitation Revoked", detail: `${context.project.name} · ${inviteId}` });
    return Response.json({ saved: true, revoked: true });
  }

  return Response.json({ error: "A Valid Team Access Action Is Required" }, { status: 400 });
}

async function teamContext(db: ReturnType<typeof import("../../../db").getDb>, actor: ReturnType<typeof getCommandActor>, projectId: string) {
  const [memberRows, projectRows] = await Promise.all([
    db.select().from(companyMembers).where(eq(companyMembers.email, actor.email)).limit(1),
    db.select().from(projects).where(eq(projects.number, projectId)).limit(1),
  ]);
  const member = memberRows[0];
  const project = projectRows[0] || null;
  const level = member?.companyAccessLevel || actor.accessLevel;
  const defaults = parseStringArray(member?.designationsJson);
  const projectDesignations = member && project ? await currentProjectDesignations(db, projectId, member) : defaults;
  const name = member?.displayName || actor.name;
  const isLeadership = ["Company Owner", "Administrator"].includes(level);
  const isProjectManager = Boolean(project && (project.projectManager === name || projectDesignations.includes("Project Manager")));
  return {
    ...actor,
    name,
    level,
    project,
    projectDesignations,
    canView: Boolean(member?.isActive && (isLeadership || isProjectManager || projectDesignations.includes("Office Staff"))),
    canManageDesignations: isLeadership,
    canRequestDesignations: isLeadership || isProjectManager,
    canInvite: isLeadership || isProjectManager,
  };
}

async function currentProjectDesignations(db: ReturnType<typeof import("../../../db").getDb>, projectId: string, member: typeof companyMembers.$inferSelect) {
  const project = (await db.select().from(projects).where(eq(projects.number, projectId)).limit(1))[0];
  return project ? projectDesignationsFor(db, { email: member.email, name: member.displayName }, project, parseStringArray(member.designationsJson)) : [];
}

async function saveAssignment(db: ReturnType<typeof import("../../../db").getDb>, projectId: string, id: string, member: typeof companyMembers.$inferSelect, designations: string[], actor: { name: string; email: string }, now: string) {
  const data = { employeeEmail: member.email, employeeName: member.displayName, companyAccessLevel: member.companyAccessLevel, projectDesignations: designations, updatedBy: actor.name, updatedByEmail: actor.email, updatedAt: now };
  await db.insert(commandRecords).values({ projectId, id, recordType: PROJECT_TEAM_ASSIGNMENT_TYPE, title: member.displayName, owner: actor.name, due: now.slice(0, 10), status: designations.length ? "Active" : "No Project Role", meta: designations.join(" + ") || "No Project Designation", recordDate: now.slice(0, 10), recordTime: now.slice(11, 16), dateLocked: true, dataJson: JSON.stringify(data), updatedAt: now }).onConflictDoUpdate({ target: [commandRecords.projectId, commandRecords.id], set: { owner: actor.name, status: designations.length ? "Active" : "No Project Role", meta: designations.join(" + ") || "No Project Designation", dataJson: JSON.stringify(data), updatedAt: now } });
}

async function teamAudit(db: ReturnType<typeof import("../../../db").getDb>, projectId: string, recordId: string, actor: { name: string; email: string }, fieldName: string, previous: unknown, next: unknown, reason: string) {
  const oldValue = Array.isArray(previous) ? previous.join(" + ") || "None" : String(previous || "None");
  const newValue = Array.isArray(next) ? next.join(" + ") || "None" : String(next || "None");
  await db.insert(recordAudits).values({ projectId, recordId, fieldName, oldValue, newValue, reason, actorName: actor.name, actorEmail: actor.email, summary: `${fieldName}: ${oldValue} → ${newValue}. ${reason}` });
}

function parseAuditList(value: string) {
  return value === "None" ? [] : value.split(" + ").map((item) => item.trim()).filter(Boolean);
}

function folderPermissions(folder: string) {
  if (/RFI/i.test(folder)) return ["RFI Response"];
  if (/Submittal/i.test(folder)) return ["Submittal Response"];
  return ["View Assigned Files", "Download Shared Files", "Upload Files And Revisions"];
}

function secureCode() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return String(values[0] % 1_000_000).padStart(6, "0");
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
