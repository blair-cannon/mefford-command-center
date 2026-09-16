# Project lifecycle audit — September 10, 2026

## Scope and safety

Main Mefford Command Center only. The Pilot was not changed. Tests use the actual route handlers and, in the release gate, the compiled Worker. The identity provider, D1 database, R2 storage, and external network are replaced with isolated test bindings. Business records are created through the HTTP workflows. No production records, money movement, email delivery, or real signatures are created.

Four contract variants run from CRM contact and Sales opportunity through approved estimate, issued proposal PDF, pre-award contract, project award, owner contract execution, schedule/pre-work quality clearance, purchase order, approved AP invoice, payment clearing, owner billing, partial/final collection, WIP review/lock, saved financial reports, and total closeout. A second two-project run deliberately reuses the same project-local invoice number and deposit references.

## Reconciliation results

Synthetic amounts, not actual company results. All values are USD.

| Contract variant | Contract / collected | Actual / paid cost | Projected final profit | Ending AP | Ending AR |
| --- | ---: | ---: | ---: | ---: | ---: |
| Plan & Spec Lump Sum | $122,122.95 | $80,000.12 | $42,122.83 | $0.00 | $0.00 |
| Design-Build GMP, both instruments | $166,607.63 | $120,000.34 | $46,607.29 | $0.00 | $0.00 |
| Small Projects / T&M — Lump Sum | $47,055.95 | $12,500.56 | $34,555.39 | $0.00 | $0.00 |
| Small Projects / T&M — Not to Exceed | $53,172.80 | $18,000.78 | $35,172.02 | $0.00 | $0.00 |

Each completed job has zero backlog, earned revenue equal to its contract, project status Completed, and a ledger whose debits equal credits exactly in cents. These are illustrative one-period, zero-retainage jobs with a zero remaining-cost forecast. The Small Projects NTE case tests the selected contract instrument and accounting lifecycle; it does not certify every time-ticket/rate/cap billing permutation.

## Findings and repairs

| Finding | Repair and regression |
| --- | --- |
| Draft AP was counted as an accrued payable; ready-to-send owner bills appeared in AR before issue. | Accounting, financial reports, and aging now share explicit posted-state rules. Draft and pre-issue balances are asserted zero. |
| Replaying a partial owner receipt applied cash twice to the invoice while the journal posted only once. | Deposit retries are idempotent, conflicting amounts are rejected, receipt identities include the project, and calculations use integer cents. |
| The same local billing number on two projects collided in company AR and journal identities. | Owner-invoice posting keys and AR mirror IDs include the project. The two-job run verifies independent invoices, collections, balances, and entries. |
| Owner invoice/receipt writes could leave the source and ledger out of sync after a failure. | The source, AR mirror, receipt records, journal, and associated audit writes share a database transaction. Stale-source protection prevents lost updates. Failure injection, stale snapshots, and a competing identical deposit are tested. |
| AP approval saved before its accrual and job cost completed. | Invoice approval, normalized journal, project cost, and accrual metadata now commit together. An injected journal failure leaves the invoice awaiting approval and permits a clean retry. |
| Posted AP amounts and payment status could be changed through generic record editing. | Posted financial fields and status are locked. Approved-unpaid payment-method preparation remains available and preserves posting metadata. |
| AP clearing could post a payment but leave the invoice unpaid. | Each invoice payment and source update are atomic. If only the final batch acknowledgment fails, retry safely resumes already-cleared invoices with the same batch/confirmation. Wire clearing uses the same transactional protection. |
| Closeout accepted missing file IDs and approvals before evidence submission. | Missing file references and unsubmitted approvals are blocked. Resubmitted evidence resets prior approvals/signoff while preserving the timeline. |
| Total closeout ignored outstanding AP/AR and left the project Active. | Actual payable and receivable balances now block total closeout, even when checklist documents are approved. Authorized closeout updates the project to Completed with an audit record. |

Existing inconsistent legacy postings are not silently reposted or rewritten. Where detected during issue/clearing, they stop with a reconciliation message. This audit does not retrospectively correct production accounting records.

## Repeatable evidence

- `tests/project-lifecycle.integration.test.mjs`: four connected journeys plus the two-project isolation case; premature award, wrong-role approvals, duplicate invoices, failed writes, invoice edit protection, overpayment, repeated deposits, financial closeout blockers, and missing evidence are exercised.
- `tests/accounting-ledger-atomicity.test.mjs`: rollback, safe retry, stale-source rejection, and a simulated competing identical posting against real SQLite transactions.
- The normal build/release gate runs these with the existing behavioral tests, type checking, lint, coverage thresholds, and critical-control mutation tests. The lifecycle release tests use the built Worker, not just source imports.
- Release result: 618 tests passed, zero failures; all seven critical-control mutations were detected. TypeScript and build validation passed. Lint retained 16 pre-existing warnings and zero errors.

## Boundaries and remaining validation

This is not a certification of every screen or financial/legal workflow. Browser clicks, live Microsoft/SharePoint delivery, live bank execution, Paylocity, real vendor portal sessions, and historical production data were not exercised. The connected jobs do not cover change-order propagation, payroll allocation, subcontract signing, multiple accounting periods, retained amounts and final retainage release, or every T&M rate/time-ticket combination. Wire transaction handling was repaired consistently with batch clearing, but the new connected scenarios use check/payment batches rather than live wires. Detailed statutory statements are not represented as verified by these operational reports.

The next validation scope should cover those variants and a separately authorized, non-paying operational demonstration in a dedicated training environment. Do not seed synthetic jobs or payment evidence into the live company's records merely to demonstrate the tests.
