# Populated UI and workflow follow-up — September 11, 2026

Main MeffCon Command Center; extends the standalone platform and connected lifecycle audits. User authorizes publishing verified repairs as work progresses. This review uses synthetic local data, including twelve long-title, high-value funnel cards, a populated executive queue, and an executed synthetic project created through the lifecycle HTTP workflow. Production business records were not used for test mutations.

## Repairs

- Restored desktop native funnel dragging for released estimates. Added a per-card Move To selector for phone and keyboard operation, using the same validation and persistence path. Pending moves cannot be submitted twice for the same card; failed saves restore its previous state.
- Allowed released estimates to advance to Negotiation on both client and server. Preserved the permanent estimating release on the client as well as the server; the previous client code cleared it when moving an untouched estimate out of Estimating and incorrectly claimed it had left the estimating queue.
- Kept estimating handoff, Lost reason, and approved Awarded workflow controls. Arbitrary external text drops cannot move a record.
- Fixed funnel column geometry during dragging, stage changes, and empty-column transitions. Columns have independent vertical scrolling; the board scrolls horizontally. Save notices no longer displace the board.
- Prevented populated dashboard action rows from flex-shrinking and clipping their contents. Critical has a solid red background around the entire label, with intrinsic width and non-shrinking padding.
- Increased undersized text and controls in purchasing, selections, design, closeout, financial reports, meetings, assets, and administration. Wrapped change-order controls and corrected Financial Reports' phone-width status-banner overflow. Normalized older green hero backgrounds to the current charcoal treatment.

## Browser evidence

Actual local preview browser checks, beyond source assertions:

- Native drag moved an estimating-released card to Proposal Submitted and then Negotiation. Board geometry remained 1013 × 631.39 px at top 401.67 px after saving; columns stayed 313.48 × 608.39 px. Earlier lead drag and phone Move To selection persisted to storage.
- A populated dashboard queue reproduced compressed rows. After repair, rows retain their full badges, titles, owner/date and scroll naturally. Critical measured 80.80 px with 81 px scroll width and solid rgb(165,34,40), including the 390 px phone viewport.
- Desktop module navigation/readability checks covered budget, subcontracts, change orders, purchasing, procurement, design, RFIs, submittals, schedule, selections, closeout, daily logs, safety, quality, financial reports, accounting administration, vendors, administration, goals, HR, employee requests, templates, access, operations and meetings.
- At 390 px, page-width checks covered project overview, budget, purchasing, selections, financial reports, RFIs, AP, owner billing, cash, payroll, WIP, administration, goals, HR, access, daily logs, safety, quality and closeout. Financial Reports initially overflowed to 485 px; its repaired page fits the 380 px content viewport. Dashboard and reports also fit at 320 px. Dashboard reviewed at 1024 px, including the populated Critical row.
- Visually inspected populated dashboard, funnel, purchasing, RFI modal, WIP, and intermediate-width dashboard screenshots. The phone RFI form saved a controlled draft and displayed its permanent Initiated timeline. The browser automation's date-fill operation did not dispatch the React update; native keyboard date editing did, and saving succeeded. This was an automation input limitation, not bypassed validation.

## Workflow regression evidence

The added funnel integration suite calls actual HTTP handlers and verifies lead persistence, rejected incomplete estimating handoff, released proposal/negotiation advancement, permanent lock preservation, and rejected backwards moves. It blocks external requests. The complete release gate also reruns the existing compiled-Worker lifecycle and standalone platform audits: four contract types through project creation and closeout; cross-project authorization; change-order execution and rollback; AP/AR timing; payroll posting and rollback; bank review separation; file ownership and storage recovery; large My Work queues; and native scheduler/failure evidence.

## Coverage boundaries

Navigation/geometry checks are distinguished from completed workflow transactions; this report does not claim every button, business-data combination, physical phone, or provider has been exercised. Microsoft connections, real email delivery, bank execution, payroll-provider submission and production financial reconciliation remain outside this standalone pass. Recent production error logs showed Microsoft mail/calendar 403 responses and unauthenticated session 401 responses, not a funnel server crash. Local document fixtures do not copy every stored PDF object into the preview; document integrity is exercised in the isolated runtime harness.
