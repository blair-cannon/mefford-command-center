import assert from "node:assert/strict";
import test from "node:test";
import {
  deletionScopeIdentity,
  finalPurgeConfirmation,
} from "../app/api/owner-delete/route.ts";

function estimateManifest(overrides = {}) {
  return {
    schemaVersion: "OWNER-DELETION-MANIFEST-1",
    requestId: "DELETE-ESTIMATE-1",
    kind: "estimate",
    capturedAt: "2026-08-23T12:00:00.000Z",
    target: { id: "OPP-1", name: "Test Estimate" },
    targetRow: { project_id: "MEFFORD-SALES", id: "OPP-1", record_type: "Sales Opportunities", title: "Test Estimate", status: "Estimating", data_json: "{}" },
    relatedRows: [
      { project_id: "MEFFORD-SALES", id: "OPP-1", record_type: "Sales Opportunities", title: "Test Estimate", status: "Estimating", data_json: "{}" },
      { project_id: "MEFFORD-SALES", id: "EST-1", record_type: "Estimates", title: "Estimate", status: "Draft", data_json: "{}" },
    ],
    relatedSubmissions: [{ id: "SUB-1", status: "Submitted" }],
    relatedWorkItems: [{ id: "WORK-1", status: "Open" }],
    fileScopes: ["ESTIMATE-OPP-1", "DESIGN-OPP-1"],
    files: [{ id: 1, project_id: "ESTIMATE-OPP-1", storage_key: "estimates/one.pdf" }],
    fileKeys: ["estimates/one.pdf"],
    counts: { records: 2, submissions: 1, workItems: 1, files: 1 },
    ...overrides,
  };
}

test("final purge confirmation is exact and target-specific", () => {
  assert.equal(finalPurgeConfirmation("Maple Brook"), "PERMANENTLY DELETE Maple Brook");
  assert.notEqual(finalPurgeConfirmation("Maple Brook"), "permanently delete Maple Brook");
});

test("scope identity ignores mutable statuses but detects new linked records and files", () => {
  const original = estimateManifest();
  const statusOnly = estimateManifest({
    relatedWorkItems: [{ id: "WORK-1", status: "Quarantined" }],
  });
  assert.equal(deletionScopeIdentity(original), deletionScopeIdentity(statusOnly));

  const addedFile = estimateManifest({
    files: [
      ...original.files,
      { id: 2, project_id: "ESTIMATE-OPP-1", storage_key: "estimates/two.pdf" },
    ],
    fileKeys: ["estimates/one.pdf", "estimates/two.pdf"],
  });
  assert.notEqual(deletionScopeIdentity(original), deletionScopeIdentity(addedFile));

  const addedRecord = estimateManifest({
    relatedRows: [
      ...original.relatedRows,
      { project_id: "MEFFORD-SALES", id: "DESIGN-1", record_type: "Design", title: "Design", status: "Draft", data_json: "{}" },
    ],
  });
  assert.notEqual(deletionScopeIdentity(original), deletionScopeIdentity(addedRecord));
});
