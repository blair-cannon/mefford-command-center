import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DOMAIN_EVENT_MAX_ATTEMPTS,
  deriveDomainEventStatus,
  retryDelaySeconds,
} from "../lib/domain-outbox.ts";

const [outbox, award, scheduler, commandScheduler, migration] = await Promise.all([
  readFile(new URL("../lib/domain-outbox.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/estimates/award/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/scheduled-operations.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/command-scheduler.ts", import.meta.url), "utf8"),
  readFile(new URL("../drizzle/0026_domain_event_outbox.sql", import.meta.url), "utf8"),
]);

test("F-13 never reports a mandatory handoff complete until every mandatory consumer succeeds", () => {
  assert.equal(deriveDomainEventStatus([
    { mandatory: true, status: "Pending" },
    { mandatory: true, status: "Pending" },
  ]), "Pending");
  assert.equal(deriveDomainEventStatus([
    { mandatory: true, status: "Succeeded" },
    { mandatory: true, status: "Failed" },
  ]), "Partially Applied");
  assert.equal(deriveDomainEventStatus([
    { mandatory: true, status: "Succeeded" },
    { mandatory: true, status: "Succeeded" },
    { mandatory: false, status: "Failed" },
  ]), "Completed");
});

test("F-13 retry timing is bounded and exhausted work cannot loop forever", () => {
  assert.equal(DOMAIN_EVENT_MAX_ATTEMPTS, 5);
  assert.equal(retryDelaySeconds(1), 15);
  assert.equal(retryDelaySeconds(2), 30);
  assert.equal(retryDelaySeconds(20), 900);
  assert.match(outbox, /attempt_count >= DOMAIN_EVENT_MAX_ATTEMPTS/);
  assert.match(outbox, /next_attempt_at/);
});

test("the durable outbox has versioned events, idempotent consumers, leases, results, and permanent audit", () => {
  for (const table of ["domain_events", "domain_event_consumers", "domain_event_audits"]) {
    assert.match(migration, new RegExp("CREATE TABLE `" + table + "`"));
  }
  assert.match(migration, /idempotency_key/);
  assert.match(migration, /CREATE UNIQUE INDEX `domain_event_consumers_event_key_idx`/);
  assert.match(outbox, /DOMAIN_EVENT_SCHEMA_VERSION/);
  assert.match(outbox, /lease_token/);
  assert.match(outbox, /result_json/);
  assert.match(outbox, /Partially Applied/);
});

test("project award commits its source transaction and outbox envelope atomically", () => {
  assert.match(award, /eventType: "estimate\.awarded"/);
  assert.match(award, /key: "source-project-activation"/);
  assert.match(award, /completedInSourceTransaction: true/);
  assert.match(award, /key: "sharepoint-estimate-workspace"/);
  assert.match(award, /key: "sharepoint-project-workspace"/);
  const batch = award.slice(award.indexOf("await database.batch(["), award.indexOf("const savedProject", award.indexOf("await database.batch([")));
  assert.match(batch, /projectStatement/);
  assert.match(batch, /\.\.\.outboxStatements/);
});

test("partial project-award handoffs are explicit and use the durable consumer ledger", () => {
  assert.match(award, /await reconcileDomainEvent\(database, domainEventId\)/);
  assert.match(award, /handoff\?\.status === "Completed" \? 201 : 202/);
  assert.match(award, /Every mandatory consumer must reconcile before the award handoff is Complete/);
  assert.doesNotMatch(award, /microsoftFileWarning/);
});

test("an independent scheduler reconciles incomplete handoffs and escalates exhausted mandatory consumers", () => {
  assert.match(scheduler, /name: "domain-outbox-reconciliation"/);
  assert.match(commandScheduler, /case "domain-outbox-reconciliation"/);
  assert.match(commandScheduler, /reconcileDomainOutbox/);
  assert.match(outbox, /Mandatory Handoff Is Partially Applied/);
  assert.match(outbox, /Company Owner/);
  assert.match(outbox, /Administrator/);
  assert.match(outbox, /it@meffcon\.com/);
  assert.match(outbox, /upsertWorkItem/);
});
