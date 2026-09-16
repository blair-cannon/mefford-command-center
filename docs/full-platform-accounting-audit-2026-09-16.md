# Full platform and accounting audit — September 16, 2026

Release verification completed: **1,000/1,000 complete project journeys passed**, followed by **14/14 independent accounting operational cases**. The complete verified release suite also passed **821/821 checks**. No failures, cancellations, or skipped cases remained in these completed runs.

| Verification | Result |
| --- | --- |
| Final compiled Worker pressure run | 1,000 passed; 0 failed; 20 isolated company databases |
| Application requests | 305,080; 0 unexpected responses |
| Database statements | 28,658,320; integrity and foreign-key checks passed |
| Completed run duration | 1,381 seconds |
| Accounting operational re-audit after the 1,000 journeys | 14 passed; 0 failed |
| Complete release suite | 821 passed; 0 failed, cancelled, or skipped |
| Critical-control mutation checks | 7 of 7 deliberate faults detected |
| External requests / real messages sent | 0 / 0 |

## What the pressure test actually does

These are complete application journeys using real HTTP request handlers, isolated SQLite databases, and isolated file storage. They are not a calculation spreadsheet or 1,000 repetitions of one endpoint. The final run uses the compiled Worker. Synthetic identities, projects, documents, signatures, and accounting records stay outside production.

The deterministic random seed is `20260916`. There are 250 projects in each of four contract paths: Plan & Spec Lump Sum, Two-Phase Design-Build GMP, Small Project Lump Sum, and Time & Materials Not To Exceed. Of the 1,000 projects, 750 begin with a contact and 250 use the public-bid path without a contact. Costs and negotiated contract amounts vary independently across projects.

Each journey verifies:

1. Contact/opportunity creation, ownership, estimating entry, and persisted estimate inputs and calculations.
2. Three original PDF subcontractor quotes, text extraction, uploaded-file retrieval, scope comparison, exclusions, and recommendation. The lowest incomplete quote is rejected as the proposal basis; the complete low bidder is recommended. Re-selecting that bidder does not add the price twice.
3. A generated proposal DOCX, an actual edit to its Word content control, re-upload, preserved pricing, and scope carried into the proposal. These are programmatic edits to genuine DOCX files; Microsoft Word itself is not automated in every journey. The release suite also tests an existing Office-resaved fixture.
4. Review, award, a negotiated contract value different from the proposal, contract execution controls, signed-sales recognition, accounting synchronization, and billing gates.
5. A real operations-turnover occurrence, agenda review, role assignments, two synthetic employee signatures, preserved bonus agreement records, accepted turnover, and completed buyout action.
6. Operations records, schedule/quality requirements, purchase-order review/release/acknowledgment, AP review and accrual, payment preparation/clearing, lien waivers, owner billing and AR synchronization, partial and final receipts, WIP, reporting, and authorized closeout.
7. Intentional duplicate attempts, unauthorized actions, database failures and retries. Expected rejections must leave the underlying records consistent.
8. Final project completion, persistent bonus-payment review obligations, balanced journal debits/credits, zero remaining test AP/AR, SQLite integrity and foreign-key checks, and zero attempted external requests.

The baseline completed 1,000/1,000 journeys with 305,040 application requests and 28,709,040 database statements in 2,598 seconds. It used source handlers and ten isolated companies containing 100 projects each. That baseline is retained separately; passing it did not substitute for the deeper accounting audit below.

The final compiled run uses twenty isolated companies containing 50 projects each, with eight test processes at a time. This is functional pressure testing with growing company data. It is not a benchmark of 1,000 simultaneous users or of production hosting capacity.

## Defects repaired

| Area | Repair and resulting behavior |
| --- | --- |
| Approved AP payment preparation | Accounting can prepare payment details for an already approved large invoice without being incorrectly forced through the original Owner-approval gate again. Approved vendor, value, date, and allocations remain protected. |
| Manual journal lifecycle | Normalized journal headers/lines, source records, audit records, and posting events commit together. Injected failures leave no half-saved or half-posted entry. Drafts may remain unbalanced; submission and posting require exact balance. |
| Journal reversals | Original and reversing entries retain correct, separate links. A failed reversal cannot leave an orphan draft or freeze the original. Duplicate reversal and posting attempts are rejected. |
| Competing changes | Posting validates its approved source snapshot and period inside the transaction. A competing close or source change cannot slip through a check made earlier in the request. |
| Accounting dates and amounts | Real calendar dates and months are validated. Nonfinite/negative amounts are rejected where inappropriate. Payroll allocations must reconcile exactly to the cent. |
| Period close and reopen | Hard close requires all ten independently reviewed controls. Owner certification remains Owner-only. A hard-closed period cannot be downgraded to soft close. Reopening requires an Owner reason and invalidates stale WIP/checklist approvals. |
| WIP | Costs after the forecast period no longer enter its actual cost. Approval cannot silently change reviewed assumptions. Locked forecasts require an audited Owner reopen before editing. The UI selects the current period and disables locked inputs. |
| Bank matching and reconciliation | Matching is atomic and one-to-one. Competing matches/edits are rejected. An approved reconciliation remains locked. |
| Collections and cash planning | Collection actions use both project and invoice identity. Two projects with the same invoice number no longer share the latest collection note. Receipts beyond thirteen weeks are excluded from the thirteen-week sum. |
| Vendor paid-year reporting | Paid-year totals use the actual payment/clearing date instead of automatically using the invoice date. |
| Asset workflow | Profile edits and check-in cannot clear an Out Of Service/Missing/Retired state. Return to service requires the proper workflow; retired assets cannot be silently reactivated. |
| Drawing access | A secondary assigned PM can read and index permitted project drawings. Revocation takes effect consistently. Files outside the actor's scope cannot be indexed. |
| Funnel layout | Long project names receive the full card width. Amount, customer, and salesperson remain readable in a compact layout. Real drag-and-drop movement was checked with 50 populated cards. |
| Project Files layout | An invisible full-width file input was extending beyond its upload button and creating horizontal page scrolling. The input now stays within that button. |
| Mobile header and journal labels | Header actions remain above the fixed online-status strip. Journal fields no longer repeat their labels when the table becomes a narrow form. |
| Populated estimating workspace | Statistics, folders, and document cards reflow at phone widths. Cap-sheet header/footer controls retain their natural height while fields scroll. |
| Proposal and contract editors | Narrow studios use a full-height vertical document flow and a two-column section menu, instead of compressing the editor beneath a tall menu. Contract logos use their directly served static image. |
| Work-screen clutter | Removed repeated static instruction panels from the reviewed procurement, RFI/submittal, asset, financial-report, budget, and other work surfaces. Live metrics, evidence requirements, permissions, and validation remain. |

## Independent accounting operational audit

After the final 1,000-project run finished successfully, all fourteen independent integration cases were rerun against the same compiled application and passed. These exercise the real accounting handlers in addition to the financial stages in all 1,000 project journeys:

| Case | Evidence exercised |
| --- | --- |
| 1 | Journal draft save: injected source-write failure, full rollback, successful retry. |
| 2 | Submit, independent approval, posting, reversal, duplicate protection, injected failures, and zero net ledger balance after a posted reversal. |
| 3 | Unbalanced draft persistence; blocked submission; correction; invalid dates/nonfinite numbers; preparer/self-approval and PM authorization boundaries. |
| 4 | Hard-close downgrade prevention and a competing period close during posting. |
| 5 | All ten close controls, independent review, Owner certification, close lock, and authorized reopen. |
| 6 | Competing book-to-bank matches preserve a single valid relationship. |
| 7 | Reviewed WIP assumptions cannot change during approval; locked edit denial; invalid month and amount checks. |
| 8 | Same invoice number across two projects; collection isolation; receipts outside the forecast horizon. |
| 9 | Prior-year invoice paid this year appears in paid-year totals and the tax-review queue. |
| 10 | Reconciliation approval racing an edit; correction and approval; approved-edit denial; invalid dates and negative balances. |
| 11 | WIP cost cutoff; Owner-only reopen with reason/history; a fresh independent review before relocking. |
| 12 | Asset capitalization draft through edit, review, approval, posting, and linked domain event. |
| 13 | Fully allocated payroll period and return; invalid dates, nonfinite values, one-cent differences and duplicate returns rejected; balanced clearing entry. |
| 14 | Cutover requires posted opening balances and an immutable Owner lock; manual cash items add, edit, and remove correctly. |

Existing compiled regression cases additionally cover signed contract values, owner-billing authority, AP/AR mirroring, money precision, four-digit accounts, financial report source detail, lien waivers, bonus obligations, and complete project closeout.

## Wider platform coverage

The verified release suite contains 821 passing checks with no failures, cancellations, or skips. It mixes real runtime integrations, unit/property checks, migration/storage tests, and static source/structure checks. The number is not presented as 821 browser journeys. It includes the existing 100-project sales and estimating pressure suites.

The new operational suite includes 44 actual scoped workspace loads plus workflow cases for selection-to-PO-to-installation, safety-to-accountable-work-to-closure, equipment safety controls, and drawing access/revocation (49 reported checks including nested tests). Existing suites cover meetings, turnover, bonuses, employee access, onboarding, time, performance, marketing/surveys, document governance, permissions, durable events, scheduler reconciliation, deletion/recovery, and storage failures.

The critical-control mutation gate detected all seven deliberately introduced faults. Instrumented coverage across the four configured critical modules is 89.07% lines, 70.19% branches, and 90.65% functions. These percentages describe those modules, not the entire application. TypeScript, artifact validation, migration replay, spreadsheet isolation checks, and the release gates also passed. Lint reported warnings but no errors.

## Browser review

The managed preview used synthetic project data. The desktop review covered sales, estimating, accounting, project controls, procurement, documents, meetings, field work, marketing, and administration. Actual funnel dragging was exercised. The review found and repaired the Project Files overflow and mobile header collision instead of relying only on page-width measurements.

Measured funnel widths of 375, 768, and 1,100 pixels reflowed without horizontal overflow. At 375 pixels, Accounting Command, WIP, month close, General Ledger, the journal form, Owner Billing, Cash Management, Payroll Reports, and Accounting Administration also reflowed without horizontal overflow. Fixed header actions were separately checked against the connectivity strip. The populated estimate workspace, cap sheet, proposal editor, and owner-contract editor were also reviewed at narrow widths. A duration edit from one to three months recalculated the cap-sheet contract value from $122,122.95 to $182,580.68; saving and reopening preserved the new value, and the proposal received the updated estimate. A browser-width preview is not a physical iOS/Android device test.

## Evidence and practical limits

- `platform-pressure-1000-baseline-2026-09-16.json` retains the completed source-handler baseline, each project result, endpoint counts, and sampled expected fault logs.
- `platform-pressure-1000-results-2026-09-16.json` contains the completed final compiled result, counts, all 1,000 project results, and endpoint evidence. The tested application source fingerprint is `d0c45d9e42dea1356592944b27acb22e2a120704c2f4b84251f0eaa9e07824f8`. It remained unchanged throughout the final run.
- `full-platform-release-evidence-2026-09-16.json` records the verified release gates and measured browser rechecks, including the saved duration/price edit and the proposal/contract handoff.
- The new pressure runner and operational/accounting integration tests remain in the source repository so the checks can be repeated.
- External email, banking, payroll-provider processing, and tax filing were not executed. Synthetic tests do not certify provider configuration, delivery, legal signatures, accounting policy, statutory financial statements, or production concurrency capacity.

No production projects or financial transactions were created by the pressure tests. A completed passing result means the documented checks passed on the tested release; it is not a promise that software can never contain another defect.
