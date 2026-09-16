export const SALES_TURNOVER = "Sales To Estimating Turnover";
export const OPS_TURNOVER = "Estimating To Operations Turnover";
export type TurnoverType = typeof SALES_TURNOVER | typeof OPS_TURNOVER;
export const isTurnover = (type: unknown): type is TurnoverType => type === SALES_TURNOVER || type === OPS_TURNOVER;

export const TURNOVER_SECTIONS = {
  [SALES_TURNOVER]: [
    { key: "control", title: "Handoff And Bid Decision", minutes: 5 },
    { key: "project", title: "Customer, Project And Bid Requirements", minutes: 5 },
    { key: "scope", title: "Scope, Exclusions And Owner Commitments", minutes: 10 },
    { key: "commercial", title: "Budget, Contract Route And Bid Deadline", minutes: 5 },
    { key: "documents", title: "Drawings, Specifications And Addenda", minutes: 5 },
    { key: "risks", title: "Coverage, Lead Times And Project Risks", minutes: 5 },
    { key: "actions", title: "Assignments And Estimator Acceptance", minutes: 5 },
  ],
  [OPS_TURNOVER]: [
    { key: "control", title: "Turnover Meeting Control", minutes: 5 },
    { key: "project", title: "Project Information And Key Dates", minutes: 5 },
    { key: "commercial", title: "Contract And Commercial Requirements", minutes: 10 },
    { key: "estimate", title: "Cap Sheet And General Requirements", minutes: 15 },
    { key: "scope", title: "Scope Responsibility Matrix", minutes: 10 },
    { key: "buyout", title: "Subcontractor And Vendor Buyout", minutes: 10 },
    { key: "documents", title: "Drawing And Specification Review", minutes: 10 },
    { key: "risks", title: "Project Risk Register", minutes: 10 },
    { key: "setup", title: "Project Setup And Document Control", minutes: 5 },
    { key: "actions", title: "Turnover Action Items", minutes: 5 },
    { key: "recap", title: "Meeting Recap And PM Acceptance", minutes: 5 },
  ],
} as const;

export type TurnoverGap = { key: string; title: string; owner: string; blocking: boolean };
export type TurnoverPacket = {
  title: string; projectId: string; opportunityId: string; receiverName: string; receiverEmail: string;
  senderName: string; senderEmail: string; contractSigned: boolean; contractValue: number;
  sections: Array<{ key: string; title: string; minutes: number; content: string }>;
  gaps: TurnoverGap[];
  people: Array<{ name: string; email: string; role: string }>;
  files: Array<{ id: string; name: string; category: string; revision: string; storageKey: string; contentType: string; size: number }>;
};
export type TurnoverView = {
  id: string; type: TurnoverType; status: string; revision: number; packet: TurnoverPacket;
  scheduled: boolean; buyoutDue: string; reviewed: string[]; acceptedAt: string; acceptedBy: string;
  ntpReference: string; canAccept: boolean;
};

/** Calendar days in the meeting's time zone; DST must not move the deadline. */
export function turnoverBuyoutDate(heldAt: string, timeZone = "America/New_York") {
  if (!heldAt || !Number.isFinite(Date.parse(heldAt))) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(heldAt));
  const part = (name: string) => Number(parts.find(p => p.type === name)?.value);
  return new Date(Date.UTC(part("year"), part("month") - 1, part("day") + 30, 12)).toISOString().slice(0, 10);
}
