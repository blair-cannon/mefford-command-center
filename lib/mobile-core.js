export const MOBILE_OFFLINE_DAYS = 7;

export const MOBILE_PRIMARY_NAVIGATION = Object.freeze([
  { id: "work", label: "My Work", icon: "MW" },
  { id: "project", label: "Project", icon: "P" },
  { id: "quick", label: "Quick Add", icon: "+" },
  { id: "notifications", label: "Notifications", icon: "N" },
  { id: "more", label: "More", icon: "•••" },
]);

export const MOBILE_OFFLINE_RECORD_TYPES = Object.freeze([
  "Daily Logs",
  "Pre-Work Checklists",
  "Quality",
  "Photos",
  "RFIs",
  "Toolbox Talks",
  "Safety",
  "Schedule",
  "Acknowledgments",
  "Visitor Records",
  "Delivery Tickets",
]);

export const MOBILE_LIVE_ONLY_ACTIONS = Object.freeze([
  "Financial Approval",
  "Owner Override",
  "Contract Execution",
  "Final Payment Approval",
  "Total Project Closeout",
]);

export const MOBILE_PUSH_CATEGORIES = Object.freeze([
  "Assignments",
  "Approvals",
  "Mentions",
  "Due Items",
  "Escalations",
  "Safety Alerts",
  "Upload / Sync Failures",
]);

export const MOBILE_SCAN_TYPES = Object.freeze([
  "Receipt",
  "Invoice",
  "Permit",
  "Lien Release",
  "Delivery Ticket",
  "Equipment Information",
]);

export const MOBILE_DEVICE_TEST_MATRIX = Object.freeze([
  { device: "Small iPhone", portrait: [320, 568], landscape: [568, 320] },
  { device: "Large iPhone", portrait: [430, 932], landscape: [932, 430] },
  { device: "iPad Mini", portrait: [744, 1133], landscape: [1133, 744] },
  { device: "Standard iPad", portrait: [820, 1180], landscape: [1180, 820] },
  { device: "iPad Pro", portrait: [1024, 1366], landscape: [1366, 1024] },
]);

export const MOBILE_QUICK_ACTIONS = Object.freeze([
  { id: "daily-log", label: "Daily Log", target: "Daily Logs", formType: "Daily Logs", icon: "DL", roles: ["all"] },
  { id: "camera", label: "Photo / Video", target: "Daily Logs", formType: "Daily Logs", icon: "CAM", roles: ["all"] },
  { id: "rfi", label: "RFI", target: "RFIs", formType: "RFIs", icon: "RFI", roles: ["all"] },
  { id: "quality", label: "Quality Item", target: "Quality", icon: "QC", roles: ["all"] },
  { id: "safety", label: "Safety / Toolbox", target: "Safety", formType: "Toolbox Talks", icon: "SF", roles: ["all"] },
  { id: "receipt", label: "Receipt / Invoice", target: "Accounts Payable", icon: "$", roles: ["owner", "admin", "pm", "accounting"] },
  { id: "delivery", label: "Delivery Ticket", target: "Daily Logs", formType: "Daily Logs", icon: "DT", roles: ["all"] },
  { id: "schedule", label: "Schedule Update", target: "Schedule", icon: "SC", roles: ["all"] },
  { id: "visitor", label: "Visitor Record", target: "Safety", icon: "VR", roles: ["all"] },
  { id: "pre-work", label: "Pre-Work Checklist", target: "Quality", icon: "PW", roles: ["all"] },
]);

export function mobileRole(actor = {}) {
  const access = String(actor.accessLevel || "").toLowerCase();
  const designations = Array.isArray(actor.designations)
    ? actor.designations.map((value) => String(value).toLowerCase())
    : [];
  if (access.includes("owner")) return "owner";
  if (access.includes("administrator")) return "admin";
  if (designations.some((value) => value.includes("project manager"))) return "pm";
  if (designations.some((value) => value.includes("account"))) return "accounting";
  if (designations.some((value) => value.includes("superintendent"))) return "superintendent";
  return "employee";
}

export function quickActionsForActor(actor = {}) {
  const role = mobileRole(actor);
  return MOBILE_QUICK_ACTIONS.filter(
    (action) => action.roles.includes("all") || action.roles.includes(role),
  );
}

export function canQueueOfflineAction(recordType) {
  const normalized = String(recordType || "").trim().toLowerCase();
  return MOBILE_OFFLINE_RECORD_TYPES.some(
    (value) => value.toLowerCase() === normalized,
  );
}

export function requiresLiveConnection(action) {
  const normalized = String(action || "").toLowerCase();
  return MOBILE_LIVE_ONLY_ACTIONS.some((value) =>
    normalized.includes(value.toLowerCase()),
  );
}

export function isSensitiveActionLabel(label) {
  const normalized = String(label || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  return [
    /approve.*(invoice|payment|financial|billing)/,
    /(invoice|payment|financial|billing).*approve/,
    /owner override/,
    /(execute|sign).*contract/,
    /contract.*(execute|sign)/,
    /final payment/,
    /total project closeout/,
    /complete total closeout/,
  ].some((pattern) => pattern.test(normalized));
}

export function offlineSessionExpiresAt(lastSuccessfulConnection, days = MOBILE_OFFLINE_DAYS) {
  const date = new Date(lastSuccessfulConnection);
  if (!Number.isFinite(date.getTime())) return null;
  return new Date(date.getTime() + Math.max(1, days) * 86_400_000).toISOString();
}

export function offlineSessionExpired(lastSuccessfulConnection, now = new Date()) {
  const expires = offlineSessionExpiresAt(lastSuccessfulConnection);
  if (!expires) return true;
  return new Date(expires).getTime() < new Date(now).getTime();
}

export function resolveOfflineConflict(existingUpdatedAt, queuedAt) {
  const existing = new Date(existingUpdatedAt || 0).getTime();
  const queued = new Date(queuedAt || 0).getTime();
  return Number.isFinite(existing) && Number.isFinite(queued) && existing > queued
    ? "preserve_both_review_required"
    : "apply_queued_record";
}
