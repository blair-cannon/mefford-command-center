import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";

import {
  OWNER_CONTRACT_CONTACT_ROUTING_FIELDS,
  OWNER_CONTRACT_PRIMARY_PARTY_FIELDS,
  OWNER_CONTRACT_ROUTING_OVERRIDE_FIELDS,
  OWNER_CONTRACT_TYPES,
  SMALL_PROJECT_PRICING_METHODS,
  applyOwnerContractCommercialTerms,
  contractFieldInput,
  contractFieldGroup,
  contractFieldLabel,
  contractTemplate,
  contractTemplateForStoredVersion,
  isPercentageContractField,
  isScalarMoneyContractField,
  normalizeOwnerContractCommercialTerms,
  normalizeSmallProjectPricingMethod,
  requiredContractFields,
  synchronizeOwnerContractContactFields,
  withOwnerContractComputedFields,
} from "../lib/owner-contracts.ts";
import {
  formatOwnerContractFieldValue,
  OWNER_CONTRACT_DOCUMENT_CSS,
  renderOwnerContractTemplate,
} from "../lib/owner-contract-document.ts";
import { createEditableOwnerContractDocx } from "../lib/owner-contract-docx.ts";
import {
  buildOwnerContractPrefill,
  mergeOwnerContractPrefill,
} from "../lib/owner-contract-prefill.ts";
import {
  normalizeOwnerContractCompany,
  selectOwnerContractContact,
} from "../lib/owner-contract-contact.ts";
import { newEstimateData } from "../app/estimate-template.ts";
import { normalizePreAwardContractFields } from "../lib/preaward-owner-contract.ts";
import {
  isOwnerContractBasisField,
  isPdfProjectFile,
  ownerContractBasisAttachments,
  withOwnerContractBasisFile,
  withOwnerContractBasisRevision,
} from "../lib/owner-contract-basis.ts";
import { renderOwnerContractBasisSchedule } from "../lib/owner-contract-basis-document.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Command Center exposes the five controlled paths and the current uploaded masters", async () => {
  assert.deepEqual([...OWNER_CONTRACT_TYPES], [
    "Design-Build GMP",
    "Design-Build Lump Sum",
    "Plan & Spec Lump Sum",
    "Time & Materials",
    "External Contract",
  ]);
  assert.deepEqual(
    OWNER_CONTRACT_TYPES.map((type) => [type, contractTemplate(type).id, contractTemplate(type).htmlPath]),
    [
      ["Design-Build GMP", "MC-OWN-DBGMP-001", "/contract-templates/legal-review/design-build-gmp-agreement.html"],
      ["Design-Build Lump Sum", "MC-OWN-DBLS-001", "/contract-templates/legal-review/design-build-lump-sum.html"],
      ["Plan & Spec Lump Sum", "MC-OWN-LSPS-001", "/contract-templates/legal-review/plan-and-specifications-lump-sum.html"],
      ["Time & Materials", "MC-OWN-SMALL-001", "/contract-templates/legal-review/time-and-materials.html"],
      ["External Contract", "MC-OWN-EXT-001", "/contract-templates/external-contract-cover.html"],
    ],
  );
  assert.equal(contractTemplate("Time & Materials").label, "Small Projects / T&M");
  const definitions = await read("../lib/owner-contracts.ts");
  assert.match(definitions, /"Design-Build GMP"/);
  assert.match(definitions, /"Design-Build Lump Sum"/);
  assert.match(definitions, /"Plan & Spec Lump Sum"/);
  assert.match(definitions, /"Time & Materials"/);
  assert.match(definitions, /"External Contract"/);
  assert.doesNotMatch(definitions, /Construction Management/);
  assert.match(definitions, /MC-OWN-DBGMP-001/);
  assert.match(definitions, /MC-OWN-DBGMP-001-A/);
  assert.match(definitions, /MC-OWN-DBLS-001/);
  assert.match(definitions, /MC-OWN-LSPS-001/);
  assert.match(definitions, /MC-OWN-SMALL-001/);
  assert.match(definitions, /MC-OWN-TM-001/);
  assert.match(definitions, /MC-OWN-EXT-001/);
  assert.match(definitions, /design-build-gmp-agreement\.docx/);
  assert.match(definitions, /design-build-gmp-exhibit-a\.docx/);
  assert.match(definitions, /design-build-lump-sum\.docx/);
  assert.match(definitions, /plan-and-specifications-lump-sum\.docx/);
  assert.match(definitions, /time-and-materials-rev-1\.2\.docx/);
  assert.match(definitions, /Rev\. 3\.0 · Current Controlled Master/);
  assert.match(definitions, /Rev\. 2\.0 · Current Controlled Master/);
  assert.match(definitions, /Rev\. 1\.2 · Current Controlled Master/);
  assert.doesNotMatch(definitions, /Interim Attorney Review Copy/);
});

test("each current Mefford master contains its revision and every required editable field", async () => {
  const cases = [
    ["Design-Build GMP", "Phase 1 Agreement", "REV. 3.0", /Two-Stage Transaction/],
    ["Design-Build GMP", "GMP Exhibit A", "REV. 3.0", /Pay-if-Paid Owner Acknowledgment/],
    ["Design-Build Lump Sum", "Primary Agreement", "REV. 1.2", /Initial Payment Due Upon Execution/],
    ["Plan & Spec Lump Sum", "Primary Agreement", "REV. 1.2", /Matching Performance Bonus/],
    ["Time & Materials", "Primary Agreement", "REV. 2.0", /Small Project Construction Contract/],
  ];

  for (const [type, instrument, revision, legalText] of cases) {
    const template = contractTemplate(type, instrument);
    const html = await read(`../public${template.htmlPath}`);
    const editableFields = new Set([...html.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)].map((match) => match[1]));
    if (type === "Time & Materials") {
      for (const field of OWNER_CONTRACT_CONTACT_ROUTING_FIELDS) editableFields.add(field);
      editableFields.add("SMALL_PROJECT_PRICING_METHOD");
      editableFields.add("PERSONAL_GUARANTY_REQUIRED_YES_OR_NO");
    }
    const missing = requiredContractFields(type, instrument).filter((field) => !editableFields.has(field));
    assert.match(html, new RegExp(revision.replace(".", "\\.")), `${type} must identify ${revision}`);
    assert.match(html, legalText, `${type} must retain the uploaded legal text`);
    assert.deepEqual(missing, [], `${type} ${instrument} required fields must exist in its current master`);
  }
});

test("released contracts retain archived master revisions while editable drafts use current masters", () => {
  const currentGmp = contractTemplateForStoredVersion("Design-Build GMP", "Phase 1 Agreement", "Rev. 3.0 · Current Controlled Master");
  const archivedGmp = contractTemplateForStoredVersion("Design-Build GMP", "Phase 1 Agreement", "Rev. 2.1 · Interim Attorney Review Copy");
  const archivedExhibit = contractTemplateForStoredVersion("Design-Build GMP", "GMP Exhibit A", "Rev. 2.1 · Interim Attorney Review Copy");
  const archivedLumpSum = contractTemplateForStoredVersion("Design-Build Lump Sum", "Primary Agreement", "Rev. 1.0 · Interim Attorney Review Copy");
  const archivedTimeAndMaterials = contractTemplateForStoredVersion("Time & Materials", "Primary Agreement", "Rev. 1.2 · Current Controlled Master");
  const currentSmallProject = contractTemplateForStoredVersion("Time & Materials", "Primary Agreement", "Rev. 2.0 · Current Controlled Master");
  const archivedWithoutVersion = contractTemplateForStoredVersion("Time & Materials", "Primary Agreement", "");

  assert.equal(currentGmp.htmlPath, "/contract-templates/legal-review/design-build-gmp-agreement.html");
  assert.equal(archivedGmp.htmlPath, "/contract-templates/legal-review/archive/design-build-gmp-agreement-rev-2.1.html");
  assert.equal(archivedExhibit.docxPath, "/contract-templates/legal-review/archive/design-build-gmp-exhibit-a-rev-2.1.docx");
  assert.equal(archivedLumpSum.htmlPath, "/contract-templates/legal-review/archive/design-build-lump-sum-rev-1.0.html");
  assert.equal(archivedTimeAndMaterials.htmlPath, "/contract-templates/legal-review/archive/time-and-materials-rev-1.2.html");
  assert.equal(archivedTimeAndMaterials.docxPath, "/contract-templates/legal-review/archive/time-and-materials-rev-1.2.docx");
  assert.equal(currentSmallProject.htmlPath, "/contract-templates/legal-review/time-and-materials.html");
  assert.equal(currentSmallProject.docxPath, null);
  assert.equal(archivedWithoutVersion.docxPath, "/contract-templates/legal-review/archive/time-and-materials-rev-1.0.docx");
});

test("small-project contract exposes three synchronized pricing arrangements", async () => {
  assert.deepEqual(SMALL_PROJECT_PRICING_METHODS.map((item) => item.value), [
    "Lump Sum",
    "Time & Materials",
    "Time & Materials Not to Exceed",
  ]);
  assert.equal(normalizeSmallProjectPricingMethod("fixed price"), "Lump Sum");
  assert.equal(normalizeSmallProjectPricingMethod("T&M"), "Time & Materials");
  assert.equal(normalizeSmallProjectPricingMethod("NTE"), "Time & Materials Not to Exceed");

  const template = await read("../public/contract-templates/legal-review/time-and-materials.html");
  const common = {
    SMALL_PROJECT_CONTRACT_AMOUNT: "1580000",
    CONTRACTOR_FEE_PROFIT_PERCENTAGE: "10",
    TIME_AND_MATERIALS_RATE_SCHEDULE: "Project Manager — $125.00 per hour",
    PERSONAL_GUARANTY_REQUIRED_YES_OR_NO: "NO",
  };
  const cases = [
    ["Lump Sum", /2\.1 Lump Sum Contract Price/, /Time and Materials Rate Schedule/],
    ["Time & Materials", /2\.1 Time and Materials Rate Schedule/, /Not-to-Exceed Amount/],
    ["Time & Materials Not to Exceed", /2\.1 Time and Materials Not-to-Exceed Amount/, /Lump Sum Contract Price/],
  ];
  for (const [method, included, excluded] of cases) {
    const fields = withOwnerContractComputedFields("Time & Materials", { ...common, SMALL_PROJECT_PRICING_METHOD: method });
    const rendered = renderOwnerContractTemplate(template, fields);
    assert.match(rendered, included);
    assert.doesNotMatch(rendered, excluded);
    assert.doesNotMatch(rendered, /\{\{#?\/?IF_/);
    assert.doesNotMatch(rendered, /%10/);
  }

  const nte = withOwnerContractComputedFields("Time & Materials", { ...common, SMALL_PROJECT_PRICING_METHOD: "Time & Materials Not to Exceed" });
  assert.match(nte.SMALL_PROJECT_PRICE_TERMS, /\$1,580,000\.00/);
  assert.match(nte.SMALL_PROJECT_PRICE_TERMS, /10%/);
  assert.match(nte.SMALL_PROJECT_CONTRACT_ARRANGEMENT, /not a lump-sum entitlement/i);
  assert.equal(nte.SMALL_PROJECT_GUARANTEE_TERMS, "No personal guaranty is required under this Contract.");
});

test("small-project required fields follow the selected arrangement", () => {
  const lump = requiredContractFields("Time & Materials", "Primary Agreement", { SMALL_PROJECT_PRICING_METHOD: "Lump Sum" });
  const open = requiredContractFields("Time & Materials", "Primary Agreement", { SMALL_PROJECT_PRICING_METHOD: "Time & Materials" });
  const nte = requiredContractFields("Time & Materials", "Primary Agreement", { SMALL_PROJECT_PRICING_METHOD: "Time & Materials Not to Exceed" });
  assert.ok(lump.includes("SMALL_PROJECT_CONTRACT_AMOUNT"));
  assert.ok(!lump.includes("TIME_AND_MATERIALS_RATE_SCHEDULE"));
  assert.ok(!open.includes("SMALL_PROJECT_CONTRACT_AMOUNT"));
  assert.ok(open.includes("TIME_AND_MATERIALS_RATE_SCHEDULE"));
  assert.ok(open.includes("CONTRACTOR_FEE_PROFIT_PERCENTAGE"));
  assert.ok(nte.includes("SMALL_PROJECT_CONTRACT_AMOUNT"));
  assert.ok(nte.includes("TIME_AND_MATERIALS_RATE_SCHEDULE"));
  assert.ok(requiredContractFields("Time & Materials", "Primary Agreement", {
    SMALL_PROJECT_PRICING_METHOD: "Lump Sum",
    PERSONAL_GUARANTY_REQUIRED_YES_OR_NO: "YES",
  }).includes("GUARANTOR_NAME"));
});

test("small-project master is generic, black-and-white, compact, and edited from one shared pricing panel", async () => {
  const [template, panel, awardedStudio, preAwardStudio] = await Promise.all([
    read("../public/contract-templates/legal-review/time-and-materials.html"),
    read("../app/small-project-pricing-panel.tsx"),
    read("../app/owner-contracts.tsx"),
    read("../app/preaward-owner-contract-studio.tsx"),
  ]);
  assert.doesNotMatch(template, /Johnstone|Ridgewater|3900 Roll|Bloomington/i);
  assert.doesNotMatch(template, /color:\s*red/i);
  for (const [, color] of template.matchAll(/#([0-9a-f]{3}|[0-9a-f]{6})\b/gi)) {
    const expanded = color.length === 3 ? color.split("").map((character) => character.repeat(2)).join("") : color;
    assert.equal(expanded.slice(0, 2), expanded.slice(2, 4));
    assert.equal(expanded.slice(2, 4), expanded.slice(4, 6));
  }
  assert.doesNotMatch(template, /<img\b/i);
  assert.doesNotMatch(template, /logo/i);
  assert.equal((template.match(/class="page-break-before"/g) || []).length, 1, "only the signature page starts a new page");
  assert.match(panel, /Choose The Pricing Method For This Contract/);
  assert.match(awardedStudio, /SmallProjectPricingPanel/);
  assert.match(preAwardStudio, /SmallProjectPricingPanel/);
  assert.match(preAwardStudio, /<option key=\{type\} value=\{type\}>\{contractTemplate\(type\)\.label\}<\/option>/);
  assert.ok(
    awardedStudio.indexOf('<section className="contract-type-picker"')
      < awardedStudio.indexOf('<SmallProjectPricingPanel fields={fields}'),
    "all five contract forms must appear before the T&M-only pricing choices",
  );
});

test("Design-Build GMP preserves Phase 1 and opens a separately executed Exhibit A", async () => {
  const [definitions, api, workspace, document] = await Promise.all([
    read("../lib/owner-contracts.ts"), read("../app/api/contracts/route.ts"),
    read("../app/owner-contracts.tsx"), read("../app/api/contracts/document/route.ts"),
  ]);
  assert.match(definitions, /"Phase 1 Agreement", "GMP Exhibit A"/);
  assert.match(definitions, /COST_OF_THE_WORK_SUBTOTAL/);
  assert.match(api, /Phase 1 Executed/);
  assert.match(api, /open-gmp-exhibit-a/);
  assert.match(api, /"Draft", "Draft Preparation", "Mefford Revision", "GMP Exhibit A Draft"/);
  assert.match(api, /phaseExecutions/);
  assert.match(api, /Construction remains blocked until GMP Exhibit A is executed/);
  assert.match(workspace, /Open GMP Exhibit A/);
  assert.match(workspace, /PROJECT OWNER CONTRACT/);
  assert.match(workspace, /proposal-studio-shell/);
  assert.match(workspace, /proposal-step-rail/);
  assert.doesNotMatch(workspace, /INTERIM ATTORNEY REVIEW MASTERS/);
  assert.match(document, /contractTemplate\(contractType, activeInstrument\)/);
  assert.match(document, /contractTemplateForStoredVersion\(contractType, activeInstrument/);
});

test("external contract intake preserves the controlling file and maps obligations", async () => {
  const [definitions, workspace, document, template] = await Promise.all([
    read("../lib/owner-contracts.ts"), read("../app/owner-contracts.tsx"),
    read("../app/api/contracts/document/route.ts"), read("../public/contract-templates/external-contract-cover.html"),
  ]);
  assert.match(definitions, /EXTERNAL_CONTRACT_FILE_ID/);
  assert.match(definitions, /EXTERNAL_CHANGE_ORDER_PROCEDURE/);
  assert.match(definitions, /EXTERNAL_DISPUTE_AND_TERMINATION_TERMS/);
  assert.match(workspace, /Contracts \/ External Agreement/);
  assert.doesNotMatch(workspace, /The uploaded original controls/);
  assert.match(document, /Open Controlling External Contract/);
  assert.match(template, /uploaded external agreement is the controlling contract/i);
});

test("scope and drawing PDFs are bound to exact contract revisions", async () => {
  const scopeFile = { id: 81, name: "Issued Scope.pdf", category: "05-Owner Proposal & LOE", revision: "Rev. 1", contentType: "application/pdf", sizeBytes: 125000 };
  const drawingFile = { id: 82, name: "Permit Set.PDF", category: "02-Design & Drawings", revision: "Issued 9/10/2026", contentType: "application/octet-stream", sizeBytes: 2250000 };
  let fields = withOwnerContractBasisFile({}, "scope", scopeFile);
  fields = withOwnerContractBasisFile(fields, "drawings", drawingFile);
  fields = withOwnerContractBasisRevision(fields, "scope", "Rev. 2 · Issued 9/10/2026");

  assert.equal(isPdfProjectFile(scopeFile), true);
  assert.equal(isPdfProjectFile(drawingFile), true);
  assert.equal(isPdfProjectFile({ name: "scope.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), false);
  assert.equal(isOwnerContractBasisField("CONTRACT_BASIS_SCOPE_PDF_FILE_ID"), true);
  assert.equal(isOwnerContractBasisField("PROJECT_NAME"), false);
  assert.deepEqual(ownerContractBasisAttachments(fields).map((attachment) => [attachment.kind, attachment.fileId, attachment.revision]), [
    ["scope", 81, "Rev. 2 · Issued 9/10/2026"],
    ["drawings", 82, "Issued 9/10/2026"],
  ]);

  const schedule = renderOwnerContractBasisSchedule(fields, (fileId) => `/api/files?id=${fileId}`);
  assert.match(schedule, /Contract Basis PDFs/);
  assert.match(schedule, /Issued Scope\.pdf/);
  assert.match(schedule, /Permit Set\.PDF/);
  assert.match(schedule, /subject to the Contract’s existing order-of-precedence terms/);
  assert.match(schedule, /\/api\/files\?id=81/);

  fields = withOwnerContractBasisFile(fields, "scope", null);
  assert.deepEqual(ownerContractBasisAttachments(fields).map((attachment) => attachment.kind), ["drawings"]);
});

test("both contract builders validate, print, release, and expose basis PDFs without turning metadata into clauses", async () => {
  const [component, awardedStudio, preAwardStudio, contractApi, preAwardApi, documentApi, ownerApi, ownerPortal] = await Promise.all([
    read("../app/contract-basis-attachments.tsx"),
    read("../app/owner-contracts.tsx"),
    read("../app/preaward-owner-contract-studio.tsx"),
    read("../app/api/contracts/route.ts"),
    read("../app/api/preaward-contracts/route.ts"),
    read("../app/api/contracts/document/route.ts"),
    read("../app/api/project-owner/route.ts"),
    read("../app/project-owner-portal.tsx"),
  ]);
  assert.match(component, /Choose Existing Project PDF/);
  assert.match(component, /Upload A New PDF/);
  assert.match(component, /accept="application\/pdf,\.pdf"/);
  assert.match(component, /Revision \/ Issue Date/);
  assert.match(component, /multipart\?action=create/);
  assert.match(awardedStudio, /<ContractBasisAttachments projectId=\{project\.number\}/);
  assert.match(preAwardStudio, /<ContractBasisAttachments projectId=\{`ESTIMATE-\$\{opportunity\.id\}`\}/);
  assert.match(contractApi, /validateOwnerContractBasisPdfs/);
  assert.match(contractApi, /ownerContractBasisAccessStatements/);
  assert.match(preAwardApi, /validateOwnerContractBasisPdfs/);
  assert.match(documentApi, /renderOwnerContractBasisSchedule/);
  assert.match(ownerApi, /basisAttachments: ownerContractBasisAttachments/);
  assert.match(ownerApi, /!isOwnerContractBasisField\(key\)/);
  assert.match(ownerPortal, /Contract Basis PDFs/);
  assert.match(ownerPortal, /Open PDF ↗/);
});

test("owner contract saves synchronize Projects Accounting and Owner Billing", async () => {
  const api = await read("../app/api/contracts/route.ts");
  assert.match(api, /UPDATE projects SET owner_name/);
  assert.match(api, /OWNER-BILLING-SETUP/);
  assert.match(api, /MEFFORD-ACCOUNTING/);
  assert.match(api, /Owner Contract Setup/);
  assert.match(api, /sourceOfTruth: "Owner Contract Record"/);
  assert.match(api, /accountingSynchronized: true/);
});

test("F-10 uses one bounded payment and retainage source across contract billing and accounting setup", () => {
  const terms = normalizeOwnerContractCommercialTerms({
    paymentTerms: " Net 15 after approved monthly billing ",
    retainageInitialPercent: "7.5%",
    retainageAfterHalfPercent: 2.5,
  });
  const fields = applyOwnerContractCommercialTerms({}, terms);

  assert.deepEqual(terms, {
    paymentTerms: "Net 15 after approved monthly billing",
    retainageInitialPercent: "7.5",
    retainageAfterHalfPercent: "2.5",
    retainageTerms: "7.5% until 50% completion, then 2.5%; release as required by Project-state law.",
  });
  assert.equal(fields.PAYMENT_TERMS, terms.paymentTerms);
  assert.equal(fields.REMAINING_PAYMENT_SCHEDULE, terms.paymentTerms);
  assert.equal(fields.RETAINAGE_TERMS, terms.retainageTerms);
  assert.equal(fields.RETAINAGE_TERMS_AND_RELEASE, terms.retainageTerms);
  assert.equal(fields.CONSTRUCTION_RETAINAGE, terms.retainageTerms);
  assert.equal(fields.RETAINAGE_PERCENTAGE, "7.5");

  assert.equal(normalizeOwnerContractCommercialTerms({ retainageInitialPercent: 120 }).retainageInitialPercent, "100");
  assert.equal(normalizeOwnerContractCommercialTerms({ retainageAfterHalfPercent: -2 }).retainageAfterHalfPercent, "0");
  assert.equal(normalizeOwnerContractCommercialTerms({ retainageInitialPercent: "invalid" }).retainageInitialPercent, "10");
});

test("owner contract lifecycle requires controlled release and two signatures", async () => {
  const [api, workspace, document] = await Promise.all([
    read("../app/api/contracts/route.ts"),
    read("../app/owner-contracts.tsx"),
    read("../app/api/contracts/document/route.ts"),
  ]);
  assert.match(api, /Ready for Signature/);
  assert.match(api, /Partially Signed/);
  assert.match(api, /Executed/);
  assert.match(api, /The Executed Contract Is Immutable/);
  assert.match(workspace, /Project Owner Signature/);
  assert.match(workspace, /Mefford Countersignature/);
  assert.match(workspace, /SignaturePad/);
  assert.match(document, /Print \/ Save PDF/);
  assert.match(document, /Download Editable Word Copy/);
  assert.match(document, /ownerPortalSession/);
  assert.match(document, /Master Source/);
  assert.doesNotMatch(document, /Interim master under attorney review/);
});

test("printed owner contracts apply conventional money and percentage formatting", () => {
  assert.equal(formatOwnerContractFieldValue("GMP_AMOUNT", "1234567.8"), "$1,234,567.80");
  assert.equal(formatOwnerContractFieldValue("PHASE_ONE_DESIGN_AND_PRECONSTRUCTION_FEE", "$25,000"), "$25,000.00");
  assert.equal(formatOwnerContractFieldValue("NTE_AMOUNT_OR_NOT_APPLICABLE", "250000"), "$250,000.00");
  assert.equal(formatOwnerContractFieldValue("NTE_AMOUNT_OR_NOT_APPLICABLE", "Not Applicable"), "Not Applicable");
  assert.equal(formatOwnerContractFieldValue("CONTRACTOR_FEE_PROFIT_PERCENTAGE", "%10"), "10%");
  assert.equal(formatOwnerContractFieldValue("RETAINAGE_PERCENTAGE", "7.50%"), "7.5%");
  assert.equal(formatOwnerContractFieldValue("GMP_AMOUNT", "TBD pending Exhibit A"), "TBD pending Exhibit A");

  const rendered = renderOwnerContractTemplate(
    '<p>${{GMP_AMOUNT}}</p><p>% {{CONTRACTOR_FEE_PROFIT_PERCENTAGE}}</p><p>{{RETAINAGE_PERCENTAGE}}%</p><p><br><br></p>',
    { GMP_AMOUNT: "1234567.8", CONTRACTOR_FEE_PROFIT_PERCENTAGE: "%10", RETAINAGE_PERCENTAGE: "7.50%" },
  );
  assert.match(rendered, /\$1,234,567\.80/);
  assert.match(rendered, />10%</);
  assert.match(rendered, />7\.5%</);
  assert.doesNotMatch(rendered, /\$\$/);
  assert.doesNotMatch(rendered, /%\s*10/);
  assert.doesNotMatch(rendered, /<p><br>/);

  const protectedSignature = renderOwnerContractTemplate("{{OWNER_SIGNATURE}}", { OWNER_SIGNATURE: "<script>alert(1)</script>" }, { trustedHtmlFields: ["OWNER_SIGNATURE"] });
  assert.equal(protectedSignature, "&lt;script&gt;alert(1)&lt;/script&gt;");
});

test("small-project print spacing adapts to compact, standard, and extended inputs", async () => {
  const source = '<div class="scope-block">{{CONSTRUCTION_SCOPE_OF_WORK}}</div>';
  const compact = renderOwnerContractTemplate(source, {
    CONSTRUCTION_SCOPE_OF_WORK: "Replace the rear entry door.",
  }, { adaptiveValues: true });
  const standard = renderOwnerContractTemplate(source, {
    CONSTRUCTION_SCOPE_OF_WORK: "Remove the existing rear entry door and frame. Install the scheduled replacement door, hardware, trim, sealants, and touch-up finishes.",
  }, { adaptiveValues: true });
  const extended = renderOwnerContractTemplate(source, {
    CONSTRUCTION_SCOPE_OF_WORK: Array.from({ length: 10 }, (_, index) => `${index + 1}. Extended scope item with labor, material, coordination, and closeout requirements.`).join("\n"),
  }, { adaptiveValues: true });

  assert.match(compact, /scope-block scope-block-compact/);
  assert.match(compact, /contract-value contract-value-compact/);
  assert.match(standard, /scope-block scope-block-standard/);
  assert.match(standard, /contract-value contract-value-standard/);
  assert.match(extended, /scope-block scope-block-extended/);
  assert.match(extended, /contract-value contract-value-extended/);

  const trustedSignature = renderOwnerContractTemplate("{{OWNER_SIGNATURE}}", {
    OWNER_SIGNATURE: '<img class="contract-signature" src="data:image/png;base64,abc" alt="Owner Signature">',
  }, { trustedHtmlFields: ["OWNER_SIGNATURE"], adaptiveValues: true });
  assert.equal(trustedSignature, '<img class="contract-signature" src="data:image/png;base64,abc" alt="Owner Signature">');

  const [template, awardedDocument, preAwardDocument] = await Promise.all([
    read("../public/contract-templates/legal-review/time-and-materials.html"),
    read("../app/api/contracts/document/route.ts"),
    read("../app/api/preaward-contracts/document/route.ts"),
  ]);
  assert.doesNotMatch(template, /min-height:\s*72px/);
  assert.match(template, /\.scope-block\s*\{[^}]*min-height:\s*0/s);
  assert.match(OWNER_CONTRACT_DOCUMENT_CSS, /\.contract-body-small-project \.scope-block-extended/);
  assert.match(OWNER_CONTRACT_DOCUMENT_CSS, /table\.signature td \{/);
  assert.match(awardedDocument, /adaptiveValues: !wantsWord && contractType === "Time & Materials"/);
  assert.match(preAwardDocument, /adaptiveValues: !wantsWord && data\.contractType === "Time & Materials"/);
  assert.match(awardedDocument, /contract-body contract-body-small-project/);
  assert.match(preAwardDocument, /contract-body contract-body-small-project/);
});

test("every owner contract path produces a populated editable Word review copy", async () => {
  const docx = createEditableOwnerContractDocx({
    title: "Johnstone Bloomington",
    projectNumber: "26-041",
    contractType: "Small Projects / T&M",
    instrument: "Time & Materials Not to Exceed",
    recordId: "OWNER-CONTRACT-26-041",
    revisionLabel: "R4",
    status: "Owner Review",
    templateId: "MC-OWN-SP-001",
    templateVersion: "Rev. 2.0",
    renderedHtml: '<header class="brand"><strong>MEFFORD CONTRACTING, LLC</strong><span>SMALL PROJECT CONSTRUCTION CONTRACT</span></header><h1>Small Project Construction Contract</h1><p>This Contract is between <strong>Johnstone Supply, LLC</strong> and Mefford Contracting, LLC.</p><table><thead><tr><th>Contract Amount</th><th>Project Site</th></tr></thead><tbody><tr><td>$125,000.00</td><td>3900 West Sample Road<br>Bloomington, IN 47403</td></tr></tbody></table><h2 class="page-break-before">Signatures</h2><p>Project Owner signature pending.</p>',
    basisAttachments: [{ label: "Scope Of Work", name: "Issued Scope.pdf", revision: "Rev. 2", fileId: 81 }],
  });

  assert.equal(String.fromCharCode(docx[0], docx[1]), "PK");
  const archive = unzipSync(docx);
  assert.ok(archive["[Content_Types].xml"]);
  assert.ok(archive["word/document.xml"]);
  assert.ok(archive["word/styles.xml"]);
  const documentXml = strFromU8(archive["word/document.xml"]);
  assert.match(documentXml, /EDITABLE PROJECT OWNER REVIEW COPY/);
  assert.match(documentXml, /Johnstone Bloomington/);
  assert.match(documentXml, /Johnstone Supply, LLC/);
  assert.match(documentXml, /\$125,000\.00/);
  assert.match(documentXml, /Issued Scope\.pdf/);
  assert.match(documentXml, /w:type="page"/);
  assert.match(documentXml, /<w:tbl>/);
  assert.doesNotMatch(documentXml, /data:image/);

  const currentTemplates = [
    ...OWNER_CONTRACT_TYPES.map((type) => [type, contractTemplate(type)]),
    ["Design-Build GMP Exhibit A", contractTemplate("Design-Build GMP", "GMP Exhibit A")],
  ];
  for (const [type, template] of currentTemplates) {
    const templateHtml = await read(`../public${template.htmlPath}`);
    const body = templateHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || templateHtml;
    const fields = withOwnerContractComputedFields(type === "Design-Build GMP Exhibit A" ? "Design-Build GMP" : type, {
      SMALL_PROJECT_PRICING_METHOD: "Lump Sum",
      SMALL_PROJECT_CONTRACT_AMOUNT: "125000",
      PROJECT_NAME: "Word Export Verification",
      PROJECT_NUMBER: "TEST-001",
    });
    const rendered = renderOwnerContractTemplate(body, fields);
    const generated = createEditableOwnerContractDocx({
      title: "Word Export Verification",
      projectNumber: "TEST-001",
      contractType: template.label,
      instrument: template.instrument,
      recordId: "OWNER-CONTRACT-TEST-001",
      revisionLabel: "R1",
      status: "Draft Preparation",
      templateId: template.id,
      templateVersion: template.version,
      renderedHtml: rendered,
    });
    const generatedXml = strFromU8(unzipSync(generated)["word/document.xml"]);
    assert.match(generatedXml, /Word Export Verification/);
    assert.doesNotMatch(generatedXml, /\{\{[A-Z0-9_]+\}\}/, `${template.label} must not leave unresolved Word fields`);
  }

  const [awardedDocument, preAwardDocument, awardedStudio, preAwardStudio, ownerPortal] = await Promise.all([
    read("../app/api/contracts/document/route.ts"),
    read("../app/api/preaward-contracts/document/route.ts"),
    read("../app/owner-contracts.tsx"),
    read("../app/preaward-owner-contract-studio.tsx"),
    read("../app/project-owner-portal.tsx"),
  ]);
  for (const route of [awardedDocument, preAwardDocument]) {
    assert.match(route, /createEditableOwnerContractDocx/);
    assert.match(route, /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/);
    assert.match(route, /format.*docx/);
  }
  assert.match(awardedDocument, /approved_revision_id/);
  assert.match(awardedDocument, /This Contract Revision Was Not Released To The Project Owner/);
  assert.match(awardedStudio, /Download Editable Word Copy/);
  assert.match(preAwardStudio, /Download Editable Word Copy/);
  assert.match(ownerPortal, /downloadEditableContract/);
  assert.match(ownerPortal, /The Word copy is for proposed edits/);
});

test("contract document styling is grayscale with one controlled type hierarchy", () => {
  const hexadecimalColors = [...OWNER_CONTRACT_DOCUMENT_CSS.matchAll(/#([0-9a-f]{3}|[0-9a-f]{6})\b/gi)].map((match) => match[1]);
  assert.ok(hexadecimalColors.length > 0);
  for (const color of hexadecimalColors) {
    const expanded = color.length === 3 ? color.split("").map((character) => character.repeat(2)).join("") : color;
    assert.equal(expanded.slice(0, 2), expanded.slice(2, 4), `red and green channels must match for #${color}`);
    assert.equal(expanded.slice(2, 4), expanded.slice(4, 6), `green and blue channels must match for #${color}`);
  }
  assert.match(OWNER_CONTRACT_DOCUMENT_CSS, /font-family: Arial, Helvetica, sans-serif/);
  assert.match(OWNER_CONTRACT_DOCUMENT_CSS, /@media print/);
  assert.match(OWNER_CONTRACT_DOCUMENT_CSS, /background-color: #fff !important/);
  assert.equal(isScalarMoneyContractField("PHASE_ONE_DESIGN_AND_PRECONSTRUCTION_FEE"), true);
  assert.equal(isScalarMoneyContractField("DESIGN_BUILDER_S_FEE"), true);
  assert.equal(isPercentageContractField("MATERIALS_AND_CONSUMABLES_ITEM_SPECIFIC_MARKUP"), true);
  assert.equal(contractFieldInput("PHASE_ONE_DESIGN_AND_PRECONSTRUCTION_FEE"), "number");
  assert.equal(contractFieldInput("CONTRACTOR_FEE_PROFIT_PERCENTAGE"), "number");
});

test("award setup carries the selected contract type into the project and accounting setup", async () => {
  const [editor, award, billing] = await Promise.all([
    read("../app/estimate-editor.tsx"),
    read("../app/api/estimates/award/route.ts"),
    read("../app/owner-billing.tsx"),
  ]);
  assert.match(editor, /Project Owner Contract Type/);
  assert.match(award, /owner_contract_type/);
  assert.match(award, /ownerContractDraftStatement/);
  assert.match(award, /accountingContractSetupStatement/);
  assert.match(billing, /Controlled By The Executed Owner Contract/);
  assert.doesNotMatch(billing, /Guaranteed Maximum Price<\/option>/);
  assert.doesNotMatch(billing, /Cost Plus<\/option>/);
});

test("manual project creation activates the same controlled draft, revision, billing, accounting, and dormant owner portal", async () => {
  const [projects, activation] = await Promise.all([
    read("../app/api/projects/route.ts"),
    read("../lib/owner-contract-activation.ts"),
  ]);
  assert.match(projects, /activateOwnerContractWorkflow/);
  assert.match(projects, /contractWorkflow/);
  assert.match(activation, /OWNER-BILLING-SETUP/);
  assert.match(activation, /MEFFORD-ACCOUNTING/);
  assert.match(activation, /Owner Contract Setup/);
  assert.match(activation, /'Dormant'/);
  assert.match(activation, /'Draft Preparation'/);
  assert.match(activation, /Project-created controlled draft/);
});

test("award project insert supplies exactly one value for every project column", async () => {
  const award = await read("../app/api/estimates/award/route.ts");
  const insert = award.match(/INSERT INTO projects \(([\s\S]*?)\) VALUES \(([\s\S]*?)\)/);
  assert.ok(insert, "project insert must remain present");
  const columns = insert[1].split(",").map((value) => value.trim()).filter(Boolean);
  const values = insert[2].split(",").map((value) => value.trim()).filter(Boolean);
  assert.equal(values.length, columns.length);
  assert.equal(columns.length, 26);
  assert.match(award, /errorReference/);
  assert.match(award, /Nothing Was Saved/);
});

test("a second owner notice address line is optional for every contract type", async () => {
  const definitions = await read("../lib/owner-contracts.ts");
  const required = definitions.match(/export function requiredContractFields\([\s\S]*?\n}\n/);
  assert.ok(required, "required owner contract fields must remain defined");
  assert.doesNotMatch(required[0], /OWNER_NOTICE_ADDRESS_LINE_2/);
  assert.match(definitions, /Project Owner Mailing Address Line 2 \(Optional\)/);
});

test("contract setup labels distinguish the Project Owner from the Mefford Company Owner", async () => {
  const [workspace, preaward] = await Promise.all([
    read("../app/owner-contracts.tsx"),
    read("../app/preaward-owner-contract-studio.tsx"),
  ]);
  assert.equal(contractFieldLabel("OWNER_LEGAL_NAME"), "Project Owner Legal Name");
  assert.equal(contractFieldLabel("OWNER_AUTHORIZED_REPRESENTATIVE"), "Authorized Project Owner Contact");
  assert.equal(contractFieldLabel("OWNER_PRIMARY_CONTACT_NAME"), "Primary Contact Name");
  assert.equal(contractFieldLabel("OWNER_SIGNATORY"), "Contract Signer Name");
  assert.equal(contractFieldLabel("OWNER_SIGNATORY_TITLE"), "Contract Signer Title / Authority");
  assert.equal(contractFieldLabel("PRIMARY_SITE_CONTACT"), "Primary Project Site Contact");
  assert.equal(contractFieldLabel("PROJECT_OWNER_CONTACT_EMAIL"), "Project Owner Contact Email");
  assert.equal(contractFieldLabel("OWNER_SAFETY_OR_SITE_SPECIFIC_REQUIREMENTS"), "Project Owner Safety Or Site Specific Requirements");
  assert.equal(contractFieldLabel("CONTRACTOR_SIGNATORY"), "Mefford Authorized Signer");
  assert.equal(contractFieldGroup("OWNER_CRITERIA_ID_VERSION_AND_DATE"), "Project Details & Project Owner Requirements");
  assert.match(workspace, /Company Owner: Approve For Project Owner Review/);
  assert.match(preaward, /Project Owner Contract Type/);
  assert.match(preaward, /proposal-studio-shell/);
});

test("awarded owner contract builder launches as a full-screen studio", async () => {
  const [workspace, dashboard, styles] = await Promise.all([
    read("../app/owner-contracts.tsx"),
    read("../app/page.tsx"),
    read("../app/globals.css"),
  ]);
  assert.match(workspace, /proposal-studio-layer owner-contract-studio-layer/);
  assert.match(workspace, /aria-label="Close Project Owner Contract Builder"/);
  assert.match(dashboard, /onClose=\{\(\) => setActive\("Project Overview"\)\}/);
  assert.match(styles, /\.project-contract-studio-shell \{[\s\S]*?height: 100%;[\s\S]*?min-height: 0;[\s\S]*?border: 0;/);
});

test("Project Owner portal can open the exact released packet before review or signature", async () => {
  const portal = await read("../app/project-owner-portal.tsx");
  assert.match(portal, /Open Exact Contract Packet/);
  assert.match(portal, /x-owner-session/);
  assert.match(portal, /api\/contracts\/document/);
});

test("owner contract prefill connects project estimating proposal scope pricing schedule and contacts", () => {
  const estimate = newEstimateData();
  estimate.entries["3340.00"] = {
    quantity: 1,
    unit: "LS",
    material: 20_000,
    labor: 10_000,
    equipment: 5_000,
    subcontract: 15_000,
    other: 0,
  };
  const prefill = buildOwnerContractPrefill({
    baseFields: {},
    project: {
      number: "26-047",
      name: "Johnstone Supply",
      site: "123 Main Street, Lexington, KY 40507",
      ownerName: "Johnstone Supply LLC",
      ownerContractDate: "2026-09-08",
      projectType: "Commercial Renovation",
      contractAmount: "60000.00",
      startDate: "2026-10-01",
      substantialDate: "2027-08-01",
      finalDate: "2027-09-01",
      projectManager: "Project Manager",
      superintendent: "Superintendent",
      paymentTerms: "Net 20 After Approved Monthly Billing",
      retainageInitialPercent: "8",
      retainageAfterHalfPercent: "4",
    },
    estimate,
    estimateRecordId: "ESTIMATE-LEAD-47",
    proposal: {
      projectName: "Johnstone Supply",
      ownerName: "Johnstone Supply LLC",
      ownerContactName: "Taylor Owner",
      ownerContactTitle: "President",
      ownerContactEmail: "taylor@example.com",
      ownerContactPhone: "859-555-0100",
      proposalDate: "2026-08-20",
      validThrough: "2026-09-20",
      revision: 3,
      contractPrice: 60000,
      designStartupGmp: 3000,
      paymentTerms: "Net 20 After Approved Monthly Billing",
      projectUnderstanding: "Renovate the operating facility while maintaining owner access.",
      scopeSections: [{ title: "Utilities", description: "Replace the storm drainage system.", amount: 50000, included: true }],
      assumptions: ["Normal weekday access will be available."],
      exclusions: ["Owner-furnished production equipment."],
      scheduleNarrative: "The work follows the approved fifteen-month plan.",
      scheduleMilestones: [{ title: "Construction", startDate: "2026-10-01", endDate: "2027-09-01", included: true }],
      designStartupServices: [{ title: "Architectural Services", description: "Permit drawings and review responses.", included: true }],
    },
    proposalRecordId: "OWNER-PROPOSAL-47",
  });

  assert.equal(prefill.fields.PROJECT_NUMBER, "26-047");
  assert.equal(prefill.fields.OWNER_NOTICE_EMAIL, "taylor@example.com");
  assert.match(prefill.fields.CONSTRUCTION_SCOPE_OF_WORK, /Replace the storm drainage system/);
  assert.match(prefill.fields.BID_ASSUMPTIONS_AND_CLARIFICATIONS, /Normal weekday access/);
  assert.match(prefill.fields.CONSTRUCTION_EXCLUSIONS, /Owner-furnished production equipment/);
  assert.equal(prefill.fields.PHASE_ONE_DESIGN_AND_PRECONSTRUCTION_FEE, "3000.00");
  assert.equal(prefill.fields.SMALL_PROJECT_CONTRACT_AMOUNT, prefill.fields.LUMP_SUM_CONTRACT_SUM);
  assert.match(prefill.fields.TIME_AND_MATERIALS_RATE_SCHEDULE, /Project Manager — \$120\.00 per hour/);
  assert.match(prefill.fields.TIME_AND_MATERIALS_RATE_SCHEDULE, /Superintendent — \$85\.00 per hour/);
  assert.match(prefill.fields.CONTRACT_DOCUMENTS_AND_PROPOSALS, /Owner Proposal R3/);
  assert.equal(prefill.fields.UTILITIES_AMOUNT, "50000.00");
  assert.equal(prefill.fields.MILESTONE_1_REQUIRED_DATE, "2027-09-01");
  assert.equal(prefill.sources.CONSTRUCTION_SCOPE_OF_WORK.kind, "Proposal");
  assert.equal(prefill.sources.UTILITIES_AMOUNT.kind, "Estimate");
});

test("manual contract overrides survive source refresh while automatic fields update", () => {
  const prefill = buildOwnerContractPrefill({
    project: { number: "26-047", name: "Current Project Name", site: "Current Site" },
    proposal: { scopeSections: [{ title: "Scope", description: "Current estimate scope", included: true }] },
  });
  const merged = mergeOwnerContractPrefill({
    PROJECT_NAME: "Negotiated Contract Name",
    CONSTRUCTION_SCOPE_OF_WORK: "Stale automatic scope",
  }, prefill, ["PROJECT_NAME"], true);
  assert.equal(merged.fields.PROJECT_NAME, "Negotiated Contract Name");
  assert.match(merged.fields.CONSTRUCTION_SCOPE_OF_WORK, /Current estimate scope/);
  assert.equal(merged.sources.PROJECT_NAME.kind, "Manual");
});

test("linked CRM contact prepopulates contract notices invoice routing site contact and signer details", () => {
  const prefill = buildOwnerContractPrefill({
    project: {
      number: "26-051",
      name: "Johnstone Indianapolis",
      ownerName: "Johnstone Supply LLC",
    },
    proposal: {
      ownerName: "Johnstone Supply LLC",
      ownerContactName: "Older Proposal Contact",
      ownerContactEmail: "old-contact@example.com",
    },
    contact: {
      name: "Morgan Johnson",
      company: "Johnstone Supply",
      jobTitle: "President",
      email: "morgan@johnstonesupply.com",
      phone: "317-555-0142",
      address: "4200 Industrial Parkway",
      city: "Indianapolis",
      state: "IN",
      postalCode: "46241",
    },
    contactRecordId: "CNT-0051",
  });

  assert.equal(prefill.fields.OWNER_LEGAL_NAME, "Johnstone Supply LLC");
  assert.equal(prefill.fields.OWNER_SIGNATORY, "Morgan Johnson");
  assert.equal(prefill.fields.OWNER_PRIMARY_CONTACT_NAME, "Morgan Johnson");
  assert.equal(prefill.fields.OWNER_SIGNATORY_TITLE, "President");
  assert.equal(prefill.fields.OWNER_PRIMARY_CONTACT_EMAIL, "morgan@johnstonesupply.com");
  assert.equal(prefill.fields.OWNER_NOTICE_EMAIL, "morgan@johnstonesupply.com");
  assert.equal(prefill.fields.OWNER_EMAIL, "morgan@johnstonesupply.com");
  assert.equal(prefill.fields.OWNER_NOTICE_PHONE, "317-555-0142");
  assert.equal(prefill.fields.OWNER_NOTICE_ADDRESS_LINE_1, "4200 Industrial Parkway");
  assert.equal(prefill.fields.OWNER_NOTICE_ADDRESS_LINE_2, "Indianapolis, IN 46241");
  assert.match(prefill.fields.OWNER_ADDRESS_REPRESENTATIVE_CONTACT, /Morgan Johnson/);
  assert.match(prefill.fields.OWNER_ADDRESS_REPRESENTATIVE_CONTACT, /Indianapolis, IN 46241/);
  assert.equal(prefill.fields.INVOICE_DELIVERY_METHOD_RECIPIENT, "Email · Morgan Johnson · morgan@johnstonesupply.com");
  assert.match(prefill.fields.PRIMARY_SITE_CONTACT, /317-555-0142/);
  assert.equal(prefill.fields.OWNER_REPRESENTATIVE_AUTHORIZED_TO_ACKNOWLEDGE_TICKETS, "Morgan Johnson · President");
  assert.equal(prefill.sources.INVOICE_DELIVERY_METHOD_RECIPIENT.label, "CRM Contact");
  assert.equal(prefill.sources.INVOICE_DELIVERY_METHOD_RECIPIENT.recordId, "CNT-0051");

  const merged = mergeOwnerContractPrefill({
    INVOICE_DELIVERY_METHOD_RECIPIENT: "Email · Accounts Payable · ap@johnstonesupply.com",
    OWNER_NOTICE_EMAIL: "old-contact@example.com",
  }, prefill, ["INVOICE_DELIVERY_METHOD_RECIPIENT"], true);
  assert.equal(merged.fields.INVOICE_DELIVERY_METHOD_RECIPIENT, "Email · Accounts Payable · ap@johnstonesupply.com");
  assert.equal(merged.fields.OWNER_NOTICE_EMAIL, "morgan@johnstonesupply.com");
  assert.equal(merged.sources.INVOICE_DELIVERY_METHOD_RECIPIENT.kind, "Manual");
});

test("legacy direct estimates resolve one exact company contact without guessing among duplicates", () => {
  const candidates = [
    {
      recordId: "CNT-0001",
      matchBasis: "company",
      active: true,
      contact: {
        name: "Riley Grimme",
        company: "Johnstone Supply",
        jobTitle: "Head of Construction",
        email: "riley.grimme@johnstonesolutions.com",
        phone: "859-391-9510",
      },
    },
  ];
  const resolved = selectOwnerContractContact(candidates, { company: "Johnstone Supply LLC" });
  assert.equal(normalizeOwnerContractCompany("Johnstone Supply, LLC"), "johnstone supply");
  assert.equal(resolved?.recordId, "CNT-0001");
  assert.equal(resolved?.matchBasis, "company");
  assert.equal(resolved?.contact.email, "riley.grimme@johnstonesolutions.com");

  const ambiguous = selectOwnerContractContact([
    ...candidates,
    { ...candidates[0], recordId: "CNT-0002", contact: { ...candidates[0].contact, name: "Other Contact", email: "other@example.com" } },
  ], { company: "Johnstone Supply" });
  assert.equal(ambiguous, null);
});

test("a CRM contact without a mailing address uses the editable project location fallback", () => {
  const prefill = buildOwnerContractPrefill({
    project: {
      number: "26-001",
      name: "Johnstone - Bloomington, IN Remodel",
      site: "3900 Roll Ave, Bloomington, IN 47401",
      ownerName: "Johnstone Supply",
    },
    contact: {
      name: "Riley Grimme",
      company: "Johnstone Supply",
      jobTitle: "Head of Construction",
      email: "riley.grimme@johnstonesolutions.com",
      phone: "859-391-9510",
      state: "KY",
    },
    contactRecordId: "CNT-0001",
  });

  assert.equal(prefill.fields.OWNER_SIGNATORY, "Riley Grimme");
  assert.equal(prefill.fields.OWNER_NOTICE_EMAIL, "riley.grimme@johnstonesolutions.com");
  assert.equal(prefill.fields.OWNER_NOTICE_ADDRESS_LINE_1, "3900 Roll Ave");
  assert.equal(prefill.fields.OWNER_NOTICE_ADDRESS_LINE_2, "Bloomington, IN 47401");
  assert.match(prefill.fields.OWNER_ADDRESS_REPRESENTATIVE_CONTACT, /3900 Roll Ave/);
  assert.equal(prefill.sources.OWNER_NOTICE_ADDRESS_LINE_1.label, "Project Location · Confirm");
  assert.match(prefill.sources.OWNER_ADDRESS_REPRESENTATIVE_CONTACT.label, /CRM Contact \+ Project Location/);
});

test("every CRM contact placeholder in the active contract masters is populated", async () => {
  const prefill = buildOwnerContractPrefill({
    project: { number: "26-001", name: "Contact Mapping Audit", site: "3900 Roll Ave, Bloomington, IN 47401", ownerName: "Johnstone Supply" },
    contact: { name: "Riley Grimme", company: "Johnstone Supply", jobTitle: "Head of Construction", email: "riley@example.com", phone: "859-391-9510", address: "100 Main St", city: "Lexington", state: "KY", postalCode: "40507" },
  });
  const contactPlaceholders = new Set([
    "OWNER_ADDRESS_REPRESENTATIVE_CONTACT", "OWNER_AUTHORIZED_REPRESENTATIVE", "OWNER_DELIVERY_ADDRESS",
    "OWNER_EMAIL", "OWNER_RECIPIENT", "OWNER_REPRESENTATIVE_AUTHORIZED_TO_ACKNOWLEDGE_TICKETS",
    "OWNER_NOTICE_CONTACT", "OWNER_NOTICE_ADDRESS_LINE_1", "OWNER_NOTICE_ADDRESS_LINE_2", "OWNER_NOTICE_EMAIL",
    "OWNER_NOTICE_PHONE", "OWNER_SIGNATORY", "OWNER_SIGNATORY_TITLE", "INVOICE_DELIVERY_METHOD_RECIPIENT",
    "PRIMARY_SITE_CONTACT", "NOTICE_REQUIREMENTS_AND_ADDRESSES",
  ]);
  const templates = [
    ["Design-Build GMP", "Phase 1 Agreement"],
    ["Design-Build GMP", "GMP Exhibit A"],
    ["Design-Build Lump Sum", "Primary Agreement"],
    ["Plan & Spec Lump Sum", "Primary Agreement"],
    ["Time & Materials", "Primary Agreement"],
  ];
  let audited = 0;
  for (const [type, instrument] of templates) {
    const template = contractTemplate(type, instrument);
    const html = await read(`../public${template.htmlPath}`);
    const fields = new Set([...html.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)].map((match) => match[1]));
    for (const field of [...fields].filter((candidate) => contactPlaceholders.has(candidate))) {
      audited += 1;
      assert.ok(prefill.fields[field]?.trim(), `${type} ${instrument} must map ${field}`);
    }
  }
  assert.ok(audited >= 15, "the current masters must retain their CRM contact placeholders");
});

test("contract setup presents one primary owner record and keeps exceptions optional", async () => {
  const [workspace, preAwardStudio, routingPanel] = await Promise.all([
    read("../app/owner-contracts.tsx"),
    read("../app/preaward-owner-contract-studio.tsx"),
    read("../app/owner-contact-routing-panel.tsx"),
  ]);
  assert.deepEqual(OWNER_CONTRACT_PRIMARY_PARTY_FIELDS, [
    "OWNER_LEGAL_NAME",
    "OWNER_ENTITY_AND_STATE",
    "OWNER_PRIMARY_CONTACT_NAME",
    "OWNER_PRIMARY_CONTACT_TITLE",
    "OWNER_PRIMARY_CONTACT_EMAIL",
    "OWNER_PRIMARY_CONTACT_PHONE",
    "OWNER_PRIMARY_MAILING_ADDRESS_LINE_1",
    "OWNER_PRIMARY_MAILING_ADDRESS_LINE_2",
  ]);
  assert.ok(OWNER_CONTRACT_ROUTING_OVERRIDE_FIELDS.includes("OWNER_INVOICE_RECIPIENT_OVERRIDE"));
  assert.ok(OWNER_CONTRACT_CONTACT_ROUTING_FIELDS.includes("OWNER_ADDRESS_REPRESENTATIVE_CONTACT"));
  assert.match(workspace, /OwnerContactRoutingPanel/);
  assert.doesNotMatch(workspace, /This invite follows the Project Owner record from Contract Setup/);
  assert.match(workspace, /<input value=\{ownerContact\.name\} readOnly/);
  assert.match(preAwardStudio, /OwnerContactRoutingPanel/);
  assert.match(routingPanel, /Project Owner And Primary Contact/);
  assert.match(routingPanel, /Leave a field blank and it follows the primary contact/);
  assert.doesNotMatch(workspace, /<span>\{item\.shortLabel\}<\/span>/);
});

test("one primary owner contact writes every contract-facing address and contact alias", () => {
  const routed = synchronizeOwnerContractContactFields({
    OWNER_LEGAL_NAME: "Johnstone Supply LLC",
    OWNER_ENTITY_AND_STATE: "an Indiana limited liability company",
    OWNER_PRIMARY_CONTACT_NAME: "Riley Grimme",
    OWNER_PRIMARY_CONTACT_TITLE: "Head of Construction",
    OWNER_PRIMARY_CONTACT_EMAIL: "riley.grimme@johnstonesolutions.com",
    OWNER_PRIMARY_CONTACT_PHONE: "859-391-9510",
    OWNER_PRIMARY_MAILING_ADDRESS_LINE_1: "3900 Roll Ave",
    OWNER_PRIMARY_MAILING_ADDRESS_LINE_2: "Bloomington, IN 47401",
  });

  assert.equal(routed.fields.OWNER_LEGAL_NAME_AND_STATUS, "Johnstone Supply LLC, an Indiana limited liability company");
  assert.equal(routed.fields.OWNER_AUTHORIZED_REPRESENTATIVE, "Riley Grimme · Head of Construction");
  assert.equal(routed.fields.OWNER_SIGNATORY, "Riley Grimme");
  assert.equal(routed.fields.OWNER_NOTICE_EMAIL, "riley.grimme@johnstonesolutions.com");
  assert.equal(routed.fields.OWNER_EMAIL, "riley.grimme@johnstonesolutions.com");
  assert.equal(routed.fields.OWNER_DELIVERY_ADDRESS, "3900 Roll Ave\nBloomington, IN 47401");
  assert.equal(routed.fields.INVOICE_DELIVERY_METHOD_RECIPIENT, "Email · Riley Grimme · riley.grimme@johnstonesolutions.com");
  assert.match(routed.fields.PRIMARY_SITE_CONTACT, /Riley Grimme/);
  assert.match(routed.fields.OWNER_ADDRESS_REPRESENTATIVE_CONTACT, /Bloomington, IN 47401/);
  assert.match(routed.fields.NOTICE_REQUIREMENTS_AND_ADDRESSES, /riley\.grimme@johnstonesolutions\.com/);

  const exceptions = synchronizeOwnerContractContactFields({
    ...routed.fields,
    OWNER_SIGNER_NAME_OVERRIDE: "Pat Owner",
    OWNER_SIGNER_TITLE_OVERRIDE: "Managing Member",
    OWNER_INVOICE_RECIPIENT_OVERRIDE: "Email · Accounts Payable · ap@johnstonesupply.com",
    OWNER_SITE_CONTACT_OVERRIDE: "Jordan Field · 812-555-0100",
  }, ["OWNER_SIGNER_NAME_OVERRIDE", "OWNER_SIGNER_TITLE_OVERRIDE", "OWNER_INVOICE_RECIPIENT_OVERRIDE", "OWNER_SITE_CONTACT_OVERRIDE"]);
  assert.equal(exceptions.fields.OWNER_SIGNATORY, "Pat Owner");
  assert.equal(exceptions.fields.OWNER_SIGNATORY_TITLE, "Managing Member");
  assert.equal(exceptions.fields.OWNER_AUTHORIZED_REPRESENTATIVE, "Riley Grimme · Head of Construction");
  assert.equal(exceptions.fields.INVOICE_DELIVERY_METHOD_RECIPIENT, "Email · Accounts Payable · ap@johnstonesupply.com");
  assert.equal(exceptions.fields.PRIMARY_SITE_CONTACT, "Jordan Field · 812-555-0100");
  assert.equal(exceptions.fields.OWNER_NOTICE_EMAIL, "riley.grimme@johnstonesolutions.com");
});

test("project owner legal name and entity fields preserve spaces while typing", () => {
  const firstEntry = synchronizeOwnerContractContactFields({
    OWNER_LEGAL_NAME: "Johnstone Supply ",
    OWNER_ENTITY_AND_STATE: "LLC ",
  }, ["OWNER_LEGAL_NAME", "OWNER_ENTITY_AND_STATE"]);

  assert.equal(firstEntry.fields.OWNER_LEGAL_NAME, "Johnstone Supply ");
  assert.equal(firstEntry.fields.OWNER_ENTITY_AND_STATE, "LLC ");
  assert.equal(firstEntry.fields.OWNER_LEGAL_NAME_AND_STATUS, "Johnstone Supply, LLC");

  const continuedEntry = synchronizeOwnerContractContactFields({
    ...firstEntry.fields,
    OWNER_ENTITY_AND_STATE: "LLC organized in Indiana",
  }, firstEntry.manualFieldKeys);

  assert.equal(continuedEntry.fields.OWNER_ENTITY_AND_STATE, "LLC organized in Indiana");
  assert.equal(continuedEntry.fields.OWNER_LEGAL_NAME_AND_STATUS, "Johnstone Supply, LLC organized in Indiana");
});

test("contract previews preserve readable line breaks in generated owner contact blocks", async () => {
  const [awardedDocument, preAwardDocument, documentFormatter] = await Promise.all([
    read("../app/api/contracts/document/route.ts"),
    read("../app/api/preaward-contracts/document/route.ts"),
    read("../lib/owner-contract-document.ts"),
  ]);
  for (const source of [awardedDocument, preAwardDocument]) {
    assert.match(source, /renderOwnerContractTemplate/);
  }
  assert.match(documentFormatter, /replace\(\/\\r\?\\n\/g, "<br>"\)/);
});

test("contract workflows resolve linked and legacy company contacts before prefill and award", async () => {
  const [activeApi, preAwardApi, awardApi, contactSource, gmpAgreement, gmpExhibit] = await Promise.all([
    read("../app/api/contracts/route.ts"),
    read("../app/api/preaward-contracts/route.ts"),
    read("../app/api/estimates/award/route.ts"),
    read("../lib/owner-contract-contact.ts"),
    read("../public/contract-templates/legal-review/design-build-gmp-agreement.html"),
    read("../public/contract-templates/legal-review/design-build-gmp-exhibit-a.html"),
  ]);
  assert.match(activeApi, /resolveOwnerContractContact/);
  assert.match(activeApi, /awardedProjectNumber/);
  assert.match(preAwardApi, /resolveOwnerContractContact/);
  assert.match(awardApi, /contact: linkedOwnerContact\?\.contact/);
  assert.match(awardApi, /contactId: linkedOwnerContact\?\.recordId/);
  assert.match(awardApi, /invoiceDeliveryMethodRecipient/);
  assert.match(contactSource, /record_type = \?/);
  assert.match(contactSource, /Sales Contacts/);
  assert.match(contactSource, /only[\s\S]*unique contact/i);
  assert.match(gmpAgreement, /OWNER_NOTICE_ADDRESS_LINE_1\}\}<br>\{\{OWNER_NOTICE_ADDRESS_LINE_2/);
  assert.match(gmpExhibit, /OWNER_NOTICE_ADDRESS_LINE_1\}\}<br>\{\{OWNER_NOTICE_ADDRESS_LINE_2/);
});

test("pre-award contracts preserve every field in the largest current master", () => {
  const fields = Object.fromEntries(Array.from({ length: 500 }, (_, index) => [`FIELD_${index + 1}`, `Value ${index + 1}`]));
  assert.equal(Object.keys(normalizePreAwardContractFields(fields)).length, 500);
});
