# Standalone platform audit — September 10, 2026

Main MeffCon Command Center. This extends the [connected lifecycle audit](project-lifecycle-audit-2026-09-10.md), covering additional authorization, change-order, payroll, reporting-date, retainage, document, and native automation paths. The Pilot is outside this work.

## Findings and repairs

| Area | Demonstrated problem | Repaired behavior |
| --- | --- | --- |
| Project access | A company-wide PM designation granted controls on unassigned jobs, while some routes denied an explicitly assigned secondary PM. File listing/upload/download, search, and control routes disagreed. | Primary assignments and explicit project-team assignments now use shared project authorization. Team displays use the same resolved roles. Search selection cannot grant access. Accounting, personnel, incident, and restricted file scopes retain their additional role checks. |
| Large uploads | The multipart path lacked the ordinary upload's project checks and did not bind the upload to its initiating user or original metadata. | Create, part upload, completion, and cancellation enforce scope and durable upload ownership. Completion validates unchanged metadata and actual stored size. A second employee cannot finish another employee's upload. |
| Ordinary upload recovery | Failed database registration could leave unregistered file bytes behind. | The newly stored object is removed when registration fails. A fault test checks storage count remains unchanged. |
| Administrative corrections | A correction could change AP status to Paid without creating the required accounting posting. The correction path could also trust supplied source values. | Status changes must use the actual workflow. Corrections load the stored record, restrict permitted metadata, reject stale values, and save the correction with its audit in one transaction. Posted/executed dates stay protected. |
| Generic records | A stored record could be relabeled as another type; protected accounting outputs could be written outside their coordination endpoints. | Record type is immutable. Job costs, receipts, journals, payroll returns, and other controlled accounting outputs require their dedicated workflow. |
| Chart of accounts | The displayed account count was fixed at the 283 seeded accounts. Activation checks were enforced in the interface more strongly than on the server. | The display counts the actual combined chart. The server validates account status/category/normal balance and requires the company owner to activate or change approved accounts. No account numbers were converted. |
| Executed change orders | The amendment could persist while contract value, budget, and milestone changes depended on separate browser requests. A failed handoff could leave those records inconsistent. | The server validates released pricing, approved totals, selected cost codes, and the executed PDF; then commits the CO, amendment, contract value, budget adjustments, milestones, and audit together. The interface applies the server's returned values. Retries do not add the same change twice. |
| Historical AP/AR | Later payment and collection status affected an earlier report. Company overhead AP was excluded from the headline open-payables total. | AP recognition and clearing dates, owner billing issue dates, and receipt dates determine the reported balances. Company AP totals reconcile with aging, including overhead. |
| Retainage | A maximum historical retained amount could survive final release; total closeout did not independently block unreleased retainage. | The latest issued billing determines current retained receivables. Draft releases have no financial effect. Unreleased retainage blocks total closeout; issued release creates collectible AR until payment clears. |
| Payroll posting | A payroll journal could persist when source/allocated project-cost writes failed, including the high-dollar approval path. | Source return, allocated job costs, journal, and audit commit together. The approval path checks the unchanged source. Negative hours and undistributed hours are rejected. |
| Employee time | A timesheet could name a nonexistent destination. Its record and audit were independent writes. | Destinations must be active projects or company overhead. Timesheet and audit save together. |
| Bank reconciliation | The full independent review path lacked connected runtime coverage; cash-account creation did not return the ID needed by downstream clients. | Cash-account creation returns its ID. Tests verify balanced preparation, rejection of self-approval, owner approval, and locking after approval. |
| Closeout downloads | Missing stored objects could be silently omitted. Repeated filenames under the same category could collide inside the ZIP. | Export preflights approved file references and stored objects, returns a clear error for missing evidence, and uses requirement/file identifiers to preserve distinct originals. |
| My Work at production volume | Production logs showed repeated GET `/api/my-work` failures while reading audit histories for more than 200 tasks. The query supplied one database parameter per task. | History selection now uses a recipient-scoped subquery. Reconciliation batches resolved-item updates below the database parameter limit. A 251-task isolated fixture verifies task/history privacy and large reconciliation. |
| Failure reporting | The failure-evidence path could fail before its table existed; leadership lookup used a column name inconsistent with the company-member schema. | Failure reporting initializes its own evidence schema and selects active leadership using the actual column. Tests inject three read failures, recover the evidence table, and verify two leadership alerts without external delivery. |

The production My Work evidence was observed at 2026-09-10 14:55:40–14:55:56 UTC; one affected request ID was `a47801c5d0e032fe2513c4877e1761f1`. The query exceeded Cloudflare D1's documented [100 bound parameters per statement](https://developers.cloudflare.com/d1/platform/limits/). Logs establish the live failure; local regression tests verify the repair. No live business records were changed for testing.

## Evidence and coverage

`tests/platform-audit.integration.test.mjs` exercises actual HTTP handlers, using isolated SQLite transactions, R2 storage, identities, and checked-in static document assets. The normal release gate runs the same scenarios against the compiled production Worker. External network requests are blocked and asserted absent. Direct database seeding is limited to volume fixtures and controlled fault setup; the project lifecycle and accounting records are created through their workflows.

The new suite includes:

- Project access denials across eleven control endpoints; file and document export boundaries; assignment, revocation, and secondary-PM access.
- Ordinary upload cleanup and multipart creator/metadata checks.
- Native workspace reads, a Word export containing an editable `word/document.xml`, and durable scheduler heartbeat deduplication for one time window.
- An additive $1,100.00 change order and an equal deduction; repeated execution; an injected project-update failure proving rollback of the CO, amendment, and budget.
- A $1,234.56 overhead payable and $9,000.00 owner invoice reported before and after later clearing/collection, with $1,000.00 retainage released, issued, and collected separately.
- A $1,200.00 payroll return split $720.00/$480.00 across two jobs, failed-write rollback, retry protection, and a $250,000.00 return held for independent owner approval.
- Employee time validation and independently approved/locked bank reconciliation.
- Large My Work retrieval/reconciliation and persistent failure reporting.

The earlier four contract journeys and the two-project duplicate-number case remain part of the release gate. Their closeout steps now also delete and restore isolated storage evidence to test missing-object detection and distinct originals in the final ZIP.

The compiled lifecycle and standalone audit scenarios passed 73 checks across 1,222 HTTP requests, with no attempted external requests. The required release gate covers strict TypeScript, lint, production compilation, the complete 685-test suite, selected accounting/health/scheduler coverage thresholds, and seven critical-control mutation checks. Passing static assertions is not presented as evidence that every user interaction ran successfully.

## Practical limits

- No production data reconciliation or retrospective ledger rewrite was performed. Existing inconsistent postings require explicit reconciliation; the repair does not silently repost them.
- AP/AR/payment reporting dates were exercised across issue and later payment dates. Current project descriptions, contract/budget metadata, and unlocked forecasts are not a complete historical snapshot. Saved financial reports remain the immutable presentation record.
- Microsoft, Outlook, Teams, SharePoint, real email/push delivery, bank execution, and payroll-provider submission remain outside this standalone audit. Disconnected Microsoft features returned an explicit connection-required response.
- No browser or mobile interaction testing was run. Word structure was verified; this pass does not certify visual pagination of every populated contract.
- One native scheduler group and duplicate window were exercised in this added suite. Every automation rule, reminder timing, user timezone, T&M rate/time-ticket combination, and external portal workflow has not been run end to end.
- The isolated tests demonstrate specific repaired behaviors. They are not a claim that the entire platform is defect-free or that operational reports constitute complete statutory financial statements.

## Four-digit chart proposal — subsequently approved

The proposal below was approved after this audit's repairs were published. Its implementation and preservation rules are documented in [Four-digit account conversion](four-digit-account-conversion-2026-09-10.md).

At the start of this audit, the seed contained 283 accounts in 16 categories. There was no hard three-digit input limit or 283-account storage cap; the fixed count in the interface was misleading. The posting engine also used control accounts 495 and 498 outside the seeded list.

Recommendation: use four-digit account numbers from 1000 through 9999 and initially multiply existing numbers by ten. For example, AR 111 becomes 1110, AP 402 becomes 4020, and subcontract expense 703 becomes 7030. This leaves nine insertion positions between consecutive legacy numbers and preserves familiar groupings.

| Category | Proposed range |
| --- | --- |
| Cash and bank accounts | 1000–1109 |
| Current assets | 1110–1599 |
| Work in progress | 1600–1799 |
| Other assets | 1800–1999 |
| Fixed assets | 2000–2999 |
| Accumulated depreciation/amortization | 3000–3999 |
| Current liabilities | 4000–4499 |
| Long-term liabilities | 4500–4949 |
| System control and clearing accounts | 4950–4999 |
| Equity | 5000–5699 |
| Owner draws/distributions | 5700–5999 |
| Operating income | 6000–6499 |
| Other income | 6500–6999 |
| Direct project expenses | 7000–7999 |
| Overhead expenses | 8000–9549 |
| Administrative expenses | 9550–9759 |
| After-tax accounts | 9760–9999 |

The uneven boundaries preserve current categories, including overhead account 950 becoming 9500. These are proposed MeffCon assignments, not a prescribed accounting standard. Consistent account structures and protected control accounts are established concepts described in Sage's [account structures](https://help.sage300.com/en-us/2026/classic/Content/Financials/General_Ledger/Setup/AccountStructures/AboutAccountStructures.htm) and [chart of accounts](https://help.sage300.com/en-us/2025/classic/Content/Financials/General_Ledger/Reports/SCREENS/ChartofAccounts.htm) documentation.

Before conversion, agree on this category map and create a permanent old/new crosswalk. Update posting constants, account selectors, import/export validation, and reporting together. Preserve posted historical entry identities and display/report them through the crosswalk. Keep project numbers and construction cost codes separate from general-ledger account numbers. The proposed system has 9,000 possible numbers, with control ranges reserved for their intended use.
