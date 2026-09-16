import { ensureMyWorkTables, upsertWorkItem } from "./my-work";
import { workflowReconciliationContract } from "./workflow-reconciliation-contracts";

export const DOMAIN_EVENT_SCHEMA_VERSION = 1;
export const DOMAIN_EVENT_MAX_ATTEMPTS = 5;
export const DOMAIN_EVENT_LEASE_MINUTES = 5;

export type DomainEventDatabase = D1Database;

export type DomainConsumerInput = {
  key: string;
  mandatory?: boolean;
  completedInSourceTransaction?: boolean;
  result?: Record<string, unknown>;
};

export type DomainEventInput = {
  id: string;
  idempotencyKey: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  projectId?: string;
  payload: Record<string, unknown>;
  actorName: string;
  actorEmail: string;
  consumers: DomainConsumerInput[];
  occurredAt?: string;
};

type EventRow = {
  id: string;
  event_type: string;
  payload_json: string;
  status: string;
  project_id: string;
  aggregate_id: string;
};

type ConsumerRow = {
  consumer_key: string;
  mandatory: number;
  status: string;
  attempt_count: number;
  next_attempt_at: string;
  result_json: string;
  last_error: string;
};

export type DomainEventStatus = "Pending" | "Partially Applied" | "Completed";

export async function ensureDomainOutboxSchema(database: DomainEventDatabase) {
  await database.batch([
    database.prepare(`CREATE TABLE IF NOT EXISTS domain_events (
      id text PRIMARY KEY NOT NULL,
      idempotency_key text NOT NULL UNIQUE,
      event_type text NOT NULL,
      schema_version integer NOT NULL,
      aggregate_type text NOT NULL,
      aggregate_id text NOT NULL,
      project_id text NOT NULL DEFAULT '',
      payload_json text NOT NULL,
      status text NOT NULL DEFAULT 'Pending',
      occurred_at text NOT NULL,
      actor_name text NOT NULL,
      actor_email text NOT NULL,
      completed_at text NOT NULL DEFAULT '',
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    database.prepare("CREATE INDEX IF NOT EXISTS domain_events_status_idx ON domain_events (status, occurred_at)"),
    database.prepare("CREATE INDEX IF NOT EXISTS domain_events_aggregate_idx ON domain_events (aggregate_type, aggregate_id, occurred_at)"),
    database.prepare(`CREATE TABLE IF NOT EXISTS domain_event_consumers (
      id text PRIMARY KEY NOT NULL,
      event_id text NOT NULL,
      consumer_key text NOT NULL,
      mandatory integer NOT NULL DEFAULT 1,
      status text NOT NULL DEFAULT 'Pending',
      attempt_count integer NOT NULL DEFAULT 0,
      lease_token text NOT NULL DEFAULT '',
      lease_expires_at text NOT NULL DEFAULT '',
      next_attempt_at text NOT NULL DEFAULT '',
      result_json text NOT NULL DEFAULT '{}',
      last_error text NOT NULL DEFAULT '',
      last_attempt_at text NOT NULL DEFAULT '',
      completed_at text NOT NULL DEFAULT '',
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(event_id, consumer_key)
    )`),
    database.prepare("CREATE INDEX IF NOT EXISTS domain_event_consumers_work_idx ON domain_event_consumers (status, next_attempt_at, lease_expires_at, event_id)"),
    database.prepare(`CREATE TABLE IF NOT EXISTS domain_event_audits (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      event_id text NOT NULL,
      consumer_key text NOT NULL DEFAULT '',
      action text NOT NULL,
      prior_status text NOT NULL,
      next_status text NOT NULL,
      detail text NOT NULL DEFAULT '',
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    database.prepare("CREATE INDEX IF NOT EXISTS domain_event_audits_event_idx ON domain_event_audits (event_id, created_at)"),
  ]);
}

export function domainEventStatements(database: DomainEventDatabase, input: DomainEventInput) {
  const occurredAt = input.occurredAt || new Date().toISOString();
  const consumers = uniqueConsumers(input.consumers);
  if (!consumers.length || !consumers.some((consumer) => consumer.mandatory !== false)) {
    throw new Error("A Domain Event Requires At Least One Mandatory Consumer");
  }
  return [
    database.prepare(`INSERT OR IGNORE INTO domain_events
      (id, idempotency_key, event_type, schema_version, aggregate_type, aggregate_id, project_id, payload_json, status, occurred_at, actor_name, actor_email, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?, ?, ?)`)
      .bind(input.id, input.idempotencyKey, input.eventType, DOMAIN_EVENT_SCHEMA_VERSION, input.aggregateType, input.aggregateId, input.projectId || "", JSON.stringify(input.payload), occurredAt, input.actorName, input.actorEmail, occurredAt),
    ...consumers.map((consumer) => {
      const completed = consumer.completedInSourceTransaction === true;
      return database.prepare(`INSERT OR IGNORE INTO domain_event_consumers
        (id, event_id, consumer_key, mandatory, status, attempt_count, result_json, completed_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          `${input.id}:${consumer.key}`,
          input.id,
          consumer.key,
          consumer.mandatory === false ? 0 : 1,
          completed ? "Succeeded" : "Pending",
          completed ? 1 : 0,
          JSON.stringify(consumer.result || {}),
          completed ? occurredAt : "",
          occurredAt,
        );
    }),
    database.prepare(`INSERT INTO domain_event_audits (event_id, action, prior_status, next_status, detail)
      VALUES (?, 'Event Enqueued', 'None', 'Pending', ?)`)
      .bind(input.id, `${input.eventType} v${DOMAIN_EVENT_SCHEMA_VERSION} · ${consumers.length} registered consumers`),
  ];
}

export async function beginDomainHandoff(database: DomainEventDatabase, input: DomainEventInput) {
  await ensureDomainOutboxSchema(database);
  await database.batch(domainEventStatements(database, input));
  return input.id;
}

export async function completeDomainConsumer(
  database: DomainEventDatabase,
  eventId: string,
  consumerKey: string,
  result: Record<string, unknown>,
  now = new Date(),
) {
  const nowIso = now.toISOString();
  const existing = await database.prepare(`SELECT status FROM domain_event_consumers WHERE event_id = ? AND consumer_key = ?`)
    .bind(eventId, consumerKey).first<{ status: string }>();
  if (!existing) throw new Error(`Unknown Domain Event Consumer ${eventId}:${consumerKey}`);
  if (existing.status === "Succeeded") return;
  await database.batch([
    database.prepare(`UPDATE domain_event_consumers SET status = 'Succeeded', attempt_count = CASE WHEN attempt_count < 1 THEN 1 ELSE attempt_count END,
      result_json = ?, last_error = '', lease_token = '', lease_expires_at = '', next_attempt_at = '', completed_at = ?, updated_at = ?
      WHERE event_id = ? AND consumer_key = ? AND status <> 'Succeeded'`).bind(JSON.stringify(result), nowIso, nowIso, eventId, consumerKey),
    database.prepare(`INSERT INTO domain_event_audits (event_id, consumer_key, action, prior_status, next_status, detail)
      VALUES (?, ?, 'Consumer Reconciled', 'Pending', 'Succeeded', ?)`).bind(eventId, consumerKey, JSON.stringify(result)),
  ]);
}

export async function recordCompletedWorkflowHandoff(database: DomainEventDatabase, input: {
  workflowId: string;
  eventId: string;
  aggregateType: string;
  aggregateId: string;
  projectId?: string;
  actorName: string;
  actorEmail: string;
  payload: Record<string, unknown>;
  occurredAt?: string;
}) {
  const contract = workflowReconciliationContract(input.workflowId);
  if (!contract || contract.eventTypes.length !== 1) throw new Error(`Unknown Or Ambiguous Workflow Reconciliation Contract ${input.workflowId}`);
  const occurredAt = input.occurredAt || new Date().toISOString();
  await ensureDomainOutboxSchema(database);
  await database.batch(domainEventStatements(database, {
    id: input.eventId,
    idempotencyKey: input.eventId,
    eventType: contract.eventTypes[0],
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    projectId: input.projectId,
    actorName: input.actorName,
    actorEmail: input.actorEmail,
    occurredAt,
    payload: input.payload,
    consumers: contract.mandatoryConsumers.map((key) => ({ key, completedInSourceTransaction: true, result: { reconciledAt: occurredAt, aggregateId: input.aggregateId } })),
  }));
  return reconcileDomainEvent(database, input.eventId, new Date(occurredAt));
}

export function deriveDomainEventStatus(consumers: Array<{ mandatory: boolean; status: string }>): DomainEventStatus {
  const mandatory = consumers.filter((consumer) => consumer.mandatory);
  if (mandatory.length > 0 && mandatory.every((consumer) => consumer.status === "Succeeded")) return "Completed";
  if (consumers.some((consumer) => consumer.status === "Succeeded")) return "Partially Applied";
  return "Pending";
}

export function retryDelaySeconds(attemptCount: number) {
  return Math.min(900, Math.max(15, 15 * 2 ** Math.max(0, attemptCount - 1)));
}

export async function reconcileDomainEvent(database: DomainEventDatabase, eventId: string, now = new Date()) {
  await ensureDomainOutboxSchema(database);
  const event = await database.prepare("SELECT id, event_type, payload_json, status, project_id, aggregate_id FROM domain_events WHERE id = ?")
    .bind(eventId).first<EventRow>();
  if (!event) return null;
  const payload = parsePayload(event.payload_json);
  const result = await database.prepare(`SELECT consumer_key, mandatory, status, attempt_count, next_attempt_at, result_json, last_error
    FROM domain_event_consumers WHERE event_id = ? ORDER BY consumer_key`).bind(eventId).all<ConsumerRow>();
  for (const consumer of result.results || []) {
    if (consumer.status === "Succeeded" || consumer.attempt_count >= DOMAIN_EVENT_MAX_ATTEMPTS) continue;
    if (consumer.next_attempt_at && consumer.next_attempt_at > now.toISOString()) continue;
    await runConsumer(database, event, consumer, payload, now);
  }
  return finalizeDomainEvent(database, eventId, now);
}

export async function reconcileDomainOutbox(database: DomainEventDatabase, now = new Date()) {
  await ensureDomainOutboxSchema(database);
  const rows = await database.prepare(`SELECT id FROM domain_events
    WHERE status <> 'Completed' ORDER BY occurred_at ASC LIMIT 25`).all<{ id: string }>();
  const results = [];
  for (const row of rows.results || []) {
    const result = await reconcileDomainEvent(database, row.id, now);
    if (result) results.push(result);
  }
  const unresolved = results.filter((result) => result.status === "Partially Applied" && result.exhaustedMandatoryConsumers.length > 0);
  for (const event of unresolved) await createOutboxExceptionWork(database, event, now);
  return {
    inspected: rows.results?.length || 0,
    completed: results.filter((result) => result.status === "Completed").length,
    partiallyApplied: results.filter((result) => result.status === "Partially Applied").length,
    unresolved: unresolved.length,
  };
}

export async function loadDomainOutboxSnapshot(database?: DomainEventDatabase) {
  const db = database || (await import("cloudflare:workers")).env.DB;
  await ensureDomainOutboxSchema(db);
  const [counts, consumers, recent] = await Promise.all([
    db.prepare(`SELECT status, count(*) AS count FROM domain_events GROUP BY status`).all<{ status: string; count: number }>(),
    db.prepare(`SELECT
      sum(CASE WHEN mandatory = 1 AND status <> 'Succeeded' THEN 1 ELSE 0 END) AS incomplete_mandatory,
      sum(CASE WHEN mandatory = 1 AND status <> 'Succeeded' AND attempt_count >= ? THEN 1 ELSE 0 END) AS exhausted_mandatory
      FROM domain_event_consumers`).bind(DOMAIN_EVENT_MAX_ATTEMPTS).first<{ incomplete_mandatory: number; exhausted_mandatory: number }>(),
    db.prepare(`SELECT e.id, e.event_type, e.aggregate_type, e.aggregate_id, e.project_id, e.status, e.occurred_at, e.completed_at,
      count(c.id) AS consumer_count,
      sum(CASE WHEN c.status = 'Succeeded' THEN 1 ELSE 0 END) AS succeeded_consumers
      FROM domain_events e LEFT JOIN domain_event_consumers c ON c.event_id = e.id
      GROUP BY e.id ORDER BY e.occurred_at DESC LIMIT 25`).all<Record<string, string | number>>(),
  ]);
  const byStatus = Object.fromEntries((counts.results || []).map((row) => [row.status, Number(row.count || 0)]));
  const exhaustedMandatory = Number(consumers?.exhausted_mandatory || 0);
  const incompleteMandatory = Number(consumers?.incomplete_mandatory || 0);
  return {
    status: exhaustedMandatory > 0 ? "Failed" : incompleteMandatory > 0 ? "Reconciliation Required" : "Healthy",
    total: Object.values(byStatus).reduce((sum, value) => sum + Number(value || 0), 0),
    completed: Number(byStatus.Completed || 0),
    partiallyApplied: Number(byStatus["Partially Applied"] || 0),
    pending: Number(byStatus.Pending || 0),
    incompleteMandatory,
    exhaustedMandatory,
    maxAttempts: DOMAIN_EVENT_MAX_ATTEMPTS,
    recent: recent.results || [],
    truthRule: "A cross-module handoff is Complete only when every mandatory consumer has a Succeeded result in the permanent ledger.",
  };
}

async function runConsumer(
  database: DomainEventDatabase,
  event: EventRow,
  consumer: ConsumerRow,
  payload: Record<string, unknown>,
  now: Date,
) {
  const leaseToken = crypto.randomUUID();
  const nowIso = now.toISOString();
  const leaseExpiresAt = new Date(now.getTime() + DOMAIN_EVENT_LEASE_MINUTES * 60_000).toISOString();
  await database.prepare(`UPDATE domain_event_consumers
    SET status = 'Processing', attempt_count = attempt_count + 1, lease_token = ?, lease_expires_at = ?, last_attempt_at = ?, updated_at = ?
    WHERE event_id = ? AND consumer_key = ? AND status <> 'Succeeded'
      AND (lease_expires_at = '' OR lease_expires_at <= ?) AND (next_attempt_at = '' OR next_attempt_at <= ?)`)
    .bind(leaseToken, leaseExpiresAt, nowIso, nowIso, event.id, consumer.consumer_key, nowIso, nowIso).run();
  const lease = await database.prepare(`SELECT lease_token FROM domain_event_consumers WHERE event_id = ? AND consumer_key = ?`)
    .bind(event.id, consumer.consumer_key).first<{ lease_token: string }>();
  if (lease?.lease_token !== leaseToken) return;
  try {
    const output = await executeRegisteredConsumer(event.event_type, consumer.consumer_key, payload);
    await database.batch([
      database.prepare(`UPDATE domain_event_consumers SET status = 'Succeeded', result_json = ?, last_error = '', lease_token = '', lease_expires_at = '', next_attempt_at = '', completed_at = ?, updated_at = ?
        WHERE event_id = ? AND consumer_key = ? AND lease_token = ?`)
        .bind(JSON.stringify(output || {}), nowIso, nowIso, event.id, consumer.consumer_key, leaseToken),
      database.prepare(`INSERT INTO domain_event_audits (event_id, consumer_key, action, prior_status, next_status, detail)
        VALUES (?, ?, 'Consumer Reconciled', ?, 'Succeeded', ?)`)
        .bind(event.id, consumer.consumer_key, consumer.status, summarizeResult(output)),
    ]);
  } catch (error) {
    const message = safeError(error);
    const nextAttemptAt = new Date(now.getTime() + retryDelaySeconds(consumer.attempt_count + 1) * 1000).toISOString();
    await database.batch([
      database.prepare(`UPDATE domain_event_consumers SET status = 'Failed', last_error = ?, lease_token = '', lease_expires_at = '', next_attempt_at = ?, updated_at = ?
        WHERE event_id = ? AND consumer_key = ? AND lease_token = ?`)
        .bind(message, nextAttemptAt, nowIso, event.id, consumer.consumer_key, leaseToken),
      database.prepare(`INSERT INTO domain_event_audits (event_id, consumer_key, action, prior_status, next_status, detail)
        VALUES (?, ?, 'Consumer Failed', ?, 'Failed', ?)`)
        .bind(event.id, consumer.consumer_key, consumer.status, message),
    ]);
  }
}

async function executeRegisteredConsumer(eventType: string, consumerKey: string, payload: Record<string, unknown>) {
  if (consumerKey === "sales-turnover-meeting" && eventType === "sales.estimating-requested") {
    const { ensureTurnoverMeeting } = await import("./turnover-server");
    return ensureTurnoverMeeting("Sales To Estimating Turnover", textValue(payload.opportunityId));
  }
  if (consumerKey === "operations-turnover-meeting" && eventType === "estimate.awarded") {
    const { ensureTurnoverMeeting } = await import("./turnover-server");
    return ensureTurnoverMeeting("Estimating To Operations Turnover", textValue(objectValue(payload, "estimate").entityId), textValue(objectValue(payload, "project").entityId));
  }
  if (eventType !== "estimate.awarded" || !["sharepoint-estimate-workspace", "sharepoint-project-workspace"].includes(consumerKey)) {
    throw new Error(`No Registered Consumer For ${eventType}:${consumerKey}`);
  }
  const target = objectValue(payload, consumerKey === "sharepoint-estimate-workspace" ? "estimate" : "project");
  const { registerSharePointWorkspace } = await import("./sharepoint-storage");
  return registerSharePointWorkspace({
    entityType: consumerKey === "sharepoint-estimate-workspace" ? "Estimate" : "Project",
    entityId: textValue(target.entityId),
    displayName: textValue(target.displayName),
    sourceProjectId: textValue(target.sourceProjectId),
    sourceRecordId: textValue(target.sourceRecordId),
    actorName: textValue(payload.actorName) || "Domain Event Reconciliation",
    actorEmail: textValue(payload.actorEmail),
  });
}

async function finalizeDomainEvent(database: DomainEventDatabase, eventId: string, now: Date) {
  const rows = await database.prepare(`SELECT consumer_key, mandatory, status, attempt_count, next_attempt_at, result_json, last_error
    FROM domain_event_consumers WHERE event_id = ? ORDER BY consumer_key`).bind(eventId).all<ConsumerRow>();
  const consumers = rows.results || [];
  const status = deriveDomainEventStatus(consumers.map((consumer) => ({ mandatory: consumer.mandatory === 1, status: consumer.status })));
  const nowIso = now.toISOString();
  const previous = await database.prepare("SELECT status FROM domain_events WHERE id = ?").bind(eventId).first<{ status: string }>();
  await database.batch([
    database.prepare(`UPDATE domain_events SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?`)
      .bind(status, status === "Completed" ? nowIso : "", nowIso, eventId),
    database.prepare(`INSERT INTO domain_event_audits (event_id, action, prior_status, next_status, detail)
      VALUES (?, 'Event Reconciled', ?, ?, ?)`)
      .bind(eventId, previous?.status || "Pending", status, `${consumers.filter((consumer) => consumer.status === "Succeeded").length}/${consumers.length} consumers succeeded`),
  ]);
  return {
    eventId,
    status,
    consumers: consumers.map((consumer) => ({
      key: consumer.consumer_key,
      mandatory: consumer.mandatory === 1,
      status: consumer.status,
      attempts: consumer.attempt_count,
      result: parsePayload(consumer.result_json),
      error: consumer.last_error,
    })),
    exhaustedMandatoryConsumers: consumers
      .filter((consumer) => consumer.mandatory === 1 && consumer.status !== "Succeeded" && consumer.attempt_count >= DOMAIN_EVENT_MAX_ATTEMPTS)
      .map((consumer) => consumer.consumer_key),
  };
}

async function createOutboxExceptionWork(
  database: DomainEventDatabase,
  event: Awaited<ReturnType<typeof finalizeDomainEvent>>,
  now: Date,
) {
  try {
    await ensureMyWorkTables();
    const recipients = await database.prepare(`SELECT display_name, email FROM company_members
      WHERE active = 1 AND (company_access_level IN ('Company Owner', 'Administrator') OR lower(email) = 'it@meffcon.com' OR designations_json LIKE '%IT Administrator%')`)
      .all<{ display_name: string; email: string }>();
    const { getDb } = await import("../db");
    const db = getDb();
    for (const recipient of recipients.results || []) {
      await upsertWorkItem(db, {
        dedupeKey: `domain-event:${event.eventId}:${recipient.email.toLowerCase()}`,
        projectId: "MEFFORD-COMPANY",
        recipientName: recipient.display_name,
        recipientEmail: recipient.email.toLowerCase(),
        kind: "Cross-Module Reconciliation",
        title: "Mandatory Handoff Is Partially Applied",
        message: `${event.exhaustedMandatoryConsumers.join(", ")} did not reconcile after ${DOMAIN_EVENT_MAX_ATTEMPTS} attempts. The source action remains preserved and must not be represented as a complete handoff.`,
        priority: "Critical",
        sourceType: "Domain Event",
        sourceRecordId: event.eventId,
        actionTarget: "IT & Integrations",
        dueAt: now.toISOString(),
        createdBy: "Domain Event Reconciliation",
      });
    }
  } catch (error) {
    console.error("Domain event exception work could not be created", safeError(error));
  }
}

function uniqueConsumers(consumers: DomainConsumerInput[]) {
  const seen = new Set<string>();
  return consumers.filter((consumer) => {
    const key = consumer.key.trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    consumer.key = key;
    return true;
  });
}

function parsePayload(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function objectValue(value: Record<string, unknown>, key: string) {
  const selected = value[key];
  return selected && typeof selected === "object" && !Array.isArray(selected) ? selected as Record<string, unknown> : {};
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 500) : "";
}

function summarizeResult(value: unknown) {
  try {
    return JSON.stringify(value || {}).slice(0, 600);
  } catch {
    return "Consumer completed with a non-serializable result";
  }
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Domain Consumer Failed";
  return message.replace(/[\r\n\t]+/g, " ").slice(0, 600);
}
