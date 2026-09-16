import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { WORKFLOW_RECONCILIATION_CONTRACTS } from "../lib/workflow-reconciliation-contracts.ts";
import { WORKFLOW_RELEASE_CONTROLS } from "../lib/workflow-release-controls.ts";

test("F-17 maps every assessed workflow to explicit durable reconciliation evidence", async () => {
  assert.equal(WORKFLOW_RECONCILIATION_CONTRACTS.length, 19);
  assert.deepEqual(
    new Set(WORKFLOW_RECONCILIATION_CONTRACTS.map((item) => item.workflowId)),
    new Set(WORKFLOW_RELEASE_CONTROLS.map((item) => item.workflowId)),
  );
  for (const contract of WORKFLOW_RECONCILIATION_CONTRACTS) {
    assert.ok(contract.eventTypes.length > 0, `${contract.workflowId} needs a domain event`);
    assert.ok(contract.authoritativeTrigger.length >= 20, `${contract.workflowId} needs an authoritative trigger`);
    assert.ok(contract.mandatoryConsumers.length >= 2, `${contract.workflowId} needs explicit mandatory consumers`);
    assert.equal(new Set(contract.mandatoryConsumers).size, contract.mandatoryConsumers.length, `${contract.workflowId} has duplicate consumers`);
    await access(new URL(`../${contract.producerRoute}`, import.meta.url));
  }
});

test("F-17 exposes the exact contract event types to fail-closed System Health", () => {
  for (const control of WORKFLOW_RELEASE_CONTROLS) {
    const contract = WORKFLOW_RECONCILIATION_CONTRACTS.find((item) => item.workflowId === control.workflowId);
    assert.ok(contract);
    assert.deepEqual(control.reconciledEventTypes, contract.eventTypes);
  }
});

test("F-17 reserves event sharing for the single atomic estimate-award transaction", () => {
  const owners = new Map();
  for (const contract of WORKFLOW_RECONCILIATION_CONTRACTS) {
    for (const eventType of contract.eventTypes) owners.set(eventType, [...(owners.get(eventType) || []), contract.workflowId]);
  }
  const shared = [...owners.entries()].filter(([, workflowIds]) => workflowIds.length > 1);
  assert.deepEqual(shared, [["estimate.awarded", ["crm-to-award", "award-to-commitment"]]]);
});

test("F-17 owner-contract execution records all mandatory consumers in the same D1 batch", async () => {
  const source = await readFile(new URL("../app/api/contracts/route.ts", import.meta.url), "utf8");
  assert.match(source, /eventType: "owner-contract\.executed"/);
  assert.match(source, /key: "project-contract-status", completedInSourceTransaction: true/);
  assert.match(source, /key: "owner-portal-contract-status", completedInSourceTransaction: true/);
  assert.match(source, /key: "contract-audit-history", completedInSourceTransaction: true/);
  assert.match(source, /\.\.\.reconciliationStatements,/);
  assert.match(source, /await reconcileDomainEvent\(database, domainEventId\)/);
});

test("F-17 selection release commits its register audit and handoff evidence atomically", async () => {
  const source = await readFile(new URL("../app/api/selections/route.ts", import.meta.url), "utf8");
  assert.match(source, /eventType: "selection\.released"/);
  assert.match(source, /key: "procurement-register", completedInSourceTransaction: true/);
  assert.match(source, /key: "purchase-order-draft", completedInSourceTransaction: true/);
  assert.match(source, /key: "selection-audit-history", completedInSourceTransaction: true/);
  assert.match(source, /await env\.DB\.batch\(\[/);
});

test("F-17 supports visible partial state before sequential or cross-storage consumers finish", async () => {
  const source = await readFile(new URL("../lib/domain-outbox.ts", import.meta.url), "utf8");
  assert.match(source, /export async function beginDomainHandoff/);
  assert.match(source, /export async function completeDomainConsumer/);
  assert.match(source, /status = 'Succeeded'/);
  assert.match(source, /Consumer Reconciled/);
});

test("F-17 proposal issuance exposes R2 document stage and audit consumers independently", async () => {
  const source = await readFile(new URL("../app/api/proposals/route.ts", import.meta.url), "utf8");
  assert.match(source, /eventType: "proposal\.issued"/);
  assert.match(source, /completeDomainConsumer\(eventDatabase, proposalEventId, "issued-proposal-document"/);
  assert.match(source, /completeDomainConsumer\(eventDatabase, proposalEventId, "opportunity-stage"/);
  assert.match(source, /completeDomainConsumer\(eventDatabase, proposalEventId, "proposal-audit-history"/);
});

test("F-17 customer response and consent evidence commit as one single-use transaction", async () => {
  const source = await readFile(new URL("../app/api/customer-survey/route.ts", import.meta.url), "utf8");
  assert.match(source, /eventType: "customer-survey\.responded"/);
  assert.match(source, /key: "survey-response-register", completedInSourceTransaction: true/);
  assert.match(source, /key: "project-feedback-summary", completedInSourceTransaction: true/);
  assert.match(source, /key: "review-display-consent-gate", completedInSourceTransaction: true/);
  assert.match(source, /await env\.DB\.batch\(\[/);
});

test("F-17 provides one contract-driven completion writer for authoritative route transitions", async () => {
  const source = await readFile(new URL("../lib/domain-outbox.ts", import.meta.url), "utf8");
  assert.match(source, /export async function recordCompletedWorkflowHandoff/);
  assert.match(source, /workflowReconciliationContract\(input\.workflowId\)/);
  assert.match(source, /contract\.mandatoryConsumers\.map/);
  assert.match(source, /return reconcileDomainEvent/);
});

test("F-17 final review and integration replay transitions write durable completion ledgers", async () => {
  const performance = await readFile(new URL("../app/api/performance-reviews/route.ts", import.meta.url), "utf8");
  const integration = await readFile(new URL("../app/api/integration-health/route.ts", import.meta.url), "utf8");
  assert.match(performance, /workflowId: "field-to-performance"/);
  assert.match(integration, /workflowId: "integration-accountability"/);
});

test("F-17 total closeout and finalized meetings write durable completion ledgers", async () => {
  const closeout = await readFile(new URL("../app/api/closeout/route.ts", import.meta.url), "utf8");
  const meetings = await readFile(new URL("../app/api/meetings/route.ts", import.meta.url), "utf8");
  assert.match(closeout, /workflowId: "closeout-payment"/);
  assert.match(meetings, /workflowId: "meeting-accountability"/);
});

test("F-17 employee activation writes its lifecycle handoff", async () => {
  const source = await readFile(new URL("../app/api/onboarding/route.ts", import.meta.url), "utf8");
  assert.match(source, /workflowId: "employee-lifecycle"/);
});

test("F-17 every workflow contract is wired to its executable producer", async () => {
  for (const contract of WORKFLOW_RECONCILIATION_CONTRACTS) {
    const source = await readFile(new URL(`../${contract.producerRoute}`, import.meta.url), "utf8");
    const wired = source.includes(`workflowId: "${contract.workflowId}"`) || contract.eventTypes.some((eventType) => source.includes(`eventType: "${eventType}"`));
    assert.ok(wired, `${contract.workflowId} is not wired to ${contract.producerRoute}`);
  }
});
