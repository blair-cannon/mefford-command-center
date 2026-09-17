import { createHash } from "node:crypto";

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

/** Stable per-row hash: keys sorted so column order never affects the hash. */
export function hashRow(row) {
  const sortedKeys = Object.keys(row).sort();
  return sha256(JSON.stringify(row, sortedKeys));
}

/** Order-independent table hash: sort per-row hashes before combining, so row order never matters. */
export function hashTable(rows) {
  return sha256(rows.map(hashRow).sort().join("\n"));
}

export { sha256 };
