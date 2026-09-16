# Turnover workflow release

Main Command Center only. Based on the supplied **Turnover Meeting Agenda - Template.dotx**.

## Two handoffs

| Handoff | Automatic trigger | Receiving lead | Packet |
| --- | --- | --- | --- |
| Sales → Estimating | Qualified opportunity enters Estimating | Assigned estimator | Customer, scope, commitments, budget, bid dates, documents, risks and actions |
| Estimating / Award → Operations | Authorized estimate award | Assigned project manager | The template's eleven sections, with current contract terms, final cap sheet, scope, quote comparisons, source documents, risks, setup, actions and recap |

Both appear under Meetings. The system prepares one meeting per opportunity and handoff. The receiving lead or company owner confirms the meeting date and location; no external calendar invitation is sent automatically. Public bids retain the existing exception that permits an opportunity without a customer contact.

Source sections update without overwriting discussion notes. Source files are referenced in the meeting's Files tab without making additional copies. Members can request discussion topics; existing leader/designated-manager removal controls and permanent audits remain in force. Printing uses the existing agenda PDF route.

The receiver checks the source sections and accepts the current revision. Source changes reset the review checklist and flag previously accepted packets for further review; the prior accepted snapshot remains permanent. Operations requires named PM, superintendent, chief estimating, operations leadership and accounting participants. A leader can assign the remaining meeting roles under People. Ambiguous names are not silently resolved.

## Financial authority

An award starts preparation. Operations acceptance requires either verified execution of the owner contract or an NTP reference recorded by the Company Owner, including date and authorized scope. An NTP or accepted turnover cannot recognize construction sales, activate the unsigned contract for accounting, or authorize construction billing. Existing two-signature and limited Phase 1 design authority rules remain in force.

Current controlled contract value is used instead of the historical award. Original proposal and award evidence remain intact.

## Accountability and automation

- Missing requirements create durable meeting actions and My Work assignments. Source-resolved requirements close; a manual status change cannot permanently hide an unresolved source requirement.
- Reassignment updates meeting access and moves current work to the new recipient. Previous work and delivery evidence remain stored; pending notices to the previous assignee are suppressed.
- Starting the Operations meeting creates buyout review work, due thirty calendar days after the actual meeting date in its configured time zone. A completed buyout review stays complete on subsequent refreshes. The broken date field in the uploaded template is not carried forward.
- Open turnover requirements feed the corresponding Sales/Estimating or Operations department agenda. Existing overdue escalation feeds leadership.
- New source transitions use the durable domain-event ledger. Bounded reconciliation recovers older records and interrupted handoffs. Failed legacy sources are retained with retry time and error evidence, and mark the scheduler unhealthy until resolved.
- Contract lookups and legacy amount repair now filter the requested project IDs in the database rather than loading all contracts before filtering.
- Workflow and section readiness registers include the new handoff and require evidence; they do not mark it healthy merely because code exists.

## Validation and boundaries

`tests/turnovers.integration.test.mjs` exercises 100 isolated synthetic estimating handoffs; receiver-only acceptance; source revision conflicts; retained notes and snapshots; interrupted handoff recovery; reassignment; departmental routing; current negotiated contract value; NTP without billing permission; required roles; source attachments; real printed agenda content; completed buyout preservation; and calendar-day arithmetic across DST, month, year and leap-year boundaries.

The standard verified release build also runs the existing workflow, financial, 100-project pressure, PDF/Word, authorization, fault, coverage and mutation controls. Synthetic records are confined to disposable test databases and are not inserted into Main.

Final release result: **754/754 tests passed**, including all three 100-case runs (estimating-only, sales-to-proposal, and turnover creation). Migration replay and recovery now cover all 39 migrations. Required coverage and all seven mutation controls passed. The shared My Work action handler also rejects replaced meeting assignments, preventing an old recipient's task from completing the replacement assignment.

Browser tooling is unavailable in this session. Layout has responsive CSS and static checks, but this release does not claim a new visual browser inspection. External calendar, email, Microsoft, accounting-provider and other integrations keep their existing configuration and approval boundaries. No provider is represented as connected or delivering without its existing evidence checks.
