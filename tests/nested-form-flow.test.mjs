import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [layerSource, salesSource, stylesSource] = await Promise.all([
  readFile(new URL("../app/form-modal-layer.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/sales-estimating.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
]);

test("nested forms portal above their parent and restore the opening control", () => {
  assert.match(layerSource, /createPortal\(layer, document\.body\)/);
  assert.match(layerSource, /nested-form-layer/);
  assert.match(layerSource, /parentDialog\.inert = true/);
  assert.match(layerSource, /parentDialog\.setAttribute\("aria-hidden", "true"\)/);
  assert.match(layerSource, /if \(opener\?\.isConnected\) opener\.focus\(\)/);
  assert.match(layerSource, /event\.key !== "Escape"/);
  assert.match(stylesSource, /\.modal-layer\.nested-form-layer\s*\{[\s\S]*?z-index:\s*1300/);
});

test("Sales opens a new Contact above the Opportunity without resetting its draft", () => {
  assert.match(salesSource, /openContactEditor\(undefined, true\)/);
  assert.match(salesSource, /nested=\{returnContactToOpportunity\}/);
  assert.match(salesSource, /parentDialogId="opportunity-form-dialog"/);
  assert.match(salesSource, /id="opportunity-form-dialog"/);

  const openContact = salesSource.slice(
    salesSource.indexOf("const openContactEditor"),
    salesSource.indexOf("const closeContactEditor"),
  );
  assert.doesNotMatch(openContact, /setOpportunityDraft/);
});

test("saving the nested Contact selects it and returns enriched data to Opportunity", () => {
  assert.match(salesSource, /if \(returnContactToOpportunity\) \{/);
  assert.match(salesSource, /contactId: id/);
  assert.match(salesSource, /contactName: fullName/);
  assert.match(salesSource, /company: contactDraft\.company\.trim\(\)/);
  assert.match(salesSource, /projectLocation: current\.projectLocation \|\| contactLocation/);
  assert.match(salesSource, /returnContactToOpportunity \? "Save And Select Contact"/);
  assert.match(salesSource, /closeContactEditor\(\);[\s\S]*?Saved To Sales Contacts/);
});
