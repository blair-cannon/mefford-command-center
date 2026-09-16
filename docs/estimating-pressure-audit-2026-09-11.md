# MeffCon estimating audit — September 11, 2026

A dedicated, reproducible run exercised **100 estimating-only projects** across ten trades. This is separate from the earlier 100-project sales audit. The detailed result for every project is in `estimating-pressure-results-2026-09-11.json`.

## Test method

The run calls the production HTTP handlers and, in the release gate, the compiled application Worker. It uses an isolated SQLite database behind the D1 interface, isolated object storage, authenticated estimator/company-owner test identities, and a controlled email receiver. Test projects, contacts, vendor identities, documents, and messages are synthetic. No proposal was sent to a real project owner.

- Seed: **2026091109**.
- **100 projects**, with independently varied duration, round-trip mileage, building/cleanup area, management rates, profit settings, bond selection, fee overrides, quantities, costs, and negative credits.
- Ten trades: electrical, HVAC, plumbing, concrete, roofing, drywall, fire suppression, carpet, paving, and painting.
- **311 original quote PDFs**: three competitive quotes per project, ten additional packages sharing an existing cost code, and one superseding quote revision. The test creates actual PDFs, reads their text, confirms extracted prices and scope, uploads their bytes, records reviews, and downloads the stored originals to verify byte-for-byte retention.
- Every package includes a low-priced incomplete quote and higher complete quotes. The incomplete low bidder is flagged and cannot be selected without documented scope resolution. The recommendation identifies the lowest reviewed comparable bidder.
- All 100 estimates are submitted for company-owner review and approved, then used to build proposals. Scope, exclusions, price, and duration are checked at the handoff.
- All 100 proposals are exported as actual `.docx` files, their editable content controls are changed, and the files are uploaded through the Word-import endpoint. This is a programmatic Word-file round trip; Microsoft Word itself was not automated.
- All 100 proposals pass review/approval and create immutable issued PDFs. Delivery without a configured provider is explicitly deferred. A synthetic provider then receives the exact issued PDF bytes; repeating the send request does not send a second copy.
- An independent arithmetic oracle checks cap-sheet totals, management labor and fee splits, travel, monthly costs, quantity formulas, cleanup, insurance, architecture, profit, bond tiers, technology, budget reconciliation, and cost per square foot. The same calculations are checked after save/reload and after changing duration and quantities.

## Repairs

1. **Cell overrides no longer freeze entire rows.** Editing equipment leaves duration-driven labor and other formulas connected. Legacy full-row overrides retain their saved prices until explicitly restored.
2. **Stable setup controls.** Management billable/cost rates and cleanup/architectural overrides are available with their formula explanations. Zero overrides remain distinct from a blank value that restores the automatic formula.
3. **Safer numeric editing.** Existing formulas select cleanly for replacement, edits commit when leaving the field or pressing Enter, Escape cancels without creating a hidden override, and invalid formulas block save/review. Unsaved changes have a visible indicator and a close confirmation.
4. **Fee detail adjustments now flow into totals.** New overhead/profit detail adjustments contribute once to selling price. Previously ignored legacy detail values are preserved under the old calculation behavior until the detail is explicitly edited, preventing an automatic change to approved prices.
5. **Quote extraction and comparison.** PDF line breaks and long scopes are retained. Prices below $1,000.00 are recognized; unrelated reference/date numbers are ignored. Exclusions, alternates, allowances, qualifications, clarifications, and schedule are offered for confirmation. Negated scope statements are flagged.
6. **Individual review replaces one-click completion.** Each of the five leveling checks is confirmed separately. The estimator can document scope resolutions and a comparable adjusted amount. Recommendations show the reason and unresolved issues; text matching does not certify drawings or unmentioned scope.
7. **Received quotes can be uploaded directly from estimating.** The Quotes folder opens the current estimate's bid packages and quote-review workspace. Cost-code choices come from the actual estimate catalog.
8. **Quote selection preserves related information.** Packages sharing a cost code retain separate sources and their amounts accumulate. Selecting the same quote twice does not add its price twice. Package, estimate, and audit changes commit together, with rollback and concurrent-change protection.
9. **Stale quotes and proposals are blocked.** New quote revisions, changed comparable prices, missing addenda, and incomplete reviews invalidate the selection. Issuing a proposal checks the current estimate and source signatures. A changed source requires refresh and a fresh review.
10. **Proposal refresh retains useful information.** Manually entered owner contact information survives a source refresh. Source-driven start dates and duration follow the estimating inputs; selected-quote scope and exclusions flow into the proposal.
11. **Owner delivery has evidence.** Authorized users can submit the issued PDF to the owner email shown on the packet. The system verifies the stored PDF hash, records provider acceptance/deferment/errors, and prevents duplicate accepted sends. Delivery receipts and source snapshots cannot be forged through editable proposal fields.

## Browser verification and limits

The managed test browser successfully created an additional synthetic estimate, opened the cap sheet, entered `4x3` as project duration, verified $62,400.00 of project-management labor for twelve months, entered a $25.00 equipment override, and verified labor recalculated to $31,200.00 at six months while equipment remained $25.00. A desktop screenshot was inspected for layout and spacing.

An access restriction subsequently blocked further browser actions. The final formula-entry interaction repair, new embedded quote-review screens, and final mobile layouts have not received a completed browser inspection. The automated workflow and arithmetic results must not be read as proof that every browser/device combination is visually flawless. Scanned-image OCR and live delivery through the configured production email provider also remain unverified in this audit.

## Release verification

The final compiled-Worker run completed **100/100 projects with zero failures**, making **3,376 production-handler requests** and recording **100 synthetic delivery receipts**. The complete release suite passed **703/703 tests**, including the regression, migration, role, storage-fault, and invariant checks. All **7/7 critical-control mutations** were detected. The required coverage gate passed; TypeScript reported zero errors and ESLint reported zero errors with sixteen existing warnings.

The JSON evidence identifies the runtime, pass/fail count, requests, and every project's result. These results cover the tested workflows and cases; they do not remove the browser and live-provider limitations above.
