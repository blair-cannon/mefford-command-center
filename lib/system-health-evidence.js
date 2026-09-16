export const SYSTEM_HEALTH_STATUSES = [
  "Verified",
  "Degraded",
  "Failed",
  "Unknown",
  "Not Configured",
];

/**
 * A health check is evidence, not a declaration. Required checks determine the
 * subject status. Optional checks remain visible without failing an otherwise
 * verified internal workflow.
 *
 * @param {{ key: string; label: string; status: string; required?: boolean; observedAt?: string; expiresAt?: string; source?: string; detail?: string }} check
 * @param {Date} [now]
 */
export function normalizeEvidenceCheck(check, now = new Date()) {
  const status = SYSTEM_HEALTH_STATUSES.includes(check?.status)
    ? check.status
    : "Unknown";
  const expiresAt = safeDate(check?.expiresAt);
  const stale = status === "Verified" && expiresAt && expiresAt.getTime() < now.getTime();
  return {
    key: String(check?.key || "missing-evidence"),
    label: String(check?.label || "Required Evidence"),
    status: stale ? "Unknown" : status,
    required: check?.required !== false,
    observedAt: String(check?.observedAt || ""),
    expiresAt: String(check?.expiresAt || ""),
    source: String(check?.source || "Evidence Not Recorded"),
    detail: stale
      ? `Evidence expired ${check.expiresAt}. A new independent check is required.`
      : String(check?.detail || "No independent evidence has been recorded."),
  };
}

/**
 * @param {Array<Parameters<typeof normalizeEvidenceCheck>[0]>} checks
 * @param {Date} [now]
 */
export function evaluateEvidenceStatus(checks, now = new Date()) {
  const required = (Array.isArray(checks) ? checks : [])
    .map((check) => normalizeEvidenceCheck(check, now))
    .filter((check) => check.required);
  if (!required.length) return "Unknown";
  if (required.some((check) => check.status === "Failed")) return "Failed";
  if (required.some((check) => check.status === "Degraded")) return "Degraded";
  if (required.some((check) => check.status === "Not Configured")) return "Not Configured";
  if (required.some((check) => check.status === "Unknown")) return "Unknown";
  return required.every((check) => check.status === "Verified") ? "Verified" : "Unknown";
}

/**
 * @param {Array<{ status?: string }>} items
 */
export function statusCounts(items) {
  const counts = Object.fromEntries(SYSTEM_HEALTH_STATUSES.map((status) => [status, 0]));
  for (const item of Array.isArray(items) ? items : []) {
    const status = SYSTEM_HEALTH_STATUSES.includes(item?.status) ? item.status : "Unknown";
    counts[status] += 1;
  }
  return counts;
}

/**
 * Failed evidence makes the system red. Degraded, unknown, or a required
 * unconfigured capability keeps it yellow. Green means every required subject
 * is verified; optional unconfigured connections do not prevent green.
 *
 * @param {Array<{ status?: string; required?: boolean }>} items
 */
export function overallEvidenceStatus(items) {
  const required = (Array.isArray(items) ? items : []).filter((item) => item?.required !== false);
  if (!required.length) return "Unknown";
  if (required.some((item) => item.status === "Failed")) return "Failed";
  if (required.some((item) => item.status === "Degraded")) return "Degraded";
  if (required.some((item) => item.status === "Not Configured")) return "Not Configured";
  if (required.some((item) => item.status !== "Verified")) return "Unknown";
  return "Verified";
}

function safeDate(value) {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
