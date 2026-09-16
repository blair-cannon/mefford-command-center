export type MicrosoftGraphNotification = {
  subscriptionId: string;
  clientState: string;
  changeType: "created" | "updated" | "deleted";
  resource: string;
  providerId: string;
};

type ActiveSubscription = {
  id: string;
  change_type: string;
  expiration_date_time: string;
  client_state_hash: string;
  status: string;
};

type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

export type MicrosoftWebhookSecurityEvent = {
  outcome: "Accepted" | "Rejected";
  reasonCode: string;
  sourceHash: string;
  requestId: string;
  detail: string;
  at: string;
};

export type MicrosoftWebhookStore = {
  consumeRateLimit: (sourceHash: string, now: Date) => Promise<RateLimitResult>;
  consumeValidationWindow: (nowIso: string, requestId: string) => Promise<{ id: string } | null>;
  findActiveSubscription: (id: string) => Promise<ActiveSubscription | null>;
  recordSecurityEvent: (event: MicrosoftWebhookSecurityEvent) => Promise<void>;
  acceptNotifications: (events: MicrosoftGraphNotification[], receivedAt: string) => Promise<void>;
};

type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  first: <T>() => Promise<T | null>;
  run: () => Promise<unknown>;
};

export type MicrosoftWebhookDatabase = {
  prepare: (query: string) => D1Statement;
  batch: (statements: D1Statement[]) => Promise<unknown>;
};

export type MicrosoftWebhookHealthSnapshot = {
  status: "Protected · Provider Evidence Observed" | "Protected · Awaiting Provider Evidence" | "Not Connected";
  activeSubscriptions: number;
  nextExpirationAt: string;
  lastValidNotificationAt: string;
  rejectedAttempts24h: number;
  rateLimitedAttempts24h: number;
  lastRejectedAt: string;
  lastRejectedReason: string;
  openValidationWindows: number;
  lastValidationAt: string;
  protection: string;
};

const MAX_BODY_BYTES = 256 * 1024;
const MAX_EVENTS_PER_REQUEST = 100;
const GLOBAL_REQUESTS_PER_MINUTE = 600;
const SOURCE_REQUESTS_PER_MINUTE = 120;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function handleMicrosoftWebhookRequest(input: {
  request: Request;
  clientState: string;
  store: MicrosoftWebhookStore;
  beforeAccept?: () => Promise<void>;
  now?: Date;
}) {
  const now = input.now || new Date();
  const nowIso = now.toISOString();
  const expected = input.clientState.trim();
  const requestId = clean(input.request.headers.get("cf-ray") || crypto.randomUUID(), 160) || crypto.randomUUID();
  const source = clean(input.request.headers.get("cf-connecting-ip") || "unavailable", 96);
  const sourceHash = await sha256(`${expected || "unconfigured"}:${source}`);
  const reject = async (status: number, reasonCode: string, message: string, detail = message, headers?: HeadersInit) => {
    try {
      await input.store.recordSecurityEvent({ outcome: "Rejected", reasonCode, sourceHash, requestId, detail: clean(detail, 800), at: nowIso });
    } catch {
      return jsonError(503, "Microsoft Graph Webhook Security Evidence Is Unavailable");
    }
    return jsonError(status, message, headers);
  };

  if (!expected) return reject(503, "Client State Missing", "Microsoft Graph Webhook Validation Is Not Configured");

  let rateLimit: RateLimitResult;
  try {
    rateLimit = await input.store.consumeRateLimit(sourceHash, now);
  } catch {
    return reject(503, "Rate Limit Evidence Unavailable", "Microsoft Graph Webhook Protection Is Unavailable");
  }
  if (!rateLimit.allowed) {
    return reject(429, "Rate Limit", "Microsoft Graph Webhook Request Limit Exceeded", "The protected webhook request limit was exceeded", { "Retry-After": String(rateLimit.retryAfterSeconds) });
  }

  const url = new URL(input.request.url);
  const validationToken = url.searchParams.get("validationToken");
  if (validationToken !== null) {
    if (!validValidationToken(validationToken)) return reject(400, "Invalid Validation Token", "Microsoft Graph Validation Token Is Invalid");
    let window: { id: string } | null;
    try {
      window = await input.store.consumeValidationWindow(nowIso, requestId);
    } catch {
      return reject(503, "Validation Window Evidence Unavailable", "Microsoft Graph Subscription Validation Is Unavailable");
    }
    if (!window) return reject(403, "Validation Window Closed", "No Authorized Microsoft Graph Subscription Validation Window Is Open");
    try {
      await input.store.recordSecurityEvent({ outcome: "Accepted", reasonCode: "Validation Handshake", sourceHash, requestId, detail: `Authorized subscription validation window ${window.id} was consumed`, at: nowIso });
    } catch {
      // The consumed validation-window row is already durable authorization evidence.
    }
    return new Response(validationToken, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }

  const contentType = input.request.headers.get("content-type") || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) return reject(415, "Unsupported Content Type", "Microsoft Graph Notification Content Type Must Be JSON");
  const declaredLength = Number(input.request.headers.get("content-length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return reject(413, "Payload Too Large", "Microsoft Graph Notification Payload Is Too Large");

  let raw = "";
  try {
    raw = await input.request.text();
  } catch {
    return reject(400, "Unreadable Payload", "Microsoft Graph Notification Payload Could Not Be Read");
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return reject(413, "Payload Too Large", "Microsoft Graph Notification Payload Is Too Large");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return reject(400, "Invalid JSON", "Microsoft Graph Notification Payload Is Invalid");
  }
  const normalized = normalizeNotificationPayload(parsed);
  if (!normalized.ok) return reject(400, normalized.reasonCode, normalized.message);

  const expectedHash = await sha256(expected);
  const subscriptions = new Map<string, ActiveSubscription>();
  for (const event of normalized.events) {
    if (!await secretsMatch(event.clientState, expected)) return reject(401, "Client State Mismatch", "Microsoft Graph Notification Validation Failed");
    let subscription = subscriptions.get(event.subscriptionId);
    if (!subscription) {
      try {
        subscription = await input.store.findActiveSubscription(event.subscriptionId) || undefined;
      } catch {
        return reject(503, "Subscription Evidence Unavailable", "Microsoft Graph Subscription Evidence Is Unavailable");
      }
      if (subscription) subscriptions.set(event.subscriptionId, subscription);
    }
    const allowedChanges = String(subscription?.change_type || "").toLowerCase().split(",").map((item) => item.trim());
    const expiration = new Date(subscription?.expiration_date_time || "").getTime();
    if (!subscription || subscription.status !== "Active" || subscription.client_state_hash !== expectedHash || !Number.isFinite(expiration) || expiration <= now.getTime() || !allowedChanges.includes(event.changeType)) {
      return reject(401, "Subscription Validation Failed", "Microsoft Graph Notification Validation Failed");
    }
  }

  const events = dedupeWithinRequest(normalized.events);
  try {
    if (input.beforeAccept) await input.beforeAccept();
    await input.store.acceptNotifications(events, nowIso);
  } catch {
    return reject(503, "Notification Evidence Write Failed", "Microsoft Graph Notification Evidence Could Not Be Recorded");
  }
  try {
    await input.store.recordSecurityEvent({ outcome: "Accepted", reasonCode: "Notification Accepted", sourceHash, requestId, detail: `${events.length} verified Microsoft Graph calendar notification event(s) accepted`, at: nowIso });
  } catch {
    // The accepted meeting-sync event and subscription timestamp are already durable provider evidence.
  }
  return new Response(null, { status: 202, headers: { "Cache-Control": "no-store" } });
}

export function createMicrosoftWebhookStore(db: MicrosoftWebhookDatabase): MicrosoftWebhookStore {
  return {
    async consumeRateLimit(sourceHash, now) {
      const windowStartedAt = Math.floor(now.getTime() / 60_000) * 60_000;
      const nowIso = now.toISOString();
      const global = await consumeBucket(db, `global:${windowStartedAt}`, "Global", "", windowStartedAt, GLOBAL_REQUESTS_PER_MINUTE, nowIso);
      if (!global.allowed) return global;
      return consumeBucket(db, `source:${sourceHash}:${windowStartedAt}`, "Source", sourceHash, windowStartedAt, SOURCE_REQUESTS_PER_MINUTE, nowIso);
    },
    async consumeValidationWindow(nowIso, requestId) {
      return db.prepare(`UPDATE microsoft_graph_webhook_validation_windows
        SET status = 'Validated', closed_at = ?, detail = ?
        WHERE id = (
          SELECT id FROM microsoft_graph_webhook_validation_windows
          WHERE status = 'Open' AND expires_at > ?
          ORDER BY opened_at DESC LIMIT 1
        ) AND status = 'Open'
        RETURNING id`)
        .bind(nowIso, `Microsoft Graph validation handshake accepted · request ${clean(requestId, 160)}`, nowIso)
        .first<{ id: string }>();
    },
    async findActiveSubscription(id) {
      return db.prepare(`SELECT id, change_type, expiration_date_time, client_state_hash, status FROM microsoft_graph_subscriptions WHERE id = ?`)
        .bind(id).first<ActiveSubscription>();
    },
    async recordSecurityEvent(event) {
      const minute = event.at.slice(0, 16);
      const id = await sha256(`${minute}|${event.outcome}|${event.reasonCode}|${event.sourceHash}`);
      await db.prepare(`INSERT INTO microsoft_graph_webhook_security_events
        (id, outcome, reason_code, source_hash, request_id, detail, occurrence_count, first_seen_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET request_id = excluded.request_id, detail = excluded.detail,
          occurrence_count = microsoft_graph_webhook_security_events.occurrence_count + 1,
          last_seen_at = excluded.last_seen_at`)
        .bind(id, event.outcome, clean(event.reasonCode, 100), event.sourceHash, clean(event.requestId, 160), clean(event.detail, 800), event.at, event.at).run();
    },
    async acceptNotifications(events, receivedAt) {
      const statements: D1Statement[] = [];
      const subscriptionIds = new Set<string>();
      for (const event of events) {
        const series = event.providerId
          ? await db.prepare(`SELECT id FROM meeting_series WHERE graph_event_id = ?`).bind(event.providerId).first<{ id: string }>()
          : null;
        statements.push(db.prepare(`INSERT INTO meeting_sync_events
          (id, series_id, occurrence_id, direction, event_type, status, provider_id, detail, created_at)
          VALUES (?, ?, '', 'Inbound', ?, 'Received', ?, ?, ?)`)
          .bind(crypto.randomUUID(), series?.id || "", `Outlook ${event.changeType}`, event.providerId, JSON.stringify({ subscriptionId: event.subscriptionId, resource: event.resource }), receivedAt));
        subscriptionIds.add(event.subscriptionId);
      }
      for (const subscriptionId of subscriptionIds) {
        statements.push(db.prepare(`UPDATE microsoft_graph_subscriptions SET last_notification_at = ?, updated_at = ? WHERE id = ?`)
          .bind(receivedAt, receivedAt, subscriptionId));
      }
      if (statements.length) await db.batch(statements);
    },
  };
}

export async function loadMicrosoftWebhookHealthSnapshot(database?: MicrosoftWebhookDatabase, now = new Date()): Promise<MicrosoftWebhookHealthSnapshot> {
  const db = database || await webhookDb();
  const nowIso = now.toISOString();
  const cutoff = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
  const [subscriptions, security, lastRejected, windows, lastValidation] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS active_count, MIN(expiration_date_time) AS next_expiration_at, MAX(NULLIF(last_notification_at, '')) AS last_notification_at
      FROM microsoft_graph_subscriptions WHERE status = 'Active' AND expiration_date_time > ?`).bind(nowIso).first<{ active_count: number; next_expiration_at: string | null; last_notification_at: string | null }>(),
    db.prepare(`SELECT
        COALESCE(SUM(CASE WHEN outcome = 'Rejected' THEN occurrence_count ELSE 0 END), 0) AS rejected_count,
        COALESCE(SUM(CASE WHEN outcome = 'Rejected' AND reason_code = 'Rate Limit' THEN occurrence_count ELSE 0 END), 0) AS rate_limited_count
      FROM microsoft_graph_webhook_security_events WHERE last_seen_at >= ?`).bind(cutoff).first<{ rejected_count: number; rate_limited_count: number }>(),
    db.prepare(`SELECT reason_code, last_seen_at FROM microsoft_graph_webhook_security_events WHERE outcome = 'Rejected' ORDER BY last_seen_at DESC LIMIT 1`).first<{ reason_code: string; last_seen_at: string }>(),
    db.prepare(`SELECT COUNT(*) AS open_count FROM microsoft_graph_webhook_validation_windows WHERE status = 'Open' AND expires_at > ?`).bind(nowIso).first<{ open_count: number }>(),
    db.prepare(`SELECT closed_at FROM microsoft_graph_webhook_validation_windows WHERE status = 'Validated' ORDER BY closed_at DESC LIMIT 1`).first<{ closed_at: string }>(),
  ]);
  const activeSubscriptions = Number(subscriptions?.active_count || 0);
  const lastValidNotificationAt = String(subscriptions?.last_notification_at || "");
  return {
    status: activeSubscriptions ? (lastValidNotificationAt ? "Protected · Provider Evidence Observed" : "Protected · Awaiting Provider Evidence") : "Not Connected",
    activeSubscriptions,
    nextExpirationAt: String(subscriptions?.next_expiration_at || ""),
    lastValidNotificationAt,
    rejectedAttempts24h: Number(security?.rejected_count || 0),
    rateLimitedAttempts24h: Number(security?.rate_limited_count || 0),
    lastRejectedAt: String(lastRejected?.last_seen_at || ""),
    lastRejectedReason: String(lastRejected?.reason_code || ""),
    openValidationWindows: Number(windows?.open_count || 0),
    lastValidationAt: String(lastValidation?.closed_at || ""),
    protection: "Fail-closed client state · known active subscription · strict calendar payload · 256 KB/100-event bounds · per-source and global rate limits · durable rejection evidence",
  };
}

export async function pruneMicrosoftWebhookRateLimits(database: MicrosoftWebhookDatabase, now = new Date()) {
  const cutoff = now.getTime() - 2 * 24 * 60 * 60_000;
  await database.prepare(`DELETE FROM microsoft_graph_webhook_rate_limits WHERE window_started_at < ?`).bind(cutoff).run();
  await database.prepare(`UPDATE microsoft_graph_webhook_validation_windows SET status = 'Expired', closed_at = ?, detail = 'Authorized subscription validation window expired without a handshake' WHERE status = 'Open' AND expires_at <= ?`)
    .bind(now.toISOString(), now.toISOString()).run();
}

async function consumeBucket(db: MicrosoftWebhookDatabase, bucketKey: string, scope: string, sourceHash: string, windowStartedAt: number, limit: number, nowIso: string): Promise<RateLimitResult> {
  const row = await db.prepare(`INSERT INTO microsoft_graph_webhook_rate_limits
    (bucket_key, scope, source_hash, window_started_at, request_count, blocked_count, updated_at)
    VALUES (?, ?, ?, ?, 1, 0, ?)
    ON CONFLICT(bucket_key) DO UPDATE SET request_count = microsoft_graph_webhook_rate_limits.request_count + 1, updated_at = excluded.updated_at
    RETURNING request_count`)
    .bind(bucketKey, scope, sourceHash, windowStartedAt, nowIso).first<{ request_count: number }>();
  const allowed = Number(row?.request_count || 0) <= limit;
  if (!allowed) await db.prepare(`UPDATE microsoft_graph_webhook_rate_limits SET blocked_count = blocked_count + 1, updated_at = ? WHERE bucket_key = ?`).bind(nowIso, bucketKey).run();
  return { allowed, retryAfterSeconds: Math.max(1, 60 - Math.floor((new Date(nowIso).getTime() - windowStartedAt) / 1_000)) };
}

function normalizeNotificationPayload(payload: unknown): { ok: true; events: MicrosoftGraphNotification[] } | { ok: false; reasonCode: string; message: string } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return invalid("Invalid Payload Shape", "Microsoft Graph Notification Payload Must Be An Object");
  const value = (payload as { value?: unknown }).value;
  if (!Array.isArray(value) || !value.length) return invalid("Events Missing", "Microsoft Graph Notification Events Are Required");
  if (value.length > MAX_EVENTS_PER_REQUEST) return invalid("Event Limit Exceeded", `Microsoft Graph Notification Payload Cannot Exceed ${MAX_EVENTS_PER_REQUEST} Events`);
  const events: MicrosoftGraphNotification[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return invalid("Invalid Event Shape", "Every Microsoft Graph Notification Event Must Be An Object");
    const event = candidate as Record<string, unknown>;
    const subscriptionId = typeof event.subscriptionId === "string" ? event.subscriptionId : "";
    const clientState = typeof event.clientState === "string" ? event.clientState : "";
    const changeType = typeof event.changeType === "string" ? event.changeType.toLowerCase() : "";
    const resource = typeof event.resource === "string" ? event.resource : "";
    const resourceData = event.resourceData;
    const providerIdValue = resourceData && typeof resourceData === "object" && !Array.isArray(resourceData)
      ? (resourceData as Record<string, unknown>).id
      : "";
    const providerId = typeof providerIdValue === "string" ? providerIdValue : "";
    if (!UUID.test(subscriptionId) || subscriptionId.length > 80 || hasControls(subscriptionId)) return invalid("Invalid Subscription ID", "Microsoft Graph Notification Subscription ID Is Invalid");
    if (!clientState || clientState.length > 255 || hasControls(clientState)) return invalid("Invalid Client State", "Microsoft Graph Notification Client State Is Invalid");
    if (!(["created", "updated", "deleted"] as const).includes(changeType as MicrosoftGraphNotification["changeType"])) return invalid("Invalid Change Type", "Microsoft Graph Notification Change Type Is Invalid");
    if (!validCalendarResource(resource)) return invalid("Invalid Resource", "Microsoft Graph Notification Resource Is Invalid");
    if (!providerId || providerId.length > 500 || hasControls(providerId)) return invalid("Resource ID Missing", "Microsoft Graph Notification Resource ID Is Required");
    if (event.tenantId !== undefined && (typeof event.tenantId !== "string" || event.tenantId.length > 80 || hasControls(event.tenantId) || !UUID.test(event.tenantId))) return invalid("Invalid Tenant ID", "Microsoft Graph Notification Tenant ID Is Invalid");
    events.push({ subscriptionId, clientState, changeType: changeType as MicrosoftGraphNotification["changeType"], resource, providerId });
  }
  return { ok: true, events };
}

function dedupeWithinRequest(events: MicrosoftGraphNotification[]) {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = `${event.subscriptionId}|${event.providerId}|${event.changeType}|${event.resource}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function validCalendarResource(value: string) {
  return Boolean(value) && value.length <= 1_000 && !hasControls(value) && !value.includes("..") && /(?:^|[/'(])events(?:[/'(]|$)/i.test(value);
}

function validValidationToken(value: string) {
  return value.length > 0 && value.length <= 1_024 && !hasControls(value);
}

function hasControls(value: string) {
  return /[\u0000-\u001F\u007F]/.test(value);
}

function invalid(reasonCode: string, message: string) {
  return { ok: false as const, reasonCode, message };
}

async function secretsMatch(received: string, expected: string) {
  const [left, right] = await Promise.all([sha256Bytes(received), sha256Bytes(expected)]);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) difference |= (left[index] || 0) ^ (right[index] || 0);
  return difference === 0;
}

async function sha256(value: string) {
  return [...await sha256Bytes(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Bytes(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

function clean(value: unknown, max: number) {
  return String(value || "").replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, max);
}

function jsonError(status: number, message: string, headers?: HeadersInit) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store", ...(headers || {}) } });
}

async function webhookDb() {
  const { env } = await import("cloudflare:workers");
  return (env as unknown as { DB: MicrosoftWebhookDatabase }).DB;
}
