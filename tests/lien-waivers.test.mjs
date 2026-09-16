import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("lien waiver master defines the six approved jurisdictions and four separate forms", async () => {
  const source = await read("../lib/lien-waivers.ts");
  for (const state of ["KY", "IN", "WV", "TN", "MN", "IL"]) assert.match(source, new RegExp(`${state}: \\{`), state);
  for (const type of ["conditional-progress", "unconditional-progress", "conditional-final", "unconditional-final"]) assert.match(source, new RegExp(`"${type}"`), type);
  assert.match(source, /Public \/ Bonded/);
  assert.match(source, /canIssueUnconditionalWaiver/);
});

test("payment workflow never auto-signs an unconditional release", async () => {
  const route = await read("../app/api/lien-waivers/route.ts");
  assert.match(route, /Unconditional Forms Are Created Only After Cleared Payment/);
  assert.match(route, /Unconditional Waiver Blocked Until Accounting Records Cleared Payment/);
  assert.match(route, /no signature or approval was created automatically/);
  assert.match(route, /Company Owner Override/);
  assert.match(route, /doesNotCreateOrSignWaiver: true/);
});

test("billing intake creates conditional requests and AP approval enforces the payment gate", async () => {
  const [records, portal, helper] = await Promise.all([
    read("../app/api/records/route.ts"),
    read("../app/api/vendor-portal/route.ts"),
    read("../lib/lien-waivers-server.ts"),
  ]);
  assert.match(records, /ensureConditionalWaiverForBilling/);
  assert.match(records, /Lien Waiver Payment Hard Block/);
  assert.match(portal, /waiverId = await ensureConditionalWaiverForBilling/);
  assert.match(portal, /action === "sign-lien-waiver"/);
  assert.match(helper, /Automatic Conditional Waiver Request/);
});

test("one-page branded forms and annual Review Center inventory are wired", async () => {
  const [document, review, ui, signaturePad, portal] = await Promise.all([
    read("../app/api/lien-waivers/document/route.ts"),
    read("../lib/template-review.ts"),
    read("../app/lien-waivers.tsx"),
    read("../app/signature-pad.tsx"),
    read("../app/vendor-portal.tsx"),
  ]);
  assert.match(document, /@page\{size:letter portrait/);
  assert.match(document, /MEFFORD <b>CONTRACTING/);
  assert.match(document, /Notary Acknowledgment/);
  assert.match(document, /Print \/ Save PDF/);
  for (const id of ["lien-conditional-progress", "lien-unconditional-progress", "closeout-conditional-lien", "closeout-unconditional-lien"]) assert.match(review, new RegExp(id));
  assert.doesNotMatch(ui, /Four clear forms, six state rule profiles/);
  assert.match(ui, /Record Final Payment Cleared/);
  assert.match(signaturePad, /Apple Pencil/);
  assert.match(signaturePad, /toDataURL\("image\/png"\)/);
  assert.match(portal, /signatureImage/);
});

test("lien waiver loading terminates cleanly with zero or inaccessible projects", async () => {
  const [ui, route] = await Promise.all([
    read("../app/lien-waivers.tsx"),
    read("../app/api/lien-waivers/route.ts"),
  ]);
  assert.match(ui, /if \(!rows\.length\) \{[\s\S]*?setLoading\(false\)/);
  assert.match(ui, /No Eligible Projects Yet/);
  assert.match(ui, /Lien Waivers Could Not Load/);
  assert.match(ui, />Retry</);
  assert.match(route, /const visibleProjectRows = permissions\.canAccountingReview/);
  assert.match(route, /project\.projectManager\?\.trim\(\)\.toLowerCase\(\) === actor\.name\.trim\(\)\.toLowerCase\(\)/);
  assert.match(route, /projects: visibleProjectRows\.map/);
});
