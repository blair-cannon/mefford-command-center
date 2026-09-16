import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const lock = JSON.parse(await readFile(new URL("package-lock.json", root), "utf8"));
const installed = lock.packages?.["node_modules/xlsx"];
const expectedDependency = "npm:@e965/xlsx@0.20.3";
const expectedSource = "https://registry.npmjs.org/@e965/xlsx/-/xlsx-0.20.3.tgz";
const expectedIntegrity = "sha512-703RN/3OdsRD5mtse2HBX7Um7xwaP9tlswEG6svOtjqokXoX7rJdQj7DyabD2I+xk22RgaIIU+R6BHgkpZGB/w==";

assert.equal(packageJson.dependencies?.xlsx, expectedDependency, "F-07 requires the pinned npm-registry SheetJS 0.20.3 package");
assert.equal(installed?.name, "@e965/xlsx", "F-07 requires the verified SheetJS 0.20.3 registry package");
assert.equal(installed?.version, "0.20.3", "F-07 blocks vulnerable SheetJS versions");
assert.equal(installed?.resolved, expectedSource, "F-07 requires the vetted SheetJS release URL");
assert.equal(installed?.integrity, expectedIntegrity, "F-07 requires the vetted SheetJS package integrity");

const [page, schedule, sales, client, worker, security] = await Promise.all([
  readFile(new URL("app/page.tsx", root), "utf8"),
  readFile(new URL("app/schedule-workspace.tsx", root), "utf8"),
  readFile(new URL("app/sales-estimating.tsx", root), "utf8"),
  readFile(new URL("app/secure-spreadsheet-client.ts", root), "utf8"),
  readFile(new URL("app/secure-spreadsheet.worker.ts", root), "utf8"),
  readFile(new URL("lib/spreadsheet-security.ts", root), "utf8"),
]);

assert.doesNotMatch(page, /XLSX\.read\s*\(/, "Schedule uploads may not parse on the main UI thread");
assert.doesNotMatch(schedule, /XLSX\.read\s*\(/, "Schedule workspace may not parse on the main UI thread");
assert.doesNotMatch(sales, /XLSX\.read\s*\(/, "Contact uploads may not parse on the main UI thread");
assert.match(schedule, /parseSpreadsheetFile\(file, "schedule"\)/, "Schedule imports must use the isolated parser");
assert.match(sales, /parseSpreadsheetFile\(file, "contacts"\)/, "Contact imports must use the isolated parser");
assert.match(client, /worker\.terminate\(\)/, "The isolated parser must always be disposable");
assert.match(client, /SPREADSHEET_PARSE_TIMEOUT_MS/, "The isolated parser must have a deadline");
assert.match(worker, /parseSecureSpreadsheetBuffer/, "The worker must use the validated parser");
for (const control of ["maxBytes", "maxRows", "maxColumns", "maxCells", "maxStringLength", "maxTotalCharacters"]) {
  assert.match(security, new RegExp(`\\b${control}\\b`), `F-07 requires ${control}`);
}
assert.match(security, /Formulas Are Not Allowed/, "F-07 requires formula rejection");
assert.match(security, /Hyperlinks Are Not Allowed/, "F-07 requires hyperlink rejection");
assert.match(security, /Object\.create\(null\)/, "F-07 requires prototype-free imported rows");

process.stdout.write("F-07 spreadsheet supply-chain and isolation controls verified.\n");
