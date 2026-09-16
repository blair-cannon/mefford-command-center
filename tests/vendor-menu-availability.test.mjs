import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [
  estimateSetup,
  estimateEditor,
  procurementApi,
  procurementUi,
  purchaseOrderApi,
  purchaseOrderUi,
  designApi,
  designUi,
  qualityApi,
  vendorsApi,
  vendorLogic,
  recordsApi,
  migration,
] = await Promise.all([
  read("../app/api/estimates/setup/route.ts"),
  read("../app/estimate-editor.tsx"),
  read("../app/api/procurement/route.ts"),
  read("../app/procurement-workspace.tsx"),
  read("../app/api/purchase-orders/route.ts"),
  read("../app/purchase-orders.tsx"),
  read("../app/api/design-lifecycle/route.ts"),
  read("../app/design-lifecycle.tsx"),
  read("../app/api/quality-control/route.ts"),
  read("../app/api/vendors/route.ts"),
  read("../lib/vendor-portal.ts"),
  read("../app/api/records/route.ts"),
  read("../drizzle/0011_vendor-compliance-payment-only.sql"),
]);

test("every vendor directory record remains available in the appropriate operational menus", () => {
  assert.match(estimateSetup, /eq\(vendorProfiles\.vendorType, "Architect"\)/);
  assert.doesNotMatch(estimateSetup, /eq\(vendorProfiles\.status, "Approved"\)/);
  assert.match(estimateEditor, /architectOptions\.map/);

  for (const source of [procurementApi, purchaseOrderApi, designApi, qualityApi]) {
    assert.match(source, /db\.select\(\)\.from\(vendorProfiles\)/);
    assert.doesNotMatch(source, /eq\(vendorProfiles\.status, "Approved"\)/);
  }

  assert.match(procurementUi, /Award and work may proceed/);
  assert.match(purchaseOrderUi, /All vendor records remain selectable/);
  assert.match(designUi, /All vendor types remain selectable; compliance affects payment only/);
});

test("temporary approval clears payment hold without changing menu visibility", () => {
  assert.match(vendorsApi, /input\.action === "create-override"/);
  assert.match(vendorsApi, /await refreshProjectAccessStatus\(db, vendorId\)/);
  assert.match(vendorLogic, /const paymentBlocked = incomplete && !activeOverride/);
  assert.match(vendorLogic, /projectBlocked: false/);
});

test("compliance can stop payment only, never selection award access or project work", () => {
  assert.match(recordsApi, /Vendor Payment Hold/);
  assert.match(recordsApi, /record\.status === "Approved Unpaid"/);
  assert.doesNotMatch(procurementApi, /award remains blocked/);
  assert.doesNotMatch(recordsApi, /Subcontract Release Hard Block/);
  assert.match(migration, /SET `status` = 'Active'/);
  assert.match(migration, /WHERE `status` = 'Compliance Blocked'/);
});
