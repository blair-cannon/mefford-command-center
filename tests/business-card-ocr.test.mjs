import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { extractBusinessCardFields } from "../lib/business-card-ocr.js";
import { companyMatchScore, findCompanyMatches } from "../lib/company-matching.js";

const [sales, filesApi, recordsApi, readiness, audit] = await Promise.all([
  readFile(new URL("../app/sales-estimating.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/files/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/records/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/section-readiness.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/system-audit.ts", import.meta.url), "utf8"),
]);

test("business card OCR extracts a complete representative contact", () => {
  const result = extractBusinessCardFields(`
JORDAN MEFFORD
President
Mefford Contracting LLC
3667 US Highway 227
Carrollton, KY 41008
Office (502) 732-0123
Cell 502-548-1469
jmefford@meffcon.com
www.meffcon.com
  `);
  assert.deepEqual({ firstName: result.firstName, lastName: result.lastName, company: result.company, jobTitle: result.jobTitle }, { firstName: "Jordan", lastName: "Mefford", company: "Mefford Contracting LLC", jobTitle: "President" });
  assert.equal(result.email, "jmefford@meffcon.com");
  assert.equal(result.phone, "(502) 548-1469");
  assert.equal(result.address, "3667 US Highway 227");
  assert.equal(result.city, "Carrollton");
  assert.equal(result.state, "KY");
  assert.equal(result.postalCode, "41008");
  assert.equal(result.website, "www.meffcon.com");
  assert.equal(result.confidence, "High Confidence");
});

test("business card OCR handles inline titles and a one-line suite address", () => {
  const result = extractBusinessCardFields(`Bluegrass Architects, Inc.\nAmanda Neal | Project Architect\n123 Main Street, Suite 200, Louisville, KY 40202\nP: 502.555.0199\namanda@bluegrassarchitects.com\nbluegrassarchitects.com`);
  assert.equal(result.firstName, "Amanda");
  assert.equal(result.lastName, "Neal");
  assert.equal(result.jobTitle, "Project Architect");
  assert.equal(result.address, "123 Main Street, Suite 200");
  assert.equal(result.city, "Louisville");
  assert.equal(result.state, "KY");
  assert.equal(result.postalCode, "40202");
  assert.equal(result.website, "bluegrassarchitects.com");
});

test("contact intake uses camera OCR, blocks unreviewed suggestions, and preserves the source", () => {
  for (const phrase of ["capture=\"environment\"", "recognizeMobileDocument", "extractBusinessCardFields", "Review The Business Card Suggestions Against The Photo", "Human Reviewed", "Original Business Card · OCR Source", "originalPreserved: true", "ZIP / Postal Code", "Website"]) assert.match(sales, new RegExp(phrase));
  assert.match(sales, /businessCardOcr\.status === "ready" && !businessCardOcr\.confirmed/);
  assert.match(filesApi, /canAccessSalesContactFile/);
  assert.match(filesApi, /Sales Contacts \/"/);
  assert.match(readiness, /original business-card images, and reviewed OCR evidence/);
  assert.match(audit, /Business Cards And Contact Intake/);
});

test("company identity guard works for every company name without treating unrelated trades as duplicates", () => {
  assert.equal(companyMatchScore("NAS", "North American Stainless"), 96);
  assert.equal(companyMatchScore("Mefford Contracting, LLC", "Mefford Contracting"), 98);
  assert.ok(companyMatchScore("Bluegras Electrical", "Bluegrass Electrical") >= 86);
  assert.equal(companyMatchScore("ABC Plumbing", "ABC Electric"), 0);
  assert.deepEqual(findCompanyMatches("NAS", ["North American Stainless", "Mefford Contracting"]).map((item) => item.company), ["North American Stainless"]);
  for (const phrase of ["Possible Existing", "Resolve Company Match First", "Confirmed Separate", "companyNameHistory", "Ambiguous Company Name", "resolvedCompanyMatches"]) assert.match(sales, new RegExp(phrase));
  assert.match(recordsApi, /companyMatchScore/);
  assert.match(recordsApi, /This Company Looks Like An Existing Company/);
  assert.match(recordsApi, /companyMatches/);
  assert.match(readiness, /universal acronym, legal-suffix, punctuation, word-overlap, and typo matching/);
  assert.match(audit, /Company Identity Guard/);
});
