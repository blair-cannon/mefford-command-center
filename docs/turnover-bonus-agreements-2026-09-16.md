# Turnover bonus agreements

The Main Command Center uses the exact uploaded `Mefford Contracting Bonus Structure.docx`. The original is archived in `assets/templates/mefford-bonus-original.docx`; its SHA-256 fingerprint and rendered PDF are embedded for authenticated document generation. All policy paragraphs, bonus rates, and accountability standards remain unchanged. Only the blank agreement fields are filled. An additional signature record identifies the revision, source-document fingerprint, consenting employees, and meeting.

## Project and employee controls

- Operations turnover prepares a draft from the awarded estimate's approved cost budget, final completion date, and uniquely identified active PM and superintendent. The bonus basis is the cost budget, not recognized contract revenue. Owner contract signatures and construction billing controls remain independent.
- Drafts refresh from source data until signatures or an explicit Owner revision freeze their basis. Later source changes block signing and turnover acceptance until a new revision is issued. The update form suggests the current source values.
- The exact source document overlaps its ranges at 500000 and leaves fractional-dollar gaps at certain boundaries. The system requires an explicit Company Owner tier decision at these values. Management decisions and reasons are audited without rewriting the policy.
- Only each assigned, active employee can sign their own role. The server checks the current revision, document fingerprint, full name, drawn PNG signature, consent, active turnover meeting, and current source assignments. Owner access cannot sign on behalf of another person.
- Each signature writes a new immutable PDF to project files. The signatures and file metadata commit atomically. A storage or database failure does not report a successful signature. Later revisions cannot overwrite earlier signed copies.
- Only the Company Owner can issue a replacement revision, with an effective date and reason. Project assignments are updated in the same transaction. Both current employees sign the new revision. The former employee's eligibility is left for management review; no automatic forfeiture or duplicate payout is inferred.
- A finished original turnover stays unchanged. A follow-up turnover creates a separate meeting with the incoming team and agreement agenda item. Its signatures reference that meeting.
- Agreements are restricted to internal project leadership and Accounting and are excluded from general meeting attachments and owner-facing files. Obsolete signature assignments and queued reminders are resolved when employees change.

## Closeout

Authorized total project closeout sets a persistent `Review Required` bonus obligation in the same transaction that closes the project. Accounting Command, project Closeout, and My Work expose it. Catch-up reconciliation recovers interrupted requests and older controlled closeouts. Review includes all earlier signed revisions, employee changes, schedule, final cost and outside-reported OSHA evidence. July/December payout timing is preserved. This feature does not determine final eligibility, create a payroll payment, approve a disbursement, or issue money.

## Verification

- Real HTTP-handler integration covers original-file identity, the seven tiers and ambiguous boundaries, all four contract lifecycle scenarios, PM/superintendent signatures, wrong actors, stale signatures, missing consent, PDF storage failures, atomic database failures, current-source changes, employee replacement, follow-up meetings, preserved original files, and external-owner denial.
- Existing complete project lifecycle tests verify the closeout obligation and Accounting recipient against authorized closeout, not a manually toggled project status.
- The source Word document and all four populated PDF pages were rendered and visually inspected. The interface and replacement form were checked in the browser at full desktop width and in 360px and 768px work panels; measured content width matched available width without horizontal scrolling.
- All data and signatures used in tests are explicitly synthetic. Test networks are blocked. No production project, employee agreement, or payment was submitted during testing.

Full verified release gates are required before publication, including TypeScript, lint, compiled-worker workflows, 100-project pressure suites, database migration replay, coverage thresholds, and mutation tests.
