# F-07 Secure Spreadsheet Imports

## Control objective

Command Center must continue to accept the controlled Excel workflows without allowing an uploaded workbook to execute active content, block the application, create prototype-shaped objects, or bypass field validation.

## Supported user workflows

- Sales contacts: download the Mefford template, complete the `Contacts Import` sheet, and upload `.xlsx` or legacy `.xls`.
- Project schedules: download the project-specific schedule, edit the `Schedule Import` sheet, and upload `.xlsx` or legacy `.xls`.
- Schedule and report exports continue to generate Excel-compatible files.
- Other Word, PDF, image, Excel, and company-required file uploads remain available in their existing storage workflows; F-07 changes only workbook parsing used to import live records.

## Enforced controls

1. The vulnerable npm `xlsx 0.18.5` package is prohibited. The lockfile pins the npm-registry build of SheetJS CE 0.20.3, whose executable and library files match the vetted upstream release, along with its SHA-512 integrity value.
2. User-controlled workbooks never parse on the main interface thread. A dedicated module Web Worker receives a transferred buffer and is always terminated after success, rejection, worker error, message error, or timeout.
3. A five-second deadline kills a parser that does not finish. There is no unsafe main-thread fallback.
4. Files are limited to `.xlsx` or `.xls`, must be nonempty, and may not exceed 5 MB.
5. Imports require the exact controlled sheet name and reject excessive sheet, row, column, cell, string, and total-text sizes.
6. Only approved headers are accepted. Required headers must be present, duplicates are rejected, and prototype-shaped or unknown names cannot cross the parser boundary.
7. Formulas, hyperlinks, defined names, external workbook references, unsupported values, corrupted files, and encrypted files are rejected. The only formula exception is the exact non-imported Duration/Validation helper formulas in the retained Mefford schedule template.
8. Parsed values are limited to bounded strings, finite numbers, booleans, and null. Output rows are rebuilt without object prototypes and revalidated after crossing the worker boundary.
9. Existing application validation remains authoritative after parsing: contacts still require name/company review and duplicate controls; schedules still require scope, approved subcontractor, valid dates, and a quality category.
10. Every production build runs a supply-chain and isolation gate before TypeScript, lint, compilation, behavioral tests, coverage, and mutation testing.

## Current limits

| Import | Sheets | Rows | Columns | Cells | Text |
| --- | ---: | ---: | ---: | ---: | ---: |
| Contacts | 4 | 2,500 | 24 | 60,000 | 1,000,000 characters |
| Schedule | 6 | 1,000 | 20 | 20,000 | 750,000 characters |

Each individual text cell is limited to 5,000 characters. The limits are intentionally higher than the controlled templates but bounded below levels that should create unreasonable browser or business-record load.

## Release evidence

The F-07 suite executes valid `.xlsx`, valid `.xls`, retained Mefford templates, corrupted input, formulas, hyperlinks, prototype-shaped headers, excessive ranges, oversized cells, worker timeout, worker teardown, lockfile provenance, and result-boundary validation. The full F-06 release gate includes this suite automatically.
