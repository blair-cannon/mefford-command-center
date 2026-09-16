export type SchedulerRunEvidence = { scheduledAt: string; status: string };

export function scheduleSlotAtOrBefore(value: Date | string, intervalMinutes: number, offsetMinutes?: number): Date;
export function expectedScheduleSlots(input: { now: Date | string; intervalMinutes: number; offsetMinutes?: number; windowMinutes?: number; graceMinutes?: number }): string[];
export function planRecoverySlots(input: { now: Date | string; intervalMinutes: number; offsetMinutes?: number; windowMinutes: number; graceMinutes?: number; catchUpLimit?: number; runs?: SchedulerRunEvidence[] }): { expected: string[]; missing: string[]; selected: string[]; unrecovered: string[] };
export function schedulerEvidenceStatus(input: { expectedRuns: number; terminalRuns: number; failedRuns?: number; timedOutRuns?: number; stuckRuns?: number; latestSuccessAgeMinutes?: number | null; maxDelayMinutes: number; openGapSlots?: number }): "Healthy" | "Late" | "Failed" | "Awaiting First Run";
export function retryDelayMilliseconds(attempt: number, baseMilliseconds?: number, maximumMilliseconds?: number): number;
export const TERMINAL_STATUSES: ReadonlySet<string>;
