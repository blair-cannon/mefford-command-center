import { and, desc, eq } from "drizzle-orm";
import { commandRecords, companyMembers, projects, recordAudits } from "../../../db/schema";
import { enforceOnboardingAccess } from "../../../lib/onboarding";
import { resolveCommandActor } from "../../../lib/server-actor";

const ACCOUNTING_PROJECT_ID = "MEFFORD-ACCOUNTING";

type TimeEntry = {
  id?: string;
  date?: string;
  destination?: string;
  code?: string;
  description?: string;
  timeType?: "Regular" | "Overtime" | "PTO" | "Holiday";
  hours?: number;
  note?: string;
};

type TimePayload = {
  periodEnd?: string;
  status?: "Employee Draft" | "Employee Submitted";
  entries?: TimeEntry[];
};

export async function GET(request: Request) {
  const access = await employeeAccess(request);
  if ("response" in access) return access.response;
  try {
    const periods = payrollPeriods(new Date(), 8);
    const requested = new URL(request.url).searchParams.get("periodEnd") || periods[0].end;
    const period = periods.find((item) => item.end === requested);
    if (!period) return Response.json({ error: "Choose A Current Or Recent Payroll Period" }, { status: 400 });
    const { getDb } = await import("../../../db");
    const db = getDb();
    const recordId = employeeTimeId(access.actor.email, period.end);
    const [recordRows, projectRows] = await Promise.all([
      db.select().from(commandRecords).where(and(eq(commandRecords.projectId, ACCOUNTING_PROJECT_ID), eq(commandRecords.id, recordId))).limit(1),
      db.select({ number: projects.number, name: projects.name, status: projects.status }).from(projects).orderBy(desc(projects.updatedAt)),
    ]);
    const row = recordRows[0];
    const data = parse(row?.dataJson || "{}");
    return Response.json({
      employee: { name: access.actor.name, email: access.actor.email },
      periods,
      selectedPeriod: period,
      timesheet: row ? {
        id: row.id,
        status: row.status,
        updatedAt: row.updatedAt,
        entries: Array.isArray(data.entries) ? data.entries : [],
        totals: data.totals || totals([]),
      } : null,
      destinations: [
        { id: "Company Overhead", label: "Company Overhead" },
        ...projectRows.filter((project) => !/closed|completed|archived|cancelled|quarantine/i.test(project.status)).map((project) => ({ id: project.number, label: `${project.number} · ${project.name}` })),
      ],
      boundary: "Your submitted hours become an accounting-ready Paylocity report record. Command Center does not process payroll, taxes, or payments.",
    });
  } catch (error) {
    return Response.json({ error: message(error, "Employee Time Is Unavailable") }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const access = await employeeAccess(request);
  if ("response" in access) return access.response;
  try {
    const input = await request.json() as TimePayload;
    const periods = payrollPeriods(new Date(), 8);
    const period = periods.find((item) => item.end === input.periodEnd);
    if (!period) return Response.json({ error: "Choose A Current Or Recent Payroll Period" }, { status: 400 });
    const status = input.status === "Employee Submitted" ? "Employee Submitted" : "Employee Draft";
    const entries = normalizeEntries(input.entries || []);
    if (entries.length > 100) return Response.json({ error: "A Timesheet May Contain Up To 100 Lines" }, { status: 400 });
    if (status === "Employee Submitted" && !entries.length) return Response.json({ error: "Add At Least One Time Line Before Submitting" }, { status: 400 });
    const invalid = entries.find((entry) => entry.date < period.start || entry.date > period.end || !entry.destination || !entry.code || entry.hours <= 0 || entry.hours > 24);
    if (invalid) return Response.json({ error: "Every Line Needs A Date In The Period Destination Cost Code And 0.01 To 24 Hours" }, { status: 400 });
    const dailyHours = new Map<string, number>();
    for (const entry of entries) dailyHours.set(entry.date, (dailyHours.get(entry.date) || 0) + entry.hours);
    if ([...dailyHours.values()].some((hours) => hours > 24)) return Response.json({ error: "Total Time Cannot Exceed 24 Hours On A Single Date" }, { status: 400 });

    const { getDb } = await import("../../../db");
    const db = getDb();
    const id = employeeTimeId(access.actor.email, period.end);
    const destinations = await db.select({ number: projects.number, status: projects.status }).from(projects);
    const validDestinations = new Set(["Company Overhead", ...destinations.filter(project => !/closed|completed|archived|cancelled|quarantine/i.test(project.status)).map(project => project.number)]);
    if (entries.some(entry => !validDestinations.has(entry.destination))) return Response.json({ error: "Choose An Active Project Or Company Overhead For Every Time Line" }, { status: 400 });
    const existing = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, ACCOUNTING_PROJECT_ID), eq(commandRecords.id, id))).limit(1);
    if (existing[0] && !["Employee Draft", "Employee Submitted"].includes(existing[0].status)) {
      return Response.json({ error: "Accounting Has Taken Control Of This Payroll Period. Send A Correction Request To Accounting." }, { status: 409 });
    }
    const calculated = totals(entries);
    const allocations = allocationTotals(entries);
    const now = new Date().toISOString();
    const data = {
      payrollCompany: "Paylocity",
      periodStart: period.start,
      periodEnd: period.end,
      payDate: period.payDate,
      employee: access.actor.name,
      employeeEmail: access.actor.email,
      regularHours: calculated.regular,
      overtimeHours: calculated.overtime,
      ptoHours: calculated.pto,
      holidayHours: calculated.holiday,
      bonus: 0,
      reimbursement: 0,
      deduction: 0,
      entries,
      allocations,
      totals: calculated,
      source: "Employee Self-Service Time Entry",
      reportOnly: true,
      payrollProcessingDisabled: true,
      paymentExecutionDisabled: true,
      taxFilingDisabled: true,
      submittedAt: status === "Employee Submitted" ? now : "",
      preparedBy: access.actor.name,
      preparedByEmail: access.actor.email,
      preparedAt: now,
    };
    await db.batch([
      db.insert(commandRecords).values({
        projectId: ACCOUNTING_PROJECT_ID,
        id,
        recordType: "Payroll Report",
        title: `${access.actor.name} · ${period.start} Through ${period.end}`,
        owner: access.actor.name,
        due: period.payDate,
        status,
        meta: `Paylocity · ${calculated.total.toFixed(2)} Hours · Employee Entered`,
        recordDate: period.end,
        dateLocked: false,
        dataJson: JSON.stringify(data),
        updatedAt: now,
      }).onConflictDoUpdate({
        target: [commandRecords.projectId, commandRecords.id],
        set: { owner: access.actor.name, due: period.payDate, status, meta: `Paylocity · ${calculated.total.toFixed(2)} Hours · Employee Entered`, recordDate: period.end, dataJson: JSON.stringify(data), updatedAt: now },
      }),
      db.insert(recordAudits).values({
        projectId: ACCOUNTING_PROJECT_ID,
        recordId: id,
        fieldName: "Employee Time Entry",
        oldValue: existing[0]?.status || "New",
        newValue: status,
        reason: "Authenticated employee self-service time entry",
        actorName: access.actor.name,
        actorEmail: access.actor.email,
        summary: `${access.actor.name} ${status === "Employee Submitted" ? "submitted" : "saved"} ${calculated.total.toFixed(2)} hours for ${period.start} through ${period.end}. No payroll was processed.`,
        createdAt: now,
      }),
    ]);
    return Response.json({ saved: true, id, status, totals: calculated, notice: status === "Employee Submitted" ? "Time Submitted To Accounting." : "Time Draft Saved." });
  } catch (error) {
    return Response.json({ error: message(error, "Employee Time Could Not Be Saved") }, { status: 500 });
  }
}

async function employeeAccess(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return { response: Response.json({ error: "Authentication Required" }, { status: 401 }) };
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return { response: onboardingLock };
  const { getDb } = await import("../../../db");
  const rows = await getDb().select({ name: companyMembers.displayName, active: companyMembers.isActive }).from(companyMembers).where(eq(companyMembers.email, actor.email)).limit(1);
  if (!rows[0]?.active) return { response: Response.json({ error: "An Active Employee Record Is Required" }, { status: 403 }) };
  return { actor: { name: rows[0].name || actor.name, email: actor.email.toLowerCase() } };
}

function payrollPeriods(now: Date, count: number) {
  const periods: Array<{ start: string; end: string; payDate: string; label: string }> = [];
  const companyParts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  let anchor = new Date(Date.UTC(companyParts.year, companyParts.month - 1, companyParts.day));
  for (let index = 0; index < count; index += 1) {
    const year = anchor.getUTCFullYear();
    const month = anchor.getUTCMonth();
    const day = anchor.getUTCDate();
    const start = new Date(Date.UTC(year, month, day <= 15 ? 1 : 16));
    const end = day <= 15 ? new Date(Date.UTC(year, month, 15)) : new Date(Date.UTC(year, month + 1, 0));
    const pay = day <= 15 ? new Date(Date.UTC(year, month, 22)) : new Date(Date.UTC(year, month + 1, 7));
    const startValue = start.toISOString().slice(0, 10);
    const endValue = end.toISOString().slice(0, 10);
    periods.push({ start: startValue, end: endValue, payDate: pay.toISOString().slice(0, 10), label: `${shortDate(startValue)} – ${shortDate(endValue)} · Pay ${shortDate(pay.toISOString().slice(0, 10))}` });
    anchor = new Date(start.getTime() - 86_400_000);
  }
  return periods;
}

function normalizeEntries(entries: TimeEntry[]) {
  return entries.map((entry) => ({
    id: clean(entry.id, 80) || crypto.randomUUID(),
    date: clean(entry.date, 10),
    destination: clean(entry.destination, 100),
    code: clean(entry.code, 40),
    description: clean(entry.description, 160),
    timeType: ["Regular", "Overtime", "PTO", "Holiday"].includes(String(entry.timeType)) ? entry.timeType as NonNullable<TimeEntry["timeType"]> : "Regular",
    hours: Math.round(Math.max(0, Number(entry.hours || 0)) * 100) / 100,
    note: clean(entry.note, 300),
  })).filter((entry) => entry.date || entry.destination || entry.code || entry.hours || entry.note);
}

function totals(entries: ReturnType<typeof normalizeEntries>) {
  const value = { regular: 0, overtime: 0, pto: 0, holiday: 0, total: 0 };
  for (const entry of entries) {
    const key = entry.timeType === "Overtime" ? "overtime" : entry.timeType === "PTO" ? "pto" : entry.timeType === "Holiday" ? "holiday" : "regular";
    value[key] += entry.hours;
    value.total += entry.hours;
  }
  for (const key of Object.keys(value) as Array<keyof typeof value>) value[key] = Math.round(value[key] * 100) / 100;
  return value;
}

function allocationTotals(entries: ReturnType<typeof normalizeEntries>) {
  const grouped = new Map<string, { id: string; destination: string; code: string; description: string; hours: number }>();
  for (const entry of entries) {
    const key = `${entry.destination}|${entry.code}|${entry.description}`;
    const current = grouped.get(key) || { id: crypto.randomUUID(), destination: entry.destination, code: entry.code, description: entry.description || entry.timeType, hours: 0 };
    current.hours = Math.round((current.hours + entry.hours) * 100) / 100;
    grouped.set(key, current);
  }
  return [...grouped.values()];
}

function employeeTimeId(email: string, periodEnd: string) {
  return `EMPLOYEE-TIME-${email.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${periodEnd}`.slice(0, 180);
}

function shortDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return `${month}/${day}/${String(year).slice(-2)}`;
}

function parse(value: string) {
  try { const result = JSON.parse(value); return result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : {}; } catch { return {}; }
}

function clean(value: unknown, max: number) {
  return String(value || "").replace(/[\u0000-\u001F]/g, "").trim().slice(0, max);
}

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
