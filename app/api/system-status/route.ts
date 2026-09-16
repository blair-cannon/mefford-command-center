import { and, desc, eq } from "drizzle-orm";
import { commandRecords } from "../../../db/schema";
import { INTEGRATION_COMPANY_ID, INTEGRATION_MAINTENANCE_TYPE, parseIntegrationData } from "../../../lib/integration-health";
import { resolveCommandActor } from "../../../lib/server-actor";

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  try {
    const { getDb } = await import("../../../db");
    const db = getDb();
    const active = (await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, INTEGRATION_COMPANY_ID), eq(commandRecords.recordType, INTEGRATION_MAINTENANCE_TYPE), eq(commandRecords.status, "Active"))).orderBy(desc(commandRecords.updatedAt))).find((record) => parseIntegrationData(record.dataJson).integrationKey === "command-center-platform");
    return Response.json({
      status: active ? "Maintenance" : "Available",
      maintenance: active ? { id: active.id, title: active.title, expectedEndTime: String(parseIntegrationData(active.dataJson).expectedEndTime || "06:00"), reason: String(parseIntegrationData(active.dataJson).reason || "Scheduled system update"), startedAt: String(parseIntegrationData(active.dataJson).startedAt || active.updatedAt) } : null,
      checkedAt: new Date().toISOString(),
    });
  } catch {
    return Response.json(
      {
        status: "Degraded",
        maintenance: null,
        checkedAt: new Date().toISOString(),
        healthCheck: "Database Unavailable",
      },
      { status: 503 },
    );
  }
}
