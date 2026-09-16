import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workspace = fs.readFileSync(new URL("../app/estimate-project-workspace.tsx", import.meta.url), "utf8");
const proposals = fs.readFileSync(new URL("../lib/proposals.ts", import.meta.url), "utf8");

test("estimating folders have one continuous visible sequence from 01 through 10", () => {
  const block = workspace.slice(workspace.indexOf("const estimateFolders"), workspace.indexOf("] as const;") + 11);
  const numbers = [...block.matchAll(/label: "(\d{2})-/g)].map((match) => match[1]);
  assert.deepEqual(numbers, ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"]);
  assert.equal(new Set(numbers).size, numbers.length);
});

test("legacy estimating files follow the corrected folders without being lost", () => {
  for (const [legacy, current] of [
    ["03-Estimating - Cap Sheet", "04-Estimating - Cap Sheet"],
    ["04-Owner Proposal & LOE", "05-Owner Proposal & LOE"],
    ["04-Builders Risk & Bond Request", "06-Builders Risk & Bond Request"],
    ["05-Contract", "07-Contract"],
    ["06-Permits", "08-Permits"],
    ["07-Legal", "09-Legal"],
    ["08-Post-Construction", "10-Post-Construction"],
  ]) {
    assert.match(workspace, new RegExp(`"${legacy}": "${current}"`));
  }
  assert.match(workspace, /legacyEstimateFolderAliases\[sourceCategory\]/);
  assert.match(proposals, /OWNER_PROPOSAL_FILE_CATEGORY = "05-Owner Proposal & LOE"/);
});
