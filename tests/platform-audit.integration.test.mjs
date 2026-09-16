import assert from "node:assert/strict";
import { test } from "node:test";
import { unzipSync } from "fflate";
import { activateActor, F06_ACTORS } from "./support/f06-runtime-harness.mjs";
import { owner, pm, accountant, superintendent, today, harness, saleToExecutedContract } from "./support/project-workflow-harness.mjs";

async function project(h, name, assigned = true) {
  return (await h.post("/api/projects", { mode: "create", project: {
    name: `SYNTHETIC AUDIT ${name}`, status: "Active", site: "100 Control Test Way, Lexington, KY 40507",
    ownerName: "Synthetic Audit Owner LLC", ownerContractDate: today, ownerContractType: "Plan & Spec Lump Sum",
    projectType: "Commercial", contractAmount: "1000000", startDate: today,
    substantialDate: "2027-05-01", finalDate: "2027-06-01",
    projectManager: assigned ? pm.name : owner.name, superintendent: assigned ? superintendent.name : owner.name,
  } }, owner, 201)).project;
}

function upload(projectId, category = "Drawings", name = "confidential-audit.pdf") {
  const form = new FormData();
  form.set("projectId", projectId); form.set("category", category);
  form.set("file", new File(["%PDF-1.7\nSynthetic authorization fixture only"], name, { type: "application/pdf" }));
  return form;
}

test("standalone audit: large My Work lists, reconciliation and failure evidence", async t => {
  const h = await harness();
  try {
    // Isolated volume fixtures model the production task history; requests use real handlers.
    const database = h.runtime.database;
    database.maxBindings = 100;
    const insert = database.sqlite.prepare("INSERT INTO command_work_items (id, dedupe_key, recipient_name, recipient_email, kind, title, message) VALUES (?, ?, ?, ?, ?, ?, ?)");
    const audit = database.sqlite.prepare("INSERT INTO work_item_audits (work_item_id, action, actor_name, actor_email, detail) VALUES (?, ?, ?, ?, ?)");
    for (let index = 0; index < 250; index++) {
      const id = `AUDIT-VOLUME-${index}`;
      insert.run(id, `record:volume:${index}`, owner.name, owner.email, "Audit Fixture", id, "Synthetic resolved source");
      audit.run(id, "Created", owner.name, owner.email, `History ${index}`);
    }
    insert.run("AUDIT-OTHER-USER", "record:other-user", pm.name, pm.email, "Audit Fixture", "Other user", "Must remain private");
    audit.run("AUDIT-OTHER-USER", "Created", pm.name, pm.email, "Private history");
    await t.test("250 tasks load with their histories under the production query limit", async () => {
      const before = database.one("SELECT total_changes() AS count").count;
      const result = await h.send("/api/my-work");
      assert.equal(result.items.length, 250);
      assert.ok(result.items.every(item => item.auditHistory.length === 1));
      assert.ok(!result.items.some(item => item.id === "AUDIT-OTHER-USER"));
      assert.equal(database.one("SELECT total_changes() AS count").count, before);
    });
    await t.test("reconciliation closes more than 100 resolved tasks without changing another user's work", async () => {
      await h.post("/api/my-work", { action: "reconcile" });
      assert.equal(database.one("SELECT count(*) AS count FROM command_work_items WHERE id LIKE 'AUDIT-VOLUME-%' AND status = 'Completed'").count, 250);
      assert.equal(database.one("SELECT status FROM command_work_items WHERE id = 'AUDIT-OTHER-USER'").status, "Open");
    });
    await t.test("failure evidence recovers its table and alerts active leadership after repeated errors", async () => {
      database.sqlite.exec("DROP TABLE runtime_failure_events");
      for (let attempt = 0; attempt < 3; attempt++) {
        database.injectFailure({ pattern: /from "command_work_items"/i, once: true });
        const error = await h.send("/api/my-work", { expected: 500 });
        assert.ok(error.requestId);
      }
      assert.equal(database.one("SELECT count(*) AS count FROM runtime_failure_events WHERE route = '/api/my-work'").count, 3);
      assert.equal(database.one("SELECT count(*) AS count FROM command_work_items WHERE source_type = 'Runtime Failure Event'").count, 2);
    });
    assert.equal(h.outbound.length, 0);
    t.diagnostic(`${h.calls()} HTTP requests, 251 synthetic tasks, enforced 100-parameter database limit.`);
  } finally { await h.close(); }
});

test("standalone audit: project boundaries and legitimate team assignments", async t => {
  const h = await harness();
  try {
    await activateActor(h.runtime.database, F06_ACTORS.employee);
    const own = await project(h, "Assigned");
    const other = await project(h, "Confidential", false);
    const file = (await h.send("/api/files", { method: "POST", body: upload(other.number), expected: 201 })).file;
    await t.test("unassigned staff cannot list or download another project's files", async () => {
      await h.send(`/api/files?projectId=${other.number}`, { actor: pm, expected: 403 });
      await h.send(`/api/files?id=${file.id}`, { actor: pm, expected: 403 });
    });
    await t.test("ordinary and large uploads enforce the same project boundary", async () => {
      await h.send("/api/files", { method: "POST", body: upload(other.number), actor: pm, expected: 403 });
      await h.post("/api/files/multipart?action=create", { projectId: other.number, name: "drawing.pdf", sizeBytes: 30000000, contentType: "application/pdf" }, pm, 403);
    });
    await t.test("multipart upload is bound to its creator and its original file details", async () => {
      const details = { projectId: own.number, name: "multipart-test.pdf", contentType: "application/pdf", category: "Drawings", revision: "Audit", access: "Project team", sizeBytes: 8 };
      const created = await h.post("/api/files/multipart?action=create", details, pm);
      const path = "/api/files/multipart?projectId=" + own.number + "&storageKey=" + encodeURIComponent(created.storageKey) + "&uploadId=" + created.uploadId + "&partNumber=1";
      const partOptions = { method: "PUT", body: new TextEncoder().encode("%PDFtest"), headers: { "Content-Length": "8" } };
      await h.send(path, { ...partOptions, actor: superintendent, expected: 403 });
      const part = await h.send(path, { ...partOptions, actor: pm });
      const complete = { ...details, ...created, parts: [part] };
      await h.post("/api/files/multipart?action=complete", { ...complete, category: "Incident Private" }, pm, 409);
      const stored = await h.post("/api/files/multipart?action=complete", complete, pm, 201);
      const downloaded = await h.send("/api/files?id=" + stored.file.id, { actor: pm, binary: true });
      assert.equal(new TextDecoder().decode(downloaded), "%PDFtest");
    });
    await t.test("failed file registration removes the unregistered file bytes", async () => {
      const before = h.runtime.bucket.objects.size;
      h.runtime.database.injectFailure({ pattern: /insert into "project_files"/i, once: true });
      await h.send("/api/files", { method: "POST", body: upload(own.number), expected: 500 });
      assert.equal(h.runtime.bucket.objects.size, before);
    });
    await t.test("selected project in a search query is not an access grant", async () => {
      const result = await h.send(`/api/search?q=confidential&projectId=${other.number}`, { actor: pm });
      assert.equal(result.results.length, 0);
    });
    for (const route of ["closeout", "quality-control", "design-lifecycle", "purchase-orders", "selections", "customer-survey-recipients", "team-access", "contracts", "procurement", "project-correspondence", "safety"]) {
      await t.test(`${route} respects project assignment`, async () => {
        await h.send(`/api/${route}?projectId=${other.number}`, { actor: pm, expected: 403 });
        await h.send(`/api/${route}?projectId=${own.number}`, { actor: pm });
      });
    }
    await t.test("contract and closeout exports enforce the same project boundary", async () => {
      await h.send("/api/contracts/document?projectId=" + other.number + "&recordId=OWNER-CONTRACT-" + other.number + "&format=docx", { actor: pm, expected: 403 });
      await h.send("/api/closeout/package?projectId=" + other.number, { actor: pm, expected: 403 });
    });
    await t.test("explicit secondary PM assignment grants records, files, and project controls", async () => {
      const beforeTeam = await h.send(`/api/team-access?projectId=${other.number}`);
      assert.ok(!beforeTeam.employees.find(member => member.email === pm.email).projectDesignations.includes("Project Manager"));
      await h.post("/api/team-access", { action: "save-designations", projectId: other.number, employeeEmail: pm.email, scope: "project", designations: ["Project Manager"] });
      const afterTeam = await h.send(`/api/team-access?projectId=${other.number}`);
      assert.ok(afterTeam.employees.find(member => member.email === pm.email).projectDesignations.includes("Project Manager"));
      await h.send(`/api/records?projectId=${other.number}&recordType=Schedule`, { actor: pm });
      await h.send(`/api/files?id=${file.id}`, { actor: pm, binary: true });
      await h.send(`/api/purchase-orders?projectId=${other.number}`, { actor: pm });
      const projects = await h.send("/api/projects", { actor: pm });
      assert.ok(projects.projects.some(p => p.number === other.number));
      await h.post("/api/team-access", { action: "save-designations", projectId: other.number, employeeEmail: pm.email, scope: "project", designations: [] });
      await h.send(`/api/files?id=${file.id}`, { actor: pm, expected: 403 });
    });
    await t.test("finance access remains restricted by actual accounting authority", async () => {
      await h.send("/api/financial-reports", { actor: pm, expected: 403 });
      await h.send("/api/financial-reports", { actor: accountant });
      await h.save(own.number, "Job Cost Actual", "FORGED-COST", "Posted", { amount: 100 }, accountant, 403);
      await h.save(own.number, "Owner Receipt", "FORGED-RECEIPT", "Posted", { amount: 100 }, pm, 403);
    });
    await t.test("administrative corrections cannot mark an invoice paid outside the ledger", async () => {
      const id = "AUDIT-CORRECTION-INVOICE";
      await h.save("MEFFORD-ACCOUNTING", "AP Invoice", id, "Draft", { vendor: "Synthetic Vendor", invoiceNumber: id, total: 100, allocations: [{ id: "a", destination: own.number, code: "0131.19", amount: 100 }] }, accountant);
      await h.post(`/api/records/${id}/corrections`, { projectId: "MEFFORD-ACCOUNTING", recordType: "AP Invoice", fieldName: "status", oldValue: "Draft", newValue: "Paid", reason: "Synthetic attempt to bypass posting", record: { id, title: "Synthetic invoice", owner: accountant.name, due: today, status: "Draft" }, changes: { status: "Paid" } }, owner, 409);
      assert.equal(h.row("MEFFORD-ACCOUNTING", id).status, "Draft");
      await h.save("MEFFORD-ACCOUNTING", "General Note", id, "Paid", {}, owner, 409);
    });
    await t.test("new four-digit accounts can be proposed; only the owner activates them", async () => {
      const data = { category: "Current Assets", normalBalance: "Debit", source: "SYNTHETIC AUDIT" };
      await h.save("MEFFORD-ACCOUNTING", "Chart Of Accounts", "1591", "Proposed", data, accountant);
      await h.save("MEFFORD-ACCOUNTING", "Chart Of Accounts", "1591", "Active", data, accountant, 403);
      await h.save("MEFFORD-ACCOUNTING", "Chart Of Accounts", "1591", "Active", data);
    });
    assert.equal(h.outbound.length, 0);
    t.diagnostic(`${h.calls()} HTTP requests, two isolated jobs, no Microsoft or other external requests.`);
  } finally { await h.close(); }
});

test("standalone audit: native workspaces, Word export and scheduler without provider connections", async t => {
  const h = await harness();
  try {
    const job = await project(h, "Standalone Workspaces");
    for (const path of ["/api/session", "/api/accounting", "/api/accounting-controls", "/api/financial-reports",
      "/api/employee-time", "/api/employee-resources", "/api/employee-goals", "/api/employee-lifecycle",
      "/api/onboarding", "/api/vendors", "/api/assets", "/api/company-calendar", "/api/my-work",
      "/api/dashboard-preferences?projectId=" + job.number, "/api/schedule-templates", "/api/operating-doctrine", "/api/review", "/api/marketing",
      "/api/integration-health", "/api/system-status", "/api/microsoft-access",
      "/api/meetings?projectId=" + job.number, "/api/project-health?projectId=" + job.number, "/api/schedule-intelligence?projectId=" + job.number]) {
      await t.test(path + " loads without Microsoft", async () => { await h.send(path); });
    }
    await t.test("Outlook and Teams report the missing connection explicitly", async () => {
      const result = await h.send("/api/employee-meetings", { expected: 403 });
      assert.equal(result.configured, false); assert.match(result.error, /Microsoft/);
    });
    await t.test("contract Word download contains an editable document", async () => {
      const bytes = await h.send("/api/contracts/document?projectId=" + job.number + "&recordId=OWNER-CONTRACT-" + job.number + "&format=docx", { binary: true });
      const files = unzipSync(bytes);
      assert.ok(files["word/document.xml"]);
      assert.match(new TextDecoder().decode(files["word/document.xml"]), /Mefford|MEFFORD/);
    });
    await t.test("heartbeat runs a durable group and does not repeat the same window", async () => {
      const result = await h.post("/api/automation-heartbeat", {});
      assert.equal(result.ran, true);
      const second = await h.post("/api/automation-heartbeat", {}, owner, 202);
      assert.equal(second.ran, false);
      assert.ok(h.runtime.database.one("SELECT id FROM scheduler_cycle_checkpoints WHERE status = 'Completed'"));
    });
    assert.equal(h.outbound.length, 0, "Disconnected providers must not be called by native workspaces");
    t.diagnostic(h.calls() + " actual HTTP requests for native workspaces, exports and the scheduler fallback.");
  } finally { await h.close(); }
});

test("standalone audit: executed change orders update contract, budget and schedule atomically", async t => {
  const h = await harness();
  try {
    const job = await saleToExecutedContract(h, { name: "Change Order Controls", type: "Plan & Spec Lump Sum", cost: 10000 }, "change");
    const projectId = job.projectId;
    const baseBudget = h.row(projectId, "0131.19").data;
    const data = { changeType: "Additive", pricingLines: [{ id: "line-1", costCode: "0131.19", description: "Synthetic extra scope", cost: 1000, markupPercent: 10 }],
      approvedTotal: 1100, originalContractValue: job.summary.contractValue, previousApprovedChangeOrders: 0, contractValueAfterThisChange: job.summary.contractValue + 1100,
      scheduleDays: 2, newSubstantialDate: "2027-05-03", newFinalDate: "2027-06-03", ownerSignatureName: job.customer.name, ownerSignatureTitle: "Test Owner",
      ownerSignatureDate: today, ownerSignatureMethod: "Uploaded Signed PDF", executedAt: new Date().toISOString() };
    const file = (await h.send("/api/files", { method: "POST", body: upload(projectId, "Financial Info / Change Orders", "CO-AUDIT-001.pdf"), expected: 201 })).file;
    data.executedFileName = file.name; data.executedFileId = file.id;
    await h.save(projectId, "Change Orders", "CO-AUDIT-001", "Awaiting Owner Signature", data);
    const executed = await h.save(projectId, "Change Orders", "CO-AUDIT-001", "Executed", data);
    assert.equal(executed.contractAmendmentId, "AMEND-CO-AUDIT-001");
    assert.equal(Number(h.runtime.database.one("SELECT current_contract_amount FROM projects WHERE number = ?", projectId).current_contract_amount), data.contractValueAfterThisChange, "The server must persist the revised contract value");
    assert.equal(h.row(projectId, "0131.19").data.approvedChanges, Number(baseBudget.approvedChanges || 0) + 1100);
    assert.equal(h.runtime.database.one("SELECT final_date FROM projects WHERE number = ?", projectId).final_date, data.newFinalDate);
    await h.save(projectId, "Change Orders", "CO-AUDIT-001", "Executed", data);
    assert.equal(h.row(projectId, "0131.19").data.approvedChanges, Number(baseBudget.approvedChanges || 0) + 1100, "Retry cannot apply a change twice");
    const deduction = { ...data, changeType: "Deductive", approvedTotal: -1100, previousApprovedChangeOrders: 1100, contractValueAfterThisChange: job.summary.contractValue };
    await h.save(projectId, "Change Orders", "CO-AUDIT-002", "Awaiting Owner Signature", deduction);
    h.runtime.database.injectFailure({ pattern: /UPDATE "projects"/i, once: true });
    await h.save(projectId, "Change Orders", "CO-AUDIT-002", "Executed", deduction, owner, 500);
    assert.equal(h.row(projectId, "CO-AUDIT-002").status, "Awaiting Owner Signature");
    assert.equal(h.row(projectId, "AMEND-CO-AUDIT-002"), null);
    assert.equal(h.row(projectId, "0131.19").data.approvedChanges, Number(baseBudget.approvedChanges || 0) + 1100);
    await h.save(projectId, "Change Orders", "CO-AUDIT-002", "Executed", deduction);
    assert.equal(Number(h.runtime.database.one("SELECT current_contract_amount FROM projects WHERE number = ?", projectId).current_contract_amount), job.summary.contractValue);
    assert.equal(h.row(projectId, "0131.19").data.approvedChanges, Number(baseBudget.approvedChanges || 0));
    assert.equal(h.outbound.length, 0);
    t.diagnostic(h.calls() + " HTTP requests; additive, deductive, retry and database failure paths.");
  } finally { await h.close(); }
});

test("standalone audit: historical AP, AR and retainage remain tied to their dates", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(today + "T12:00:00Z") });
  const h = await harness();
  try {
    const job = await saleToExecutedContract(h, { name: "Historical Finance", type: "Plan & Spec Lump Sum", cost: 10000 }, "historical");
    const projectId = job.projectId;
    const invoice = { vendor: "Synthetic Office Vendor", invoiceNumber: "ASOF-AP", total: 1234.56, paymentMethod: "Check", allocations: [{ id: "a", destination: "Company Overhead", code: "960", amount: 1234.56 }] };
    await h.save("MEFFORD-ACCOUNTING", "AP Invoice", "ASOF-AP", "Approved Unpaid", invoice, accountant);
    await h.save(projectId, "Owner Billing Setup", "OWNER-BILLING-SETUP", "Locked", { ...h.row(projectId, "OWNER-BILLING-SETUP").data, sovLines: [{ id: "sov", description: "Synthetic contract", scheduledValue: job.summary.contractValue }] });
    const billing = { projectNumber: projectId, billingPeriod: today.slice(0, 7), ownerName: job.customer.name, currentPaymentDue: 9000, currentEarned: 10000, cumulativeEarned: 10000, retainageThisPeriod: 1000, retainageToDate: 1000, lines: [{ id: "sov", scheduledValue: job.summary.contractValue, totalThisPeriod: 10000 }] };
    await h.save(projectId, "Owner Billing", "ASOF-BILL", "PM Preparation", billing, pm);
    await h.save(projectId, "Owner Billing", "ASOF-BILL", "Accountant Review", billing, pm);
    await h.save(projectId, "Owner Billing", "ASOF-BILL", "Owner Approval", billing, accountant);
    await h.save(projectId, "Owner Billing", "ASOF-BILL", "Ready To Send", billing);
    await h.post("/api/accounting", { action: "send-owner-billing", projectId, recordId: "ASOF-BILL", deliveryReference: "SYNTHETIC ONLY" }, accountant);
    const before = await h.send("/api/financial-reports?asOf=" + today, { actor: accountant });
    assert.equal(before.summary.accountsReceivable, 9000); assert.equal(before.summary.openAp, 1234.56);
    const later = new Date(Date.parse(today + "T12:00:00Z") + 86400000 * 2).toISOString().slice(0, 10);
    t.mock.timers.setTime(Date.parse(later + "T12:00:00Z"));
    await h.save("MEFFORD-ACCOUNTING", "Payment Batch", "ASOF-BATCH", "Prepared", { invoiceIds: ["ASOF-AP"], total: 1234.56 }, accountant);
    await h.post("/api/accounting", { action: "release-payment-batch", recordId: "ASOF-BATCH" });
    await h.post("/api/accounting", { action: "clear-payment-batch", recordId: "ASOF-BATCH", confirmation: "SYNTHETIC LATER CLEARING" }, accountant);
    await h.post("/api/accounting", { action: "record-owner-receipt", projectId, recordId: "ASOF-BILL", amount: 9000, receiptDate: later, reference: "SYNTHETIC LATER DEPOSIT" }, accountant);
    await t.test("past report does not apply a later AP payment", async () => {
      const prior = await h.send("/api/financial-reports?asOf=" + today, { actor: accountant });
      assert.equal(prior.summary.openAp, before.summary.openAp);
      assert.equal(prior.reports.find(r => r.type === "ap-aging").totals[4], 1234.56);
      assert.equal(prior.reports.find(r => r.type === "cash-movement").totals[4], 0);
    });
    await t.test("past AR aging reconciles to the original open invoice after later collection", async () => {
      const prior = await h.send("/api/financial-reports?asOf=" + today, { actor: accountant });
      assert.equal(prior.summary.accountsReceivable, 9000);
      assert.equal(prior.reports.find(r => r.type === "ar-aging").totals[4], 9000);
    });
    await t.test("current report clears AP and AR to the cent", async () => {
      const current = await h.send("/api/financial-reports?asOf=" + later, { actor: accountant });
      assert.equal(current.summary.accountsReceivable, 0); assert.equal(current.reports.find(r => r.type === "ap-aging").totals[4], 0);
      assert.equal(current.summary.retainageReceivable, 1000);
      const closeout = await h.send("/api/closeout?projectId=" + projectId);
      assert.ok(closeout.totalCloseout.blockers.some(value => /retainage/i.test(value)), "Unbilled retainage must prevent total closeout even after current invoices are paid");
    });
    await t.test("retainage release remains open until issued and collected", async () => {
      const release = { ...billing, currentPaymentDue: 1000, currentEarned: 0, retainageThisPeriod: -1000, retainageToDate: 0, lines: [{ id: "sov", scheduledValue: job.summary.contractValue, totalThisPeriod: 0 }] };
      await h.save(projectId, "Owner Billing", "ASOF-BILL-002", "PM Preparation", release, pm);
      assert.equal((await h.send("/api/financial-reports?projectId=" + projectId + "&asOf=" + later, { actor: accountant })).summary.retainageReceivable, 1000);
      await h.save(projectId, "Owner Billing", "ASOF-BILL-002", "Accountant Review", release, pm);
      await h.save(projectId, "Owner Billing", "ASOF-BILL-002", "Owner Approval", release, accountant);
      await h.save(projectId, "Owner Billing", "ASOF-BILL-002", "Ready To Send", release);
      await h.post("/api/accounting", { action: "send-owner-billing", projectId, recordId: "ASOF-BILL-002", deliveryReference: "SYNTHETIC RETAINAGE RELEASE" }, accountant);
      const released = await h.send("/api/financial-reports?projectId=" + projectId + "&asOf=" + later, { actor: accountant });
      assert.equal(released.summary.retainageReceivable, 0); assert.equal(released.summary.accountsReceivable, 1000);
      await h.post("/api/accounting", { action: "record-owner-receipt", projectId, recordId: "ASOF-BILL-002", amount: 1000, receiptDate: later, reference: "SYNTHETIC RETAINAGE DEPOSIT" }, accountant);
      const closeout = await h.send("/api/closeout?projectId=" + projectId);
      assert.equal(closeout.totalCloseout.blockers.filter(value => /receivable|retainage/i.test(value)).length, 0);
    });
    assert.equal(h.outbound.length, 0);
    t.diagnostic(h.calls() + " HTTP requests, issue date and later payment date, with actual posted journals.");
  } finally { await h.close(); t.mock.timers.reset(); }
});

test("standalone audit: payroll return posting and independent bank review", async t => {
  const h = await harness();
  try {
    const a = await project(h, "Payroll A"), b = await project(h, "Payroll B");
    const packet = { periodStart: today.slice(0, 7) + "-01", periodEnd: today, payDate: today, employee: "Synthetic Payroll Employee",
      regularHours: 40, overtimeHours: 0, ptoHours: 0, holidayHours: 0,
      allocations: [{ destination: a.number, code: "0131.19", hours: 24 }, { destination: b.number, code: "0131.19", hours: 16 }] };
    await t.test("payroll packet rejects negative or undistributed hours", async () => {
      await h.post("/api/accounting", { action: "save-payroll-report", payroll: { ...packet, regularHours: -40 } }, accountant, 400);
      await h.post("/api/accounting", { action: "save-payroll-report", payroll: { ...packet, regularHours: 41 } }, accountant, 400);
    });
    await h.post("/api/accounting", { action: "save-payroll-report", payroll: packet }, accountant);
    const returned = { periodStart: packet.periodStart, periodEnd: today, payDate: today, returnReference: "SYNTHETIC PAYROLL RETURN",
      grossWages: 1000.13, employerTaxes: 100.17, employerBenefits: 99.70, employeeDeductions: 200.13, netPay: 800,
      allocations: [{ destination: a.number, code: "0131.19", amount: 720 }, { destination: b.number, code: "0131.19", amount: 480 }] };
    await t.test("payroll source, project costs and journal roll back together", async () => {
      const before = h.runtime.database.one("SELECT COUNT(*) AS count FROM accounting_events").count;
      h.runtime.database.injectFailure({ pattern: /INSERT INTO command_records/, once: true });
      await h.post("/api/accounting", { action: "record-paylocity-return", payrollReturn: returned }, accountant, 500);
      assert.equal(h.runtime.database.one("SELECT COUNT(*) AS count FROM accounting_events").count, before, "Failed payroll source write must roll back its journal");
      assert.equal(h.runtime.database.one("SELECT COUNT(*) AS count FROM command_records WHERE record_type = 'Job Cost Actual'").count, 0);
    });
    await t.test("retry distributes payroll once to both jobs", async () => {
      await h.post("/api/accounting", { action: "record-paylocity-return", payrollReturn: returned }, accountant);
      await h.post("/api/accounting", { action: "record-paylocity-return", payrollReturn: returned }, accountant, 409);
      // Report through the fixture's pay date; the default Eastern date can lag UTC.
      const reportA = await h.send("/api/financial-reports?projectId=" + a.number + "&asOf=" + returned.payDate, { actor: accountant });
      const reportB = await h.send("/api/financial-reports?projectId=" + b.number + "&asOf=" + returned.payDate, { actor: accountant });
      assert.equal(reportA.summary.actualCost, 720); assert.equal(reportB.summary.actualCost, 480);
      const balance = h.runtime.database.one("SELECT SUM(debit_cents) AS debit, SUM(credit_cents) AS credit FROM accounting_journal_lines");
      assert.equal(balance.debit, balance.credit);
    });
    await t.test("high-dollar payroll remains held until independent owner approval and rolls back on failure", async () => {
      const end = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 0)).toISOString().slice(0, 10);
      const start = end.slice(0, 7) + "-01";
      await h.post("/api/accounting", { action: "save-payroll-report", payroll: { ...packet, periodStart: start, periodEnd: end, payDate: end } }, accountant);
      const largeReturn = { ...returned, periodStart: start, periodEnd: end, payDate: end, returnReference: "SYNTHETIC LARGE PAYROLL",
        grossWages: 230000, employerTaxes: 20000, employerBenefits: 0, employeeDeductions: 50000, netPay: 180000,
        allocations: [{ destination: a.number, code: "0131.19", amount: 150000 }, { destination: b.number, code: "0131.19", amount: 100000 }] };
      const before = h.runtime.database.one("SELECT COUNT(*) AS count FROM accounting_events").count;
      const prepared = await h.post("/api/accounting", { action: "record-paylocity-return", payrollReturn: largeReturn }, accountant);
      assert.equal(prepared.status, "Owner Approval Required");
      assert.equal(h.runtime.database.one("SELECT COUNT(*) AS count FROM accounting_events").count, before);
      await h.post("/api/accounting", { action: "approve-paylocity-return", recordId: prepared.id }, accountant, 403);
      h.runtime.database.injectFailure({ pattern: /INSERT INTO command_records/, once: true });
      await h.post("/api/accounting", { action: "approve-paylocity-return", recordId: prepared.id }, owner, 500);
      assert.equal(h.runtime.database.one("SELECT COUNT(*) AS count FROM accounting_events").count, before);
      assert.equal(h.row("MEFFORD-ACCOUNTING", prepared.id).status, "Owner Approval Required");
      await h.post("/api/accounting", { action: "approve-paylocity-return", recordId: prepared.id });
      const report = await h.send("/api/financial-reports?projectId=" + a.number + "&asOf=" + returned.payDate, { actor: accountant });
      assert.equal(report.summary.actualCost, 150720);
    });
    await t.test("employee time rejects nonexistent destinations and keeps submitted work auditable", async () => {
      await activateActor(h.runtime.database, F06_ACTORS.employee);
      const time = await h.send("/api/employee-time", { actor: F06_ACTORS.employee });
      const entries = [{ date: time.selectedPeriod.start, destination: "NONEXISTENT-JOB", code: "0131.19", timeType: "Regular", hours: 8 }];
      await h.post("/api/employee-time", { periodEnd: time.selectedPeriod.end, status: "Employee Submitted", entries }, F06_ACTORS.employee, 400);
      entries[0].destination = a.number;
      const saved = await h.post("/api/employee-time", { periodEnd: time.selectedPeriod.end, status: "Employee Submitted", entries }, F06_ACTORS.employee);
      assert.equal(saved.totals.total, 8);
      assert.equal(h.row("MEFFORD-ACCOUNTING", saved.id).data.employeeEmail, F06_ACTORS.employee.email);
    });
    await t.test("bank reconciliation requires independent owner review and then locks", async () => {
      const cash = await h.post("/api/accounting", { action: "save-cash-account", account: { name: "Synthetic Test Bank", lastFour: "0000", statementDate: today, bookBalance: 1000, bankBalance: 1000 } }, accountant);
      const reconciliation = { cashAccountId: cash.id, statementStart: packet.periodStart, statementEnd: today, statementEndingBalance: 1000, bookEndingBalance: 1000 };
      const prepared = await h.post("/api/accounting-controls", { action: "save-bank-reconciliation", reconciliation }, accountant);
      await h.post("/api/accounting-controls", { action: "approve-bank-reconciliation", recordId: prepared.id }, accountant, 403);
      await h.post("/api/accounting-controls", { action: "approve-bank-reconciliation", recordId: prepared.id });
      await h.post("/api/accounting-controls", { action: "save-bank-reconciliation", reconciliation: { ...reconciliation, id: prepared.id, bookEndingBalance: 900 } }, accountant, 423);
    });
    assert.equal(h.outbound.length, 0);
    t.diagnostic(h.calls() + " payroll and reconciliation HTTP requests; no payroll, banking, or Microsoft provider called.");
  } finally { await h.close(); }
});
