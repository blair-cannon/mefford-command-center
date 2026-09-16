import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const design = fs.readFileSync(new URL("../app/design-lifecycle.tsx", import.meta.url), "utf8");
const designApi = fs.readFileSync(new URL("../app/api/design-lifecycle/route.ts", import.meta.url), "utf8");
const estimateWorkspace = fs.readFileSync(new URL("../app/estimate-project-workspace.tsx", import.meta.url), "utf8");
const awardApi = fs.readFileSync(new URL("../app/api/estimates/award/route.ts", import.meta.url), "utf8");
const vendorFilesApi = fs.readFileSync(new URL("../app/api/vendor-portal/files/route.ts", import.meta.url), "utf8");

test("sales design is hard-limited to floor plans and renderings", () => {
  assert.match(design, /const salesDesignTypes = \["Floor Plan", "Rendering"\]/);
  assert.match(design, /No permit or construction design/);
  assert.match(designApi, /Before Award Sales Design Is Limited To Floor Plans And Renderings/);
  assert.match(designApi, /scope === "Sales" && discipline !== "Architecture"/);
});

test("architect can be assigned to each sales or project design package", () => {
  assert.match(design, /assignPackageDesigner/);
  assert.match(design, /Assigned Architect For This Design/);
  assert.match(design, /Assigned Designer For This Package/);
  assert.match(designApi, /input\.action === "assign-package-designer"/);
  assert.match(designApi, /Package Designer Assigned/);
  assert.match(designApi, /grantDesignAccess/);
});

test("sales design files automatically feed the estimate folder and follow award", () => {
  assert.match(design, /`ESTIMATE-\$\{String\(selected\.data\.opportunityId/);
  assert.match(design, /"02-Design & Drawings"/);
  assert.match(designApi, /projectId: `ESTIMATE-\$\{opportunityId\}`/);
  assert.match(designApi, /The Stored Revision File Does Not Belong To This Design Context/);
  assert.match(vendorFilesApi, /designFileProjectId = projectId === "MEFFORD-SALES"/);
  assert.match(vendorFilesApi, /"02-Design & Drawings"/);
  assert.match(estimateWorkspace, /legacySalesDesignProjectId = `DESIGN-\$\{record\.id\}`/);
  assert.match(awardApi, /transferLegacySalesDesignFiles/);
  assert.match(awardApi, /Transferred From Sales Design/);
});

test("award preserves the package architect and grants project design access", () => {
  assert.match(awardApi, /const consultantVendorId = String\(packageData\.consultantVendorId/);
  assert.match(awardApi, /`\$\{consultantVendorId\}:\$\{projectNumber\}`/);
  assert.match(awardApi, /JSON\.stringify\(\["Design Review", "Design Upload"\]\)/);
});
