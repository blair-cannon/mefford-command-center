import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { extractQuoteFields } from "../lib/quote-ocr.js";

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const vendorPortal = fs.readFileSync(new URL("../app/vendor-portal.tsx", import.meta.url), "utf8");
const bidApi = fs.readFileSync(new URL("../app/api/vendor-portal/bids/route.ts", import.meta.url), "utf8");
const fileApi = fs.readFileSync(new URL("../app/api/vendor-portal/files/route.ts", import.meta.url), "utf8");
const estimateWorkspace = fs.readFileSync(new URL("../app/estimate-project-workspace.tsx", import.meta.url), "utf8");
const procurement = fs.readFileSync(new URL("../lib/procurement.ts", import.meta.url), "utf8");

test("Bid Management remains in the authorized Estimating tool group", () => {
  const preconstruction = page.slice(page.indexOf("const preconstructionNavGroups"), page.indexOf("const companyNavFolders"));
  const estimatingStart = preconstruction.indexOf('label: "Estimating"');
  const marketingStart = preconstruction.indexOf('label: "Marketing"', estimatingStart);
  const salesStart = preconstruction.indexOf('label: "Sales"');
  const estimating = preconstruction.slice(estimatingStart, marketingStart);
  const sales = preconstruction.slice(salesStart, estimatingStart);

  assert.match(estimating, /target: "Estimating"/);
  assert.match(estimating, /target: "Estimating Calendar"/);
  assert.match(estimating, /target: "Bid Management"/);
  assert.doesNotMatch(sales, /target: "Bid Management"/);
  assert.match(page, /visiblePreconstructionNavGroups\.flatMap/);
  assert.doesNotMatch(page, /sales-direct-tools/);
});

test("quote parser prefers the contextual grand total and extracts the included scope", () => {
  const result = extractQuoteFields(`
    ABC Mechanical Proposal
    SCOPE OF WORK:
    Furnish and install the complete HVAC system shown on plans, including labor, materials, equipment, controls, testing, and startup.
    Exclusions: electrical service and permit fees.
    Subtotal: $180,000.00
    Tax: $7,450.00
    GRAND TOTAL: $187,450.00
  `);

  assert.equal(result.price, 187450);
  assert.match(result.priceSource, /GRAND TOTAL/i);
  assert.match(result.scope, /complete HVAC system/i);
  assert.doesNotMatch(result.scope, /Exclusions/i);
  assert.equal(result.confidence, "High");
});

test("quote parser does not mistake an allowance for the total quote", () => {
  const result = extractQuoteFields(`
    Plumbing Quote
    Work Included: Provide labor and material for the complete domestic water and sanitary system.
    Allowance: $85,000.00
    Total Quote: $62,500.00
  `);

  assert.equal(result.price, 62500);
  assert.match(result.scope, /domestic water/i);
});

test("vendor quote intake uses OCR when readable and manual confirmation for every other file", () => {
  assert.match(vendorPortal, /recognizeMobileDocument/);
  assert.match(vendorPortal, /extractQuoteFields/);
  assert.match(vendorPortal, /ocrReviewConfirmed/);
  assert.match(vendorPortal, /I compared the price and scope below to the attached quote/);
  assert.match(vendorPortal, /Any File Type · 25 MB Maximum · OCR When Readable/);
  assert.match(vendorPortal, /confidence: "Manual Review"/);
  assert.match(bidApi, /OCR Price And Scope Must Be Reviewed Against The Quote Before Submission/);
  assert.match(bidApi, /status: "Human Reviewed"/);
  assert.match(bidApi, /Manual Review · Original File Preserved/);
  assert.doesNotMatch(bidApi, /Quote OCR Requires A PDF Or Image File/);
  assert.match(fileApi, /normalizeUploadContentType/);
  assert.doesNotMatch(fileApi, /Quote OCR Requires A PDF Or Image File/);
});

test("reviewed quote originals live in the estimate Quotes folder", () => {
  assert.match(procurement, /PROCUREMENT_FILE_CATEGORY = "03-Estimating - Quotes"/);
  assert.match(estimateWorkspace, /label: "03-Estimating · Quotes"/);
  assert.match(estimateWorkspace, /Quotes Enter Through Bid Management/);
  assert.match(estimateWorkspace, /folderFiles\.map/);
});
