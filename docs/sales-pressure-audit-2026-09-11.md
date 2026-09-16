# Sales and estimating pressure audit — September 11, 2026

Main MeffCon Command Center. The requested 100-project exercise uses reproducible randomized synthetic work, seed **20260911**. Business transactions call the actual application HTTP handlers, and the release gate reruns them through the compiled production Worker. Only employee identity, D1/R2 storage, and outbound network are isolated. Production customer records were not used for test mutations.

## Completed scenario coverage

| Path | Projects | Transactions exercised |
| --- | ---: | --- |
| Contact-led sales | 60 | Create and edit contacts, assign salesperson, create linked opportunities, qualify, release to estimating |
| Public bids | 25 | Create agency opportunities without a named contact, qualify, release, generate and issue proposals without a fabricated contact |
| Direct estimating | 15 | Create direct estimates, assign estimator, retain permanent estimating history |
| Estimate and proposal cycle | 100 | Enter and revise costs, review and approve estimates, generate proposals, verify source/contact prefill, save changes |
| Editable Word round trip | 100 | Export real DOCX, edit structured text and payment fields, reupload, verify automatic persistence and retained source files |
| Word pricing revisions | 10 | Edit scope amounts, recalculate proposal and handoff amounts, preserve approved estimate, verify eventual issued/funnel price |
| Proposal issuance and funnel | 100 | Block premature issuance, submit review, owner approval, issue stored PDF, move to Proposal Submitted, Negotiation, or Lost |
| Dashboard reconciliation | 100 | Read back every final stage and value, verify change revisions, then reconcile aggregate counts and values against independently calculated totals |

The jobs vary across eight project categories, four contract paths, 1–18 month schedules, 2–8 cost lines, contract values, probability, award month, and negative credits. Sales and Estimating use separate role-limited employees; ownership approval uses the owner account. No test emails or other external requests are sent.

The active assignment roster is fetched through the real API. Tests verify that the salesperson and estimator appear only in their qualified menus, disabled staff are excluded, and unrelated employees cannot read the roster.

## Repaired defects

- Added the missing editable Word export/import workflow. A Word file now carries editable proposal fields and its proposal/revision identity. Upload updates the saved draft and handoff, archives the uploaded original, and records the field changes. Issued PDFs remain immutable and further changes require a draft revision and approval.
- Repaired multiline content controls after an actual LibreOffice save exposed paragraphs falling outside their fields. The regression fixture is a real Office-editor-resaved DOCX, not just a hand-built XML string.
- Aligned the framework multipart limit with the documented 8 MB Word limit, including the form envelope. Oversized uploads still fail without partially saving a proposal.
- Removed the named-contact requirement for explicitly marked Public Bid opportunities and proposals. Private opportunities retain their required contact checks.
- Replaced fixed employee lists in Sales contacts, opportunities, estimating assignments, direct-estimate setup, and sales goals with the active, role-qualified company roster. Existing saved assignees remain visible.
- Repaired access to opportunity design files. `DESIGN-` and `ESTIMATE-` collections now use preconstruction permissions instead of treating a design folder as a nonexistent active project. Unprivileged access remains denied.
- Normalized negative-zero monetary results, which caused otherwise balanced estimates to fail strict reconciliation.
- Preserved the permanent estimating release when editing an opportunity that had already been handed off.
- Added wrapped Word controls without displacing Proposal Studio's scrollable editor/footer, corrected preview logo rendering, labeled unset sales goals accurately, and clarified that company role-card counts mean **Open Actions**.

## Failure and concurrency checks

The suite also covers invalid ZIPs, oversize files, the wrong proposal, missing/duplicate controls, tracked changes, unsupported edits outside fields, embedded programs, invalid dates/numbers/deposits, unauthorized export/import/file access, unchanged-file no-ops, storage failures, mid-transaction database failures, stale Word copies, simultaneous imports, split Word text runs, and review/approved/issued locks.

Two concurrent imports are forced to validate the same base draft. Exactly one succeeds. The losing request cannot overwrite it or leave a partial proposal, parent opportunity, file row, or audit. Failed imports preserve the prior state, and issued PDF hashes remain unchanged.

## Browser and Office evidence

- With the 100-project dataset loaded, Sales Dashboard showed **57 active opportunities**, **$94,817,034.29** open pipeline, and **$72,383,464.05** weighted pipeline. There were 32 submitted proposals, 25 negotiations, and 43 lost jobs. A separate preexisting synthetic won job explains the preview's 101-estimate history count.
- Created a separate public-agency opportunity in the browser without a contact. Dragged it from New Lead to Qualified Opportunity and verified the saved stage, 25% probability, and the corresponding weighted-pipeline change. The board stayed **1013 × 631.39 px**; every column stayed **313.48 × 608.39 px**, including the newly emptied column. Public estimating handoff and issuance are verified in all 25 compiled workflow cases; the browser's native confirmation could not be completed after browser-control recovery failed.
- Opened a populated estimate and Proposal Studio, started a new draft revision, and successfully uploaded a DOCX that had been edited and actually opened/resaved in LibreOffice. The browser reported **4 Word Changes Saved**. Verified the changed summary, Net 45 payment terms, November 15 expiration, and **$448,223.27** proposal amount. The original upload and change history were retained.
- Inspected the DOCX's four rendered pages for clipping and missing content. Inspected the desktop Studio's editable form, logo, Word bar, and footer. The exported DOCX is a working copy for field edits; the branded client PDF and attached images remain controlled in Proposal Studio.
- The earlier populated UI audit remains applicable to the existing funnel and Critical badge fixes, including 390 px and 320 px checks. This pass opened the 390 px view with the larger dataset, but further narrow-screen interactions were interrupted by browser-control failure. It does not claim a new complete mobile Studio inspection.

## Coverage boundaries

This is 100 stateful project scenarios plus targeted concurrency/failure cases, not a 100-concurrent-user capacity benchmark. All 100 include real DOCX export/import at the application boundary; a representative actual Office-editor save and browser reupload provide additional evidence. **Microsoft Word desktop/web itself was unavailable**. The browser's automated download capture failed with a CDP Fetch-domain error, although the export endpoint returned valid DOCX and the browser upload succeeded. Native browser confirmation/recovery subsequently blocked further browser actions; that limitation is not presented as a successful UI test.

Word import supports the exported fields, including scope amounts. Arbitrary layout edits, changed branding/images, and unrelated Word documents are not silently interpreted as proposal data. Unsupported or stale input gives an actionable error instead of discarding unrecognized changes. No real customer delivery, Microsoft integration, or production financial execution was attempted.

The full release gate also reruns the existing platform/lifecycle controls for contracts, budgets, purchasing, accounting, payroll, closeout, authorization, migrations, recovery and scheduler behavior. Navigation checks and successful workflow transactions are distinguished from a claim that every possible system state is defect-free.

## Final release evidence

- **100 / 100 projects passed**, 0 failed; **2,222 application HTTP requests**; 0 external requests.
- **25 targeted checks**, including roster authorization, Word import failures/concurrency, and dashboard aggregation.
- **695 / 695 release tests passed**, 0 skipped or cancelled; strict TypeScript, lint gate, compiled Worker build, artifact validation, and database migration checks passed. Lint retains preexisting non-blocking warnings.
- Required critical-module coverage: 86.76% lines, 71.22% branches, 88.57% functions. These percentages cover the four configured critical modules, not the whole application.
- **7 / 7 critical-control mutations caught**.
- Machine-readable per-project evidence: [sales-pressure-results-2026-09-11.json](sales-pressure-results-2026-09-11.json).

The temporary responsive QA page is excluded from the release. Test records and role fixtures remain isolated; the published release contains the repaired application and its normal database migration.
