const TERMINAL_STATUSES = new Set(["Succeeded", "Failed", "Timed Out", "Deferred", "Missed"]);

export function scheduleSlotAtOrBefore(value, intervalMinutes, offsetMinutes = 0) {
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(timestamp)) throw new TypeError("A valid scheduler timestamp is required");
  const intervalMs = Math.max(1, Number(intervalMinutes)) * 60_000;
  const offsetMs = Number(offsetMinutes || 0) * 60_000;
  return new Date(Math.floor((timestamp - offsetMs) / intervalMs) * intervalMs + offsetMs);
}

export function expectedScheduleSlots({ now, intervalMinutes, offsetMinutes = 0, windowMinutes = 1_440, graceMinutes = 0 }) {
  const end = scheduleSlotAtOrBefore(new Date(new Date(now).getTime() - Math.max(0, graceMinutes) * 60_000), intervalMinutes, offsetMinutes);
  const startExclusive = new Date(new Date(now).getTime() - Math.max(intervalMinutes, windowMinutes) * 60_000);
  const slots = [];
  for (let cursor = end; cursor > startExclusive; cursor = new Date(cursor.getTime() - intervalMinutes * 60_000)) {
    slots.push(cursor.toISOString());
  }
  return slots.reverse();
}

export function planRecoverySlots({
  now,
  intervalMinutes,
  offsetMinutes = 0,
  windowMinutes,
  graceMinutes = 0,
  catchUpLimit = 2,
  runs = [],
}) {
  const expected = expectedScheduleSlots({ now, intervalMinutes, offsetMinutes, windowMinutes, graceMinutes });
  const terminal = new Set(runs.filter((run) => TERMINAL_STATUSES.has(String(run.status))).map((run) => new Date(run.scheduledAt).toISOString()));
  const missing = expected.filter((slot) => !terminal.has(slot));
  const limit = Math.max(1, Math.floor(Number(catchUpLimit || 1)));
  if (missing.length <= limit) return { expected, missing, selected: missing, unrecovered: [] };
  const current = missing.at(-1);
  const oldest = missing.slice(0, Math.max(0, limit - 1));
  const selected = [...oldest, current].filter((slot, index, values) => slot && values.indexOf(slot) === index);
  const selectedSet = new Set(selected);
  return { expected, missing, selected, unrecovered: missing.filter((slot) => !selectedSet.has(slot)) };
}

export function schedulerEvidenceStatus({
  expectedRuns,
  terminalRuns,
  failedRuns = 0,
  timedOutRuns = 0,
  stuckRuns = 0,
  latestSuccessAgeMinutes = null,
  maxDelayMinutes,
  openGapSlots = 0,
}) {
  if (stuckRuns > 0 || timedOutRuns > 0 || failedRuns > 0) return "Failed";
  if (latestSuccessAgeMinutes === null) return "Awaiting First Run";
  if (latestSuccessAgeMinutes > maxDelayMinutes || terminalRuns < expectedRuns || openGapSlots > 0) return "Late";
  return "Healthy";
}

export function retryDelayMilliseconds(attempt, baseMilliseconds = 250, maximumMilliseconds = 2_000) {
  return Math.min(Math.max(0, maximumMilliseconds), Math.max(0, baseMilliseconds) * 2 ** Math.max(0, Number(attempt) - 1));
}

export { TERMINAL_STATUSES };
