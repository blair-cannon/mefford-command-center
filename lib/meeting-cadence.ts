export const MEETING_CADENCES = ["Weekly", "Biweekly", "Monthly", "Quarterly", "As Needed", "One Time"] as const;
export class MeetingInputError extends Error { readonly status = 400; }
export function cadenceLabel(value: string) { return value === "Biweekly" ? "Every Two Weeks" : value; }
export function validMeetingCadence(value: unknown): value is typeof MEETING_CADENCES[number] {
  return MEETING_CADENCES.includes(value as typeof MEETING_CADENCES[number]);
}
function parts(value: string, timeZone: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new MeetingInputError("A Valid Meeting Date And Time Is Required");
  try {
    const values = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date).map(p => [p.type, p.value]));
    return [values.year, values.month, values.day, values.hour, values.minute, values.second].map(Number);
  } catch { throw new MeetingInputError("A Valid Meeting Time Zone Is Required"); }
}
export function meetingLocalDateTime(value: string, timeZone: string) {
  const [year, month, day, hour, minute, second] = parts(value, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}`;
}
export function meetingLocalInput(value: string, timeZone: string) { return meetingLocalDateTime(value, timeZone).slice(0, 16); }
export function meetingStartInstant(value: string, timeZone: string) {
  if (/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    parts(value, timeZone);
    return new Date(value).toISOString();
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw new MeetingInputError("A Valid Meeting Date And Time Is Required");
  const [year, month, day, hour, minute, second] = match.slice(1).map(v => Number(v || 0));
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  if (new Date(wall).toISOString().slice(0, 16) !== value.slice(0, 16)) throw new MeetingInputError("A Valid Meeting Date And Time Is Required");
  let instant = wall;
  for (let attempt = 0; attempt < 4; attempt++) {
    const [y, m, d, h, min, sec] = parts(new Date(instant).toISOString(), timeZone);
    const delta = wall - Date.UTC(y, m - 1, d, h, min, sec);
    if (!delta) return new Date(instant).toISOString();
    instant += delta;
  }
  throw new MeetingInputError("This Local Time Does Not Exist During The Daylight Saving Change. Choose Another Time");
}
export function nextMeetingStart(previous: string, cadence: string, timeZone: string, anchor = previous): string | null {
  if (!validMeetingCadence(cadence)) throw new MeetingInputError("Choose A Valid Meeting Frequency");
  if (cadence === "As Needed" || cadence === "One Time") return null;
  const [year, month, day, hour, minute, second] = parts(previous, timeZone);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (cadence === "Weekly" || cadence === "Biweekly") date.setUTCDate(day + (cadence === "Weekly" ? 7 : 14));
  else {
    const anchorDay = parts(anchor, timeZone)[2];
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + (cadence === "Quarterly" ? 3 : 1));
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(anchorDay, lastDay));
  }
  return meetingStartInstant(date.toISOString().slice(0, 19), timeZone);
}
