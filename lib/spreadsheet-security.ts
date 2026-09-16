import * as XLSX from "xlsx";

export type SpreadsheetProfile = "contacts" | "schedule";
export type SpreadsheetPrimitive = string | number | boolean | null;
export type SecureSpreadsheetRow = Record<string, SpreadsheetPrimitive>;

type SpreadsheetPolicy = {
  sheetName: string;
  maxBytes: number;
  maxSheets: number;
  maxRows: number;
  maxColumns: number;
  maxCells: number;
  maxStringLength: number;
  maxTotalCharacters: number;
  requiredHeaders: readonly string[];
  allowedHeaders: readonly string[];
};

export const SPREADSHEET_PARSE_TIMEOUT_MS = 5_000;

export const SPREADSHEET_POLICIES: Record<SpreadsheetProfile, SpreadsheetPolicy> = {
  contacts: {
    sheetName: "Contacts Import",
    maxBytes: 5_000_000,
    maxSheets: 4,
    maxRows: 2_500,
    maxColumns: 24,
    maxCells: 60_000,
    maxStringLength: 5_000,
    maxTotalCharacters: 1_000_000,
    requiredHeaders: ["First Name", "Last Name", "Company"],
    allowedHeaders: [
      "First Name",
      "Last Name",
      "Company",
      "Company Type",
      "Title / Position",
      "Email",
      "Phone",
      "Street Address",
      "City",
      "State",
      "Postal Code",
      "Website",
      "Lead Source",
      "Assigned Salesperson",
      "Relationship Status",
      "Last Contact Date",
      "Next Follow-Up Date",
      "Notes",
    ],
  },
  schedule: {
    sheetName: "Schedule Import",
    maxBytes: 5_000_000,
    maxSheets: 6,
    maxRows: 1_000,
    maxColumns: 20,
    maxCells: 20_000,
    maxStringLength: 5_000,
    maxTotalCharacters: 750_000,
    requiredHeaders: ["Scope Of Work", "Subcontractor", "Start Date", "Finish Date"],
    allowedHeaders: [
      "Activity ID",
      "Scope Of Work",
      "Subcontractor",
      "Start Date",
      "Finish Date",
      "Percent Complete",
      "Status",
      "Predecessor",
      "Quality Category",
      "Notes",
      "Duration Days",
      "Validation",
    ],
  },
};

export type SecureSpreadsheetResult = {
  profile: SpreadsheetProfile;
  sheetName: string;
  rows: SecureSpreadsheetRow[];
  metrics: {
    fileBytes: number;
    workbookSheets: number;
    rows: number;
    columns: number;
    cells: number;
    characters: number;
  };
};

export function validateSpreadsheetFileMetadata(
  file: { name: string; size: number; type?: string },
  profile: SpreadsheetProfile,
) {
  const policy = SPREADSHEET_POLICIES[profile];
  const normalizedName = file.name.trim().toLowerCase();
  if (!normalizedName.endsWith(".xlsx") && !normalizedName.endsWith(".xls")) {
    throw new Error("Upload An Excel Workbook Ending In .xlsx Or .xls.");
  }
  if (!Number.isInteger(file.size) || file.size <= 0) {
    throw new Error("The Excel Workbook Is Empty.");
  }
  if (file.size > policy.maxBytes) {
    throw new Error(`The Excel Workbook Exceeds The ${Math.round(policy.maxBytes / 1_000_000)} MB Safety Limit.`);
  }
}

export function parseSecureSpreadsheetBuffer(
  input: ArrayBuffer | Uint8Array,
  profile: SpreadsheetProfile,
  fileBytes = input.byteLength,
): SecureSpreadsheetResult {
  const policy = SPREADSHEET_POLICIES[profile];
  if (!Number.isInteger(fileBytes) || fileBytes <= 0 || fileBytes > policy.maxBytes || input.byteLength !== fileBytes) {
    throw new Error("The Excel Workbook Failed The File Size Safety Check.");
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(input, {
      type: input instanceof Uint8Array ? "array" : "array",
      cellDates: false,
      cellFormula: true,
      cellHTML: false,
      cellNF: false,
      cellStyles: false,
      cellText: false,
      bookVBA: false,
      dense: false,
      sheetRows: Math.max(policy.maxRows + 2, 5_002),
    });
  } catch {
    throw new Error("The Excel Workbook Is Corrupted, Encrypted, Or Unsupported.");
  }

  if (!workbook.SheetNames.length || workbook.SheetNames.length > policy.maxSheets) {
    throw new Error(`The Excel Workbook Must Contain Between 1 And ${policy.maxSheets} Sheets.`);
  }
  rejectActiveWorkbookContent(workbook, policy, profile);

  const sheet = workbook.Sheets[policy.sheetName];
  if (!sheet) {
    throw new Error(`Use The Command Center Template With A Sheet Named ${policy.sheetName}.`);
  }

  const sheetRange = worksheetRange(sheet);
  if (sheetRange.rows > policy.maxRows + 1 || sheetRange.columns > policy.maxColumns) {
    throw new Error(`The ${policy.sheetName} Sheet Exceeds The ${policy.maxRows} Row Or ${policy.maxColumns} Column Safety Limit.`);
  }
  if (sheetRange.rows * sheetRange.columns > policy.maxCells) {
    throw new Error(`The ${policy.sheetName} Sheet Exceeds The ${policy.maxCells.toLocaleString("en-US")} Cell Safety Limit.`);
  }

  const matrix = XLSX.utils.sheet_to_json<SpreadsheetPrimitive[]>(sheet, {
    header: 1,
    defval: "",
    raw: true,
    blankrows: false,
  });
  if (!matrix.length) throw new Error(`The ${policy.sheetName} Sheet Is Empty.`);

  const headers = matrix[0].map((value) => String(value ?? "").trim());
  validateHeaders(headers, policy);

  let characters = 0;
  let cells = 0;
  const rows: SecureSpreadsheetRow[] = [];
  for (let rowIndex = 1; rowIndex < matrix.length; rowIndex += 1) {
    if (rows.length >= policy.maxRows) {
      throw new Error(`The ${policy.sheetName} Sheet Exceeds The ${policy.maxRows} Row Safety Limit.`);
    }
    const sourceRow = matrix[rowIndex];
    if (!Array.isArray(sourceRow)) throw new Error(`Row ${rowIndex + 1} Is Not A Valid Spreadsheet Row.`);
    const row = Object.create(null) as SecureSpreadsheetRow;
    let hasValue = false;
    let rowCharacters = 0;
    let rowCells = 0;
    headers.forEach((header, columnIndex) => {
      if (!header) return;
      const value = sanitizeCellValue(sourceRow[columnIndex], policy, rowIndex + 1, header);
      if (value !== "" && value !== null) hasValue = true;
      if (typeof value === "string") rowCharacters += value.length;
      rowCells += 1;
      row[header] = value;
    });
    if (hasValue) {
      characters += rowCharacters;
      cells += rowCells;
      if (characters > policy.maxTotalCharacters) {
        throw new Error(`The ${policy.sheetName} Sheet Exceeds The Text Safety Limit.`);
      }
      if (cells > policy.maxCells) {
        throw new Error(`The ${policy.sheetName} Sheet Exceeds The ${policy.maxCells.toLocaleString("en-US")} Cell Safety Limit.`);
      }
      rows.push(row);
    }
  }

  return {
    profile,
    sheetName: policy.sheetName,
    rows,
    metrics: {
      fileBytes,
      workbookSheets: workbook.SheetNames.length,
      rows: rows.length,
      columns: headers.filter(Boolean).length,
      cells,
      characters,
    },
  };
}

export function validateSecureSpreadsheetResult(value: unknown, profile: SpreadsheetProfile): SecureSpreadsheetResult {
  if (!value || typeof value !== "object") throw new Error("The Excel Parser Returned An Invalid Result.");
  const source = value as Partial<SecureSpreadsheetResult>;
  const policy = SPREADSHEET_POLICIES[profile];
  if (source.profile !== profile || source.sheetName !== policy.sheetName || !Array.isArray(source.rows)) {
    throw new Error("The Excel Parser Returned The Wrong Workbook Profile.");
  }
  if (source.rows.length > policy.maxRows) throw new Error("The Excel Parser Returned Too Many Rows.");

  const rows = source.rows.map((sourceRow, index) => {
    if (!sourceRow || typeof sourceRow !== "object" || Array.isArray(sourceRow)) {
      throw new Error(`The Excel Parser Returned An Invalid Row At ${index + 2}.`);
    }
    const row = Object.create(null) as SecureSpreadsheetRow;
    for (const [key, value] of Object.entries(sourceRow)) {
      if (!policy.allowedHeaders.includes(key)) throw new Error("The Excel Parser Returned An Unapproved Column.");
      row[key] = sanitizeCellValue(value, policy, index + 2, key);
    }
    return row;
  });

  const metrics = source.metrics;
  if (!metrics || typeof metrics !== "object") throw new Error("The Excel Parser Did Not Return Safety Metrics.");
  const checkedMetrics = {
    fileBytes: safeMetric(metrics.fileBytes, "file bytes", policy.maxBytes),
    workbookSheets: safeMetric(metrics.workbookSheets, "sheet count", policy.maxSheets),
    rows: safeMetric(metrics.rows, "row count", policy.maxRows),
    columns: safeMetric(metrics.columns, "column count", policy.maxColumns),
    cells: safeMetric(metrics.cells, "cell count", policy.maxCells),
    characters: safeMetric(metrics.characters, "character count", policy.maxTotalCharacters),
  };
  if (checkedMetrics.rows !== rows.length) throw new Error("The Excel Parser Returned Inconsistent Row Metrics.");
  return { profile, sheetName: policy.sheetName, rows, metrics: checkedMetrics };
}

function safeMetric(value: unknown, label: string, maximum: number) {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > maximum) {
    throw new Error(`The Excel Parser Returned An Invalid ${label}.`);
  }
  return Number(value);
}

function validateHeaders(headers: string[], policy: SpreadsheetPolicy) {
  const populated = headers.filter(Boolean);
  if (!populated.length) throw new Error(`The ${policy.sheetName} Sheet Has No Column Headers.`);
  if (populated.length > policy.maxColumns) throw new Error(`The ${policy.sheetName} Sheet Has Too Many Columns.`);
  if (new Set(populated).size !== populated.length) throw new Error(`The ${policy.sheetName} Sheet Has Duplicate Column Headers.`);
  const unknown = populated.filter((header) => !policy.allowedHeaders.includes(header));
  if (unknown.length) throw new Error(`Remove Unapproved Column${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}.`);
  const missing = policy.requiredHeaders.filter((header) => !populated.includes(header));
  if (missing.length) throw new Error(`The ${policy.sheetName} Sheet Is Missing: ${missing.join(", ")}.`);
}

function sanitizeCellValue(
  value: unknown,
  policy: SpreadsheetPolicy,
  rowNumber: number,
  header: string,
): SpreadsheetPrimitive {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    if (value.length > policy.maxStringLength) {
      throw new Error(`Row ${rowNumber} ${header} Exceeds The ${policy.maxStringLength.toLocaleString("en-US")} Character Safety Limit.`);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Row ${rowNumber} ${header} Contains An Invalid Number.`);
    return value;
  }
  if (typeof value === "boolean") return value;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  throw new Error(`Row ${rowNumber} ${header} Contains An Unsupported Cell Value.`);
}

function worksheetRange(sheet: XLSX.WorkSheet) {
  const reference = String((sheet as XLSX.WorkSheet & { "!fullref"?: string })["!fullref"] || sheet["!ref"] || "").trim();
  if (!reference) return { rows: 0, columns: 0 };
  try {
    const range = XLSX.utils.decode_range(reference);
    return { rows: range.e.r - range.s.r + 1, columns: range.e.c - range.s.c + 1 };
  } catch {
    throw new Error("The Excel Workbook Contains An Invalid Sheet Range.");
  }
}

function rejectActiveWorkbookContent(
  workbook: XLSX.WorkBook,
  policy: SpreadsheetPolicy,
  profile: SpreadsheetProfile,
) {
  let workbookCells = 0;
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const range = worksheetRange(sheet);
    if (range.columns > 64 || range.rows > 5_001) {
      throw new Error(`Sheet ${sheetName} Exceeds The Workbook Safety Boundary.`);
    }
    workbookCells += range.rows * range.columns;
    if (workbookCells > Math.max(policy.maxCells * 4, 100_000)) {
      throw new Error("The Excel Workbook Exceeds The Total Cell Safety Limit.");
    }
    for (const [address, cellValue] of Object.entries(sheet)) {
      if (address.startsWith("!")) continue;
      const cell = cellValue as XLSX.CellObject & { F?: string; l?: unknown };
      if ((cell.f || cell.F) && !isApprovedScheduleHelperFormula(profile, policy, sheetName, sheet, address, cell)) {
        throw new Error(`Formulas Are Not Allowed In Imported Workbooks (${sheetName}!${address}).`);
      }
      if (cell.l) throw new Error(`Hyperlinks Are Not Allowed In Imported Workbooks (${sheetName}!${address}).`);
    }
  }
  const names = workbook.Workbook?.Names || [];
  if (names.length) throw new Error("Defined Names And External Workbook References Are Not Allowed In Imports.");
}

function isApprovedScheduleHelperFormula(
  profile: SpreadsheetProfile,
  policy: SpreadsheetPolicy,
  sheetName: string,
  sheet: XLSX.WorkSheet,
  address: string,
  cell: XLSX.CellObject & { F?: string },
) {
  if (profile !== "schedule" || sheetName !== policy.sheetName || !cell.f || cell.F) return false;
  let decoded: XLSX.CellAddress;
  try {
    decoded = XLSX.utils.decode_cell(address);
  } catch {
    return false;
  }
  if (decoded.r < 1) return false;
  const headerAddress = XLSX.utils.encode_cell({ r: 0, c: decoded.c });
  const header = String(sheet[headerAddress]?.v || "").trim();
  const row = decoded.r + 1;
  if (header === "Duration Days") {
    return cell.f === `IF(OR(D${row}="",E${row}=""),"",E${row}-D${row}+1)`;
  }
  if (header === "Validation") {
    return cell.f === `IF(B${row}="","",IF(C${row}="","MISSING SUBCONTRACTOR",IF(D${row}="","MISSING START",IF(E${row}="","MISSING FINISH",IF(E${row}<D${row},"FINISH BEFORE START","READY")))))`;
  }
  return false;
}
