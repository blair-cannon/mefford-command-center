export type ChangeOrderSchedule = {
  scheduleBasis: "calendar-days-v1";
  scheduleDays: number;
  priorSubstantialDate: string;
  priorFinalDate: string;
  newSubstantialDate: string;
  newFinalDate: string;
};

export function calendarDaysToAdd(value: unknown) {
  const days = Number(value ?? 0);
  if (!Number.isSafeInteger(days) || days < 0 || days > 36_500) {
    throw new Error("Enter A Whole Number Of Calendar Days Between 0 And 36,500.");
  }
  return days;
}

export function shiftCompletionDate(value: string, days: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Set Both Project Completion Dates Before Requesting Additional Days.");
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("The Project Completion Date Is Invalid.");
  date.setUTCDate(date.getUTCDate() + days);
  const result = date.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new Error("The Revised Completion Date Is Outside The Supported Calendar.");
  return result;
}

export function calculateChangeOrderSchedule(project: { substantialDate: string; finalDate: string }, value: unknown): ChangeOrderSchedule {
  const days = calendarDaysToAdd(value);
  return {
    scheduleBasis: "calendar-days-v1", scheduleDays: days,
    priorSubstantialDate: project.substantialDate, priorFinalDate: project.finalDate,
    newSubstantialDate: project.substantialDate || days ? shiftCompletionDate(project.substantialDate, days) : "",
    newFinalDate: project.finalDate || days ? shiftCompletionDate(project.finalDate, days) : "",
  };
}

export function releasedChangeOrderSchedule(data: Record<string, unknown>, project: { substantialDate: string; finalDate: string }) {
  const days = calendarDaysToAdd(data.scheduleDays);
  const priorSubstantialDate = String(data.priorSubstantialDate || (days && data.newSubstantialDate ? shiftCompletionDate(String(data.newSubstantialDate), -days) : project.substantialDate));
  const priorFinalDate = String(data.priorFinalDate || (days && data.newFinalDate ? shiftCompletionDate(String(data.newFinalDate), -days) : project.finalDate));
  const schedule = calculateChangeOrderSchedule({ substantialDate: priorSubstantialDate, finalDate: priorFinalDate }, days);
  if (String(data.newSubstantialDate || schedule.newSubstantialDate) !== schedule.newSubstantialDate || String(data.newFinalDate || schedule.newFinalDate) !== schedule.newFinalDate) {
    throw new Error("The Released Completion Dates Do Not Match The Approved Calendar Days. Reapprove The Change Order Before Execution.");
  }
  if (priorSubstantialDate !== project.substantialDate || priorFinalDate !== project.finalDate) {
    throw new Error("Project Completion Dates Have Changed Since Release. Review And Reapprove The Updated Dates Before Execution.");
  }
  return schedule;
}
