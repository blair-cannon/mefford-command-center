import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  commandRecords,
  commandWorkItems,
  companyMembers,
  projectFiles,
  proposalCustomerBranding,
  recordAudits,
} from "../../../db/schema";
import { enforceOnboardingAccess } from "../../../lib/onboarding";
import { loadProposalTeamAssets, loadProposalVisualAssets } from "../../../lib/proposal-assets-server";
import { createProposalPdf } from "../../../lib/proposal-pdf";
import {
  OWNER_PROPOSAL_FILE_CATEGORY,
  OWNER_PROPOSAL_RECORD_TYPE,
  buildProposalFromSources,
  isDesignBuildProposal,
  isProposalPacketType,
  normalizeProposalData,
  proposalNeedsPricingMigration,
  proposalNeedsVoiceMigration,
  proposalIssueErrors,
  proposalRecordId,
  refreshProposalSources,
  type ProposalPacketType,
} from "../../../lib/proposals";
import { BID_PACKAGE_RECORD_TYPE, SALES_PROJECT_ID } from "../../../lib/procurement";
import { getCommandActor, resolveCommandActor } from "../../../lib/server-actor";
import { beginDomainHandoff, completeDomainConsumer, reconcileDomainEvent } from "../../../lib/domain-outbox";
import { roundMoney } from "../../../lib/money";
import { ensureMyWorkTables, upsertWorkItems } from "../../../lib/my-work";
import { customerCompanyKey, hydrateApprovedProposalTeam, proposalTeamOptions } from "../../../lib/proposal-team";
import { isPhotoUpload } from "../../../lib/photo-uploads";
import { normalizeOwnerContractType } from "../../../lib/owner-contracts";
import { readProposalWord, PROPOSAL_WORD_LIMIT, PROPOSAL_WORD_MIME } from "../../../lib/proposal-word";
import { operationalEmailConnection, sendOperationalEmail } from "../../../lib/operational-email";

const OPPORTUNITY_RECORD_TYPE = "Sales Opportunities";
const CONTACT_RECORD_TYPE = "Sales Contacts";

type ProposalAction = {
  action?: "generate" | "refresh" | "save" | "submit-review" | "issue" | "start-revision" | "import-word" | "send-owner";
  confirmedRecipient?: string;
  opportunityId?: string;
  packetType?: ProposalPacketType;
  data?: unknown;
};

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  const opportunityId = new URL(request.url).searchParams.get("opportunityId")?.trim() || "";
  if (!opportunityId) return Response.json({ error: "Opportunity Is Required" }, { status: 400 });
  const { getDb } = await import("../../../db");
  const db = getDb();
  const permissions = await proposalPermissions(db, actor);
  if (!permissions.canManage) return Response.json({ error: "Sales Or Estimating Access Is Required" }, { status: 403 });
  const context = await proposalContext(db, opportunityId);
  if (!context.opportunity) return Response.json({ error: "Sales Opportunity Not Found" }, { status: 404 });
  const proposals = await upgradeEditableProposals(db, context, actor);
  return Response.json({
    opportunity: toClientRecord(context.opportunity),
    contact: context.contact ? toClientRecord(context.contact) : null,
    records: proposals.map(toClientRecord),
    source: sourceSummary(context.opportunity, context.contact, context.bidPackages),
    teamOptions: await proposalTeamOptions(db),
    customerBranding: context.customerBranding,
    aiConfigured: await openAiConfigured(),
    deliveryConnection: await operationalEmailConnection(),
    permissions,
  });
}

async function upgradeEditableProposals(
  db: ReturnType<(typeof import("../../../db"))["getDb"]>,
  context: Awaited<ReturnType<typeof proposalContext>>,
  actor: ReturnType<typeof getCommandActor>,
) {
  if (!context.opportunity) return context.proposals;
  const opportunityData = parseData(context.opportunity.dataJson);
  const now = new Date().toISOString();
  return Promise.all(context.proposals.map(async (row) => {
    const raw = parseData(row.dataJson);
    const needsVoiceMigration = proposalNeedsVoiceMigration(raw);
    const needsPricingMigration = proposalNeedsPricingMigration(raw);
    if (["Ready For Review", "Approved To Send", "Issued"].includes(row.status) || !isProposalPacketType(raw.packetType)) return row;
    const defaults = buildProposalFromSources({
      opportunity: { id: context.opportunity!.id, title: context.opportunity!.title, owner: context.opportunity!.owner, status: context.opportunity!.status, data: opportunityData },
      contact: context.contact ? { title: context.contact.title, data: parseData(context.contact.dataJson) } : null,
      estimateValue: opportunityData.estimate,
      bidPackages: context.bidPackages.map((bid) => ({ id: bid.id, title: bid.title, data: parseData(bid.dataJson) })),
      packetType: raw.packetType,
      actor,
    });
    const needsContractTitleSync = raw.packetType === "Construction Proposal"
      && String(raw.recommendedContractType || "") !== defaults.recommendedContractType;
    if (!needsVoiceMigration && !needsPricingMigration && !needsContractTitleSync) return row;
    defaults.customerLogoFileId = Number(context.customerBranding?.logoFileId || 0);
    defaults.teamMembers = await hydrateApprovedProposalTeam(db, []);
    const data = normalizeProposalData({ ...refreshProposalSources(raw, defaults), status: row.status, updatedAt: now, updatedBy: actor.name }, defaults);
    data.teamMembers = await hydrateApprovedProposalTeam(db, data.teamMembers);
    const meta = `${data.ownerName || "Owner Pending"} · ${money(data.contractPrice)} · R${data.revision} · ${row.status}`;
    await db.update(commandRecords).set({ title: `${data.projectName} · ${data.packetType}`, owner: data.preparedBy || actor.name, due: data.validThrough, meta, recordDate: data.proposalDate || now.slice(0, 10), dataJson: JSON.stringify(data), updatedAt: now }).where(and(eq(commandRecords.projectId, SALES_PROJECT_ID), eq(commandRecords.id, row.id)));
    await db.insert(recordAudits).values({ projectId: SALES_PROJECT_ID, recordId: row.id, fieldName: "Proposal Studio Version / Contract Path", oldValue: `${String(raw.brandVoiceVersion || "Legacy Voice")} · ${String(raw.pricingVersion || "Legacy Pricing")} · ${String(raw.recommendedContractType || "No Contract Path")}`, newValue: `${data.brandVoiceVersion} · ${data.pricingVersion} · ${data.recommendedContractType}`, reason: "Existing editable proposal upgraded to the current Proposal Studio and synchronized to the selected Owner Contract title without changing an issued owner copy", actorName: actor.name, actorEmail: actor.email, summary: `${actor.name} upgraded ${row.id} to the current proposal presentation, estimate-linked pricing, and Owner Contract path.` });
    return { ...row, title: `${data.projectName} · ${data.packetType}`, owner: data.preparedBy || actor.name, due: data.validThrough, meta, recordDate: data.proposalDate || now.slice(0, 10), dataJson: JSON.stringify(data), updatedAt: now };
  }));
}

export async function reconcileAllEditableProposalUpgrades() {
  const { getDb } = await import("../../../db");
  const db = getDb();
  const rows = await db.select().from(commandRecords).where(and(
    eq(commandRecords.projectId, SALES_PROJECT_ID),
    eq(commandRecords.recordType, OWNER_PROPOSAL_RECORD_TYPE),
  ));
  const candidates = rows.filter((row) => {
    if (row.status !== "Draft") return false;
    const raw = parseData(row.dataJson);
    return isProposalPacketType(raw.packetType)
      && (proposalNeedsVoiceMigration(raw) || proposalNeedsPricingMigration(raw));
  });
  if (!candidates.length) return { scanned: rows.length, upgraded: 0, opportunities: 0 };

  const actor: ReturnType<typeof getCommandActor> = {
    name: "Command Center Scheduler",
    email: "system@command-center.internal",
    accessLevel: "Administrator",
    authenticated: true,
    identityProvider: "command_center_preview",
  };
  const opportunityIds = Array.from(new Set(candidates.map((row) => String(parseData(row.dataJson).opportunityId || "")).filter(Boolean)));
  let upgraded = 0;
  for (const opportunityId of opportunityIds) {
    const context = await proposalContext(db, opportunityId);
    const next = await upgradeEditableProposals(db, context, actor);
    upgraded += next.filter((row, index) => row !== context.proposals[index]).length;
  }
  return { scanned: rows.length, upgraded, opportunities: opportunityIds.length };
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  let input: ProposalAction;
  let wordFile: File | null = null;
  try {
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      const size = Number(request.headers.get("content-length") || 0);
      if (size > PROPOSAL_WORD_LIMIT + 64 * 1024) return Response.json({ error: "Upload A .docx File Of 8 MB Or Less." }, { status: 400 });
      const form = await request.formData();
      input = { action: String(form.get("action") || "") as ProposalAction["action"], opportunityId: String(form.get("opportunityId") || ""), packetType: String(form.get("packetType") || "") as ProposalPacketType };
      const uploaded = form.get("file");
      if (uploaded instanceof File) wordFile = uploaded;
      if (input.action !== "import-word") return Response.json({ error: "Use Word Upload For Proposal Imports." }, { status: 400 });
    } else input = await request.json() as ProposalAction;
  } catch { return Response.json({ error: "The Proposal Request Could Not Be Read." }, { status: 400 }); }
  const opportunityId = input.opportunityId?.trim() || "";
  if (!opportunityId || !isProposalPacketType(input.packetType)) {
    return Response.json({ error: "Opportunity And Proposal Type Are Required" }, { status: 400 });
  }
  const action = input.action || "generate";
  const { getDb } = await import("../../../db");
  const db = getDb();
  const permissions = await proposalPermissions(db, actor);
  if (!permissions.canManage) return Response.json({ error: "Sales Or Estimating Access Is Required" }, { status: 403 });
  const context = await proposalContext(db, opportunityId);
  if (!context.opportunity) return Response.json({ error: "Sales Opportunity Not Found" }, { status: 404 });
  const existing = context.proposals.find((row) => row.id === proposalRecordId(opportunityId, input.packetType!));
  const existingRawData = existing ? parseData(existing.dataJson) : null;
  const existingData = existingRawData ? normalizeProposalData(existingRawData) : null;
  if (action === "import-word") {
    if (!existing || !existingData) return Response.json({ error: "Create The Proposal Before Uploading A Word Copy." }, { status: 404 });
    if (existing.status !== "Draft") return Response.json({ error: "Return This Proposal To Draft Or Start A New Revision Before Importing Word Changes." }, { status: 423 });
    if (!wordFile || !/\.docx$/i.test(wordFile.name) || wordFile.size > PROPOSAL_WORD_LIMIT) return Response.json({ error: "Upload A .docx File Of 8 MB Or Less." }, { status: 400 });
    const bytes = new Uint8Array(await wordFile.arrayBuffer());
    let imported;
    try { imported = await readProposalWord(bytes, existingData, existing.id); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : "This Word File Could Not Be Imported." }, { status: 409 }); }
    if (!imported.changes.length) return Response.json({ saved: true, record: toClientRecord(existing), opportunity: toClientRecord(context.opportunity), changes: [], source: sourceSummary(context.opportunity, context.contact, context.bidPackages) });
    const now = new Date().toISOString();
    const priorOpportunity = parseData(context.opportunity.dataJson);
    const data = { ...imported.data, publicBid: priorOpportunity.leadSource === "Public Bid", updatedAt: now, updatedBy: actor.name };
    const priorHandoff = priorOpportunity.proposalHandoff && typeof priorOpportunity.proposalHandoff === "object" ? priorOpportunity.proposalHandoff as Record<string, unknown> : {};
    const opportunity = { ...priorOpportunity, proposalStatus: "Draft", proposalHandoff: { ...priorHandoff, status: "Draft", projectName: data.projectName, projectLocation: data.projectLocation, ownerName: data.ownerName, ownerContactName: data.ownerContactName, ownerContactEmail: data.ownerContactEmail, contractAmount: data.contractPrice, paymentTerms: data.paymentTerms, targetStartDate: data.targetStartDate, durationMonths: data.durationMonths, scheduleMilestones: data.scheduleMilestones } };
    const { env } = await import("cloudflare:workers");
    const storageKey = `proposals/${safeName(opportunityId)}/word-imports/${crypto.randomUUID()}.docx`;
    const title = `${data.projectName} · ${data.packetType}`;
    const meta = `${data.ownerName || "Owner Pending"} · ${money(data.contractPrice)} · R${data.revision} · Draft`;
    try { await env.BUCKET.put(storageKey, bytes, { httpMetadata: { contentType: PROPOSAL_WORD_MIME } }); }
    catch { return Response.json({ error: "The Word File Could Not Be Stored. No Proposal Changes Were Applied; Retry The Upload." }, { status: 503 }); }
    try {
      // The temporary guard makes the compare-and-save part of the same D1
      // transaction as the proposal, opportunity, source file and audit.
      const guardId = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare("INSERT INTO proposal_write_guards (id,valid) VALUES (?, CASE WHEN EXISTS (SELECT 1 FROM command_records WHERE project_id=? AND id=? AND data_json=? AND status='Draft') AND EXISTS (SELECT 1 FROM command_records WHERE project_id=? AND id=? AND data_json=?) THEN 1 ELSE 0 END)").bind(guardId, SALES_PROJECT_ID, existing.id, existing.dataJson, SALES_PROJECT_ID, opportunityId, context.opportunity.dataJson),
        env.DB.prepare("UPDATE command_records SET title=?,meta=?,due=?,record_date=?,data_json=?,updated_at=? WHERE project_id=? AND id=?").bind(title,meta,data.validThrough,data.proposalDate,JSON.stringify(data),now,SALES_PROJECT_ID,existing.id),
        env.DB.prepare("UPDATE command_records SET data_json=?,updated_at=? WHERE project_id=? AND id=?").bind(JSON.stringify(opportunity),now,SALES_PROJECT_ID,opportunityId),
        env.DB.prepare("INSERT INTO project_files (project_id,name,category,revision,storage_key,content_type,size_bytes,uploaded_by,access) VALUES (?,?,?,?,?,?,?,?,?)").bind(`ESTIMATE-${opportunityId}`,wordFile.name,"05-Owner Proposal & LOE",`Word Import R${data.revision}`,storageKey,PROPOSAL_WORD_MIME,bytes.length,actor.name,"Internal"),
        env.DB.prepare("INSERT INTO record_audits (project_id,record_id,field_name,old_value,new_value,reason,actor_name,actor_email,summary) VALUES (?,?,?,?,?,?,?,?,?)").bind(SALES_PROJECT_ID,existing.id,"Word Proposal Import",JSON.stringify(imported.changes.map(x=>({field:x.field,value:x.before}))),JSON.stringify(imported.changes.map(x=>({field:x.field,value:x.after}))),"Edited Word File Reimported",actor.name,actor.email,`${wordFile.name}: ${imported.changes.length} fields updated in Draft; original upload retained.`),
        env.DB.prepare("DELETE FROM proposal_write_guards WHERE id=?").bind(guardId),
      ]);
    } catch (error) {
      await env.BUCKET.delete(storageKey);
      return Response.json({ error: /CHECK constraint/i.test(String(error)) ? "The Proposal Changed While This File Was Uploading. Download The Latest Draft." : "The Word Import Could Not Be Saved. No Proposal Changes Were Applied; Retry The Upload." }, { status: 409 });
    }
    return Response.json({ saved: true, record: { ...toClientRecord(existing), title, meta, due: data.validThrough, recordDate: data.proposalDate, data }, opportunity: { ...toClientRecord(context.opportunity), data: opportunity }, changes: imported.changes, source: sourceSummary(context.opportunity, context.contact, context.bidPackages) });
  }
  const opportunityData = parseData(context.opportunity.dataJson);
  const defaults = buildProposalFromSources({
    opportunity: {
      id: context.opportunity.id,
      title: context.opportunity.title,
      owner: context.opportunity.owner,
      status: context.opportunity.status,
      data: opportunityData,
    },
    contact: context.contact ? { title: context.contact.title, data: parseData(context.contact.dataJson) } : null,
    estimateValue: opportunityData.estimate,
    bidPackages: context.bidPackages.map((row) => ({ id: row.id, title: row.title, data: parseData(row.dataJson) })),
    packetType: input.packetType,
    actor,
  });
  defaults.customerLogoFileId = Number(context.customerBranding?.logoFileId || 0);
  defaults.teamMembers = await hydrateApprovedProposalTeam(db, []);
  let data = existingData ?? defaults;
  let nextStatus = existing?.status || data.status || "Draft";
  const now = new Date().toISOString();
  let proposalEventId = "";
  let eventDatabase: D1Database | null = null;
  let reconciliation: Awaited<ReturnType<typeof reconcileDomainEvent>> = null;

  if (action === "send-owner") {
    if (!permissions.canIssue) return Response.json({ error: "Company Owner Or Administrator Access Is Required To Send The Issued Proposal" }, { status: 403 });
    if (!existing || !existingData || existing.status !== "Issued" || !existingData.issuedPdfKey) return Response.json({ error: "Approve And Issue The Proposal Before Sending It" }, { status: 409 });
    const recipient = existingData.ownerContactEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) || input.confirmedRecipient?.trim().toLowerCase() !== recipient) return Response.json({ error: "Confirm The Project Owner Email Shown On The Issued Proposal" }, { status: 400 });
    if (existingData.ownerDelivery?.revision === existingData.revision && existingData.ownerDelivery.status === "Provider Accepted") return Response.json({ saved: true, record: toClientRecord(existing), delivery: existingData.ownerDelivery });
    const previousDelivery = existingData.ownerDelivery?.revision === existingData.revision ? existingData.ownerDelivery : undefined;
    if (previousDelivery?.status === "Sending" || (previousDelivery?.status === "Retry" && previousDelivery.safeToRetry !== true)) return Response.json({ error: "A Prior Delivery Is Pending Or Uncertain. Check Its Provider Status Before Sending Another Copy." }, { status: 409 });
    if (previousDelivery?.safeToRetry && previousDelivery.retryAt && Date.parse(previousDelivery.retryAt) > Date.now()) return Response.json({ error: `The Email Provider Asked Us To Wait Until ${previousDelivery.retryAt}. Nothing Was Resent.` }, { status: 429 });
    const { env } = await import("cloudflare:workers");
    const object = await env.BUCKET.get(existingData.issuedPdfKey);
    if (!object) return Response.json({ error: "The Issued PDF Is Unavailable. Nothing Was Sent." }, { status: 503 });
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (await sha256(bytes) !== existingData.issuedPdfHash) return Response.json({ error: "The Issued PDF Failed Its Integrity Check. Nothing Was Sent." }, { status: 409 });
    const delivery = { status: "Sending", recipient, revision: existingData.revision, attemptedAt: now, acceptedAt: "", receiptId: "", error: "" };
    const claimed = { ...existingData, ownerDelivery: delivery };
    const claim = await env.DB.prepare("UPDATE command_records SET data_json=? WHERE project_id=? AND id=? AND data_json=?").bind(JSON.stringify(claimed), SALES_PROJECT_ID, existing.id, existing.dataJson).run();
    if (claim.meta.changes !== 1) return Response.json({ error: "The Proposal Changed While Preparing Delivery. Reload Before Continuing." }, { status: 409 });
    let binary = ""; for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
    const receipt = await sendOperationalEmail({ to: recipient, subject: `${existingData.projectName} · ${existingData.packetType} · Revision ${existingData.revision}`, text: `Hello ${existingData.ownerContactName || existingData.ownerName},\n\nPlease review the attached ${existingData.packetType.toLowerCase()} for ${existingData.projectName}. This is the approved, issued revision ${existingData.revision}.\n\n${existingData.nextSteps}\n\n${existingData.preparedBy}\nMefford Contracting`, idempotencyKey: `owner-proposal:${opportunityId}:${existing.id}:${existingData.revision}:${existingData.issuedPdfHash}`, channel: "owner-proposal-delivery", attachments: [{ name: `${existing.id}-R${existingData.revision}.pdf`, contentType: "application/pdf", base64: btoa(binary) }], safeguards: { executeContract: false, acceptOnOwnersBehalf: false } });
    const sentData = { ...claimed, ownerDelivery: { ...delivery, status: receipt.outcome, acceptedAt: receipt.acceptedAt, receiptId: receipt.providerReceiptId, error: receipt.error, provider: receipt.provider, providerStatus: receipt.providerStatus, safeToRetry: receipt.outcome === "Retry" && receipt.providerStatus === 429, retryAt: receipt.retryAfterSeconds ? new Date(Date.now() + receipt.retryAfterSeconds * 1000).toISOString() : "", idempotencyKey: `owner-proposal:${opportunityId}:${existing.id}:${existingData.revision}:${existingData.issuedPdfHash}` } };
    const persisted = await env.DB.batch([
      env.DB.prepare("UPDATE command_records SET data_json=?,updated_at=? WHERE project_id=? AND id=? AND data_json=?").bind(JSON.stringify(sentData), now, SALES_PROJECT_ID, existing.id, JSON.stringify(claimed)),
      env.DB.prepare("INSERT INTO record_audits (project_id,record_id,field_name,old_value,new_value,reason,actor_name,actor_email,summary) VALUES (?,?,?,?,?,?,?,?,?)").bind(SALES_PROJECT_ID, existing.id, "Project Owner Proposal Delivery", "Issued", receipt.outcome, `${recipient} · ${receipt.providerReceiptId || receipt.error}`, actor.name, actor.email, `R${existingData.revision} · ${recipient} · ${receipt.outcome}`),
    ]);
    if (persisted[0].meta.changes !== 1) return Response.json({ error: "The Delivery Response Could Not Be Attached To The Current Proposal. Check Its Provider Receipt Before Trying Another Send." }, { status: 503 });
    return Response.json({ saved: true, record: toClientRecord({ ...existing, dataJson: JSON.stringify(sentData), updatedAt: now }), delivery: sentData.ownerDelivery });
  }

  if (action === "generate") {
    data = existingData && existingData.status !== "Issued" && (proposalNeedsVoiceMigration(existingRawData) || proposalNeedsPricingMigration(existingRawData) || (existingData.packetType === "Construction Proposal" && existingData.recommendedContractType !== defaults.recommendedContractType))
      ? refreshProposalSources(existingRawData, defaults)
      : existingData ?? defaults;
  } else if (action === "refresh") {
    if (existingData?.status === "Issued") return Response.json({ error: "Start A New Revision Before Refreshing An Issued Packet" }, { status: 423 });
    data = refreshProposalSources(existingData ?? defaults, defaults);
  } else if (action === "save" || action === "submit-review" || action === "issue") {
    if (existingData?.status === "Issued") return Response.json({ error: "The Issued Packet Is Immutable. Start A New Revision First." }, { status: 423 });
    if (action === "issue" && existingData?.status !== "Approved To Send") {
      return Response.json({ error: "Company Owner Approval Is Required Before Sending The Proposal" }, { status: 409 });
    }
    data = action === "issue"
      ? existingData!
      : proposalNeedsPricingMigration(input.data)
        ? refreshProposalSources(input.data, defaults)
        : normalizeProposalData(input.data, defaults);
    if (data.opportunityId !== opportunityId || data.packetType !== input.packetType) {
      return Response.json({ error: "Proposal Source Identity Cannot Be Changed" }, { status: 409 });
    }
    nextStatus = action === "submit-review" ? "Ready For Review" : action === "issue" ? "Issued" : "Draft";
  } else if (action === "start-revision") {
    if (!existingData || existingData.status !== "Issued") return Response.json({ error: "Only An Issued Packet Can Start A New Revision" }, { status: 409 });
    if (existingData.ownerDelivery?.revision === existingData.revision && existingData.ownerDelivery.status === "Sending") return Response.json({ error: "Wait For The Current Email Attempt To Finish Before Starting A New Revision." }, { status: 409 });
    const revisionBase = refreshProposalSources(existingRawData ?? existingData, defaults);
    data = {
      ...revisionBase,
      revision: existingData.revision + 1,
      status: "Draft",
      issuedSnapshots: [
        ...existingData.issuedSnapshots,
        {
          revision: existingData.revision,
          issuedAt: existingData.issuedAt,
          issuedBy: existingData.issuedBy,
          issuedPdfKey: existingData.issuedPdfKey,
          issuedPdfHash: existingData.issuedPdfHash,
          contractPrice: existingData.contractPrice,
          designStartupGmp: existingData.designStartupGmp,
          designStartupServices: existingData.designStartupServices,
          sourceSnapshot: existingData.sourceSnapshot,
          visuals: existingData.visuals,
          teamMembers: existingData.teamMembers,
          scheduleMilestones: existingData.scheduleMilestones,
          proposalIntelligence: existingData.proposalIntelligence,
          ownerDelivery: existingData.ownerDelivery,
        },
      ],
      issuedAt: "",
      issuedBy: "",
      issuedPdfKey: "",
      issuedPdfHash: "",
    };
    nextStatus = "Draft";
  } else {
    return Response.json({ error: "A Valid Proposal Action Is Required" }, { status: 400 });
  }

  if (action === "refresh") nextStatus = "Draft";
  data = normalizeProposalData({
    ...data,
    // These are server evidence, never editable proposal fields.
    ownerDelivery: existingData?.ownerDelivery,
    issuedSnapshots: action === "start-revision" ? data.issuedSnapshots : existingData?.issuedSnapshots || defaults.issuedSnapshots,
    revision: action === "start-revision" ? data.revision : existingData?.revision ?? defaults.revision,
    sourceSnapshot: ["save", "submit-review", "issue"].includes(action) ? existingData?.sourceSnapshot || defaults.sourceSnapshot : data.sourceSnapshot,
    publicBid: action === "generate" && existingData?.status === "Issued" ? existingData.publicBid : defaults.publicBid,
    recommendedContractType: data.packetType === "Construction Proposal" && !(action === "generate" && existingData?.status === "Issued")
      ? (["save", "submit-review", "issue"].includes(action)
          ? normalizeOwnerContractType(data.recommendedContractType) || defaults.recommendedContractType
          : defaults.recommendedContractType)
      : data.recommendedContractType,
    status: nextStatus,
    updatedAt: now,
    updatedBy: actor.name,
  }, defaults);
  data.teamMembers = await hydrateApprovedProposalTeam(db, data.teamMembers);
  const customerLogoError = await validateCustomerLogo(db, opportunityId, data.customerLogoFileId);
  if (customerLogoError) return Response.json({ error: customerLogoError }, { status: 422 });
  const proposalReviewOpenItems = action === "submit-review" ? proposalIssueErrors(data) : [];
  let proposalReviewers: Array<{ displayName: string; email: string }> = [];
  if (action === "submit-review") {
    proposalReviewers = await db.select({ displayName: companyMembers.displayName, email: companyMembers.email }).from(companyMembers).where(and(
      eq(companyMembers.isActive, true),
      eq(companyMembers.companyAccessLevel, "Company Owner"),
    ));
    if (!proposalReviewers.length) return Response.json({ error: "An Active Company Owner Is Required For Proposal Review" }, { status: 409 });
  }
  if (data.customerLogoFileId > 0) {
    const companyName = data.ownerName.trim();
    await db.insert(proposalCustomerBranding).values({ companyKey: customerCompanyKey(companyName), companyName, logoFileId: data.customerLogoFileId,
      status: "Approved", approvedByEmail: actor.email, approvedAt: now, updatedAt: now }).onConflictDoUpdate({
      target: proposalCustomerBranding.companyKey,
      set: { companyName, logoFileId: data.customerLogoFileId, status: "Approved", approvedByEmail: actor.email, approvedAt: now, updatedAt: now },
    });
  }

  if (action === "issue") {
    if (!permissions.canIssue) return Response.json({ error: "A Company Owner Or Administrator Must Issue The Owner Copy" }, { status: 403 });
    const errors = proposalIssueErrors({ ...data, sourceSnapshot: defaults.sourceSnapshot });
    if (data.packetType === "Construction Proposal" && (
      data.sourceSnapshot.estimateContractValue !== defaults.sourceSnapshot.estimateContractValue
      || (data.sourceSnapshot.estimateCalculationSignature && data.sourceSnapshot.estimateCalculationSignature !== defaults.sourceSnapshot.estimateCalculationSignature)
      || (data.sourceSnapshot.selectedQuoteSignature && data.sourceSnapshot.selectedQuoteSignature !== defaults.sourceSnapshot.selectedQuoteSignature)
      || (data.sourceSnapshot.estimateStartDate && data.sourceSnapshot.estimateStartDate !== defaults.sourceSnapshot.estimateStartDate)
    )) errors.push("Estimate or selected quote changed after this proposal was prepared; refresh sources and obtain a new review");
    if (errors.length) return Response.json({ error: `Complete Before Issue: ${errors.join(", ")}`, missing: errors }, { status: 409 });
    data.issuedAt = now;
    data.issuedBy = actor.name;
    const recordId = proposalRecordId(opportunityId, data.packetType);
    proposalEventId = `proposal-issued:${opportunityId}:${recordId}:R${data.revision}`;
    const { env } = await import("cloudflare:workers");
    eventDatabase = env.DB;
    let visualAssets;
    let teamAssets;
    try {
      [visualAssets, teamAssets] = await Promise.all([
        loadProposalVisualAssets({ db, bucket: env.BUCKET, opportunityId, data }),
        loadProposalTeamAssets({ db, bucket: env.BUCKET, data }),
      ]);
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "The selected proposal visuals could not be loaded." }, { status: 422 });
    }
    const [logoBytes, customerLogoBytes] = await Promise.all([loadLogo(request), loadCustomerLogo(db, env.BUCKET, data.customerLogoFileId)]);
    let pdf: Uint8Array;
    try {
      pdf = await createProposalPdf({ data, recordId, status: "Issued", logoBytes, customerLogoBytes, visualAssets, teamAssets });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "The proposal PDF could not be built with the selected visuals." }, { status: 422 });
    }
    const pdfHash = await sha256(pdf);
    const storageKey = `proposals/${safeName(opportunityId)}/${safeName(recordId)}/R${data.revision}-${now.slice(0, 10)}-${pdfHash.slice(0, 12)}.pdf`;
    await beginDomainHandoff(eventDatabase, {
      id: proposalEventId,
      idempotencyKey: proposalEventId,
      eventType: "proposal.issued",
      aggregateType: OWNER_PROPOSAL_RECORD_TYPE,
      aggregateId: recordId,
      projectId: SALES_PROJECT_ID,
      actorName: actor.name,
      actorEmail: actor.email,
      occurredAt: now,
      payload: { opportunityId, recordId, revision: data.revision, packetType: data.packetType },
      consumers: [
        { key: "issued-proposal-document" },
        { key: "opportunity-stage" },
        { key: "proposal-audit-history" },
      ],
    });
    await env.BUCKET.put(storageKey, pdf, {
      httpMetadata: { contentType: "application/pdf" },
      customMetadata: { opportunityId, recordId, revision: String(data.revision), status: "Issued", sha256: pdfHash },
    });
    await completeDomainConsumer(eventDatabase, proposalEventId, "issued-proposal-document", { storageKey, pdfHash, revision: data.revision });
    await db.insert(projectFiles).values({
      projectId: `ESTIMATE-${opportunityId}`,
      name: `${safeName(data.projectName)}-${data.packetType === "Construction Proposal" ? "Proposal" : "Letter-of-Engagement"}-R${data.revision}.pdf`,
      category: OWNER_PROPOSAL_FILE_CATEGORY,
      revision: `Issued R${data.revision} · Immutable Owner Copy`,
      storageKey,
      contentType: "application/pdf",
      sizeBytes: pdf.length,
      uploadedBy: actor.name,
      access: "Owner Proposal · Controlled Issued Copy",
    });
    data.issuedPdfKey = storageKey;
    data.issuedPdfHash = pdfHash;
  }

  const recordId = proposalRecordId(opportunityId, data.packetType);
  const title = `${data.projectName} · ${data.packetType}`;
  const meta = `${data.ownerName || "Owner Pending"} · ${money(data.contractPrice)} · R${data.revision} · ${nextStatus}`;
  const savedProposal = await db.insert(commandRecords).values({
    projectId: SALES_PROJECT_ID,
    id: recordId,
    recordType: OWNER_PROPOSAL_RECORD_TYPE,
    title,
    owner: data.preparedBy || actor.name,
    due: data.validThrough,
    status: nextStatus,
    meta,
    recordDate: data.proposalDate || now.slice(0, 10),
    dateLocked: nextStatus === "Issued",
    dataJson: JSON.stringify(data),
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [commandRecords.projectId, commandRecords.id],
    setWhere: existing ? and(eq(commandRecords.dataJson, existing.dataJson), eq(commandRecords.status, existing.status)) : sql`0`,
    set: {
      title,
      owner: data.preparedBy || actor.name,
      due: data.validThrough,
      status: nextStatus,
      meta,
      recordDate: data.proposalDate || now.slice(0, 10),
      dateLocked: nextStatus === "Issued",
      dataJson: JSON.stringify(data),
      updatedAt: now,
    },
  }).returning({ id: commandRecords.id });
  if (!savedProposal.length) return Response.json({ error: "The Proposal Changed During This Request. Reload The Saved Proposal Before Continuing." }, { status: 409 });

  if (["save", "refresh", "start-revision"].includes(action)) {
    await ensureMyWorkTables();
    await db.update(commandWorkItems).set({ status: "Completed", completedAt: now, updatedAt: now }).where(and(
      inArray(commandWorkItems.sourceType, [OWNER_PROPOSAL_RECORD_TYPE, "Owner Proposal Release"]),
      inArray(commandWorkItems.sourceRecordId, [recordId, opportunityId]),
      inArray(commandWorkItems.status, ["Open", "Acknowledged", "Snoozed"]),
    ));
  }
  if (action === "submit-review") {
    await ensureMyWorkTables();
    await upsertWorkItems(db, proposalReviewers.map((reviewer) => ({
      dedupeKey: `proposal-review:${recordId}:R${data.revision}:${reviewer.email}`,
      projectId: SALES_PROJECT_ID,
      recipientName: reviewer.displayName,
      recipientEmail: reviewer.email,
      kind: "Proposal Approval",
      title: `Review ${data.projectName} Proposal`,
      message: `${data.preparedBy || actor.name} submitted Revision ${data.revision} for review before it can be sent to ${data.ownerName || "the project owner"}.${proposalReviewOpenItems.length ? ` ${proposalReviewOpenItems.length} issue-readiness item${proposalReviewOpenItems.length === 1 ? " remains" : "s remain"}: ${proposalReviewOpenItems.join(", ")}.` : " The proposal is issue-ready."}`,
      priority: "High",
      sourceType: OWNER_PROPOSAL_RECORD_TYPE,
      sourceRecordId: recordId,
      actionTarget: "Owner Approvals",
      dueAt: now,
      createdBy: actor.name,
    })));
  }
  if (action === "issue") {
    await ensureMyWorkTables();
    await db.update(commandWorkItems).set({ status: "Completed", completedAt: now, updatedAt: now }).where(and(
      eq(commandWorkItems.sourceType, "Owner Proposal Release"),
      eq(commandWorkItems.sourceRecordId, opportunityId),
      inArray(commandWorkItems.status, ["Open", "Acknowledged", "Snoozed"]),
    ));
  }

  const handoff = {
    recordId,
    packetType: data.packetType,
    status: nextStatus,
    revision: data.revision,
    projectName: data.projectName,
    projectLocation: data.projectLocation,
    ownerName: data.ownerName,
    ownerContactName: data.ownerContactName,
    ownerContactEmail: data.ownerContactEmail,
    ownerContractType: data.recommendedContractType,
    contractAmount: roundMoney(data.packetType === "Construction Proposal" ? data.contractPrice : opportunityData.estimatedValue || data.sourceSnapshot.estimateContractValue || 0),
    ...(isDesignBuildProposal(data) ? {
      designStartupGmp: data.designStartupGmp,
      designStartupGmpIncludedInContractAmount: true,
      designStartupServices: data.designStartupServices.filter((service) => service.included),
    } : {}),
    engagementFee: roundMoney(data.packetType === "Preconstruction Letter of Engagement" ? data.contractPrice : 0),
    paymentTerms: data.paymentTerms,
    targetStartDate: data.targetStartDate,
    durationMonths: data.durationMonths,
    scheduleMilestones: data.scheduleMilestones,
    proposedProjectManagerEmail: data.proposedProjectManagerEmail,
    proposedSuperintendentEmail: data.proposedSuperintendentEmail,
    proposalTeamEmails: data.teamMembers.filter((member) => member.includeInProposal).map((member) => member.employeeEmail),
    issuedAt: data.issuedAt,
    issuedPdfHash: data.issuedPdfHash,
  };
  const nextOpportunityData = {
    ...opportunityData,
    ...(data.packetType === "Construction Proposal" ? { ownerContractType: data.recommendedContractType } : {}),
    proposalHandoff: handoff,
    proposalRecordId: recordId,
    proposalStatus: nextStatus,
    proposalRevision: data.revision,
    ...(action === "issue" ? {
      stage: "Proposal Submitted",
      probability: String(Math.max(70, Number(opportunityData.probability || 0))),
      estimatedValue: roundMoney(handoff.contractAmount || opportunityData.estimatedValue || 0).toFixed(2),
      proposalSubmittedAt: now,
    } : {}),
  };
  const nextOpportunityStatus = action === "issue" ? "Proposal Submitted" : context.opportunity.status;
  await db.update(commandRecords).set({
    status: nextOpportunityStatus,
    dataJson: JSON.stringify(nextOpportunityData),
    updatedAt: now,
  }).where(and(
    eq(commandRecords.projectId, SALES_PROJECT_ID),
    eq(commandRecords.id, opportunityId),
    eq(commandRecords.recordType, OPPORTUNITY_RECORD_TYPE),
  ));
  if (data.packetType === "Construction Proposal") {
    const previousHandoff = opportunityData.proposalHandoff && typeof opportunityData.proposalHandoff === "object" && !Array.isArray(opportunityData.proposalHandoff)
      ? opportunityData.proposalHandoff as Record<string, unknown>
      : {};
    const previousContractType = normalizeOwnerContractType(opportunityData.ownerContractType)
      || normalizeOwnerContractType(opportunityData.deliveryMethod)
      || normalizeOwnerContractType(previousHandoff.ownerContractType)
      || "Plan & Spec Lump Sum";
    if (previousContractType !== data.recommendedContractType) {
      await db.insert(recordAudits).values({
        projectId: SALES_PROJECT_ID,
        recordId: opportunityId,
        fieldName: "Owner Contract Type",
        oldValue: previousContractType,
        newValue: data.recommendedContractType,
        reason: "Proposal And Project Info Contract Type Synchronization",
        actorName: actor.name,
        actorEmail: actor.email,
        summary: `${actor.name} changed the Owner Contract Type to ${data.recommendedContractType} while preparing ${recordId}; Project Info and the editable proposal now match.`,
      });
    }
  }
  if (eventDatabase && proposalEventId) await completeDomainConsumer(eventDatabase, proposalEventId, "opportunity-stage", { opportunityId, status: nextOpportunityStatus, proposalRecordId: recordId });

  await db.insert(recordAudits).values({
    projectId: SALES_PROJECT_ID,
    recordId,
    fieldName: "Owner Proposal Lifecycle",
    oldValue: existing?.status || "Not Created",
    newValue: nextStatus,
    reason: action,
    actorName: actor.name,
    actorEmail: actor.email,
    summary: `${recordId} · ${action} · ${data.packetType} R${data.revision} · ${money(data.contractPrice)} · ${data.visuals.filter((item) => item.included).length} visual source(s)`,
  });
  if (action === "issue") {
    await db.insert(recordAudits).values({
      projectId: SALES_PROJECT_ID,
      recordId: opportunityId,
      fieldName: "Proposal Handoff",
      oldValue: context.opportunity.status,
      newValue: "Proposal Submitted",
      reason: "Controlled Owner Copy Issued",
      actorName: actor.name,
      actorEmail: actor.email,
      summary: `${recordId} issued and linked to the opportunity. Contact, estimate, pricing, schedule, and contract handoff remain one record.`,
    });
    if (eventDatabase && proposalEventId) {
      await completeDomainConsumer(eventDatabase, proposalEventId, "proposal-audit-history", { proposalRecordId: recordId, opportunityId, action: "Controlled Owner Copy Issued" });
      reconciliation = await reconcileDomainEvent(eventDatabase, proposalEventId);
    }
  }

  const saved = await db.select().from(commandRecords).where(and(
    eq(commandRecords.projectId, SALES_PROJECT_ID),
    eq(commandRecords.id, recordId),
  )).limit(1);
  return Response.json({
    saved: true,
    record: saved[0] ? toClientRecord(saved[0]) : null,
    opportunity: {
      ...toClientRecord(context.opportunity),
      status: nextOpportunityStatus,
      data: nextOpportunityData,
    },
    source: sourceSummary(context.opportunity, context.contact, context.bidPackages),
    reviewOpenItems: proposalReviewOpenItems,
    handoff: reconciliation ? { eventId: proposalEventId, status: reconciliation.status, consumers: reconciliation.consumers } : null,
  }, { status: existing ? 200 : 201 });
}

async function proposalContext(
  db: ReturnType<(typeof import("../../../db"))["getDb"]>,
  opportunityId: string,
) {
  const [opportunities, proposals, bidPackages] = await Promise.all([
    db.select().from(commandRecords).where(and(
      eq(commandRecords.projectId, SALES_PROJECT_ID),
      eq(commandRecords.id, opportunityId),
      eq(commandRecords.recordType, OPPORTUNITY_RECORD_TYPE),
    )).limit(1),
    db.select().from(commandRecords).where(and(
      eq(commandRecords.projectId, SALES_PROJECT_ID),
      eq(commandRecords.recordType, OWNER_PROPOSAL_RECORD_TYPE),
    )).orderBy(desc(commandRecords.updatedAt)),
    db.select().from(commandRecords).where(and(
      eq(commandRecords.projectId, SALES_PROJECT_ID),
      eq(commandRecords.recordType, BID_PACKAGE_RECORD_TYPE),
    )).orderBy(desc(commandRecords.updatedAt)),
  ]);
  const opportunity = opportunities[0] || null;
  const opportunityData = opportunity ? parseData(opportunity.dataJson) : {};
  const companyName = String(opportunityData.company || "").trim();
  const branding = companyName ? await db.select().from(proposalCustomerBranding).where(eq(proposalCustomerBranding.companyKey, customerCompanyKey(companyName))).limit(1) : [];
  const contactId = String(opportunityData.contactId || "");
  const contacts = contactId ? await db.select().from(commandRecords).where(and(
    eq(commandRecords.projectId, SALES_PROJECT_ID),
    eq(commandRecords.id, contactId),
    eq(commandRecords.recordType, CONTACT_RECORD_TYPE),
  )).limit(1) : [];
  return {
    opportunity,
    contact: contacts[0] || null,
    proposals: proposals.filter((row) => String(parseData(row.dataJson).opportunityId || "") === opportunityId),
    bidPackages: bidPackages.filter((row) => String(parseData(row.dataJson).opportunityId || "") === opportunityId),
    customerBranding: branding[0] || null,
  };
}

async function proposalPermissions(
  db: ReturnType<(typeof import("../../../db"))["getDb"]>,
  actor: ReturnType<typeof getCommandActor>,
) {
  const member = actor.email ? await db.select().from(companyMembers).where(eq(companyMembers.email, actor.email)).limit(1) : [];
  const level = member[0]?.companyAccessLevel || actor.accessLevel;
  const designations = parseStringArray(member[0]?.designationsJson || "[]");
  const elevated = ["Company Owner", "Administrator"].includes(level);
  return {
    canManage: elevated || designations.includes("Estimator") || designations.includes("Sales Representative"),
    canIssue: elevated,
    accessLevel: level,
  };
}

function sourceSummary(
  opportunity: typeof commandRecords.$inferSelect,
  contact: typeof commandRecords.$inferSelect | null,
  bidPackages: Array<typeof commandRecords.$inferSelect>,
) {
  const opportunityData = parseData(opportunity.dataJson);
  const receivedQuoteCount = bidPackages.reduce((total, row) => {
    const data = parseData(row.dataJson);
    const bidders = Array.isArray(data.bidders) ? data.bidders as Array<Record<string, unknown>> : [];
    return total + bidders.filter((bidder) => Array.isArray(bidder.revisions) && bidder.revisions.length).length;
  }, 0);
  const selectedQuoteCount = bidPackages.filter((row) => {
    const data = parseData(row.dataJson);
    const basis = data.proposalBasis;
    return Boolean(basis && typeof basis === "object" && !Array.isArray(basis) && (basis as Record<string, unknown>).bidRevisionId);
  }).length;
  const unselectedBidPackageCount = bidPackages.filter((row) => {
    const data = parseData(row.dataJson);
    const bidders = Array.isArray(data.bidders) ? data.bidders as Array<Record<string, unknown>> : [];
    const hasQuote = bidders.some((bidder) => Array.isArray(bidder.revisions) && bidder.revisions.length);
    const basis = data.proposalBasis;
    const selected = Boolean(basis && typeof basis === "object" && !Array.isArray(basis) && (basis as Record<string, unknown>).bidRevisionId);
    return hasQuote && !selected;
  }).length;
  return {
    contactLinked: Boolean(contact),
    estimateLinked: Boolean(opportunityData.estimate),
    estimateStatus: String((opportunityData.estimate as Record<string, unknown> | undefined)?.status || opportunityData.estimateStatus || "Not Started"),
    bidPackageCount: bidPackages.length,
    receivedQuoteCount,
    selectedQuoteCount,
    unselectedBidPackageCount,
  };
}

function toClientRecord(row: typeof commandRecords.$inferSelect) {
  return {
    id: row.id,
    type: row.recordType,
    title: row.title,
    owner: row.owner,
    due: row.due,
    status: row.status,
    meta: row.meta,
    recordDate: row.recordDate,
    dateLocked: row.dateLocked,
    data: parseData(row.dataJson),
    updatedAt: row.updatedAt,
  };
}

async function loadLogo(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    const response = await env.ASSETS.fetch(new Request(new URL("/mefford-logo.png", request.url)));
    return response.ok ? new Uint8Array(await response.arrayBuffer()) : undefined;
  } catch {
    return undefined;
  }
}

async function loadCustomerLogo(db: ReturnType<(typeof import("../../../db"))["getDb"]>, bucket: R2Bucket, fileId: number) {
  if (!(fileId > 0)) return undefined;
  const rows = await db.select().from(projectFiles).where(eq(projectFiles.id, fileId)).limit(1);
  const object = rows[0] ? await bucket.get(rows[0].storageKey) : null;
  return object ? new Uint8Array(await object.arrayBuffer()) : undefined;
}

async function validateCustomerLogo(db: ReturnType<(typeof import("../../../db"))["getDb"]>, opportunityId: string, fileId: number) {
  if (!(fileId > 0)) return "";
  const rows = await db.select().from(projectFiles).where(eq(projectFiles.id, fileId)).limit(1);
  const file = rows[0];
  if (!file || file.projectId !== `ESTIMATE-${opportunityId}` || file.category !== "Proposal Customer Logo") return "Select A Customer Logo Uploaded For This Opportunity";
  if (!isPhotoUpload({ name: file.name, type: file.contentType })) return "Select A Recognized Customer Logo Image";
  return "";
}

async function openAiConfigured() {
  try { const { env } = await import("cloudflare:workers"); return Boolean(String((env as unknown as Record<string, unknown>).OPENAI_API_KEY || "").trim()); }
  catch { return false; }
}

async function sha256(bytes: Uint8Array) {
  const source = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(source).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", source);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

function parseData(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);
}

function safeName(value: string) {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-");
}
