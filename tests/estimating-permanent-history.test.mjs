import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const source = async (path) => readFile(new URL(path, root), "utf8");

test("estimating release requires a permanent one-way warning", async () => {
  const sales = await source("app/sales-estimating.tsx");
  assert.match(sales, /Release This Project To Estimating\?/);
  assert.match(sales, /cannot move backward into Sales/);
  assert.match(sales, /permanent estimating record until recorded as Won or Lost/);
  assert.match(sales, /Estimating · Use Handoff Button/);
});

test("server rejects backward movement after estimating entry", async () => {
  const records = await source("app/api/records/route.ts");
  assert.match(records, /estimatingLockedAt/);
  assert.match(records, /\["Estimating", "Proposal Submitted", "Negotiation", "Lost", "Awarded"\]/);
  assert.match(records, /History And Files Cannot Be Moved Backward Into Sales/);
});

test("sales dashboard retains sector performance measures", async () => {
  const sales = await source("app/sales-estimating.tsx");
  assert.match(sales, /Estimating Performance By Sector/);
  assert.match(sales, /Won \/ Lost \/ Open/);
  assert.match(sales, /Running \$ \/ SF/);
  assert.match(sales, /Avg\. Estimate To Proposal/);
  assert.match(sales, /buildingSquareFeet/);
  assert.match(sales, /proposalSubmittedAt/);
});

test("ordinary estimating list has no delete action", async () => {
  const sales = await source("app/sales-estimating.tsx");
  const list = sales.slice(sales.indexOf('className="estimate-list"'), sales.indexOf('No Estimates Yet'));
  assert.doesNotMatch(list, /openEstimateDeletion|estimate-delete-button|>Delete</);
  assert.match(list, /onClick=\{\(\) => setSelectedEstimateId\(record.id\)\}/);
});
