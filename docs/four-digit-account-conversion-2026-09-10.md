# Four-digit account conversion — September 10, 2026

The user approved the proposed MeffCon numbering structure after the standalone audit repairs were published. This change applies that structure to Main. The Pilot is unchanged.

## Result

The maintained chart uses account numbers 1000–9999. The original 283 opening accounts each receive a trailing zero; the two existing posting controls, owner billing and payroll clearing, are now explicit chart entries 4950 and 4980. There are 285 baseline entries across 17 categories. Additional accounts are allowed within the assigned ranges, subject to owner activation. Internal record keys remain stable so existing approvals and audit references still resolve.

| Category | Allowed range |
| --- | --- |
| Cash Accounts | 1000–1109 |
| Current Assets | 1110–1599 |
| WIP Assets | 1600–1799 |
| Other Assets | 1800–1999 |
| Fixed Assets | 2000–2999 |
| Accumulated Depreciation | 3000–3999 |
| Current Liabilities | 4000–4499 |
| Long Term Liabilities | 4500–4949 |
| System Control / Clearing | 4950–4999 |
| Equity | 5000–5699 |
| Owners Drawing | 5700–5999 |
| Operating Income | 6000–6499 |
| Other Income | 6500–6999 |
| Direct Expense | 7000–7999 |
| Overhead Expense | 8000–9549 |
| Administrative Expense | 9550–9759 |
| After Tax Income Expense | 9760–9999 |

The system range is reserved for controlled posting accounts. The three originally inactive accounts remain inactive as 1030, 4350, and 6550. Existing account approval statuses are preserved. Opening-chart accounts retain their prior selection availability; new proposed accounts remain unavailable until owner activation.

## Historical compatibility

The database migration creates a durable 900-row cross-reference from every possible three-digit legacy number to its four-digit equivalent. Existing chart records gain current/legacy number metadata without changing their record IDs, approval status, or existing metadata. Posted journal rows, transaction identifiers, dates, amounts, and audit history are not rewritten by the migration.

Current journal views and trial balances normalize historical numbers through the fixed cross-reference. Thus an old posting to 111 and a new posting to 1110 appear under one AR balance. Journal detail retains the originally posted number. Saved historical report snapshots remain unchanged.

New automatic postings use four digits. Journal spreadsheet paste accepts old three-digit codes through the same conversion, while preserving existing four-digit codes. New account creation requires exactly four digits in the selected category's range; malformed numbers, duplicate legacy/current aliases, mismatched ranges, and unauthorized activation are rejected. Conflicting pre-existing aliases are surfaced for reconciliation rather than silently merged.

## Connected account use

General Ledger, overhead invoice coding, and asset accounting now read the maintained account catalog, including owner-activated custom accounts. The prior static pickers could omit new accounts even though the chart had saved them. Overhead accruals now use the selected expense account rather than routing every overhead invoice to miscellaneous expense. Project construction cost codes and project numbers remain independent of GL account numbering.

Asset defaults and draft account references use four digits. Chart search/display, account-range help, journal details, and trial-balance CSV exports present current numbers. Posted financial amounts are unchanged.

## Verification

`tests/four-digit-accounts.integration.test.mjs` covers the complete range map, all baseline accounts, inactive controls, preserved project cost codes, conflicting aliases, and the actual SQLite migration. It proves that the migration leaves posted journal/event rows byte-for-byte unchanged, preserves account approval evidence, and combines $123.45 of legacy AR with $76.55 of current AR into a single $200.00 balance.

The HTTP scenario proposes a custom cash account, rejects its use before activation, activates it, posts an independently approved opening journal, and accrues a $20.01 overhead invoice to a newly activated overhead account. Existing standalone and sale-to-closeout scenarios remain required release checks. Testing uses isolated records and blocks external delivery; it does not create demonstration transactions in the live company.

The release gate requires type checking, lint, compilation, the full test suite, selected coverage thresholds, and mutation checks. Browser/mobile interaction and live external accounting integrations are outside this change.
