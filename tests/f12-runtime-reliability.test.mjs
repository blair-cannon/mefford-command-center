import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  normalizeRuntimeFailureRoute,
  runtimeFailureThresholdReached,
  sanitizeRuntimeFailureDetail,
} from "../lib/runtime-observability.ts";

const [records, weather, observability, scheduler, layout, migration] = await Promise.all([
  readFile(new URL("../app/api/records/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/weather/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/runtime-observability.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/command-scheduler.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../drizzle/0024_watery_dark_beast.sql", import.meta.url), "utf8"),
]);

test("company master cost-code reads no longer trigger the known controlled-project 403", () => {
  assert.match(records, /projectId === "MEFFORD-COMPANY" && row\.recordType !== MASTER_RECORD_TYPE/);
  assert.match(records, /Company Master Cost Codes Require Company Owner Or Administrator Access/);
  assert.doesNotMatch(records, /new Set\(\["MEFFORD-PERFORMANCE", "MEFFORD-COMPANY"\]\)/);
});

test("quarantined records are excluded from normal data reads", () => {
  assert.match(records, /row\.status === "Deletion Quarantine"/);
});

test("weather failures are authenticated, normalized, persisted, and escalated after a measured threshold", () => {
  assert.match(weather, /await resolveCommandActor\(request\)/);
  assert.match(weather, /recordFirstPartyFailure/);
  assert.match(observability, /runtime_failure_events/);
  assert.match(observability, /datetime\(occurred_at\) >= datetime\('now', '-15 minutes'\)/);
  assert.match(observability, /runtimeFailureThresholdReached\(failureCount\)/);
  assert.match(observability, /upsertWorkItem/);
  assert.match(migration, /CREATE TABLE `runtime_failure_events`/);
});

test("runtime failure escalation cannot be skipped when concurrent failures exceed the threshold", () => {
  assert.equal(runtimeFailureThresholdReached(0), false);
  assert.equal(runtimeFailureThresholdReached(2), false);
  assert.equal(runtimeFailureThresholdReached(3), true);
  assert.equal(runtimeFailureThresholdReached(4), true);
  assert.equal(runtimeFailureThresholdReached(Number.NaN), false);
});

test("runtime failure evidence is normalized and strips likely credentials", () => {
  assert.equal(normalizeRuntimeFailureRoute(" /API/Weather?project=26-001 "), "/API/Weatherproject26-001");
  assert.equal(normalizeRuntimeFailureRoute("***"), "unknown-route");
  const detail = sanitizeRuntimeFailureDetail(
    "Provider failed\nAuthorization: Bearer abc.def.ghi client_secret=hunter2&token=url-secret",
  );
  assert.doesNotMatch(detail, /abc\.def\.ghi|hunter2|url-secret/);
  assert.match(detail, /\[REDACTED\]/);
  assert.doesNotMatch(detail, /[\r\n\t]/);
});

test("runtime failure evidence is initialized and retention-maintained before scheduled work", () => {
  assert.match(scheduler, /const startedAt = input\.now \|\| new Date\(\)/);
  assert.match(scheduler, /await maintainRuntimeFailureEvidence\(db, startedAt\)/);
  assert.match(observability, /RUNTIME_FAILURE_RETENTION_DAYS = 30/);
  assert.match(observability, /DELETE FROM runtime_failure_events WHERE occurred_at < \?/);
});

test("successful private-address weather responses cannot be stored in a shared cache", () => {
  assert.match(weather, /address\.length > 300/);
  assert.match(weather, /requestedTimeZone\.length <= 80/);
  assert.match(weather, /"Cache-Control": "private, max-age=900"/);
  assert.match(weather, /Vary: "Cookie"/);
  assert.doesNotMatch(weather, /"Cache-Control": "public/);
});

test("the layout uses system fonts and cannot emit the previously missing hosted font assets", () => {
  assert.doesNotMatch(layout, /next\/font\/google/);
  assert.doesNotMatch(layout, /Geist|Geist_Mono/);
  assert.match(layout, /className="antialiased"/);
});
