import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const ui = fs.readFileSync(new URL("../app/purchase-orders.tsx", import.meta.url), "utf8");
const route = fs.readFileSync(new URL("../app/api/purchase-orders/route.ts", import.meta.url), "utf8");
const documentRoute = fs.readFileSync(new URL("../app/api/purchase-orders/document/route.ts", import.meta.url), "utf8");
const accounting = fs.readFileSync(new URL("../app/api/accounting/route.ts", import.meta.url), "utf8");
const payable = fs.readFileSync(new URL("../app/accounts-payable.tsx", import.meta.url), "utf8");

test("Purchase Orders uses its complete server-backed workspace", () => {
  assert.match(page, /active === "Purchase Orders"/);
  assert.match(page, /<PurchaseOrderWorkspace/);
  assert.match(ui, /\/api\/purchase-orders/);
  assert.match(ui, /Audit Timeline/);
  assert.match(ui, /No automatic release/);
});

test("Purchase Order lifecycle has explicit human approval and release gates", () => {
  for (const action of ["create", "update-draft", "submit", "owner-decision", "release", "acknowledge", "create-revision", "cancel"]) {
    assert.match(route, new RegExp(`input\\.action === "${action}"`));
  }
  assert.match(route, /PURCHASE_ORDER_APPROVAL_THRESHOLD/);
  assert.match(route, /context\.level !== "Company Owner"/);
  assert.match(route, /distributionReference/);
  assert.match(route, /acknowledgmentReference/);
  assert.match(route, /Superseded/);
  assert.match(route, /recordAudits/);
});

test("budget is revalidated while every Vendor Management record remains selectable", () => {
  assert.match(route, /Original Budget Must Be Locked Before Submission/);
  assert.match(route, /Cost Code Is Not Active In The Locked Budget/);
  assert.match(route, /Vendor Must Exist In Vendor Management At Submission/);
  assert.match(route, /paymentHold: compliance\.paymentBlocked/);
  assert.doesNotMatch(route, /Vendor Must Be Fully Approved/);
  assert.match(route, /data\.amount > code\.available/);
  assert.match(route, /data\.amount > PURCHASE_ORDER_APPROVAL_THRESHOLD/);
  assert.doesNotMatch(route, /Lock The Original Project Budget Before Creating A Purchase Order/);
  assert.match(ui, /Create and edit drafts now; budget lock is required only when the PO is submitted/);
});

test("Purchase Order draft is a simple branded material order with vendor and delivery terms", () => {
  assert.match(ui, /MEFFORD CONTRACTING/);
  assert.match(ui, /Vendor Information/);
  assert.match(ui, /Required Delivery Date/);
  assert.match(ui, /Material Scope \/ Description/);
  for (const field of ["freightTerms", "taxIncluded", "warranty", "specialInstructions", "contactPhone", "vendorAddress"]) assert.match(route, new RegExp(field));
  assert.match(documentRoute, /Commercial Terms/);
  assert.match(documentRoute, /Special Delivery Instructions/);
});

test("released Purchase Orders match AP while inactive revisions do not", () => {
  for (const inactive of ["Draft", "Returned", "Cancelled", "Superseded", "Voided", "Archived", "Deleted"]) {
    assert.match(accounting, new RegExp(`"${inactive}"`));
    assert.match(payable, new RegExp(`"${inactive}"`));
  }
  assert.match(route, /commitmentReference/);
  assert.match(route, /invoicedAmount/);
  assert.match(route, /paidAmount/);
});

test("controlled PDF preserves status and source-of-truth notice", () => {
  assert.match(documentRoute, /PDFDocument\.create/);
  assert.match(documentRoute, /CONTROLLED COMMITMENT/);
  assert.match(documentRoute, /does not replace the permanent record/);
  assert.match(documentRoute, /Cache-Control/);
  assert.match(documentRoute, /Purchase Order Access Is Required/);
});
