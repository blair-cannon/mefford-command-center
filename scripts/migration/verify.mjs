#!/usr/bin/env node
/**
 * Compares two baseline.mjs outputs (e.g. source export vs. imported target)
 * and reports any table whose row count or content hash differs. Exits
 * non-zero on any mismatch so it can gate a cutover script.
 *
 * Usage:
 *   node scripts/migration/verify.mjs --before before.json --after after.json
 */
import { readFileSync } from "node:fs";

function parseArgs(argv) {
  const args = { before: null, after: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--before") args.before = argv[++i];
    else if (arg === "--after") args.after = argv[++i];
    else throw new Error(`Unrecognized argument: ${arg}`);
  }
  if (!args.before || !args.after) {
    throw new Error("Usage: verify.mjs --before <baseline.json> --after <baseline.json>");
  }
  return args;
}

function loadBaseline(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function diffBaselines(before, after) {
  const tableNames = new Set([...Object.keys(before.tables), ...Object.keys(after.tables)]);
  const mismatches = [];

  for (const table of [...tableNames].sort()) {
    const b = before.tables[table];
    const a = after.tables[table];

    if (!b) {
      mismatches.push({ table, issue: "present only after migration (new table)", before: null, after: a });
      continue;
    }
    if (!a) {
      mismatches.push({ table, issue: "missing after migration", before: b, after: null });
      continue;
    }
    if (b.rowCount !== a.rowCount) {
      mismatches.push({ table, issue: "row count differs", before: b.rowCount, after: a.rowCount });
      continue;
    }
    if (b.hash !== a.hash) {
      mismatches.push({ table, issue: "content hash differs (same count, different data)", before: b.hash, after: a.hash });
    }
  }

  return mismatches;
}

function main() {
  const { before: beforePath, after: afterPath } = parseArgs(process.argv.slice(2));
  const before = loadBaseline(beforePath);
  const after = loadBaseline(afterPath);

  console.log(`Before: ${before.label || beforePath} (${before.totalRows} rows, ${before.tableCount} tables)`);
  console.log(`After:  ${after.label || afterPath} (${after.totalRows} rows, ${after.tableCount} tables)`);

  if (before.overallHash === after.overallHash) {
    console.log("MATCH: overall hash identical. Migration verified bit-for-bit at the row level.");
    process.exit(0);
  }

  const mismatches = diffBaselines(before, after);
  console.error(`MISMATCH: ${mismatches.length} table(s) differ.\n`);
  for (const mismatch of mismatches) {
    console.error(`  ${mismatch.table}: ${mismatch.issue}`);
    console.error(`    before: ${JSON.stringify(mismatch.before)}`);
    console.error(`    after:  ${JSON.stringify(mismatch.after)}`);
  }
  process.exit(1);
}

main();
