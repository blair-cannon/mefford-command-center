import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  deliveryStatusAfterFailure,
  nextDeliveryAttempt,
  queueAgeMinutes,
  retryDelaySeconds,
  scheduledDeliveryOutcome,
} from "../lib/delivery-control.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("F-03 retries are bounded and exhausted delivery becomes a dead letter", () => {
  assert.equal(retryDelaySeconds(1), 300);
  assert.equal(retryDelaySeconds(5), 86_400);
  assert.equal(deliveryStatusAfterFailure(1, "Connection Required"), "Deferred");
  assert.equal(deliveryStatusAfterFailure(1, "Transient"), "Retry Scheduled");
  assert.equal(deliveryStatusAfterFailure(5, "Transient"), "Dead Letter");
  assert.equal(deliveryStatusAfterFailure(1, "Permanent"), "Dead Letter");
  assert.equal(nextDeliveryAttempt(1, new Date("2026-08-23T12:00:00Z")), "2026-08-23T12:05:00.000Z");
});

test("F-03 scheduler distinguishes execution from the external business outcome", () => {
  assert.deepEqual(scheduledDeliveryOutcome({ accepted: 0, pending: 4, deferred: 4, retrying: 0, deadLetters: 0 }), {
    scheduledOutcome: "Deferred",
    reason: "4 delivery events are waiting for a provider connection or retry window",
  });
  assert.deepEqual(scheduledDeliveryOutcome({ accepted: 2, pending: 2, deferred: 0, retrying: 0, deadLetters: 0 }), {});
  assert.throws(() => scheduledDeliveryOutcome({ accepted: 0, pending: 1, deferred: 0, retrying: 0, deadLetters: 1 }), /manual action/);
});

test("F-03 oldest queue age is measured from evidence", () => {
  assert.equal(queueAgeMinutes("2026-08-23T10:30:00Z", new Date("2026-08-23T12:00:00Z")), 90);
});

test("F-03 stores receipts and never labels provider acceptance as inbox delivery", async () => {
  const [schema, work, graph, ui, health, meetings] = await Promise.all([
    source("db/schema.ts"),
    source("lib/my-work.ts"),
    source("lib/microsoft-graph.ts"),
    source("app/integration-health.tsx"),
    source("lib/system-health-runtime.ts"),
    source("app/api/meetings/route.ts"),
  ]);
  for (const column of ["providerReceiptId", "providerStatus", "acceptedAt", "nextAttemptAt", "deadLetteredAt"]) assert.match(schema, new RegExp(column));
  for (const phrase of ["Provider Accepted", "Retry Scheduled", "Dead Letter", "scheduledDeliveryOutcome", "loadDeliveryControlSnapshot"]) assert.match(work, new RegExp(phrase));
  assert.match(work, /Recipient no longer has active Command Center company access/);
  assert.match(graph, /downstream mailbox delivery is not yet proven/);
  assert.match(ui, /Provider Evidence, Not Assumed Delivery/);
  assert.match(ui, /OLDEST PENDING/);
  assert.match(ui, /Run Controlled Email \+ Push Test/);
  assert.match(health, /oldest pending/);
  assert.match(meetings, /Provider Accepted/);
  assert.match(meetings, /providerReceipt/);
  assert.doesNotMatch(work, /status: "Sent"/);
});

test("QuickBooks cutover language is removed while the native ERP remains", async () => {
  const [page, erp, runtime] = await Promise.all([source("app/page.tsx"), source("app/accounting-erp.tsx"), source("lib/integration-runtime.ts")]);
  assert.doesNotMatch(`${page}\n${erp}\n${runtime}`, /QuickBooks/i);
  assert.match(erp, /Native ERP/);
});
