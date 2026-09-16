import assert from "node:assert/strict";
import { unzipSync } from "fflate";
import { PREWORK_QUALITY_TEMPLATES } from "../../lib/quality-control.ts";
import { owner, pm, accountant, superintendent, today, signature } from "./project-workflow-harness.mjs";
async function runOperationsAndFinance(h, job) {
  const { post, save, send, row } = h;
  const { projectId, fixture } = job;
  const summary = { ...job.summary, contractValue: fixture.negotiatedContractValue ?? job.summary.contractValue };
  const schedule = { start: today, finish: today, progress: 0, qualityCategoryId: "concrete", trade: "Concrete" };
  await save(projectId, "Schedule", "SCH-001", "Scheduled", schedule, pm);
  await save(projectId, "Schedule", "SCH-001", "In Progress", { ...schedule, progress: 10 }, superintendent, 409);
  const inspection = h.runtime.database.query("SELECT id, data_json FROM command_records WHERE project_id = ? AND record_type = 'Quality Inspections'", projectId).find(r => JSON.parse(r.data_json).scheduleActivityId === "SCH-001");
  assert.ok(inspection, "The schedule creates its actual linked pre-work inspection");
  const template = PREWORK_QUALITY_TEMPLATES.find(r => r.id === JSON.parse(inspection.data_json).templateId);
  const responses = template.questions.map(q => ({ questionId: q.id, answer: q.input === "check" ? "Yes" : q.input === "choice" ? q.choices[0] : "Synthetic verified test response", notes: "Synthetic test checklist response" }));
  await post("/api/quality-control", { action: "complete-inspection", projectId, recordId: inspection.id, responses, exactLocation: "Synthetic foundation", responsibleTrade: "Concrete" }, superintendent);
  await save(projectId, "Schedule", "SCH-001", "Complete", { ...schedule, progress: 100 }, superintendent);
  const vendor = await post("/api/vendors", { action: "create-vendor", legalName: `Synthetic Vendor ${projectId}`, vendorType: "Vendor", contactName: "Test Supplier", contactEmail: `vendor-${projectId}@example.invalid` }, owner, 201);
  job.vendorId = vendor.vendorId;
  const po = await post("/api/purchase-orders", { action: "create", projectId, vendorId: job.vendorId, amount: fixture.cost, costCode: "0131.19", trade: "Commercial Fit Out", scope: "Synthetic test scope including labor and materials", deliveryLocation: "200 Test Project Way", requiredBy: today }, pm, 201);
  job.poId = po.recordId;
  await post("/api/purchase-orders", { action: "submit", projectId, recordId: job.poId }, pm);
  await post("/api/purchase-orders", { action: "owner-decision", projectId, recordId: job.poId, decision: "Approved", note: "Synthetic purchase approval" });
  await post("/api/purchase-orders", { action: "release", projectId, recordId: job.poId, distributionReference: "TEST ONLY - no external order" }, pm);
  await post("/api/purchase-orders", { action: "acknowledge", projectId, recordId: job.poId, acknowledgedBy: "Test Supplier", acknowledgmentReference: "TEST ONLY - acknowledgment fixture" }, pm);
  await post("/api/lien-waivers", { action: "configure-project", projectId, jurisdiction: "KY", projectClass: "Private", legalDescription: "Synthetic test parcel; not a real property" }, pm);
  await save(projectId, "Owner Billing Setup", "OWNER-BILLING-SETUP", "Locked", {
    ...row(projectId, "OWNER-BILLING-SETUP").data,
    sovLines: [{ id: "SOV-1", description: "Base contract scope", scheduledValue: summary.contractValue }],
  });
  job.invoiceId = `TEST-AP-${projectId}`;
  const invoice = { vendor: `Synthetic Vendor ${projectId}`, invoiceNumber: `TEST-INV-${projectId}`, total: fixture.cost, paymentMethod: "Check",
    allocations: [{ id: "a1", destination: projectId, code: "0131.19", amount: fixture.cost, commitmentType: "Purchase Order", commitmentReference: job.poId }],
  };
  await save("MEFFORD-ACCOUNTING", "AP Invoice", job.invoiceId, "Draft", invoice, accountant);
  await save("MEFFORD-ACCOUNTING", "AP Invoice", job.invoiceId, "Paid", invoice, accountant, 409);
  await save("MEFFORD-ACCOUNTING", "AP Invoice", `${job.invoiceId}-DUP`, "Draft", invoice, accountant, 409);
  let reports = await send(`/api/financial-reports?projectId=${projectId}&asOf=${today}`, { actor: accountant });
  assert.equal(reports.summary.openAp, 0, "An unapproved draft invoice is not an accrued AP liability");
  await save("MEFFORD-ACCOUNTING", "AP Invoice", job.invoiceId, "Owner Approval", invoice, accountant);
  const waiver = h.runtime.database.query("SELECT id, data_json FROM command_records WHERE project_id = ? AND record_type = 'Lien Waiver'", projectId).find(r => JSON.parse(r.data_json).linkedApRecordId === job.invoiceId);
  assert.ok(waiver, "AP intake creates its linked conditional waiver");
  await post("/api/lien-waivers", { action: "record-signature", projectId, recordId: waiver.id, signerName: "Test Supplier", signerTitle: "Test Officer", signatureImage: signature, signatureConsent: true });
  await post("/api/lien-waivers", { action: "accounting-review", projectId, recordId: waiver.id }, accountant);
  await save("MEFFORD-ACCOUNTING", "AP Invoice", job.invoiceId, "Approved Unpaid", invoice, accountant, 403);
  const eventsBeforeApproval = h.runtime.database.one("SELECT COUNT(*) AS count FROM accounting_events").count;
  h.runtime.database.injectFailure({ pattern: /INSERT INTO accounting_journal_lines/, once: true });
  await save("MEFFORD-ACCOUNTING", "AP Invoice", job.invoiceId, "Approved Unpaid", invoice, owner, 500);
  assert.equal(row("MEFFORD-ACCOUNTING", job.invoiceId).status, "Owner Approval", "Failed AP accrual must not leave an approved unposted invoice");
  assert.equal(h.runtime.database.one("SELECT COUNT(*) AS count FROM accounting_events").count, eventsBeforeApproval);
  await save("MEFFORD-ACCOUNTING", "AP Invoice", job.invoiceId, "Approved Unpaid", invoice);
  await save("MEFFORD-ACCOUNTING", "AP Invoice", job.invoiceId, "Approved Unpaid", { ...invoice, total: fixture.cost + 1, allocations: [{ ...invoice.allocations[0], amount: fixture.cost + 1 }] }, accountant, 409);
  await save("MEFFORD-ACCOUNTING", "AP Invoice", job.invoiceId, "Paid", invoice, accountant, 409);
  await save("MEFFORD-ACCOUNTING", "AP Invoice", job.invoiceId, "Approved Unpaid", { ...invoice, paymentMethod: "Check", paymentNote: "Synthetic authorized payment preparation" }, accountant);
  assert.equal(row("MEFFORD-ACCOUNTING", job.invoiceId).data.livePosting, true, "Payment preparation preserves the original posting metadata");
  reports = await send(`/api/financial-reports?projectId=${projectId}&asOf=${today}`, { actor: accountant });
  assert.equal(reports.summary.actualCost, fixture.cost, "AP approval accrues project cost once");
  assert.equal(reports.summary.openAp, fixture.cost);
  await prepareCloseoutEvidence(h, job);
  const unpaidCloseout = await post("/api/closeout", { action: "authorize-total-closeout", projectId, reason: "Synthetic attempt with unpaid project liabilities" }, owner, 409);
  assert.match(unpaidCloseout.error, /payable|AP invoice/i);
  job.batchId = `TEST-BATCH-${projectId}`;
  await save("MEFFORD-ACCOUNTING", "Payment Batch", job.batchId, "Prepared", { invoiceIds: [job.invoiceId], total: fixture.cost }, accountant);
  await post("/api/accounting", { action: "release-payment-batch", recordId: job.batchId }, accountant, 403);
  await post("/api/accounting", { action: "release-payment-batch", recordId: job.batchId });
  await post("/api/accounting", { action: "clear-payment-batch", recordId: job.batchId }, accountant, 400);
  const eventsBeforeClearing = h.runtime.database.one("SELECT COUNT(*) AS count FROM accounting_events").count;
  h.runtime.database.injectFailure({ pattern: /UPDATE command_records/, once: true });
  await post("/api/accounting", { action: "clear-payment-batch", recordId: job.batchId, confirmation: "TEST ONLY - synthetic bank evidence" }, accountant, 500);
  assert.equal(row("MEFFORD-ACCOUNTING", job.invoiceId).status, "Payment Released");
  assert.equal(h.runtime.database.one("SELECT COUNT(*) AS count FROM accounting_events").count, eventsBeforeClearing, "AP payment source and ledger must roll back together");
  h.runtime.database.injectFailure({ pattern: /INSERT INTO record_audits/, once: true });
  await post("/api/accounting", { action: "clear-payment-batch", recordId: job.batchId, confirmation: "TEST ONLY - synthetic bank evidence" }, accountant, 500);
  assert.equal(row("MEFFORD-ACCOUNTING", job.invoiceId).status, "Paid", "A completed payment stays posted if only its batch acknowledgment fails");
  assert.equal(row("MEFFORD-ACCOUNTING", job.batchId).status, "Released");
  assert.equal(h.runtime.database.one("SELECT COUNT(*) AS count FROM accounting_events").count, eventsBeforeClearing + 1);
  await post("/api/accounting", { action: "clear-payment-batch", recordId: job.batchId, confirmation: "TEST ONLY - synthetic bank evidence" }, accountant);
  await post("/api/accounting", { action: "clear-payment-batch", recordId: job.batchId, confirmation: "TEST ONLY - synthetic bank evidence" }, accountant, 409);
  await post("/api/lien-waivers", { action: "record-payment-cleared", projectId, recordId: waiver.id, paymentClearedDate: today, paymentReference: "TEST ONLY - synthetic bank evidence" }, accountant);
  reports = await send(`/api/financial-reports?projectId=${projectId}&asOf=${today}`, { actor: accountant });
  assert.equal(reports.summary.actualCost, fixture.cost, "Payment must not duplicate job cost");
  assert.equal(reports.summary.openAp, 0);
  assert.equal(reports.summary.paidCost, fixture.cost);
  // Deliberately reuse the project-local invoice number in every project.
  job.billingId = "BILL-001";
  const billing = { projectNumber: projectId, billingPeriod: today.slice(0, 7), ownerName: job.customer.name,
    currentPaymentDue: summary.contractValue, cumulativeEarned: summary.contractValue, retainageToDate: 0,
    lines: [{ id: "SOV-1", scheduledValue: summary.contractValue, totalThisPeriod: summary.contractValue }],
  };
  await save(projectId, "Owner Billing", job.billingId, "PM Preparation", billing, pm);
  await save(projectId, "Owner Billing", job.billingId, "Accountant Review", billing, pm);
  await save(projectId, "Owner Billing", job.billingId, "Ready To Send", billing, accountant, 409);
  await save(projectId, "Owner Billing", job.billingId, "Owner Approval", billing, accountant);
  await save(projectId, "Owner Billing", job.billingId, "Ready To Send", billing);
  reports = await send(`/api/financial-reports?projectId=${projectId}&asOf=${today}`, { actor: accountant });
  assert.equal(reports.summary.accountsReceivable, 0, "A ready-to-send draft is not issued AR");
  const issue = { action: "send-owner-billing", projectId, recordId: job.billingId, deliveryReference: "TEST ONLY - synthetic delivery evidence" };
  const eventsBeforeIssue = h.runtime.database.one("SELECT COUNT(*) AS count FROM accounting_events").count;
  h.runtime.database.injectFailure({ pattern: /INSERT INTO command_records/, once: true });
  await post("/api/accounting", issue, accountant, 500);
  assert.equal(row(projectId, job.billingId).status, "Ready To Send");
  assert.equal(h.runtime.database.one("SELECT COUNT(*) AS count FROM accounting_events").count, eventsBeforeIssue, "Invoice issue and AR journal roll back together");
  await post("/api/accounting", issue, accountant);
  const ar = h.runtime.database.query("SELECT id, data_json FROM command_records WHERE project_id = 'MEFFORD-ACCOUNTING' AND record_type = 'AR Invoice'").find(r => JSON.parse(r.data_json).projectId === projectId);
  assert.ok(ar, "The invoice has its own project-specific AR mirror");
  assert.equal(h.runtime.database.one("SELECT COUNT(*) AS count FROM accounting_events WHERE event_type = 'Owner Invoice Sent' AND source_project_id = ? AND source_record_id = ?", projectId, job.billingId).count, 1, "Every project's issued invoice posts its own ledger event");
  const partial = Math.floor(summary.contractValue * 40) / 100;
  const receipt = { action: "record-owner-receipt", projectId, recordId: job.billingId, amount: partial, receiptDate: today, reference: "TEST-DEPOSIT-1" };
  const journalBefore = h.runtime.database.one("SELECT COUNT(*) AS count FROM accounting_events").count;
  h.runtime.database.injectFailure({ pattern: /INSERT INTO command_records/, once: true });
  await post("/api/accounting", receipt, accountant, 500);
  assert.equal(row(projectId, job.billingId).status, "Sent", "An interrupted receipt leaves the invoice unchanged");
  assert.equal(row("MEFFORD-ACCOUNTING", ar.id).data.receivedToDate, 0);
  assert.equal(h.runtime.database.one("SELECT COUNT(*) AS count FROM accounting_events").count, journalBefore, "An interrupted receipt rolls back its journal too");
  const firstReceipt = await post("/api/accounting", receipt, accountant);
  const retriedReceipt = await post("/api/accounting", receipt, accountant);
  assert.equal(retriedReceipt.receivedToDate, firstReceipt.receivedToDate, "Retrying one deposit must not apply it twice");
  await post("/api/accounting", { ...receipt, amount: partial + 1 }, accountant, 409);
  const uncollectedCloseout = await post("/api/closeout", { action: "authorize-total-closeout", projectId, reason: "Synthetic attempt with uncollected owner invoice" }, owner, 409);
  assert.match(uncollectedCloseout.error, /receivable|owner invoice/i);
  const remainder = Math.round((summary.contractValue - partial) * 100) / 100;
  await post("/api/accounting", { ...receipt, amount: remainder + 1, reference: "TEST-OVERPAY" }, accountant, 400);
  await post("/api/accounting", { ...receipt, amount: remainder, reference: "TEST-DEPOSIT-2" }, accountant);
  await post("/api/accounting-controls", { action: "save-wip-forecast", wip: { projectId, periodId: today.slice(0, 7), estimateToComplete: 0, riskReserve: 0, status: "Accounting Reviewed" } }, accountant);
  await post("/api/accounting-controls", { action: "save-wip-forecast", wip: { projectId, periodId: today.slice(0, 7), estimateToComplete: 0, riskReserve: 0, status: "Locked" } });
  reports = await send(`/api/financial-reports?projectId=${projectId}&asOf=${today}`, { actor: accountant });
  assert.equal(reports.summary.accountsReceivable, 0);
  assert.equal(reports.summary.openAp, 0);
  assert.equal(reports.summary.actualCost, fixture.cost);
  assert.equal(reports.summary.recognizedRevenue, summary.contractValue);
  assert.equal(reports.summary.backlog, 0);
  const accounting = await send("/api/accounting", { actor: accountant });
  const financial = accounting.projects.find(p => p.number === projectId);
  assert.equal(financial.accountsReceivable, 0);
  assert.equal(financial.actualCost, fixture.cost);
  const totals = h.runtime.database.one("SELECT COALESCE(SUM(debit_cents),0) AS debit, COALESCE(SUM(credit_cents),0) AS credit FROM accounting_journal_lines");
  assert.equal(totals.debit, totals.credit, "The complete general ledger balances exactly to the cent");
  const savedReport = await post("/api/financial-reports", { action: "save-run", projectId, asOf: today, selectedReports: ["project-financials", "wip", "ap-aging", "ar-aging", "cash-movement"], title: `Synthetic Closeout Reconciliation ${projectId}` }, accountant);
  assert.equal(savedReport.run.data.snapshot.summary.accountsReceivable, 0);
  job.report = reports.summary;
}

async function prepareCloseoutEvidence(h, job) {
  const { post, send, runtime } = h;
  const { projectId, customer } = job;
  await send(`/api/closeout?projectId=${projectId}`, { actor: pm });
  await post("/api/closeout", { action: "authorize-total-closeout", projectId, reason: "Synthetic attempt before required evidence" }, owner, 409);
  const form = new FormData();
  form.set("projectId", projectId);
  form.set("category", "Closeout / Synthetic Test Evidence");
  form.set("file", new File(["SYNTHETIC TEST ONLY. No real completion, payment, property, or signature is represented."], "synthetic-closeout-evidence.txt", { type: "text/plain" }));
  const file = await post("/api/files", form, pm, 201);
  const requirements = runtime.database.query("SELECT id, data_json, status FROM command_records WHERE project_id = ? AND record_type = 'Closeout Requirements'", projectId);
  await post("/api/closeout", { action: "submit-requirement", projectId, recordId: requirements[0].id, fileIds: [999999999] }, pm, 409);
  await post("/api/closeout", { action: "record-approval", projectId, recordId: requirements[0].id, decision: "Approved" }, owner, 409);
  for (const [index, requirement] of [...requirements, requirements[0]].entries()) {
    await post("/api/closeout", { action: "submit-requirement", projectId, recordId: requirement.id, fileIds: [file.file.id], notes: "Synthetic test evidence, not a real closeout certification" }, pm);
    if (index === requirements.length) {
      assert.deepEqual(h.row(projectId, requirement.id).data.approvals, [], "A new evidence version cannot inherit its old approvals");
      assert.equal(h.row(projectId, requirement.id).data.ownerSignature, null);
    }
    const flow = JSON.parse(requirement.data_json).approvalFlow;
    for (const role of flow) {
      if (role === "Project Owner") {
        await post("/api/closeout", { action: "record-owner-signoff", projectId, recordId: requirement.id, signerName: customer.name, signerTitle: "Test Representative", signerEmail: customer.email, signatureConsent: true }, pm);
      } else {
        const actor = role === "Project Manager" ? pm : role === "Superintendent" ? superintendent : role === "Accountant" ? accountant : owner;
        await post("/api/closeout", { action: "record-approval", projectId, recordId: requirement.id, decision: "Approved", reason: "Synthetic approval of the isolated test evidence" }, actor);
      }
    }
  }
}

async function runCloseout(h, job) {
  const { post, runtime } = h;
  const { projectId } = job;
  const closed = await post("/api/closeout", { action: "authorize-total-closeout", projectId, reason: "Synthetic project reconciled and all test evidence accepted" });
  assert.equal(closed.status, "Closed");
  const bonus = runtime.database.one("SELECT closeout_at,payment_status FROM project_bonus_controls WHERE project_id=?",projectId);
  assert.ok(bonus.closeout_at);assert.equal(bonus.payment_status,"Review Required");
  const bonusQueue = await h.send("/api/project-bonuses?queue=1",{actor:accountant});
  assert.ok(bonusQueue.queue.some(row=>row.projectId===projectId&&row.status==="Review Required"));
  assert.ok(runtime.database.one("SELECT COUNT(*) AS n FROM command_work_items WHERE source_type='Project Bonus' AND source_record_id=? AND kind='Bonus Payment Review' AND recipient_email=?",projectId,accountant.email).n);
  assert.equal(closed.handoff.status, "Completed");
  assert.equal(runtime.database.one("SELECT status FROM projects WHERE number = ?", projectId).status, "Completed", "Total closeout must retire the project from active operations");
  const file = runtime.database.one("SELECT storage_key FROM project_files WHERE project_id = ? AND category = 'Closeout / Synthetic Test Evidence'", projectId);
  const stored = await runtime.bucket.get(file.storage_key);
  await runtime.bucket.delete(file.storage_key);
  await h.send("/api/closeout/package?projectId=" + projectId + "&export=thumb-drive", { expected: 409 });
  await runtime.bucket.put(file.storage_key, stored.bytes, { httpMetadata: stored.httpMetadata, customMetadata: stored.customMetadata });
  const zip = unzipSync(await h.send("/api/closeout/package?projectId=" + projectId + "&export=thumb-drive", { binary: true }));
  const originals = Object.keys(zip).filter(name => name.startsWith("Original_Documents/"));
  assert.equal(originals.length, runtime.database.one("SELECT COUNT(*) AS count FROM command_records WHERE project_id = ? AND record_type = 'Closeout Requirements' AND status = 'Approved'", projectId).count, "Every approved requirement retains its original without duplicate ZIP names");
}


export { runOperationsAndFinance, prepareCloseoutEvidence, runCloseout };
