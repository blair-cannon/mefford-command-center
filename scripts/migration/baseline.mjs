#!/usr/bin/env node
/**
 * Computes a row-count + content-hash baseline for every user table in a
 * SQLite/D1 file. Used to prove a migration moved every row, unchanged,
 * regardless of row order or which storage engine wrote it.
 *
 * Usage:
 *   node scripts/migration/baseline.mjs --sqlite <path-to-db-file> --out <path.json> [--label "source: chatgpt sites export"]
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { listUserTables, tableRows } from "./lib/sqlite.mjs";

function parseArgs(argv) {
  const args = { sqlite: null, out: null, label: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--sqlite") args.sqlite = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--label") args.label = argv[++i];
    else throw new Error(`Unrecognized argument: ${arg}`);
  }
  if (!args.sqlite || !args.out) {
    throw new Error("Usage: baseline.mjs --sqlite <db-file> --out <output.json> [--label text]");
  }
  return args;
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

/** Stable per-row hash: keys sorted so column order never affects the hash. */
function hashRow(row) {
  const sortedKeys = Object.keys(row).sort();
  const canonical = JSON.stringify(row, sortedKeys);
  return sha256(canonical);
}

/** Order-independent table hash: sort per-row hashes before combining, so re-insertion order and D1 vs sqlite3 row ordering never matter. */
function hashTable(rows) {
  const rowHashes = rows.map(hashRow).sort();
  return sha256(rowHashes.join("\n"));
}

function buildBaseline(sqlitePath, label) {
  const tables = listUserTables(sqlitePath);
  const tableBaselines = {};
  let totalRows = 0;

  for (const table of tables) {
    const rows = tableRows(sqlitePath, table);
    totalRows += rows.length;
    tableBaselines[table] = {
      rowCount: rows.length,
      hash: hashTable(rows),
    };
  }

  const overallHash = sha256(
    Object.entries(tableBaselines)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([table, info]) => `${table}:${info.rowCount}:${info.hash}`)
      .join("\n"),
  );

  return {
    label,
    generatedAt: new Date().toISOString(),
    source: sqlitePath,
    tableCount: tables.length,
    totalRows,
    overallHash,
    tables: tableBaselines,
  };
}

function main() {
  const { sqlite, out, label } = parseArgs(process.argv.slice(2));
  const baseline = buildBaseline(sqlite, label);
  writeFileSync(out, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`Baseline written to ${out}`);
  console.log(`  tables: ${baseline.tableCount}, rows: ${baseline.totalRows}`);
  console.log(`  overall hash: ${baseline.overallHash}`);
}

main();
