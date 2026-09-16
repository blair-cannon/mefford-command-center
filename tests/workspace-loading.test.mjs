import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { readWorkspaceJson, WorkspaceRequestError } from "../lib/workspace-request.ts";
import { harness, owner } from "./support/project-workflow-harness.mjs";

const hasRecords = (body) => Array.isArray(body.records);
const johnstone = [
  { id: "LEAD-0001", title: "Johnstone - Indianapolis Office / Warehouse", status: "Proposal Submitted" },
  { id: "LEAD-0002", title: "Johnstone - Bloomington, IN Remodel", status: "Awarded" },
];

test("an interrupted HTML or truncated JSON response recovers without losing the project list", async (t) => {
  for (const first of [
    () => new Response("<!doctype html><title>Temporarily unavailable</title>", { headers: { "Content-Type": "text/html" } }),
    () => new Response('{"records":[', { headers: { "Content-Type": "application/json" } }),
    () => Response.json({}, { status: 503 }),
  ]) {
    const requests = [];
    const mocked = t.mock.method(globalThis, "fetch", async (url, options) => {
      requests.push({ url, options });
      return requests.length === 1 ? first() : Response.json({ records: johnstone });
    });
    const result = await readWorkspaceJson("/api/records?projectId=MEFFORD-SALES", "Sales records", hasRecords);
    assert.deepEqual(result.records, johnstone);
    assert.equal(requests.length, 2);
    assert.ok(requests.every(({ options }) => options.method === "GET" && options.cache === "no-store" && options.headers.Accept === "application/json"));
    mocked.mock.restore();
  }
});

test("a persistent malformed response reports an actionable error instead of an empty funnel", async (t) => {
  for (const payload of ["not JSON", "null", "{}", '{"records":null}']) {
    const mocked = t.mock.method(globalThis, "fetch", async () => new Response(payload, { headers: { "Content-Type": "application/json" } }));
    await assert.rejects(readWorkspaceJson("/api/records", "Sales records", hasRecords), (error) => {
      assert.ok(error instanceof WorkspaceRequestError);
      assert.equal(error.message, "Sales records could not be loaded. Try again.");
      assert.doesNotMatch(error.message, /Unexpected token|JSON/);
      return true;
    });
    assert.equal(mocked.mock.callCount(), 2);
    mocked.mock.restore();
  }
});

test("access denial is not retried or converted to missing projects", async (t) => {
  for (const status of [401, 403]) {
    const mocked = t.mock.method(globalThis, "fetch", async () => Response.json({ error: "Access denied" }, { status }));
    await assert.rejects(readWorkspaceJson("/api/projects", "Project list", (body) => Array.isArray(body.projects)), (error) => error.status === status && !error.retryable);
    assert.equal(mocked.mock.callCount(), 1);
    mocked.mock.restore();
  }
});

test("cancelled reads cannot retry into another workspace, while a verified empty collection stays valid", async (t) => {
  const controller = new AbortController();
  const mocked = t.mock.method(globalThis, "fetch", async () => {
    controller.abort();
    throw new TypeError("Network interrupted");
  });
  await assert.rejects(readWorkspaceJson("/api/records", "Sales records", hasRecords, controller.signal), { name: "AbortError" });
  assert.equal(mocked.mock.callCount(), 1);
  mocked.mock.restore();
  t.mock.method(globalThis, "fetch", async () => Response.json({ records: [] }));
  assert.deepEqual(await readWorkspaceJson("/api/records", "Sales records", hasRecords), { records: [] });
});

test("sales records load independently of the roster and awarded history opens Production", async () => {
  const source = await readFile(new URL("../app/sales-estimating.tsx", import.meta.url), "utf8");
  const parsed = ts.createSourceFile("sales.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const effects = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(parsed) === "useEffect") effects.push(node.getText(parsed));
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  const records = effects.find((effect) => effect.includes("setRecords(loaded)"));
  const roster = effects.find((effect) => effect.includes("setSalespeople(team.salespeople)"));
  assert.ok(records && roster && records !== roster, "A roster failure must not discard a successful records response");
  assert.ok(!records.includes("/api/sales-team"));
  assert.ok(records.includes("setRecordsError("));
  assert.ok(source.includes("!recordsLoaded && recordsError"));
  const shell = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.ok(shell.includes('mode="dashboard" actor={sessionActor} onProjectCreated='));
  assert.ok(shell.includes('projectListStatus !== "ready"'));
});

test("a real roster query failure returns JSON and leaves both Johnstone lifecycle records readable and unchanged", async () => {
  const h = await harness();
  try {
    for (const row of johnstone) {
      h.runtime.database.sqlite.prepare(`INSERT INTO command_records
        (project_id,id,record_type,title,owner,due,status,meta,data_json)
        VALUES (?,?,?,?,?,?,?,?,?)`).run("MEFFORD-SALES", row.id, "Sales Opportunities", row.title, owner.name, "2026-09-30", row.status, "Read regression fixture", JSON.stringify({ stage: row.status, projectName: row.title, estimate: { entries: { "0300.00": { quantity: 2, subcontract: 500 } } }, awardedProjectNumber: row.status === "Awarded" ? "26-001" : "" }));
    }
    const before = h.runtime.database.query("SELECT * FROM command_records WHERE project_id = ? AND record_type = ?", "MEFFORD-SALES", "Sales Opportunities");
    h.runtime.database.injectFailure({ pattern: /select "display_name", "email", "company_access_level", "designations_json" from "company_members"/i });
    const failure = await h.send("/api/sales-team", { expected: 503 });
    assert.equal(failure.error, "Sales and estimating team could not be loaded. Try again.");
    assert.equal(h.runtime.database.failure, null, "The injected roster fault must have been exercised");
    const records = (await h.send("/api/records?projectId=MEFFORD-SALES")).records;
    for (const expected of johnstone) {
      const actual = records.find((row) => row.id === expected.id);
      assert.equal(actual.title, expected.title);
      assert.equal(actual.status, expected.status);
      assert.equal(actual.data.estimate.entries["0300.00"].subcontract, 500);
    }
    assert.deepEqual(h.runtime.database.query("SELECT * FROM command_records WHERE project_id = ? AND record_type = ?", "MEFFORD-SALES", "Sales Opportunities"), before);
    assert.ok((await h.send("/api/sales-team")).salespeople.length > 0);
  } finally { await h.close(); }
});
