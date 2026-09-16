import { enforceOnboardingAccess } from "../../../../lib/onboarding";
import { auditMeeting, canAccessMeeting, canEditMeeting, ensureMeetingTables, getMeetingContext, type MeetingActor } from "../../../../lib/meeting-server";
import { effectiveActor, ensureMyWorkTables } from "../../../../lib/my-work";
import { resolveCommandActor } from "../../../../lib/server-actor";
import { photoUploadContentType, storedFileResponseHeaders } from "../../../../lib/photo-uploads";

async function actorFor(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return null;
  await ensureMyWorkTables();
  return effectiveActor(actor) as Promise<MeetingActor>;
}

export async function GET(request: Request) {
  const actor = await actorFor(request);
  if (!actor) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  await ensureMeetingTables();
  const { env } = await import("cloudflare:workers");
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return Response.json({ error: "Meeting File Is Required" }, { status: 400 });
  const file = await env.DB.prepare(`SELECT f.*, o.series_id, s.leader_email FROM meeting_attachments f JOIN meeting_occurrences o ON o.id = f.occurrence_id JOIN meeting_series s ON s.id = o.series_id WHERE f.id = ?`).bind(id).first<Record<string, string | number | null>>();
  if (!file) return Response.json({ error: "Meeting File Not Found" }, { status: 404 });
  const context = await getMeetingContext(String(file.occurrence_id));
  if (!context || !await canAccessMeeting(actor, context, String(file.occurrence_id))) return Response.json({ error: "Meeting File Access Denied" }, { status: 403 });
  const object = await env.BUCKET.get(String(file.storage_key));
  if (!object) return Response.json({ error: "Stored Meeting File Not Found" }, { status: 404 });
  return new Response(object.body, { headers: storedFileResponseHeaders({ name: String(file.name), contentType: String(file.content_type), sizeBytes: Number(file.size_bytes) }) });
}

export async function POST(request: Request) {
  const actor = await actorFor(request);
  if (!actor) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  await ensureMeetingTables();
  const form = await request.formData();
  const occurrenceId = String(form.get("occurrenceId") || "");
  const file = form.get("file");
  if (!occurrenceId || !(file instanceof File) || !file.size) return Response.json({ error: "Meeting And File Are Required" }, { status: 400 });
  if (file.size > 50 * 1024 * 1024) return Response.json({ error: "Meeting Files Must Be 50 MB Or Less" }, { status: 413 });
  const context = await getMeetingContext(occurrenceId);
  if (!context) return Response.json({ error: "Meeting Not Found" }, { status: 404 });
  if (String(context.status) === "Finalized/Distributed") return Response.json({ error: "Finalized Meeting Attachments Are Locked. Create A Numbered Minutes Revision For Corrections." }, { status: 409 });
  const { env } = await import("cloudflare:workers");
  if (!await canAccessMeeting(actor, context, occurrenceId)) return Response.json({ error: "Meeting File Upload Access Denied" }, { status: 403 });
  const id = crypto.randomUUID();
  const storageKey = `meetings/${context.project_id}/${occurrenceId}/${id}-${file.name.replace(/[^A-Za-z0-9._-]+/g, "-")}`;
  const contentType = photoUploadContentType(file);
  await env.BUCKET.put(storageKey, file.stream(), { httpMetadata: { contentType }, customMetadata: { occurrenceId, uploadedBy: actor.email } });
  await env.DB.prepare(`INSERT INTO meeting_attachments (id, occurrence_id, name, category, storage_key, content_type, size_bytes, source_type, source_version, access, include_with_minutes, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, 'Command Center Upload', 'Uploaded Version', ?, ?, ?)`).bind(
    id, occurrenceId, file.name, String(form.get("category") || "Meeting File"), storageKey, contentType, file.size, String(form.get("access") || "Attendees"), form.get("includeWithMinutes") === "true" ? 1 : 0, actor.name,
  ).run();
  await auditMeeting({ actor, seriesId: String(context.series_id), occurrenceId, entityType: "Attachment", entityId: id, action: "Uploaded", after: { name: file.name, size: file.size, includeWithMinutes: form.get("includeWithMinutes") === "true" } });
  return Response.json({ saved: true, id });
}

export async function PATCH(request: Request) {
  const actor = await actorFor(request);
  if (!actor) return Response.json({ error: "Authentication Required" }, { status: 401 });
  await ensureMeetingTables();
  const payload = await request.json() as { id?: string; includeWithMinutes?: boolean; access?: string };
  if (!payload.id) return Response.json({ error: "Meeting File Is Required" }, { status: 400 });
  const { env } = await import("cloudflare:workers");
  const row = await env.DB.prepare(`SELECT f.*, o.series_id, o.status AS occurrence_status, s.leader_email FROM meeting_attachments f JOIN meeting_occurrences o ON o.id = f.occurrence_id JOIN meeting_series s ON s.id = o.series_id WHERE f.id = ?`).bind(payload.id).first<Record<string, string | number | null>>();
  const context = row ? await getMeetingContext(String(row.occurrence_id)) : null;
  if (!row || !context || !canEditMeeting(actor, context)) return Response.json({ error: "Meeting Leader Permission Required" }, { status: 403 });
  if (String(row.occurrence_status) === "Finalized/Distributed") return Response.json({ error: "Finalized Meeting Attachment Metadata Is Locked" }, { status: 409 });
  await env.DB.prepare(`UPDATE meeting_attachments SET include_with_minutes = COALESCE(?, include_with_minutes), access = COALESCE(?, access) WHERE id = ?`).bind(typeof payload.includeWithMinutes === "boolean" ? (payload.includeWithMinutes ? 1 : 0) : null, payload.access || null, payload.id).run();
  await auditMeeting({ actor, seriesId: String(row.series_id), occurrenceId: String(row.occurrence_id), entityType: "Attachment", entityId: payload.id, action: "Distribution Metadata Updated", before: row, after: payload });
  return Response.json({ saved: true });
}
