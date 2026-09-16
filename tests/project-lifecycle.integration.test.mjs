import assert from "node:assert/strict";
import { test } from "node:test";
import { scenarios, harness, saleToExecutedContract } from "./support/project-workflow-harness.mjs";
import { runOperationsAndFinance, runCloseout } from "./support/project-closeout-workflow.mjs";
test("connected sale-to-closeout journeys execute real routes with no production data or external delivery", async t => {
  for (const fixture of scenarios) {
    await t.test(fixture.name, async t => {
      const h = await harness();
      try {
        const job = await saleToExecutedContract(h, fixture);
        t.diagnostic(`Sales → estimate approval → pre-award → award → ${fixture.type === "Design-Build GMP" ? "both contract instruments" : "contract"} execution passed.`);
        await runOperationsAndFinance(h, job);
        t.diagnostic(`PO → AP accrual → payment → owner invoice → partial/final receipts → WIP/report reconciliation passed: ${JSON.stringify(job.report)}`);
        await runCloseout(h, job);
        t.diagnostic(`${h.calls()} HTTP requests; closeout passed; ${h.outbound.length} attempted external requests blocked.`);
      } finally { await h.close(); }
    });
  }
});

test("two active projects keep identical local invoice numbers and deposit references separate", async t => {
  const h = await harness();
  try {
    const jobs = [];
    for (const [index, fixture] of scenarios.slice(0, 2).entries()) {
      const job = await saleToExecutedContract(h, fixture, String(index + 1));
      await runOperationsAndFinance(h, job);
      jobs.push(job);
    }
    const mirrors = h.runtime.database.query("SELECT data_json FROM command_records WHERE project_id = 'MEFFORD-ACCOUNTING' AND record_type = 'AR Invoice'");
    assert.equal(mirrors.length, 2);
    for (const job of jobs) {
      const mirror = mirrors.map(r => JSON.parse(r.data_json)).find(r => r.projectId === job.projectId);
      assert.equal(mirror.receivedToDate, job.summary.contractValue);
      assert.equal(mirror.balance, 0);
      await runCloseout(h, job);
    }
    t.diagnostic(`${h.calls()} HTTP requests; independent AR mirrors, invoices, receipt events, reports, and closeouts verified.`);
  } finally { await h.close(); }
});
