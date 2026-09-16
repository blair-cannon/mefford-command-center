import { and, eq } from "drizzle-orm";
import { commandRecords, recordAudits } from "../../../db/schema";
import { resolveCommandActor } from "../../../lib/server-actor";
import { enforceOnboardingAccess } from "../../../lib/onboarding";

const RECORD_TYPE = "Dashboard Preferences";
const TOOLS = ["Schedule", "Daily Log", "Toolbox Talk", "RFIs", "Submittals", "Change Orders", "Budget", "Project Files"] as const;
type Tool = (typeof TOOLS)[number];
type Input = { projectId?: string; orderedTools?: Tool[]; visibleTools?: Tool[] };

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  try {
    const projectId = new URL(request.url).searchParams.get("projectId")?.trim() || "";
    if (!projectId) return Response.json({ error: "Project Is Required" }, { status: 400 });
    const db = await database();
    const id = await preferenceId(actor.email);
    const row = (await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, id), eq(commandRecords.recordType, RECORD_TYPE))).limit(1))[0];
    const data = parse(row?.dataJson || "{}");
    return Response.json({ projectId, orderedTools: ordered(data.orderedTools), visibleTools: visible(data.visibleTools), saved: Boolean(row), updatedAt: row?.updatedAt || "" });
  } catch (error) { return preferenceError(error); }
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  try {
    const input = await request.json() as Input;
    const projectId = input.projectId?.trim() || "";
    if (!projectId) return Response.json({ error: "Project Is Required" }, { status: 400 });
    const nextOrder = ordered(input.orderedTools);
    const nextVisible = visible(input.visibleTools);
    if (!nextVisible.length) return Response.json({ error: "Keep At Least One Project Tool Visible" }, { status: 400 });
    const db = await database();
    const id = await preferenceId(actor.email);
    const prior = (await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, id))).limit(1))[0];
    const now = new Date().toISOString();
    const data = { orderedTools: nextOrder, visibleTools: nextVisible, userEmailHash: id.replace("DASH-PREF-", ""), savedBy: actor.name, savedAt: now };
    await db.insert(commandRecords).values({ projectId, id, recordType: RECORD_TYPE, title: `${actor.name} Project Tools`, owner: actor.name, due: "Personal Preference", status: "Active", meta: `${nextVisible.length} Visible · Personal To Signed-In User`, recordDate: now.slice(0, 10), dateLocked: false, dataJson: JSON.stringify(data), updatedAt: now }).onConflictDoUpdate({ target: [commandRecords.projectId, commandRecords.id], set: { title: `${actor.name} Project Tools`, owner: actor.name, status: "Active", meta: `${nextVisible.length} Visible · Personal To Signed-In User`, dataJson: JSON.stringify(data), updatedAt: now } });
    await db.insert(recordAudits).values({ projectId, recordId: id, fieldName: "Personal Dashboard Preferences", oldValue: prior?.meta || "Default Tool Layout", newValue: `${nextVisible.length} Visible Tools`, reason: "Signed-in user dashboard customization", actorName: actor.name, actorEmail: actor.email, summary: `${actor.name} saved a personal project tool order and visibility preference. No shared project record was changed.` });
    return Response.json({ saved: true, projectId, orderedTools: nextOrder, visibleTools: nextVisible, updatedAt: now, notice: "Personal Project Tool Layout Saved Permanently." });
  } catch (error) { return preferenceError(error); }
}

function ordered(value: unknown): Tool[] {
  const input = Array.isArray(value) ? value.filter((item): item is Tool => typeof item === "string" && TOOLS.includes(item as Tool)) : [];
  return [...new Set([...input, ...TOOLS])];
}
function visible(value: unknown): Tool[] {
  if (!Array.isArray(value)) return [...TOOLS];
  return [...new Set(value.filter((item): item is Tool => typeof item === "string" && TOOLS.includes(item as Tool)))];
}
async function preferenceId(email: string) { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.trim().toLowerCase())); return `DASH-PREF-${[...new Uint8Array(bytes)].slice(0, 12).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`; }
function parse(value: string) { try { const parsed = JSON.parse(value || "{}"); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {} as Record<string, unknown>; } }
async function database() { const { getDb } = await import("../../../db"); return getDb(); }
function preferenceError(error: unknown) { const message = error instanceof Error ? error.message : "Dashboard Preferences Are Unavailable"; console.error("dashboard preference error", error); return Response.json({ error: message }, { status: 500 }); }
