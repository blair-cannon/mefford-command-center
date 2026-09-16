import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { activateActor, createF06Runtime, F06_ACTORS } from "./f06-runtime-harness.mjs";
import { newEstimateData, calculateEstimateSummary } from "../../app/estimate-template.ts";
import { defaultContractInstrument, requiredContractFields } from "../../lib/owner-contracts.ts";

// Only the identity provider, D1/R2 bindings, and external network are replaced.
// All business records are created through the same HTTP handlers as production.
// The release gate runs the compiled Worker; source mode is for repair iteration.
const sourceMode = process.env.LIFECYCLE_SOURCE === "1";
const owner = F06_ACTORS.jordan;
const pm = F06_ACTORS.projectManager;
const accountant = F06_ACTORS.accountant;
const superintendent = F06_ACTORS.superintendent;
const today = new Date().toISOString().slice(0, 10);
function syntheticSignature() {
  const chunk = (type, data) => {
    const bytes = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const size = Buffer.alloc(4), checksum = Buffer.alloc(4);
    size.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, bytes, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(128); header.writeUInt32BE(32, 4); header[8] = 8;
  const pixels = Buffer.alloc(129 * 32, 255);
  for (let y = 0; y < 32; y++) {
    pixels[y * 129] = 0;
    for (let x = 0; x < 128; x++) if ((x + y * 3) % 17 < 3) pixels[y * 129 + x + 1] = 0;
  }
  return `data:image/png;base64,${Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("tEXt", Buffer.from("Description\0SYNTHETIC TEST ONLY - not a real person's signature or a binding acceptance")), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]).toString("base64")}`;
}
const signature = syntheticSignature();
const scenarios = [
  { name: "Plan And Spec Lump Sum", type: "Plan & Spec Lump Sum", cost: 80000.12 },
  { name: "Two Phase Design Build GMP", type: "Design-Build GMP", cost: 120000.34 },
  { name: "Small Projects Lump Sum", type: "Time & Materials", pricing: "Lump Sum", cost: 12500.56 },
  { name: "Small Projects T And M Not To Exceed", type: "Time & Materials", pricing: "Time & Materials Not To Exceed", cost: 18000.78 },
];

async function harness({ observeRequest } = {}) {
  const runtime = await createF06Runtime();
  runtime.env.ASSETS = { fetch: async request => {
    const publicRoot = new URL("../../public/", import.meta.url);
    const asset = new URL("." + new URL(request.url).pathname, publicRoot);
    if (!asset.pathname.startsWith(publicRoot.pathname)) return new Response("Not found", { status: 404 });
    try { return new Response(await readFile(asset)); } catch { return new Response("Not found", { status: 404 }); }
  } };
  await Promise.all([pm, accountant, superintendent].map(actor => activateActor(runtime.database, actor)));
  const worker = sourceMode ? null : (await import("../../dist/server/index.js")).default;
  const realFetch = globalThis.fetch;
  const outbound = [];
  globalThis.fetch = async input => {
    outbound.push(String(input instanceof Request ? input.url : input));
    throw new Error("Lifecycle test blocked external network access");
  };
  let calls = 0;
  async function send(path, { actor = owner, method = "GET", body, headers, expected = 200, binary = false } = {}) {
    calls++;
    const started = performance.now();
    let request = runtime.request(path, { actor, method, body, headers });
    if (body instanceof FormData) {
      // A browser sends a concrete multipart body and its measured length.
      // Preserve that transport shape when invoking the compiled Worker in Node.
      const bytes = await request.arrayBuffer();
      const transportHeaders = new Headers(request.headers);
      transportHeaders.set("content-length", String(bytes.byteLength));
      request = new Request(request.url, { method, headers: transportHeaders, body: bytes });
    }
    const pathname = new URL(request.url).pathname;
    const dynamic = pathname.match(/^\/api\/records\/([^/]+)\/(corrections|lifecycle)$/);
    const modulePath = dynamic ? `/api/records/[recordId]/${dynamic[2]}` : pathname;
    const route = sourceMode ? await import(`../../app${modulePath}/route.ts`) : null;
    const response = sourceMode ? await route[method](request, { params: Promise.resolve({ recordId: dynamic ? decodeURIComponent(dynamic[1]) : "" }) }) : await worker.fetch(request);
    const payload = binary && response.status === expected ? new Uint8Array(await response.arrayBuffer()) : await response.json();
    observeRequest?.({ path: pathname, method, action: body instanceof FormData ? body.get("action") || "upload" : body?.action || "", status: response.status, expected, milliseconds: performance.now() - started });
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload.error ? payload : { status: payload.status, saved: payload.saved }).slice(0, 1800)}`);
    return payload;
  }
  const post = (path, body, actor = owner, expected = 200, headers) => send(path, { method: "POST", body, actor, expected, headers });
  const row = (projectId, id) => {
    const result = runtime.database.one("SELECT * FROM command_records WHERE project_id = ? AND id = ?", projectId, id);
    return result ? { ...result, data: JSON.parse(result.data_json) } : null;
  };
  const save = (projectId, recordType, id, status, data, actor = owner, expected = 201, extra = {}) => post("/api/records", {
    projectId, recordType,
    record: { id, title: `${recordType} ${id}`, owner: actor.name, due: today, status, recordDate: today, data, ...extra },
  }, actor, expected);
  const close = async () => { globalThis.fetch = realFetch; await runtime.dispose(); };
  return { runtime, send, post, row, save, close, outbound, calls: () => calls };
}

async function saleToExecutedContract(h, fixture, suffix = "1") {
  const { send, post, save, row } = h;
  const contactId = `LIFECYCLE-CONTACT-${suffix}`;
  const opportunityId = `LIFECYCLE-SALE-${suffix}`;
  const name = `SYNTHETIC TEST ONLY ${fixture.name} ${suffix}`;
  const customer = { name: "Casey Test Owner", email: `owner-${suffix}@example.invalid` };
  if (!fixture.publicBid) await save("MEFFORD-SALES", "Sales Contacts", contactId, "Active", {
    firstName: "Casey", lastName: "Test Owner", company: "Synthetic Lifecycle Client LLC",
    email: customer.email, phone: "859-555-0100", address: "100 Example Way", city: "Lexington", state: "KY", postalCode: "40507",
  }, owner, 201, { title: customer.name });
  const opportunity = {
    projectName: name, company: fixture.publicBid ? "Synthetic Public Works" : "Synthetic Lifecycle Client LLC", contactId: fixture.publicBid ? "" : contactId, contactName: customer.name, contactEmail: customer.email,
    assignedRep: owner.name, assignedEstimator: owner.name, leadSource: fixture.publicBid ? "Public Bid" : "Existing Client",
    expectedAwardDate: today, ownerContractType: fixture.type, projectType: "Commercial",
    targetStartDate: today, durationMonths: 1, projectLocation: "200 Test Project Way, Lexington, KY 40507",
    projectAddress: "200 Test Project Way, Lexington, KY 40507", address: "200 Test Project Way", city: "Lexington", state: "KY", postalCode: "40507", stage: "Lead",
    projectDescription: "Synthetic workflow exercise only: furnish and install a small commercial fit-out.",
  };
  await save("MEFFORD-SALES", "Sales Opportunities", opportunityId, "Lead", opportunity, owner, 201, { title: name });
  await save("MEFFORD-SALES", "Sales Opportunities", opportunityId, "Qualified Opportunity", { ...opportunity, stage: "Qualified Opportunity" });
  const estimate = newEstimateData();
  estimate.entries["0131.19"] = { quantity: 1, unit: "LS", material: 0, labor: 0, equipment: 0, subcontract: fixture.cost, other: 0 };
  estimate.projectInputs.architecturalFeeOverride = 0;
  estimate.projectInputs.projectDurationMonths = 1;
  estimate.status = "Ready For Review";
  estimate.submittedAt = new Date().toISOString();
  await save("MEFFORD-SALES", "Sales Opportunities", opportunityId, "Estimating", { ...opportunity, stage: "Estimating", estimate, estimateStatus: "Ready For Review" });
  await fixture.prepareEstimate?.({ h, opportunityId, customer });
  const project = {
    name, site: opportunity.projectAddress, ownerName: opportunity.company, ownerContractDate: today,
    ownerContractType: fixture.type, projectType: "Commercial", paymentTerms: "Net 30", retainageInitialPercent: 0,
    retainageAfterHalfPercent: 0, startDate: today, substantialDate: today, finalDate: today,
    projectManager: pm.name, superintendent: superintendent.name, timeZone: "America/New_York",
  };
  await post("/api/estimates/award", { opportunityId, project }, owner, 409);
  await post("/api/owner-approvals", { action: "decide", approvalItemId: `estimate:MEFFORD-SALES:${opportunityId}`, decision: "Approved", note: "Synthetic test approval of reconciled estimate." });
  const summary = calculateEstimateSummary(row("MEFFORD-SALES", opportunityId).data.estimate);
  assert.equal(summary.reconciliationDifference, 0);
  assert.ok(summary.contractValue > fixture.cost);
  const generated = await post("/api/proposals", { action: "generate", opportunityId, packetType: "Construction Proposal" }, owner, 201);
  let proposalData = { ...generated.record.data, projectLocation: opportunity.projectLocation, targetStartDate: today,
    executiveSummary: opportunity.projectDescription, projectUnderstanding: opportunity.projectDescription };
  if (fixture.prepareProposal) proposalData = await fixture.prepareProposal({ h, opportunityId, generated, proposalData, summary });
  await post("/api/proposals", { action: "submit-review", opportunityId, packetType: "Construction Proposal", data: proposalData });
  await post("/api/owner-approvals", { action: "decide", approvalItemId: `owner-proposal:MEFFORD-SALES:${generated.record.id}`, decision: "Approved", note: "Synthetic proposal approved for test issue" });
  const issued = await post("/api/proposals", { action: "issue", opportunityId, packetType: "Construction Proposal" });
  assert.equal(issued.handoff.status, "Completed");
  assert.equal(Buffer.from((await h.runtime.bucket.get(issued.record.data.issuedPdfKey)).bytes).subarray(0, 4).toString(), "%PDF", "Issued proposal is a real stored PDF");
  const preaward = await send(`/api/preaward-contracts?opportunityId=${opportunityId}`);
  await post("/api/preaward-contracts", { opportunityId, contractType: fixture.type, fields: {
    ...preaward.prefill.fields, SMALL_PROJECT_PRICING_METHOD: fixture.pricing || "Lump Sum",
    CONSTRUCTION_SCOPE_OF_WORK: opportunity.projectDescription,
  }, manualFieldKeys: ["CONSTRUCTION_SCOPE_OF_WORK", "SMALL_PROJECT_PRICING_METHOD"] }, owner, 201);
  const awarded = await post("/api/estimates/award", { opportunityId, project }, owner, 201);
  const projectId = awarded.project.number;
  const contractId = `OWNER-CONTRACT-${projectId}`;
  await fixture.afterAward?.({ projectId, contractId, opportunityId, summary });
  assert.equal(awarded.handoff.status, "Completed");
  assert.ok(h.runtime.database.one("SELECT id FROM project_files WHERE project_id = ? AND storage_key = ?", projectId, issued.record.data.issuedPdfKey), "Issued proposal follows the job at award");
  const repeatedAward = await post("/api/estimates/award", { opportunityId, project });
  assert.equal(repeatedAward.project.number, projectId);
  assert.equal(repeatedAward.idempotent, true);
  assert.equal(h.runtime.database.one("SELECT status FROM owner_portal_access WHERE project_id = ?", projectId).status, "Dormant");
  const contractAction = (action, fields = {}, actor = owner, expected = 200) => post("/api/contracts", { projectId, recordId: contractId, action, ...fields }, actor, expected);
  const negotiatedValue = fixture.negotiatedContractValue ?? summary.contractValue;
  async function executeInstrument(instrument) {
    const existing = row(projectId, contractId).data.fields;
    const fields = {
      ...existing,
      OWNER_ENTITY_AND_STATE: "Kentucky limited liability company",
      OWNER_PRIMARY_CONTACT_EMAIL: customer.email, OWNER_SIGNATORY: customer.name, OWNER_SIGNATORY_TITLE: "Authorized Test Representative",
      OWNER_PRIMARY_MAILING_ADDRESS_LINE_1: "100 Example Way", OWNER_NOTICE_ADDRESS_LINE_1: "100 Example Way",
      OWNER_TARGET_BUDGET: String(negotiatedValue), OWNER_S_TOTAL_PROJECT_BUDGET: String(negotiatedValue),
      LUMP_SUM_CONTRACT_SUM: String(negotiatedValue), GMP_AMOUNT: String(negotiatedValue),
      SMALL_PROJECT_CONTRACT_AMOUNT: String(negotiatedValue), SMALL_PROJECT_PRICING_METHOD: fixture.pricing || "Lump Sum",
      PHASE_ONE_DESIGN_AND_PRECONSTRUCTION_FEE: "2500.00", TOTAL_PHASE_ONE_FEE: "2500.00", AMOUNT_DUE_UPON_EXECUTION: "0.00",
      ALLOWANCES_AMOUNT: "0.00", CONTRACTOR_FEE_PROFIT_PERCENTAGE: "10", PUBLIC_LIABILITY_INSURANCE_AMOUNT: "1000000.00",
      NOTICE_TO_PROCEED_DATE: today, SUBSTANTIAL_COMPLETION_DATE: today, FINAL_COMPLETION_DATE: today,
      CONSTRUCTION_SCOPE_OF_WORK: opportunity.projectDescription, PERSONAL_GUARANTY_REQUIRED_YES_OR_NO: "No",
    };
    for (const key of requiredContractFields(fixture.type, instrument, fields)) {
      if (!String(fields[key] || "").trim()) fields[key] = /DATE/.test(key) ? today : `Synthetic test term for ${key.toLowerCase().replaceAll("_", " ")}`;
    }
    await contractAction("save", { contractType: fixture.type, fields, manualFieldKeys: Object.keys(fields), retainageInitialPercent: 0, retainageAfterHalfPercent: 0 });
    await fixture.afterContractSave?.({ projectId, contractId, opportunityId, summary, instrument });
    await contractAction("submit-internal-review", {}, pm);
    await contractAction("approve-owner-review", {}, pm, 403);
    await contractAction("approve-owner-review");
    const invited = await contractAction("issue-owner-invite", { contactName: customer.name, contactEmail: customer.email });
    assert.match(invited.invite.deliveryStatus, /Deferred|Manual/);
    const verified = await post("/api/project-owner", { action: "verify-code", inviteId: invited.invite.id, code: invited.invite.code }, customer);
    const headers = { "x-owner-invite": invited.invite.id, "x-owner-session": verified.sessionToken };
    await post("/api/project-owner", { action: "submit-review", decision: "Accepted" }, null, 200, headers);
    await contractAction("approve-final");
    await contractAction("sign", { signature: { role: "mefford", signerName: owner.name, signerTitle: "Company Owner", signatureImage: signature, consent: true } }, owner, 409);
    await post("/api/project-owner", { action: "sign", signerName: customer.name, signerTitle: "Test Representative", signatureImage: signature, signatureConsent: true }, null, 200, headers);
    await fixture.afterOwnerSignature?.({ projectId, contractId, opportunityId, summary, instrument });
    await contractAction("sign", { signature: { role: "mefford", signerName: owner.name, signerTitle: "Company Owner", signatureImage: signature, consent: true } });
    return headers;
  }
  let ownerHeaders = await executeInstrument(defaultContractInstrument(fixture.type));
  if (fixture.type === "Design-Build GMP") {
    assert.equal(row(projectId, contractId).status, "Phase 1 Executed");
    const phaseOneHash = row(projectId, contractId).data.phaseExecutions.phase1.executionHash;
    await fixture.afterPhaseOne?.({ projectId, contractId, customer, ownerHeaders, summary });
    await contractAction("open-gmp-exhibit-a");
    ownerHeaders = await executeInstrument("GMP Exhibit A");
    assert.equal(row(projectId, contractId).data.phaseExecutions.phase1.executionHash, phaseOneHash);
  }
  assert.equal(row(projectId, contractId).status, "Executed");
  const financials = h.runtime.database.one("SELECT contract_amount, current_contract_amount FROM projects WHERE number = ?", projectId);
  assert.equal(Number(financials.contract_amount), negotiatedValue);
  assert.equal(Number(financials.current_contract_amount), negotiatedValue);
  return { fixture, projectId, contractId, opportunityId, summary, customer, ownerHeaders };
}



export { owner, pm, accountant, superintendent, today, signature, scenarios, harness, saleToExecutedContract };
