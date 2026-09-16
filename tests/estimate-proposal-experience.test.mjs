import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";

import { calculateEstimateEntry, calculateEstimateSummary, estimateOverrideReport, newEstimateData, normalizeEstimateData } from "../app/estimate-template.ts";
import { evaluateEstimateFormula } from "../lib/estimate-formula.ts";
import { calculateProjectDistance, straightLineMiles } from "../lib/project-distance.ts";
import { createProposalPdf } from "../lib/proposal-pdf.ts";
import { DESIGN_STARTUP_STANDARD_PERCENT, PROPOSAL_PRICING_VERSION, alignScheduleMilestonesToDuration, allocateProposalScopePricing, buildProposalFromSources, defaultScheduleMilestones, designStartupGmpForPrice, isDesignBuildProposal, normalizeProposalData, proposalNeedsPricingMigration, proposalScopeTotal, proposalTimelineEndDate, refreshProposalSources } from "../lib/proposals.ts";
import { proposalPageIndexes } from "../lib/proposal-visuals.ts";

test("estimate cells calculate spreadsheet-style arithmetic without executing code", () => {
  assert.deepEqual(evaluateEstimateFormula("4x3"), { ok: true, value: 12, expression: "4x3", hasFormula: true });
  assert.equal(evaluateEstimateFormula("=(8+2)*6").value, 60);
  assert.equal(evaluateEstimateFormula("$1,200/4").value, 300);
  assert.equal(evaluateEstimateFormula("15%").value, 0.15);
  assert.equal(evaluateEstimateFormula("-250").value, -250);
  assert.equal(evaluateEstimateFormula("=100-150").value, -50);
  assert.equal(evaluateEstimateFormula("4/0").ok, false);
  assert.equal(evaluateEstimateFormula("globalThis.process").ok, false);
});

test("negative estimate values persist and calculated rows accept resettable manual overrides", () => {
  const normalized = normalizeEstimateData({
    entries: {
      "0174.23": { quantity: 1, unit: "LS", material: 0, labor: -250, equipment: 0, subcontract: 100, other: 0 },
    },
    settings: { baseProfitRate: -0.05 },
  });
  assert.equal(normalized.entries["0174.23"].labor, -250);
  assert.equal(normalized.settings.baseProfitRate, -0.05);
  const overridden = calculateEstimateEntry(normalized, "0174.23", undefined, { quantity: 1, unit: "LS" });
  assert.equal(overridden.entry.labor, -250);
  assert.match(overridden.formula, /Manual Override/);

  delete normalized.entries["0174.23"];
  normalized.projectInputs.cleanupSquareFeet = 100;
  const restored = calculateEstimateEntry(normalized, "0174.23", undefined, { quantity: 1, unit: "LS" });
  assert.equal(restored.entry.labor, 150);
  assert.equal(restored.entry.subcontract, 50);
});

test("proposal scope pricing keeps direct costs intact and carries overhead and profit in General Conditions", () => {
  const estimate = newEstimateData();
  estimate.status = "Ready For Review";
  estimate.entries["0131.00"] = { quantity: 1, unit: "LS", material: 0, labor: 0, equipment: 0, subcontract: 0, other: 500 };
  estimate.entries["0300.00"] = { quantity: 1, unit: "LS", material: 10_000, labor: 0, equipment: 0, subcontract: 0, other: 0 };
  estimate.entries["0400.00"] = { quantity: 1, unit: "LS", material: 0, labor: 0, equipment: 0, subcontract: -1_000, other: 0 };
  const summary = calculateEstimateSummary(estimate);
  assert.equal(summary.reconciliationDifference, 0);
  assert.equal(summary.budgetRollups.find((item) => item.code === "0400.00")?.amount, -1_000);

  const proposal = buildProposalFromSources({
    opportunity: { id: "OPP-MATH", title: "Math Test", owner: "Estimator", status: "Estimating", data: { projectName: "Math Test", company: "Test Owner" } },
    contact: null,
    estimateValue: estimate,
    bidPackages: [],
    packetType: "Construction Proposal",
    actor: { name: "Estimator", email: "estimator@meffcon.com" },
    now: new Date("2026-09-07T12:00:00Z"),
  });
  assert.equal(proposal.pricingVersion, PROPOSAL_PRICING_VERSION);
  assert.equal(proposal.contractPrice, summary.contractValue);
  assert.equal(proposalScopeTotal(proposal.scopeSections), summary.contractValue);
  assert.equal(proposal.scopeSections.find((item) => item.title === "Concrete")?.amount, 10_000);
  assert.equal(proposal.scopeSections.find((item) => item.title === "Masonry")?.amount, -1_000);
  const generalConditions = proposal.scopeSections.find((item) => item.title === "General Conditions");
  assert.ok(generalConditions);
  const directGeneralConditions = summary.budgetRollups
    .filter((item) => item.division.startsWith("001 - "))
    .reduce((total, item) => total + item.amount, 0);
  assert.equal(
    generalConditions.amount,
    Math.round((directGeneralConditions + summary.contractValue - summary.originalBudget) * 100) / 100,
  );
  assert.match(generalConditions.description, /Overhead & Profit/);

  const engagement = buildProposalFromSources({
    opportunity: { id: "OPP-MATH", title: "Math Test", owner: "Estimator", status: "Estimating", data: { projectName: "Math Test", company: "Test Owner" } },
    contact: null,
    estimateValue: estimate,
    bidPackages: [],
    packetType: "Preconstruction Letter of Engagement",
    actor: { name: "Estimator", email: "estimator@meffcon.com" },
    now: new Date("2026-09-07T12:00:00Z"),
  });
  assert.equal(proposalScopeTotal(engagement.scopeSections), engagement.contractPrice);
  assert.ok(engagement.scopeSections.every((item) => !/Concrete|Masonry/.test(`${item.title} ${item.description}`)));

  const allocated = allocateProposalScopePricing([
    { id: "A", title: "A", description: "", amount: 50, included: true, sourceLabel: "Estimate", sourceRevisionId: "" },
    { id: "B", title: "B", description: "", amount: 50, included: true, sourceLabel: "Estimate", sourceRevisionId: "" },
    { id: "C", title: "Credit", description: "", amount: -5, included: true, sourceLabel: "Estimate", sourceRevisionId: "" },
  ], 120.01);
  assert.equal(proposalScopeTotal(allocated), 120.01);
  assert.equal(allocated.find((item) => item.id === "A")?.amount, 50);
  assert.equal(allocated.find((item) => item.id === "B")?.amount, 50);
  assert.equal(allocated.find((item) => item.id === "C")?.amount, -5);
  assert.equal(allocated.find((item) => item.id === "SCOPE-GENERAL-CONDITIONS")?.amount, 25.01);
  assert.equal(normalizeProposalData({ scopeSections: [allocated.find((item) => item.id === "C")] }).scopeSections[0].amount, -5);
  assert.equal(proposalNeedsPricingMigration({}), true);
  assert.equal(proposalNeedsPricingMigration({ pricingVersion: "estimate-selling-price-v1" }), true);
  assert.equal(proposalNeedsPricingMigration({ pricingVersion: PROPOSAL_PRICING_VERSION }), false);
});

test("proposal contract path uses the controlled owner contract title", () => {
  const estimate = newEstimateData();
  const proposal = buildProposalFromSources({
    opportunity: {
      id: "OPP-CONTRACT-TITLE",
      title: "Contract Title Test",
      owner: "Estimator",
      status: "Estimating",
      data: {
        projectName: "Contract Title Test",
        company: "Test Owner",
        deliveryMethod: "Design-Build",
        ownerContractType: "Design-Build GMP",
      },
    },
    contact: null,
    estimateValue: estimate,
    bidPackages: [],
    packetType: "Construction Proposal",
    actor: { name: "Estimator", email: "estimator@meffcon.com" },
    now: new Date("2026-09-07T12:00:00Z"),
  });

  assert.equal(proposal.recommendedContractType, "Design-Build GMP");
  const refreshed = refreshProposalSources({
    ...proposal,
    recommendedContractType: "Design-Build Owner Contract",
  }, proposal);
  assert.equal(refreshed.recommendedContractType, "Design-Build GMP");

  const deliveryMethodProposal = buildProposalFromSources({
    opportunity: {
      id: "OPP-DELIVERY-METHOD-TITLE",
      title: "Delivery Method Contract Title Test",
      owner: "Estimator",
      status: "Estimating",
      data: {
        projectName: "Delivery Method Contract Title Test",
        company: "Test Owner",
        deliveryMethod: "Design-Build GMP",
        proposalHandoff: { ownerContractType: "Plan & Spec Lump Sum" },
      },
    },
    contact: null,
    estimateValue: estimate,
    bidPackages: [],
    packetType: "Construction Proposal",
    actor: { name: "Estimator", email: "estimator@meffcon.com" },
    now: new Date("2026-09-07T12:00:00Z"),
  });
  assert.equal(deliveryMethodProposal.recommendedContractType, "Design-Build GMP");
});

test("design-build proposals reserve an included five-percent startup GMP with a controlled override", () => {
  assert.equal(DESIGN_STARTUP_STANDARD_PERCENT, 5);
  assert.equal(designStartupGmpForPrice(2_345_678.91), 117_283.95);

  const automatic = normalizeProposalData({
    packetType: "Construction Proposal",
    deliveryMethod: "Design-Build",
    recommendedContractType: "Design-Build GMP",
    contractPrice: 2_000_000,
  });
  assert.equal(isDesignBuildProposal(automatic), true);
  assert.equal(automatic.designStartupGmp, 100_000);
  assert.equal(automatic.designStartupGmpManual, false);
  assert.deepEqual(
    automatic.designStartupServices.map((service) => service.title),
    [
      "Geotechnical Services",
      "Architectural Services",
      "Structural Engineering",
      "Civil And Site Engineering",
      "MEP, Fire And Energy Engineering",
      "Permitting And Municipality Coordination",
    ],
  );

  const repriced = normalizeProposalData({ ...automatic, contractPrice: 2_400_000 });
  assert.equal(repriced.designStartupGmp, 120_000);

  const manual = normalizeProposalData({
    ...automatic,
    contractPrice: 2_400_000,
    designStartupGmp: 82_500,
    designStartupGmpManual: true,
  });
  assert.equal(manual.designStartupGmp, 82_500);
  assert.equal(manual.designStartupGmpManual, true);
  assert.equal(isDesignBuildProposal(normalizeProposalData({ ...automatic, recommendedContractType: "Plan & Spec Lump Sum" })), false);
});

test("owner approval report identifies each changed precalculated estimate row", () => {
  const estimate = newEstimateData();
  estimate.projectInputs.cleanupSquareFeet = 100;
  estimate.entries["0174.23"] = { quantity: 1, unit: "LS", material: 0, labor: 125, equipment: 0, subcontract: 50, other: 0 };
  estimate.entries["0300.00"] = { quantity: 1, unit: "LS", material: 500, labor: 0, equipment: 0, subcontract: 0, other: 0 };
  const report = estimateOverrideReport(estimate);
  assert.equal(report.length, 1);
  assert.equal(report[0].lineKey, "0174.23");
  assert.deepEqual(report[0].changedFields, ["Mefford Labor"]);
  assert.equal(report[0].automaticAmount, 200);
  assert.equal(report[0].enteredAmount, 175);
  assert.equal(report[0].difference, -25);
});

test("cleanup remains formula-driven until an authorized total override is entered", () => {
  const estimate = newEstimateData();
  estimate.projectInputs.cleanupSquareFeet = 1_000;
  const automatic = calculateEstimateEntry(estimate, "0174.23", undefined, { quantity: 1, unit: "LS" });
  assert.equal(automatic.entry.labor, 1_500);
  assert.equal(automatic.entry.subcontract, 500);
  estimate.projectInputs.cleanupFeeOverride = 1_200;
  const overridden = calculateEstimateEntry(estimate, "0174.23", undefined, { quantity: 1, unit: "LS" });
  assert.equal(overridden.entry.labor, 900);
  assert.equal(overridden.entry.subcontract, 300);
  assert.match(overridden.formula, /Authorized Cleanup Fee Override/);
  const normalized = normalizeEstimateData({ projectInputs: { cleanupSquareFeet: 500 }, cellFormulas: { "entry.0300.00.material": "4x3" } });
  assert.equal(normalized.projectInputs.cleanupFeeOverride, null);
  assert.equal(normalized.cellFormulas["entry.0300.00.material"], "4x3");
});

test("sales opportunity address produces a round-trip driving mileage with a deterministic fallback", async () => {
  const mockFetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "geocoding.geo.census.gov") {
      const origin = url.searchParams.get("address")?.includes("109 Fieldview Drive");
      return Response.json({ result: { addressMatches: [{ matchedAddress: origin ? "109 FIELDVIEW DR, VERSAILLES, KY" : "100 TEST WAY, LEXINGTON, KY", coordinates: origin ? { x: -84.73, y: 38.05 } : { x: -84.5, y: 38.04 } }] } });
    }
    if (url.hostname === "router.project-osrm.org") return Response.json({ code: "Ok", routes: [{ distance: 16_093.44 }] });
    throw new Error(`Unexpected provider ${url.hostname}`);
  };
  const distance = await calculateProjectDistance("100 Test Way, Lexington, KY 40507", mockFetch);
  assert.equal(distance.oneWayMiles, 10);
  assert.equal(distance.roundTripMiles, 20);
  assert.equal(distance.approximate, false);
  assert.match(distance.originAddress, /109 Fieldview Drive/);
  assert.ok(straightLineMiles({ latitude: 38.05, longitude: -84.73 }, { latitude: 38.04, longitude: -84.5 }) > 0);
});

test("drawing page selections accept All and explicit ranges while enforcing packet limits", () => {
  assert.deepEqual(proposalPageIndexes("1-3, 5", 7), [0, 1, 2, 4]);
  assert.deepEqual(proposalPageIndexes("All", 3), [0, 1, 2]);
  assert.throws(() => proposalPageIndexes("1-40", 40, 30), /no more than 30/);
  assert.throws(() => proposalPageIndexes("2-1", 5), /outside/);
});

test("proposal milestones span the complete stated project duration", () => {
  assert.equal(proposalTimelineEndDate("2026-09-01", 15), "2027-12-01");
  const aligned = alignScheduleMilestonesToDuration([
    { id: "1", title: "Kickoff", startDate: "2026-09-01", endDate: "2026-10-01", durationDays: 30, phase: "Preconstruction", sourceReferences: [], assumption: true, included: true },
    { id: "2", title: "Construction", startDate: "2026-10-02", endDate: "2027-08-15", durationDays: 317, phase: "Construction", sourceReferences: [], assumption: true, included: true },
    { id: "3", title: "Turnover", startDate: "2027-08-16", endDate: "2027-09-01", durationDays: 16, phase: "Turnover", sourceReferences: [], assumption: true, included: true },
  ], "2026-09-01", 15);
  assert.equal(aligned[0].startDate, "2026-09-01");
  assert.equal(aligned.at(-1).endDate, "2027-12-01");
  assert.ok(new Date(aligned[1].endDate) > new Date("2027-08-15"));
});

test("proposal schedule duration follows each project's setup instead of a fixed month count", () => {
  for (const durationMonths of [4, 9, 15, 24]) {
    const startDate = "2026-09-01";
    const milestones = defaultScheduleMilestones(startDate, durationMonths, true);
    assert.equal(milestones[0].startDate, startDate);
    assert.equal(milestones.at(-1).endDate, proposalTimelineEndDate(startDate, durationMonths));
  }
  const unset = defaultScheduleMilestones("2026-09-01", 0, true);
  assert.ok(unset.every((item) => item.startDate === "" && item.endDate === ""));
});

test("editable legacy visuals move into the dedicated project-photo and design-drawing positions", () => {
  const normalized = normalizeProposalData({
    visuals: [
      { id: "PHOTO-1", fileId: 1, kind: "Photo", name: "Project.jpg", contentType: "image/jpeg", placement: "After Project Read", caption: "", pageSelection: "", included: true },
      { id: "DRAWING-1", fileId: 2, kind: "Drawing PDF", name: "Plan.pdf", contentType: "application/pdf", placement: "Appendix", caption: "", pageSelection: "All", included: true },
    ],
    wordRoundTrip: { version: "legacy" },
  });
  assert.equal(normalized.visuals[0].placement, "Project Photo");
  assert.equal(normalized.visuals[1].placement, "Design Drawing");
  assert.equal("wordRoundTrip" in normalized, false);
});

test("proposal PDF places the project photo in-page and gives PDF or image drawings dedicated branded pages", async () => {
  const estimate = newEstimateData();
  estimate.status = "Ready For Review";
  estimate.entries["0300.00"] = { quantity: 1, unit: "LS", material: 10_000, labor: 0, equipment: 0, subcontract: 0, other: 0 };
  const data = buildProposalFromSources({
    opportunity: { id: "OPP-VISUAL", title: "Visual Project", owner: "Estimator", status: "Estimating", data: { projectName: "Visual Project", projectLocation: "100 Test Way, Lexington, KY", company: "Test Owner", contactName: "Taylor Owner", deliveryMethod: "Design-Build" } },
    contact: { title: "Taylor Owner", data: { email: "taylor@example.com" } },
    estimateValue: estimate,
    bidPackages: [],
    packetType: "Construction Proposal",
    actor: { name: "Estimator", email: "estimator@meffcon.com" },
    now: new Date("2026-08-31T12:00:00Z"),
  });
  const photoBytes = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZBv8AAAAASUVORK5CYII=", "base64"));
  const drawing = await PDFDocument.create();
  drawing.addPage([792, 612]).drawRectangle({ x: 30, y: 30, width: 732, height: 552, borderWidth: 1 });
  const drawingBytes = new Uint8Array(await drawing.save());
  data.visuals = [
    { id: "PHOTO-1", fileId: 1, kind: "Photo", name: "Existing Conditions.png", contentType: "image/png", placement: "Project Photo", caption: "Existing conditions", pageSelection: "", included: true },
    { id: "DRAWING-1", fileId: 2, kind: "Drawing PDF", name: "Concept Plan.pdf", contentType: "application/pdf", placement: "Design Drawing", caption: "Selected concept plan", pageSelection: "1", included: true },
    { id: "DRAWING-2", fileId: 3, kind: "Photo", name: "Concept Elevation.png", contentType: "image/png", placement: "Design Drawing", caption: "Selected concept elevation", pageSelection: "", included: true },
  ];
  const base = await PDFDocument.load(await createProposalPdf({ data: { ...data, visuals: [] }, recordId: "OPP-VISUAL-PROPOSAL", status: "Draft" }));
  const packet = await PDFDocument.load(await createProposalPdf({ data, recordId: "OPP-VISUAL-PROPOSAL", status: "Draft", visualAssets: [
    { ...data.visuals[0], bytes: photoBytes },
    { ...data.visuals[1], bytes: drawingBytes },
    { ...data.visuals[2], bytes: photoBytes },
  ] }));
  assert.equal(packet.getPageCount(), base.getPageCount() + 2);
});
