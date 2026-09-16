export const DELIVERY_MAX_ATTEMPTS = 5;

export type DeliveryAttemptResult = {
  outcome: "Provider Accepted" | "Deferred" | "Retry" | "Rejected";
  provider: string;
  providerReceiptId: string;
  providerStatus: number;
  acceptedAt: string;
  error: string;
  errorClass: "" | "Connection Required" | "Transient" | "Permanent";
  retryAfterSeconds: number;
};

export function retryDelaySeconds(attempt: number, providerDelay = 0) {
  if (providerDelay > 0) return Math.min(providerDelay, 24 * 60 * 60);
  const schedule = [300, 900, 3_600, 21_600, 86_400];
  return schedule[Math.min(Math.max(attempt - 1, 0), schedule.length - 1)];
}

export function nextDeliveryAttempt(attempt: number, now = new Date(), providerDelay = 0) {
  return new Date(now.getTime() + retryDelaySeconds(attempt, providerDelay) * 1_000).toISOString();
}

export function deliveryStatusAfterFailure(attempt: number, errorClass: DeliveryAttemptResult["errorClass"]) {
  if (errorClass === "Connection Required") return "Deferred";
  if (errorClass === "Permanent" || attempt >= DELIVERY_MAX_ATTEMPTS) return "Dead Letter";
  return "Retry Scheduled";
}

export function scheduledDeliveryOutcome(input: {
  accepted: number;
  pending: number;
  deferred: number;
  retrying: number;
  deadLetters: number;
  reason?: string;
}) {
  if (input.deadLetters > 0) {
    throw new Error(`${input.deadLetters} delivery event${input.deadLetters === 1 ? "" : "s"} require manual action`);
  }
  if (input.pending > 0 && input.accepted === 0 && input.deferred + input.retrying >= input.pending) {
    return {
      scheduledOutcome: "Deferred" as const,
      reason: input.reason || `${input.pending} delivery event${input.pending === 1 ? " is" : "s are"} waiting for a provider connection or retry window`,
    };
  }
  return {};
}

export function queueAgeMinutes(createdAt: string, now = new Date()) {
  const created = new Date(createdAt.endsWith("Z") || createdAt.includes("+") ? createdAt : `${createdAt}Z`);
  if (Number.isNaN(created.getTime())) return 0;
  return Math.max(0, Math.floor((now.getTime() - created.getTime()) / 60_000));
}

export function parseRetryAfter(value: string | null) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.floor(seconds));
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : Math.max(0, Math.ceil((date.getTime() - Date.now()) / 1_000));
}
