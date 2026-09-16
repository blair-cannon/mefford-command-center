import type { WorkActor, WorkTool } from "./workspace-usability";

/** Ordered navigation areas, not completion states or permission grants. */
export const projectWorkAreas = [
  { id: "plan", label: "Plan", targets: ["Contracts", "Schedule", "Design & Drawings", "Team"] },
  { id: "coordinate", label: "Coordinate", targets: ["RFIs", "Submittals", "Selections", "Project Owner Meetings", "Project Design Meetings", "Project Subcontractor Meetings"] },
  { id: "field", label: "Field Work", targets: ["Daily Logs", "Safety", "Quality"] },
  { id: "costs", label: "Costs & Changes", targets: ["Budget", "Change Orders", "Subcontracts", "Purchase Orders", "Procurement", "Owner Billing"] },
  { id: "closeout", label: "Closeout", targets: ["Closeout", "Lien Waivers"] },
];

export function authorizedProjectAreas(tools: WorkTool[]) {
  const available = new Map(tools.map((tool) => [tool.target, tool]));
  return projectWorkAreas.map((area) => ({ ...area, tools: area.targets.flatMap((target) => available.has(target) ? [available.get(target)!] : []) })).filter((area) => area.tools.length);
}

export function preferredWorkspace(actor: WorkActor): string {
  if (actor.permissionLocked) return "Employee Portal";
  if (["Company Owner", "Administrator"].includes(actor.accessLevel || "")) return "Dashboard";
  if (actor.designations?.includes("Project Manager")) return "Project Overview";
  return "My Work";
}
