import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const source = async (path) => readFile(new URL(path, root), "utf8");

test("Sales navigation keeps Contacts last", async () => {
  const page = await source("app/page.tsx");
  const sales = page.slice(page.indexOf('label: "Sales"'), page.indexOf('label: "Estimating"'));
  assert.ok(sales.indexOf('target: "Sales Design"') < sales.indexOf('target: "Sales Contacts"'));
});

test("Design-Build estimating handoff creates one durable Sales Design track", async () => {
  const records = await source("app/api/records/route.ts");
  for (const method of ["design-build", "design-build gmp", "design-build lump sum"]) assert.match(records, new RegExp(`deliveryMethod === "${method}"`));
  assert.match(records, /status[^\n]+Estimating/);
  assert.match(records, /DESIGN-TEAM-\$\{record\.id\}/);
  assert.match(records, /onConflictDoNothing\(\)/);
  assert.match(records, /salesDesignTrackStatus: "Design Brief Required"/);
});

test("Sales Design exposes the automatically created track register", async () => {
  const [design, api, sales] = await Promise.all([
    source("app/design-lifecycle.tsx"),
    source("app/api/design-lifecycle/route.ts"),
    source("app/sales-estimating.tsx"),
  ]);
  assert.match(design, /Active Sales Design Tracks/);
  assert.doesNotMatch(design, /Automatic Design-Build Handoff/i);
  assert.match(api, /salesDesignTrackId/);
  assert.match(sales, /"Design-Build GMP"/);
  assert.match(sales, /"Design-Build Lump Sum"/);
});
