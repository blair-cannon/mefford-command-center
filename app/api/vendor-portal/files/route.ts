import { and, eq } from "drizzle-orm";
import {
  commandRecords,
  projectFiles,
  vendorAudits,
  vendorComplianceDocuments,
  vendorProfiles,
  vendorSubmissions,
  vendorProjectAccess,
} from "../../../../db/schema";
import { ensureProjectFileSchema } from "../../../../lib/project-file-schema";
import {
  BID_PACKAGE_RECORD_TYPE,
  normalizeBidPackageData,
  permanentBidFolder,
} from "../../../../lib/procurement";
import { resolveCommandActor } from "../../../../lib/server-actor";
import { enforceOnboardingAccess } from "../../../../lib/onboarding";
import { normalizeUploadContentType, storedFileResponseHeaders } from "../../../../lib/photo-uploads";
import {
  ensureVendorSchema,
  VENDOR_DOCUMENT_KINDS,
  vendorInternalActor,
  vendorPortalSession,
  parseStringArray,
} from "../../../../lib/vendor-portal";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const EXPIRING_KINDS = new Set([
  "General Liability",
  "Workers Compensation",
  "Auto Liability",
  "Umbrella Insurance",
  "Trade License",
]);

type VendorFileRow = {
  vendorId: string;
  storageKey: string;
  fileName: string;
  contentType?: string | null;
  sizeBytes?: number | null;
};

export async function GET(request: Request) {
  await ensureVendorSchema();
  const search = new URL(request.url).searchParams;
  const documentId = search.get("documentId")?.trim() || "";
  const submissionId = search.get("submissionId")?.trim() || "";
  const designFileId = Number(search.get("designFileId"));
  const designRecordId = search.get("designRecordId")?.trim() || "";
  const designProjectId = search.get("designProjectId")?.trim() || "";
  const bidFileId = Number(search.get("bidFileId"));
  const bidRecordId = search.get("bidRecordId")?.trim() || "";
  const bidProjectId = search.get("bidProjectId")?.trim() || "";
  if (!documentId && !submissionId && !(Number.isInteger(designFileId) && designFileId > 0 && designRecordId && designProjectId) && !(Number.isInteger(bidFileId) && bidFileId > 0 && bidRecordId && bidProjectId)) return Response.json({ error: "A Controlled File Reference Is Required" }, { status: 400 });
  const { getDb } = await import("../../../../db");
  const db = getDb();
  const session = await vendorPortalSession(request);
  if (!session) {
    const onboardingLock = await enforceOnboardingAccess(request);
    if (onboardingLock) return onboardingLock;
  }
  const internalActor = session ? null : await vendorInternalActor(await resolveCommandActor(request));
  if (!session && !internalActor) return Response.json({ error: "Controlled File Access Is Required" }, { status: 403 });
  let row: VendorFileRow | null | undefined = documentId
    ? (await db.select({
        vendorId: vendorComplianceDocuments.vendorId,
        storageKey: vendorComplianceDocuments.storageKey,
        fileName: vendorComplianceDocuments.fileName,
        contentType: vendorComplianceDocuments.contentType,
        sizeBytes: vendorComplianceDocuments.sizeBytes,
      }).from(vendorComplianceDocuments).where(eq(vendorComplianceDocuments.id, documentId)).limit(1))[0]
    : submissionId ? (await db.select({
        vendorId: vendorSubmissions.vendorId,
        storageKey: vendorSubmissions.attachmentStorageKey,
        fileName: vendorSubmissions.attachmentName,
      }).from(vendorSubmissions).where(eq(vendorSubmissions.id, submissionId)).limit(1))[0] : null;
  if (designFileId && designRecordId && designProjectId) {
    const record = await db.select().from(commandRecords).where(eq(commandRecords.id, designRecordId)).limit(1);
    const data = record[0] ? parseDesignData(record[0].dataJson) : {};
    const versions = Array.isArray(data.versions) ? data.versions as Array<Record<string, unknown>> : [];
    if (!record[0] || record[0].projectId !== designProjectId || record[0].recordType !== "Design Packages" || String(data.consultantVendorId || "") !== session?.vendorId || !versions.some((version) => Number(version.fileId) === designFileId)) {
      return Response.json({ error: "Design File Not Found" }, { status: 404 });
    }
    const designFile = await db.select().from(projectFiles).where(eq(projectFiles.id, designFileId)).limit(1);
    if (!designFile[0]) return Response.json({ error: "Design File Not Found" }, { status: 404 });
    row = { vendorId: session?.vendorId || "", storageKey: designFile[0].storageKey, fileName: designFile[0].name, contentType: designFile[0].contentType, sizeBytes: designFile[0].sizeBytes };
  }
  if (bidFileId && bidRecordId && bidProjectId) {
    if (!session) return Response.json({ error: "Verified Bidder Access Is Required" }, { status: 403 });
    const records = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, bidProjectId), eq(commandRecords.id, bidRecordId), eq(commandRecords.recordType, BID_PACKAGE_RECORD_TYPE))).limit(1);
    const data = records[0] ? normalizeBidPackageData(parseDesignData(records[0].dataJson)) : null;
    const bidder = data?.bidders.find((item) => item.vendorId === session.vendorId);
    const allowedOwnFile = bidder?.revisions.some((revision) => revision.fileId === bidFileId);
    const allowedAddendum = data?.addenda.some((addendum) => addendum.attachmentFileId === bidFileId);
    if (!records[0] || !bidder || (!allowedOwnFile && !allowedAddendum)) return Response.json({ error: "Bid File Not Found" }, { status: 404 });
    const bidFile = await db.select().from(projectFiles).where(eq(projectFiles.id, bidFileId)).limit(1);
    if (!bidFile[0]) return Response.json({ error: "Bid File Not Found" }, { status: 404 });
    row = { vendorId: session.vendorId, storageKey: bidFile[0].storageKey, fileName: bidFile[0].name, contentType: bidFile[0].contentType, sizeBytes: bidFile[0].sizeBytes };
  }
  if (!row || (session && row.vendorId !== session.vendorId)) return Response.json({ error: "File Not Found" }, { status: 404 });
  const { env } = await import("cloudflare:workers");
  const object = await env.BUCKET.get(row.storageKey);
  if (!object) return Response.json({ error: "Stored File Not Found" }, { status: 404 });
  const contentType = String(row.contentType || object.httpMetadata?.contentType || "application/octet-stream");
  const sizeBytes = row.sizeBytes ?? object.size;
  return new Response(object.body, { headers: storedFileResponseHeaders({ name: row.fileName, contentType, sizeBytes }) });
}

function parseDesignData(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

export async function POST(request: Request) {
  await ensureVendorSchema();
  const session = await vendorPortalSession(request);
  if (!session) return Response.json({ error: "Vendor Session Is Missing Or Expired" }, { status: 401 });
  const form = await request.formData();
  const file = form.get("file");
  const uploadType = String(form.get("uploadType") || "Compliance");
  const kind = String(form.get("kind") || "").trim();
  const projectId = String(form.get("projectId") || "").trim();
  const recordId = String(form.get("recordId") || "").trim();
  const revisionLabel = String(form.get("revisionLabel") || "").trim();
  const effectiveDate = String(form.get("effectiveDate") || "").trim();
  const expirationDate = String(form.get("expirationDate") || "").trim();
  if (!(file instanceof File) || !file.name) {
    return Response.json({ error: "Choose A File To Upload" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return Response.json({ error: "Individual Portal Files Must Be 25 MB Or Smaller" }, { status: 413 });
  }
  const contentType = normalizeUploadContentType(file.name, file.type || inferredContentType(file.name));
  if (uploadType === "Compliance" && !VENDOR_DOCUMENT_KINDS.includes(kind as typeof VENDOR_DOCUMENT_KINDS[number])) {
    return Response.json({ error: "Choose A Valid Compliance Or Closeout Document Type" }, { status: 400 });
  }
  if (uploadType === "Compliance" && EXPIRING_KINDS.has(kind) && (!effectiveDate || !expirationDate)) {
    return Response.json({ error: "Effective And Expiration Dates Are Required For This Document" }, { status: 400 });
  }
  if (["Billing", "Collaboration", "Design Revision", "Bid Submission", "Quality Evidence", "Closeout Submission"].includes(uploadType) && !projectId) {
    return Response.json({ error: "A Project Is Required For This Supporting File" }, { status: 400 });
  }
  let designRecord: typeof commandRecords.$inferSelect | null = null;
  let bidRecord: typeof commandRecords.$inferSelect | null = null;
  let bidFolderProjectId = "";
  let bidRevisionNumber = 0;
  if (uploadType === "Quality Evidence") {
    const access = await (await import("../../../../db")).getDb().select().from(vendorProjectAccess).where(and(eq(vendorProjectAccess.vendorId, session.vendorId), eq(vendorProjectAccess.projectId, projectId))).limit(1);
    const permissions = access[0] ? parseStringArray(access[0].permissionsJson) : [];
    if (!permissions.some((permission) => permission.startsWith("Quality "))) return Response.json({ error: "Controlled Quality Portal Access Is Required" }, { status: 403 });
  }
  if (uploadType === "Closeout Submission") {
    if (!recordId) return Response.json({ error: "Assigned Closeout Requirement Is Required" }, { status: 400 });
    const access = await (await import("../../../../db")).getDb().select().from(vendorProjectAccess).where(and(eq(vendorProjectAccess.vendorId, session.vendorId), eq(vendorProjectAccess.projectId, projectId))).limit(1);
    if (!access[0] || !parseStringArray(access[0].permissionsJson).includes("Closeout Submission")) return Response.json({ error: "Controlled Closeout Portal Access Is Required" }, { status: 403 });
    const requirement = await (await import("../../../../db")).getDb().select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, recordId), eq(commandRecords.recordType, "Closeout Requirements"))).limit(1);
    const requirementData = requirement[0] ? parseDesignData(requirement[0].dataJson) : {};
    if (!requirement[0] || String(requirementData.vendorId || "") !== session.vendorId) return Response.json({ error: "This Closeout Requirement Was Not Assigned To Your Company" }, { status: 403 });
  }
  if (uploadType === "Design Revision") {
    if (!recordId || !revisionLabel) return Response.json({ error: "Design Package And Revision Label Are Required" }, { status: 400 });
    const access = await (await import("../../../../db")).getDb().select().from(vendorProjectAccess).where(and(eq(vendorProjectAccess.vendorId, session.vendorId), eq(vendorProjectAccess.projectId, projectId))).limit(1);
    if (!access[0] || !parseStringArray(access[0].permissionsJson).includes("Design Upload")) return Response.json({ error: "Controlled Design Upload Access Is Required" }, { status: 403 });
    const records = await (await import("../../../../db")).getDb().select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, recordId), eq(commandRecords.recordType, "Design Packages"))).limit(1);
    designRecord = records[0] || null;
    const designData = designRecord ? parseDesignData(designRecord.dataJson) : {};
    if (!designRecord || String(designData.consultantVendorId || "") !== session.vendorId) return Response.json({ error: "This Design Package Was Not Assigned To Your Company" }, { status: 403 });
    if (designData.basisOfSaleLocked === true) return Response.json({ error: "The Awarded Sales Design Snapshot Is Immutable" }, { status: 423 });
    const versions = Array.isArray(designData.versions) ? designData.versions as Array<Record<string, unknown>> : [];
    if (versions.some((item) => String(item.label || "").toLowerCase() === revisionLabel.toLowerCase())) return Response.json({ error: "That Revision Label Already Exists In This Package" }, { status: 409 });
  }
  if (uploadType === "Bid Submission") {
    if (!recordId) return Response.json({ error: "Bid Package Is Required" }, { status: 400 });
    const access = await (await import("../../../../db")).getDb().select().from(vendorProjectAccess).where(and(eq(vendorProjectAccess.vendorId, session.vendorId), eq(vendorProjectAccess.projectId, projectId))).limit(1);
    if (!access[0] || !parseStringArray(access[0].permissionsJson).includes("Bid Submission")) return Response.json({ error: "Controlled Bid Submission Access Is Required" }, { status: 403 });
    const records = await (await import("../../../../db")).getDb().select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, recordId), eq(commandRecords.recordType, BID_PACKAGE_RECORD_TYPE))).limit(1);
    bidRecord = records[0] || null;
    const bidData = bidRecord ? normalizeBidPackageData(parseDesignData(bidRecord.dataJson)) : null;
    const bidder = bidData?.bidders.find((item) => item.vendorId === session.vendorId);
    const now = new Date();
    const openUntil = bidder?.reopenedUntil && new Date(bidder.reopenedUntil) > now ? bidder.reopenedUntil : bidData?.deadline || "";
    if (!bidRecord || !bidder) return Response.json({ error: "This Bid Package Was Not Assigned To Your Company" }, { status: 403 });
    if (bidRecord.status !== "Open For Bids" || new Date(openUntil) <= now) return Response.json({ error: "The Bid Deadline Is Locked" }, { status: 423 });
    bidFolderProjectId = bidData!.folderProjectId;
    bidRevisionNumber = bidder.revisions.length + 1;
  }
  const safeName = file.name.replace(/[^a-zA-Z0-9._ -]+/g, "-");
  const storageKey = `vendors/${session.vendorId}/${uploadType.toLowerCase()}/${crypto.randomUUID()}-${safeName}`;
  const [{ env }, { getDb }] = await Promise.all([
    import("cloudflare:workers"),
    import("../../../../db"),
  ]);
  await env.BUCKET.put(storageKey, file.stream(), {
    httpMetadata: { contentType },
    customMetadata: {
      vendorId: session.vendorId,
      uploadedBy: session.email,
      category: uploadType === "Compliance"
        ? kind
        : uploadType === "Bid Submission"
          ? `Confidential Procurement · ${projectId} · ${recordId}`
          : uploadType === "Quality Evidence"
            ? `Quality Control · ${projectId} · ${recordId || "Portal Proposal"}`
          : `${uploadType} · ${projectId}`,
    },
  });
  const db = getDb();
  const vendor = await db.select().from(vendorProfiles).where(eq(vendorProfiles.id, session.vendorId)).limit(1);
  if (uploadType === "Compliance") {
    const id = `VCD-${crypto.randomUUID()}`;
    await db.insert(vendorComplianceDocuments).values({
      id,
      vendorId: session.vendorId,
      kind,
      effectiveDate: effectiveDate || null,
      expirationDate: expirationDate || null,
      storageKey,
      fileName: file.name,
      contentType,
      sizeBytes: file.size,
      status: "Pending Review",
    });
    await db.insert(vendorAudits).values({
      vendorId: session.vendorId,
      actorName: vendor[0]?.contactName || session.email,
      actorEmail: session.email,
      action: "Compliance Document Uploaded",
      detail: `${kind} · ${file.name} · Pending Mefford review.`,
    });
    return Response.json({ saved: true, documentId: id, fileName: file.name, status: "Pending Review" }, { status: 201 });
  }
  if (uploadType === "Design Revision" && designRecord) {
    await ensureProjectFileSchema();
    const designData = parseDesignData(designRecord.dataJson);
    const opportunityId = String(designData.opportunityId || "");
    const designFileProjectId = projectId === "MEFFORD-SALES" && opportunityId ? `ESTIMATE-${opportunityId}` : projectId;
    const designFileCategory = projectId === "MEFFORD-SALES" ? "02-Design & Drawings" : "Design & Drawings";
    const [saved] = await db.insert(projectFiles).values({
      projectId: designFileProjectId,
      name: file.name,
      category: designFileCategory,
      revision: `${recordId} · ${revisionLabel} · Consultant Upload`,
      storageKey,
      contentType,
      sizeBytes: file.size,
      uploadedBy: vendor[0]?.contactName || session.email,
      access: "Controlled Design Team",
    }).returning();
    await db.insert(vendorAudits).values({
      vendorId: session.vendorId,
      actorName: vendor[0]?.contactName || session.email,
      actorEmail: session.email,
      action: "Design Revision File Uploaded",
      detail: `${projectId} · ${recordId} · ${revisionLabel} · ${file.name}. Pending Mefford control review.`,
    });
    return Response.json({ saved: true, fileId: saved.id, fileName: saved.name }, { status: 201 });
  }
  if (uploadType === "Bid Submission" && bidRecord) {
    await ensureProjectFileSchema();
    const bidData = normalizeBidPackageData(parseDesignData(bidRecord.dataJson));
    const [saved] = await db.insert(projectFiles).values({
      projectId: bidFolderProjectId,
      name: file.name,
      category: bidData.folderCategory,
      revision: `${recordId} · ${session.vendorId} · ${permanentBidFolder(bidData, recordId, vendor[0]?.legalName || session.vendorId, bidRevisionNumber)} · Received ${new Date().toISOString()}`,
      storageKey,
      contentType,
      sizeBytes: file.size,
      uploadedBy: `${vendor[0]?.contactName || session.email} · Verified Bidder Portal`,
      access: "Confidential Procurement · Mefford And Submitting Bidder Only",
    }).returning();
    await db.insert(vendorAudits).values({
      vendorId: session.vendorId,
      actorName: vendor[0]?.contactName || session.email,
      actorEmail: session.email,
      action: "Permanent Bid File Uploaded",
      detail: `${projectId} · ${recordId} · Revision ${bidRevisionNumber} · ${file.name}. File cannot be deleted or replaced; a later bid supersedes it.`
    });
    return Response.json({ saved: true, fileId: saved.id, fileName: saved.name, revision: bidRevisionNumber }, { status: 201 });
  }
  if (uploadType === "Quality Evidence") {
    await ensureProjectFileSchema();
    const [saved] = await db.insert(projectFiles).values({
      projectId,
      name: file.name,
      category: "Quality Control / Portal Evidence",
      revision: `${recordId || "Quality Proposal"} · Permanent Portal Evidence · ${new Date().toISOString()}`,
      storageKey,
      contentType,
      sizeBytes: file.size,
      uploadedBy: `${vendor[0]?.contactName || session.email} · Verified Quality Portal`,
      access: "Project Quality Team + Submitting Company",
    }).returning();
    await db.insert(vendorAudits).values({ vendorId: session.vendorId, actorName: vendor[0]?.contactName || session.email, actorEmail: session.email, action: "Quality Evidence Uploaded", detail: `${projectId} · ${recordId || "New Proposal"} · ${file.name}. Permanent project-quality evidence.` });
    return Response.json({ saved: true, fileId: saved.id, fileName: saved.name }, { status: 201 });
  }
  if (uploadType === "Closeout Submission") {
    await ensureProjectFileSchema();
    const [saved] = await db.insert(projectFiles).values({
      projectId,
      name: file.name,
      category: "Closeout / Subcontractor Portal",
      revision: `${recordId} · Permanent Portal Version · ${new Date().toISOString()}`,
      storageKey,
      contentType,
      sizeBytes: file.size,
      uploadedBy: `${vendor[0]?.contactName || session.email} · ${vendor[0]?.legalName || session.vendorId}`,
      access: "Project Closeout Team + Submitting Company + Accepted Owner Package",
    }).returning();
    await db.insert(vendorAudits).values({ vendorId: session.vendorId, actorName: vendor[0]?.contactName || session.email, actorEmail: session.email, action: "Closeout File Uploaded", detail: `${projectId} · ${recordId} · ${file.name}. Permanent version pending controlled Mefford review.` });
    return Response.json({ saved: true, fileId: saved.id, fileName: saved.name }, { status: 201 });
  }
  await db.insert(vendorAudits).values({
    vendorId: session.vendorId,
    actorName: vendor[0]?.contactName || session.email,
    actorEmail: session.email,
    action: uploadType === "Collaboration" ? "Correspondence Support Uploaded" : "Billing Support Uploaded",
    detail: `${projectId} · ${file.name}.`,
  });
  return Response.json({ saved: true, storageKey, fileName: file.name }, { status: 201 });
}

function inferredContentType(fileName: string) {
  const extension = fileName.toLowerCase().split(".").pop() || "";
  return ({
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    tif: "image/tiff",
    tiff: "image/tiff",
    heic: "image/heic",
    heif: "image/heif",
    avif: "image/avif",
    bmp: "image/bmp",
    gif: "image/gif",
  } as Record<string, string>)[extension] || "application/octet-stream";
}
