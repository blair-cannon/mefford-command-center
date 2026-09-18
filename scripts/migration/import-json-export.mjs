#!/usr/bin/env node
/**
 * Imports a ChatGPT-project D1 export (one JSON file per table, under
 * <export-dir>/d1/*.json, each shaped { table, row_count, columns, rows }) into
 * a target SQLite file that already has the current schema applied (e.g. a
 * scratch file built by replaying every drizzle/*.sql migration in order).
 *
 * Refuses to import if the export references a table the target schema
 * doesn't have — that means the target needs a schema fix first, not a
 * silent partial import. Use --allow-missing-tables to override once you've
 * confirmed the drift is expected (see docs/DATA_MIGRATION_PLAN.md).
 *
 * A same-key row whose content differs from what's already in the target
 * normally aborts the import for manual review. Some tables are derived
 * counters rather than historical records (e.g. dashboard_change_revisions,
 * a cache-invalidation generation stamp that schema triggers bump on writes
 * to other tables) — for those, production's value is simply the correct
 * one to end up with. Name such tables with --overwrite-on-conflict to
 * replace the conflicting row with the export's version instead of aborting.
 *
 * --sql-log <path> appends every executed statement, verbatim and in order,
 * to a plain .sql file. Useful to capture exactly what ran against a local
 * copy of a target (e.g. a materialized `wrangler d1 export` snapshot) so
 * the identical statements can be replayed against the real remote D1 via
 * `wrangler d1 execute <db> --remote --file=<log>` once verified locally.
 *
 * Usage:
 *   node scripts/migration/import-json-export.mjs --export-dir <dir> --sqlite <target-db-file> \
 *     [--allow-missing-tables] [--overwrite-on-conflict table1,table2] [--sql-log <path>]
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { listUserTables, tableRows, tablePrimaryKey, SYSTEM_TABLE_PATTERNS } from "./lib/sqlite.mjs";
import { hashTable, hashRow } from "./lib/hash.mjs";

function parseArgs(argv) {
  const args = { exportDir: null, sqlite: null, allowMissingTables: false, overwriteOnConflict: new Set(), sqlLog: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--export-dir") args.exportDir = argv[++i];
    else if (arg === "--sqlite") args.sqlite = argv[++i];
    else if (arg === "--allow-missing-tables") args.allowMissingTables = true;
    else if (arg === "--sql-log") args.sqlLog = argv[++i];
    else if (arg === "--overwrite-on-conflict") {
      args.overwriteOnConflict = new Set(argv[++i].split(",").map((s) => s.trim()).filter(Boolean));
    } else throw new Error(`Unrecognized argument: ${arg}`);
  }
  if (!args.exportDir || !args.sqlite) {
    throw new Error(
      "Usage: import-json-export.mjs --export-dir <dir> --sqlite <target-db-file> [--allow-missing-tables]",
    );
  }
  return args;
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Non-finite number in export: ${value}`);
    return String(value);
  }
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function loadExportTables(exportDir) {
  const d1Dir = path.join(exportDir, "d1");
  const files = readdirSync(d1Dir).filter(
    (name) => name.endsWith(".json") && name !== "row-counts.json",
  );
  return files
    .map((file) => JSON.parse(readFileSync(path.join(d1Dir, file), "utf8")))
    .filter((t) => !SYSTEM_TABLE_PATTERNS.some((pattern) => pattern.test(t.table)));
}

// Reference/lookup tables seeded by a migration stamp *_at columns
// (created_at, updated_at, verified_at, ...) with CURRENT_TIMESTAMP at
// apply time, so they differ from the timestamps recorded when the same
// migration ran in production. That's not a real data conflict, so *_at
// columns are excluded only from this seed-collision check — normal
// production rows still get their exact historical timestamps preserved
// on insert (see buildInsertSql, which inserts the exported value as-is).
function withoutBookkeepingTimestamps(row) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !key.endsWith("_at")));
}

function primaryKeyValue(row, pkColumns) {
  return pkColumns.map((col) => String(row[col])).join("");
}

/**
 * Splits export rows against what's already in the target table into rows
 * to insert (no matching key present) and conflicts (same key, different
 * content) to skip silently only apply when they're identical migration seed
 * artifacts. Rows whose key already exists and match exactly (ignoring
 * *_at columns) are treated as already-imported and left out of both lists.
 */
function diffAgainstExisting(existingRows, exportRows, pkColumns) {
  const existingByKey = new Map(
    existingRows.map((row) => [primaryKeyValue(row, pkColumns), row]),
  );
  const toInsert = [];
  const conflicts = [];
  let alreadyPresent = 0;

  for (const row of exportRows) {
    const key = primaryKeyValue(row, pkColumns);
    const existing = existingByKey.get(key);
    if (!existing) {
      toInsert.push(row);
      continue;
    }
    if (hashRow(withoutBookkeepingTimestamps(existing)) === hashRow(withoutBookkeepingTimestamps(row))) {
      alreadyPresent += 1;
    } else {
      conflicts.push({ key, existing, exported: row });
    }
  }

  return { toInsert, conflicts, alreadyPresent };
}

// No BEGIN TRANSACTION/COMMIT wrapping: plain sqlite3 accepts it, but
// Cloudflare's remote D1 (backed by Durable Objects storage) rejects
// explicit SQL transaction control statements outright. Omitting it keeps
// local and remote targets running the exact same SQL.
function buildUpdateSql(tableName, columns, pkColumns, rows) {
  const quotedTable = `"${tableName.replace(/"/g, '""')}"`;
  const setColumns = columns.filter((c) => !pkColumns.includes(c));
  const lines = [];
  for (const row of rows) {
    const assignments = setColumns.map((c) => `"${c}" = ${sqlLiteral(row[c])}`).join(", ");
    const whereClause = pkColumns.map((c) => `"${c}" = ${sqlLiteral(row[c])}`).join(" AND ");
    lines.push(`UPDATE ${quotedTable} SET ${assignments} WHERE ${whereClause};`);
  }
  return lines.join("\n");
}

function runSql(sqlite, sql, sqlLog) {
  execFileSync("sqlite3", [sqlite], { input: sql, encoding: "utf8" });
  if (sqlLog) appendFileSync(sqlLog, `${sql}\n`);
}

function buildInsertSql(tableName, columns, rows) {
  const quotedTable = `"${tableName.replace(/"/g, '""')}"`;
  const quotedColumns = columns.map((c) => `"${c.replace(/"/g, '""')}"`).join(", ");
  const lines = [];
  for (const row of rows) {
    const values = columns.map((c) => sqlLiteral(row[c])).join(", ");
    lines.push(`INSERT INTO ${quotedTable} (${quotedColumns}) VALUES (${values});`);
  }
  return lines.join("\n");
}

function main() {
  const { exportDir, sqlite, allowMissingTables, overwriteOnConflict, sqlLog } = parseArgs(process.argv.slice(2));
  if (sqlLog) writeFileSync(sqlLog, "");
  const exportTables = loadExportTables(exportDir);
  const targetTables = new Set(listUserTables(sqlite));

  const missingInTarget = exportTables
    .map((t) => t.table)
    .filter((name) => !targetTables.has(name));

  if (missingInTarget.length && !allowMissingTables) {
    console.error(
      `Refusing to import: ${missingInTarget.length} exported table(s) do not exist in the target schema:`,
    );
    for (const name of missingInTarget) console.error(`  ${name}`);
    console.error(
      "\nCreate them in the target first (see lib/dashboard-display-auth.ts for the " +
        "dashboard_display_* self-bootstrap DDL, or add a migration), or re-run with " +
        "--allow-missing-tables to skip them and import everything else.",
    );
    process.exit(1);
  }

  let totalRowsInserted = 0;
  const skipped = [];

  for (const { table, columns, rows } of exportTables) {
    if (!targetTables.has(table)) {
      skipped.push(table);
      continue;
    }
    if (!rows.length) continue;

    // Migrations can seed reference/lookup or bootstrap rows (e.g. the
    // four-digit account crosswalk, a default identity alias, a couple of
    // employee onboarding records) before any production data is imported.
    // Diff by primary key rather than assuming the whole table must match:
    // a row whose key already exists and is identical (ignoring *_at) was
    // already applied by the seed migration and is skipped; a genuinely new
    // key is inserted; a same-key row with different content is a real
    // conflict that stops the import for manual review.
    const existingRows = tableRows(sqlite, table);
    const pkColumns = existingRows.length ? tablePrimaryKey(sqlite, table) : [];

    let rowsToInsert = rows;
    if (existingRows.length) {
      if (!pkColumns.length) {
        // No declared primary key to diff on — fall back to whole-table comparison.
        if (hashTable(existingRows.map(withoutBookkeepingTimestamps)) === hashTable(rows.map(withoutBookkeepingTimestamps))) {
          console.log(`  ${table}: ${rows.length} row(s) already present (no primary key, matched whole table) — skipped`);
          continue;
        }
        console.error(
          `\nRefusing to import "${table}": it has no primary key to diff by, the target already has ` +
            `${existingRows.length} row(s), and they don't match the export's ${rows.length} row(s) as a whole. ` +
            "This needs manual review before proceeding — stopping with no further changes.",
        );
        process.exit(1);
      }

      const { toInsert, conflicts, alreadyPresent } = diffAgainstExisting(existingRows, rows, pkColumns);
      if (conflicts.length) {
        if (!overwriteOnConflict.has(table)) {
          console.error(
            `\nRefusing to import "${table}": ${conflicts.length} row(s) share a primary key with an ` +
              "existing row but have different content. This needs manual review before proceeding — " +
              "stopping with no further changes. If this table is a derived counter (production's value " +
              "should simply win), re-run with --overwrite-on-conflict " +
              `${table}. First conflict:`,
          );
          console.error(JSON.stringify(conflicts[0], null, 2));
          process.exit(1);
        }
        const updateSql = buildUpdateSql(table, columns, pkColumns, conflicts.map((c) => c.exported));
        runSql(sqlite, updateSql, sqlLog);
        console.log(`  ${table}: overwrote ${conflicts.length} conflicting row(s) with the export's version`);
      }
      if (alreadyPresent) {
        console.log(`  ${table}: ${alreadyPresent} row(s) already present and identical — skipped`);
      }
      rowsToInsert = toInsert;
      if (!rowsToInsert.length) continue;
    }

    const sql = buildInsertSql(table, columns, rowsToInsert);
    runSql(sqlite, sql, sqlLog);
    totalRowsInserted += rowsToInsert.length;
    console.log(`  ${table}: inserted ${rowsToInsert.length} row(s)`);
  }

  console.log(`\nImported ${totalRowsInserted} row(s) across ${exportTables.length - skipped.length} table(s).`);
  if (skipped.length) {
    console.log(`Skipped (missing in target, --allow-missing-tables set): ${skipped.join(", ")}`);
  }

  const coveredTargetTables = new Set(exportTables.map((t) => t.table));
  const notInExport = [...targetTables].filter((name) => !coveredTargetTables.has(name));
  if (notInExport.length) {
    console.log(
      `\n${notInExport.length} target table(s) were not present in this export and remain empty ` +
        `(expected only if the export is a deliberate partial/delta): ${notInExport.join(", ")}`,
    );
  }
}

main();
