import { upsertWorkItem } from "./my-work";

export const RUNTIME_FAILURE_WINDOW_MINUTES = 15;
export const RUNTIME_FAILURE_ALERT_THRESHOLD = 3;
export const RUNTIME_FAILURE_RETENTION_DAYS = 30;

type RuntimeFailureStatement = {
  bind: (...values: unknown[]) => RuntimeFailureStatement;
  first: <T>() => Promise<T | null>;
  all: <T>() => Promise<{ results?: T[] }>;
  run: () => Promise<unknown>;
};

export type RuntimeFailureDatabase = {
  prepare: (query: string) => RuntimeFailureStatement;
  batch: (statements: RuntimeFailureStatement[]) => Promise<unknown>;
};

type FirstPartyFailure = {
  route: string;
  status: number;
  reason: string;
  actorEmail?: string;
};

export async function recordFirstPartyFailure(input: FirstPartyFailure) {
  try {
    const { env } = await import("cloudflare:workers");
    const database = env.DB as unknown as RuntimeFailureDatabase;
    await ensureRuntimeFailureSchema(database);
    const occurredAt = new Date().toISOString();
    const route = normalizeRuntimeFailureRoute(input.route);
    const status = Math.max(400, Math.min(599, Math.trunc(input.status)));
    const failureKey = `${route}:${status}`;
    const detail = sanitizeRuntimeFailureDetail(input.reason);
    const actorEmail = input.actorEmail?.trim().toLowerCase().slice(0, 180) || "";
    const retentionCutoff = new Date(Date.now() - RUNTIME_FAILURE_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await database.batch([
      database.prepare(
        "INSERT INTO runtime_failure_events (id, route, status, failure_key, detail, actor_email, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).bind(`RUNTIME-FAILURE-${crypto.randomUUID()}`, route, status, failureKey, detail, actorEmail, occurredAt),
      database.prepare("DELETE FROM runtime_failure_events WHERE occurred_at < ?").bind(retentionCutoff),
    ]);
    const window = await database.prepare(
      "SELECT count(*) AS count FROM runtime_failure_events WHERE failure_key = ? AND datetime(occurred_at) >= datetime('now', '-15 minutes')",
    ).bind(failureKey).first<{ count: number }>();
    const failureCount = Number(window?.count || 0);
    if (!runtimeFailureThresholdReached(failureCount)) return;

    const members = await database.prepare(
      `SELECT display_name, email FROM company_members
       WHERE is_active = 1 AND (company_access_level IN ('Company Owner', 'Administrator') OR lower(email) = 'it@meffcon.com' OR designations_json LIKE '%IT Administrator%')`,
    ).all<{ display_name: string; email: string }>();
    const { getDb } = await import("../db");
    const db = getDb();
    const bucket = Math.floor(Date.now() / (15 * 60 * 1000));
    for (const member of members.results ?? []) {
      await upsertWorkItem(db, {
        dedupeKey: `runtime-failure:${failureKey}:${bucket}:${member.email.toLowerCase()}`,
        projectId: "MEFFORD-COMPANY",
        recipientName: member.display_name,
        recipientEmail: member.email.toLowerCase(),
        kind: "Runtime Reliability",
        title: `Repeated Command Center Failure · ${route}`,
        message: `${status} occurred ${failureCount} times within ${RUNTIME_FAILURE_WINDOW_MINUTES} minutes. Latest evidence: ${detail}`,
        priority: status >= 500 ? "Critical" : "High",
        sourceType: "Runtime Failure Event",
        sourceRecordId: failureKey,
        actionTarget: "IT & Integrations",
        dueAt: occurredAt,
        createdBy: "Runtime Observability",
      });
    }
  } catch (error) {
    console.error("Runtime failure evidence could not be persisted", error);
  }
}

export async function ensureRuntimeFailureSchema(database: RuntimeFailureDatabase) {
  await database.batch([
    database.prepare(`CREATE TABLE IF NOT EXISTS runtime_failure_events (
      id text PRIMARY KEY NOT NULL,
      route text NOT NULL,
      status integer NOT NULL,
      failure_key text NOT NULL,
      detail text DEFAULT '' NOT NULL,
      actor_email text DEFAULT '' NOT NULL,
      occurred_at text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    database.prepare("CREATE INDEX IF NOT EXISTS runtime_failure_events_window_idx ON runtime_failure_events (failure_key, occurred_at)"),
    database.prepare("CREATE INDEX IF NOT EXISTS runtime_failure_events_route_idx ON runtime_failure_events (route, status, occurred_at)"),
  ]);
}

export async function maintainRuntimeFailureEvidence(database: RuntimeFailureDatabase, now = new Date()) {
  const retentionCutoff = new Date(now.getTime() - RUNTIME_FAILURE_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await database.prepare("DELETE FROM runtime_failure_events WHERE occurred_at < ?").bind(retentionCutoff).run();
}

export function normalizeRuntimeFailureRoute(value: string) {
  return value.replace(/[^a-z0-9/_-]/gi, "").slice(0, 180) || "unknown-route";
}

export function runtimeFailureThresholdReached(count: number) {
  return Number.isFinite(count) && count >= RUNTIME_FAILURE_ALERT_THRESHOLD;
}

export function sanitizeRuntimeFailureDetail(value: string) {
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/((?:password|secret|token|api[_-]?key|authorization|client[_-]?secret|code|state|signature|sig)\s*["']?\s*[:=]\s*)["']?[^,\s}"']+/gi, "$1[REDACTED]")
    .replace(/([?&](?:password|secret|token|api[_-]?key|authorization|client[_-]?secret|code|state|signature|sig)=)[^&\s]*/gi, "$1[REDACTED]")
    .slice(0, 600);
}
