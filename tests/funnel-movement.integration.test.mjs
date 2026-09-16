import assert from "node:assert/strict";
import { test } from "node:test";
import { harness, owner } from "./support/project-workflow-harness.mjs";

test("funnel moves persist and released estimates can advance to negotiation without losing their lock", async t => {
  const h = await harness();
  const project = "MEFFORD-SALES";
  const type = "Sales Opportunities";
  try {
    await t.test("an incomplete lead can move between sales stages and remains stored", async () => {
      await h.save(project, type, "FUNNEL-LEAD", "New Lead", { stage: "New Lead", estimatedValue: "9876543.21", probability: "10" });
      await h.save(project, type, "FUNNEL-LEAD", "Qualified Opportunity", { ...h.row(project, "FUNNEL-LEAD").data, stage: "Qualified Opportunity", probability: "25" });
      const records = await h.send("/api/records?projectId=MEFFORD-SALES");
      const stored = records.records.find(r => r.id === "FUNNEL-LEAD");
      assert.equal(stored.data.stage, "Qualified Opportunity");
      assert.equal(stored.data.estimatedValue, "9876543.21");
    });
    await t.test("an incomplete lead cannot skip the estimating handoff", async () => {
      await h.save(project, type, "FUNNEL-LEAD", "Estimating", { ...h.row(project, "FUNNEL-LEAD").data, stage: "Estimating" }, owner, 400);
      assert.equal(h.row(project, "FUNNEL-LEAD").data.stage, "Qualified Opportunity");
    });
    await t.test("a released estimate advances through proposal and negotiation", async () => {
      await h.save(project, type, "FUNNEL-ESTIMATE", "Estimating", { stage: "Estimating", directEstimate: true, assignedEstimator: owner.name, estimatedValue: "1234567.89" });
      const locked = h.row(project, "FUNNEL-ESTIMATE").data;
      assert.ok(locked.estimatingLockedAt);
      for (const stage of ["Proposal Submitted", "Negotiation"]) {
        await h.save(project, type, "FUNNEL-ESTIMATE", stage, { ...h.row(project, "FUNNEL-ESTIMATE").data, stage });
        const saved = h.row(project, "FUNNEL-ESTIMATE").data;
        assert.equal(saved.stage, stage);
        assert.equal(saved.estimatingLockedAt, locked.estimatingLockedAt);
        assert.equal(saved.estimatingRequestedAt, locked.estimatingRequestedAt);
      }
    });
    await t.test("negotiation cannot remove the handoff lock or move back into lead stages", async () => {
      const before = h.row(project, "FUNNEL-ESTIMATE").data;
      for (const stage of ["New Lead", "Qualified Opportunity", "Site Visit And Discovery"]) {
        await h.save(project, type, "FUNNEL-ESTIMATE", stage, { ...before, stage, estimatingRequestedAt: "", estimatingLockedAt: "", directEstimate: false }, owner, 409);
        assert.deepEqual(h.row(project, "FUNNEL-ESTIMATE").data, before);
      }
    });
    assert.equal(h.outbound.length, 0);
  } finally { await h.close(); }
});
