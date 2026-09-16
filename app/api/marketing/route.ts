import { and, desc, eq, inArray } from "drizzle-orm";
import { commandRecords, companyMembers, projectFiles, projects, recordAudits } from "../../../db/schema";
import { CUSTOMER_SURVEY_PROGRAMS, reconcileCustomerSurveyMilestones } from "../../../lib/customer-voice";
import { ensureProjectFileSchema } from "../../../lib/project-file-schema";
import { enforceOnboardingAccess } from "../../../lib/onboarding";
import { getCommandActor, resolveCommandActor } from "../../../lib/server-actor";
import { isPhotoUpload, isVideoUpload, normalizeUploadContentType, photoUploadContentType } from "../../../lib/photo-uploads";

const SALES_PROJECT_ID = "MEFFORD-SALES";
const INTEGRATION_PROJECT_ID = "MEFFORD-COMPANY";
const ASSET_CATEGORY = "Marketing Content Asset";
const SURVEY_VIDEO_CATEGORY = "Customer Survey Video";
const MAX_ASSET_BYTES = 15 * 1024 * 1024;
const MAX_SURVEY_VIDEO_BYTES = 250 * 1024 * 1024;
const RECORD_TYPES = new Set([
  "Marketing Campaigns",
  "Marketing Content",
  "Marketing Newsletter",
  "Marketing Analytics Snapshot",
  "Marketing Configuration",
  "Marketing Customer Survey Request",
  "Marketing Customer Survey Response",
]);
const CONNECTION_KEYS = ["linkedin-company", "facebook-company", "google-analytics", "marketing-email", "customer-survey-delivery"];

type MarketingInput = {
  action?: string;
  recordId?: string;
  contactId?: string;
  status?: string;
  recordType?: string;
  record?: {
    id?: string;
    title?: string;
    owner?: string;
    due?: string;
    status?: string;
    meta?: string;
    recordDate?: string;
    data?: Record<string, unknown>;
  };
  legacy?: { projectName?: string; projectNumber?: string; projectType?: string; completionDate?: string; customerName?: string; customerEmail?: string; templateKey?: string };
};

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  try {
    const db = await marketingDatabase();
    const access = await marketingAccess(db, actor);
    if (!access.canView) return Response.json({ error: "Marketing Access Is Required" }, { status: 403 });
    await ensureProjectFileSchema();
    const [rows, members, files, surveyVideos, connections, projectRows, allProjectRecords] = await Promise.all([
      db.select().from(commandRecords).where(eq(commandRecords.projectId, SALES_PROJECT_ID)).orderBy(desc(commandRecords.updatedAt)),
      db.select().from(companyMembers).where(eq(companyMembers.isActive, true)),
      db.select().from(projectFiles).where(and(eq(projectFiles.projectId, SALES_PROJECT_ID), eq(projectFiles.category, ASSET_CATEGORY))).orderBy(desc(projectFiles.id)),
      db.select().from(projectFiles).where(and(eq(projectFiles.projectId, SALES_PROJECT_ID), eq(projectFiles.category, SURVEY_VIDEO_CATEGORY))).orderBy(desc(projectFiles.id)),
      db.select().from(commandRecords).where(eq(commandRecords.projectId, INTEGRATION_PROJECT_ID)).orderBy(desc(commandRecords.updatedAt)),
      db.select().from(projects).orderBy(projects.number),
      db.select().from(commandRecords).orderBy(desc(commandRecords.updatedAt)),
    ]);
    const marketingRows = rows.filter((row) => RECORD_TYPES.has(row.recordType));
    const contacts = rows.filter((row) => row.recordType === "Sales Contacts").filter((row) => {
      const data = parse(row.dataJson);
      return Boolean(String(data.email || "").trim());
    });
    const audienceContacts = contacts.map((row) => {
      const data = parse(row.dataJson);
      return { id: row.id, name: row.title, company: String(data.company || ""), email: String(data.email || ""), status: marketingAudienceStatus(data.marketingEmailStatus), source: String(data.source || "Sales Contacts") };
    });
    const eligibleExternalContacts = audienceContacts.filter((contact) => ["Eligible", "Consent Review"].includes(contact.status));
    const connectionMap = new Map(connections.map((row) => [row.id.replace(/^INTEGRATION-/, "").toLowerCase(), row]));
    return Response.json({
      permissions: access,
      records: marketingRows.map(toRecord),
      assets: files.map(toFile),
      surveyVideos: surveyVideos.map(toFile),
      projects: projectRows.map((project) => {
        const contract = allProjectRecords.find((record) => record.projectId === project.number && ["Contracts", "Owner Contract"].includes(record.recordType));
        const contractData = parse(contract?.dataJson || "{}");
        const fields = contractData.fields && typeof contractData.fields === "object" && !Array.isArray(contractData.fields) ? contractData.fields as Record<string, unknown> : {};
        const team = members.filter((member) => [project.projectManager, project.superintendent].includes(member.displayName)).map((member) => member.email);
        return { number: project.number, name: project.name, status: project.status, ownerName: project.ownerName, ownerEmail: String(fields.OWNER_NOTICE_EMAIL || contractData.ownerEmail || ""), contractType: project.ownerContractType, contractStatus: project.ownerContractStatus, startDate: project.startDate, substantialDate: project.substantialDate, finalDate: project.finalDate, projectManager: project.projectManager, superintendent: project.superintendent, teamEmails: team };
      }),
      audienceContacts,
      audiences: {
        externalContacts: eligibleExternalContacts.length,
        totalExternalContacts: audienceContacts.length,
        suppressedContacts: audienceContacts.length - eligibleExternalContacts.length,
        activeEmployees: members.filter((member) => Boolean(member.email)).length,
        externalRule: "Every saved contact with an email is eligible for review. Consent, unsubscribe, and suppression checks remain mandatory before delivery.",
        internalRule: "Every active employee with a company email is included at send review.",
      },
      connections: CONNECTION_KEYS.map((key) => {
        const row = connectionMap.get(key);
        const data = parse(row?.dataJson || "{}");
        return { key, status: row?.status || "Not Configured", owner: row?.owner || "Unassigned", lastCheckedAt: String(data.lastCheckedAt || ""), cause: String(data.cause || "") };
      }),
      controls: {
        sender: "marketing@meffcon.com",
        publishing: "External posting and email delivery require a healthy provider connection plus explicit approval.",
        analytics: "Provider analytics are never fabricated. Manual snapshots identify their source; connected results retain provider timestamps.",
        surveys: "Design-Build runs startup, design, weighted midpoint, and turnover surveys; Plan & Spec runs midpoint and turnover; T&M runs once per owner-invoice cycle. Every recipient receives a traceable single-use link and one four-day reminder. Delivery remains provider-receipt gated.",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Marketing Command Is Unavailable" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  try {
    const db = await marketingDatabase();
    const access = await marketingAccess(db, actor);
    if (!access.canEdit) return Response.json({ error: "Marketing Editor Access Is Required" }, { status: 403 });
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) return uploadAsset(request, db, actor);
    const input = await request.json() as MarketingInput;
    if (input.action === "reconcile-surveys") {
      const result = await reconcileCustomerSurveyMilestones(new Date(), new URL(request.url).origin);
      return Response.json({ saved: true, result });
    }
    if (input.action === "create-legacy-survey") return createLegacySurvey(request, db, actor, input);
    if (input.action === "set-audience-status") return setAudienceStatus(db, actor, input);
    if (input.action === "publish-social") return dispatchSocialPost(request, db, actor, access, input);
    if (input.action === "send-newsletter" || input.action === "send-test-newsletter") return dispatchNewsletter(request, db, actor, access, input);
    if (input.action === "sync-analytics") return syncMarketingAnalytics(request, db, actor);
    if (input.action === "publish" || input.action === "send") return Response.json({ error: "Choose The Specific Social Or Email Release Action So The Correct Approval And Provider Controls Can Run" }, { status: 400 });
    if (input.action !== "save-record" || !input.record || !RECORD_TYPES.has(input.recordType || "")) {
      return Response.json({ error: "A Valid Marketing Record Action Is Required" }, { status: 400 });
    }
    const recordType = input.recordType || "";
    const record = normalizeRecord(input.record, actor.name);
    const validationError = validateRecord(recordType, record);
    if (validationError) return Response.json({ error: validationError }, { status: 400 });
    const existing = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, SALES_PROJECT_ID), eq(commandRecords.id, record.id))).limit(1);
    if (existing[0] && existing[0].recordType !== recordType) return Response.json({ error: "This Marketing Record ID Belongs To A Different Record Type" }, { status: 409 });
    const now = new Date().toISOString();
    await db.insert(commandRecords).values({
      projectId: SALES_PROJECT_ID,
      id: record.id,
      recordType,
      title: record.title,
      owner: record.owner,
      due: record.due,
      status: record.status,
      meta: record.meta,
      recordDate: record.recordDate,
      dateLocked: false,
      dataJson: JSON.stringify({ ...record.data, updatedBy: actor.name, updatedByEmail: actor.email, updatedAt: now }),
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [commandRecords.projectId, commandRecords.id],
      set: { title: record.title, owner: record.owner, due: record.due, status: record.status, meta: record.meta, recordDate: record.recordDate, dataJson: JSON.stringify({ ...record.data, updatedBy: actor.name, updatedByEmail: actor.email, updatedAt: now }), updatedAt: now },
    });
    await db.insert(recordAudits).values({
      projectId: SALES_PROJECT_ID,
      recordId: record.id,
      fieldName: recordType,
      oldValue: existing[0]?.status || "New",
      newValue: record.status,
      reason: existing[0] ? "Marketing record reviewed and updated" : "Marketing record created",
      actorName: actor.name,
      actorEmail: actor.email,
      summary: `${record.title} · ${record.status} · ${record.meta}`,
      createdAt: now,
    });
    if (recordType === "Marketing Customer Survey Response") {
      const requestId = String(record.data.requestId || "").trim();
      if (requestId) {
        const requestRow = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, SALES_PROJECT_ID), eq(commandRecords.id, requestId), eq(commandRecords.recordType, "Marketing Customer Survey Request"))).limit(1);
        if (requestRow[0]) {
          const requestData = parse(requestRow[0].dataJson);
          await db.update(commandRecords).set({ status: "Responded", meta: `${requestRow[0].meta} · Response Recorded`, dataJson: JSON.stringify({ ...requestData, responseId: record.id, respondedAt: now }), updatedAt: now }).where(and(eq(commandRecords.projectId, SALES_PROJECT_ID), eq(commandRecords.id, requestId)));
          await db.insert(recordAudits).values({ projectId: SALES_PROJECT_ID, recordId: requestId, fieldName: "Customer Survey Response", oldValue: requestRow[0].status, newValue: "Responded", reason: "Verified customer response linked to milestone request", actorName: actor.name, actorEmail: actor.email, summary: `${record.id} linked to ${requestId}`, createdAt: now });
        }
      }
    }
    return Response.json({ saved: true, record: { ...record, type: recordType, data: { ...record.data, updatedBy: actor.name, updatedAt: now } } }, { status: existing[0] ? 200 : 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The Marketing Record Could Not Be Saved" }, { status: 500 });
  }
}

async function createLegacySurvey(request: Request, db: Awaited<ReturnType<typeof marketingDatabase>>, actor: ReturnType<typeof getCommandActor>, input: MarketingInput) {
  const legacy = input.legacy || {};
  const projectName = String(legacy.projectName || "").trim().slice(0, 180);
  const projectNumber = String(legacy.projectNumber || "Historical Project").trim().slice(0, 80);
  const projectType = String(legacy.projectType || "Plan & Spec").trim().slice(0, 80);
  const completionDate = String(legacy.completionDate || "").trim();
  const customerName = String(legacy.customerName || "").trim().slice(0, 120);
  const customerEmail = String(legacy.customerEmail || "").trim().toLowerCase().slice(0, 180);
  const templateKey = String(legacy.templateKey || "completion") as keyof typeof CUSTOMER_SURVEY_PROGRAMS;
  const program = CUSTOMER_SURVEY_PROGRAMS[templateKey];
  if (!projectName || !customerName || !/^\S+@\S+\.\S+$/.test(customerEmail) || !program || !/^\d{4}-\d{2}-\d{2}$/.test(completionDate)) return Response.json({ error: "Historical Project, Completion Date, Customer Name, Valid Email, And Survey Type Are Required" }, { status: 400 });
  const now = new Date().toISOString();
  const id = `SURVEY-LEGACY-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
  const token = crypto.randomUUID();
  const origin = new URL(request.url).origin;
  const surveyUrl = `${origin}/customer-survey?token=${encodeURIComponent(token)}`;
  const connectionError = await requiredConnectionError(db, ["marketing-email", "customer-survey-delivery"]);
  const { env } = await import("cloudflare:workers");
  const binding = env as unknown as Record<string, unknown>;
  const webhookUrl = String(binding.MARKETING_EMAIL_WEBHOOK_URL || "").trim();
  let status = connectionError || !webhookUrl ? "Manual Link Ready · Delivery Deferred" : "Queued For Automatic Delivery";
  let receipt: Record<string, unknown> | null = null;
  let deliveryError = connectionError || (!webhookUrl ? "The approved marketing delivery endpoint is not configured" : "");
  if (!deliveryError) {
    const response = await fetch(webhookUrl, { method: "POST", headers: { "Content-Type": "application/json", ...(binding.MARKETING_EMAIL_WEBHOOK_TOKEN ? { Authorization: `Bearer ${String(binding.MARKETING_EMAIL_WEBHOOK_TOKEN)}` } : {}) }, body: JSON.stringify({ channel: "customer-survey", idempotencyKey: `${id}:initial`, from: String(binding.MARKETING_EMAIL_SENDER || "marketing@meffcon.com"), to: customerEmail, subject: `${projectName} · Customer Review`, text: `${customerName},\n\nWe would appreciate an honest two-minute review of ${projectName}. Please use the five-star survey below and add any comments or project photos you would like us to see.\n\nSecure survey: ${surveyUrl}\n\nYour rating is always recorded. Names, comments, project details, and photos display only with explicit permission.`, safeguards: { historicalOneOff: true, singleUse: true, displayRequiresExplicitConsent: true } }) });
    const body = await safeProviderJson(response);
    receipt = { provider: "Marketing Email Adapter", status: response.status, receiptId: String(body.receiptId || body.id || response.headers.get("x-request-id") || id), acceptedAt: response.ok ? now : "", evidence: response.ok ? "Provider Accepted; inbox delivery is not yet proven" : "Provider Rejected" };
    status = response.ok ? "Provider Accepted" : "Delivery Failed";
    deliveryError = response.ok ? "" : `Marketing Mailbox Returned ${response.status}`;
  }
  const data = { projectId: `LEGACY-${projectNumber}`.replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 80), projectName, legacyProjectNumber: projectNumber, legacyProject: true, projectType, completionDate, ownerName: customerName, ownerEmail: customerEmail, recipientName: customerName, recipientEmail: customerEmail, primaryRecipient: true, milestone: program.label, milestoneKey: templateKey, milestoneDescription: program.description, triggerDate: now.slice(0, 10), triggerSourceId: "MARKETING-HISTORICAL-ONE-OFF", questions: program.questions.map(([key, label]) => ({ key, label })), responseDue: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10), token, surveyUrl, acceptedAt: status === "Provider Accepted" ? now : "", providerReceipt: receipt, deliveryError, createdBy: actor.name, createdByEmail: actor.email, createdAt: now };
  await db.insert(commandRecords).values({ projectId: SALES_PROJECT_ID, id, recordType: "Marketing Customer Survey Request", title: `${projectName} · Historical ${program.label} Survey`, owner: customerName, due: String(data.responseDue), status, meta: `${projectNumber} · ${customerEmail} · Historical One-Off`, recordDate: now.slice(0, 10), dateLocked: true, dataJson: JSON.stringify(data), updatedAt: now });
  await db.insert(recordAudits).values({ projectId: SALES_PROJECT_ID, recordId: id, fieldName: "Historical Customer Survey", oldValue: "Not Created", newValue: status, reason: "Marketing created an authorized one-off survey for completed historical work", actorName: actor.name, actorEmail: actor.email, summary: `${projectName} · ${customerName} · ${program.label}`, createdAt: now });
  return Response.json({ saved: true, requestId: id, surveyUrl, status, message: status === "Provider Accepted" ? `The Historical Survey Was Accepted For Delivery To ${customerEmail}.` : `The Historical Survey Link Is Ready. Automatic Delivery Remains Deferred Until The Approved Connection Is Healthy.` }, { status: 201 });
}

async function setAudienceStatus(db: Awaited<ReturnType<typeof marketingDatabase>>, actor: ReturnType<typeof getCommandActor>, input: MarketingInput) {
  const allowed = ["Eligible", "Consent Review", "Do Not Email", "Suppressed"];
  const contactId = String(input.contactId || "").trim();
  const status = String(input.status || "").trim();
  if (!contactId || !allowed.includes(status)) return Response.json({ error: "Choose A Valid Contact And Marketing Email Status" }, { status: 400 });
  const rows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, SALES_PROJECT_ID), eq(commandRecords.id, contactId), eq(commandRecords.recordType, "Sales Contacts"))).limit(1);
  const row = rows[0];
  if (!row) return Response.json({ error: "The Sales Contact Could Not Be Found" }, { status: 404 });
  const now = new Date().toISOString();
  const data = parse(row.dataJson);
  const prior = marketingAudienceStatus(data.marketingEmailStatus);
  await db.update(commandRecords).set({ dataJson: JSON.stringify({ ...data, marketingEmailStatus: status, marketingEmailStatusBy: actor.name, marketingEmailStatusAt: now }), updatedAt: now }).where(and(eq(commandRecords.projectId, SALES_PROJECT_ID), eq(commandRecords.id, contactId)));
  await db.insert(recordAudits).values({ projectId: SALES_PROJECT_ID, recordId: contactId, fieldName: "Marketing Email Eligibility", oldValue: prior, newValue: status, reason: "Marketing audience eligibility, unsubscribe, or suppression control updated", actorName: actor.name, actorEmail: actor.email, summary: `${row.title} · ${status}`, createdAt: now });
  return Response.json({ saved: true, contactId, status });
}

async function dispatchSocialPost(request: Request, db: Awaited<ReturnType<typeof marketingDatabase>>, actor: ReturnType<typeof getCommandActor>, access: { canApprove: boolean }, input: MarketingInput) {
  if (!access.canApprove) return Response.json({ error: "Owner Or Administrator Final Approval Is Required Before Social Publishing" }, { status: 403 });
  const row = await marketingRecord(db, String(input.recordId || ""), "Marketing Content");
  if (!row) return Response.json({ error: "The Social Post Could Not Be Found" }, { status: 404 });
  const data = parse(row.dataJson);
  const platforms = Array.isArray(data.platforms) ? data.platforms.map(String).filter((item) => ["LinkedIn", "Facebook"].includes(item)) : [];
  if (!platforms.length || String(data.body || "").trim().length < 10) return Response.json({ error: "Complete The Post Copy And Select At Least One Platform Before Publishing" }, { status: 400 });
  const requiredKeys = platforms.map((platform) => platform === "LinkedIn" ? "linkedin-company" : "facebook-company");
  const connectionError = await requiredConnectionError(db, requiredKeys);
  if (connectionError) return Response.json({ error: connectionError }, { status: 409 });
  const { env } = await import("cloudflare:workers");
  const binding = env as unknown as Record<string, unknown>;
  const webhookUrl = String(binding.MARKETING_SOCIAL_WEBHOOK_URL || "").trim();
  const webhookToken = String(binding.MARKETING_SOCIAL_WEBHOOK_TOKEN || "").trim();
  if (!webhookUrl) return Response.json({ error: "The Social Publisher Connection Is Marked Connected But Its Secure Delivery Endpoint Is Missing In IT & Integrations" }, { status: 409 });
  const assetIds = Array.isArray(data.assetIds) ? data.assetIds.map(Number).filter((id) => Number.isInteger(id) && id > 0) : [];
  const assets = assetIds.length ? await db.select().from(projectFiles).where(and(eq(projectFiles.projectId, SALES_PROJECT_ID), inArray(projectFiles.id, assetIds))) : [];
  const form = new FormData();
  const idempotencyKey = `${row.id}:${String(data.publishAt || row.due)}:${row.updatedAt}`;
  form.set("payload", new Blob([JSON.stringify({ channel: "company-social-publishing", idempotencyKey, recordId: row.id, platforms, copy: String(data.body || ""), scheduledAt: String(data.publishAt || ""), title: row.title, approvedBy: actor.name, approvedByEmail: actor.email, callbackOrigin: new URL(request.url).origin, safeguards: { companyPageOnly: true, finalApprovalRecorded: true, preserveProviderReceipt: true } })], { type: "application/json" }), "payload.json");
  for (const asset of assets) {
    const stored = await env.BUCKET.get(asset.storageKey);
    if (!stored) return Response.json({ error: `${asset.name} Is Missing From The Permanent Marketing Asset Library` }, { status: 409 });
    form.append("media", new File([await stored.arrayBuffer()], asset.name, { type: asset.contentType || "application/octet-stream" }));
  }
  const response = await fetch(webhookUrl, { method: "POST", headers: webhookToken ? { Authorization: `Bearer ${webhookToken}` } : undefined, body: form });
  const receipt = await providerReceipt(response);
  if (!response.ok) return Response.json({ error: `The Connected Social Publisher Rejected This Release (${response.status})${receipt.message ? `: ${receipt.message}` : ""}` }, { status: 502 });
  const now = new Date().toISOString();
  const scheduled = String(data.publishAt || "") > now.slice(0, 16);
  const nextStatus = receipt.status === "Published" ? "Published" : scheduled ? "Scheduled" : "Queued For Publication";
  await db.update(commandRecords).set({ status: nextStatus, meta: `${row.meta} · ${nextStatus}`, dataJson: JSON.stringify({ ...data, providerReceipt: receipt, releasedAt: now, releasedBy: actor.name, releaseIdempotencyKey: idempotencyKey }), updatedAt: now }).where(and(eq(commandRecords.projectId, SALES_PROJECT_ID), eq(commandRecords.id, row.id)));
  await db.insert(recordAudits).values({ projectId: SALES_PROJECT_ID, recordId: row.id, fieldName: "Social Provider Release", oldValue: row.status, newValue: nextStatus, reason: "Owner/Admin approved connected company-page publication", actorName: actor.name, actorEmail: actor.email, summary: `${row.title} · ${platforms.join(" + ")} · ${nextStatus}`, createdAt: now });
  return Response.json({ saved: true, message: `${row.title} ${scheduled ? "Was Scheduled With" : "Was Released To"} ${platforms.join(" And ")}.`, receipt });
}

async function dispatchNewsletter(request: Request, db: Awaited<ReturnType<typeof marketingDatabase>>, actor: ReturnType<typeof getCommandActor>, access: { canApprove: boolean }, input: MarketingInput) {
  const testOnly = input.action === "send-test-newsletter";
  if (!testOnly && !access.canApprove) return Response.json({ error: "Owner Or Administrator Final Approval Is Required Before Newsletter Delivery" }, { status: 403 });
  const row = await marketingRecord(db, String(input.recordId || ""), "Marketing Newsletter");
  if (!row) return Response.json({ error: "The Newsletter Could Not Be Found" }, { status: 404 });
  const data = parse(row.dataJson);
  const connectionError = await requiredConnectionError(db, ["marketing-email"]);
  if (connectionError) return Response.json({ error: connectionError }, { status: 409 });
  const { env } = await import("cloudflare:workers");
  const binding = env as unknown as Record<string, unknown>;
  const webhookUrl = String(binding.MARKETING_EMAIL_WEBHOOK_URL || "").trim();
  const webhookToken = String(binding.MARKETING_EMAIL_WEBHOOK_TOKEN || "").trim();
  if (!webhookUrl) return Response.json({ error: "The Marketing Mailbox Is Marked Connected But Its Secure Delivery Endpoint Is Missing In IT & Integrations" }, { status: 409 });
  const audience = String(data.audience || "");
  const recipients = testOnly ? [{ name: actor.name, email: actor.email }] : audience === "Internal Employees" ? await activeEmployeeRecipients(db) : await eligibleExternalRecipients(db);
  if (!recipients.length) return Response.json({ error: testOnly ? "Your Company Email Is Required For A Test" : "No Eligible Recipients Remain After The Live Audience And Suppression Review" }, { status: 409 });
  const scheduledAt = String(data.scheduledAt || "");
  const idempotencyKey = `${row.id}:${testOnly ? `test:${actor.email}` : scheduledAt}:${row.updatedAt}`;
  const response = await fetch(webhookUrl, { method: "POST", headers: { "Content-Type": "application/json", ...(webhookToken ? { Authorization: `Bearer ${webhookToken}` } : {}) }, body: JSON.stringify({ channel: testOnly ? "marketing-newsletter-test" : "marketing-newsletter", idempotencyKey, recordId: row.id, from: String(data.senderEmail || "marketing@meffcon.com"), recipients, audience, subject: `${testOnly ? "[TEST] " : ""}${String(data.subject || row.title)}`, previewText: String(data.previewText || ""), html: String(data.body || "").replace(/\n/g, "<br>"), text: String(data.body || ""), scheduledAt: testOnly ? "" : scheduledAt, approvedBy: testOnly ? "Test Delivery" : actor.name, approvedByEmail: actor.email, callbackOrigin: new URL(request.url).origin, safeguards: { recalculateAudienceAtRelease: true, suppressionApplied: true, unsubscribeRequired: audience === "External Contacts", testOnly } }) });
  const receipt = await providerReceipt(response);
  if (!response.ok) return Response.json({ error: `The Connected Marketing Mailbox Rejected This ${testOnly ? "Test" : "Release"} (${response.status})${receipt.message ? `: ${receipt.message}` : ""}` }, { status: 502 });
  const now = new Date().toISOString();
  if (testOnly) {
    await db.insert(recordAudits).values({ projectId: SALES_PROJECT_ID, recordId: row.id, fieldName: "Newsletter Test Delivery", oldValue: "Not Tested", newValue: `Accepted For ${actor.email}`, reason: "Marketing editor requested controlled test delivery", actorName: actor.name, actorEmail: actor.email, summary: `${row.title} · Test To ${actor.email}`, createdAt: now });
    return Response.json({ saved: true, message: `A Test Of ${row.title} Was Accepted For Delivery To ${actor.email}.`, receipt });
  }
  const scheduled = scheduledAt > now.slice(0, 16);
  const nextStatus = scheduled ? "Scheduled" : "Queued For Delivery";
  await db.update(commandRecords).set({ status: nextStatus, meta: `${row.meta} · ${recipients.length} Recipient(s) · ${nextStatus}`, dataJson: JSON.stringify({ ...data, providerReceipt: receipt, releasedAt: now, releasedBy: actor.name, releaseRecipientCount: recipients.length, releaseIdempotencyKey: idempotencyKey }), updatedAt: now }).where(and(eq(commandRecords.projectId, SALES_PROJECT_ID), eq(commandRecords.id, row.id)));
  await db.insert(recordAudits).values({ projectId: SALES_PROJECT_ID, recordId: row.id, fieldName: "Newsletter Provider Release", oldValue: row.status, newValue: nextStatus, reason: "Owner/Admin approved connected newsletter delivery", actorName: actor.name, actorEmail: actor.email, summary: `${row.title} · ${audience} · ${recipients.length} Recipient(s)`, createdAt: now });
  return Response.json({ saved: true, message: `${row.title} Was ${scheduled ? "Scheduled" : "Queued"} For ${recipients.length.toLocaleString("en-US")} Eligible Recipient(s).`, receipt });
}

async function syncMarketingAnalytics(request: Request, db: Awaited<ReturnType<typeof marketingDatabase>>, actor: ReturnType<typeof getCommandActor>) {
  const connectionError = await requiredConnectionError(db, ["linkedin-company", "facebook-company", "google-analytics"], true);
  if (connectionError) return Response.json({ error: connectionError }, { status: 409 });
  const { env } = await import("cloudflare:workers");
  const binding = env as unknown as Record<string, unknown>;
  const webhookUrl = String(binding.MARKETING_ANALYTICS_WEBHOOK_URL || "").trim();
  const webhookToken = String(binding.MARKETING_ANALYTICS_WEBHOOK_TOKEN || "").trim();
  if (!webhookUrl) return Response.json({ error: "Connected Marketing Analytics Are Missing Their Secure Sync Endpoint In IT & Integrations" }, { status: 409 });
  const response = await fetch(webhookUrl, { method: "POST", headers: { "Content-Type": "application/json", ...(webhookToken ? { Authorization: `Bearer ${webhookToken}` } : {}) }, body: JSON.stringify({ action: "sync-marketing-analytics", requestedBy: actor.email, callbackOrigin: new URL(request.url).origin }) });
  const body = await safeProviderJson(response);
  if (!response.ok) return Response.json({ error: `The Connected Analytics Service Rejected The Sync (${response.status})` }, { status: 502 });
  const snapshots = Array.isArray(body.snapshots) ? body.snapshots.slice(0, 100) : [];
  const now = new Date().toISOString();
  let saved = 0;
  for (const raw of snapshots) {
    const item = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const platform = String(item.platform || "");
    if (!["LinkedIn", "Facebook", "Google Analytics", "Newsletter"].includes(platform)) continue;
    const snapshotDate = /^\d{4}-\d{2}-\d{2}$/.test(String(item.snapshotDate || "")) ? String(item.snapshotDate) : now.slice(0, 10);
    const providerId = String(item.providerId || item.id || crypto.randomUUID()).replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 100);
    const id = `ANALYTICS-${platform.toUpperCase().replace(/[^A-Z0-9]/g, "-")}-${snapshotDate}-${providerId}`.slice(0, 160);
    const metrics = Object.fromEntries(["impressions", "reach", "clicks", "engagements", "sessions", "conversions"].map((key) => [key, Math.max(0, Number(item[key] || 0))]));
    await db.insert(commandRecords).values({ projectId: SALES_PROJECT_ID, id, recordType: "Marketing Analytics Snapshot", title: `${platform} · ${snapshotDate}`, owner: "Connected Provider", due: snapshotDate, status: "Provider Verified", meta: `${Number(metrics.impressions || 0).toLocaleString("en-US")} Impressions · Connected Provider`, recordDate: snapshotDate, dateLocked: true, dataJson: JSON.stringify({ ...metrics, platform, relatedId: String(item.relatedId || ""), source: "Connected Provider", providerId, providerTimestamp: String(item.providerTimestamp || now), syncedAt: now }), updatedAt: now }).onConflictDoUpdate({ target: [commandRecords.projectId, commandRecords.id], set: { status: "Provider Verified", meta: `${Number(metrics.impressions || 0).toLocaleString("en-US")} Impressions · Connected Provider`, dataJson: JSON.stringify({ ...metrics, platform, relatedId: String(item.relatedId || ""), source: "Connected Provider", providerId, providerTimestamp: String(item.providerTimestamp || now), syncedAt: now }), updatedAt: now } });
    saved += 1;
  }
  await db.insert(recordAudits).values({ projectId: SALES_PROJECT_ID, recordId: `ANALYTICS-SYNC-${now}`, fieldName: "Marketing Analytics Sync", oldValue: "Requested", newValue: `${saved} Snapshot(s) Saved`, reason: "Connected provider analytics were requested and normalized", actorName: actor.name, actorEmail: actor.email, summary: `${saved} provider snapshot(s) stored with timestamps`, createdAt: now });
  return Response.json({ saved: true, message: `${saved} Connected Analytics Snapshot(s) Were Refreshed.`, snapshots: saved });
}

async function marketingRecord(db: Awaited<ReturnType<typeof marketingDatabase>>, recordId: string, recordType: string) {
  if (!recordId) return null;
  const rows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, SALES_PROJECT_ID), eq(commandRecords.id, recordId), eq(commandRecords.recordType, recordType))).limit(1);
  return rows[0] || null;
}

async function requiredConnectionError(db: Awaited<ReturnType<typeof marketingDatabase>>, keys: string[], anyConnected = false) {
  const rows = await db.select().from(commandRecords).where(eq(commandRecords.projectId, INTEGRATION_PROJECT_ID));
  const statuses = new Map(rows.map((row) => [row.id.toLowerCase(), row.status]));
  const connected = keys.filter((key) => statuses.get(`integration-${key}`) === "Connected");
  if (anyConnected ? connected.length > 0 : connected.length === keys.length) return "";
  const missing = keys.filter((key) => !connected.includes(key)).map((key) => key.replaceAll("-", " ")).join(", ");
  return `Connect And Validate ${missing} In IT & Integrations Before External Delivery`;
}

async function eligibleExternalRecipients(db: Awaited<ReturnType<typeof marketingDatabase>>) {
  const rows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, SALES_PROJECT_ID), eq(commandRecords.recordType, "Sales Contacts")));
  const unique = new Map<string, { name: string; email: string }>();
  for (const row of rows) {
    const data = parse(row.dataJson);
    const email = String(data.email || "").trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email) || ["Do Not Email", "Suppressed"].includes(marketingAudienceStatus(data.marketingEmailStatus))) continue;
    unique.set(email, { name: row.title, email });
  }
  return [...unique.values()];
}

async function activeEmployeeRecipients(db: Awaited<ReturnType<typeof marketingDatabase>>) {
  const rows = await db.select().from(companyMembers).where(eq(companyMembers.isActive, true));
  return rows.filter((member) => /^\S+@\S+\.\S+$/.test(member.email)).map((member) => ({ name: member.displayName, email: member.email.toLowerCase() }));
}

function marketingAudienceStatus(value: unknown): "Eligible" | "Consent Review" | "Do Not Email" | "Suppressed" {
  const status = String(value || "Consent Review");
  return ["Eligible", "Consent Review", "Do Not Email", "Suppressed"].includes(status) ? status as "Eligible" | "Consent Review" | "Do Not Email" | "Suppressed" : "Consent Review";
}

async function providerReceipt(response: Response) {
  const body = await safeProviderJson(response);
  return { status: String(body.status || "Accepted"), providerId: String(body.providerId || body.id || ""), scheduledAt: String(body.scheduledAt || ""), publishedAt: String(body.publishedAt || ""), message: String(body.message || "").slice(0, 500) };
}

async function safeProviderJson(response: Response): Promise<Record<string, unknown>> {
  try { const body = await response.json() as unknown; return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {}; } catch { return {}; }
}

async function uploadAsset(request: Request, db: Awaited<ReturnType<typeof marketingDatabase>>, actor: ReturnType<typeof getCommandActor>) {
  await ensureProjectFileSchema();
  const form = await request.formData();
  const action = String(form.get("action") || "");
  if (!["upload-asset", "upload-survey-video"].includes(action)) return Response.json({ error: "A Valid Marketing Asset Action Is Required" }, { status: 400 });
  const file = form.get("file");
  const surveyVideo = action === "upload-survey-video";
  const allowed = surveyVideo ? file instanceof File && isVideoUpload(file) : file instanceof File && isPhotoUpload(file);
  const maxBytes = surveyVideo ? MAX_SURVEY_VIDEO_BYTES : MAX_ASSET_BYTES;
  if (!(file instanceof File) || !file.size || file.size > maxBytes || !allowed) {
    return Response.json({ error: surveyVideo ? "Choose A Video File Up To 250 MB" : "Choose An Image File Up To 15 MB" }, { status: 400 });
  }
  const contentType = surveyVideo ? normalizeUploadContentType(file.name, file.type) : photoUploadContentType(file);
  const safeName = file.name.replace(/[^a-zA-Z0-9._ -]+/g, "-");
  const storageKey = `${SALES_PROJECT_ID}/${surveyVideo ? "customer-voice" : "marketing"}/${crypto.randomUUID()}-${safeName}`;
  const { env } = await import("cloudflare:workers");
  await env.BUCKET.put(storageKey, file.stream(), { httpMetadata: { contentType }, customMetadata: { uploadedBy: actor.email, purpose: surveyVideo ? "Customer Survey Video" : "Marketing Content" } });
  const category = surveyVideo ? SURVEY_VIDEO_CATEGORY : ASSET_CATEGORY;
  const [saved] = await db.insert(projectFiles).values({ projectId: SALES_PROJECT_ID, name: file.name, category, revision: "Original", storageKey, contentType, sizeBytes: file.size, uploadedBy: actor.name, access: surveyVideo ? "Owners Marketing And Assigned Project Team" : "Marketing Team" }).returning();
  await db.insert(recordAudits).values({ projectId: SALES_PROJECT_ID, recordId: `${surveyVideo ? "CUSTOMER-VIDEO" : "MARKETING-ASSET"}-${saved.id}`, fieldName: surveyVideo ? "Customer Survey Video" : "Marketing Asset", oldValue: "No File", newValue: saved.name, reason: surveyVideo ? "Original customer video stored with survey evidence" : "Original image stored for controlled marketing content", actorName: actor.name, actorEmail: actor.email, summary: `${saved.name} uploaded to the permanent ${surveyVideo ? "Customer Voice" : "Marketing Asset"} library` });
  return Response.json(surveyVideo ? { surveyVideo: toFile(saved) } : { asset: toFile(saved) }, { status: 201 });
}

function validateRecord(type: string, record: ReturnType<typeof normalizeRecord>) {
  if (!record.title || !record.owner || !record.status || !/^\d{4}-\d{2}-\d{2}$/.test(record.recordDate)) return "Title Owner Status And Record Date Are Required";
  if (type === "Marketing Campaigns") {
    if (!String(record.data.audience || "").trim() || !String(record.data.objective || "").trim() || !String(record.data.startDate || "").trim() || !String(record.data.endDate || "").trim()) return "Campaign Audience Objective Start Date And End Date Are Required";
    if (!String(record.data.campaignType || "").trim() || !String(record.data.contentPillar || "").trim() || !String(record.data.primaryKpi || "").trim() || !String(record.data.callToAction || "").trim()) return "Campaign Type Content Pillar Primary KPI And Call To Action Are Required";
    if (String(record.data.endDate) < String(record.data.startDate)) return "Campaign End Date Must Be On Or After The Start Date";
  }
  if (type === "Marketing Content") {
    const platforms = Array.isArray(record.data.platforms) ? record.data.platforms : [];
    const templateKeys = ["project-spotlight", "milestone", "expert-tip", "team-culture"];
    const formats = ["Photo", "Carousel", "Video", "Graphic", "Text Only", "Link"];
    if (!templateKeys.includes(String(record.data.templateKey || "")) || !String(record.data.contentPillar || "").trim() || !formats.includes(String(record.data.format || ""))) return "A Social Template Content Pillar And Post Format Are Required";
    if (String(record.data.body || "").trim().length < 25 || !String(record.data.callToAction || "").trim() || !platforms.length || !String(record.data.publishAt || "").trim()) return "Complete Post Copy Call To Action Platform And Planned Publish Time Are Required";
    if (Array.isArray(record.data.assetIds) && record.data.assetIds.length && String(record.data.imageAltText || "").trim().length < 5) return "Image Alt Text Is Required When A Social Post Includes Pictures";
    if (["Published", "Sent"].includes(record.status)) return "Connected Provider Evidence Is Required To Record Published Content";
  }
  if (type === "Marketing Newsletter") {
    const templateKeys = ["external-monthly", "project-announcement", "employee-news", "event-invitation"];
    if (!templateKeys.includes(String(record.data.templateKey || "")) || !String(record.data.emailType || "").trim()) return "An Email Campaign Template And Email Type Are Required";
    if (String(record.data.subject || "").trim().length < 3 || String(record.data.previewText || "").trim().length < 10 || String(record.data.body || "").trim().length < 40 || !String(record.data.ctaLabel || "").trim() || !String(record.data.scheduledAt || "").trim() || !["External Contacts", "Internal Employees"].includes(String(record.data.audience || ""))) return "Email Audience Subject Preview Message Call To Action And Planned Delivery Are Required";
    if (record.status === "Sent") return "Connected Delivery Evidence Is Required To Record A Sent Newsletter";
  }
  if (type === "Marketing Analytics Snapshot") {
    if (!["LinkedIn", "Facebook", "Google Analytics", "Newsletter"].includes(String(record.data.platform || ""))) return "Select A Valid Analytics Source";
    for (const field of ["impressions", "reach", "clicks", "engagements", "sessions", "conversions"]) if (Number(record.data[field] || 0) < 0) return "Analytics Values Cannot Be Negative";
  }
  if (type === "Marketing Customer Survey Response") {
    if (!String(record.data.projectId || "").trim() || !String(record.data.milestone || "").trim() || !String(record.data.respondentName || "").trim()) return "Project Milestone And Customer Name Are Required";
    for (const field of ["overallRating", "communication", "quality", "schedule", "professionalism", "value", "recommendation"]) {
      const score = Number(record.data[field] || 0);
      if (score < 1 || score > 5) return "Every Customer Rating Must Be Between 1 And 5";
    }
  }
  if (type === "Marketing Customer Survey Request" && !String(record.data.projectId || "").trim()) return "A Project Is Required For Every Survey Request";
  if (type === "Marketing Configuration" && !/^\S+@\S+\.\S+$/.test(String(record.data.senderEmail || ""))) return "A Valid Dedicated Marketing Sender Email Is Required";
  return "";
}

function normalizeRecord(record: NonNullable<MarketingInput["record"]>, actorName: string) {
  const id = String(record.id || `MKT-${crypto.randomUUID().toUpperCase()}`).trim().replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 160);
  const recordDate = String(record.recordDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
  return {
    id,
    title: String(record.title || "").trim().slice(0, 180),
    owner: String(record.owner || actorName).trim().slice(0, 120),
    due: String(record.due || "").trim().slice(0, 80),
    status: String(record.status || "Draft").trim().slice(0, 80),
    meta: String(record.meta || "").trim().slice(0, 500),
    recordDate,
    data: record.data && typeof record.data === "object" && !Array.isArray(record.data) ? record.data : {},
  };
}

async function marketingAccess(db: Awaited<ReturnType<typeof marketingDatabase>>, actor: ReturnType<typeof getCommandActor>) {
  const member = actor.email ? await db.select().from(companyMembers).where(eq(companyMembers.email, actor.email)).limit(1) : [];
  const level = member[0]?.companyAccessLevel || actor.accessLevel;
  const designations = parseStringArray(member[0]?.designationsJson || "[]");
  const canEdit = ["Company Owner", "Administrator"].includes(level) || designations.some((item) => ["Marketing", "Sales Representative"].includes(item));
  return { canView: canEdit, canEdit, canApprove: ["Company Owner", "Administrator"].includes(level), accessLevel: level, designations };
}

function toRecord(row: typeof commandRecords.$inferSelect) {
  return { id: row.id, type: row.recordType, title: row.title, owner: row.owner, due: row.due, status: row.status, meta: row.meta, recordDate: row.recordDate || "", createdAt: row.createdAt, updatedAt: row.updatedAt, data: parse(row.dataJson) };
}

function toFile(file: typeof projectFiles.$inferSelect) {
  return { id: file.id, name: file.name, contentType: file.contentType, size: file.sizeBytes, uploadedBy: file.uploadedBy, createdAt: file.createdAt, url: `/api/files?id=${file.id}` };
}

function parse(value: string) {
  try { const result = JSON.parse(value) as unknown; return result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : {}; } catch { return {}; }
}

function parseStringArray(value: string) {
  try { const result = JSON.parse(value) as unknown; return Array.isArray(result) ? result.filter((item): item is string => typeof item === "string") : []; } catch { return []; }
}

async function marketingDatabase() {
  const { getDb } = await import("../../../db");
  return getDb();
}
