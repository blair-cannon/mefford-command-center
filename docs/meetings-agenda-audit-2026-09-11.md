# Meetings workspace and automatic agendas

Main Command Center, September 11, 2026. This change targets meetings. Pilot and source-transaction approval controls remain unchanged.

## Audience routing

| Meeting | Preset topics and automatic inputs |
| --- | --- |
| Project Subcontractor | Safety, lookahead, sequencing, production, deliveries, RFIs/submittals, quality, logistics, field changes, commitments. Owner receivables, AP detail, internal bid pricing and medical detail are excluded. |
| Project Owner | Owner decisions/selections, schedule creep/milestones, contract/change exposure, issued billing/payment, project safety follow-up, quality and closeout. |
| Project Design | Design schedule, drawings, RFIs, submittals, decisions, constructability, selections and design/field change exposure. |
| Weekly L10 | Live scorecard, saved measures, rocks, prior to-dos, major exceptions, missed targets, persistent commitments and IDS actions. |
| Quarterly Rock/Review | Current scorecard plus explicit prior-quarter review, rocks, headlines, major issues, new rocks, quarterly commitments and cascading messages. Live counts are not historical quarterly results. |
| Sales/Estimating Department | Pipeline follow-ups, estimate deadlines, estimator assignment gaps, quote coverage/scope review, estimate/proposal approvals, award handoff, sales goals and recorded awards. |
| Operations Department | PM/superintendent coordination, schedule recovery, lead times, procurement coverage, field safety/quality, information blockers, change exposure, handoffs and closeout. |
| Accounting Department | Collections, payment promises, billing approvals, AP/payment holds, cash differences, latest WIP exceptions and unfinished close tasks. |

## Behavior and controls

- New meetings start with preset headings and blank discussion notes. Nothing is automatically marked reviewed or complete. All template timeboxes total their default duration.
- Chairs see a source preview before creating a series. Department participant suggestions use active company roles, with company owners included. The chair chooses the schedule and can adjust participants. No production test series or invitations were created.
- Chairs refresh pre-meeting sources on opening, every 60 seconds while the selected workspace is visible, on window focus, on explicit refresh and before publish/start. Attendee views reload the saved agenda. The existing scheduler refreshes up to eight upcoming agendas per execution in rotating order and honors publication holds.
- Schedule rules compare saved baseline, current plan, forecast and completion. Procurement compares lead/release deadlines with required-on-site and expected delivery dates. These are record-based rules, not unrestricted inference from narrative text.
- Leadership escalation includes major slippage, critical safety, red health, significant change exposure, significant/aged/disputed receivables, loss-making WIP, large cash differences, missed targets and persistent commitments.
- AR mirrors and original billings count once. Issued balance uses recorded receipts. Draft billings stay in internal approval sections. Latest health/WIP records are selected; quarantined/deleted projects and their AR mirrors are excluded.
- Cards show source identity, last update, discussion reason and recommended next step. Source links retain the destination workspace's authorization. Routing never authorizes a change order, payment, award or proposal release.
- Stable source identities and a short refresh lease prevent duplicate overlapping refreshes. Notes, timeboxes and dispositions survive updates. Resolved sources stay as cleared records. Published changes preserve addenda, before/after evidence and previously stored PDFs.
- Starting a meeting freezes automatic sources. Prior commitments reference their original accountable actions; repeat refreshes do not inflate carry counts or pull future actions backward.
- Department and exact-occurrence authorization applies to API responses, PDFs and files. Accounting requires a finance role or company owner access. A PM title does not grant universal meeting editor privileges.
- Draft minutes can be saved and reviewed text submitted at finalization. Long final minutes paginate by rendered width, including unbroken identifiers, using embedded fonts. Final records still require numbered revisions.
- Microsoft invitation, transcript and email functions retain their connection gates. No live mail or calendar delivery was exercised or claimed.

## Verification

Seven new functional/integration tests exercise all eight audiences, actual HTTP meeting handlers, source refresh/clearing, concurrent refresh rejection, published history, draft-minute persistence, long final PDFs, role boundaries, cross-occurrence requests and carryforward. Fixtures stay in isolated D1/R2 tests with outbound requests blocked. Five existing meeting workflow checks also pass.

The release gate requires the full build, type/lint checks, compiled Worker suite, both 100-project pressure tests and mutation checks. Final results are recorded in the release handoff.

Direct browser QA remains unavailable under the session's browser restriction. Responsive CSS was reviewed and built; this report does not claim browser/mobile visual certification. PDF output is separately rendered and inspected, with text extraction checking the final discussion and complete long identifier.

## Release result

The final release gate passed: 714 tests, zero failures, both independent 100-project pressure tests, all 38 migrations replayed, required coverage thresholds, and 7/7 critical-control mutation checks. TypeScript and lint have zero errors; 16 existing nonblocking lint warnings remain outside the meeting changes. A ten-page synthetic minutes PDF retained all 130 discussions and the full long identifier; first and final rendered pages were inspected after the pagination repair. No direct browser or real provider-delivery certification is implied.
