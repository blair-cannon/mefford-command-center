export type CountdownProject = {
  number: string;
  name: string;
  site: string;
  status: string;
  substantialDate: string;
  finalDate: string;
  timeZone: string;
};

export type CountdownState = {
  status: "counting" | "overdue" | "complete" | "cancelled" | "missing";
  days: number;
  hours: number;
  minutes: number;
  deadline: number | null;
};

const zoneCache = new Map<string, string>();
const deadlineCache = new Map<string, number | null>();

export function countdownTimeZone(value?: string) {
  const input = value || "America/New_York";
  const cached = zoneCache.get(input);
  if (cached) return cached;
  let zone = input;
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(); }
  catch { zone = "America/New_York"; }
  if (zoneCache.size > 100) zoneCache.clear();
  zoneCache.set(input, zone);
  return zone;
}

// Project dates have no time field. A deadline is the end of that date in the
// project's time zone, including the offset on that date (not today's offset).
export function completionDeadline(date: string, timeZone?: string): number | null {
  const zone = countdownTimeZone(timeZone);
  const key = `${date}|${zone}`;
  if (deadlineCache.has(key)) return deadlineCache.get(key)!;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const dayStart = Date.UTC(year, month - 1, day);
  if (new Date(dayStart).toISOString().slice(0, 10) !== date) return null;
  const wallTime = dayStart + 86_400_000;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  let instant = wallTime;
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = Object.fromEntries(formatter.formatToParts(instant).map(part => [part.type, part.value]));
    const local = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    const adjustment = wallTime - local;
    instant += adjustment;
    if (!adjustment) break;
  }
  const deadline = instant - 1;
  if (deadlineCache.size > 2_000) deadlineCache.clear();
  deadlineCache.set(key, deadline);
  return deadline;
}

export function projectCountdown(project: CountdownProject, milestone: "substantial" | "final", now: number): CountdownState {
  const deadline = completionDeadline(milestone === "substantial" ? project.substantialDate : project.finalDate, project.timeZone);
  const base = { days: 0, hours: 0, minutes: 0, deadline };
  if (project.status === "Completed") return { ...base, status: "complete" };
  if (project.status === "Cancelled") return { ...base, status: "cancelled" };
  if (deadline === null) return { ...base, status: "missing" };
  const overdue = now > deadline;
  const totalMinutes = Math.floor(Math.abs(deadline - now) / 60_000);
  return {
    deadline, status: overdue ? "overdue" : "counting",
    days: Math.floor(totalMinutes / 1_440),
    hours: Math.floor(totalMinutes % 1_440 / 60), minutes: totalMinutes % 60,
  };
}

export function countdownProjects<T extends CountdownProject>(projects: T[]) {
  const deadline = (project: T) => project.status === "Completed" ? Infinity : Math.min(
    completionDeadline(project.substantialDate, project.timeZone) ?? Infinity,
    completionDeadline(project.finalDate, project.timeZone) ?? Infinity,
  );
  return projects.filter(project => project.status !== "Cancelled").sort((a, b) => Number(a.status === "Completed") - Number(b.status === "Completed") || deadline(a) - deadline(b) || a.name.localeCompare(b.name));
}

export function completionDateLabel(deadline: number | null, timeZone: string, includeTime = false) {
  if (deadline === null) return "Date Not Set";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: countdownTimeZone(timeZone), month: "short", day: "numeric", year: "numeric",
    ...(includeTime ? { hour: "numeric" as const, minute: "2-digit" as const, timeZoneName: "short" as const } : {}),
  }).format(deadline);
}
