import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../app/api/selections/route.ts", import.meta.url), "utf8");
const ui = fs.readFileSync(new URL("../app/selections-workspace.tsx", import.meta.url), "utf8");

test("Selections has a dedicated permanent decision workspace", () => {
  assert.match(page, /active === "Selections"/);
  assert.match(page, /<SelectionsWorkspace/);
  assert.match(ui, /\/api\/selections/);
  assert.match(ui, /Selection Decision Register/);
  assert.match(api, /recordAudits/);
});

test("lead time creates the safe decision date and PM follow-up", () => {
  assert.match(api, /Math\.max\(0, \.\.\.options\.map/);
  assert.match(api, /\+ 7/);
  assert.match(api, /safeDecisionDate/);
  assert.match(api, /upsertWorkItem/);
  assert.match(api, /actionTarget: "Selections"/);
  assert.match(api, /closeSelectionWork/);
});

test("human authority remains explicit and evidence backed", () => {
  assert.match(api, /Named Human Approver/);
  assert.match(api, /evidenceReference/);
  assert.match(api, /recordedBy: context\.name/);
  assert.match(ui, /does not choose on their behalf/);
  assert.match(ui, /does not issue the request/);
});

test("allowance variance routes through controlled change orders", () => {
  assert.match(api, /Commercial Review Required/);
  assert.match(api, /create-impact-review/);
  assert.match(api, /recordType: "Change Orders"/);
  assert.match(api, /status: "Open"/);
  assert.match(api, /pco\.status !== "Executed"/);
  assert.match(api, /no pricing, release, or approval occurred automatically/);
});

test("released decisions retain revision and installation evidence", () => {
  for (const action of ["issue", "record-decision", "release", "verify-installation", "create-revision", "cancel"]) assert.match(api, new RegExp(`input\\.action === "${action}"`));
  assert.match(api, /Superseded By Revision/);
  assert.match(api, /installationEvidence/);
  assert.match(api, /no order, email, or payment was automatic/);
});

test("Selections includes a spreadsheet procurement schedule with live budget and vendor controls", () => {
  assert.match(ui, /update-procurement-row/);
  assert.match(ui, /Selections & Ordering/);
  assert.match(ui, /Select code/);
  assert.match(ui, /Select vendor/);
  assert.match(ui, /Upload source/);
  assert.match(api, /update-procurement-row/);
  assert.match(api, /Select A Cost Code From The Live Project Budget/);
  assert.match(api, /Selection Source/);
  assert.match(api, /env\.BUCKET\.put/);
});

test("a decided selection creates one linked purchase order draft and exposes its live status", () => {
  assert.match(api, /create-purchase-order/);
  assert.match(api, /PURCHASE_ORDER_RECORD_TYPE/);
  assert.match(api, /Controlled Draft Created From Selection/);
  assert.match(api, /purchaseOrderId/);
  assert.match(api, /purchaseOrderStatus/);
  assert.match(api, /no approval or release occurred/);
  assert.match(ui, /Create PO/);
  assert.match(ui, /Open PO/);
});
