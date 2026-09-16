import { eq } from "drizzle-orm";
import { companyMembers } from "../../../db/schema";
import { resolveCommandActor } from "../../../lib/server-actor";
import { enforceOnboardingAccess } from "../../../lib/onboarding";
import {
  DEFAULT_ONBOARDING_REQUIREMENTS,
  getEmployeeOnboardingData,
  onboardingState,
} from "../../../lib/onboarding";
import {
  ASSISTANT_COMPANY_ID,
  assistantSystemInstructions,
  canAssistantReadSection,
  type AssistantActor,
} from "../../../lib/assistant-policy";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5.4-mini";
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_HISTORY_MESSAGES = 10;
const MAX_CONTEXT_SOURCES = 28;
const MAX_REQUESTS_PER_MINUTE = 20;

type AssistantMessage = {
  role?: "user" | "assistant";
  content?: string;
};

type AssistantPayload = {
  message?: string;
  history?: AssistantMessage[];
  conversationId?: string;
  activeTarget?: string;
  projectId?: string;
  projectName?: string;
};

type ContextSource = {
  id: string;
  kind: "Project" | "Record" | "File" | "Policy";
  title: string;
  detail: string;
  href: string;
  body: string;
  searchText: string;
  projectId: string;
  section: string;
  updatedAt: string;
};

type ProjectRow = {
  number: string;
  name: string;
  status: string;
  site: string;
  owner_name: string;
  owner_contract_type: string;
  owner_contract_status: string;
  contract_amount: string;
  current_contract_amount: string;
  start_date: string;
  substantial_date: string;
  final_date: string;
  project_manager: string;
  superintendent: string;
  updated_at: string;
};

type RecordRow = {
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
  updated_at: string;
};

type FileRow = {
  id: number;
  project_id: string;
  name: string;
  category: string;
  revision: string;
  content_type: string;
  uploaded_by: string;
  access: string;
  created_at: string;
};

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) {
    return noStore({ configured: false, error: "Authentication required" }, 401);
  }
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  return noStore({
    configured: Boolean(await openAiApiKey()),
    mode: "help_only",
    provider: "OpenAI",
    boundary:
      "Drafts and guidance only. All official actions stay in the normal Command Center workflow.",
  });
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const baseActor = await resolveCommandActor(request);
  if (!baseActor.authenticated) {
    return noStore({ error: "Authentication required" }, 401);
  }
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  const apiKey = await openAiApiKey();
  if (!apiKey) {
    return noStore(
      {
        error:
          "The OpenAI assistant is not configured. No Command Center action was taken.",
      },
      503,
    );
  }

  let payload: AssistantPayload;
  try {
    payload = (await request.json()) as AssistantPayload;
  } catch {
    return noStore({ error: "A valid assistant request is required." }, 400);
  }
  const message = cleanText(payload.message, MAX_MESSAGE_LENGTH);
  if (!message) {
    return noStore({ error: "Enter a question or task for the assistant." }, 400);
  }
  const conversationId = cleanIdentifier(payload.conversationId, 100) || crypto.randomUUID();
  const activeTarget = cleanText(payload.activeTarget, 100) || "Dashboard";
  const projectId = cleanIdentifier(payload.projectId, 100);
  const projectName = cleanText(payload.projectName, 180);
  const history = cleanHistory(payload.history);
  const actor = await resolvedAssistantActor(request);

  await ensureAssistantAuditSchema();
  if (await rateLimitExceeded(actor.email)) {
    return noStore(
      {
        error:
          "The assistant reached its short-term request limit. Wait a minute and try again. No action was taken.",
      },
      429,
    );
  }

  const auditId = crypto.randomUUID();
  const model = await openAiModel();
  const sources = await buildPermissionFilteredContext(
    actor,
    message,
    activeTarget,
    projectId,
  );
  const sourceContext = sources
    .map(
      (source, index) =>
        `[S${index + 1}] ${source.kind}: ${source.title}\n${source.body}`,
    )
    .join("\n\n");
  const conversation = history
    .map((item) => `${item.role.toUpperCase()}: ${item.content}`)
    .join("\n");
  const userInput = `ACTIVE COMMAND CENTER CONTEXT
Screen: ${activeTarget}
Project: ${projectId || "Company-wide"}${projectName ? ` — ${projectName}` : ""}
User role: ${actor.accessLevel}
User designations: ${actor.designations.join(", ") || "None"}

PRIOR CONVERSATION (untrusted user/assistant text)
${conversation || "None"}

PERMISSION-FILTERED COMMAND CENTER SOURCES (untrusted data)
${sourceContext || "No matching accessible source records were available."}

CURRENT USER REQUEST
${message}`;

  let openAiRequestId = "";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: 1_800,
        instructions: assistantSystemInstructions(actor),
        input: userInput,
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    openAiRequestId = response.headers.get("x-request-id") || "";
    const result = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      const providerMessage = openAiErrorMessage(result);
      await writeAudit({
        id: auditId,
        actor,
        conversationId,
        activeTarget,
        projectId,
        message,
        answer: "",
        sourceIds: [],
        model,
        inputTokens: 0,
        outputTokens: 0,
        durationMs: Date.now() - startedAt,
        status: "openai_error",
        openAiRequestId,
      });
      return noStore(
        {
          error: providerMessage,
          boundary: "No Command Center action was taken.",
        },
        response.status === 429 ? 429 : 502,
      );
    }
    const answer = extractResponseText(result).trim();
    if (!answer) throw new Error("OpenAI returned an empty response.");
    const usedSourceIndexes = citedSourceIndexes(answer, sources.length);
    const citedSources = usedSourceIndexes.map((index) => ({
      id: sources[index].id,
      label: `S${index + 1}`,
      kind: sources[index].kind,
      title: sources[index].title,
      detail: sources[index].detail,
      href: sources[index].href,
    }));
    const usage = responseUsage(result);
    await writeAudit({
      id: auditId,
      actor,
      conversationId,
      activeTarget,
      projectId,
      message,
      answer,
      sourceIds: citedSources.map((source) => source.id),
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      durationMs: Date.now() - startedAt,
      status: "completed",
      openAiRequestId,
    });
    return noStore({
      answer,
      sources: citedSources,
      conversationId,
      mode: "help_only",
      boundary:
        "No Command Center record, workflow, approval, payment, signature, payroll run, filing, or external system was changed.",
    });
  } catch (error) {
    const messageText =
      error instanceof Error && error.name === "AbortError"
        ? "The OpenAI assistant timed out. Try again. No action was taken."
        : "The OpenAI assistant is temporarily unavailable. No action was taken.";
    await writeAudit({
      id: auditId,
      actor,
      conversationId,
      activeTarget,
      projectId,
      message,
      answer: "",
      sourceIds: [],
      model,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: Date.now() - startedAt,
      status: "request_error",
      openAiRequestId,
    }).catch(() => undefined);
    return noStore({ error: messageText }, 502);
  }
}

async function resolvedAssistantActor(request: Request): Promise<AssistantActor> {
  const base = await resolveCommandActor(request);
  let accessLevel = base.accessLevel;
  let designations: string[] = [];
  let permissionLocked = false;
  try {
    const { getDb } = await import("../../../db");
    const member = await getDb()
      .select({
        accessLevel: companyMembers.companyAccessLevel,
        designationsJson: companyMembers.designationsJson,
      })
      .from(companyMembers)
      .where(eq(companyMembers.email, base.email))
      .limit(1);
    if (["Company Owner", "Administrator"].includes(member[0]?.accessLevel || "")) {
      accessLevel = member[0].accessLevel as "Company Owner" | "Administrator";
    }
    designations = parseStringArray(member[0]?.designationsJson);
    const onboarding = await getEmployeeOnboardingData(base.email);
    permissionLocked = onboarding
      ? onboardingState(onboarding, DEFAULT_ONBOARDING_REQUIREMENTS).permissionLocked
      : false;
    if (permissionLocked) designations = [];
  } catch {
    // The authenticated Sites identity remains authoritative during initialization.
  }
  return {
    name: base.name,
    email: base.email,
    accessLevel,
    designations,
    permissionLocked,
  };
}

async function buildPermissionFilteredContext(
  actor: AssistantActor,
  message: string,
  activeTarget: string,
  activeProjectId: string,
) {
  const [projectsResult, recordsResult, filesResult] = await Promise.all([
    safeAll<ProjectRow>(`SELECT number, name, status, site, owner_name,
      owner_contract_type, owner_contract_status, contract_amount,
      current_contract_amount, start_date, substantial_date, final_date,
      project_manager, superintendent, updated_at
      FROM projects ORDER BY updated_at DESC LIMIT 80`),
    safeAll<RecordRow>(`SELECT project_id, id, record_type, title, owner, due,
      status, meta, record_date, data_json, updated_at
      FROM command_records ORDER BY updated_at DESC LIMIT 350`),
    safeAll<FileRow>(`SELECT id, project_id, name, category, revision,
      content_type, uploaded_by, access, created_at
      FROM project_files ORDER BY id DESC LIMIT 250`),
  ]);
  const projects = projectsResult.results || [];
  const validProjectIds = new Set(projects.map((project) => project.number));
  const sources: ContextSource[] = [];

  sources.push({
    id: "POLICY:HELP_ONLY",
    kind: "Policy",
    title: "Permanent Help-Only Boundary",
    detail: "Normal Command Center approvals and execution remain unchanged",
    href: "",
    body:
      "The assistant may read, explain, summarize, compare, calculate, draft, prefill, organize, and guide. It cannot create or change records; submit or route approvals; approve, reject, sign, publish, release, pay, post, transmit, file, run payroll, change permissions, or alter external state. Payroll is detailed-report preparation only.",
    searchText:
      "assistant help approval approve sign pay payroll submit route publish execute permissions boundary",
    projectId: "",
    section: "Policy",
    updatedAt: "",
  });

  if (!actor.permissionLocked) {
    for (const project of projects) {
      sources.push({
        id: `PROJECT:${project.number}`,
        kind: "Project",
        title: `${project.number} — ${project.name}`,
        detail: `${project.status} · ${project.site}`,
        href: `/?target=Project%20Overview&project=${encodeURIComponent(project.number)}`,
        body: truncate(
          JSON.stringify({
            number: project.number,
            name: project.name,
            status: project.status,
            site: project.site,
            owner: project.owner_name,
            contractType: project.owner_contract_type,
            contractStatus: project.owner_contract_status,
            contractAmount: canReadFinancials(actor) ? project.contract_amount : "Restricted",
            currentContractAmount: canReadFinancials(actor)
              ? project.current_contract_amount
              : "Restricted",
            startDate: project.start_date,
            substantialCompletion: project.substantial_date,
            finalCompletion: project.final_date,
            projectManager: project.project_manager,
            superintendent: project.superintendent,
          }),
          1_500,
        ),
        searchText: `${project.number} ${project.name} ${project.status} ${project.site} ${project.owner_name} ${project.project_manager} ${project.superintendent}`,
        projectId: project.number,
        section: "Project Overview",
        updatedAt: project.updated_at,
      });
    }
  }

  for (const record of recordsResult.results || []) {
    if (!canReadRecord(actor, record, validProjectIds, activeProjectId)) continue;
    const section = recordSection(record.record_type);
    sources.push({
      id: `RECORD:${record.project_id}:${record.id}`,
      kind: "Record",
      title: `${record.id} — ${record.title}`,
      detail: `${record.project_id} · ${record.record_type} · ${record.status}`,
      href: `/?target=${encodeURIComponent(section)}&project=${encodeURIComponent(record.project_id)}&record=${encodeURIComponent(record.id)}`,
      body: truncate(
        JSON.stringify({
          projectId: record.project_id,
          recordId: record.id,
          recordType: record.record_type,
          title: record.title,
          owner: record.owner,
          due: record.due,
          status: record.status,
          meta: record.meta,
          recordDate: record.record_date,
          details: safeRecordData(record.data_json),
        }),
        2_000,
      ),
      searchText: `${record.project_id} ${record.id} ${record.record_type} ${record.title} ${record.owner} ${record.status} ${record.meta}`,
      projectId: record.project_id,
      section,
      updatedAt: record.updated_at,
    });
  }

  for (const file of filesResult.results || []) {
    if (!canReadFileMetadata(actor, file.project_id, validProjectIds, activeProjectId)) {
      continue;
    }
    const employeeResource = file.project_id === "MEFFORD-PEOPLE";
    sources.push({
      id: `FILE:${file.id}`,
      kind: "File",
      title: file.name,
      detail: `${employeeResource ? "Employee Resources" : file.project_id} · ${file.category} · ${file.revision}`,
      href: `/api/files?id=${file.id}`,
      body: truncate(
        JSON.stringify({
          projectId: file.project_id,
          fileName: file.name,
          category: file.category,
          controlledRevision: file.revision,
          contentType: file.content_type,
          uploadedBy: file.uploaded_by,
          access: file.access,
          uploadedAt: file.created_at,
          limitation:
            "Only controlled file metadata is indexed in this request; do not claim knowledge of the file body unless its text is supplied elsewhere.",
        }),
        1_200,
      ),
      searchText: `${file.project_id} ${file.name} ${file.category} ${file.revision} ${file.uploaded_by}`,
      projectId: file.project_id,
      section: employeeResource ? "Employee Portal" : "Documents",
      updatedAt: file.created_at,
    });
  }

  return rankSources(sources, message, activeTarget, activeProjectId).slice(
    0,
    MAX_CONTEXT_SOURCES,
  );
}

function canReadRecord(
  actor: AssistantActor,
  record: RecordRow,
  validProjectIds: Set<string>,
  activeProjectId: string,
) {
  const section = recordSection(record.record_type);
  if (!canAssistantReadSection(actor, section)) return false;
  if (actor.permissionLocked) {
    return record.project_id === "MEFFORD-PEOPLE";
  }
  if (record.project_id === "MEFFORD-ACCOUNTING") {
    return (
      actor.accessLevel === "Company Owner" ||
      actor.designations.includes("Accountant") ||
      actor.designations.includes("Financial Administrator") ||
      (section === "Owner Billing" && actor.designations.includes("Project Manager"))
    );
  }
  if (record.project_id === "MEFFORD-SALES") {
    return (
      ["Company Owner", "Administrator"].includes(actor.accessLevel) ||
      actor.designations.includes("Estimator") ||
      actor.designations.includes("Sales Representative")
    );
  }
  if (record.project_id === "MEFFORD-BID-ARCHIVE") {
    return (
      ["Company Owner", "Administrator"].includes(actor.accessLevel) ||
      actor.designations.includes("Estimator")
    );
  }
  if (record.project_id === "MEFFORD-PEOPLE") return true;
  if (record.project_id === "MEFFORD-COMPANY") {
    return canAssistantReadSection(actor, section);
  }
  if (!validProjectIds.has(record.project_id)) return false;
  if (["Company Owner", "Administrator"].includes(actor.accessLevel)) return true;
  if (actor.designations.includes("Project Manager")) return true;
  return !activeProjectId || record.project_id === activeProjectId;
}

function canReadFileMetadata(
  actor: AssistantActor,
  projectId: string,
  validProjectIds: Set<string>,
  activeProjectId: string,
) {
  if (projectId === "MEFFORD-PEOPLE") return true;
  if (actor.permissionLocked) return false;
  if (projectId === "MEFFORD-BID-ARCHIVE") {
    return (
      ["Company Owner", "Administrator"].includes(actor.accessLevel) ||
      actor.designations.includes("Estimator")
    );
  }
  if (!validProjectIds.has(projectId)) return false;
  if (["Company Owner", "Administrator"].includes(actor.accessLevel)) return true;
  return !activeProjectId || projectId === activeProjectId;
}

function recordSection(recordType: string) {
  const map: Record<string, string> = {
    "Payroll Report": "Payroll Reports",
    "Payroll Reports": "Payroll Reports",
    "AP Invoice": "Accounts Payable",
    "AR Invoice": "Owner Billing",
    "Owner Receipt": "Owner Billing",
    "Job Cost Actual": "Accounting Command",
    "Master Cost Codes": "Budget",
    "Awarded Estimate": "Awarded Estimates",
    "Budget Control": "Budget",
    "Toolbox Talks": "Safety",
  };
  return map[recordType] || recordType;
}

function rankSources(
  sources: ContextSource[],
  message: string,
  activeTarget: string,
  activeProjectId: string,
) {
  const terms = tokenize(`${message} ${activeTarget} ${activeProjectId}`);
  return sources
    .map((source, index) => {
      const haystack = `${source.searchText} ${source.body}`.toLowerCase();
      const termScore = terms.reduce(
        (score, term) => score + (haystack.includes(term) ? 5 : 0),
        0,
      );
      const contextScore =
        (activeProjectId && source.projectId === activeProjectId ? 14 : 0) +
        (source.section === activeTarget ? 12 : 0) +
        (source.kind === "Policy" ? 4 : 0);
      return { source, score: termScore + contextScore, index };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.source.updatedAt.localeCompare(a.source.updatedAt) ||
        a.index - b.index,
    )
    .map((entry) => entry.source);
}

function tokenize(value: string) {
  const stop = new Set([
    "about",
    "after",
    "before",
    "could",
    "from",
    "have",
    "help",
    "into",
    "please",
    "that",
    "their",
    "there",
    "these",
    "this",
    "what",
    "when",
    "where",
    "which",
    "with",
    "would",
  ]);
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .match(/[a-z0-9-]{3,}/g)
        ?.filter((term) => !stop.has(term)) || [],
    ),
  ).slice(0, 24);
}

async function safeAll<T>(query: string) {
  try {
    const { env } = await import("cloudflare:workers");
    return await env.DB.prepare(query).all<T>();
  } catch {
    return { results: [] as T[] };
  }
}

async function ensureAssistantAuditSchema() {
  const { env } = await import("cloudflare:workers");
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS assistant_audits (
      id text PRIMARY KEY NOT NULL,
      company_id text NOT NULL,
      conversation_id text NOT NULL,
      actor_name text NOT NULL,
      actor_email text NOT NULL,
      actor_role text NOT NULL,
      active_target text DEFAULT 'Dashboard' NOT NULL,
      project_id text DEFAULT '' NOT NULL,
      request_text text NOT NULL,
      response_text text DEFAULT '' NOT NULL,
      source_ids_json text DEFAULT '[]' NOT NULL,
      model text NOT NULL,
      input_tokens integer DEFAULT 0 NOT NULL,
      output_tokens integer DEFAULT 0 NOT NULL,
      duration_ms integer DEFAULT 0 NOT NULL,
      status text NOT NULL,
      openai_request_id text DEFAULT '' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS assistant_audits_actor_created_idx
      ON assistant_audits (actor_email, created_at)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS assistant_audits_conversation_idx
      ON assistant_audits (conversation_id)`),
  ]);
}

async function rateLimitExceeded(email: string) {
  const { env } = await import("cloudflare:workers");
  const result = await env.DB.prepare(
    `SELECT COUNT(*) AS total FROM assistant_audits
     WHERE actor_email = ? AND created_at >= datetime('now', '-1 minute')`,
  )
    .bind(email)
    .first<{ total: number }>();
  return Number(result?.total || 0) >= MAX_REQUESTS_PER_MINUTE;
}

async function writeAudit(input: {
  id: string;
  actor: AssistantActor;
  conversationId: string;
  activeTarget: string;
  projectId: string;
  message: string;
  answer: string;
  sourceIds: string[];
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  status: string;
  openAiRequestId: string;
}) {
  const { env } = await import("cloudflare:workers");
  await env.DB.prepare(
    `INSERT INTO assistant_audits
      (id, company_id, conversation_id, actor_name, actor_email, actor_role,
       active_target, project_id, request_text, response_text, source_ids_json,
       model, input_tokens, output_tokens, duration_ms, status, openai_request_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      input.id,
      ASSISTANT_COMPANY_ID,
      input.conversationId,
      input.actor.name,
      input.actor.email,
      input.actor.accessLevel,
      input.activeTarget,
      input.projectId,
      input.message,
      input.answer,
      JSON.stringify(input.sourceIds),
      input.model,
      input.inputTokens,
      input.outputTokens,
      input.durationMs,
      input.status,
      input.openAiRequestId,
    )
    .run();
}

function cleanHistory(value: AssistantMessage[] | undefined) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(-MAX_HISTORY_MESSAGES)
    .map((item) => ({
      role: item.role === "assistant" ? "assistant" : "user",
      content: cleanText(item.content, MAX_MESSAGE_LENGTH).replace(
        /\[S\d+\]/g,
        "[prior source]",
      ),
    }))
    .filter((item) => item.content);
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, maxLength)
    : "";
}

function cleanIdentifier(value: unknown, maxLength: number) {
  return cleanText(value, maxLength).replace(/[^a-zA-Z0-9_.:@-]/g, "");
}

function parseStringArray(value?: string) {
  try {
    const parsed = JSON.parse(value || "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function safeRecordData(value: string) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

function canReadFinancials(actor: AssistantActor) {
  return (
    ["Company Owner", "Administrator"].includes(actor.accessLevel) ||
    actor.designations.includes("Project Manager") ||
    actor.designations.includes("Accountant") ||
    actor.designations.includes("Financial Administrator")
  );
}

async function openAiApiKey() {
  const { env } = await import("cloudflare:workers");
  return String(
    (env as unknown as Record<string, unknown>).OPENAI_API_KEY || "",
  ).trim();
}

async function openAiModel() {
  const { env } = await import("cloudflare:workers");
  const binding = env as unknown as Record<string, unknown>;
  return (
    String(binding.OPENAI_MODEL || binding.OPENAI_ASSISTANT_MODEL || "").trim() || DEFAULT_MODEL
  );
}

function extractResponseText(value: Record<string, unknown>) {
  if (typeof value.output_text === "string") return value.output_text;
  const output = Array.isArray(value.output) ? value.output : [];
  return output
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const content = (item as { content?: unknown }).content;
      return Array.isArray(content) ? content : [];
    })
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      return typeof (item as { text?: unknown }).text === "string"
        ? String((item as { text: string }).text)
        : "";
    })
    .filter(Boolean)
    .join("\n");
}

function responseUsage(value: Record<string, unknown>) {
  const usage =
    value.usage && typeof value.usage === "object"
      ? (value.usage as Record<string, unknown>)
      : {};
  return {
    inputTokens: Number(usage.input_tokens || 0),
    outputTokens: Number(usage.output_tokens || 0),
  };
}

function openAiErrorMessage(value: Record<string, unknown>) {
  const error =
    value.error && typeof value.error === "object"
      ? (value.error as Record<string, unknown>)
      : {};
  const code = String(error.code || "");
  if (code === "insufficient_quota") {
    return "The OpenAI project needs billing or spend-limit attention. No Command Center action was taken.";
  }
  return "OpenAI could not complete this request. Try again. No Command Center action was taken.";
}

function citedSourceIndexes(answer: string, sourceCount: number) {
  const indexes = Array.from(answer.matchAll(/\[S(\d+)\]/g))
    .map((match) => Number(match[1]) - 1)
    .filter((index) => index >= 0 && index < sourceCount);
  return Array.from(new Set(indexes));
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

function noStore(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
