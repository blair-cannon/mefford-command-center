import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import * as XLSX from "xlsx";

import {
  parseSecureSpreadsheetBuffer,
  validateSecureSpreadsheetResult,
  validateSpreadsheetFileMetadata,
} from "../lib/spreadsheet-security.ts";
import { parseSpreadsheetBufferWithWorker } from "../app/secure-spreadsheet-client.ts";

function workbookBuffer(sheetName, rows, mutate) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  mutate?.(sheet, workbook);
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

test("F-07 uses the supported SheetJS release instead of vulnerable npm xlsx 0.18.5", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
  const installed = lock.packages["node_modules/xlsx"];
  assert.equal(packageJson.dependencies.xlsx, "npm:@e965/xlsx@0.20.3");
  assert.equal(installed.name, "@e965/xlsx");
  assert.equal(installed.version, "0.20.3");
  assert.equal(installed.resolved, "https://registry.npmjs.org/@e965/xlsx/-/xlsx-0.20.3.tgz");
  assert.equal(installed.integrity, "sha512-703RN/3OdsRD5mtse2HBX7Um7xwaP9tlswEG6svOtjqokXoX7rJdQj7DyabD2I+xk22RgaIIU+R6BHgkpZGB/w==");
  assert.doesNotMatch(JSON.stringify(installed), /0\.18\.5/);
});

test("F-07 keeps xlsx and xls uploads while enforcing a five megabyte boundary", () => {
  assert.doesNotThrow(() => validateSpreadsheetFileMetadata({ name: "contacts.xlsx", size: 25_000 }, "contacts"));
  assert.doesNotThrow(() => validateSpreadsheetFileMetadata({ name: "schedule.xls", size: 25_000 }, "schedule"));
  assert.throws(() => validateSpreadsheetFileMetadata({ name: "contacts.csv", size: 25_000 }, "contacts"), /Ending In \.xlsx Or \.xls/);
  assert.throws(() => validateSpreadsheetFileMetadata({ name: "contacts.xlsx", size: 0 }, "contacts"), /Empty/);
  assert.throws(() => validateSpreadsheetFileMetadata({ name: "contacts.xlsx", size: 5_000_001 }, "contacts"), /5 MB Safety Limit/);
});

test("F-07 parses a valid contact workbook into prototype-free approved rows", () => {
  const buffer = workbookBuffer("Contacts Import", [
    ["First Name", "Last Name", "Company", "Email", "Notes"],
    ["Jordan", "Mefford", "Mefford Contracting", "jmefford@meffcon.com", "Approved contact import"],
  ]);
  const result = parseSecureSpreadsheetBuffer(buffer, "contacts", buffer.byteLength);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].Company, "Mefford Contracting");
  assert.equal(Object.getPrototypeOf(result.rows[0]), null);
  assert.deepEqual(result.metrics, {
    fileBytes: buffer.byteLength,
    workbookSheets: 1,
    rows: 1,
    columns: 5,
    cells: 5,
    characters: 75,
  });
});

test("F-07 preserves legacy xls contact imports", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["First Name", "Last Name", "Company"],
    ["Jordan", "Mefford", "Mefford Contracting"],
  ]), "Contacts Import");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xls" });
  const result = parseSecureSpreadsheetBuffer(buffer, "contacts", buffer.byteLength);
  assert.equal(result.rows[0].Company, "Mefford Contracting");
});

test("F-07 parses a valid schedule workbook without evaluating formulas", () => {
  const buffer = workbookBuffer("Schedule Import", [
    ["Activity ID", "Scope Of Work", "Subcontractor", "Start Date", "Finish Date", "Percent Complete", "Status", "Predecessor", "Quality Category", "Notes"],
    ["SCH-001", "Mobilization", "Mefford Crew", "2026-09-01", "2026-09-03", 0, "Not Started", "None", "General", ""],
  ]);
  const result = parseSecureSpreadsheetBuffer(buffer, "schedule", buffer.byteLength);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]["Scope Of Work"], "Mobilization");
  assert.equal(result.rows[0]["Start Date"], "2026-09-01");
});

test("F-07 preserves the existing controlled contact and schedule templates", async () => {
  const contacts = await readFile(new URL("../public/templates/Mefford_Contacts_Import_Template.xlsx", import.meta.url));
  const schedule = await readFile(new URL("../public/templates/Mefford_Project_Schedule_Import_Template.xlsx", import.meta.url));
  assert.doesNotThrow(() => parseSecureSpreadsheetBuffer(contacts, "contacts", contacts.byteLength));
  assert.doesNotThrow(() => parseSecureSpreadsheetBuffer(schedule, "schedule", schedule.byteLength));
});

test("F-07 rejects unknown and prototype-shaped column names", () => {
  for (const header of ["__proto__", "constructor", "Unapproved Column"]) {
    const buffer = workbookBuffer("Contacts Import", [
      ["First Name", "Last Name", "Company", header],
      ["Jordan", "Mefford", "Mefford Contracting", "hostile"],
    ]);
    assert.throws(() => parseSecureSpreadsheetBuffer(buffer, "contacts", buffer.byteLength), /Unapproved Column/);
  }
});

test("F-07 rejects formulas, hyperlinks, oversized cells, excessive ranges, and corrupted files", () => {
  const formula = workbookBuffer("Contacts Import", [
    ["First Name", "Last Name", "Company"],
    ["Jordan", "Mefford", "Mefford Contracting"],
  ], (sheet) => { sheet.A2.f = "HYPERLINK(\"https://attacker.invalid\",\"open\")"; });
  assert.throws(() => parseSecureSpreadsheetBuffer(formula, "contacts", formula.byteLength), /Formulas Are Not Allowed/);

  const hyperlink = workbookBuffer("Contacts Import", [
    ["First Name", "Last Name", "Company"],
    ["Jordan", "Mefford", "Mefford Contracting"],
  ], (sheet) => { sheet.A2.l = { Target: "https://attacker.invalid" }; });
  assert.throws(() => parseSecureSpreadsheetBuffer(hyperlink, "contacts", hyperlink.byteLength), /Hyperlinks Are Not Allowed/);

  const longText = workbookBuffer("Contacts Import", [
    ["First Name", "Last Name", "Company", "Notes"],
    ["Jordan", "Mefford", "Mefford Contracting", "x".repeat(5_001)],
  ]);
  assert.throws(() => parseSecureSpreadsheetBuffer(longText, "contacts", longText.byteLength), /Character Safety Limit/);

  const farRange = workbookBuffer("Contacts Import", [
    ["First Name", "Last Name", "Company"],
    ["Jordan", "Mefford", "Mefford Contracting"],
  ], (sheet) => {
    sheet.A2502 = { t: "s", v: "out of range" };
    sheet["!ref"] = "A1:C2502";
  });
  assert.throws(() => parseSecureSpreadsheetBuffer(farRange, "contacts", farRange.byteLength), /Row Or 24 Column Safety Limit/);

  const corrupted = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00, 0x01]);
  assert.throws(() => parseSecureSpreadsheetBuffer(corrupted, "contacts", corrupted.byteLength), /Corrupted, Encrypted, Or Unsupported/);
});

test("F-07 validates every message returned across the worker boundary", () => {
  const valid = {
    profile: "contacts",
    sheetName: "Contacts Import",
    rows: [{ "First Name": "Jordan", "Last Name": "Mefford", Company: "Mefford Contracting" }],
    metrics: { fileBytes: 100, workbookSheets: 1, rows: 1, columns: 3, cells: 3, characters: 39 },
  };
  const result = validateSecureSpreadsheetResult(valid, "contacts");
  assert.equal(Object.getPrototypeOf(result.rows[0]), null);
  assert.throws(() => validateSecureSpreadsheetResult({ ...valid, rows: [{ ...valid.rows[0], constructor: "bad" }] }, "contacts"), /Unapproved Column/);
  assert.throws(() => validateSecureSpreadsheetResult({ ...valid, metrics: { ...valid.metrics, rows: 2 } }, "contacts"), /Inconsistent Row Metrics/);
});

test("F-07 terminates an isolated parser that exceeds its deadline", async () => {
  const worker = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    terminated: false,
    postMessage() {},
    terminate() { this.terminated = true; },
  };
  await assert.rejects(
    parseSpreadsheetBufferWithWorker(worker, new ArrayBuffer(8), 8, "contacts", 5),
    /Exceeded The 5 Second Safety Limit And Was Stopped/,
  );
  assert.equal(worker.terminated, true);
});

test("F-07 accepts a validated worker result and always destroys the worker", async () => {
  const worker = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    terminated: false,
    postMessage(message) {
      queueMicrotask(() => this.onmessage({ data: {
        requestId: message.requestId,
        ok: true,
        result: {
          profile: "schedule",
          sheetName: "Schedule Import",
          rows: [{ "Scope Of Work": "Mobilization", Subcontractor: "Mefford Crew", "Start Date": "2026-09-01", "Finish Date": "2026-09-02" }],
          metrics: { fileBytes: 100, workbookSheets: 1, rows: 1, columns: 4, cells: 4, characters: 55 },
        },
      } }));
    },
    terminate() { this.terminated = true; },
  };
  const result = await parseSpreadsheetBufferWithWorker(worker, new ArrayBuffer(100), 100, "schedule", 50);
  assert.equal(result.rows[0]["Scope Of Work"], "Mobilization");
  assert.equal(worker.terminated, true);
});
