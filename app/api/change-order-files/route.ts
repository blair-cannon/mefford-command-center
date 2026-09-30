import { and, eq } from "drizzle-orm";
import { commandRecords, projectFiles, recordAudits } from "../../../db/schema";
import { resolveCommandActor } from "../../../lib/server-actor";
import { enforceOnboardingAccess } from "../../../lib/onboarding";
import { canReadProjectId } from "../../../lib/project-access";
import { canReadFileScope } from "../../../lib/project-file-access";
import { CHANGE_FILE_CATEGORIES, changeFileRoot, fileBelongsToChange, type ChangeFileEntry, type ChangeFileDocument } from "../../../lib/change-order-file";

const parse = (value: string) => { try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; } };
const privateCategories = new Set(["Pricing", "Approvals", "Executed Documents"]);
const sourceTypes = new Set(["RFIs", "Submittals", "Selections"]);
type EntryRow = { id: string; record_id: string; kind: string; category: string; title: string; note: string; snapshot_json: string; request_json: string; actor_name: string; actor_email: string; created_at: string };

async function context(request: Request, projectId: string, recordId: string) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return { error: Response.json({ error: "Authentication Required" }, { status: 401 }) };
  const lock = await enforceOnboardingAccess(request);
  if (lock) return { error: lock };
  const { getDb } = await import("../../../db");
  const db = getDb();
  if (!projectId || !recordId || !(await canReadProjectId(db, actor, projectId))) return { error: Response.json({ error: "Assigned Project Access Is Required" }, { status: 403 }) };
  const rows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, "Change Orders")));
  const record = rows.find(row => row.id === recordId);
  if (!record) return { error: Response.json({ error: "Save The PCO Before Adding Supporting Information" }, { status: 404 }) };
  const rootId = changeFileRoot({ id: record.id, data: parse(record.dataJson) });
  const family = rows.filter(row => changeFileRoot({ id: row.id, data: parse(row.dataJson) }) === rootId);
  const office = await canReadFileScope(db, actor, { projectId, access: "Project Manager + Office" });
  const { env } = await import("cloudflare:workers");
  return { actor, db, env, record, family, rootId, office };
}

const publicFile = (file: typeof projectFiles.$inferSelect): ChangeFileDocument => ({ id: file.id, name: file.name, category: file.category, revision: file.revision, uploadedBy: file.uploadedBy, createdAt: file.createdAt, sizeBytes: file.sizeBytes, access: file.access });
function visibleSnapshot(snapshot: Record<string, unknown>, office: boolean) {
  if (office) return snapshot;
  const redacted = { ...snapshot };
  for (const key of ["before", "after"]) {
    const record = snapshot[key] as Record<string, unknown> | null;
    if (!record) continue;
    const data = (record.data || {}) as Record<string, unknown>;
    redacted[key] = { id: record.id, title: record.title, status: record.status, data: Object.fromEntries(["description", "reason", "requestedBy", "relatedReference", "scheduleDays", "newSubstantialDate", "newFinalDate"].map(name => [name, data[name]])) };
  }
  return redacted;
}

export async function GET(request: Request) {
  try {
    const search = new URL(request.url).searchParams;
    const projectId = search.get("projectId") || "", recordId = search.get("recordId") || "";
    const ctx = await context(request, projectId, recordId);
    if (ctx.error) return ctx.error;
    const { actor, db, env, rootId, family, office } = ctx;
    const [stored, allFiles, sources, audits] = await Promise.all([
      env.DB.prepare("SELECT * FROM change_order_evidence WHERE project_id = ? AND root_id = ? ORDER BY created_at, rowid").bind(projectId, rootId).all<EntryRow>(),
      db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId)),
      db.select().from(commandRecords).where(eq(commandRecords.projectId, projectId)),
      db.select().from(recordAudits).where(eq(recordAudits.projectId, projectId)),
    ]);
    const allowedFiles: typeof allFiles = [];
    for (const file of allFiles) if (await canReadFileScope(db, actor, file)) allowedFiles.push(file);
    const allowedIds = new Set(allowedFiles.map(file => file.id));
    const existingIds = new Set(allFiles.map(file => file.id));
    const entries: ChangeFileEntry[] = [];
    for (const row of stored.results) {
      if (!office && privateCategories.has(row.category)) continue;
      const snapshot = parse(row.snapshot_json);
      const files = Array.isArray(snapshot.files) ? snapshot.files as ChangeFileDocument[] : [];
      if (files.some(file => existingIds.has(file.id) && !allowedIds.has(file.id))) continue;
      if (files.length) snapshot.files = files.map(file => ({ ...file, available: existingIds.has(file.id) }));
      entries.push({ id: row.id, recordId: row.record_id, kind: row.kind, category: row.category, title: row.title, note: row.note, actorName: row.actor_name, actorEmail: row.actor_email, createdAt: row.created_at, snapshot: visibleSnapshot(snapshot, office) });
    }
    const recordedIds = new Set(entries.flatMap(entry => entry.snapshot.files?.map(file => file.id) || []));
    const familyIds = family.map(row => row.id);
    const executionIds = new Set(family.map(row => Number(parse(row.dataJson).executedFileId || 0)));
    for (const file of allowedFiles) {
      if (recordedIds.has(file.id) || !(fileBelongsToChange(file, rootId, familyIds) || executionIds.has(file.id))) continue;
      const category = executionIds.has(file.id) ? "Executed Documents" : CHANGE_FILE_CATEGORIES.find(value => file.category === `Change Orders / ${rootId} / ${value}`) || "Other";
      if (!office && privateCategories.has(category)) continue;
      entries.push({ id: `file-${file.id}`, recordId: rootId, kind: "File", category, title: file.name, note: "", actorName: file.uploadedBy, actorEmail: "", createdAt: file.createdAt, snapshot: { files: [publicFile(file)] } });
    }
    if (office) for (const audit of audits.filter(item => familyIds.includes(item.recordId))) entries.push({ id: `audit-${audit.id}`, recordId: audit.recordId, kind: "Audit", category: "History", title: audit.fieldName, note: audit.summary, actorName: audit.actorName, actorEmail: audit.actorEmail, createdAt: audit.createdAt, snapshot: { before: audit.oldValue, after: audit.newValue, reason: audit.reason } });
    const result = { rootId, records: family.map(row => ({ id: row.id, title: row.title, status: row.status })), entries, files: allowedFiles.map(publicFile), sources: sources.filter(row => sourceTypes.has(row.recordType)).map(row => ({ id: row.id, title: row.title, type: row.recordType, status: row.status })), canManage: true };
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Change file load failed", error);
    return Response.json({ error: "The Change File Could Not Be Loaded. Retry Without Leaving This Record." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const projectId = String(body.projectId || ""), recordId = String(body.recordId || "");
    const ctx = await context(request, projectId, recordId);
    if (ctx.error) return ctx.error;
    const { actor, db, env, rootId, office } = ctx;
    const category = String(body.category || "Other"), kind = String(body.kind || ""), id = String(body.id || "");
    if (!CHANGE_FILE_CATEGORIES.includes(category as typeof CHANGE_FILE_CATEGORIES[number]) || !["File", "Record", "Note"].includes(kind) || !/^[a-f0-9-]{36}$/i.test(id)) return Response.json({ error: "Select A Valid Filing Section And Item Type" }, { status: 400 });
    if (!office && privateCategories.has(category)) return Response.json({ error: "Office Access Is Required For This Filing Section" }, { status: 403 });
    const note = String(body.note || "").trim(), titleInput = String(body.title || "").trim();
    if (note.length > 20000 || titleInput.length > 300) return Response.json({ error: "Use A Title Up To 300 Characters And Notes Up To 20,000 Characters" }, { status: 400 });
    const requestJson = JSON.stringify({ kind, category, note, title: titleInput, fileId: Number(body.fileId || 0), sourceId: String(body.sourceId || ""), revision: String(body.revision || "") });
    const previous = await env.DB.prepare("SELECT * FROM change_order_evidence WHERE id = ?").bind(id).first<EntryRow & { project_id: string; root_id: string }>();
    if (previous) return previous.project_id === projectId && previous.root_id === rootId && previous.actor_email === actor.email && previous.request_json === requestJson
      ? Response.json({ saved: true, id, replayed: true }, { status: 201 }) : Response.json({ error: "This Filing Request Was Already Used. Reload The Change File." }, { status: 409 });
    const snapshot: Record<string, unknown> = {};
    let title = titleInput;
    if (kind === "File") {
      const file = (await db.select().from(projectFiles).where(and(eq(projectFiles.projectId, projectId), eq(projectFiles.id, Number(body.fileId || 0)))).limit(1))[0];
      if (!file || !(await canReadFileScope(db, actor, file))) return Response.json({ error: "Choose An Accessible File From This Project" }, { status: 403 });
      if (!(await env.BUCKET.head(file.storageKey))) return Response.json({ error: "The Original File Is Missing. Upload It Again Before Filing." }, { status: 409 });
      snapshot.files = [publicFile(file)];
      snapshot.revision = String(body.revision || file.revision);
      title ||= file.name;
    } else if (kind === "Record") {
      const source = (await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, String(body.sourceId || "")))).limit(1))[0];
      if (!source || !sourceTypes.has(source.recordType)) return Response.json({ error: "Choose An RFI, Submittal, Or Selection From This Project" }, { status: 400 });
      snapshot.source = { id: source.id, type: source.recordType, title: source.title, status: source.status, owner: source.owner, due: source.due, data: parse(source.dataJson), updatedAt: source.updatedAt };
      const candidates = await db.select().from(projectFiles).where(and(eq(projectFiles.projectId, projectId), eq(projectFiles.category, source.recordType)));
      const files = [];
      for (const file of candidates) if ((file.revision === `${source.id} Supporting File` || file.revision.startsWith(`${source.id} · `)) && await canReadFileScope(db, actor, file)) files.push(publicFile(file));
      snapshot.files = files;
      title ||= `${source.id} · ${source.title}`;
    } else if (!title || !note) return Response.json({ error: "Add A Request Title And Its Details" }, { status: 400 });
    // Evidence is append-only; duplicate names and updated source records never
    // overwrite earlier evidence or revisions.
    await env.DB.prepare(`INSERT INTO change_order_evidence (id, project_id, root_id, record_id, kind, category, title, note, snapshot_json, request_json, actor_name, actor_email, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, projectId, rootId, recordId, kind, category, title, note, JSON.stringify(snapshot), requestJson, actor.name, actor.email, new Date().toISOString()).run();
    return Response.json({ saved: true, id }, { status: 201 });
  } catch (error) {
    console.error("Change file save failed", error);
    return Response.json({ error: "The Item Could Not Be Filed. Your Input Has Been Kept; Retry Saving." }, { status: 503 });
  }
}
