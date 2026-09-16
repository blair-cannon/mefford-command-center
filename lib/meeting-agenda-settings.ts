import { DEPARTMENT_MEETING_ROLES, MEETING_SECTIONS, type MeetingType } from "./meetings";
import type { AgendaRecord, AgendaSignal } from "./meeting-agenda";

export type AgendaSelection = { sections: string[]; metrics: string[]; scorecards: string[] };
export const DEPARTMENT_METRICS: Record<string, Array<{ id: string; title: string }>> = {
  "Sales To Estimating Turnover": [],
  "Estimating To Operations Turnover": [],
  "Sales/Estimating Department": [
    { id: "sales-awarded", title: "Signed Sales This Year" }, { id: "sales-bids", title: "Estimates Due" },
    { id: "sales-review", title: "Estimate And Proposal Reviews" }, { id: "sales-coverage", title: "Quote Coverage" }, { id: "sales-followup", title: "Sales Follow-Ups" },
  ],
  "Operations Department": [
    { id: "active-projects", title: "Active Contracted Projects" }, { id: "schedule-risks", title: "Schedule Creep" },
    { id: "lead-time-risks", title: "Lead-Time Issues" }, { id: "safety-open", title: "Open Safety Issues" }, { id: "quality-open", title: "Open Quality Issues" },
  ],
  "Accounting Department": [
    { id: "ar-overdue", title: "Overdue Owner Receivables" }, { id: "ap-open", title: "Open Payable Amount" },
    { id: "billing-approvals", title: "Billing Reviews" }, { id: "close-exceptions", title: "Close Tasks Due" },
  ],
};
export const isDepartmentMeeting = (type: unknown) => Boolean(DEPARTMENT_MEETING_ROLES[String(type) as MeetingType]);
export const scorecardKey = (record: Pick<AgendaRecord, "projectId" | "recordType" | "id">) => `${record.projectId}:${record.recordType}:${record.id}`;
export const isSelectableScorecard = (record: Pick<AgendaRecord, "projectId" | "recordType">) => record.projectId === "MEFFORD-COMPANY" && ["Scorecard", "Company Scorecard", "Scorecard Metrics", "Metrics"].includes(record.recordType);
export function agendaSettings(value: unknown): { agendaManagerEmails?: string[]; agendaSelection?: AgendaSelection; [key: string]: unknown } {
  try { const parsed = typeof value === "string" ? JSON.parse(value || "{}") : value; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
}
export function defaultAgendaSelection(type: MeetingType): AgendaSelection {
  return { sections: MEETING_SECTIONS[type].map(section => section.key), metrics: (DEPARTMENT_METRICS[type] || []).map(metric => metric.id), scorecards: [] };
}
export function selectedAgendaSources(type: MeetingType, access: unknown): AgendaSelection {
  const saved = agendaSettings(access).agendaSelection;
  return saved && Array.isArray(saved.sections) && Array.isArray(saved.metrics) && Array.isArray(saved.scorecards) ? saved : defaultAgendaSelection(type);
}
export function agendaSignalSelected(signal: AgendaSignal, selection: AgendaSelection) {
  if (signal.metric) return selection.metrics.includes(signal.source.id);
  if (isSelectableScorecard(signal.source)) return selection.scorecards.includes(scorecardKey(signal.source));
  return selection.sections.includes(signal.sectionKey);
}
export function canManageAgenda(actor: { accessLevel: string; email: string }, context: Record<string, unknown>) {
  if (actor.accessLevel === "Company Owner") return true;
  const email = actor.email.toLowerCase();
  return String(context.leader_email || "").toLowerCase() === email
    || (agendaSettings(context.access_json).agendaManagerEmails || []).some(person => person.toLowerCase() === email);
}
