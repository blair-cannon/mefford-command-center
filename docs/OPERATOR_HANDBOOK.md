# Operator Handbook

## Daily Start

1. Open IT & Integrations and review runtime failures, dead letters, missed scheduler slots, and connection health.
2. Confirm the latest production version and healthy D1/R2 bindings.
3. Review critical work items without clearing unresolved evidence.
4. Confirm morning digests and mandatory reconciliation jobs completed.

## Incident Levels

| Level | Example | Response | Owner notice |
| --- | --- | --- | --- |
| SEV-1 | Unauthorized access, data loss, corrupted financial records, outage | Contain immediately; stop releases and external delivery | Immediate |
| SEV-2 | Critical workflow unavailable or repeated dead letters | Isolate workflow; preserve evidence; begin recovery | Within 30 minutes |
| SEV-3 | Degraded optional integration or recoverable single-record failure | Record, assign, and resolve normally | Daily unless worsening |

Record start time, reporter, affected routes/records, last known-good version, errors, containment, decision owner, recovery evidence, validation, and closure. Never paste credentials, tokens, private customer data, or complete financial exports into an incident.

## Safe Operating Rules

- Never edit production data to bypass a workflow gate.
- Never replay an external action without checking its durable receipt.
- Never call a connection healthy based only on configured credentials.
- IT cannot approve legal, financial, HR, safety, or contract decisions.
- Preserve original files, audits, failure evidence, and superseded versions.
- Use maintenance mode when recovery could expose inconsistent reads.

Blain Faulkner (`it@meffcon.com`) owns technical triage. Jordan Mefford (`jmefford@meffcon.com`) owns business authority, production release, destructive recovery approval, and acceptance of residual risk.

## Accounting corrections and approvals

- Save an incomplete or unbalanced journal as Draft. Balance it to the cent before submission; use a different authorized reviewer for approval. Posted entries are corrected with a linked reversal and a new entry, not by changing their original lines.
- For an already approved AP invoice, Accounting may prepare payment details without repeating the original approval. Changes to the approved vendor, value, date, or allocations require the appropriate correction workflow.
- Review the selected WIP month. Its actual costs stop at that period's end. A reviewed forecast must be approved unchanged; a locked forecast requires an Owner reopen with a reason before revision and fresh review.
- Finish independent review of all ten month-close controls before hard close. Owner certification requires the Owner. Reopening requires an Owner reason and invalidates prior WIP and checklist approvals.
- Keep each bank transaction matched to one book item. Approved reconciliations are locked. Resolve competing edits before approval.
- Payroll allocations must reconcile exactly to the imported totals. Cutover requires posted opening balances and an Owner lock.
- At project closeout, review the preserved signed bonus agreements and the resulting payment-review obligation. The flag calls for authorized review; it does not itself send money or certify an amount payable.
