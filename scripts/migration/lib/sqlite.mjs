import { execFileSync } from "node:child_process";

/** Runs a query against a plain sqlite3 file (D1's on-disk format) and returns parsed JSON rows. */
export function querySqliteJson(sqlitePath, sql) {
  const raw = execFileSync("sqlite3", ["-json", sqlitePath, sql], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 1024,
  });
  const trimmed = raw.trim();
  return trimmed.length ? JSON.parse(trimmed) : [];
}

export const SYSTEM_TABLE_PATTERNS = [/^sqlite_/, /^d1_/, /^_cf_/, /^__drizzle_migrations$/, /^__appgarden_migrations$/];

/** Lists user tables, excluding SQLite/D1/drizzle bookkeeping tables. */
export function listUserTables(sqlitePath) {
  const rows = querySqliteJson(
    sqlitePath,
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  );
  return rows
    .map((row) => row.name)
    .filter((name) => !SYSTEM_TABLE_PATTERNS.some((pattern) => pattern.test(name)));
}

/** Returns column names for a table, in schema order. */
export function tableColumns(sqlitePath, tableName) {
  const quoted = tableName.replace(/"/g, '""');
  const rows = querySqliteJson(sqlitePath, `PRAGMA table_info("${quoted}")`);
  return rows.map((row) => row.name);
}

/** Returns the table's primary key column names, in key order (empty if none declared). */
export function tablePrimaryKey(sqlitePath, tableName) {
  const quoted = tableName.replace(/"/g, '""');
  const rows = querySqliteJson(sqlitePath, `PRAGMA table_info("${quoted}")`);
  return rows
    .filter((row) => row.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((row) => row.name);
}

/** Fetches every row of a table as an array of plain objects. */
export function tableRows(sqlitePath, tableName) {
  const quoted = tableName.replace(/"/g, '""');
  return querySqliteJson(sqlitePath, `SELECT * FROM "${quoted}"`);
}
