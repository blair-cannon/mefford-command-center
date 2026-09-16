import { and, eq } from "drizzle-orm";
import { commandRecords, companyMembers, ownerPortalAccess, projects, recordAudits } from "../db/schema";
import { CUSTOMER_SURVEY_REQUEST_TYPE } from "./performance-reviews";

export const SALES_PROJECT_ID = "MEFFORD-SALES";
export const CUSTOMER_SURVEY_RECIPIENT_TYPE = "Customer Survey Recipient Settings";
export const CUSTOMER_SURVEY_RECIPIENT_ID = "CUSTOMER-SURVEY-RECIPIENTS";
const INTEGRATION_PROJECT_ID = "MEFFORD-COMPANY";

export type SurveyQuestion = { key: string; label: string };

export const CUSTOMER_SURVEY_PROGRAMS = {
  startup: {
    label: "Project Startup",
    description: "A short check-in after the fully executed Design-Build contract and startup handoff.",
    questions: [
      ["scopeProcess", "How clearly did we explain the project scope and process?"],
      ["responsiveness", "How responsive has our team been?"],
      ["goals", "How well do we understand your goals?"],
      ["startupEase", "How easy was the contract and startup process?"],
      ["teamConfidence", "How confident are you in the Mefford team?"],
    ],
  },
  design: {
    label: "Design Experience",
    description: "A Design-Build check-in after construction has started, focused on the design experience.",
    questions: [
      ["designFit", "How well did the design reflect your needs?"],
      ["decisionClarity", "How clearly were design decisions explained?"],
      ["budgetCommunication", "How effectively did we communicate budget impacts?"],
      ["designResponsiveness", "How organized and responsive was the design process?"],
      ["constructionReadiness", "How prepared did the project feel when construction began?"],
    ],
  },
  midpoint: {
    label: "Construction Midpoint",
    description: "A project check-in when the weighted construction schedule reaches 50% complete.",
    questions: [
      ["progressSatisfaction", "How satisfied are you with the project’s progress?"],
      ["communication", "How would you rate communication from our team?"],
      ["professionalism", "How professional and organized has the project been?"],
      ["issueResolution", "How well have questions or concerns been resolved?"],
      ["completionConfidence", "How confident are you in the project’s successful completion?"],
    ],
  },
  completion: {
    label: "Project Completion",
    description: "A final check-in after substantial completion and owner turnover.",
    questions: [
      ["completedWork", "How satisfied are you with the completed work?"],
      ["quality", "How would you rate the quality of the finished project?"],
      ["communication", "How would you rate communication throughout the project?"],
      ["closeout", "How well did we handle punch-list items and closeout?"],
      ["recommendation", "How likely are you to hire or recommend Mefford again?"],
    ],
  },
  monthly: {
    label: "Monthly T&M Check-In",
    description: "A monthly check-in tied to the owner invoice for services performed this billing cycle.",
    questions: [
      ["monthlySatisfaction", "How satisfied are you with our work this month?"],
      ["servicesClarity", "Did we clearly explain the services performed?"],
      ["invoiceClarity", "Was the invoice clear and easy to understand?"],
      ["invoiceFairness", "Do you believe the invoice was fair for the work performed?"],
      ["hireAgain", "Would you hire Mefford again?"],
    ],
  },
} as const satisfies Record<string, { label: string; description: string; questions: readonly (readonly [string, string])[] }>;

export const CUSTOMER_SURVEY_MILESTONES = Object.entries(CUSTOMER_SURVEY_PROGRAMS).map(([key, program]) => ({ key, label: program.label, description: program.description }));

type Recipient = { name: string; email: string; primary: boolean };
type Trigger = { key: keyof typeof CUSTOMER_SURVEY_PROGRAMS; date: string; sourceId: string; billingPeriod?: string };

export async function reconcileCustomerSurveyMilestones(now = new Date(), origin = "https://mefford-project-command.jordan-mefor-1272.chatgpt.site") {
  const { getDb } = await import("../db");
  const db = getDb();
  const [projectRows, recordRows, memberRows, requestRows, ownerAccessRows] = await Promise.all([
    db.select().from(projects), db.select().from(commandRecords), db.select().from(companyMembers).where(eq(companyMembers.isActive, true)),
    db.select().from(commandRecords).where(and(eq(commandRecords.projectId, SALES_PROJECT_ID), eq(commandRecords.recordType, CUSTOMER_SURVEY_REQUEST_TYPE))),
    db.select().from(ownerPortalAccess),
  ]);
  const settings = await deliverySettings(recordRows, origin);
  let created = 0, updated = 0, sent = 0, reminders = 0, deliveryDeferred = 0, deliveryFailed = 0;
  const knownRequests = [...requestRows];

  for (const project of projectRows) {
    const projectRecords = recordRows.filter((record) => record.projectId === project.number);
    const ownerAccess = ownerAccessRows.find((row) => row.projectId === project.number);
    const recipients = surveyRecipients(project, projectRecords, ownerAccess);
    const teamEmails = memberRows.filter((member) => [project.projectManager, project.superintendent].includes(member.displayName)).map((member) => member.email);
    const triggers = projectTriggers(project, projectRecords, now);
    for (const trigger of triggers) {
      const program = CUSTOMER_SURVEY_PROGRAMS[trigger.key];
      for (const recipient of recipients) {
        const proposedId = requestId(project.number, trigger, recipient.email);
        const existing = knownRequests.find((record) => record.id === proposedId) || knownRequests.find((record) => {
          const legacy = parse(record.dataJson);
          const legacyEmail = text(legacy.ownerEmail || legacy.recipientEmail).toLowerCase();
          return Boolean(recipient.primary && text(legacy.projectId) === project.number && canonicalMilestone(text(legacy.milestoneKey)) === trigger.key && (!legacyEmail || legacyEmail === recipient.email));
        });
        const id = existing?.id || proposedId;
        const prior = parse(existing?.dataJson || "{}");
        const token = text(prior.token) || crypto.randomUUID();
        const surveyOrigin = settings.surveyOrigin || origin;
        const surveyUrl = `${surveyOrigin.replace(/\/$/, "")}/customer-survey?token=${encodeURIComponent(token)}`;
        const ready = deliveryReady(settings, recipient.email);
        const status = text(prior.responseId) ? "Responded" : text(prior.acceptedAt || prior.sentAt) ? "Provider Accepted" : !recipient.email ? "Primary Customer Email Required" : ready ? "Queued For Automatic Delivery" : "Manual Link Ready · Delivery Deferred";
        const effectiveTriggerDate = isoDate(prior.triggerDate) || trigger.date;
        const due = isoDate(prior.responseDue) || addDays(effectiveTriggerDate, 7);
        const data = {
          ...prior, projectId: project.number, projectName: project.name, projectStatus: project.status, projectType: contractFamily(project), ownerName: project.ownerName,
          ownerEmail: recipient.email, recipientName: recipient.name, recipientEmail: recipient.email, primaryRecipient: recipient.primary,
          projectManager: project.projectManager, superintendent: project.superintendent, teamEmails: [...new Set(teamEmails)], milestone: program.label,
          milestoneKey: trigger.key, milestoneDescription: program.description, triggerDate: effectiveTriggerDate, triggerSourceId: text(prior.triggerSourceId) || trigger.sourceId,
          billingPeriod: trigger.billingPeriod || "", questions: program.questions.map(([key, label]) => ({ key, label })), responseDue: due, token, surveyUrl,
          deliveryPolicy: "Automatic, single-use delivery to the primary customer contact and every PM-designated additional recipient. Delivery is recorded only after provider acceptance.",
          reminderPolicy: "One automatic reminder four days after provider acceptance when no response is recorded.",
          displayPolicy: "Every rating contributes to aggregate review totals. Names, comments, project details, and photos display only with explicit customer consent.",
          updatedAt: now.toISOString(),
        };
        await db.insert(commandRecords).values({ projectId: SALES_PROJECT_ID, id, recordType: CUSTOMER_SURVEY_REQUEST_TYPE, title: `${project.name} · ${program.label} Customer Survey`, owner: recipient.name || project.ownerName, due, status, meta: `${project.number} · ${recipient.email} · ${program.label}`, recordDate: trigger.date, dateLocked: true, dataJson: JSON.stringify(data), updatedAt: now.toISOString() }).onConflictDoUpdate({ target: [commandRecords.projectId, commandRecords.id], set: { owner: recipient.name || project.ownerName, due, status: existing && ["Sent", "Provider Accepted", "Responded"].includes(existing.status) ? existing.status : status, meta: `${project.number} · ${recipient.email} · ${program.label}`, dataJson: JSON.stringify(data), updatedAt: now.toISOString() } });
        if (existing) updated += 1;
        else {
          created += 1;
          knownRequests.push({ projectId: SALES_PROJECT_ID, id, recordType: CUSTOMER_SURVEY_REQUEST_TYPE, title: `${project.name} · ${program.label} Customer Survey`, owner: recipient.name, due, status, meta: `${project.number} · ${recipient.email}`, recordDate: trigger.date, recordTime: null, dateLocked: true, dataJson: JSON.stringify(data), createdAt: now.toISOString(), updatedAt: now.toISOString() });
          await db.insert(recordAudits).values({ projectId: SALES_PROJECT_ID, recordId: id, fieldName: "Customer Survey Trigger", oldValue: "Not Triggered", newValue: status, reason: `Verified ${program.label} automatic trigger`, actorName: "Customer Voice Automation", actorEmail: "system@meffcon.com", summary: `${project.number} ${program.label} request created for ${recipient.primary ? "the primary" : "a PM-designated"} customer contact` });
        }
        if (!text(prior.acceptedAt || prior.sentAt) && !ready) deliveryDeferred += 1;
        if (ready && !text(prior.acceptedAt || prior.sentAt)) {
          const delivery = await sendSurvey(settings, { id, recipientEmail: recipient.email, recipientName: recipient.name, projectName: project.name, milestone: program.label, due, surveyUrl, reminder: false });
          const deliveredAt = new Date().toISOString();
          await db.update(commandRecords).set({ status: delivery.ok ? "Provider Accepted" : "Delivery Failed", dataJson: JSON.stringify({ ...data, acceptedAt: delivery.ok ? deliveredAt : "", deliveryAttemptedAt: deliveredAt, providerReceipt: delivery.receipt, deliveryError: delivery.error }), updatedAt: deliveredAt }).where(and(eq(commandRecords.projectId, SALES_PROJECT_ID), eq(commandRecords.id, id)));
          if (delivery.ok) sent += 1; else deliveryFailed += 1;
        } else if (ready && text(prior.acceptedAt) && !text(prior.responseId) && !text(prior.reminderAcceptedAt) && elapsedDays(text(prior.acceptedAt), now) >= 4) {
          const delivery = await sendSurvey(settings, { id, recipientEmail: recipient.email, recipientName: recipient.name, projectName: project.name, milestone: program.label, due, surveyUrl, reminder: true });
          const attemptedAt = new Date().toISOString();
          await db.update(commandRecords).set({ dataJson: JSON.stringify({ ...data, reminderAttemptedAt: attemptedAt, reminderAcceptedAt: delivery.ok ? attemptedAt : "", reminderProviderReceipt: delivery.receipt, reminderError: delivery.error }), updatedAt: attemptedAt }).where(and(eq(commandRecords.projectId, SALES_PROJECT_ID), eq(commandRecords.id, id)));
          if (delivery.ok) reminders += 1; else deliveryFailed += 1;
        }
      }
    }
  }
  for (const legacyRequest of requestRows) {
    const data = parse(legacyRequest.dataJson);
    if (data.legacyProject !== true || text(data.responseId)) continue;
    const recipientEmail = text(data.recipientEmail || data.ownerEmail).toLowerCase();
    if (!deliveryReady(settings, recipientEmail)) continue;
    const acceptedAt = text(data.acceptedAt || data.sentAt);
    const isReminder = Boolean(acceptedAt);
    if (isReminder && (text(data.reminderAcceptedAt) || elapsedDays(acceptedAt, now) < 4)) continue;
    const delivery = await sendSurvey(settings, { id: legacyRequest.id, recipientEmail, recipientName: text(data.recipientName || data.ownerName), projectName: text(data.projectName), milestone: text(data.milestone), due: text(data.responseDue || legacyRequest.due), surveyUrl: text(data.surveyUrl), reminder: isReminder });
    const attemptedAt = new Date().toISOString();
    const updatedData = isReminder
      ? { ...data, reminderAttemptedAt: attemptedAt, reminderAcceptedAt: delivery.ok ? attemptedAt : "", reminderProviderReceipt: delivery.receipt, reminderError: delivery.error }
      : { ...data, acceptedAt: delivery.ok ? attemptedAt : "", deliveryAttemptedAt: attemptedAt, providerReceipt: delivery.receipt, deliveryError: delivery.error };
    await db.update(commandRecords).set({ status: delivery.ok ? "Provider Accepted" : "Delivery Failed", dataJson: JSON.stringify(updatedData), updatedAt: attemptedAt }).where(and(eq(commandRecords.projectId, SALES_PROJECT_ID), eq(commandRecords.id, legacyRequest.id)));
    if (delivery.ok) { if (isReminder) reminders += 1; else sent += 1; } else deliveryFailed += 1;
  }
  if (deliveryFailed) throw new Error(`${deliveryFailed} customer survey delivery attempt${deliveryFailed === 1 ? "" : "s"} failed before provider acceptance`);
  return { created, updated, providerAccepted: sent, reminderProviderAccepted: reminders, deliveryDeferred, projects: projectRows.length, mailboxConnection: settings.marketingConnection, surveyConnection: settings.surveyConnection, secureSurveyOrigin: Boolean(settings.surveyOrigin), policy: "Contract-type triggers, recipients, monthly billing cadence, reminders, and external delivery are idempotent and receipt-gated", ...(deliveryDeferred ? { scheduledOutcome: "Deferred" as const, reason: `${deliveryDeferred} customer survey${deliveryDeferred === 1 ? " is" : "s are"} ready as secure links but waiting for the approved delivery connection` } : {}) };
}

function projectTriggers(project: typeof projects.$inferSelect, records: Array<typeof commandRecords.$inferSelect>, now: Date): Trigger[] {
  const family = contractFamily(project);
  if (["Cancelled", "Canceled", "Archived"].includes(project.status)) return [];
  if (family === "T&M") return invoiceTriggers(records, now);
  const turnover = turnoverCompleted(project, records);
  if (["Completed", "Complete", "Closed"].includes(project.status)) {
    const date = turnover ? addDays(turnover.date, 7) : "";
    return turnover && reached(date, now) && withinLookback(date, now, 60) ? [{ key: "completion", date, sourceId: turnover.sourceId }] : [];
  }
  const triggers: Trigger[] = [];
  if (family === "Design-Build") {
    const contract = records.find((record) => ["Contracts", "Owner Contract"].includes(record.recordType) && record.status === "Executed");
    const executed = project.ownerContractStatus === "Executed" || Boolean(contract);
    const contractDate = isoDate(contract?.recordDate || project.ownerContractDate);
    if (executed && contractDate && reached(addDays(contractDate, 3), now) && withinLookback(addDays(contractDate, 3), now, 45)) triggers.push({ key: "startup", date: addDays(contractDate, 3), sourceId: contract?.id || project.ownerContractRecordId || "PROJECT-CONTRACT" });
    const started = constructionStarted(records);
    if (started && reached(addDays(started.date, 7), now) && withinLookback(addDays(started.date, 7), now, 45)) triggers.push({ key: "design", date: addDays(started.date, 7), sourceId: started.sourceId });
  }
  const midpoint = scheduleMidpoint(records, now);
  if (midpoint) triggers.push({ key: "midpoint", date: midpoint.date, sourceId: midpoint.sourceId });
  if (turnover && reached(addDays(turnover.date, 7), now) && withinLookback(addDays(turnover.date, 7), now, 60)) triggers.push({ key: "completion", date: addDays(turnover.date, 7), sourceId: turnover.sourceId });
  return triggers;
}

function invoiceTriggers(records: Array<typeof commandRecords.$inferSelect>, now: Date): Trigger[] {
  const seen = new Set<string>();
  return records.filter((record) => /Owner Billing/i.test(record.recordType) && ["Sent", "Paid", "Posted"].includes(record.status)).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).flatMap((record) => {
    const data = parse(record.dataJson); const sentAt = isoDate(data.sentAt || record.updatedAt || record.recordDate); const billingPeriod = text(data.billingPeriod || data.period || record.recordDate || record.id); const dedupe = billingPeriod.toLowerCase();
    if (!sentAt || seen.has(dedupe) || !reached(addDays(sentAt, 1), now) || !withinLookback(addDays(sentAt, 1), now, 35)) return [];
    seen.add(dedupe); return [{ key: "monthly" as const, date: addDays(sentAt, 1), sourceId: record.id, billingPeriod }];
  });
}

function scheduleMidpoint(records: Array<typeof commandRecords.$inferSelect>, now: Date) {
  const tasks = records.filter((record) => record.recordType === "Schedule").map((record) => ({ record, data: parse(record.dataJson) }));
  const weightedDays = tasks.reduce((sum, task) => sum + Math.max(1, number(task.data.days)), 0); if (!weightedDays) return null;
  const progress = tasks.reduce((sum, task) => sum + Math.max(1, number(task.data.days)) * clamp(number(task.data.progress), 0, 100), 0) / weightedDays;
  if (progress < 50) return null;
  const evidence = tasks.filter((task) => number(task.data.progress) > 0).sort((a, b) => b.record.updatedAt.localeCompare(a.record.updatedAt))[0];
  return { date: isoDate(evidence?.record.updatedAt) || now.toISOString().slice(0, 10), sourceId: evidence?.record.id || "WEIGHTED-SCHEDULE-50", progress };
}

function constructionStarted(records: Array<typeof commandRecords.$inferSelect>) {
  const evidence = records.filter((record) => record.recordType === "Schedule" && number(parse(record.dataJson).progress) > 0).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0];
  if (!evidence) return null; const data = parse(evidence.dataJson); return { date: isoDate(data.actualStartedAt || evidence.updatedAt) || "", sourceId: evidence.id };
}

function turnoverCompleted(project: typeof projects.$inferSelect, records: Array<typeof commandRecords.$inferSelect>) {
  const turnover = records.find((record) => ["CLS-KEYS-STOCK", "CLS-OWNER-PACKAGE"].includes(record.id) && ["Approved", "Complete", "Completed"].includes(record.status));
  if (turnover) return { date: isoDate(turnover.updatedAt) || project.substantialDate, sourceId: turnover.id };
  if (["Completed", "Complete", "Closed"].includes(project.status)) return { date: isoDate(project.substantialDate || project.finalDate || project.updatedAt), sourceId: "PROJECT-STATUS" };
  return null;
}

function surveyRecipients(project: typeof projects.$inferSelect, records: Array<typeof commandRecords.$inferSelect>, ownerAccess?: typeof ownerPortalAccess.$inferSelect): Recipient[] {
  const contract = records.find((record) => ["Contracts", "Owner Contract"].includes(record.recordType)); const contractData = parse(contract?.dataJson || "{}"); const fields = object(contractData.fields);
  const settings = parse(records.find((record) => record.id === CUSTOMER_SURVEY_RECIPIENT_ID && record.recordType === CUSTOMER_SURVEY_RECIPIENT_TYPE)?.dataJson || "{}"); const configuredPrimary = object(settings.primary);
  const primaryEmail = text(configuredPrimary.email || ownerAccess?.contactEmail || fields.OWNER_NOTICE_EMAIL || contractData.ownerEmail).toLowerCase(); const primaryName = text(configuredPrimary.name || ownerAccess?.contactName || project.ownerName);
  const additional = Array.isArray(settings.additional) ? settings.additional.map(object) : []; const recipients: Recipient[] = [{ name: primaryName || project.ownerName || "Primary Customer Contact", email: primaryEmail, primary: true }];
  for (const item of additional) { const email = text(item.email).toLowerCase(); if (!validEmail(email) || recipients.some((recipient) => recipient.email === email)) continue; recipients.push({ name: text(item.name) || email.split("@")[0], email, primary: false }); }
  return recipients;
}

export function contractFamily(project: Pick<typeof projects.$inferSelect, "ownerContractType" | "projectType">): "Design-Build" | "Plan & Spec" | "T&M" {
  const value = `${project.ownerContractType} ${project.projectType}`.toLowerCase();
  if (/time\s*(?:&|and)\s*material|\bt\s*&\s*m\b|\btm\b/.test(value)) return "T&M";
  if (/design\s*[-/&]?\s*build/.test(value)) return "Design-Build";
  return "Plan & Spec";
}

async function deliverySettings(records: Array<typeof commandRecords.$inferSelect>, fallbackOrigin: string) {
  const { env } = await import("cloudflare:workers"); const binding = env as unknown as Record<string, unknown>;
  const integration = records.find((record) => record.projectId === INTEGRATION_PROJECT_ID && record.id.toLowerCase() === "integration-marketing-email");
  const surveyIntegration = records.find((record) => record.projectId === INTEGRATION_PROJECT_ID && record.id.toLowerCase() === "integration-customer-survey-delivery");
  return { webhookUrl: text(binding.MARKETING_EMAIL_WEBHOOK_URL), webhookToken: text(binding.MARKETING_EMAIL_WEBHOOK_TOKEN), surveyOrigin: text(binding.CUSTOMER_SURVEY_PUBLIC_ORIGIN), sender: text(binding.MARKETING_EMAIL_SENDER) || "marketing@meffcon.com", marketingConnection: integration?.status || "Not Configured", surveyConnection: surveyIntegration?.status || "Not Configured", fallbackOrigin };
}

function deliveryReady(settings: Awaited<ReturnType<typeof deliverySettings>>, email: string) { return Boolean(validEmail(email) && settings.webhookUrl && settings.surveyOrigin && settings.marketingConnection === "Connected" && settings.surveyConnection === "Connected"); }

async function sendSurvey(settings: Awaited<ReturnType<typeof deliverySettings>>, input: { id: string; recipientEmail: string; recipientName: string; projectName: string; milestone: string; due: string; surveyUrl: string; reminder: boolean }) {
  try {
    const response = await fetch(settings.webhookUrl, { method: "POST", headers: { "Content-Type": "application/json", ...(settings.webhookToken ? { Authorization: `Bearer ${settings.webhookToken}` } : {}) }, body: JSON.stringify({ channel: "customer-survey", idempotencyKey: `${input.id}${input.reminder ? ":reminder-1" : ":initial"}`, from: settings.sender, to: input.recipientEmail, subject: `${input.reminder ? "Reminder · " : ""}${input.projectName} · ${input.milestone} Customer Check-In`, text: `${input.recipientName || "Hello"},\n\n${input.reminder ? "This is a single reminder for " : "We would appreciate an honest two-minute check-in about "}${input.projectName}. Please use the five-star survey below and add any comments or project photos you would like us to see.\n\nSecure survey: ${input.surveyUrl}\nRequested by: ${input.due}\n\nEvery rating is recorded. Names, comments, project details, and photos appear on the review display only with your explicit permission.`, safeguards: { oneSurveyPerTriggerAndRecipient: true, oneReminderMaximum: true, publicDisplayRequiresExplicitConsent: true, employmentDecision: false } }) });
    const body = await response.clone().json().catch(() => ({})) as Record<string, unknown>; const receipt = { provider: "Marketing Email Adapter", status: response.status, receiptId: text(body.receiptId || body.id || response.headers.get("x-request-id") || response.headers.get("location") || input.id), acceptedAt: response.ok ? new Date().toISOString() : "", evidence: response.ok ? "Provider Accepted; inbox delivery is not yet proven" : "Provider Rejected" };
    return { ok: response.ok, receipt, error: response.ok ? "" : `Marketing Mailbox Returned ${response.status}` };
  } catch (error) { return { ok: false, receipt: null, error: error instanceof Error ? error.message.slice(0, 500) : "Customer Survey Delivery Failed" }; }
}

function requestId(projectId: string, trigger: Trigger, email: string) { return `SURVEY-${projectId}-${trigger.key}-${trigger.billingPeriod || trigger.sourceId}-${emailHash(email)}`.replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 160); }
function canonicalMilestone(value: string): keyof typeof CUSTOMER_SURVEY_PROGRAMS | "" { return ({ "contract-signed": "startup", "design-complete": "design", "project-halfway": "midpoint", "project-closeout": "completion", startup: "startup", design: "design", midpoint: "midpoint", completion: "completion", monthly: "monthly" } as Record<string, keyof typeof CUSTOMER_SURVEY_PROGRAMS>)[value] || ""; }
function emailHash(value: string) { let hash = 2166136261; for (const character of value.toLowerCase()) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16).padStart(8, "0"); }
function parse(value: string) { try { const result = JSON.parse(value || "{}"); return result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : {}; } catch { return {}; } }
function object(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown) { return String(value || "").trim(); }
function number(value: unknown) { const parsed = Number(value || 0); return Number.isFinite(parsed) ? parsed : 0; }
function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
function validEmail(value: string) { return /^\S+@\S+\.\S+$/.test(value); }
function isoDate(value: unknown) { const match = text(value).match(/^(\d{4})-(\d{2})-(\d{2})/); return match ? `${match[1]}-${match[2]}-${match[3]}` : ""; }
function reached(value: string, now: Date) { return Boolean(value && value <= now.toISOString().slice(0, 10)); }
function elapsedDays(value: string, now: Date) { const start = new Date(value).getTime(); return Number.isFinite(start) ? Math.floor((now.getTime() - start) / 86_400_000) : 0; }
function withinLookback(value: string, now: Date, days: number) { const elapsed = elapsedDays(`${isoDate(value)}T12:00:00Z`, now); return elapsed >= 0 && elapsed <= days; }
function addDays(value: string, days: number) { const parsed = new Date(`${isoDate(value)}T12:00:00Z`); if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10); parsed.setUTCDate(parsed.getUTCDate() + days); return parsed.toISOString().slice(0, 10); }
