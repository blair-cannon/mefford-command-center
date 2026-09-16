import { and, desc, eq } from "drizzle-orm";
import {
  commandRecords,
  projects,
  vendorAudits,
  vendorComplianceDocuments,
  vendorComplianceOverrides,
  vendorInvites,
  vendorProfiles,
  vendorProjectAccess,
  vendorSubmissions,
} from "../../../db/schema";
import { sendOperationalEmail } from "../../../lib/operational-email";
import { resolveCommandActor } from "../../../lib/server-actor";
import { enforceOnboardingAccess } from "../../../lib/onboarding";
import {
  complianceState,
  ensureVendorSchema,
  finalCloseoutState,
  hashSecret,
  parseObject,
  parseStringArray,
  refreshProjectAccessStatus,
  vendorInternalActor,
} from "../../../lib/vendor-portal";

type VendorAction = {
  action?: string;
  vendorId?: string;
  inviteId?: string;
  documentId?: string;
  submissionId?: string;
  legalName?: string;
  dbaName?: string;
  vendorType?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  trades?: string[];
  serviceAreas?: string[];
  projectId?: string;
  trade?: string;
  contractReference?: string;
  costCode?: string;
  committedAmount?: number;
  designAccess?: boolean;
  reason?: string;
  expiresAt?: string;
  overrideId?: string;
  status?: string;
  reviewNote?: string;
};

export async function GET(request: Request) {
  await ensureVendorSchema();
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  const actor = await vendorInternalActor(await resolveCommandActor(request));
  if (!actor) {
    return Response.json({ error: "Vendor Management Requires Owner Administrator Or Accounting Access" }, { status: 403 });
  }
  const { getDb } = await import("../../../db");
  const db = getDb();
  const [profiles, invites, documents, access, submissions, overrides, audits, projectRows] = await Promise.all([
    db.select().from(vendorProfiles).orderBy(desc(vendorProfiles.updatedAt)),
    db.select().from(vendorInvites).orderBy(desc(vendorInvites.createdAt)),
    db.select().from(vendorComplianceDocuments).orderBy(desc(vendorComplianceDocuments.createdAt)),
    db.select().from(vendorProjectAccess).orderBy(desc(vendorProjectAccess.updatedAt)),
    db.select().from(vendorSubmissions).orderBy(desc(vendorSubmissions.submittedAt)),
    db.select().from(vendorComplianceOverrides).orderBy(desc(vendorComplianceOverrides.createdAt)),
    db.select().from(vendorAudits).orderBy(desc(vendorAudits.id)),
    db.select().from(projects).orderBy(projects.number),
  ]);
  const vendors = await Promise.all(profiles.map(async (profile) => {
    const compliance = profile.vendorType === "Project Owner" ? { blocked: false, missing: [] as string[], expired: [] as string[], activeOverride: null } : await complianceState(db, profile.id);
    return {
      ...profile,
      trades: parseStringArray(profile.tradesJson),
      serviceAreas: parseStringArray(profile.serviceAreasJson),
      address: parseObject(profile.addressJson),
      compliance: {
        blocked: compliance.blocked,
        missing: compliance.missing,
        expired: compliance.expired,
        activeOverride: compliance.activeOverride,
      },
      invites: invites.filter((item) => item.vendorId === profile.id).map(publicInvite),
      documents: documents.filter((item) => item.vendorId === profile.id),
      projectAccess: access
        .filter((item) => item.vendorId === profile.id)
        .map((item) => ({
          ...item,
          permissions: parseStringArray(item.permissionsJson),
          sharedRecords: parseStringArray(item.sharedRecordsJson),
        })),
      submissions: submissions
        .filter((item) => item.vendorId === profile.id)
        .map((item) => ({ ...item, payload: parseObject(item.payloadJson) })),
      overrides: overrides.filter((item) => item.vendorId === profile.id),
      audits: audits.filter((item) => item.vendorId === profile.id).slice(0, 50),
    };
  }));
  const emailDelivery = await vendorEmailConnectionStatus();
  return Response.json({
    vendors,
    projects: projectRows.map((project) => ({
      number: project.number,
      name: project.name,
      manager: project.projectManager,
      status: project.status,
    })),
    actor: { name: actor.name, email: actor.email, accessLevel: actor.accessLevel },
    emailDelivery,
    siteAccessNotice: "Invitees Must Also Be Added As Viewers Under The Site's Existing Custom Access Policy.",
  });
}

export async function POST(request: Request) {
  await ensureVendorSchema();
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  const actor = await vendorInternalActor(await resolveCommandActor(request));
  if (!actor) {
    return Response.json({ error: "Vendor Management Requires Owner Administrator Or Accounting Access" }, { status: 403 });
  }
  const input = (await request.json()) as VendorAction;
  const { getDb } = await import("../../../db");
  const db = getDb();
  const now = new Date();

  if (input.action === "create-vendor") {
    const legalName = input.legalName?.trim() || "";
    const contactName = input.contactName?.trim() || "";
    const contactEmail = input.contactEmail?.trim().toLowerCase() || "";
    if (!legalName || !contactName || !validEmail(contactEmail)) {
      return Response.json({ error: "Legal Name Contact Name And A Valid Email Are Required" }, { status: 400 });
    }
    const id = `VND-${crypto.randomUUID()}`;
    await db.insert(vendorProfiles).values({
      id,
      legalName,
      dbaName: input.dbaName?.trim() || "",
      vendorType: ["Subcontractor", "Vendor", "Both", "Architect", "Engineer", "Design Consultant", "Project Owner"].includes(input.vendorType || "") ? input.vendorType! : "Subcontractor",
      status: "Prospective",
      contactName,
      contactEmail,
      contactPhone: input.contactPhone?.trim() || "",
      tradesJson: JSON.stringify(input.trades || []),
      serviceAreasJson: JSON.stringify(input.serviceAreas || []),
    });
    await audit(db, id, actor, "Vendor Created", `${legalName} entered as a prospective vendor.`);
    return Response.json({ saved: true, vendorId: id }, { status: 201 });
  }

  const vendorId = input.vendorId?.trim() || "";
  const vendor = vendorId
    ? await db.select().from(vendorProfiles).where(eq(vendorProfiles.id, vendorId)).limit(1)
    : [];
  if (!vendor[0]) return Response.json({ error: "Vendor Not Found" }, { status: 404 });

  if (input.action === "create-invite") {
    const email = vendor[0].contactEmail.toLowerCase();
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
    const inviteId = crypto.randomUUID();
    const expiresAt = new Date(now.getTime() + 7 * 86_400_000).toISOString();
    await db.insert(vendorInvites).values({
      id: inviteId,
      vendorId,
      email,
      codeHash: await hashSecret(code),
      expiresAt,
      createdBy: actor.email,
    });
    await db.update(vendorProfiles).set({ status: "Invited", updatedAt: now.toISOString() }).where(eq(vendorProfiles.id, vendorId));
    await audit(db, vendorId, actor, "Portal Invite Created", `One-time code invite prepared for ${email}; expires ${expiresAt}.`);
    const inviteLink = `${new URL(request.url).origin}/?vendorPortal=${inviteId}`;
    const emailDelivery = await sendVendorInviteEmail({ email, vendorName: vendor[0].legalName, inviteLink, code, expiresAt });
    await audit(db, vendorId, actor, `Portal Invite Email ${emailDelivery}`, `${email} · ${inviteLink}`);
    return Response.json({
      saved: true,
      invite: { id: inviteId, email, expiresAt },
      oneTimeCode: code,
      emailDelivery,
    }, { status: 201 });
  }

  if (input.action === "grant-project") {
    const projectId = input.projectId?.trim() || "";
    const project = await db.select().from(projects).where(eq(projects.number, projectId)).limit(1);
    if (!project[0]) return Response.json({ error: "Select A Valid Project" }, { status: 400 });
    const ownerPortal = vendor[0].vendorType === "Project Owner";
    const compliance = ownerPortal ? { blocked: false, paymentBlocked: false, missing: [] as string[], expired: [] as string[] } : await complianceState(db, vendorId, projectId);
    const id = `${vendorId}:${projectId}`;
    const permissions = ownerPortal
      ? ["Owner Closeout Read Only", "Warranty Request"]
      : ["Invoice", "AIA Pay Application", "RFI", "Submittal", "Toolbox Talk", "Closeout", ...(input.designAccess ? ["Design Review", "Design Upload"] : [])];
    const sharedRecords = ownerPortal ? ["Closeout Requirements", "Closeout Package", "Warranty History"] : input.designAccess ? ["Design Packages"] : [];
    await db.insert(vendorProjectAccess).values({
      id,
      vendorId,
      projectId,
      projectName: project[0].name,
      status: "Active",
      trade: input.trade?.trim() || "",
      contractReference: input.contractReference?.trim() || "",
      costCode: input.costCode?.trim() || "Unassigned",
      committedAmount: String(Math.max(0, Number(input.committedAmount || 0))),
      permissionsJson: JSON.stringify(permissions),
      sharedRecordsJson: JSON.stringify(sharedRecords),
      grantedBy: actor.email,
      updatedAt: now.toISOString(),
    }).onConflictDoUpdate({
      target: vendorProjectAccess.id,
      set: {
        status: "Active",
        trade: input.trade?.trim() || "",
        contractReference: input.contractReference?.trim() || "",
        costCode: input.costCode?.trim() || "Unassigned",
        committedAmount: String(Math.max(0, Number(input.committedAmount || 0))),
        permissionsJson: JSON.stringify(permissions),
        sharedRecordsJson: JSON.stringify(sharedRecords),
        updatedAt: now.toISOString(),
      },
    });
    await audit(db, vendorId, actor, ownerPortal ? "Permanent Owner Closeout Access Updated" : "Project Scope Updated", `${project[0].name} · ${ownerPortal ? "Read-only closeout and warranty access remains available after project closure" : compliance.blocked ? "Active With Payment Hold" : "Active"}.`);
    if (!ownerPortal) await reconcileVendorProjectHealth(db, vendorId, actor);
    return Response.json({ saved: true, blocked: false, paymentBlocked: compliance.paymentBlocked, missing: compliance.missing, expired: compliance.expired }, { status: 201 });
  }

  if (input.action === "review-document") {
    if (!input.documentId || !["Approved", "Rejected"].includes(input.status || "")) {
      return Response.json({ error: "Document And Review Decision Are Required" }, { status: 400 });
    }
    const document = await db.select().from(vendorComplianceDocuments)
      .where(and(eq(vendorComplianceDocuments.id, input.documentId), eq(vendorComplianceDocuments.vendorId, vendorId))).limit(1);
    if (!document[0]) return Response.json({ error: "Compliance Document Not Found" }, { status: 404 });
    await db.update(vendorComplianceDocuments).set({
      status: input.status!,
      reviewedBy: actor.name,
      reviewedAt: now.toISOString(),
      reviewNote: input.reviewNote?.trim() || "",
    }).where(eq(vendorComplianceDocuments.id, input.documentId));
    await audit(db, vendorId, actor, `Compliance ${input.status}`, `${document[0].kind} · ${input.reviewNote?.trim() || "No note"}`);
    await refreshProjectAccessStatus(db, vendorId);
    const compliance = await complianceState(db, vendorId);
    await db.update(vendorProfiles).set({
      status: compliance.blocked ? "Conditional" : "Approved",
      approvedBy: compliance.blocked ? "" : actor.name,
      approvedAt: compliance.blocked ? null : now.toISOString(),
      updatedAt: now.toISOString(),
    }).where(eq(vendorProfiles.id, vendorId));
    await reconcileVendorProjectHealth(db, vendorId, actor);
    return Response.json({ saved: true, compliance: { blocked: compliance.blocked, missing: compliance.missing, expired: compliance.expired } });
  }

  if (input.action === "create-override") {
    if (actor.accessLevel !== "Company Owner") {
      return Response.json({ error: "Only A Company Owner Can Override Missing Or Expired Compliance" }, { status: 403 });
    }
    const reason = input.reason?.trim() || "";
    const expiresAt = input.expiresAt?.trim() || "";
    if (reason.length < 12 || !expiresAt || new Date(expiresAt) <= now) {
      return Response.json({ error: "A Specific Reason And Future Expiration Are Required" }, { status: 400 });
    }
    const id = crypto.randomUUID();
    await db.insert(vendorComplianceOverrides).values({
      id,
      vendorId,
      projectId: input.projectId?.trim() || "ALL",
      reason,
      expiresAt: new Date(expiresAt).toISOString(),
      ownerName: actor.name,
      ownerEmail: actor.email,
    });
    await audit(db, vendorId, actor, "Owner Compliance Override · No Face ID", `${reason} · Scope ${input.projectId?.trim() || "ALL"} · Expires ${new Date(expiresAt).toISOString()} · Authenticated Company Owner session.`);
    await refreshProjectAccessStatus(db, vendorId);
    await reconcileVendorProjectHealth(db, vendorId, actor);
    return Response.json({ saved: true, overrideId: id, biometricRequired: false }, { status: 201 });
  }

  if (input.action === "revoke-override") {
    if (actor.accessLevel !== "Company Owner") {
      return Response.json({ error: "Only A Company Owner Can End A Temporary Vendor Approval" }, { status: 403 });
    }
    const overrideId = input.overrideId?.trim() || "";
    const override = await db.select().from(vendorComplianceOverrides)
      .where(and(eq(vendorComplianceOverrides.id, overrideId), eq(vendorComplianceOverrides.vendorId, vendorId)))
      .limit(1);
    if (!override[0]) return Response.json({ error: "Temporary Vendor Approval Not Found" }, { status: 404 });
    if (override[0].revokedAt || new Date(override[0].expiresAt) <= now) {
      return Response.json({ error: "Temporary Vendor Approval Is No Longer Active" }, { status: 409 });
    }
    await db.update(vendorComplianceOverrides)
      .set({ revokedAt: now.toISOString() })
      .where(eq(vendorComplianceOverrides.id, overrideId));
    await audit(db, vendorId, actor, "Temporary Vendor Approval Ended", `Approval ${overrideId} ended early by authenticated Company Owner. The payment hold was reapplied; project work remains active.`);
    await refreshProjectAccessStatus(db, vendorId);
    await reconcileVendorProjectHealth(db, vendorId, actor);
    return Response.json({ saved: true, overrideId, revokedAt: now.toISOString() });
  }

  if (input.action === "route-to-ap") {
    const submissionId = input.submissionId?.trim() || "";
    const submission = await db.select().from(vendorSubmissions)
      .where(and(eq(vendorSubmissions.id, submissionId), eq(vendorSubmissions.vendorId, vendorId))).limit(1);
    if (!submission[0]) return Response.json({ error: "Submission Not Found" }, { status: 404 });
    if (submission[0].apRecordId) return Response.json({ error: "This Submission Is Already In Accounts Payable" }, { status: 409 });
    const compliance = await complianceState(db, vendorId, submission[0].projectId);
    const payload = parseObject(submission[0].payloadJson);
    if (payload.finalApplication === true) {
      const closeout = await finalCloseoutState(db, vendorId, submission[0].projectId);
      if (closeout.blocked) return Response.json({ error: `Final Payment Hard Block: ${closeout.missing.join(", ")}` }, { status: 409 });
    }
    const project = await db.select().from(projects).where(eq(projects.number, submission[0].projectId)).limit(1);
    const access = await db.select().from(vendorProjectAccess).where(
      and(eq(vendorProjectAccess.vendorId, vendorId), eq(vendorProjectAccess.projectId, submission[0].projectId)),
    ).limit(1);
    if (!project[0] || !access[0]) return Response.json({ error: "An Active Project Assignment Is Required" }, { status: 409 });
    const invoiceNumber = String(payload.invoiceNumber || payload.applicationNumber || submission[0].id);
    const existingApInvoices = await db
      .select({ id: commandRecords.id, dataJson: commandRecords.dataJson })
      .from(commandRecords)
      .where(and(eq(commandRecords.projectId, "MEFFORD-ACCOUNTING"), eq(commandRecords.recordType, "AP Invoice")));
    const duplicateApInvoice = existingApInvoices.find((item) => {
      const data = parseObject(item.dataJson);
      return String(data.vendor || "").trim().toLowerCase() === vendor[0].legalName.trim().toLowerCase() &&
        String(data.invoiceNumber || "").trim().toLowerCase() === invoiceNumber.trim().toLowerCase();
    });
    if (duplicateApInvoice) {
      return Response.json({ error: `Duplicate AP Hard Block: ${duplicateApInvoice.id} Already Uses This Vendor And Invoice Number` }, { status: 409 });
    }
    const apRecordId = `VP-${submission[0].id}`;
    const due = new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
    await db.insert(commandRecords).values({
      projectId: "MEFFORD-ACCOUNTING",
      id: apRecordId,
      recordType: "AP Invoice",
      title: `${vendor[0].legalName} · ${invoiceNumber}`,
      owner: project[0].projectManager,
      due,
      status: "Project Review",
      meta: `${submission[0].submissionType} · Vendor Portal · No Automatic Payment`,
      recordDate: submission[0].periodEnd || now.toISOString().slice(0, 10),
      dataJson: JSON.stringify({
        vendor: vendor[0].legalName,
        vendorId,
        invoiceNumber,
        total: Number(submission[0].amount),
        source: "Vendor Portal",
        vendorSubmissionId: submission[0].id,
        vendorSubmissionType: submission[0].submissionType,
        attachmentName: submission[0].attachmentName,
        attachmentStorageKey: submission[0].attachmentStorageKey,
        allocations: [{
          id: crypto.randomUUID(),
          destination: submission[0].projectId,
          code: access[0].costCode || "Unassigned",
          amount: Number(submission[0].amount),
        }],
        noPoAlert: !access[0].contractReference && Number(submission[0].amount) > 5000,
        paymentMethod: "",
        vendorPaymentHold: compliance.paymentBlocked,
        vendorComplianceMissing: compliance.missing,
        vendorComplianceExpired: compliance.expired,
        vendorTemporaryApprovalId: compliance.activeOverride?.id || "",
        portalPayload: payload,
      }),
    });
    await db.update(vendorSubmissions).set({
      status: "Project Review",
      apRecordId,
      updatedAt: now.toISOString(),
    }).where(eq(vendorSubmissions.id, submission[0].id));
    await audit(db, vendorId, actor, "Submission Routed To AP", `${submission[0].id} became ${apRecordId} in Project Review${compliance.paymentBlocked ? " with a vendor compliance payment hold" : ""}. Nothing was approved, posted, or paid automatically.`, submission[0].id);
    return Response.json({ saved: true, apRecordId, paymentBlocked: compliance.paymentBlocked }, { status: 201 });
  }

  if (input.action === "reject-submission") {
    const submissionId = input.submissionId?.trim() || "";
    const reason = input.reason?.trim() || "";
    if (!submissionId || reason.length < 5) return Response.json({ error: "A Submission And Rejection Reason Are Required" }, { status: 400 });
    await db.update(vendorSubmissions).set({
      status: "Returned To Vendor",
      updatedAt: now.toISOString(),
    }).where(and(eq(vendorSubmissions.id, submissionId), eq(vendorSubmissions.vendorId, vendorId)));
    await audit(db, vendorId, actor, "Submission Returned", reason, submissionId);
    return Response.json({ saved: true });
  }

  return Response.json({ error: "A Valid Vendor Action Is Required" }, { status: 400 });
}

function publicInvite(invite: typeof vendorInvites.$inferSelect) {
  return {
    id: invite.id,
    email: invite.email,
    expiresAt: invite.expiresAt,
    attempts: invite.attempts,
    verifiedAt: invite.verifiedAt,
    revokedAt: invite.revokedAt,
    createdAt: invite.createdAt,
  };
}

async function audit(
  db: ReturnType<(typeof import("../../../db"))["getDb"]>,
  vendorId: string,
  actor: { name: string; email: string },
  action: string,
  detail: string,
  submissionId = "",
) {
  await db.insert(vendorAudits).values({ vendorId, submissionId, actorName: actor.name, actorEmail: actor.email, action, detail });
}

async function reconcileVendorProjectHealth(
  db: ReturnType<(typeof import("../../../db"))["getDb"]>,
  vendorId: string,
  actor: { name: string; email: string },
) {
  const access = await db.select({ projectId: vendorProjectAccess.projectId }).from(vendorProjectAccess).where(eq(vendorProjectAccess.vendorId, vendorId));
  const { reconcileProjectHealthAfterUpdate } = await import("../project-health/route");
  for (const projectId of new Set(access.map((item) => item.projectId).filter((value) => value && !value.startsWith("MEFFORD-")))) {
    await reconcileProjectHealthAfterUpdate(projectId, actor);
  }
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function vendorEmailConnectionStatus() {
  const { operationalEmailConnection } = await import("../../../lib/operational-email");
  return (await operationalEmailConnection()).configured ? "Connected" : "Connection Required";
}

async function sendVendorInviteEmail(input: {
  email: string;
  vendorName: string;
  inviteLink: string;
  code: string;
  expiresAt: string;
}) {
  const delivery = await sendOperationalEmail({ to: input.email, subject: "Mefford Contracting Vendor Portal Invite", text: `${input.vendorName}\n\nOpen your controlled vendor portal: ${input.inviteLink}\nOne-time code: ${input.code}\nExpires: ${input.expiresAt}\n\nThis message cannot approve, post, or pay an invoice.`, idempotencyKey: `vendor-invite:${input.inviteLink}`, safeguards: { sendInvoice: false, postInvoice: false, releasePayment: false } });
  return delivery.outcome === "Provider Accepted" ? `Provider Accepted · ${delivery.providerReceiptId}` : delivery.outcome === "Deferred" ? "Delivery Deferred · Connection Required" : `${delivery.outcome} · ${delivery.error}`;
}
