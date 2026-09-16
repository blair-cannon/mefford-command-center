import { and, desc, eq, inArray } from "drizzle-orm";
import {
  commandRecords,
  commandWorkItems,
  companyMembers,
  projectFiles,
  projects,
  recordAudits,
  vendorAudits,
  vendorProfiles,
  vendorProjectAccess,
} from "../../../../db/schema";
import { ensureMyWorkTables } from "../../../../lib/my-work";
import {
  BID_PACKAGE_RECORD_TYPE,
  latestBid,
  normalizeBidPackageData,
  permanentBidFolder,
  type BidRevision,
} from "../../../../lib/procurement";
import { ensureVendorSchema, parseStringArray, vendorPortalSession } from "../../../../lib/vendor-portal";
import { roundMoney } from "../../../../lib/money.js";

type PortalBidInput = {
  action?: "ask-question" | "acknowledge-addendum" | "submit-bid";
  projectId?: string;
  recordId?: string;
  question?: string;
  addendumId?: string;
  total?: number;
  baseBid?: number;
  alternates?: string;
  allowances?: string;
  exclusions?: string;
  qualifications?: string;
  clarifications?: string;
  schedule?: string;
  scope?: string;
  fileId?: number;
  fileName?: string;
  ocrReviewConfirmed?: boolean;
  ocrExtractedPrice?: number;
  ocrExtractedScope?: string;
  ocrCharacterCount?: number;
  ocrCompletedAt?: string;
};

export async function GET(request: Request) {
  await ensureVendorSchema();
  const session = await vendorPortalSession(request);
  if (!session) return Response.json({ error: "Vendor Session Is Missing Or Expired" }, { status: 401 });
  const { getDb } = await import("../../../../db");
  const db = getDb();
  const access = await db.select().from(vendorProjectAccess).where(eq(vendorProjectAccess.vendorId, session.vendorId));
  const bidProjectIds = access.filter((item) => parseStringArray(item.permissionsJson).includes("Bid Submission") || parseStringArray(item.sharedRecordsJson).includes(BID_PACKAGE_RECORD_TYPE)).map((item) => item.projectId);
  const rows = bidProjectIds.length ? await db.select().from(commandRecords).where(and(inArray(commandRecords.projectId, bidProjectIds), eq(commandRecords.recordType, BID_PACKAGE_RECORD_TYPE))).orderBy(desc(commandRecords.updatedAt)) : [];
  const packages = rows.flatMap((row) => {
    const data = normalizeBidPackageData(parseData(row.dataJson));
    const bidder = data.bidders.find((item) => item.vendorId === session.vendorId);
    if (!bidder) return [];
    const now = new Date();
    const openUntil = bidder.reopenedUntil && new Date(bidder.reopenedUntil) > now ? bidder.reopenedUntil : data.deadline;
    const acceptingBids = row.status === "Open For Bids" && new Date(openUntil) > now;
    return [{
      id: row.id,
      projectId: row.projectId,
      title: row.title,
      status: acceptingBids ? row.status : row.status === "Open For Bids" ? "Deadline Locked" : row.status,
      trade: data.trade,
      costCode: data.costCode,
      scopeDescription: data.scopeDescription,
      deadline: data.deadline,
      openUntil,
      reopenedReason: bidder.reopenedReason,
      acceptingBids,
      bidInstructions: data.bidInstructions,
      addenda: data.addenda.map((item) => ({ ...item, acknowledged: bidder.acknowledgments.includes(item.id) })),
      publicAnswers: data.publicAnswers,
      questions: bidder.questions,
      revisions: bidder.revisions.map((revision) => ({ ...revision, fileId: revision.fileId, superseded: Boolean(revision.supersededByRevisionId) })),
      currentBid: latestBid(bidder),
      archive: { projectId: data.folderProjectId, category: data.folderCategory, retention: "Permanent Procurement Record" },
    }];
  });
  return Response.json({ packages, safeguards: { competitorBidsVisible: false, revisionsPermanent: true, deadlineLock: true, awardAuthority: "Mefford Company Owner" } });
}

export async function POST(request: Request) {
  await ensureVendorSchema();
  const session = await vendorPortalSession(request);
  if (!session) return Response.json({ error: "Vendor Session Is Missing Or Expired" }, { status: 401 });
  const input = await request.json() as PortalBidInput;
  const projectId = input.projectId?.trim() || "";
  const recordId = input.recordId?.trim() || "";
  const { getDb } = await import("../../../../db");
  const db = getDb();
  const access = await db.select().from(vendorProjectAccess).where(and(eq(vendorProjectAccess.vendorId, session.vendorId), eq(vendorProjectAccess.projectId, projectId))).limit(1);
  if (!access[0] || !parseStringArray(access[0].permissionsJson).includes("Bid Submission")) return Response.json({ error: "Controlled Bid Portal Access Is Required" }, { status: 403 });
  const rows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, recordId), eq(commandRecords.recordType, BID_PACKAGE_RECORD_TYPE))).limit(1);
  const row = rows[0];
  if (!row) return Response.json({ error: "Bid Package Not Found" }, { status: 404 });
  const data = normalizeBidPackageData(parseData(row.dataJson));
  const bidder = data.bidders.find((item) => item.vendorId === session.vendorId);
  const vendor = await db.select().from(vendorProfiles).where(eq(vendorProfiles.id, session.vendorId)).limit(1);
  if (!bidder || !vendor[0]) return Response.json({ error: "This Package Was Not Shared With Your Company" }, { status: 403 });
  const now = new Date();
  const nowIso = now.toISOString();

  if (input.action === "ask-question") {
    const question = input.question?.trim() || "";
    if (question.length < 8) return Response.json({ error: "Enter A Specific Bidder Question" }, { status: 400 });
    const item = { id: `BQ-${crypto.randomUUID()}`, question, askedAt: nowIso, status: "Pending Anonymized Answer" };
    bidder.questions.push(item);
    data.timeline.push({ action: "Bidder Question Received", actor: bidder.vendorName, at: nowIso, detail: `${item.id}; bidder identity is internal only.` });
    await saveBidPackage(db, row, data);
    await audit(db, row, vendor[0].contactName, session.email, "Bidder Question", `${item.id} received privately; any published answer must be anonymized for all bidders.`);
    await createProcurementWork(db, row, data, "Bidder Question", `${row.id} New Bidder Question`, "Publish an anonymized answer to every bidder.", nowIso);
    return Response.json({ saved: true, questionId: item.id }, { status: 201 });
  }

  if (input.action === "acknowledge-addendum") {
    const addendum = data.addenda.find((item) => item.id === input.addendumId);
    if (!addendum) return Response.json({ error: "Addendum Not Found" }, { status: 404 });
    if (!bidder.acknowledgments.includes(addendum.id)) bidder.acknowledgments.push(addendum.id);
    data.timeline.push({ action: `Addendum ${addendum.number} Acknowledged`, actor: bidder.vendorName, at: nowIso, detail: `${vendor[0].contactName} acknowledged through verified portal.` });
    await saveBidPackage(db, row, data);
    await audit(db, row, vendor[0].contactName, session.email, "Addendum Acknowledgment", `Addendum ${addendum.number} acknowledged.`);
    return Response.json({ saved: true });
  }

  if (input.action === "submit-bid") {
    const openUntil = bidder.reopenedUntil && new Date(bidder.reopenedUntil) > now ? bidder.reopenedUntil : data.deadline;
    if (row.status !== "Open For Bids" || new Date(openUntil) <= now) return Response.json({ error: "The Bid Deadline Is Locked. A PM Must Reopen It With An Audited Reason." }, { status: 423 });
    const total = roundMoney(input.total || 0);
    const baseBid = roundMoney(input.baseBid || total);
    const reviewedScope = input.scope?.trim() || "";
    const fileId = Number(input.fileId || 0);
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(baseBid) || baseBid <= 0 || !Number.isInteger(fileId) || fileId <= 0 || !input.fileName) return Response.json({ error: "Base Bid Total And Quote File Are Required" }, { status: 400 });
    if (!input.ocrReviewConfirmed || !input.ocrCompletedAt || reviewedScope.length < 10) return Response.json({ error: "OCR Price And Scope Must Be Reviewed Against The Quote Before Submission" }, { status: 400 });
    const file = await db.select().from(projectFiles).where(eq(projectFiles.id, fileId)).limit(1);
    if (!file[0] || file[0].projectId !== data.folderProjectId || !file[0].revision.includes(`${recordId} · ${session.vendorId}`)) return Response.json({ error: "The Controlled Quote File Does Not Match This Bid Package" }, { status: 409 });
    const prior = latestBid(bidder);
    const revision: BidRevision = {
      id: `BR-${crypto.randomUUID()}`,
      revision: bidder.revisions.length + 1,
      total,
      baseBid,
      alternates: input.alternates?.trim() || "",
      allowances: input.allowances?.trim() || "",
      exclusions: input.exclusions?.trim() || "",
      qualifications: input.qualifications?.trim() || "",
      clarifications: input.clarifications?.trim() || "",
      schedule: input.schedule?.trim() || "",
      fileId,
      fileName: input.fileName,
      receivedAt: nowIso,
      receivedBy: `${vendor[0].contactName} · Verified Vendor Portal`,
      supersedesRevisionId: prior?.id || "",
      supersededByRevisionId: "",
      ocr: {
        status: "Human Reviewed",
        engine: Number(input.ocrCharacterCount || 0) > 0 ? "PDF Text + Tesseract OCR" : "Manual Review · Original File Preserved",
        extractedPrice: Math.max(0, roundMoney(input.ocrExtractedPrice || 0)),
        extractedScope: input.ocrExtractedScope?.trim() || "",
        reviewedPrice: total,
        reviewedScope,
        reviewedBy: `${vendor[0].contactName} · Verified Vendor Portal`,
        reviewedAt: nowIso,
        completedAt: input.ocrCompletedAt,
        characterCount: Math.max(0, Number(input.ocrCharacterCount || 0)),
      },
    };
    if (prior) prior.supersededByRevisionId = revision.id;
    bidder.revisions.push(revision);
    bidder.invitationStatus = "Bid Received";
    bidder.portalStatus = "Portal Verified";
    bidder.leveling = { ...bidder.leveling, scopeComplete: false, exclusionsReviewed: false, alternatesReviewed: false, clarificationsComplete: false, budgetCompared: false, leveledAmount: total, completedBy: "", completedAt: "" };
    data.timeline.push({ action: prior ? "Bid Revision Received" : "Bid Received", actor: bidder.vendorName, at: nowIso, detail: `Revision ${revision.revision} · ${input.fileName} · OCR price and scope human-reviewed · permanently archived in ${data.folderCategory} / ${permanentBidFolder(data, recordId, bidder.vendorName, revision.revision)}.` });
    await saveBidPackage(db, row, data);
    await audit(db, row, vendor[0].contactName, session.email, prior ? "Bid Revision" : "Bid Submission", `${revision.id} · Revision ${revision.revision} · prior versions remain permanent.`);
    await db.insert(vendorAudits).values({ vendorId: bidder.vendorId, actorName: vendor[0].contactName, actorEmail: session.email, action: prior ? "Bid Revision Submitted" : "Bid Submitted", detail: `${projectId} · ${recordId} · Revision ${revision.revision} · ${input.fileName}. Competitor bids are never visible.` });
    await createProcurementWork(db, row, data, "Bid Received", `${row.id} ${bidder.vendorName} Bid Received`, `Revision ${revision.revision} is ready for scope leveling.`, nowIso);
    return Response.json({ saved: true, revisionId: revision.id, revision: revision.revision, notice: "Bid Received And Permanently Archived. No Award Or Commitment Was Created." }, { status: 201 });
  }

  return Response.json({ error: "A Valid Bid Portal Action Is Required" }, { status: 400 });
}

async function saveBidPackage(db: ReturnType<(typeof import("../../../../db"))["getDb"]>, row: typeof commandRecords.$inferSelect, data: ReturnType<typeof normalizeBidPackageData>) {
  const received = data.bidders.filter((item) => latestBid(item)).length;
  await db.update(commandRecords).set({ meta: `${data.trade} · ${received} Bid${received === 1 ? "" : "s"} · Target 3 · ${row.status}`, dataJson: JSON.stringify(data), updatedAt: new Date().toISOString() }).where(and(eq(commandRecords.projectId, row.projectId), eq(commandRecords.id, row.id)));
}

async function audit(db: ReturnType<(typeof import("../../../../db"))["getDb"]>, row: typeof commandRecords.$inferSelect, actorName: string, actorEmail: string, fieldName: string, summary: string) {
  await db.insert(recordAudits).values({ projectId: row.projectId, recordId: row.id, fieldName, oldValue: row.status, newValue: row.status, reason: summary, actorName, actorEmail, summary: `${row.id} · ${summary}` });
}

async function createProcurementWork(db: ReturnType<(typeof import("../../../../db"))["getDb"]>, row: typeof commandRecords.$inferSelect, data: ReturnType<typeof normalizeBidPackageData>, kind: string, title: string, message: string, nowIso: string) {
  await ensureMyWorkTables();
  const project = row.projectId === "MEFFORD-SALES" ? [] : await db.select().from(projects).where(eq(projects.number, row.projectId)).limit(1);
  const ownerName = project[0]?.projectManager || row.owner;
  const member = await db.select().from(companyMembers).where(eq(companyMembers.displayName, ownerName)).limit(1);
  const recipientEmail = member[0]?.email || "jmefford@meffcon.com";
  await db.insert(commandWorkItems).values({
    id: `BWI-${crypto.randomUUID()}`,
    dedupeKey: `procurement:${kind}:${row.projectId}:${row.id}:${data.timeline.at(-1)?.at || nowIso}:${recipientEmail}`,
    projectId: row.projectId,
    recipientName: ownerName,
    recipientEmail,
    kind,
    title,
    message,
    priority: "High",
    sourceType: BID_PACKAGE_RECORD_TYPE,
    sourceRecordId: row.id,
    actionTarget: row.projectId === "MEFFORD-SALES" ? "Bid Management" : "Procurement",
    dueAt: nowIso,
    createdBy: "Bidder Portal",
    updatedAt: nowIso,
  }).onConflictDoNothing({ target: commandWorkItems.dedupeKey });
}

function parseData(value: string) {
  try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {}; } catch { return {}; }
}
