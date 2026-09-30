export type DailyScheduleActivity = { id: string; title: string; trade: string; start: string; finish: string; progress: number };
export type DailyScheduleConfirmation = DailyScheduleActivity & { status: "Not Started" | "In Progress" | "Complete"; timing: "On Track" | "Delayed"; reason: string; completedDate: string; confirmedBy?: string; confirmedAt?: string };
type ScheduleRecord = { id: string; title: string; owner: string; status: string; recordDate?: string | null; data?: Record<string, unknown> };

export function dailyScheduleActivities(records: ScheduleRecord[], date: string): DailyScheduleActivity[] {
  return records.flatMap(record => {
    const data = record.data || {};
    const start = String(data.start || record.recordDate || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || start > date || record.status === "Cancelled") return [];
    const finishDate = new Date(`${start}T12:00:00Z`);
    if (Number.isNaN(finishDate.getTime())) return [];
    finishDate.setUTCDate(finishDate.getUTCDate() + Math.max(1, Math.round(Number(data.days) || 1)) - 1);
    const finish = finishDate.toISOString().slice(0, 10);
    const progress = Math.max(0, Math.min(100, Number(data.progress) || 0));
    if ((progress >= 100 || record.status === "Complete") && finish < date) return [];
    return [{ id: record.id, title: record.title, trade: String(data.trade || record.owner), start, finish, progress }];
  }).sort((a, b) => a.finish.localeCompare(b.finish) || a.title.localeCompare(b.title));
}

export function validateDailySchedule(activities: DailyScheduleActivity[], input: unknown, date: string) {
  const confirmations: DailyScheduleConfirmation[] = [];
  if (!Array.isArray(input)) return { error: "Confirm The Schedule Activities For This Log Date.", confirmations };
  if (input.length !== activities.length) return { error: "Review Every Activity For This Log Date.", confirmations };
  const seen = new Set<string>();
  for (const activity of activities) {
    const item = input.find(row => row && row.id === activity.id);
    if (!item || seen.has(item.id) || !["Not Started", "In Progress", "Complete"].includes(item.status) || !["On Track", "Delayed"].includes(item.timing)) return { error: `Confirm Progress And Timing For ${activity.title}.`, confirmations: [] };
    seen.add(item.id);
    const completedDate = item.status === "Complete" ? String(item.completedDate || date) : "";
    if (completedDate && (!/^\d{4}-\d{2}-\d{2}$/.test(completedDate) || completedDate > date || (Number.isNaN(new Date(`${completedDate}T12:00:00Z`).getTime()) || new Date(`${completedDate}T12:00:00Z`).toISOString().slice(0, 10) !== completedDate))) return { error: `Enter A Valid Completion Date For ${activity.title}.`, confirmations: [] };
    const behind = item.status === "Complete" ? completedDate > activity.finish : date > activity.finish || (item.status === "Not Started" && date > activity.start);
    const timing = behind ? "Delayed" : item.timing;
    const reason = String(item.reason || "").trim();
    if (timing === "Delayed" && !reason) return { error: `Add A Delay Reason For ${activity.title}.`, confirmations: [] };
    confirmations.push({ ...activity, status: item.status, timing, reason, completedDate });
  }
  return { error: "", confirmations };
}
