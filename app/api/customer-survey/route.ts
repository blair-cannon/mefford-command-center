import { and, eq } from "drizzle-orm";
import { commandRecords, projectFiles } from "../../../db/schema";
import { domainEventStatements, reconcileDomainEvent } from "../../../lib/domain-outbox";
import { isPhotoUpload, photoUploadContentType } from "../../../lib/photo-uploads";
import { CUSTOMER_SURVEY_PROGRAMS, SALES_PROJECT_ID, type SurveyQuestion } from "../../../lib/customer-voice";

const REQUEST_TYPE = "Marketing Customer Survey Request";
const RESPONSE_TYPE = "Marketing Customer Survey Response";
const PHOTO_CATEGORY = "Customer Survey Photo";
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const MAX_PHOTOS = 8;

type SurveyInput = {
  token?: string;
  respondentName?: string;
  respondentEmail?: string;
  comments?: string;
  displayConsent?: boolean;
  ratings?: Record<string, number>;
  photoIds?: number[];
};

export async function GET(request: Request) {
  const token = safe(new URL(request.url).searchParams.get("token"), 120);
  if (!token) return Response.json({ error: "A Secure Survey Token Is Required" }, { status: 400 });
  const { row, data } = await surveyRequest(token);
  if (!row) return Response.json({ error: "This Survey Link Is Invalid Or No Longer Available" }, { status: 404 });
  return Response.json({
    completed: Boolean(data.responseId) || row.status === "Responded",
    survey: {
      projectName: safe(data.projectName, 180), milestone: safe(data.milestone, 100), milestoneDescription: safe(data.milestoneDescription, 500),
      recipientName: safe(data.recipientName || data.ownerName, 120), recipientEmail: safe(data.recipientEmail || data.ownerEmail, 180),
      responseDue: safe(data.responseDue, 20), questions: questions(data), uploadedPhotos: photoList(data),
    },
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PUT(request: Request) {
  try {
    const form = await request.formData();
    const token = safe(form.get("token"), 120);
    const file = form.get("file");
    if (!token) return Response.json({ error: "A Secure Survey Token Is Required" }, { status: 400 });
    if (!(file instanceof File) || !file.size || file.size > MAX_PHOTO_BYTES || !isPhotoUpload(file)) return Response.json({ error: "Choose A Project Photo Up To 15 MB, Including HEIC Or HEIF" }, { status: 400 });
    const { db, row, data } = await surveyRequest(token);
    if (!row) return Response.json({ error: "This Survey Link Is Invalid Or No Longer Available" }, { status: 404 });
    if (data.responseId || row.status === "Responded") return Response.json({ error: "This Survey Was Already Completed" }, { status: 409 });
    const current = photoList(data);
    if (current.length >= MAX_PHOTOS) return Response.json({ error: `A Maximum Of ${MAX_PHOTOS} Photos May Be Added` }, { status: 409 });
    const contentType = photoUploadContentType(file);
    const safeName = file.name.replace(/[^a-zA-Z0-9._ -]+/g, "-");
    const storageKey = `${SALES_PROJECT_ID}/customer-surveys/${row.id}/${crypto.randomUUID()}-${safeName}`;
    const { env } = await import("cloudflare:workers");
    await env.BUCKET.put(storageKey, file.stream(), { httpMetadata: { contentType }, customMetadata: { purpose: PHOTO_CATEGORY, surveyRequestId: row.id } });
    const [saved] = await db.insert(projectFiles).values({ projectId: SALES_PROJECT_ID, name: file.name, category: PHOTO_CATEGORY, revision: row.id, storageKey, contentType, sizeBytes: file.size, uploadedBy: safe(data.recipientName || data.ownerName, 120) || "Customer", access: "Consent-Gated Customer Review Display And Authorized Mefford Staff" }).returning();
    const uploadedPhotos = [...current, { id: saved.id, name: saved.name }];
    const now = new Date().toISOString();
    await db.update(commandRecords).set({ dataJson: JSON.stringify({ ...data, uploadedPhotos, updatedAt: now }), updatedAt: now }).where(and(eq(commandRecords.projectId, SALES_PROJECT_ID), eq(commandRecords.id, row.id)));
    return Response.json({ uploaded: true, photo: { id: saved.id, name: saved.name }, count: uploadedPhotos.length }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The Photo Could Not Be Uploaded" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const input = await request.json() as SurveyInput;
    const token = safe(input.token, 120);
    if (!token) return Response.json({ error: "A Secure Survey Token Is Required" }, { status: 400 });
    const { row, data } = await surveyRequest(token);
    if (!row) return Response.json({ error: "This Survey Link Is Invalid Or No Longer Available" }, { status: 404 });
    if (data.responseId || row.status === "Responded") return Response.json({ error: "This Survey Was Already Completed", completed: true }, { status: 409 });
    const respondentName = safe(input.respondentName, 120);
    const respondentEmail = safe(input.respondentEmail, 180).toLowerCase();
    if (!respondentName) return Response.json({ error: "Your Name Is Required" }, { status: 400 });
    if (respondentEmail && !/^\S+@\S+\.\S+$/.test(respondentEmail)) return Response.json({ error: "Enter A Valid Email Address" }, { status: 400 });
    const surveyQuestions = questions(data);
    const ratings = Object.fromEntries(surveyQuestions.map((question) => [question.key, Number(input.ratings?.[question.key] || 0)]));
    if (surveyQuestions.some((question) => !Number.isInteger(ratings[question.key]) || ratings[question.key] < 1 || ratings[question.key] > 5)) return Response.json({ error: "Please Give Every Question A 1 To 5 Star Rating" }, { status: 400 });
    const uploaded = photoList(data);
    const requestedPhotoIds = Array.isArray(input.photoIds) ? input.photoIds.map(Number).filter(Number.isInteger) : uploaded.map((photo) => photo.id);
    const photoIds = uploaded.filter((photo) => requestedPhotoIds.includes(photo.id)).map((photo) => photo.id);
    const overallRating = surveyQuestions.length ? surveyQuestions.reduce((sum, question) => sum + ratings[question.key], 0) / surveyQuestions.length : 0;
    const now = new Date().toISOString();
    const responseId = `SURVEY-RESPONSE-${crypto.randomUUID()}`;
    const projectId = safe(data.projectId, 80);
    const milestone = safe(data.milestone, 100);
    const displayConsent = input.displayConsent === true;
    const responseData = {
      requestId: row.id, projectId, projectName: safe(data.projectName, 180), projectType: safe(data.projectType, 80), milestone, milestoneKey: safe(data.milestoneKey, 80),
      respondentName, respondentEmail, responseDate: now.slice(0, 10), questions: surveyQuestions, ratings, overallRating: Number(overallRating.toFixed(2)),
      comments: safe(input.comments, 4_000), displayConsent, marketingConsent: displayConsent, photoIds,
      projectManager: safe(data.projectManager, 120), superintendent: safe(data.superintendent, 120), teamEmails: Array.isArray(data.teamEmails) ? data.teamEmails.map((item) => safe(item, 180)).filter(Boolean) : [],
      responseSource: "Secure Customer Survey Link", customerSubmittedAt: now,
    };
    const { env } = await import("cloudflare:workers");
    const eventId = `customer-survey-responded:${row.id}:${responseId}`;
    const eventStatements = domainEventStatements(env.DB, {
      id: eventId, idempotencyKey: `customer-survey-responded:${row.id}`, eventType: "customer-survey.responded", aggregateType: REQUEST_TYPE, aggregateId: row.id, projectId,
      actorName: respondentName, actorEmail: respondentEmail || "customer-survey@meffcon.com", occurredAt: now,
      payload: { requestId: row.id, responseId, projectId, milestone, overallRating, displayConsent, photoCount: photoIds.length },
      consumers: [
        { key: "survey-response-register", completedInSourceTransaction: true, result: { responseId, status: "Verified Customer Response" } },
        { key: "project-feedback-summary", completedInSourceTransaction: true, result: { projectId, milestone, overallRating } },
        { key: "review-display-consent-gate", completedInSourceTransaction: true, result: { displayConsent, commentPresent: Boolean(responseData.comments), photoCount: photoIds.length } },
      ],
    });
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO command_records (project_id, id, record_type, title, owner, due, status, meta, record_date, record_time, date_locked, data_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'Verified Customer Response', ?, ?, ?, 1, ?, ?)`).bind(SALES_PROJECT_ID, responseId, RESPONSE_TYPE, `${safe(data.projectName, 120) || projectId} · ${milestone} Customer Response`, respondentName, now.slice(0, 10), `${projectId} · ${milestone} · ${overallRating.toFixed(1)}/5`, now.slice(0, 10), now.slice(11, 16), JSON.stringify(responseData), now),
      env.DB.prepare(`UPDATE command_records SET status = 'Responded', meta = ?, data_json = ?, updated_at = ? WHERE project_id = ? AND id = ? AND status <> 'Responded'`).bind(`${row.meta} · Customer Response Recorded`, JSON.stringify({ ...data, responseId, respondedAt: now, responseSource: "Secure Customer Survey Link" }), now, SALES_PROJECT_ID, row.id),
      env.DB.prepare(`INSERT INTO record_audits (project_id, record_id, field_name, old_value, new_value, reason, actor_name, actor_email, summary, created_at) VALUES (?, ?, 'Customer Survey Response', ?, 'Responded', 'Customer completed the single-use secure survey', ?, ?, ?, ?)`).bind(SALES_PROJECT_ID, row.id, row.status, respondentName, respondentEmail || "customer-survey@meffcon.com", `${responseId} linked to ${row.id}; display consent ${displayConsent ? "granted" : "not granted"}; ${photoIds.length} photo(s)`, now),
      ...eventStatements,
    ]);
    const handoff = await reconcileDomainEvent(env.DB, eventId);
    return Response.json({ saved: true, completed: true, message: "Thank you. Your feedback was securely recorded.", handoff: { eventId, status: handoff?.status || "Partially Applied", consumers: handoff?.consumers || [] } }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Your Survey Could Not Be Saved" }, { status: 500 });
  }
}

async function surveyRequest(token: string) {
  const { getDb } = await import("../../../db"); const db = getDb();
  const rows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, SALES_PROJECT_ID), eq(commandRecords.recordType, REQUEST_TYPE)));
  const row = rows.find((item) => safe(parse(item.dataJson).token, 120) === token);
  return { db, row, data: parse(row?.dataJson || "{}") };
}

function questions(data: Record<string, unknown>): SurveyQuestion[] {
  const items = Array.isArray(data.questions) ? data.questions : [];
  const stored = items.map((item) => item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {}).map((item) => ({ key: safe(item.key, 80), label: safe(item.label, 300) })).filter((item) => item.key && item.label).slice(0, 5);
  if (stored.length) return stored;
  const legacyKey = ({ "contract-signed": "startup", "design-complete": "design", "project-halfway": "midpoint", "project-closeout": "completion" } as Record<string, keyof typeof CUSTOMER_SURVEY_PROGRAMS>)[safe(data.milestoneKey, 80)] || "completion";
  return CUSTOMER_SURVEY_PROGRAMS[legacyKey].questions.map(([key, label]) => ({ key, label }));
}
function photoList(data: Record<string, unknown>) { const items = Array.isArray(data.uploadedPhotos) ? data.uploadedPhotos : []; return items.map((item) => item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {}).map((item) => ({ id: Number(item.id || 0), name: safe(item.name, 200) })).filter((item) => Number.isInteger(item.id) && item.id > 0); }
function parse(value: string) { try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; } }
function safe(value: unknown, max: number) { return String(value || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max); }
