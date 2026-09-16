import { microsoftGraphRequest, microsoftMeetingConnection } from "./microsoft-graph";
import { pruneMicrosoftWebhookRateLimits } from "./microsoft-webhook-security";

type SubscriptionStatement = {
  bind: (...values: unknown[]) => SubscriptionStatement;
  first: <T>() => Promise<T | null>;
  run: () => Promise<unknown>;
};

type SubscriptionDatabase = {
  prepare: (query: string) => SubscriptionStatement;
  batch: (statements: SubscriptionStatement[]) => Promise<unknown>;
};

type SubscriptionRow = {
  id: string;
  resource: string;
  expiration_date_time: string;
  status: string;
};

type GraphSubscription = {
  id: string;
  resource?: string;
  changeType?: string;
  notificationUrl?: string;
  expirationDateTime?: string;
};

export async function ensureMicrosoftSubscriptionSchema(database?: SubscriptionDatabase) {
  const db = database || await subscriptionDb();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS microsoft_graph_subscriptions (
      id text PRIMARY KEY NOT NULL,
      resource text NOT NULL,
      change_type text NOT NULL,
      notification_url text NOT NULL,
      expiration_date_time text NOT NULL,
      client_state_hash text NOT NULL,
      status text NOT NULL DEFAULT 'Active',
      last_renewed_at text NOT NULL DEFAULT '',
      last_notification_at text NOT NULL DEFAULT '',
      error_message text NOT NULL DEFAULT '',
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS microsoft_graph_subscriptions_resource_idx ON microsoft_graph_subscriptions (resource)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS microsoft_graph_subscriptions_expiry_idx ON microsoft_graph_subscriptions (status, expiration_date_time)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS microsoft_graph_subscription_audits (
      id text PRIMARY KEY NOT NULL,
      subscription_id text NOT NULL,
      action text NOT NULL,
      status text NOT NULL,
      expiration_date_time text NOT NULL DEFAULT '',
      detail text NOT NULL DEFAULT '',
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS microsoft_graph_subscription_audits_subscription_idx ON microsoft_graph_subscription_audits (subscription_id, created_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS microsoft_graph_webhook_validation_windows (
      id text PRIMARY KEY NOT NULL,
      operation text NOT NULL,
      status text NOT NULL DEFAULT 'Open',
      opened_by text NOT NULL,
      opened_at text NOT NULL,
      expires_at text NOT NULL,
      closed_at text NOT NULL DEFAULT '',
      detail text NOT NULL DEFAULT ''
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS microsoft_graph_webhook_windows_status_idx ON microsoft_graph_webhook_validation_windows (status, expires_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS microsoft_graph_webhook_rate_limits (
      bucket_key text PRIMARY KEY NOT NULL,
      scope text NOT NULL,
      source_hash text NOT NULL DEFAULT '',
      window_started_at integer NOT NULL,
      request_count integer NOT NULL DEFAULT 0,
      blocked_count integer NOT NULL DEFAULT 0,
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS microsoft_graph_webhook_rate_window_idx ON microsoft_graph_webhook_rate_limits (window_started_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS microsoft_graph_webhook_security_events (
      id text PRIMARY KEY NOT NULL,
      outcome text NOT NULL,
      reason_code text NOT NULL,
      source_hash text NOT NULL DEFAULT '',
      request_id text NOT NULL DEFAULT '',
      detail text NOT NULL DEFAULT '',
      occurrence_count integer NOT NULL DEFAULT 1,
      first_seen_at text NOT NULL,
      last_seen_at text NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS microsoft_graph_webhook_security_outcome_idx ON microsoft_graph_webhook_security_events (outcome, last_seen_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS microsoft_graph_webhook_security_reason_idx ON microsoft_graph_webhook_security_events (reason_code, last_seen_at)`),
  ]);
}

export async function reconcileMicrosoftGraphSubscriptions(now = new Date()) {
  const meeting = await microsoftMeetingConnection();
  const { env } = await import("cloudflare:workers");
  const values = env as unknown as Record<string, unknown>;
  const notificationUrl = String(values.MICROSOFT_GRAPH_WEBHOOK_URL || "").trim();
  const clientState = String(values.MICROSOFT_GRAPH_WEBHOOK_CLIENT_STATE || "").trim();
  if (!meeting.configured || !notificationUrl || !clientState) {
    return {
      scheduledOutcome: "Deferred" as const,
      reason: "Microsoft meetings, webhook URL, and webhook validation secret must be configured before subscription renewal",
    };
  }
  const parsedUrl = new URL(notificationUrl);
  if (parsedUrl.protocol !== "https:") throw new Error("Microsoft Graph Webhook URL Must Use HTTPS");
  const db = await subscriptionDb();
  await ensureMicrosoftSubscriptionSchema(db);
  await pruneMicrosoftWebhookRateLimits(db, now);
  const resource = `users/${meeting.mailbox}/events`;
  const existing = await db.prepare(`SELECT id, resource, expiration_date_time, status FROM microsoft_graph_subscriptions WHERE resource = ?`)
    .bind(resource).first<SubscriptionRow>();
  const renewBefore = new Date(now.getTime() + 24 * 60 * 60_000);
  if (existing?.status === "Active" && new Date(existing.expiration_date_time) > renewBefore) {
    return { status: "Current" as const, subscriptionId: existing.id, expirationDateTime: existing.expiration_date_time };
  }
  const expirationDateTime = new Date(now.getTime() + 48 * 60 * 60_000).toISOString();
  const clientStateHash = await secretHash(clientState);
  try {
    let subscription: GraphSubscription | null = null;
    let action = "Created";
    if (existing?.id) {
      try {
        subscription = await microsoftGraphRequest<GraphSubscription>(`/subscriptions/${encodeURIComponent(existing.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ expirationDateTime }),
        });
        action = "Renewed";
      } catch (error) {
        if (!/404|not found|does not exist/i.test(safeError(error))) throw error;
      }
    }
    if (!subscription?.id) {
      const windowId = await openWebhookValidationWindow(db, now, existing ? "Recreate Calendar Subscription" : "Create Calendar Subscription");
      let creationSucceeded = false;
      try {
        subscription = await microsoftGraphRequest<GraphSubscription>("/subscriptions", {
          method: "POST",
          body: JSON.stringify({
            changeType: "created,updated,deleted",
            notificationUrl,
            resource,
            expirationDateTime,
            clientState,
            latestSupportedTlsVersion: "v1_2",
          }),
        });
        creationSucceeded = true;
      } finally {
        await closeWebhookValidationWindow(db, windowId, creationSucceeded ? "Subscription request completed" : "Subscription request failed before completion");
      }
      action = existing ? "Recreated" : "Created";
    }
    if (!subscription.id || !subscription.expirationDateTime) throw new Error("Microsoft Graph Did Not Return A Complete Subscription Receipt");
    const completedAt = new Date().toISOString();
    await db.batch([
      db.prepare(`DELETE FROM microsoft_graph_subscriptions WHERE resource = ? AND id <> ?`).bind(resource, subscription.id),
      db.prepare(`INSERT INTO microsoft_graph_subscriptions
        (id, resource, change_type, notification_url, expiration_date_time, client_state_hash, status, last_renewed_at, error_message, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'Active', ?, '', ?)
        ON CONFLICT(id) DO UPDATE SET resource = excluded.resource, change_type = excluded.change_type, notification_url = excluded.notification_url, expiration_date_time = excluded.expiration_date_time, client_state_hash = excluded.client_state_hash, status = 'Active', last_renewed_at = excluded.last_renewed_at, error_message = '', updated_at = excluded.updated_at`)
        .bind(subscription.id, resource, subscription.changeType || "created,updated,deleted", notificationUrl, subscription.expirationDateTime, clientStateHash, completedAt, completedAt),
      db.prepare(`INSERT INTO microsoft_graph_subscription_audits (id, subscription_id, action, status, expiration_date_time, detail, created_at) VALUES (?, ?, ?, 'Succeeded', ?, ?, ?)`)
        .bind(crypto.randomUUID(), subscription.id, action, subscription.expirationDateTime, "Microsoft Graph calendar notification subscription reconciled without storing the validation secret", completedAt),
    ]);
    return { status: action as "Created" | "Renewed" | "Recreated", subscriptionId: subscription.id, expirationDateTime: subscription.expirationDateTime };
  } catch (error) {
    const message = safeError(error);
    if (existing?.id) {
      const failedAt = new Date().toISOString();
      await db.batch([
        db.prepare(`UPDATE microsoft_graph_subscriptions SET status = 'Failed', error_message = ?, updated_at = ? WHERE id = ?`).bind(message, failedAt, existing.id),
        db.prepare(`INSERT INTO microsoft_graph_subscription_audits (id, subscription_id, action, status, expiration_date_time, detail, created_at) VALUES (?, ?, 'Renewal', 'Failed', ?, ?, ?)`)
          .bind(crypto.randomUUID(), existing.id, existing.expiration_date_time, message, failedAt),
      ]);
    }
    throw error;
  }
}

async function openWebhookValidationWindow(db: SubscriptionDatabase, now: Date, operation: string) {
  const id = crypto.randomUUID();
  const openedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 5 * 60_000).toISOString();
  await db.prepare(`INSERT INTO microsoft_graph_webhook_validation_windows
    (id, operation, status, opened_by, opened_at, expires_at, closed_at, detail)
    VALUES (?, ?, 'Open', 'Microsoft Subscription Reconciler', ?, ?, '', 'Awaiting Microsoft Graph validation handshake')`)
    .bind(id, operation, openedAt, expiresAt).run();
  return id;
}

async function closeWebhookValidationWindow(db: SubscriptionDatabase, id: string, detail: string) {
  const closedAt = new Date().toISOString();
  await db.prepare(`UPDATE microsoft_graph_webhook_validation_windows
    SET status = CASE WHEN status = 'Open' THEN 'Closed' ELSE status END,
      closed_at = CASE WHEN closed_at = '' THEN ? ELSE closed_at END,
      detail = CASE WHEN status = 'Validated' THEN detail ELSE ? END
    WHERE id = ?`)
    .bind(closedAt, detail, id).run();
}

async function subscriptionDb() {
  const { env } = await import("cloudflare:workers");
  return (env as unknown as { DB: SubscriptionDatabase }).DB;
}

async function secretHash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : String(error || "Unknown Microsoft subscription error"))
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 1_000);
}
