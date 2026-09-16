import { and, eq } from "drizzle-orm";
import { commandRecords, recordAudits } from "../../../../db/schema";
import {
  INTEGRATION_COMPANY_ID,
  INTEGRATION_EVENT_TYPE,
  MEFFORD_INTEGRATIONS,
  parseIntegrationData,
  safeIntegrationText,
  validIntegrationStatus,
} from "../../../../lib/integration-health";
import { reconcileIntegrationHealth } from "../route";

type WebhookPayload = {
  integrationKey?: string;
  status?: string;
  cause?: string;
  impact?: string;
  affectedProjectIds?: string[];
  providerEventId?: string;
  sourceCount?: number;
  importedCount?: number;
  skippedCount?: number;
  failedCount?: number;
  duplicatesPrevented?: number;
  sampleRecordIds?: string[];
};

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  const binding = env as unknown as Record<string, unknown>;
  const secret = String(binding.INTEGRATION_WEBHOOK_SECRET || "");
  const supplied = request.headers.get("authorization") || "";
  if (!secret) return Response.json({ error: "Integration Webhook Is Not Configured" }, { status: 503 });
  if (!constantTimeEqual(supplied, `Bearer ${secret}`)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const input = await request.json() as WebhookPayload;
    const definition = MEFFORD_INTEGRATIONS.find((item) => item.key === input.integrationKey);
    if (!definition || !validIntegrationStatus(input.status)) return Response.json({ error: "Valid Integration Key And Status Are Required" }, { status: 400 });
    const { getDb } = await import("../../../../db");
    const db = getDb();
    const id = `INTEGRATION-${definition.key.toUpperCase()}`;
    const row = (await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, INTEGRATION_COMPANY_ID), eq(commandRecords.id, id))).limit(1))[0];
    if (!row) return Response.json({ error: "Integration Must Be Registered Before Webhooks Are Accepted" }, { status: 409 });
    const now = new Date().toISOString();
    const current = parseIntegrationData(row.dataJson);
    const providerEventId = safeIntegrationText(input.providerEventId, 180);
    if (providerEventId && current.lastProviderEventId === providerEventId) return Response.json({ accepted: true, duplicatePrevented: true });
    const cause = safeIntegrationText(input.cause, 600);
    const impact = safeIntegrationText(input.impact, 600);
    const reconciliation = {
      sourceCount: whole(input.sourceCount),
      importedCount: whole(input.importedCount),
      skippedCount: whole(input.skippedCount),
      failedCount: whole(input.failedCount),
      duplicatesPrevented: whole(input.duplicatesPrevented),
      sampleRecordIds: (input.sampleRecordIds || []).slice(0, 10).map(mask).join(", "),
      recordedAt: now,
      recordedBy: "Verified Provider Webhook",
    };
    const next = {
      ...current,
      cause: input.status === "Connected" ? "" : cause,
      impact: input.status === "Connected" ? "No Known Operational Impact" : impact,
      affectedProjectIds: normalize(input.affectedProjectIds),
      lastCheckedAt: now,
      lastSuccessfulAt: input.status === "Connected" ? now : current.lastSuccessfulAt || "",
      lastProviderEventId: providerEventId,
      reconciliation,
      failureStartedAt: ["Failed", "Reauthorization Required"].includes(input.status) ? current.failureStartedAt || now : "",
    };
    await db.update(commandRecords).set({ status: input.status, meta: `${input.status} · ${cause || "Verified Provider Webhook"}`, dataJson: JSON.stringify(next), updatedAt: now }).where(and(eq(commandRecords.projectId, INTEGRATION_COMPANY_ID), eq(commandRecords.id, id)));
    const eventId = `INTEGRATION-EVENT-${crypto.randomUUID()}`;
    await db.insert(commandRecords).values({ projectId: INTEGRATION_COMPANY_ID, id: eventId, recordType: INTEGRATION_EVENT_TYPE, title: `${definition.name} · Provider Webhook`, owner: "Integration Health Engine", due: now.slice(0, 10), status: input.status, meta: `${row.status} → ${input.status} · ${providerEventId || "Verified Event"}`, recordDate: now.slice(0, 10), recordTime: now.slice(11, 16), dateLocked: true, dataJson: JSON.stringify({ integrationKey: definition.key, action: "Provider Webhook", oldValue: row.status, newValue: input.status, reason: cause || "Verified provider event", impact, reconciliation, providerEventId, at: now }), updatedAt: now });
    await db.insert(recordAudits).values({ projectId: INTEGRATION_COMPANY_ID, recordId: id, fieldName: "Provider Health Webhook", oldValue: row.status, newValue: input.status, reason: cause || "Verified provider event", actorName: "Integration Health Engine", actorEmail: "system@meffcon.com", summary: `Provider Health Webhook: ${row.status} → ${input.status}` });
    await reconcileIntegrationHealth();
    return Response.json({ accepted: true, duplicatePrevented: false, status: input.status });
  } catch (error) {
    console.error("Integration Webhook Error", error);
    return Response.json({ error: "Integration Webhook Could Not Be Processed" }, { status: 500 });
  }
}

function whole(value: unknown) { const number = Number(value || 0); return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0; }
function normalize(value: unknown) { return Array.isArray(value) ? [...new Set(value.map((item) => safeIntegrationText(item, 80)).filter(Boolean))] : []; }
function mask(value: unknown) { const text = safeIntegrationText(value, 100); return text.length > 8 ? `${text.slice(0, 4)}…${text.slice(-3)}` : text; }
function constantTimeEqual(left: string, right: string) { if (left.length !== right.length) return false; let result = 0; for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index); return result === 0; }
