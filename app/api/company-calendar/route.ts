import { and, eq } from "drizzle-orm";
import {
  commandRecords,
  meetingOccurrences,
  meetingSeries,
  projects,
} from "../../../db/schema";
import { enforceOnboardingAccess, PEOPLE_PROJECT_ID } from "../../../lib/onboarding";
import { resolveCommandActor } from "../../../lib/server-actor";

const COMPANY_PROJECT_ID = "MEFFORD-COMPANY";
const SALES_PROJECT_ID = "MEFFORD-SALES";
const EVENT_RECORD_TYPE = "Company Calendar Events";

type CalendarEvent = {
  id: string;
  title: string;
  date: string;
  time?: string;
  category: "Estimating" | "People" | "Projects" | "Meetings" | "Company" | "Sales";
  owner: string;
  projectId?: string;
  source: string;
  annual?: boolean;
  notes?: string;
};

type CalendarPayload = {
  action?: "create" | "delete";
  id?: string;
  title?: string;
  date?: string;
  time?: string;
  category?: CalendarEvent["category"];
  owner?: string;
  annual?: boolean;
  notes?: string;
};

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;

  try {
    const db = await calendarDatabase();
    const [salesRows, peopleRows, customRows, projectRows, seriesRows, occurrenceRows, outlookRows] = await Promise.all([
      db.select().from(commandRecords).where(and(eq(commandRecords.projectId, SALES_PROJECT_ID), eq(commandRecords.recordType, "Sales Opportunities"))),
      db.select().from(commandRecords).where(and(eq(commandRecords.projectId, PEOPLE_PROJECT_ID), eq(commandRecords.recordType, "Employee Onboarding"))),
      db.select().from(commandRecords).where(and(eq(commandRecords.projectId, COMPANY_PROJECT_ID), eq(commandRecords.recordType, EVENT_RECORD_TYPE))),
      db.select().from(projects),
      db.select().from(meetingSeries),
      db.select().from(meetingOccurrences),
      db.select().from(commandRecords).where(and(eq(commandRecords.projectId, COMPANY_PROJECT_ID), eq(commandRecords.id, "INTEGRATION-MICROSOFT-MEETINGS"))).limit(1),
    ]);

    const events: CalendarEvent[] = [];
    for (const row of salesRows) {
      const data = parseData(row.dataJson);
      const directEstimate = data.directEstimate === true;
      const released = Boolean(data.estimatingRequestedAt);
      const bidDueDate = textValue(data.bidDueDate);
      if (bidDueDate && (directEstimate || released)) events.push({
        id: `estimate-${row.id}`,
        title: `${row.title} · Estimate Due`,
        date: bidDueDate,
        category: "Estimating",
        owner: textValue(data.assignedEstimator) || row.owner,
        projectId: row.id,
        source: directEstimate ? "Direct Estimate" : "Sales Handoff",
      });
      const expectedAwardDate = textValue(data.expectedAwardDate);
      if (expectedAwardDate && !directEstimate) events.push({
        id: `award-${row.id}`,
        title: `${row.title} · Expected Award`,
        date: expectedAwardDate,
        category: "Sales",
        owner: textValue(data.assignedRep) || row.owner,
        projectId: row.id,
        source: "Sales Funnel",
      });
    }

    for (const row of peopleRows) {
      const data = parseData(row.dataJson);
      const name = textValue(data.name) || row.owner;
      const hireDate = textValue(data.hireDate);
      const birthDate = textValue(data.birthDate);
      if (hireDate) events.push({ id: `hire-${row.id}`, title: `${name} · Mefford Anniversary`, date: anniversaryDate(hireDate), category: "People", owner: name, source: "Employee Onboarding", annual: true });
      if (birthDate) events.push({ id: `birthday-${row.id}`, title: `${name} · Birthday`, date: anniversaryDate(birthDate), category: "People", owner: name, source: "Employee Onboarding", annual: true });
    }

    for (const project of projectRows) {
      const projectDates = [
        [project.startDate, "Project Start"],
        [project.substantialDate, "Substantial Completion"],
        [project.finalDate, "Final Completion"],
      ] as const;
      for (const [date, label] of projectDates) if (date) events.push({ id: `project-${project.number}-${label}`, title: `${project.number} · ${project.name} · ${label}`, date, category: "Projects", owner: project.projectManager, projectId: project.number, source: "Project Schedule" });
    }

    const seriesById = new Map(seriesRows.map((series) => [series.id, series]));
    for (const occurrence of occurrenceRows) {
      const series = seriesById.get(occurrence.seriesId);
      if (!series) continue;
      events.push({ id: `meeting-${occurrence.id}`, title: series.title, date: occurrence.scheduledStart.slice(0, 10), time: occurrence.scheduledStart.slice(11, 16), category: "Meetings", owner: series.leaderName, projectId: series.projectId, source: "Meeting Center" });
    }

    for (const row of customRows) {
      const data = parseData(row.dataJson);
      events.push({ id: row.id, title: row.title, date: row.recordDate || row.due, time: row.recordTime || undefined, category: validCategory(data.category) ? data.category : "Company", owner: row.owner, source: "Company Calendar", annual: data.annual === true, notes: textValue(data.notes) });
    }

    const outlookStatus = outlookRows[0]?.status || "Not Configured";
    return Response.json({
      events: events.filter((event) => /^\d{4}-\d{2}-\d{2}$/.test(event.date)).sort((a, b) => `${a.date}${a.time || ""}`.localeCompare(`${b.date}${b.time || ""}`)),
      outlook: {
        status: outlookStatus,
        synchronized: outlookStatus === "Connected",
        calendarName: "Mefford Contracting Master Calendar",
        boundary: outlookStatus === "Connected" ? "Outlook connection is healthy; connected meeting events retain their Microsoft evidence." : "Internal calendar is live. Outlook publishing remains held until Microsoft Outlook, Teams & Meeting Evidence is connected and tested.",
      },
    });
  } catch (error) {
    return calendarError(error);
  }
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  if (!["Company Owner", "Administrator"].includes(actor.accessLevel)) return Response.json({ error: "Company Owner Or Administrator Access Is Required" }, { status: 403 });

  try {
    const input = (await request.json()) as CalendarPayload;
    const db = await calendarDatabase();
    if (input.action === "delete") {
      if (!input.id?.startsWith("CAL-")) return Response.json({ error: "Select A Company Calendar Event" }, { status: 400 });
      await db.delete(commandRecords).where(and(eq(commandRecords.projectId, COMPANY_PROJECT_ID), eq(commandRecords.id, input.id)));
      return Response.json({ deleted: true });
    }
    if (!input.title?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(input.date || "") || !validCategory(input.category)) {
      return Response.json({ error: "Title Date And Category Are Required" }, { status: 400 });
    }
    const id = input.id?.startsWith("CAL-") ? input.id : `CAL-${crypto.randomUUID().toUpperCase()}`;
    const now = new Date().toISOString();
    await db.insert(commandRecords).values({
      projectId: COMPANY_PROJECT_ID,
      id,
      recordType: EVENT_RECORD_TYPE,
      title: input.title.trim(),
      owner: input.owner?.trim() || actor.name,
      due: input.date!,
      status: "Scheduled",
      meta: `${input.category} · ${input.annual ? "Annual" : "One Time"}`,
      recordDate: input.date!,
      recordTime: input.time?.trim() || null,
      dateLocked: true,
      dataJson: JSON.stringify({ category: input.category, annual: input.annual === true, notes: input.notes?.trim() || "", createdBy: actor.name }),
      updatedAt: now,
    }).onConflictDoUpdate({ target: [commandRecords.projectId, commandRecords.id], set: { title: input.title.trim(), owner: input.owner?.trim() || actor.name, due: input.date!, recordDate: input.date!, recordTime: input.time?.trim() || null, meta: `${input.category} · ${input.annual ? "Annual" : "One Time"}`, dataJson: JSON.stringify({ category: input.category, annual: input.annual === true, notes: input.notes?.trim() || "", updatedBy: actor.name }), updatedAt: now } });
    return Response.json({ saved: true, id }, { status: 201 });
  } catch (error) {
    return calendarError(error);
  }
}

async function calendarDatabase() {
  const { env } = await import("cloudflare:workers");
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS command_records (project_id text NOT NULL, id text NOT NULL, record_type text NOT NULL, title text NOT NULL, owner text NOT NULL, due text NOT NULL, status text NOT NULL, meta text DEFAULT '' NOT NULL, record_date text, record_time text, date_locked integer DEFAULT false NOT NULL, data_json text DEFAULT '{}' NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, PRIMARY KEY(project_id, id))`).run();
  const { getDb } = await import("../../../db");
  return getDb();
}

function parseData(value: string): Record<string, unknown> {
  try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; }
}
function textValue(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function anniversaryDate(value: string) { const currentYear = new Date().getFullYear(); return `${currentYear}-${value.slice(5, 10)}`; }
function validCategory(value: unknown): value is CalendarEvent["category"] { return ["Estimating", "People", "Projects", "Meetings", "Company", "Sales"].includes(String(value)); }
function calendarError(error: unknown) { console.error("company_calendar_failed", error); return Response.json({ error: "The Company Calendar Could Not Reach Permanent Storage" }, { status: 500 }); }
