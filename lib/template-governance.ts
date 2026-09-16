export const DRAFT_NOT_APPROVED = "Draft — Not Approved for Use";

export function requiredTemplateReviewers(area: string) {
  if (area === "Legal") return ["Attorney", "Company Owner"];
  if (["Human Resources", "Benefits"].includes(area)) return ["Human Resources", "Company Owner"];
  if (area === "Accounting") return ["Accounting Administrator", "Company Owner"];
  if (area === "Operations") return ["Operations / Safety", "Company Owner"];
  return ["Department Owner", "Company Owner"];
}

export function governanceStatus(input: { sourceSha256?: string; requiredReviewers: string[]; approvals: Array<{ reviewerRole: string; decision: string; sourceSha256: string }>; nextReviewDate: string; today?: string; superseded?: boolean }) {
  if (input.superseded) return "Superseded";
  if (!input.sourceSha256) return "Missing Source Master";
  const today = input.today || new Date().toISOString().slice(0, 10);
  if (!input.nextReviewDate || input.nextReviewDate < today) return "Expired — Not Approved for Use";
  const approved = input.requiredReviewers.every((role) => input.approvals.some((item) => item.reviewerRole === role && item.decision === "Approved" && item.sourceSha256 === input.sourceSha256));
  return approved ? "Approved for Use" : DRAFT_NOT_APPROVED;
}

export function assertTemplateApproved(input: { templateId: string; status: string; sourceSha256: string; version: string }) {
  if (input.status !== "Approved for Use" || !/^[a-f0-9]{64}$/i.test(input.sourceSha256)) throw new Error(`${input.templateId} is ${input.status}; release, signature, email, or operational use is blocked`);
  return { templateId: input.templateId, templateVersion: input.version, sourceSha256: input.sourceSha256 };
}

export async function sha256Hex(value: ArrayBuffer | string) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function reconcileTemplateGovernance(database: { prepare(query: string): { bind(...values: unknown[]): { run(): Promise<unknown> } } }, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  await database.prepare("UPDATE template_governance_versions SET status = 'Expired — Not Approved for Use' WHERE status = 'Approved for Use' AND next_review_date < ?").bind(today).run();
  return { reconciled: true, asOf: today };
}
