import assert from "node:assert/strict";
import test from "node:test";
import {
  expectedScheduleSlots,
  planRecoverySlots,
  retryDelayMilliseconds,
  scheduleSlotAtOrBefore,
  schedulerEvidenceStatus,
} from "../lib/scheduler-reliability.js";

test("schedule slots honor five-minute, hourly, and daily offsets", () => {
  const now = new Date("2026-08-23T12:07:42.000Z");
  assert.equal(scheduleSlotAtOrBefore(now, 5).toISOString(), "2026-08-23T12:05:00.000Z");
  assert.equal(scheduleSlotAtOrBefore(now, 60).toISOString(), "2026-08-23T12:00:00.000Z");
  assert.equal(scheduleSlotAtOrBefore(now, 1_440, 4 * 60).toISOString(), "2026-08-23T04:00:00.000Z");
});

test("recovery keeps the current slot moving while draining the oldest backlog", () => {
  const plan = planRecoverySlots({
    now: "2026-08-23T12:20:00.000Z",
    intervalMinutes: 5,
    windowMinutes: 20,
    catchUpLimit: 3,
    runs: [{ scheduledAt: "2026-08-23T12:05:00.000Z", status: "Succeeded" }],
  });
  assert.deepEqual(plan.missing, [
    "2026-08-23T12:10:00.000Z",
    "2026-08-23T12:15:00.000Z",
    "2026-08-23T12:20:00.000Z",
  ]);
  assert.deepEqual(plan.selected, plan.missing);

  const longer = planRecoverySlots({ now: "2026-08-23T12:20:00.000Z", intervalMinutes: 5, windowMinutes: 40, catchUpLimit: 3, runs: [] });
  assert.deepEqual(longer.selected, [
    "2026-08-23T11:45:00.000Z",
    "2026-08-23T11:50:00.000Z",
    "2026-08-23T12:20:00.000Z",
  ]);
  assert.equal(longer.unrecovered.length, 5);
});

test("expected completeness excludes a slot still inside its grace period", () => {
  const slots = expectedScheduleSlots({ now: "2026-08-23T12:01:00.000Z", intervalMinutes: 60, windowMinutes: 180, graceMinutes: 2 });
  assert.deepEqual(slots, ["2026-08-23T10:00:00.000Z", "2026-08-23T11:00:00.000Z"]);
});

test("health fails for hard failures and degrades for incomplete execution", () => {
  assert.equal(schedulerEvidenceStatus({ expectedRuns: 288, terminalRuns: 288, latestSuccessAgeMinutes: 2, maxDelayMinutes: 15 }), "Healthy");
  assert.equal(schedulerEvidenceStatus({ expectedRuns: 288, terminalRuns: 287, latestSuccessAgeMinutes: 2, maxDelayMinutes: 15 }), "Late");
  assert.equal(schedulerEvidenceStatus({ expectedRuns: 288, terminalRuns: 288, failedRuns: 1, latestSuccessAgeMinutes: 2, maxDelayMinutes: 15 }), "Failed");
  assert.equal(schedulerEvidenceStatus({ expectedRuns: 288, terminalRuns: 288, stuckRuns: 1, latestSuccessAgeMinutes: 2, maxDelayMinutes: 15 }), "Failed");
  assert.equal(schedulerEvidenceStatus({ expectedRuns: 1, terminalRuns: 0, latestSuccessAgeMinutes: null, maxDelayMinutes: 1_500 }), "Awaiting First Run");
});

test("retry delay is bounded exponential backoff", () => {
  assert.equal(retryDelayMilliseconds(1), 250);
  assert.equal(retryDelayMilliseconds(2), 500);
  assert.equal(retryDelayMilliseconds(8), 2_000);
});
