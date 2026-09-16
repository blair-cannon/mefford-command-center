import { and, desc, eq } from "drizzle-orm";
import { commandRecords, companyMembers, projectFiles, projects } from "../../../db/schema";
import { analyzeConstructionSchedule, type ConstructionScheduleTask } from "../../../lib/construction-schedule";
import { enforceOnboardingAccess } from "../../../lib/onboarding";
import { SCHEDULE_QUALITY_CATEGORIES, scheduleQualityCategory } from "../../../lib/quality-control";
import { getCommandActor, resolveCommandActor } from "../../../lib/server-actor";

const DEFAULT_MODEL = "gpt-5.4-mini";

type DraftTask = {
  name: string;
  trade: string;
  start: string;
  days: number;
  dependency: string;
  qualityCategoryId: string;
  drawingReferences: string[];
};

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  const projectId = new URL(request.url).searchParams.get("projectId")?.trim() || "";
  const { db, project, allowed } = await context(actor, projectId);
  if (!project) return Response.json({ error: "Project Not Found" }, { status: 404 });
  if (!allowed) return Response.json({ error: "Project Schedule Access Is Required" }, { status: 403 });
  const rows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, "Schedule"))).orderBy(desc(commandRecords.updatedAt));
  const tasks = rows.map((row) => scheduleTask(row));
  return Response.json({ analysis: analyzeConstructionSchedule(tasks), tasks, aiConfigured: Boolean(await openAiKey()) });
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  const input = await request.json() as { action?: string; projectId?: string; instructions?: string };
  if (input.action !== "draft-from-drawings") return Response.json({ error: "A Valid Schedule Intelligence Action Is Required" }, { status: 400 });
  const projectId = input.projectId?.trim() || "";
  const { db, project, allowed, designations, accessLevel } = await context(actor, projectId);
  if (!project) return Response.json({ error: "Project Not Found" }, { status: 404 });
  if (!allowed || (!["Company Owner", "Administrator"].includes(accessLevel) && !designations.some((item) => ["Project Manager", "Estimator"].includes(item)) && project.projectManager !== actor.name)) {
    return Response.json({ error: "The Assigned Project Manager Estimator Administrator Or Company Owner Must Request An AI Schedule Draft" }, { status: 403 });
  }
  const key = await openAiKey();
  if (!key) return Response.json({ error: "OpenAI Is Not Connected. Add The Production OpenAI API Key In IT & Integrations Before Requesting A Drawing-Based Schedule Draft.", connectionRequired: true }, { status: 503 });
  const [scheduleRows, drawingRows, files] = await Promise.all([
    db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, "Schedule"))).orderBy(desc(commandRecords.updatedAt)),
    db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, "Drawing Intelligence"))).orderBy(desc(commandRecords.updatedAt)),
    db.select({ id: projectFiles.id, name: projectFiles.name, category: projectFiles.category, revision: projectFiles.revision }).from(projectFiles).where(eq(projectFiles.projectId, projectId)),
  ]);
  if (!drawingRows.length && !files.some((file) => /drawing|design|plan/i.test(file.category))) {
    return Response.json({ error: "Upload And Index At Least One Project Drawing Before Requesting A Schedule Draft." }, { status: 409 });
  }
  const drawingContext = drawingRows.map((row) => {
    const data = parse(row.dataJson);
    return {
      fileName: String(data.fileName || row.title),
      revision: String(data.fileRevision || ""),
      sheets: Array.isArray(data.sheets) ? data.sheets : [],
      ocrText: String(data.ocrText || "").slice(0, 35_000),
    };
  });
  const existingTasks = scheduleRows.map(scheduleTask);
  const categories = SCHEDULE_QUALITY_CATEGORIES.map((category) => ({ id: category.id, label: category.label, preWorkChecklist: Boolean(category.templateId) }));
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: await openAiModel(),
      store: false,
      input: [
        { role: "system", content: [{ type: "input_text", text: "You are a senior commercial construction scheduler. Produce a conservative review draft, not an approved schedule. Ground every activity in the supplied drawing index or clearly label it as an assumption. Use logical finish-to-start dependencies. Include procurement, submittal, inspection, commissioning, and closeout activities when supported. Never invent an executed contract term." }] },
        { role: "user", content: [{ type: "input_text", text: JSON.stringify({ project: { number: project.number, name: project.name, site: project.site, startDate: project.startDate, substantialDate: project.substantialDate, finalDate: project.finalDate }, instructions: String(input.instructions || "Build the most complete defensible schedule draft supported by the drawings."), qualityCategories: categories, existingSchedule: existingTasks, drawingIndex: drawingContext, unindexedDrawingFiles: files.filter((file) => /drawing|design|plan/i.test(file.category) && !drawingRows.some((row) => Number(parse(row.dataJson).fileId || 0) === file.id)) }) }] },
      ],
      text: { format: { type: "json_schema", name: "construction_schedule_draft", strict: true, schema: {
        type: "object", additionalProperties: false,
        properties: {
          rationale: { type: "string" },
          assumptions: { type: "array", items: { type: "string" } },
          risks: { type: "array", items: { type: "string" } },
          tasks: { type: "array", items: { type: "object", additionalProperties: false, properties: {
            name: { type: "string" }, trade: { type: "string" }, start: { type: "string" }, days: { type: "integer" }, dependency: { type: "string" }, qualityCategoryId: { type: "string", enum: categories.map((category) => category.id) }, drawingReferences: { type: "array", items: { type: "string" } },
          }, required: ["name", "trade", "start", "days", "dependency", "qualityCategoryId", "drawingReferences"] } },
        }, required: ["rationale", "assumptions", "risks", "tasks"],
      } } },
    }),
  });
  const raw = await response.json() as Record<string, unknown>;
  if (!response.ok) return Response.json({ error: openAiError(raw) }, { status: 502 });
  const output = extractText(raw);
  let parsed: { rationale?: string; assumptions?: string[]; risks?: string[]; tasks?: DraftTask[] };
  try { parsed = JSON.parse(output); } catch { return Response.json({ error: "OpenAI Returned A Schedule Draft That Could Not Be Validated. No Schedule Records Were Changed." }, { status: 502 }); }
  const usedNames = new Set<string>();
  const tasks = (parsed.tasks || []).slice(0, 250).flatMap((task): DraftTask[] => {
    const name = String(task.name || "").trim();
    if (!name || usedNames.has(name.toLowerCase())) return [];
    usedNames.add(name.toLowerCase());
    return [{
      name,
      trade: String(task.trade || "Mefford Crew").trim() || "Mefford Crew",
      start: /^\d{4}-\d{2}-\d{2}$/.test(String(task.start || "")) ? String(task.start) : project.startDate,
      days: Math.max(1, Math.min(365, Math.round(Number(task.days) || 1))),
      dependency: String(task.dependency || "None").trim() || "None",
      qualityCategoryId: scheduleQualityCategory(String(task.qualityCategoryId || ""))?.id || "general-administrative",
      drawingReferences: Array.isArray(task.drawingReferences) ? task.drawingReferences.map(String).filter(Boolean).slice(0, 20) : [],
    }];
  });
  if (!tasks.length) return Response.json({ error: "The Drawings Did Not Produce A Valid Schedule Draft. No Schedule Records Were Changed." }, { status: 422 });
  const analysis = analyzeConstructionSchedule(tasks.map((task, index) => ({ id: index + 1, ...task, progress: 0 })));
  return Response.json({
    draftId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    createdBy: actor.name,
    model: await openAiModel(),
    rationale: String(parsed.rationale || "Drawing-grounded schedule draft"),
    assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions.map(String) : [],
    risks: Array.isArray(parsed.risks) ? parsed.risks.map(String) : [],
    tasks,
    analysis,
    requiresHumanReview: true,
    writesApplied: false,
    notice: "AI Created A Review Draft Only. A Project Manager Must Review Every Activity Date Trade Dependency Quality Category And Drawing Reference Before Applying It.",
  });
}

async function context(actor: ReturnType<typeof getCommandActor>, projectId: string) {
  const { getDb } = await import("../../../db");
  const db = getDb();
  const projectRows = await db.select().from(projects).where(eq(projects.number, projectId)).limit(1);
  const member = actor.email ? await db.select().from(companyMembers).where(eq(companyMembers.email, actor.email)).limit(1) : [];
  const accessLevel = member[0]?.companyAccessLevel || actor.accessLevel;
  const designations = parseList(member[0]?.designationsJson || "[]");
  const project = projectRows[0];
  const leadership = ["Company Owner", "Administrator"].includes(accessLevel);
  const broad = designations.some((item) => ["Estimator", "Accountant", "Office Staff"].includes(item));
  const assigned = project && [project.projectManager, project.superintendent].includes(actor.name);
  return { db, project, accessLevel, designations, allowed: Boolean(project && (leadership || broad || assigned)) };
}

function scheduleTask(row: typeof commandRecords.$inferSelect): ConstructionScheduleTask {
  const data = parse(row.dataJson);
  return { id: row.id, name: row.title, trade: String(data.trade || row.owner), start: String(data.start || row.recordDate || ""), days: Number(data.days || 1), progress: Number(data.progress || 0), dependency: String(data.dependency || "None"), qualityCategoryId: String(data.qualityCategoryId || "general-administrative") };
}
function parse(value: string) { try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; } }
function parseList(value: string) { try { const parsed = JSON.parse(value) as unknown; return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; } }
async function openAiKey() { const { env } = await import("cloudflare:workers"); return String((env as unknown as Record<string, unknown>).OPENAI_API_KEY || "").trim(); }
async function openAiModel() { const { env } = await import("cloudflare:workers"); const binding = env as unknown as Record<string, unknown>; return String(binding.OPENAI_MODEL || binding.OPENAI_ASSISTANT_MODEL || "").trim() || DEFAULT_MODEL; }
function extractText(value: Record<string, unknown>) { if (typeof value.output_text === "string") return value.output_text; return (Array.isArray(value.output) ? value.output : []).flatMap((item) => item && typeof item === "object" && Array.isArray((item as { content?: unknown }).content) ? (item as { content: Array<Record<string, unknown>> }).content : []).map((item) => typeof item.text === "string" ? item.text : "").filter(Boolean).join("\n"); }
function openAiError(value: Record<string, unknown>) { const error = value.error && typeof value.error === "object" ? value.error as Record<string, unknown> : {}; return String(error.message || "OpenAI Could Not Create The Schedule Draft. No Schedule Records Were Changed."); }
