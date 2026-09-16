import { and, desc, eq } from "drizzle-orm";
import { commandRecords, projectFiles, recordAudits } from "../../../db/schema";
import { canReadFileScope } from "../../../lib/project-file-access";
import { extractDrawingMetadata, extractDrawingSheets } from "../../../lib/drawing-intelligence";
import { enforceOnboardingAccess } from "../../../lib/onboarding";
import { getCommandActor, resolveCommandActor } from "../../../lib/server-actor";
import { recordCompletedWorkflowHandoff } from "../../../lib/domain-outbox";

const RECORD_TYPE = "Drawing Intelligence";
const MAX_OCR_TEXT = 500_000;

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  const projectId = new URL(request.url).searchParams.get("projectId")?.trim() || "";
  if (!projectId) return Response.json({ error: "projectId Is Required" }, { status: 400 });
  const { getDb } = await import("../../../db");
  const db = getDb();
  if (!(await canAccessProject(db, actor, projectId))) return Response.json({ error: "Project Drawing Access Is Required" }, { status: 403 });
  const rows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, RECORD_TYPE))).orderBy(desc(commandRecords.updatedAt));
  return Response.json({ drawings: rows.map((row) => ({ id: row.id, title: row.title, status: row.status, updatedAt: row.updatedAt, data: parse(row.dataJson) })) });
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  const input = await request.json() as { projectId?: string; fileId?: number; fileName?: string; category?: string; suppliedRevision?: string; ocrText?: string; ocrStatus?: string; sheets?: unknown };
  const projectId = input.projectId?.trim() || "";
  const fileId = Number(input.fileId || 0);
  if (!projectId || !Number.isInteger(fileId) || fileId <= 0) return Response.json({ error: "A Stored Project Drawing Is Required" }, { status: 400 });
  const { getDb } = await import("../../../db");
  const db = getDb();
  if (!(await canAccessProject(db, actor, projectId))) return Response.json({ error: "Project Drawing Access Is Required" }, { status: 403 });
  const files = await db.select().from(projectFiles).where(eq(projectFiles.id, fileId)).limit(1);
  const file = files[0];
  if (!file || file.projectId !== projectId) return Response.json({ error: "The Drawing File Was Not Found In This Project" }, { status: 404 });
  if (!/drawing|floor.?plan|rendering|design/i.test(file.category) || !(await canReadFileScope(db, actor, file))) return Response.json({ error: "Select An Authorized Drawing Or Design Source File" }, { status: 403 });
  const ocrText = String(input.ocrText || "").slice(0, MAX_OCR_TEXT);
  const suppliedRevision = String(input.suppliedRevision || file.revision || "");
  const sheets = Array.isArray(input.sheets) ? input.sheets : extractDrawingSheets(ocrText, file.name, suppliedRevision);
  const metadata = extractDrawingMetadata(ocrText, file.name, suppliedRevision);
  const now = new Date().toISOString();
  const recordId = `DRAWING-OCR-${file.id}`;
  const prior = await db.select({ status: commandRecords.status }).from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, recordId))).limit(1);
  const status = sheets.some((sheet) => sheet && typeof sheet === "object" && (sheet as { needsReview?: boolean }).needsReview) ? "Human Review Required" : "Indexed";
  const data = {
    fileId: file.id,
    fileName: file.name,
    fileCategory: file.category,
    fileRevision: file.revision,
    ocrStatus: String(input.ocrStatus || "OCR Complete - Human Review Available"),
    ocrText,
    sheets,
    metadata,
    indexedAt: now,
    indexedBy: actor.name,
    searchable: true,
    sourceFileIsAuthoritative: true,
  };
  await db.insert(commandRecords).values({
    projectId, id: recordId, recordType: RECORD_TYPE, title: `${metadata.sheetNumber || "Drawing Set"} · ${file.name}`,
    owner: actor.name, due: now.slice(0, 10), status,
    meta: `${sheets.length} Sheet${sheets.length === 1 ? "" : "s"} · ${metadata.discipline} · ${metadata.confidence}% Confidence`,
    recordDate: now.slice(0, 10), recordTime: now.slice(11, 16), dateLocked: true,
    dataJson: JSON.stringify(data), updatedAt: now,
  }).onConflictDoUpdate({ target: [commandRecords.projectId, commandRecords.id], set: { title: `${metadata.sheetNumber || "Drawing Set"} · ${file.name}`, owner: actor.name, status, meta: `${sheets.length} Sheet${sheets.length === 1 ? "" : "s"} · ${metadata.discipline} · ${metadata.confidence}% Confidence`, dataJson: JSON.stringify(data), updatedAt: now } });
  await db.insert(recordAudits).values({
    projectId, recordId, fieldName: prior.length ? "Drawing OCR Re-Index" : "Drawing OCR Index", oldValue: prior[0]?.status || "Not Indexed", newValue: status,
    reason: "Every drawing upload is indexed for sheet number revision date discipline and full-text search",
    actorName: actor.name, actorEmail: actor.email,
    summary: `${file.name} indexed with ${sheets.length} detected sheet page(s). OCR suggestions require human verification against the source drawing.`,
  });
  let handoff = null;
  if (status === "Indexed") {
    const { env } = await import("cloudflare:workers");
    handoff = await recordCompletedWorkflowHandoff(env.DB, { workflowId: "drawing-intelligence", eventId: `drawing-intelligence-indexed:${projectId}:${recordId}:${file.revision}`, aggregateType: RECORD_TYPE, aggregateId: recordId, projectId, actorName: actor.name, actorEmail: actor.email, occurredAt: now, payload: { fileId: file.id, recordId, sheetCount: sheets.length, confidence: metadata.confidence, status } });
  }
  return Response.json({ indexed: true, recordId, status, metadata, sheets, handoff }, { status: prior.length ? 200 : 201 });
}

async function canAccessProject(db: Awaited<ReturnType<(typeof import("../../../db"))["getDb"]>>, actor: ReturnType<typeof getCommandActor>, projectId: string) {
  return Boolean(projectId) && canReadFileScope(db, actor, { projectId, category: "Drawings" });
}

function parse(value: string) { try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; } }
