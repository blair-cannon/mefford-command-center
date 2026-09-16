import { runCommandSchedulerCycle } from "../../../lib/command-scheduler";
import type { ScheduledD1Database } from "../../../lib/scheduled-operations";
import { resolveCommandActor } from "../../../lib/server-actor";

type HeartbeatStatement = {
  bind: (...values: unknown[]) => HeartbeatStatement;
  first: <T>() => Promise<T | null>;
  run: () => Promise<unknown>;
};

type HeartbeatDatabase = ScheduledD1Database & {
  prepare: (query: string) => HeartbeatStatement;
};

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const now = new Date();
  const bucket = fiveMinuteBucket(now);
  const token = crypto.randomUUID();
  const { env } = await import("cloudflare:workers");
  const db = (env as unknown as { DB: HeartbeatDatabase }).DB;
  await db.prepare(`INSERT OR IGNORE INTO automation_heartbeat_claims (bucket, token, actor_email, claimed_at) VALUES (?, ?, ?, ?)`)
    .bind(bucket.toISOString(), token, actor.email, now.toISOString()).run();
  const claim = await db.prepare(`SELECT token FROM automation_heartbeat_claims WHERE bucket = ?`).bind(bucket.toISOString()).first<{ token: string }>();
  if (claim?.token !== token) return noStore({ ran: false, reason: "This Five-Minute Automation Window Is Already Claimed" }, 202);
  await db.prepare(`DELETE FROM automation_heartbeat_claims WHERE claimed_at < ?`).bind(new Date(now.getTime() - 2 * 24 * 3_600_000).toISOString()).run();

  const result = await runCommandSchedulerCycle(db, {
    source: "Authenticated Session Fallback",
    scheduledAt: bucket,
    cron: "authenticated-session-fallback",
    now,
    timeBudgetMs: 6_000,
    maxGroups: 1,
  });
  return noStore({ ran: true, bucket: bucket.toISOString(), result });
}

function fiveMinuteBucket(value: Date) {
  const bucket = new Date(value);
  bucket.setUTCSeconds(0, 0);
  bucket.setUTCMinutes(Math.floor(bucket.getUTCMinutes() / 5) * 5);
  return bucket;
}

function noStore(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
