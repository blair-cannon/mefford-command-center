export type WorkTool = { target: string; label: string; group: string };
export type WorkActor = { email?: string; accessLevel?: string; designations?: string[]; permissionLocked?: boolean };

/** Presentation preferences never confer permission. Callers supply authorized tools only. */
export function everydayTargets(actor: WorkActor): string[] {
  if (actor.permissionLocked) return ["Employee Portal"];
  const roles = (actor.designations || []).join(" ").toLowerCase();
  const targets = ["My Work"];
  if (actor.accessLevel === "Company Owner") targets.push("Dashboard", "Owner Approvals", "Project Health", "Sales Funnel", "Accounting Command");
  else if (/account|bookkeep/.test(roles)) targets.push("Accounts Payable", "Owner Billing", "Cash Management", "WIP And Close", "Financial Reports");
  else if (/estimat/.test(roles)) targets.push("Estimating", "Estimating Calendar", "Bid Management", "Sales Funnel");
  else if (/superintendent|field/.test(roles)) targets.push("Project Overview", "Daily Logs", "Design & Drawings", "Safety", "Quality");
  else if (/project manager/.test(roles)) targets.push("Project Overview", "Schedule", "Change Orders", "Budget", "RFIs");
  else if (/sales|business development/.test(roles)) targets.push("Sales Funnel", "Sales Contacts", "Sales Design", "Estimating Calendar");
  else if (/marketing/.test(roles)) targets.push("Marketing Calendar", "Marketing Social", "Marketing Email", "Marketing Surveys");
  else if (actor.accessLevel === "Administrator") targets.push("Admin Requests", "Employee Onboarding", "Company Calendar", "Project Overview");
  else targets.push("Project Overview", "Daily Logs", "Design & Drawings", "Safety");
  return targets;
}

export function authorizedShortcuts(actor: WorkActor, tools: WorkTool[], saved?: string[] | null): WorkTool[] {
  const byTarget = new Map(tools.map((tool) => [tool.target, tool]));
  return [...new Set(["My Work", ...(saved ?? everydayTargets(actor))])]
    .flatMap((target) => byTarget.has(target) ? [byTarget.get(target)!] : []);
}

export function workActionLabel(item: { actionTarget: string; kind?: string; title?: string }): string {
  const target = item.actionTarget;
  if (/approval|review/i.test(`${item.kind} ${item.title}`)) {
    if (/invoice|payable/i.test(`${target} ${item.title}`)) return "Review Invoice";
    if (/proposal/i.test(item.title || "")) return "Review Proposal";
    return "Review Request";
  }
  if (target === "Daily Logs") return "Open Daily Log";
  if (target === "Schedule") return "Review Schedule";
  if (target === "RFIs") return "Review RFI";
  if (/Turnover/.test(target)) return "Open Turnover";
  if (target === "Closeout") return "Review Closeout";
  if (target === "Safety") return "Review Safety Item";
  return "Open Task";
}

export function nextWorkStep(item: { sourceType: string; status: string; accountableRole?: string; actionTarget: string }): string {
  if (item.status === "Completed") return "Completed";
  if (item.sourceType === "Notification" || item.sourceType === "Escalation") return "Review The Notice";
  return item.accountableRole ? `Waiting On ${item.accountableRole}` : "Assigned To You";
}

export function draftStorageKey(email: string, projectId: string, formType: string): string {
  return `unfinished:${encodeURIComponent(email.toLowerCase())}:${encodeURIComponent(projectId)}:${encodeURIComponent(formType)}`;
}
