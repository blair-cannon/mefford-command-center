import { and, eq } from "drizzle-orm";
import { commandRecords, companyMembers, recordAudits } from "../../../db/schema";
import { enforceOnboardingAccess } from "../../../lib/onboarding";
import {
  PERFORMANCE_GOVERNANCE,
  PERFORMANCE_METRIC_LIBRARY,
  PERFORMANCE_PROJECT_ID,
  PERFORMANCE_REVIEW_TYPE,
  buildPerformanceScorecards,
  calibratedPerformanceGrade,
  currentPerformanceQuarter,
  performanceQuarterRange,
  performanceReviewId,
  type PerformanceEmployee,
  type PerformanceMeeting,
  type PerformanceProject,
  type PerformanceRecord,
  type PerformanceScorecard,
  type PerformanceScheduledRun,
  type PerformanceWorkItem,
} from "../../../lib/performance-reviews";
import { resolveCommandActor } from "../../../lib/server-actor";
import { recordCompletedWorkflowHandoff } from "../../../lib/domain-outbox";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";

type PerformancePayload = {
  action?: "generate-cycle" | "save-owner-review" | "generate-ai-analysis";
  quarter?: string;
  reviewId?: string;
  ownerSummary?: string;
  accomplishments?: string;
  coaching?: string;
  goals?: string;
  adjustment?: number;
  adjustmentReason?: string;
  finalize?: boolean;
};

type RawRecord = {
  project_id: string;
  id: string;
  record_type: string;
  title: string;
  owner: string;
  due: string;
  status: string;
  meta: string;
  record_date: string | null;
  data_json: string;
  created_at: string;
  updated_at: string;
};

export async function GET(request: Request) {
  const owner = await ownerContext(request);
  if ("response" in owner) return owner.response;
  try {
    const quarter = new URL(request.url).searchParams.get("quarter") || currentPerformanceQuarter();
    performanceQuarterRange(quarter);
    return Response.json(await performancePayload(quarter));
  } catch (error) {
    return Response.json({ error: message(error, "The Performance Center Is Unavailable") }, { status: error instanceof Error && /Valid Quarter/.test(error.message) ? 400 : 500 });
  }
}

export async function POST(request: Request) {
  const owner = await ownerContext(request);
  if ("response" in owner) return owner.response;
  const actor = owner.actor;
  try {
    const input = await request.json() as PerformancePayload;
    const quarter = input.quarter || currentPerformanceQuarter();
    performanceQuarterRange(quarter);
    if (input.action === "generate-cycle") return generateCycle(quarter, actor);
    if (input.action === "save-owner-review") return saveOwnerReview(input, quarter, actor);
    if (input.action === "generate-ai-analysis") return generateAiAnalysis(input, quarter, actor);
    return Response.json({ error: "A Valid Owner Performance Action Is Required" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: message(error, "The Performance Review Action Could Not Be Completed") }, { status: 500 });
  }
}

export async function generateQuarterlyPerformanceCycle(now = new Date()) {
  const quarter = currentPerformanceQuarter(now);
  const range = performanceQuarterRange(quarter);
  const today = now.toISOString().slice(0, 10);
  if (today < range.start || today > addDays(range.start, 6)) return { generated: 0, quarter, reason: "Outside Quarterly Generation Window" };
  const priorQuarter = previousQuarter(quarter);
  const result = await loadPerformanceData(priorQuarter);
  let generated = 0;
  for (const scorecard of result.scorecards) {
    const saved = await saveGeneratedReview(scorecard, { name: "Quarterly Performance Automation", email: "system@meffcon.com" });
    if (saved) generated += 1;
  }
  return { generated, quarter: priorQuarter, policy: "Deterministic evidence snapshot only; Company Owner review remains required" };
}

async function generateCycle(quarter: string, actor: { name: string; email: string }) {
  const result = await loadPerformanceData(quarter);
  let generated = 0;
  let retainedFinal = 0;
  for (const scorecard of result.scorecards) {
    const saved = await saveGeneratedReview(scorecard, actor);
    if (saved) generated += 1;
    else retainedFinal += 1;
  }
  return Response.json({ saved: true, generated, retainedFinal, ...(await performancePayload(quarter)) });
}

async function saveGeneratedReview(scorecard: PerformanceScorecard, actor: { name: string; email: string }) {
  const { getDb } = await import("../../../db");
  const db = getDb();
  const id = performanceReviewId(scorecard.employee.email, scorecard.quarter);
  const existing = (await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, PERFORMANCE_PROJECT_ID), eq(commandRecords.id, id), eq(commandRecords.recordType, PERFORMANCE_REVIEW_TYPE))).limit(1))[0];
  if (existing?.status === "Finalized") return false;
  const prior = parse(existing?.dataJson || "{}");
  const now = new Date().toISOString();
  const due = addDays(scorecard.periodEnd, 14);
  const data = {
    ...scorecard,
    ownerReview: prior.ownerReview || null,
    aiAnalysis: prior.aiAnalysis || null,
    systemScoreLocked: true,
    generatedBy: actor.name,
    generatedByEmail: actor.email,
    generatedAt: now,
  };
  await db.insert(commandRecords).values({
    projectId: PERFORMANCE_PROJECT_ID,
    id,
    recordType: PERFORMANCE_REVIEW_TYPE,
    title: `${scorecard.employee.name} · ${scorecard.quarter} Performance Review`,
    owner: scorecard.employee.name,
    due,
    status: existing?.status || "Owner Review Required",
    meta: `${scorecard.systemScore === null ? "No Score" : `${scorecard.systemScore}/100`} · ${scorecard.grade} · ${scorecard.evidenceCoverage}% Evidence Coverage`,
    recordDate: scorecard.periodEnd,
    dateLocked: existing?.dateLocked || false,
    dataJson: JSON.stringify(data),
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [commandRecords.projectId, commandRecords.id],
    set: { due, status: existing?.status || "Owner Review Required", meta: `${scorecard.systemScore === null ? "No Score" : `${scorecard.systemScore}/100`} · ${scorecard.grade} · ${scorecard.evidenceCoverage}% Evidence Coverage`, recordDate: scorecard.periodEnd, dataJson: JSON.stringify(data), updatedAt: now },
  });
  await audit(id, actor, existing ? "Quarterly Evidence Refreshed" : "Quarterly Review Generated", existing?.status || "None", existing?.status || "Owner Review Required", `${scorecard.metrics.length} metric(s) preserved with ${scorecard.evidenceCoverage}% evidence coverage`);
  return true;
}

async function saveOwnerReview(input: PerformancePayload, quarter: string, actor: { name: string; email: string }) {
  const id = cleanId(input.reviewId || "");
  if (!id) return Response.json({ error: "Choose An Employee Review" }, { status: 400 });
  const { getDb } = await import("../../../db");
  const db = getDb();
  const row = (await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, PERFORMANCE_PROJECT_ID), eq(commandRecords.id, id), eq(commandRecords.recordType, PERFORMANCE_REVIEW_TYPE))).limit(1))[0];
  if (!row) return Response.json({ error: "Performance Review Not Found" }, { status: 404 });
  if (row.status === "Finalized") return Response.json({ error: "A Finalized Review Is Immutable. Create A Documented Addendum Instead." }, { status: 409 });
  const data = parse(row.dataJson);
  if (String(data.quarter || "") !== quarter) return Response.json({ error: "The Review Does Not Belong To The Selected Quarter" }, { status: 409 });
  const adjustment = Math.max(-10, Math.min(10, Math.round(Number(input.adjustment || 0))));
  const adjustmentReason = clean(input.adjustmentReason, 1_000);
  if (adjustment && adjustmentReason.length < 15) return Response.json({ error: "Explain Every Owner Calibration In At Least 15 Characters" }, { status: 400 });
  const ownerSummary = clean(input.ownerSummary, 4_000);
  if (input.finalize && ownerSummary.length < 25) return Response.json({ error: "Add A Complete Owner Summary Before Finalizing" }, { status: 400 });
  const systemScore = typeof data.systemScore === "number" ? data.systemScore : null;
  const finalScore = systemScore === null ? null : Math.max(0, Math.min(100, systemScore + adjustment));
  const now = new Date().toISOString();
  const ownerReview = {
    ownerSummary,
    accomplishments: clean(input.accomplishments, 4_000),
    coaching: clean(input.coaching, 4_000),
    goals: clean(input.goals, 4_000),
    adjustment,
    adjustmentReason,
    finalScore,
    finalGrade: finalScore === null ? "Developing Evidence" : calibratedPerformanceGrade(finalScore),
    reviewedBy: actor.name,
    reviewedByEmail: actor.email,
    reviewedAt: now,
    finalizedAt: input.finalize ? now : "",
  };
  const status = input.finalize ? "Finalized" : "Owner Draft Saved";
  await db.update(commandRecords).set({ status, dateLocked: Boolean(input.finalize), meta: `${finalScore === null ? "No Score" : `${finalScore}/100`} · ${ownerReview.finalGrade} · System ${systemScore ?? "N/A"}`, dataJson: JSON.stringify({ ...data, ownerReview }), updatedAt: now }).where(and(eq(commandRecords.projectId, PERFORMANCE_PROJECT_ID), eq(commandRecords.id, id)));
  await audit(id, actor, "Owner Review", row.status, status, adjustment ? `Owner calibration ${adjustment > 0 ? "+" : ""}${adjustment}: ${adjustmentReason}` : "System score retained without owner calibration");
  let handoff = null;
  if (input.finalize) {
    const { env } = await import("cloudflare:workers");
    handoff = await recordCompletedWorkflowHandoff(env.DB, { workflowId: "field-to-performance", eventId: `field-performance-finalized:${id}:${quarter}`, aggregateType: PERFORMANCE_REVIEW_TYPE, aggregateId: id, projectId: PERFORMANCE_PROJECT_ID, actorName: actor.name, actorEmail: actor.email, occurredAt: now, payload: { reviewId: id, quarter, finalScore, evidenceCoverage: data.evidenceCoverage } });
  }
  return Response.json({ saved: true, status, ownerReview, handoff });
}

async function generateAiAnalysis(input: PerformancePayload, quarter: string, actor: { name: string; email: string }) {
  const id = cleanId(input.reviewId || "");
  if (!id) return Response.json({ error: "Choose An Employee Review" }, { status: 400 });
  const { getDb } = await import("../../../db");
  const db = getDb();
  const row = (await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, PERFORMANCE_PROJECT_ID), eq(commandRecords.id, id), eq(commandRecords.recordType, PERFORMANCE_REVIEW_TYPE))).limit(1))[0];
  if (!row) return Response.json({ error: "Performance Review Not Found" }, { status: 404 });
  if (row.status === "Finalized") return Response.json({ error: "A Finalized Review Is Immutable" }, { status: 409 });
  const data = parse(row.dataJson);
  if (String(data.quarter || "") !== quarter) return Response.json({ error: "The Review Does Not Belong To The Selected Quarter" }, { status: 409 });
  const settings = await openAiSettings();
  if (!settings.key) return Response.json({ error: "ChatGPT Performance Analysis Is Ready But The OpenAI API Connection Is Not Configured" }, { status: 503 });
  const started = Date.now();
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${settings.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: settings.model,
      store: false,
      max_output_tokens: 1_600,
      instructions: "You are Mefford Contracting's evidence analyst. Use only the supplied quarterly evidence. Never infer protected traits, medical or benefits information, intent, personality, or off-system behavior. Do not change a score, recommend termination, compensation, promotion, discipline, or any other employment decision. Draft a balanced owner-review aid, flag missing evidence, and cite metric keys in brackets.",
      input: JSON.stringify({ employee: data.employee, quarter: data.quarter, systemScore: data.systemScore, grade: data.grade, evidenceCoverage: data.evidenceCoverage, metrics: data.metrics, assignedProjects: data.assignedProjects, evidenceGaps: data.evidenceGaps }),
      text: { format: { type: "json_schema", name: "performance_review_analysis", strict: true, schema: analysisSchema() } },
    }),
  });
  const result = await response.json() as Record<string, unknown>;
  if (!response.ok) return Response.json({ error: openAiError(result), boundary: "No Score Or Review Decision Was Changed" }, { status: response.status === 429 ? 429 : 502 });
  const raw = responseText(result);
  const analysis = JSON.parse(raw) as Record<string, unknown>;
  const now = new Date().toISOString();
  const saved = { ...analysis, model: settings.model, generatedAt: now, generatedBy: actor.name, durationMs: Date.now() - started, decisionAuthority: "Company Owner" };
  await db.update(commandRecords).set({ dataJson: JSON.stringify({ ...data, aiAnalysis: saved }), updatedAt: now }).where(and(eq(commandRecords.projectId, PERFORMANCE_PROJECT_ID), eq(commandRecords.id, id)));
  await audit(id, actor, "ChatGPT Evidence Draft", "No Current Draft", "Draft Generated", "Structured evidence analysis saved without changing system or owner score");
  return Response.json({ saved: true, aiAnalysis: saved, boundary: PERFORMANCE_GOVERNANCE.aiBoundary });
}

async function performancePayload(quarter: string) {
  const result = await loadPerformanceData(quarter);
  const { getDb } = await import("../../../db");
  const db = getDb();
  const stored = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, PERFORMANCE_PROJECT_ID), eq(commandRecords.recordType, PERFORMANCE_REVIEW_TYPE)));
  const reviews = stored.filter((row) => parse(row.dataJson).quarter === quarter).map((row) => ({ id: row.id, title: row.title, owner: row.owner, due: row.due, status: row.status, meta: row.meta, data: parse(row.dataJson), updatedAt: row.updatedAt }));
  const openai = await openAiSettings();
  return {
    quarter,
    period: performanceQuarterRange(quarter),
    permissions: { canView: true, canGenerate: true, canReview: true, canFinalize: true, ownerOnly: true },
    governance: PERFORMANCE_GOVERNANCE,
    metricLibrary: PERFORMANCE_METRIC_LIBRARY,
    scorecards: result.scorecards,
    reviews,
    automation: { quarterlySnapshot: "First seven days after every quarter", evidenceRefresh: "Owner-triggered before finalization", projectHealth: "Nightly", customerVoice: "Milestone-driven", finalAuthority: "Company Owner" },
    openai: { configured: Boolean(openai.key), provider: "OpenAI Responses API", model: openai.model, role: "Evidence narrative and coaching draft only" },
  };
}

async function loadPerformanceData(quarter: string) {
  const { env } = await import("cloudflare:workers");
  const database = env.DB;
  const [members, projects, records, workItems, occurrences, attendees, actions, scheduledRuns] = await Promise.all([
    safeAll<Record<string, unknown>>(database, "SELECT email, display_name, company_access_level, designations_json, is_active FROM company_members"),
    safeAll<Record<string, unknown>>(database, "SELECT number, name, status, start_date, substantial_date, final_date, contract_amount, current_contract_amount, project_manager, superintendent FROM projects"),
    safeAll<RawRecord>(database, "SELECT project_id, id, record_type, title, owner, due, status, meta, record_date, data_json, created_at, updated_at FROM command_records"),
    safeAll<Record<string, unknown>>(database, "SELECT id, recipient_email, due_at, status, completed_at, source_type, source_record_id, created_at FROM command_work_items"),
    safeAll<Record<string, unknown>>(database, "SELECT o.id, o.series_id, o.scheduled_start, o.status, s.project_id, s.meeting_type FROM meeting_occurrences o JOIN meeting_series s ON s.id = o.series_id"),
    safeAll<Record<string, unknown>>(database, "SELECT occurrence_id, email, attendance_status FROM meeting_attendees"),
    safeAll<Record<string, unknown>>(database, "SELECT occurrence_id, assignee_email, status, due_at, completed_at, id FROM meeting_action_items"),
    safeAll<Record<string, unknown>>(database, "SELECT id, job_name, scheduled_at, completed_at, status, attempt_count, duration_ms, error_message FROM scheduled_operation_runs"),
  ]);
  const occurrenceMap = new Map(occurrences.map((item) => [String(item.id), item]));
  const meetingRows: PerformanceMeeting[] = [
    ...attendees.map((item) => meetingRow(occurrenceMap.get(String(item.occurrence_id)), { attendeeEmail: String(item.email || ""), attendanceStatus: String(item.attendance_status || "") })),
    ...actions.map((item) => meetingRow(occurrenceMap.get(String(item.occurrence_id)), { actionAssigneeEmail: String(item.assignee_email || ""), actionStatus: String(item.status || ""), actionDueAt: String(item.due_at || ""), actionCompletedAt: String(item.completed_at || ""), sourceId: String(item.id || "") })),
  ].filter((item) => item.occurrenceId);
  const employees: PerformanceEmployee[] = members.map((row) => ({ email: String(row.email || ""), name: String(row.display_name || ""), accessLevel: String(row.company_access_level || "Employee"), designations: parseArray(row.designations_json), active: Boolean(row.is_active) }));
  const projectRows: PerformanceProject[] = projects.map((row) => ({ number: String(row.number || ""), name: String(row.name || ""), status: String(row.status || ""), startDate: String(row.start_date || ""), substantialDate: String(row.substantial_date || ""), finalDate: String(row.final_date || ""), contractAmount: Number(row.contract_amount || 0), currentContractAmount: Number(row.current_contract_amount || 0), projectManager: String(row.project_manager || ""), superintendent: String(row.superintendent || "") }));
  const recordRows: PerformanceRecord[] = records.map((row) => ({ projectId: row.project_id, id: row.id, type: row.record_type, title: row.title, owner: row.owner, due: row.due, status: row.status, recordDate: row.record_date || "", createdAt: row.created_at, updatedAt: row.updated_at, data: parse(row.data_json) }));
  const workRows: PerformanceWorkItem[] = workItems.map((row) => ({ id: String(row.id || ""), recipientEmail: String(row.recipient_email || ""), dueAt: String(row.due_at || ""), status: String(row.status || ""), completedAt: String(row.completed_at || ""), sourceType: String(row.source_type || ""), sourceRecordId: String(row.source_record_id || ""), createdAt: String(row.created_at || "") }));
  const runRows: PerformanceScheduledRun[] = scheduledRuns.map((row) => ({ id: String(row.id || ""), jobName: String(row.job_name || ""), scheduledAt: String(row.scheduled_at || ""), completedAt: String(row.completed_at || ""), status: String(row.status || ""), attempts: Number(row.attempt_count || 0), durationMs: Number(row.duration_ms || 0), error: String(row.error_message || "") }));
  return { scorecards: buildPerformanceScorecards({ quarter, employees, projects: projectRows, records: recordRows, workItems: workRows, meetings: meetingRows, scheduledRuns: runRows }) };
}

async function ownerContext(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return { response: Response.json({ error: "Authentication Required" }, { status: 401 }) };
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return { response: onboardingLock };
  const { getDb } = await import("../../../db");
  const member = await getDb().select().from(companyMembers).where(eq(companyMembers.email, actor.email)).limit(1);
  const access = member[0]?.companyAccessLevel || actor.accessLevel;
  if (access !== "Company Owner") return { response: Response.json({ error: "Company Owner Access Is Required" }, { status: 403 }) };
  return { actor: { name: member[0]?.displayName || actor.name, email: actor.email } };
}

async function audit(recordId: string, actor: { name: string; email: string }, field: string, oldValue: string, newValue: string, summary: string) {
  const { getDb } = await import("../../../db");
  await getDb().insert(recordAudits).values({ projectId: PERFORMANCE_PROJECT_ID, recordId, fieldName: field, oldValue, newValue, reason: "Owner-only quarterly performance governance", actorName: actor.name, actorEmail: actor.email, summary, createdAt: new Date().toISOString() });
}

async function openAiSettings() {
  const { env } = await import("cloudflare:workers");
  const binding = env as unknown as Record<string, unknown>;
  return { key: String(binding.OPENAI_API_KEY || "").trim(), model: String(binding.OPENAI_MODEL || DEFAULT_OPENAI_MODEL).trim() || DEFAULT_OPENAI_MODEL };
}

function analysisSchema() {
  return {
    type: "object",
    properties: {
      balancedSummary: { type: "string" },
      verifiedStrengths: { type: "array", items: { type: "string" } },
      improvementAreas: { type: "array", items: { type: "string" } },
      evidenceGaps: { type: "array", items: { type: "string" } },
      coachingQuestions: { type: "array", items: { type: "string" } },
      suggestedQuarterGoals: { type: "array", items: { type: "string" } },
      ownerCautions: { type: "array", items: { type: "string" } },
    },
    required: ["balancedSummary", "verifiedStrengths", "improvementAreas", "evidenceGaps", "coachingQuestions", "suggestedQuarterGoals", "ownerCautions"],
    additionalProperties: false,
  };
}

function responseText(result: Record<string, unknown>) {
  if (typeof result.output_text === "string") return result.output_text;
  const output = Array.isArray(result.output) ? result.output as Array<Record<string, unknown>> : [];
  for (const item of output) for (const part of (Array.isArray(item.content) ? item.content as Array<Record<string, unknown>> : [])) if (typeof part.text === "string") return part.text;
  throw new Error("ChatGPT Returned No Structured Review Draft");
}

function openAiError(result: Record<string, unknown>) {
  const error = result.error && typeof result.error === "object" ? result.error as Record<string, unknown> : {};
  return clean(error.message, 500) || "ChatGPT Performance Analysis Is Temporarily Unavailable";
}

function meetingRow(source: Record<string, unknown> | undefined, values: Partial<PerformanceMeeting> & { sourceId?: string }): PerformanceMeeting & { sourceId?: string } {
  return { occurrenceId: String(source?.id || ""), projectId: String(source?.project_id || ""), meetingType: String(source?.meeting_type || ""), scheduledStart: String(source?.scheduled_start || ""), status: String(source?.status || ""), attendeeEmail: values.attendeeEmail || "", attendanceStatus: values.attendanceStatus || "", actionAssigneeEmail: values.actionAssigneeEmail || "", actionStatus: values.actionStatus || "", actionDueAt: values.actionDueAt || "", actionCompletedAt: values.actionCompletedAt || "", sourceId: values.sourceId || "" };
}

async function safeAll<T>(database: D1Database, query: string) {
  try { return (await database.prepare(query).all<T>()).results || []; } catch { return [] as T[]; }
}

function parse(value: string) {
  try { const parsed = JSON.parse(value || "{}"); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; }
}

function parseArray(value: unknown) {
  try { const parsed = typeof value === "string" ? JSON.parse(value) : value; return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
}

function clean(value: unknown, max: number) {
  return String(value || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
}

function cleanId(value: string) {
  return clean(value, 160).replace(/[^A-Za-z0-9._:@-]/g, "");
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function previousQuarter(value: string) {
  const match = /^(\d{4})-Q([1-4])$/.exec(value)!;
  const year = Number(match[1]);
  const quarter = Number(match[2]);
  return quarter === 1 ? `${year - 1}-Q4` : `${year}-Q${quarter - 1}`;
}

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
