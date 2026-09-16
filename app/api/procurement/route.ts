import { projectDesignationsFor } from "../../../lib/project-access";
import { and, desc, eq } from "drizzle-orm";
import {
  commandRecords,
  companyMembers,
  projectFiles,
  projects,
  recordAudits,
  vendorAudits,
  vendorInvites,
  vendorProfiles,
  vendorProjectAccess,
} from "../../../db/schema";
import {
  BID_PACKAGE_RECORD_TYPE,
  SALES_PROJECT_ID,
  bidderIsLeveled,
  buildOwnerScopeDraft,
  coverageSatisfied,
  emptyBidPackageData,
  latestBid,
  missingAddendumAcknowledgments,
  normalizeBidPackageData,
  type BidPackageData,
  type BidderRecord,
} from "../../../lib/procurement";
import { sendOperationalEmail } from "../../../lib/operational-email";
import {
  ESTIMATE_TEMPLATE_COST_CODES,
  calculateEstimateSummary,
  normalizeEstimateData,
} from "../../estimate-template";
import { enforceOnboardingAccess } from "../../../lib/onboarding";
import { getCommandActor, resolveCommandActor } from "../../../lib/server-actor";
import { complianceState, ensureVendorSchema, hashSecret, parseStringArray } from "../../../lib/vendor-portal";
import { roundMoney } from "../../../lib/money.js";
import { comparePackageQuotes, reviewQuoteScope } from "../../../lib/quote-comparison";

type Scope = "Sales" | "Project";
type ProcurementAction = {
  action?: string;
  scope?: Scope;
  projectId?: string;
  opportunityId?: string;
  recordId?: string;
  title?: string;
  trade?: string;
  costCode?: string;
  scopeDescription?: string;
  scopeNature?: BidPackageData["scopeNature"];
  budgetAmount?: number;
  deadline?: string;
  estimatedStart?: string;
  bidInstructions?: string;
  vendorId?: string;
  legalName?: string;
  vendorType?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  questionId?: string;
  question?: string;
  answer?: string;
  addendumTitle?: string;
  addendumBody?: string;
  attachmentFileId?: number;
  attachmentName?: string;
  coverageReason?: string;
  recommendationNarrative?: string;
  decision?: string;
  note?: string;
  commitmentType?: "Subcontract" | "Purchase Order";
  overrideReason?: string;
  reopenReason?: string;
  reopenUntil?: string;
  leveling?: BidderRecord["leveling"];
  ownerScopeDraft?: string;
  reason?: string;
  quote?: { fileId: number; reviewedPrice: number; reviewedScope: string; confirmed: boolean; extractedPrice?: number; extractedScope?: string; characterCount?: number; exclusions?: string; alternates?: string; allowances?: string; qualifications?: string; clarifications?: string; schedule?: string; acknowledgedAddenda?: string[] };
};

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  await ensureVendorSchema();
  const search = new URL(request.url).searchParams;
  const scope: Scope = search.get("scope") === "Sales" ? "Sales" : "Project";
  const projectId = scope === "Sales" ? SALES_PROJECT_ID : search.get("projectId")?.trim() || "";
  if (!projectId) return Response.json({ error: "Project Is Required" }, { status: 400 });
  const { getDb } = await import("../../../db");
  const db = getDb();
  const project = scope === "Project" ? await db.select().from(projects).where(eq(projects.number, projectId)).limit(1) : [];
  if (scope === "Project" && !project[0]) return Response.json({ error: "Project Not Found" }, { status: 404 });
  const permissions = await procurementPermissions(db, actor, project[0]);
  if (scope === "Sales" && !permissions.canManageSales) return Response.json({ error: "Sales Bid Management Requires Estimating Access" }, { status: 403 });
  if (scope === "Project" && !permissions.canViewProject) return Response.json({ error: "Project Procurement Access Is Required" }, { status: 403 });

  const [packageRows, opportunities, vendors, invites] = await Promise.all([
    db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, BID_PACKAGE_RECORD_TYPE))).orderBy(desc(commandRecords.updatedAt)),
    scope === "Sales" ? db.select().from(commandRecords).where(and(eq(commandRecords.projectId, SALES_PROJECT_ID), eq(commandRecords.recordType, "Sales Opportunities"))).orderBy(desc(commandRecords.updatedAt)) : Promise.resolve([]),
    db.select().from(vendorProfiles).orderBy(vendorProfiles.legalName),
    db.select().from(vendorInvites).orderBy(desc(vendorInvites.createdAt)),
  ]);
  const vendorOptions = await Promise.all(vendors.map(async (vendor) => {
    const compliance = await complianceState(db, vendor.id, scope === "Project" ? projectId : undefined);
    const invite = invites.find((item) => item.vendorId === vendor.id && !item.revokedAt && new Date(item.expiresAt) > new Date());
    return {
      id: vendor.id,
      name: vendor.legalName,
      type: vendor.vendorType,
      status: vendor.status,
      contactName: vendor.contactName,
      contactEmail: vendor.contactEmail,
      trades: parseStringArray(vendor.tradesJson),
      compliance: { blocked: compliance.paymentBlocked, paymentBlocked: compliance.paymentBlocked, temporaryApproval: Boolean(compliance.activeOverride), missing: compliance.missing, expired: compliance.expired },
      portalStatus: invite?.verifiedAt ? "Portal Verified" : invite ? "Invite Active" : "Invite Required",
    };
  }));
  return Response.json({
    scope,
    project: project[0] || null,
    permissions,
    controls: {
      bidTarget: 3,
      competitiveException: "Documented Exception With Company Owner Approval",
      biddingCompliance: "Allowed",
      awardCompliance: "Allowed; Payment Hold Only",
      confidentiality: "Mefford Sees Bids As Received; Bidders Never See Competitors",
      retention: "Permanent; New Versions Supersede But Never Delete",
      commitment: "Draft Only; Never Automatically Sent Or Executed",
    },
    opportunities: opportunities.map((row) => {
      const data = parseData(row.dataJson);
      return { id: row.id, title: row.title, stage: String(data.stage || row.status), company: String(data.company || ""), awardedProjectNumber: String(data.awardedProjectNumber || "") };
    }),
    vendorOptions,
    packages: packageRows.map((row) => { const data = normalizeBidPackageData(parseData(row.dataJson)); return { ...row, data, review: comparePackageQuotes(data), dataJson: undefined }; }),
  });
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  await ensureVendorSchema();
  const input = await request.json() as ProcurementAction;
  const scope: Scope = input.scope === "Sales" ? "Sales" : "Project";
  const projectId = scope === "Sales" ? SALES_PROJECT_ID : input.projectId?.trim() || "";
  const { getDb } = await import("../../../db");
  const db = getDb();
  const project = scope === "Project" ? await db.select().from(projects).where(eq(projects.number, projectId)).limit(1) : [];
  const permissions = await procurementPermissions(db, actor, project[0]);
  if (!projectId || (scope === "Sales" ? !permissions.canManageSales : !permissions.canManageProject)) {
    return Response.json({ error: "PM Or Estimator Procurement Access Is Required" }, { status: 403 });
  }
  const now = new Date();
  const nowIso = now.toISOString();

  if (input.action === "create-prospective-vendor") {
    const legalName = input.legalName?.trim() || "";
    const contactName = input.contactName?.trim() || "";
    const contactEmail = input.contactEmail?.trim().toLowerCase() || "";
    if (!legalName || !contactName || !validEmail(contactEmail)) return Response.json({ error: "Company Contact And Valid Email Are Required" }, { status: 400 });
    const existing = await db.select().from(vendorProfiles).where(eq(vendorProfiles.contactEmail, contactEmail)).limit(1);
    if (existing[0]) return Response.json({ error: "That Contact Email Already Belongs To A Vendor Directory Record" }, { status: 409 });
    const vendorId = `VND-${crypto.randomUUID()}`;
    await db.insert(vendorProfiles).values({
      id: vendorId,
      legalName,
      vendorType: ["Subcontractor", "Vendor", "Both"].includes(input.vendorType || "") ? input.vendorType! : "Subcontractor",
      status: "Prospective",
      contactName,
      contactEmail,
      contactPhone: input.contactPhone?.trim() || "",
      tradesJson: JSON.stringify(input.trade ? [input.trade] : []),
    });
    await db.insert(vendorAudits).values({ vendorId, actorName: actor.name, actorEmail: actor.email, action: "Prospective Vendor Created From Bid Management", detail: `${legalName} may bid, be awarded, receive a commitment, and work. Missing compliance creates a payment hold only.` });
    return Response.json({ saved: true, vendorId }, { status: 201 });
  }

  if (input.action === "create-package") {
    const title = input.title?.trim() || "";
    const trade = input.trade?.trim() || "";
    const deadline = input.deadline?.trim() || "";
    const scopeDescription = input.scopeDescription?.trim() || "";
    if (!title || !trade || !deadline || !scopeDescription || !Number.isFinite(Date.parse(deadline)) || new Date(deadline) <= now) return Response.json({ error: "Title Trade Future Deadline And Scope Are Required" }, { status: 400 });
    if (scope === "Sales" && !input.opportunityId) return Response.json({ error: "Choose A Sales Or Estimating Opportunity" }, { status: 400 });
    const id = await nextBidPackageId(db, projectId);
    const data = emptyBidPackageData({
      scope,
      opportunityId: input.opportunityId,
      projectId: scope === "Project" ? projectId : "",
      trade,
      costCode: input.costCode?.trim() || "Unassigned",
      scopeDescription,
      scopeNature: input.scopeNature || "Labor And Material",
      budgetAmount: roundMoney(input.budgetAmount || 0),
      deadline,
      estimatedStart: input.estimatedStart,
      bidInstructions: input.bidInstructions,
    });
    data.timeline.push({ action: "Bid Package Created", actor: actor.name, at: nowIso, detail: "Permanent procurement record started; no invitation sent." });
    await db.insert(commandRecords).values({
      projectId, id, recordType: BID_PACKAGE_RECORD_TYPE, title, owner: actor.name,
      due: deadline.slice(0, 10), status: "Draft", meta: `${trade} · 0 Invited · Target 3 Bids`,
      recordDate: nowIso.slice(0, 10), recordTime: nowIso.slice(11, 16), dataJson: JSON.stringify(data),
    });
    await audit(db, projectId, id, actor, "Bid Package", "None", "Draft", "Permanent bid package created without external distribution");
    return Response.json({ saved: true, recordId: id }, { status: 201 });
  }

  const recordId = input.recordId?.trim() || "";
  const rows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, recordId), eq(commandRecords.recordType, BID_PACKAGE_RECORD_TYPE))).limit(1);
  const row = rows[0];
  if (!row) return Response.json({ error: "Bid Package Not Found" }, { status: 404 });
  const data = normalizeBidPackageData(parseData(row.dataJson));

  if (input.action === "record-quote") {
    const quote = input.quote;
    if (!quote?.confirmed || !Number.isFinite(quote.reviewedPrice) || quote.reviewedPrice <= 0 || String(quote.reviewedScope || "").trim().length < 12) return Response.json({ error: "Confirm The Original Quote, A Positive Price, And Its Actual Scope" }, { status: 400 });
    if (data.ownerApproval?.decision === "Approved" || data.linkedCommitmentId) return Response.json({ error: "An Approved Award Cannot Be Repriced Through Quote Intake" }, { status: 423 });
    const vendor = (await db.select().from(vendorProfiles).where(eq(vendorProfiles.id, input.vendorId || "")).limit(1))[0];
    if (!vendor) return Response.json({ error: "Choose A Vendor Directory Company" }, { status: 400 });
    let bidder = data.bidders.find(item => item.vendorId === vendor.id);
    if (new Date(data.deadline) <= now && !(bidder?.reopenedUntil && new Date(bidder.reopenedUntil) > now)) return Response.json({ error: "The Bid Deadline Has Passed. Use An Audited Reopening First." }, { status: 423 });
    const file = (await db.select().from(projectFiles).where(and(eq(projectFiles.id, quote.fileId), eq(projectFiles.projectId, data.folderProjectId), eq(projectFiles.category, data.folderCategory))).limit(1))[0];
    if (!file) return Response.json({ error: "Upload The Original Quote To This Estimate's Quotes Folder First" }, { status: 400 });
    const recordedBidder = data.bidders.find(item => item.revisions.some(revision => revision.fileId === file.id));
    if (recordedBidder) {
      const recorded = latestBid(recordedBidder);
      const sameReview = recorded?.fileId === file.id && recordedBidder.vendorId === vendor.id
        && recorded.total === roundMoney(quote.reviewedPrice) && recorded.ocr?.reviewedScope === quote.reviewedScope.trim()
        && (["exclusions", "alternates", "allowances", "qualifications", "clarifications", "schedule"] as const).every(field => recorded[field] === String(quote[field] || ""))
        && (quote.acknowledgedAddenda || []).every(id => recordedBidder.acknowledgments.includes(id));
      if (sameReview) return Response.json({ saved: true, bidRevisionId: recorded.id, review: comparePackageQuotes(data), alreadyRecorded: true }, { status: 201 });
      return Response.json({ error: "This Original File Is Already Recorded. Upload A New Revision File For A Changed Quote Or Different Bidder." }, { status: 409 });
    }
    if (!bidder) {
      bidder = { vendorId: vendor.id, vendorName: vendor.legalName, contactName: vendor.contactName, contactEmail: vendor.contactEmail, invitedAt: "", invitationStatus: "Quote Received By Estimator", portalStatus: "Internal Intake", revisions: [], questions: [], acknowledgments: [], leveling: { scopeComplete: false, exclusionsReviewed: false, alternatesReviewed: false, clarificationsComplete: false, budgetCompared: false, leveledAmount: 0, notes: "", completedBy: "", completedAt: "" }, reopenedUntil: "", reopenedReason: "", reopenedBy: "" };
      data.bidders.push(bidder);
    }
    const previous = latestBid(bidder); const id = `QUOTE-${crypto.randomUUID()}`;
    if (previous) previous.supersededByRevisionId = id;
    bidder.revisions.push({ id, revision: bidder.revisions.length + 1, total: roundMoney(quote.reviewedPrice), baseBid: roundMoney(quote.reviewedPrice), alternates: String(quote.alternates || ""), allowances: String(quote.allowances || ""), exclusions: String(quote.exclusions || ""), qualifications: String(quote.qualifications || ""), clarifications: String(quote.clarifications || ""), schedule: String(quote.schedule || ""), fileId: file.id, fileName: file.name, receivedAt: nowIso, receivedBy: actor.name, supersedesRevisionId: previous?.id || "", supersededByRevisionId: "", ocr: { status: "Human Reviewed", engine: quote.characterCount ? "PDF Text + Tesseract OCR" : "Manual Review · Original File Preserved", extractedPrice: Number(quote.extractedPrice || 0), extractedScope: String(quote.extractedScope || ""), reviewedPrice: roundMoney(quote.reviewedPrice), reviewedScope: quote.reviewedScope.trim(), reviewedBy: actor.name, reviewedAt: nowIso, completedAt: nowIso, characterCount: Number(quote.characterCount || 0) } });
    bidder.acknowledgments = [...new Set([...bidder.acknowledgments, ...(quote.acknowledgedAddenda || []).filter(id => data.addenda.some(item => item.id === id))])];
    bidder.leveling = { scopeComplete: false, exclusionsReviewed: false, alternatesReviewed: false, clarificationsComplete: false, budgetCompared: false, leveledAmount: roundMoney(quote.reviewedPrice), notes: "", scopeResolution: "", completedBy: "", completedAt: "" };
    data.timeline.push({ action: "Original Quote Reviewed And Recorded", actor: actor.name, at: nowIso, detail: `${vendor.legalName} · revision ${bidder.revisions.length} · ${file.name}. Previous revisions retained; leveling reset.` });
    await savePackage(db, row, "Leveling", data, actor, "Quote Intake", `${vendor.legalName} original quote and review retained`);
    return Response.json({ saved: true, bidRevisionId: id, review: comparePackageQuotes(data) }, { status: 201 });
  }

  if (input.action === "decline-prepared-commitment") {
    if (scope !== "Project" || (!permissions.isPm && !permissions.isCompanyOwner)) {
      return Response.json({ error: "The Assigned PM Must Make This Buyout Decision" }, { status: 403 });
    }
    const reason = input.reason?.trim() || "";
    if (reason.length < 10) {
      return Response.json({ error: "Add A Specific Reason For Not Awarding This Contractor" }, { status: 400 });
    }
    if (!data.linkedCommitmentId) {
      return Response.json({ error: "No Prepared Commitment Draft Is Linked To This Bid Package" }, { status: 409 });
    }
    const recordType = data.commitmentType === "Purchase Order" ? "Purchase Orders" : "Subcontracts";
    const commitments = await db.select().from(commandRecords).where(and(
      eq(commandRecords.projectId, projectId),
      eq(commandRecords.id, data.linkedCommitmentId),
      eq(commandRecords.recordType, recordType),
    )).limit(1);
    const commitment = commitments[0];
    if (!commitment) {
      return Response.json({ error: "The Prepared Commitment Draft Could Not Be Found" }, { status: 409 });
    }
    if (!['Draft', 'Returned'].includes(commitment.status)) {
      return Response.json({ error: "Only An Unreleased Draft Can Be Marked Do Not Award" }, { status: 409 });
    }
    const commitmentData = parseData(commitment.dataJson);
    const commitmentTimeline = Array.isArray(commitmentData.timeline)
      ? commitmentData.timeline
      : [];
    await db.update(commandRecords).set({
      status: "Do Not Award",
      meta: `PM Decision · Do Not Award · ${reason}`,
      dateLocked: true,
      dataJson: JSON.stringify({
        ...commitmentData,
        awardDecision: "Do Not Award",
        doNotAwardReason: reason,
        decidedBy: actor.name,
        decidedAt: nowIso,
        automaticDistribution: false,
        timeline: [...commitmentTimeline, {
          action: "PM Chose Do Not Award",
          actor: actor.name,
          at: nowIso,
          detail: `${reason} Nothing was sent, released, or executed.`,
        }],
      }),
      updatedAt: nowIso,
    }).where(and(
      eq(commandRecords.projectId, projectId),
      eq(commandRecords.id, commitment.id),
      eq(commandRecords.recordType, recordType),
    ));
    data.commitmentDecision = {
      decision: "Do Not Award",
      reason,
      decidedBy: actor.name,
      decidedAt: nowIso,
    };
    data.timeline.push({
      action: "PM Chose Do Not Award",
      actor: actor.name,
      at: nowIso,
      detail: `${commitment.id} retained as a permanent inactive draft. ${reason}`,
    });
    await savePackage(db, row, "Buyout - Do Not Award", data, actor, "PM Buyout Decision", `Do not award · ${reason}`);
    await audit(db, projectId, commitment.id, actor, "PM Buyout Decision", "PM Decision Required", "Do Not Award", reason);
    return Response.json({ saved: true, commitmentId: commitment.id, status: "Do Not Award" });
  }

  if (input.action === "invite-bidder") {
    if (!["Draft", "Invitations Ready", "Open For Bids"].includes(row.status)) return Response.json({ error: "This Package No Longer Accepts New Invitations" }, { status: 409 });
    if (new Date(data.deadline) <= now) return Response.json({ error: "The Bid Deadline Is Locked. Update The Package Or Use An Audited PM Reopening." }, { status: 423 });
    const vendor = await db.select().from(vendorProfiles).where(eq(vendorProfiles.id, input.vendorId?.trim() || "")).limit(1);
    if (!vendor[0]) return Response.json({ error: "Create Or Select A Vendor Directory Record First" }, { status: 400 });
    if (data.bidders.some((item) => item.vendorId === vendor[0].id)) return Response.json({ error: "That Company Is Already Invited" }, { status: 409 });
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
    const inviteId = crypto.randomUUID();
    const expiresAt = new Date(Math.max(now.getTime() + 7 * 86_400_000, new Date(data.deadline).getTime() + 86_400_000)).toISOString();
    await db.insert(vendorInvites).values({ id: inviteId, vendorId: vendor[0].id, email: vendor[0].contactEmail.toLowerCase(), codeHash: await hashSecret(code), expiresAt, createdBy: actor.email });
    const portalLink = `${new URL(request.url).origin}/?vendorPortal=${inviteId}`;
    const bidder: BidderRecord = {
      vendorId: vendor[0].id, vendorName: vendor[0].legalName, contactName: vendor[0].contactName, contactEmail: vendor[0].contactEmail,
      invitedAt: nowIso, invitationStatus: "Invited", portalStatus: "Invite Active", revisions: [], questions: [], acknowledgments: [],
      leveling: { scopeComplete: false, exclusionsReviewed: false, alternatesReviewed: false, clarificationsComplete: false, budgetCompared: false, leveledAmount: 0, notes: "", completedBy: "", completedAt: "" },
      reopenedUntil: "", reopenedReason: "", reopenedBy: "",
    };
    data.bidders.push(bidder);
    data.timeline.push({ action: "Bidder Invited", actor: actor.name, at: nowIso, detail: `${vendor[0].legalName} invited through controlled portal. Bidding, award, commitment, and project work remain available; incomplete compliance holds payment only.` });
    await grantBidPortalAccess(db, { vendorId: vendor[0].id, projectId, projectName: scope === "Sales" ? "Mefford Sales & Estimating" : project[0]?.name || projectId, actorEmail: actor.email });
    await savePackage(db, row, data.bidders.length > 0 && row.status === "Draft" ? "Invitations Ready" : row.status, data, actor, "Bidder Invitation", `${vendor[0].legalName} invited`);
    await db.insert(vendorAudits).values({ vendorId: vendor[0].id, actorName: actor.name, actorEmail: actor.email, action: "Bid Invitation Issued", detail: `${recordId} · ${row.title} · Deadline ${data.deadline}. Competitor data is never shared.` });
    const emailDelivery = await sendBidEmail(request, { to: vendor[0].contactEmail, subject: `Mefford Bid Invitation · ${recordId} ${row.title}`, text: `${vendor[0].legalName}\n\nYou are invited to bid ${row.title}.\nDeadline: ${data.deadline}\nSecure portal: ${portalLink}\nOne-time code: ${code}\n\nAll revisions, questions, addenda, acknowledgments, and quotes remain permanent procurement records.` });
    return Response.json({ saved: true, vendorId: vendor[0].id, inviteId, oneTimeCode: code, emailDelivery }, { status: 201 });
  }

  if (input.action === "issue-package") {
    if (!data.bidders.length) return Response.json({ error: "Invite At Least One Bidder Before Issuing The Package" }, { status: 409 });
    if (new Date(data.deadline) <= now) return Response.json({ error: "Move The Deadline Into The Future Before Issuing" }, { status: 409 });
    data.timeline.push({ action: "Bid Package Issued", actor: actor.name, at: nowIso, detail: `${data.bidders.length} invited; target is three responsive bids.` });
    await savePackage(db, row, "Open For Bids", data, actor, "Bid Status", "Package issued to controlled bidders");
    return Response.json({ saved: true });
  }

  if (input.action === "publish-answer") {
    const question = input.question?.trim() || "";
    const answer = input.answer?.trim() || "";
    if (!question || !answer) return Response.json({ error: "An Anonymized Question And Answer Are Required" }, { status: 400 });
    const publicAnswer = { id: `QA-${crypto.randomUUID()}`, questionId: input.questionId || "", question, answer, issuedAt: nowIso, issuedBy: actor.name };
    data.publicAnswers.push(publicAnswer);
    data.bidders = data.bidders.map((bidder) => ({ ...bidder, questions: bidder.questions.map((item) => item.id === input.questionId ? { ...item, status: "Answered To All Bidders", publicAnswerId: publicAnswer.id } : item) }));
    data.timeline.push({ action: "Anonymized Bidder Answer Published", actor: actor.name, at: nowIso, detail: `${publicAnswer.id} shared equally; bidder identity withheld.` });
    await savePackage(db, row, row.status, data, actor, "Bidder Q&A", "Anonymized answer published to every bidder");
    await notifyBidders(request, data, `Bidder Q&A · ${recordId}`, `${question}\n\n${answer}`);
    return Response.json({ saved: true, answerId: publicAnswer.id });
  }

  if (input.action === "issue-addendum") {
    const title = input.addendumTitle?.trim() || "";
    const body = input.addendumBody?.trim() || "";
    if (!title || !body) return Response.json({ error: "Addendum Title And Complete Instructions Are Required" }, { status: 400 });
    const attachmentFileId = Number(input.attachmentFileId || 0);
    if (attachmentFileId) {
      const file = await db.select().from(projectFiles).where(eq(projectFiles.id, attachmentFileId)).limit(1);
      if (!file[0] || file[0].projectId !== data.folderProjectId || file[0].category !== data.folderCategory) return Response.json({ error: "The Addendum File Must Be Stored In This Package's Existing File Structure" }, { status: 409 });
    }
    const addendum = { id: `ADD-${crypto.randomUUID()}`, number: data.addenda.length + 1, title, body, issuedAt: nowIso, issuedBy: actor.name, attachmentFileId, attachmentName: input.attachmentName?.trim() || "" };
    data.addenda.push(addendum);
    data.timeline.push({ action: `Addendum ${addendum.number} Issued`, actor: actor.name, at: nowIso, detail: `${title}; acknowledgment required from every bidder.` });
    await savePackage(db, row, row.status, data, actor, "Addendum", `Addendum ${addendum.number} issued to all bidders`);
    await notifyBidders(request, data, `Addendum ${addendum.number} · ${recordId}`, `${title}\n\n${body}\n\nAcknowledge in the secure portal before your bid can be responsive.`);
    return Response.json({ saved: true, addendumId: addendum.id });
  }

  if (input.action === "update-leveling") {
    const vendorId = input.vendorId?.trim() || "";
    const bidder = data.bidders.find((item) => item.vendorId === vendorId);
    if (!bidder || !latestBid(bidder) || !input.leveling) return Response.json({ error: "Choose A Bidder With A Received Bid" }, { status: 400 });
    if (!Number.isFinite(input.leveling.leveledAmount) || input.leveling.leveledAmount <= 0) return Response.json({ error: "Enter A Positive Comparable Price" }, { status: 400 });
    bidder.leveling = { ...bidder.leveling, ...input.leveling, scopeComplete: input.leveling.scopeComplete === true, exclusionsReviewed: input.leveling.exclusionsReviewed === true, alternatesReviewed: input.leveling.alternatesReviewed === true, clarificationsComplete: input.leveling.clarificationsComplete === true, budgetCompared: input.leveling.budgetCompared === true, leveledAmount: roundMoney(input.leveling.leveledAmount), completedBy: actor.name, completedAt: nowIso };
    data.timeline.push({ action: "Scope Leveling Updated", actor: actor.name, at: nowIso, detail: `${bidder.vendorName} · ${bidderIsLeveled(bidder) ? "All mandatory checks complete" : "Incomplete"}.` });
    await savePackage(db, row, "Leveling", data, actor, "Scope Leveling", `${bidder.vendorName} leveling saved permanently`);
    return Response.json({ saved: true, complete: bidderIsLeveled(bidder) });
  }

  if (input.action === "select-proposal-basis") {
    if (scope !== "Sales") return Response.json({ error: "Proposal Basis Selection Is Available During Estimating" }, { status: 409 });
    const bidder = data.bidders.find((item) => item.vendorId === input.vendorId);
    const bid = bidder ? latestBid(bidder) : null;
    if (!bidder || !bid) return Response.json({ error: "Choose A Contractor With A Received Quote" }, { status: 400 });
    if (bid.ocr?.status !== "Human Reviewed") return Response.json({ error: "Price And Scope Must Be Human Reviewed Against The Original Quote First" }, { status: 409 });
    if (!bidderIsLeveled(bidder)) return Response.json({ error: "Complete The Scope Price Exclusions Alternates Clarifications And Budget Comparison First" }, { status: 409 });
    const review = reviewQuoteScope(data, bidder);
    if (!review.eligible) return Response.json({ error: review.issues.join(". ") }, { status: 409 });
    const opportunityId = data.opportunityId.trim();
    const opportunityRows = await db.select().from(commandRecords).where(and(
      eq(commandRecords.projectId, SALES_PROJECT_ID),
      eq(commandRecords.id, opportunityId),
      eq(commandRecords.recordType, "Sales Opportunities"),
    )).limit(1);
    const opportunity = opportunityRows[0];
    if (!opportunity) return Response.json({ error: "The Linked Sales Opportunity Could Not Be Found" }, { status: 409 });
    const opportunityData = parseData(opportunity.dataJson);
    const estimate = normalizeEstimateData(opportunityData.estimate);
    if (estimate.status === "Awarded") return Response.json({ error: "The Awarded Estimate Is Locked. Manage This Scope In Project Procurement." }, { status: 423 });
    const estimateLineKey = resolveEstimateLineKey(data.costCode, data.trade);
    if (!estimateLineKey) return Response.json({ error: "Assign A Valid Estimate Cost Code Before Selecting The Proposal Basis" }, { status: 409 });
    const selectedPrice = roundMoney(bidder.leveling.leveledAmount);
    const previousEntry = estimate.entries[estimateLineKey] || { quantity: 1, unit: "LS", material: 0, labor: 0, equipment: 0, subcontract: 0, other: 0 };
    const previousPrice = Number(previousEntry.subcontract || 0);
    const ownerScopeDraft = input.ownerScopeDraft?.trim() || buildOwnerScopeDraft(data, bidder);
    data.proposalBasis = {
      vendorId: bidder.vendorId,
      vendorName: bidder.vendorName,
      bidRevisionId: bid.id,
      bidRevision: bid.revision,
      selectedPrice,
      sourceScope: bid.ocr.reviewedScope,
      ownerScopeDraft,
      estimateLineKey,
      selectedBy: actor.name,
      selectedAt: nowIso,
    };
    const sourceSelections = opportunityData.estimateSourceSelections && typeof opportunityData.estimateSourceSelections === "object" && !Array.isArray(opportunityData.estimateSourceSelections)
      ? opportunityData.estimateSourceSelections as Record<string, { bidPackageId: string; selectedPrice: number; estimateLineKey?: string }>
      : {};
    const previousSelection = Object.values(sourceSelections).find(item => item.bidPackageId === row.id);
    const subcontract = roundMoney(previousPrice - Number(previousSelection?.selectedPrice || 0) + selectedPrice);
    const nextEstimate = {
      ...estimate,
      status: "Draft" as const,
      approvedAt: undefined,
      approvedBy: undefined,
      savedAt: nowIso,
      savedBy: actor.name,
      entries: {
        ...estimate.entries,
        [estimateLineKey]: { ...previousEntry, quantity: previousEntry.quantity || 1, unit: previousEntry.unit || "LS", subcontract },
      },
      entryOverrides: { ...estimate.entryOverrides, [estimateLineKey]: [...new Set([...(estimate.entries[estimateLineKey] ? estimate.entryOverrides[estimateLineKey] || ["quantity", "unit", "material", "labor", "equipment", "subcontract", "other"] as const : []), "subcontract" as const])] },
    };
    const estimateSummary = calculateEstimateSummary(nextEstimate);
    const nextOpportunityData = {
      ...opportunityData,
      estimateStatus: "In Progress",
      estimatedValue: estimateSummary.contractValue.toFixed(2),
      estimate: nextEstimate,
      estimateSourceSelections: {
        ...Object.fromEntries(Object.entries(sourceSelections).filter(([, item]) => item.bidPackageId !== row.id)),
        [row.id]: { bidPackageId: row.id, estimateLineKey, vendorId: bidder.vendorId, vendorName: bidder.vendorName, bidRevisionId: bid.id, selectedPrice, selectedBy: actor.name, selectedAt: nowIso },
      },
    };
    data.timeline.push({ action: "Estimate & Proposal Basis Selected", actor: actor.name, at: nowIso, detail: `${bidder.vendorName} · Revision ${bid.revision} · ${estimateLineKey} changed from ${money(previousPrice)} to ${money(selectedPrice)}. Internal pricing selection only; no award, commitment, or message was created.` });
    try {
      await persistEstimateSelection(row, data, opportunity, nextOpportunityData, actor, nowIso);
    } catch { return Response.json({ error: "The Estimate Or Quote Changed While Saving. Reload And Select Again; No Partial Selection Was Saved." }, { status: 409 }); }
    return Response.json({ saved: true, estimateLineKey, selectedPrice, estimateContractValue: estimateSummary.contractValue });
  }

  if (input.action === "request-coverage-exception") {
    const reason = input.coverageReason?.trim() || "";
    if (reason.length < 12) return Response.json({ error: "A Specific Documented Competitive-Bid Exception Is Required" }, { status: 400 });
    data.coverageException = { reason, requestedBy: actor.name, requestedAt: nowIso, approvedBy: "", approvedAt: "" };
    data.timeline.push({ action: "Bid Coverage Exception Requested", actor: actor.name, at: nowIso, detail: `${data.bidders.filter((item) => latestBid(item)).length} bids received; Owner approval required.` });
    await savePackage(db, row, "Owner Approval", data, actor, "Competitive Coverage", "Owner exception approval requested");
    return Response.json({ saved: true });
  }

  if (input.action === "approve-coverage-exception") {
    if (!permissions.isCompanyOwner) return Response.json({ error: "Only The Company Owner May Approve A Bid Coverage Exception" }, { status: 403 });
    if (!data.coverageException?.reason) return Response.json({ error: "No Documented Exception Is Awaiting Approval" }, { status: 409 });
    data.coverageException = { ...data.coverageException, approvedBy: actor.name, approvedAt: nowIso };
    data.timeline.push({ action: "Bid Coverage Exception Approved", actor: actor.name, at: nowIso, detail: data.coverageException.reason });
    await savePackage(db, row, "Leveling", data, actor, "Competitive Coverage", "Company Owner approved documented exception");
    return Response.json({ saved: true });
  }

  if (input.action === "reopen-bidding") {
    if (!permissions.isPm && !permissions.isCompanyOwner) return Response.json({ error: "Only A PM May Reopen Locked Bidding" }, { status: 403 });
    const bidder = data.bidders.find((item) => item.vendorId === input.vendorId);
    const reason = input.reopenReason?.trim() || "";
    const until = input.reopenUntil?.trim() || "";
    if (!bidder || reason.length < 10 || !until || new Date(until) <= now) return Response.json({ error: "Bidder Audited Reason And Future Reopen Deadline Are Required" }, { status: 400 });
    bidder.reopenedReason = reason; bidder.reopenedUntil = new Date(until).toISOString(); bidder.reopenedBy = actor.name;
    data.timeline.push({ action: "Bid Window Reopened", actor: actor.name, at: nowIso, detail: `${bidder.vendorName} until ${bidder.reopenedUntil} · ${reason}` });
    await savePackage(db, row, row.status, data, actor, "Bid Reopening", `${bidder.vendorName} reopened with audited reason`);
    return Response.json({ saved: true });
  }

  if (input.action === "recommend-award") {
    const bidder = data.bidders.find((item) => item.vendorId === input.vendorId);
    const narrative = input.recommendationNarrative?.trim() || "";
    if (!bidder || !latestBid(bidder) || narrative.length < 10) return Response.json({ error: "Choose A Bidder And Provide The Award Recommendation Basis" }, { status: 400 });
    if (data.proposalBasis && data.proposalBasis.vendorId !== bidder.vendorId) return Response.json({ error: "The Award Recommendation Must Match The Estimate And Proposal Basis. Change The Basis First If The Contractor Changed." }, { status: 409 });
    if (!coverageSatisfied(data)) return Response.json({ error: "Three Responsive Bids Or An Owner-Approved Coverage Exception Is Required" }, { status: 409 });
    if (!bidderIsLeveled(bidder)) return Response.json({ error: "Scope Exclusions Alternates Clarifications And Budget Comparison Must Be Leveled" }, { status: 409 });
    if (missingAddendumAcknowledgments(data, bidder).length) return Response.json({ error: "The Recommended Bidder Must Acknowledge Every Addendum" }, { status: 409 });
    const compliance = await complianceState(db, bidder.vendorId, scope === "Project" ? projectId : undefined);
    data.recommendation = { vendorId: bidder.vendorId, vendorName: bidder.vendorName, narrative, submittedBy: actor.name, submittedAt: nowIso };
    data.timeline.push({ action: "Award Recommendation Submitted", actor: actor.name, at: nowIso, detail: `${bidder.vendorName} · Company Owner approval required${compliance.paymentBlocked ? " · Vendor payment hold remains visible" : ""}.` });
    await savePackage(db, row, "Owner Approval", data, actor, "Award Recommendation", `${bidder.vendorName} recommended for Company Owner decision`);
    return Response.json({ saved: true });
  }

  if (input.action === "owner-decision") {
    if (!permissions.isCompanyOwner) return Response.json({ error: "Every Bid Award Requires The Company Owner" }, { status: 403 });
    if (!data.recommendation || !["Approved", "Returned"].includes(input.decision || "")) return Response.json({ error: "Recommendation And Owner Decision Are Required" }, { status: 400 });
    const recommended = data.bidders.find((item) => item.vendorId === data.recommendation?.vendorId);
    if (!recommended) return Response.json({ error: "Recommended Bidder Not Found" }, { status: 409 });
    const compliance = await complianceState(db, recommended.vendorId, scope === "Project" ? projectId : undefined);
    data.ownerApproval = { decision: input.decision!, note: input.note?.trim() || "", ownerName: actor.name, ownerEmail: actor.email, decidedAt: nowIso };
    data.timeline.push({ action: `Owner ${input.decision}`, actor: actor.name, at: nowIso, detail: `${input.note?.trim() || data.recommendation.narrative}${input.decision === "Approved" && compliance.paymentBlocked ? " · Payment hold retained until compliance or temporary approval" : ""}` });
    await savePackage(db, row, input.decision === "Approved" ? "PM Commitment Confirmation" : "Returned To PM", data, actor, "Owner Award Decision", input.decision!);
    return Response.json({ saved: true });
  }

  if (input.action === "confirm-commitment") {
    if (!permissions.isPm && !permissions.isCompanyOwner) return Response.json({ error: "The PM Must Confirm The Resulting Commitment Type" }, { status: 403 });
    if (data.ownerApproval?.decision !== "Approved" || !data.recommendation) return Response.json({ error: "Company Owner Approval Is Required Before Commitment Creation" }, { status: 409 });
    const commitmentType = input.commitmentType;
    if (!commitmentType) return Response.json({ error: "Confirm Subcontract Or Purchase Order" }, { status: 400 });
    if (commitmentType !== data.commitmentRecommendation && (input.overrideReason?.trim() || "").length < 8) return Response.json({ error: "Explain Why The PM Is Overriding The System Recommendation" }, { status: 400 });
    const bidder = data.bidders.find((item) => item.vendorId === data.recommendation?.vendorId)!;
    const compliance = await complianceState(db, bidder.vendorId, scope === "Project" ? projectId : undefined);
    data.commitmentType = commitmentType;
    data.commitmentOverrideReason = input.overrideReason?.trim() || "";
    if (scope === "Sales") {
      data.timeline.push({ action: "Commitment Type Confirmed", actor: actor.name, at: nowIso, detail: `${commitmentType}; draft will be created during project award handoff. Nothing sent automatically.${compliance.paymentBlocked ? " Vendor payment hold remains active." : ""}` });
      await savePackage(db, row, "Awarded Pending Project Handoff", data, actor, "Commitment Type", `${commitmentType} confirmed pending project award`);
      return Response.json({ saved: true, pendingProjectHandoff: true });
    }
    const latest = latestBid(bidder)!;
    const recordType = commitmentType === "Subcontract" ? "Subcontracts" : "Purchase Orders";
    const prefix = commitmentType === "Subcontract" ? "SC" : "PO";
    const commitmentId = await nextCommitmentId(db, projectId, recordType, prefix);
    await db.insert(commandRecords).values({
      projectId, id: commitmentId, recordType, title: `${bidder.vendorName} · ${row.title}`, owner: actor.name,
      due: nowIso.slice(0, 10), status: "Draft", meta: `${row.id} Award · ${latest.total.toFixed(2)} · Never Automatically Sent`,
      recordDate: nowIso.slice(0, 10), dataJson: JSON.stringify({ vendor: bidder.vendorName, vendorId: bidder.vendorId, amount: latest.total, costCode: data.costCode, trade: data.trade, sourceBidPackageId: row.id, sourceBidRevisionId: latest.id, procurementArchiveProjectId: data.folderProjectId, scope: data.scopeDescription, ownerApproval: data.ownerApproval, status: "Draft", automaticDistribution: false, vendorPaymentHold: compliance.paymentBlocked }),
    });
    data.linkedCommitmentId = commitmentId;
    data.timeline.push({ action: `Draft ${commitmentType} Created`, actor: actor.name, at: nowIso, detail: `${commitmentId}; review and separate lifecycle required. Nothing sent or executed.${compliance.paymentBlocked ? " Vendor payment hold remains active." : ""}` });
    await savePackage(db, row, "Awarded", data, actor, "Commitment Draft", `${commitmentId} created from approved bid`);
    return Response.json({ saved: true, commitmentId });
  }

  return Response.json({ error: "A Valid Procurement Action Is Required" }, { status: 400 });
}

async function procurementPermissions(db: ReturnType<(typeof import("../../../db"))["getDb"]>, actor: ReturnType<typeof getCommandActor>, project?: typeof projects.$inferSelect) {
  const member = actor.email ? await db.select().from(companyMembers).where(eq(companyMembers.email, actor.email)).limit(1) : [];
  const designations = parseStringArray(member[0]?.designationsJson || "[]");
  const accessLevel = member[0]?.companyAccessLevel || actor.accessLevel;
  const elevated = ["Company Owner", "Administrator"].includes(accessLevel);
  const isCompanyOwner = accessLevel === "Company Owner";
  const isPm = project ? (await projectDesignationsFor(db, actor, project, designations)).includes("Project Manager") : false;
  const isEstimator = designations.includes("Estimator");
  return { canManageSales: elevated || isEstimator, canViewProject: elevated || isPm || designations.includes("Office Staff"), canManageProject: elevated || isPm, isCompanyOwner, isPm, isEstimator };
}

function resolveEstimateLineKey(costCode: string, trade: string) {
  const raw = String(costCode || "").trim();
  const [parentCode, childCode] = raw.split(":").map((item) => item.trim());
  const line = ESTIMATE_TEMPLATE_COST_CODES.find((item) => item.code === parentCode)
    || (!raw ? ESTIMATE_TEMPLATE_COST_CODES.find((item) => item.description.toLowerCase() === String(trade || "").trim().toLowerCase() && item.calculation === "direct_cost" && item.budgetable) : undefined);
  if (!line || line.calculation !== "direct_cost" || !line.budgetable) return "";
  if (!childCode) return line.code;
  return line.children.some((child) => child.code === childCode) ? `${line.code}:${childCode}` : "";
}

async function nextBidPackageId(db: ReturnType<(typeof import("../../../db"))["getDb"]>, projectId: string) {
  const rows = await db.select({ id: commandRecords.id }).from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, BID_PACKAGE_RECORD_TYPE)));
  const next = rows.reduce((max, item) => Math.max(max, Number(item.id.match(/(\d+)$/)?.[1] || 0)), 0) + 1;
  return `BID-${String(next).padStart(3, "0")}`;
}

async function nextCommitmentId(db: ReturnType<(typeof import("../../../db"))["getDb"]>, projectId: string, recordType: string, prefix: string) {
  const rows = await db.select({ id: commandRecords.id }).from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, recordType)));
  const next = rows.reduce((max, item) => Math.max(max, Number(item.id.match(/(\d+)$/)?.[1] || 0)), 0) + 1;
  return `${prefix}-${String(next).padStart(3, "0")}`;
}

async function grantBidPortalAccess(db: ReturnType<(typeof import("../../../db"))["getDb"]>, input: { vendorId: string; projectId: string; projectName: string; actorEmail: string }) {
  const id = `${input.vendorId}:${input.projectId}`;
  const existing = await db.select().from(vendorProjectAccess).where(eq(vendorProjectAccess.id, id)).limit(1);
  const permissions = new Set(existing[0] ? parseStringArray(existing[0].permissionsJson) : []); permissions.add("Bid Submission");
  const shared = new Set(existing[0] ? parseStringArray(existing[0].sharedRecordsJson) : []); shared.add(BID_PACKAGE_RECORD_TYPE);
  await db.insert(vendorProjectAccess).values({ id, vendorId: input.vendorId, projectId: input.projectId, projectName: input.projectName, status: "Bidding", trade: existing[0]?.trade || "Prospective Bidder", contractReference: existing[0]?.contractReference || "", costCode: existing[0]?.costCode || "Unassigned", committedAmount: existing[0]?.committedAmount || "0", permissionsJson: JSON.stringify([...permissions]), sharedRecordsJson: JSON.stringify([...shared]), grantedBy: input.actorEmail, updatedAt: new Date().toISOString() }).onConflictDoUpdate({ target: vendorProjectAccess.id, set: { projectName: input.projectName, permissionsJson: JSON.stringify([...permissions]), sharedRecordsJson: JSON.stringify([...shared]), updatedAt: new Date().toISOString() } });
}

async function savePackage(db: ReturnType<(typeof import("../../../db"))["getDb"]>, row: typeof commandRecords.$inferSelect, status: string, data: BidPackageData, actor: { name: string; email: string }, field: string, summary: string) {
  const bidCount = data.bidders.filter((item) => latestBid(item)).length;
  const { env } = await import("cloudflare:workers");
  const guard = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO estimate_write_guards (id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM command_records WHERE project_id=? AND id=? AND data_json=?) THEN 1 ELSE 0 END").bind(guard, row.projectId, row.id, row.dataJson),
    env.DB.prepare("UPDATE command_records SET status=?,due=?,meta=?,data_json=?,updated_at=? WHERE project_id=? AND id=?").bind(status, data.deadline.slice(0, 10), `${data.trade} · ${bidCount} Bid${bidCount === 1 ? "" : "s"} · Target 3 · ${status}`, JSON.stringify(data), new Date().toISOString(), row.projectId, row.id),
    env.DB.prepare("INSERT INTO record_audits (project_id,record_id,field_name,old_value,new_value,reason,actor_name,actor_email,summary) VALUES (?,?,?,?,?,?,?,?,?)").bind(row.projectId, row.id, field, row.status, status, summary, actor.name, actor.email, `${row.id} · ${summary}`),
    env.DB.prepare("DELETE FROM estimate_write_guards WHERE id=?").bind(guard),
  ]);
  if (!row.projectId.startsWith("MEFFORD-")) {
    const { reconcileProjectHealthAfterUpdate } = await import("../project-health/route");
    await reconcileProjectHealthAfterUpdate(row.projectId, actor);
  }
}

async function persistEstimateSelection(row: typeof commandRecords.$inferSelect, data: BidPackageData, opportunity: typeof commandRecords.$inferSelect, nextOpportunity: Record<string, unknown>, actor: { name: string; email: string }, now: string) {
  const { env } = await import("cloudflare:workers");
  const guard = crypto.randomUUID();
  const summary = `${row.id} · ${data.proposalBasis?.vendorName} · ${data.proposalBasis?.bidRevisionId} selected for ${data.proposalBasis?.estimateLineKey}`;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO estimate_write_guards (id,valid) SELECT ?, CASE WHEN EXISTS(SELECT 1 FROM command_records WHERE project_id=? AND id=? AND data_json=?) AND EXISTS(SELECT 1 FROM command_records WHERE project_id=? AND id=? AND data_json=?) THEN 1 ELSE 0 END").bind(guard, row.projectId, row.id, row.dataJson, opportunity.projectId, opportunity.id, opportunity.dataJson),
    env.DB.prepare("UPDATE command_records SET data_json=?,updated_at=? WHERE project_id=? AND id=?").bind(JSON.stringify(nextOpportunity), now, opportunity.projectId, opportunity.id),
    env.DB.prepare("UPDATE command_records SET data_json=?,status=?,meta=?,updated_at=? WHERE project_id=? AND id=?").bind(JSON.stringify(data), "Proposal Basis Selected", `${data.trade} · ${data.bidders.filter(item => latestBid(item)).length} Bids · Proposal Basis Selected`, now, row.projectId, row.id),
    ...[row.id, opportunity.id].map(id => env.DB.prepare("INSERT INTO record_audits (project_id,record_id,field_name,old_value,new_value,reason,actor_name,actor_email,summary) VALUES (?,?,?,?,?,?,?,?,?)").bind(row.projectId, id, "Estimate And Proposal Basis", "Previous Selection", "Proposal Basis Selected", summary, actor.name, actor.email, summary)),
    env.DB.prepare("DELETE FROM estimate_write_guards WHERE id=?").bind(guard),
  ]);
}

async function audit(db: ReturnType<(typeof import("../../../db"))["getDb"]>, projectId: string, recordId: string, actor: { name: string; email: string }, fieldName: string, oldValue: string, newValue: string, summary: string) {
  await db.insert(recordAudits).values({ projectId, recordId, fieldName, oldValue, newValue, reason: summary, actorName: actor.name, actorEmail: actor.email, summary: `${recordId} · ${summary}` });
  if (!projectId.startsWith("MEFFORD-")) {
    const { reconcileProjectHealthAfterUpdate } = await import("../project-health/route");
    await reconcileProjectHealthAfterUpdate(projectId, actor);
  }
}

async function notifyBidders(request: Request, data: BidPackageData, subject: string, text: string) {
  return Promise.all(data.bidders.map((bidder) => sendBidEmail(request, { to: bidder.contactEmail, subject, text })));
}

async function sendBidEmail(request: Request, input: { to: string; subject: string; text: string }) {
  const delivery = await sendOperationalEmail({ to: input.to, subject: input.subject, text: `${input.text}\n\nOpen Mefford Project Command: ${new URL(request.url).origin}`, idempotencyKey: `procurement:${input.to}:${input.subject}`, safeguards: { awardBid: false, executeContract: false, approveCost: false, sendCommitment: false } });
  return delivery.outcome === "Provider Accepted" ? `Provider Accepted · ${delivery.providerReceiptId}` : delivery.outcome === "Deferred" ? "Delivery Deferred · Connection Required" : `${delivery.outcome} · ${delivery.error}`;
}

function parseData(value: string) {
  try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {}; } catch { return {}; }
}

function validEmail(value: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0); }
