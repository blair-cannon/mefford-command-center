import assert from "node:assert/strict";
import test from "node:test";
import { postAccountingEvent, ownerReceiptLines } from "../lib/accounting-ledger.ts";
import { createF06Runtime } from "./support/f06-runtime-harness.mjs";

async function fixture() {
  const runtime = await createF06Runtime();
  const db = runtime.database;
  await db.prepare("INSERT INTO command_records (project_id, id, record_type, title, owner, due, status, data_json) VALUES ('TEST', 'BILL', 'Owner Billing', 'Synthetic fixture', 'Test', '2026-09-10', 'Sent', '{}')").run();
  const input = {
    idempotencyKey: "ATOMIC-TEST-DEPOSIT", eventType: "Owner Receipt Posted", sourceType: "Owner Receipt", sourceProjectId: "TEST", sourceRecordId: "DEPOSIT",
    eventDate: "2026-09-10", reference: "SYNTHETIC ONLY", description: "Synthetic atomic posting test", actor: { name: "Test Accountant", email: "test@example.invalid" },
    lines: ownerReceiptLines(100.01, "TEST", "Synthetic receipt"),
    sourceSnapshot: { projectId: "TEST", recordId: "BILL", status: "Sent", dataJson: "{}" },
    relatedStatements: [db.prepare("UPDATE command_records SET status = 'Paid', data_json = ? WHERE project_id = 'TEST' AND id = 'BILL'").bind('{"receivedToDate":100.01}')],
  };
  return { runtime, db, input };
}

test("source records and journal entries roll back together and retry once", async () => {
  const { runtime, db, input } = await fixture();
  try {
    db.injectFailure({ pattern: /UPDATE command_records/, once: true });
    await assert.rejects(postAccountingEvent(db, input), /injected D1 failure/);
    assert.equal(db.one("SELECT COUNT(*) AS count FROM accounting_events").count, 0);
    assert.equal(db.one("SELECT COUNT(*) AS count FROM accounting_journal_lines").count, 0);
    assert.equal(db.one("SELECT status FROM command_records WHERE project_id = 'TEST'").status, "Sent");
    assert.equal((await postAccountingEvent(db, input)).idempotent, false);
    assert.equal((await postAccountingEvent(db, input)).idempotent, true);
    assert.equal(db.one("SELECT COUNT(*) AS count FROM accounting_events").count, 1);
    assert.equal(db.one("SELECT status FROM command_records WHERE project_id = 'TEST'").status, "Paid");
  } finally { await runtime.dispose(); }
});

test("a stale source snapshot cannot overwrite a competing accounting update", async () => {
  const { runtime, db, input } = await fixture();
  try {
    await db.prepare("UPDATE command_records SET data_json = ? WHERE project_id = 'TEST' AND id = 'BILL'").bind('{"receivedToDate":25}').run();
    await assert.rejects(postAccountingEvent(db, input), /Source Changed During Posting/);
    assert.equal(db.one("SELECT COUNT(*) AS count FROM accounting_events").count, 0);
    assert.equal(db.one("SELECT data_json FROM command_records WHERE project_id = 'TEST'").data_json, '{"receivedToDate":25}');
  } finally { await runtime.dispose(); }
});

test("a competing identical deposit commits only one journal and one source update", async () => {
  const { runtime, db, input } = await fixture();
  try {
    const realBatch = db.batch.bind(db);
    let raced = false;
    db.batch = async statements => {
      if (!raced) {
        raced = true;
        await postAccountingEvent(db, input);
      }
      return realBatch(statements);
    };
    assert.equal((await postAccountingEvent(db, input)).idempotent, true);
    assert.equal(db.one("SELECT COUNT(*) AS count FROM accounting_events").count, 1);
    assert.equal(db.one("SELECT COUNT(*) AS count FROM accounting_journal_lines").count, 2);
    assert.equal(db.one("SELECT data_json FROM command_records WHERE project_id = 'TEST'").data_json, '{"receivedToDate":100.01}');
  } finally { await runtime.dispose(); }
});
