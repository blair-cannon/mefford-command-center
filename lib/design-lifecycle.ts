export const DESIGN_TEAM_DISCIPLINES = [
  "Architecture",
  "MEP",
  "Structural",
  "Civil",
  "Miscellaneous",
] as const;

export const DESIGN_ENGAGEMENT_STATUSES = [
  "Prospective",
  "Proposal Requested",
  "Selected",
  "Under Contract",
  "Complete",
] as const;

export type DesignTeamAssignment = {
  id: string;
  discipline: string;
  vendorId: string;
  vendorName: string;
  contactName: string;
  contactEmail: string;
  engagementStatus: string;
  contractReference: string;
  linkedSubcontractId: string;
  notificationsEnabled: boolean;
  portalStatus: string;
  assignedBy: string;
  assignedAt: string;
  updatedAt: string;
};

export type DesignChecklistItem = {
  id: string;
  group: string;
  label: string;
  required: boolean;
  completed: boolean;
  completedBy: string;
  completedAt: string;
  note: string;
};

export const DESIGN_CHECKLIST_TEMPLATE: ReadonlyArray<Pick<DesignChecklistItem, "id" | "group" | "label" | "required">> = [
  { id: "contract-scope", group: "Contract & Launch", label: "Designer scope, fee, and contract responsibility confirmed", required: true },
  { id: "existing-conditions", group: "Contract & Launch", label: "Existing conditions, surveys, and available owner information issued", required: true },
  { id: "basis-of-sale", group: "Contract & Launch", label: "Basis of Sale and proposal assumptions reviewed with the design team", required: true },
  { id: "program-criteria", group: "Design Criteria", label: "Owner program, design criteria, and performance requirements confirmed", required: true },
  { id: "code-jurisdiction", group: "Design Criteria", label: "Applicable codes, utilities, and jurisdiction requirements confirmed", required: true },
  { id: "discipline-coordination", group: "Coordination", label: "Architecture, structure, MEP, civil, and delegated scopes coordinated", required: true },
  { id: "fifty-review", group: "Coordination", label: "50% coordination review completed with decisions documented", required: true },
  { id: "ninety-review", group: "Coordination", label: "90% constructability and cost review completed", required: true },
  { id: "permit-submission", group: "Permit & Release", label: "Permit submission made and jurisdiction comments tracked to resolution", required: true },
  { id: "designer-approval", group: "Permit & Release", label: "Designer approval recorded for the intended issue revision", required: true },
  { id: "pm-current-set", group: "Permit & Release", label: "PM released and distributed the official Current Set", required: true },
  { id: "field-revisions", group: "Construction", label: "Field changes, bulletins, and supplemental instructions incorporated", required: true },
  { id: "record-closeout", group: "Closeout", label: "Record / as-built package and final design closeout delivered", required: true },
];

export function defaultDesignChecklist(): DesignChecklistItem[] {
  return DESIGN_CHECKLIST_TEMPLATE.map((item) => ({
    ...item,
    completed: false,
    completedBy: "",
    completedAt: "",
    note: "",
  }));
}

export function normalizeDesignChecklist(value: unknown): DesignChecklistItem[] {
  const saved = Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
  const byId = new Map(saved.map((item) => [String(item.id || ""), item]));
  return defaultDesignChecklist().map((item) => {
    const prior = byId.get(item.id);
    return prior ? {
      ...item,
      completed: prior.completed === true,
      completedBy: String(prior.completedBy || ""),
      completedAt: String(prior.completedAt || ""),
      note: String(prior.note || ""),
    } : item;
  });
}
