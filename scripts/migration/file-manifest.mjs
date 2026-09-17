#!/usr/bin/env node
/**
 * Builds the D1-to-R2 file manifest: finds every *_storage_key column in the
 * database, reads the R2 object key each row points to, and cross-references
 * it against a local directory of exported R2 objects (one file per key,
 * nested paths mirroring the key's "/" segments).
 *
 * This is schema-driven, not hardcoded to project_files — it will pick up
 * any current or future table with a column matching /(^|_)storage_key$/.
 *
 * Usage:
 *   node scripts/migration/file-manifest.mjs --sqlite <db-file> --files-dir <dir> --out manifest.json
 */
import { existsSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { listUserTables, tableColumns, querySqliteJson } from "./lib/sqlite.mjs";

const STORAGE_KEY_PATTERN = /(?:^|_)storage_key$/i;
const SIZE_HINT_COLUMNS = ["size_bytes"];
const CONTENT_TYPE_HINT_COLUMNS = ["content_type"];
const LABEL_HINT_COLUMNS = ["name", "file_name", "attachment_name"];

function parseArgs(argv) {
  const args = { sqlite: null, filesDir: null, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--sqlite") args.sqlite = argv[++i];
    else if (arg === "--files-dir") args.filesDir = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else throw new Error(`Unrecognized argument: ${arg}`);
  }
  if (!args.sqlite || !args.out) {
    throw new Error(
      "Usage: file-manifest.mjs --sqlite <db-file> --files-dir <dir> --out manifest.json",
    );
  }
  return args;
}

function findStorageKeyColumns(sqlitePath) {
  const matches = [];
  for (const table of listUserTables(sqlitePath)) {
    const columns = tableColumns(sqlitePath, table);
    for (const column of columns) {
      if (STORAGE_KEY_PATTERN.test(column)) {
        matches.push({
          table,
          column,
          sizeColumn: SIZE_HINT_COLUMNS.find((c) => columns.includes(c)) ?? null,
          contentTypeColumn: CONTENT_TYPE_HINT_COLUMNS.find((c) => columns.includes(c)) ?? null,
          labelColumn: LABEL_HINT_COLUMNS.find((c) => columns.includes(c)) ?? null,
        });
      }
    }
  }
  return matches;
}

function collectReferences(sqlitePath, filesDir) {
  const references = [];
  for (const { table, column, sizeColumn, contentTypeColumn, labelColumn } of findStorageKeyColumns(
    sqlitePath,
  )) {
    const selectColumns = [`"${column}" AS key`, "rowid AS rowid"];
    if (sizeColumn) selectColumns.push(`"${sizeColumn}" AS expectedSize`);
    if (contentTypeColumn) selectColumns.push(`"${contentTypeColumn}" AS expectedContentType`);
    if (labelColumn) selectColumns.push(`"${labelColumn}" AS label`);

    const sql = `SELECT ${selectColumns.join(", ")} FROM "${table}" WHERE "${column}" IS NOT NULL AND "${column}" != ''`;
    const rows = querySqliteJson(sqlitePath, sql);

    for (const row of rows) {
      const entry = {
        key: row.key,
        table,
        column,
        rowid: row.rowid,
        expectedSize: row.expectedSize ?? null,
        expectedContentType: row.expectedContentType ?? null,
        label: row.label ?? null,
      };

      if (filesDir) {
        const localPath = path.join(filesDir, row.key);
        if (existsSync(localPath)) {
          const stat = statSync(localPath);
          entry.foundLocally = true;
          entry.actualSize = stat.size;
          entry.sizeMismatch =
            entry.expectedSize != null && entry.expectedSize !== stat.size;
        } else {
          entry.foundLocally = false;
          entry.actualSize = null;
          entry.sizeMismatch = null;
        }
      }

      references.push(entry);
    }
  }
  return references;
}

function main() {
  const { sqlite, filesDir, out } = parseArgs(process.argv.slice(2));
  const references = collectReferences(sqlite, filesDir);

  const missing = references.filter((r) => r.foundLocally === false);
  const sizeMismatches = references.filter((r) => r.sizeMismatch === true);
  const uniqueKeys = new Set(references.map((r) => r.key));

  const manifest = {
    generatedAt: new Date().toISOString(),
    source: sqlite,
    filesDir: filesDir ?? null,
    totalReferences: references.length,
    uniqueKeys: uniqueKeys.size,
    missingCount: missing.length,
    sizeMismatchCount: sizeMismatches.length,
    references,
  };

  writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`Manifest written to ${out}`);
  console.log(`  storage-key references: ${references.length} (${uniqueKeys.size} unique keys)`);
  if (filesDir) {
    console.log(`  found locally: ${references.length - missing.length}`);
    console.log(`  missing: ${missing.length}`);
    console.log(`  size mismatches: ${sizeMismatches.length}`);
    if (missing.length) {
      console.log("  MISSING KEYS:");
      for (const m of missing) console.log(`    ${m.table}.${m.column} row ${m.rowid}: ${m.key}`);
    }
  } else {
    console.log("  (no --files-dir given; listed references only, no existence check)");
  }
}

main();
