export type SystemHealthStatus = "Verified" | "Degraded" | "Failed" | "Unknown" | "Not Configured";

export type SystemHealthEvidenceCheck = {
  key: string;
  label: string;
  status: SystemHealthStatus;
  required?: boolean;
  observedAt?: string;
  expiresAt?: string;
  source?: string;
  detail?: string;
};

export const SYSTEM_HEALTH_STATUSES: readonly SystemHealthStatus[];
export function normalizeEvidenceCheck(check: SystemHealthEvidenceCheck, now?: Date): Required<SystemHealthEvidenceCheck>;
export function evaluateEvidenceStatus(checks: SystemHealthEvidenceCheck[], now?: Date): SystemHealthStatus;
export function statusCounts(items: Array<{ status?: string }>): Record<SystemHealthStatus, number>;
export function overallEvidenceStatus(items: Array<{ status?: string; required?: boolean }>): SystemHealthStatus;
