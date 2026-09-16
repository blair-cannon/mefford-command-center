import assert from "node:assert/strict";
import test from "node:test";
import {
  hasExecutedOwnerContract,
  isContractedActiveProject,
  needsOwnerContractSignature,
} from "../lib/contracted-projects.ts";

test("only a fully executed owner contract qualifies an awarded job as an active project", () => {
  const executed = { status: "Active", ownerContractStatus: "Executed" };
  const awaitingOwner = { status: "Active", ownerContractStatus: "Ready for Signature" };
  const ownerSigned = { status: "Active", ownerContractStatus: "Owner Signed" };
  const phaseOne = { status: "Active", ownerContractStatus: "Phase 1 Executed" };

  assert.equal(hasExecutedOwnerContract(executed), true);
  assert.equal(isContractedActiveProject(executed), true);
  for (const project of [awaitingOwner, ownerSigned, phaseOne]) {
    assert.equal(isContractedActiveProject(project), false);
    assert.equal(needsOwnerContractSignature(project), true);
  }
});

test("contract tracking accepts project, database, and accounting field names", () => {
  assert.equal(isContractedActiveProject({ status: " active ", owner_contract_status: "executed" }), true);
  assert.equal(isContractedActiveProject({ status: "ACTIVE", contractStatus: "Executed" }), true);
  assert.equal(needsOwnerContractSignature({ status: "Completed", ownerContractStatus: "Draft" }), false);
});
