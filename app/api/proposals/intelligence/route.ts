import { and, desc, eq, inArray } from "drizzle-orm";
import { commandRecords, companyMembers, projectFiles } from "../../../../db/schema";
import { enforceOnboardingAccess } from "../../../../lib/onboarding";
import { alignScheduleMilestonesToDuration, MEFFORD_CORE_VALUES, normalizeProposalData } from "../../../../lib/proposals";
import { resolveCommandActor } from "../../../../lib/server-actor";

const DEFAULT_MODEL = "gpt-5.4-mini";

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  const input = await request.json() as { action?: string; opportunityId?: string; instructions?: string; data?: unknown };
  if (!['project-read', 'proposal-schedule'].includes(String(input.action || ""))) return Response.json({ error: "A Valid Proposal Intelligence Action Is Required" }, { status: 400 });
  const opportunityId = String(input.opportunityId || "").trim();
  if (!opportunityId) return Response.json({ error: "Opportunity Is Required" }, { status: 400 });
  const { getDb } = await import("../../../../db");
  const db = getDb();
  const member = actor.email ? await db.select().from(companyMembers).where(eq(companyMembers.email, actor.email)).limit(1) : [];
  const access = member[0]?.companyAccessLevel || actor.accessLevel;
  const designations = parseList(member[0]?.designationsJson || "[]");
  if (!["Company Owner", "Administrator"].includes(access) && !designations.some((item) => ["Estimator", "Salesperson"].includes(item))) return Response.json({ error: "Sales Or Estimating Access Is Required" }, { status: 403 });
  const key = await openAiKey();
  if (!key) return Response.json({ error: "OpenAI Is Not Connected", connectionRequired: true }, { status: 503 });

  const projectIds = [`ESTIMATE-${opportunityId}`, `DESIGN-${opportunityId}`];
  const [opportunities, records, files] = await Promise.all([
    db.select().from(commandRecords).where(and(eq(commandRecords.projectId, "MEFFORD-SALES"), eq(commandRecords.id, opportunityId))).limit(1),
    db.select().from(commandRecords).where(inArray(commandRecords.projectId, projectIds)).orderBy(desc(commandRecords.updatedAt)).limit(200),
    db.select({ id: projectFiles.id, projectId: projectFiles.projectId, name: projectFiles.name, category: projectFiles.category, revision: projectFiles.revision, contentType: projectFiles.contentType }).from(projectFiles).where(inArray(projectFiles.projectId, projectIds)),
  ]);
  if (!opportunities[0]) return Response.json({ error: "Sales Opportunity Not Found" }, { status: 404 });
  const data = normalizeProposalData(input.data);
  const sources = [
    { sourceId: `opportunity:${opportunityId}`, label: "Sales opportunity", detail: opportunities[0].title, content: parse(opportunities[0].dataJson) },
    ...records.slice(0, 80).map((row) => ({ sourceId: `record:${row.id}`, label: `${row.recordType}: ${row.title}`, detail: `${row.status} · ${row.recordDate}`, content: parse(row.dataJson) })),
    ...files.map((file) => ({ sourceId: `file:${file.id}`, label: file.name, detail: `${file.category} · ${file.revision}`, content: { indexedMetadataOnly: true, contentType: file.contentType } })),
  ];
  if (input.action === "proposal-schedule" && !files.some((file) => /drawing|design|plan/i.test(`${file.name} ${file.category}`)) && !records.some((row) => /drawing/i.test(row.recordType))) return Response.json({ error: "Upload Or Index Project Drawings Before Requesting A Drawing-Assisted Schedule Draft." }, { status: 409 });
  const model = await openAiModel();
  const schema = input.action === "project-read" ? projectReadSchema() : scheduleSchema();
  const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({
    model, store: false,
    input: [
      { role: "system", content: [{ type: "input_text", text: "You draft concise customer-facing commercial construction proposal content for Mefford Contracting. Use only supplied facts. Cite every project-specific claim with an allowed sourceId. Clearly identify assumptions and unanswered questions. Never invent drawing content, price, contract terms, dates, team credentials, or completed experience. Produce a review draft only. Use direct language: executiveSummary no more than 45 words, projectUnderstanding no more than 65 words, approachIntroduction no more than 24 words, each core-value commitment no more than 28 words, and scheduleNarrative no more than 35 words. Capitalize the first letter of every word in milestone titles. For a schedule, use the supplied targetStartDate as the first date and make the final milestone end exactly at targetStartDate plus durationMonths; do not shorten the stated project duration." }] },
      { role: "user", content: [{ type: "input_text", text: JSON.stringify({ action: input.action, instructions: String(input.instructions || ""), proposal: { projectName: data.projectName, location: data.projectLocation, owner: data.ownerName, deliveryMethod: data.deliveryMethod, projectType: data.projectType, targetStartDate: data.targetStartDate, durationMonths: data.durationMonths }, coreValues: MEFFORD_CORE_VALUES, allowedSourceIds: sources.map((source) => source.sourceId), sources }) }] },
    ],
    text: { format: { type: "json_schema", name: input.action === "project-read" ? "proposal_project_read" : "proposal_schedule", strict: true, schema } },
  }) });
  const raw = await response.json() as Record<string, unknown>;
  if (!response.ok) return Response.json({ error: openAiError(raw) }, { status: 502 });
  let result: Record<string, unknown>;
  try { result = JSON.parse(extractText(raw)) as Record<string, unknown>; } catch { return Response.json({ error: "OpenAI Returned A Draft That Could Not Be Validated. No Proposal Records Were Changed." }, { status: 502 }); }
  const allowed = new Set(sources.map((source) => source.sourceId));
  const citedIds = list(result.sourceIds).filter((id) => allowed.has(id));
  const intelligence = { status: "Draft", model, generatedAt: new Date().toISOString(), generatedBy: actor.email, approvedAt: "", approvedBy: "", sourceFileIds: citedIds.filter((id) => id.startsWith("file:")).map((id) => Number(id.slice(5))).filter(Number.isFinite), citations: citedIds.map((id) => { const source = sources.find((item) => item.sourceId === id)!; return { sourceId: id, label: source.label, detail: source.detail }; }), openQuestions: list(result.openQuestions) };
  if (input.action === "project-read") {
    const commitments = Array.isArray(result.coreValueCommitments) ? result.coreValueCommitments as Array<Record<string, unknown>> : [];
    return Response.json({ executiveSummary: limitWords(result.executiveSummary, 45), projectUnderstanding: limitWords(result.projectUnderstanding, 65), approachIntroduction: limitWords(result.approachIntroduction, 24), approachPhases: MEFFORD_CORE_VALUES.map((value, index) => ({ id: `APPROACH-0${index + 1}`, title: value, description: limitWords(commitments[index]?.description, 28), included: true })), intelligence, requiresHumanReview: true, writesApplied: false });
  }
  const milestones = Array.isArray(result.milestones) ? result.milestones as Array<Record<string, unknown>> : [];
  const scheduleMilestones = alignScheduleMilestonesToDuration(milestones.slice(0, 20).map((item, index) => ({ id: `MILESTONE-AI-${index + 1}`, title: titleCase(item.title), startDate: validDate(item.startDate), endDate: validDate(item.endDate), durationDays: Math.max(1, Math.round(Number(item.durationDays) || 1)), phase: String(item.phase || "Construction"), sourceReferences: list(item.sourceReferences).filter((id) => allowed.has(id)), assumption: item.assumption === true, included: true })), data.targetStartDate, data.durationMonths);
  return Response.json({ scheduleNarrative: limitWords(result.scheduleNarrative, 35), scheduleMilestones, intelligence, requiresHumanReview: true, writesApplied: false });
}

function projectReadSchema() { return { type: "object", additionalProperties: false, properties: { executiveSummary: { type: "string" }, projectUnderstanding: { type: "string" }, approachIntroduction: { type: "string" }, coreValueCommitments: { type: "array", minItems: 4, maxItems: 4, items: { type: "object", additionalProperties: false, properties: { value: { type: "string", enum: MEFFORD_CORE_VALUES }, description: { type: "string" } }, required: ["value", "description"] } }, sourceIds: { type: "array", items: { type: "string" } }, openQuestions: { type: "array", items: { type: "string" } } }, required: ["executiveSummary", "projectUnderstanding", "approachIntroduction", "coreValueCommitments", "sourceIds", "openQuestions"] }; }
function scheduleSchema() { return { type: "object", additionalProperties: false, properties: { scheduleNarrative: { type: "string" }, milestones: { type: "array", items: { type: "object", additionalProperties: false, properties: { title: { type: "string" }, startDate: { type: "string" }, endDate: { type: "string" }, durationDays: { type: "integer" }, phase: { type: "string", enum: ["Preconstruction", "Procurement", "Construction", "Turnover"] }, sourceReferences: { type: "array", items: { type: "string" } }, assumption: { type: "boolean" } }, required: ["title", "startDate", "endDate", "durationDays", "phase", "sourceReferences", "assumption"] } }, sourceIds: { type: "array", items: { type: "string" } }, openQuestions: { type: "array", items: { type: "string" } } }, required: ["scheduleNarrative", "milestones", "sourceIds", "openQuestions"] }; }
function parse(value: string) { try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; } }
function parseList(value: string) { try { const result = JSON.parse(value) as unknown; return Array.isArray(result) ? result.map(String) : []; } catch { return []; } }
function list(value: unknown) { return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : []; }
function validDate(value: unknown) { const text = String(value || ""); return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ""; }
function limitWords(value: unknown, maximum: number) { const words = String(value || "").trim().split(/\s+/).filter(Boolean); return words.length <= maximum ? words.join(" ") : `${words.slice(0, maximum).join(" ").replace(/[,:;.-]+$/, "")}...`; }
function titleCase(value: unknown) { return String(value || "").trim().replace(/\b[a-z]/g, (letter) => letter.toUpperCase()); }
async function openAiKey() { const { env } = await import("cloudflare:workers"); return String((env as unknown as Record<string, unknown>).OPENAI_API_KEY || "").trim(); }
async function openAiModel() { const { env } = await import("cloudflare:workers"); const binding = env as unknown as Record<string, unknown>; return String(binding.OPENAI_MODEL || binding.OPENAI_ASSISTANT_MODEL || "").trim() || DEFAULT_MODEL; }
function extractText(value: Record<string, unknown>) { if (typeof value.output_text === "string") return value.output_text; return (Array.isArray(value.output) ? value.output : []).flatMap((item) => item && typeof item === "object" && Array.isArray((item as { content?: unknown }).content) ? (item as { content: Array<Record<string, unknown>> }).content : []).map((item) => typeof item.text === "string" ? item.text : "").filter(Boolean).join("\n"); }
function openAiError(value: Record<string, unknown>) { const error = value.error && typeof value.error === "object" ? value.error as Record<string, unknown> : {}; return String(error.message || "OpenAI Could Not Create The Proposal Draft. No Proposal Records Were Changed."); }
