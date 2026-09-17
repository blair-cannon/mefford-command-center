# ChatGPT Sites to Self-Hosted Cloudflare: Data Migration Plan

This runbook governs the one-time migration of production D1 and R2 data from
the ChatGPT Sites-hosted deployment to a self-hosted Cloudflare account. It
supplements [Backup, Restore, and Disaster Recovery](BACKUP_RESTORE_DR.md),
whose Restore Procedure this plan follows; it is not a routine restore.

The only production data confirmed to exist today is Project 26-001 —
Johnstone Bloomington, IN Remodel (locked budget, cost codes, estimate
linkage, award/closeout controls, a completed daily-log task, company access
records, turnover/meeting records) plus roughly five R2 files (~421 KB: a
Scope of Work PDF, a drawing PDF, a vendor SVG logo, a converted PNG logo, a
proposal photo). No posted accounting transactions or executed owner-contract
record were found. Treat all of it as production regardless.

## Ownership

Company Owner authorizes the freeze window and accepts the migrated result,
per [README ownership table](../README.md#ownership). IT Administrator
executes every step below.

## Where exported data lives

Raw exports contain real customer and financial data. They are never
committed to git. Keep them under `.data-migration/` at the repo root
(git-ignored) or another path outside the working tree, and delete them once
the migration is accepted.

## Tooling

`scripts/migration/` operates directly on SQLite files — it does not require
Cloudflare account access, so this work can proceed before hosting is
provisioned:

- `baseline.mjs --sqlite <db-file> --out <baseline.json> [--label text]` —
  row count + an order-independent content hash per table. Two baselines
  with the same `overallHash` are guaranteed identical at the row level,
  regardless of insertion order or which engine (chat export vs. D1) wrote
  the rows.
- `verify.mjs --before <baseline.json> --after <baseline.json>` — diffs two
  baselines, prints every mismatching table, exits non-zero on any
  difference. This is the migration's pass/fail gate.
- `file-manifest.mjs --sqlite <db-file> --files-dir <dir> --out <manifest.json>` —
  schema-driven: finds every column matching `*_storage_key` (currently
  `project_files.storage_key`, `meeting_attachments.storage_key`,
  `vendor_compliance_documents.storage_key`,
  `vendor_submissions.attachment_storage_key`,
  `owner_contract_change_requests.manifest_storage_key`), reads the R2 key
  each row points to, and checks whether a same-named file exists under
  `--files-dir` (nested paths mirror the key's `/` segments) with a matching
  size. Reports missing files and size mismatches.
- `import-json-export.mjs --export-dir <dir> --sqlite <target-db-file> [--allow-missing-tables] [--overwrite-on-conflict t1,t2]` —
  loads a ChatGPT-export directory (shaped `<export-dir>/d1/<table>.json`,
  each `{ table, row_count, columns, rows }`, exactly what the project chat's
  export tool produces) into a target SQLite file that already has the
  current schema applied. It refuses to import a table the target schema
  doesn't have (schema drift — see the dashboard_display_* case below), and
  diffs every other table by primary key against whatever the target already
  has (migrations can seed reference rows, e.g. the four-digit account
  crosswalk or a bootstrap identity alias) rather than assuming a clash means
  trouble: an identical existing row (ignoring `*_at` timestamp columns,
  which get re-stamped whenever a seed migration is replayed) is skipped, a
  new key is inserted, and a same-key row with different content stops the
  import for manual review. A same-key conflict can also be a legitimate
  derived counter rather than a real clash — this repo's
  `dashboard_change_revisions` is a single-row cache-invalidation stamp that
  schema triggers bump on writes to other tables, so bulk-inserting the rest
  of the export always advances it past the export's own snapshot value;
  name such tables with `--overwrite-on-conflict` to let the export's value
  win instead of aborting.

A D1 file is a plain SQLite file, so these tools also work directly against
`.wrangler/state/.../*.sqlite` for local D1, or against a `.sql` dump loaded
into a scratch file with `sqlite3 scratch.sqlite < dump.sql`.

## Known finding: the first export was incomplete

The first export received (2026-09-17) covered only 50 of the 92 tables the
current schema defines — everything alphabetically from `microsoft_graph_*`
through `work_item_audits` was missing, most critically **`projects` itself**
(the Project 26-001 record), plus `project_files`, all `vendor_*` and
`owner_contract_*`/`owner_portal_*` tables, `project_bonus_*`,
`scheduled_operation_*`/`scheduler_*`, `template_governance_*`, `proposal_*`,
`notification_*`, `record_audits`, `runtime_failure_events`, and
`work_item_audits`. This has every sign of a truncated chat response (a
clean alphabetical cutoff) rather than production genuinely lacking those
tables — re-request the missing tables by name rather than assuming they're
empty. The export also included four tables (`dashboard_display_credentials`,
`dashboard_display_sessions`, `dashboard_display_audits`,
`dashboard_display_login_failures`) that aren't in `db/schema.ts` or
`drizzle/*.sql` at all — that's expected: `lib/dashboard-display-auth.ts`
creates them itself at runtime (`CREATE TABLE IF NOT EXISTS`) rather than
through a numbered migration, so run that function's DDL (or call it once)
against the target before importing those four tables' rows. The R2 side of
the same export was complete and verified: 5/5 objects present, SHA-256
matched the manifest exactly, and `file-manifest.mjs` resolved every
`meeting_attachments.storage_key` reference with no size mismatches.

## Procedure

1. **Freeze the source.** Company Owner authorizes a freeze window. Confirm
   no one is actively editing Command Center data in the ChatGPT Sites app
   for the duration of the export.
2. **Export D1.** Request a full per-table JSON export of every table from
   the ChatGPT project chat — the only place with live access to that
   database — shaped `<export>/d1/<table>.json` (`{ table, row_count,
   columns, rows }`) plus `<export>/d1/row-counts.json`. Save it under
   `.data-migration/source/<export-name>/`. Check the table count against
   `db/schema.ts` immediately (see the known finding above) — a plausible
   but incomplete export is easy to miss otherwise.
3. **Export R2.** Request every object's bytes for the storage keys found in
   step 2 (there is no bulk R2 listing via the CLI — Cloudflare's S3-compatible
   API or dashboard access would be needed for a bucket-wide listing; absent
   that, drive the export from the known D1 storage keys instead), plus a
   manifest of storage key, size, and SHA-256 per object. Save each file
   under `.data-migration/source/<export-name>/r2/objects/<key>` so its path
   matches its storage key exactly, and re-hash every file to confirm it
   matches the manifest's declared SHA-256 before trusting it.
4. **Build a target scratch database and baseline the source.** Replay every
   migration into a fresh scratch file (`for f in drizzle/*.sql; do sqlite3
   scratch.sqlite < "$f"; done`), then import the export into it:
   `node scripts/migration/import-json-export.mjs --export-dir .data-migration/source/<export-name> --sqlite scratch.sqlite`
   (add `--allow-missing-tables` only once the gap is understood and accepted
   per the known finding above; add `--overwrite-on-conflict
   dashboard_change_revisions` since that table's value will always trail
   the export's after other tables are inserted). Then baseline it:
   `node scripts/migration/baseline.mjs --sqlite scratch.sqlite --out .data-migration/baseline-source.json --label "chatgpt-sites-source"`
5. **Build and clear the file manifest.**
   `node scripts/migration/file-manifest.mjs --sqlite scratch.sqlite --files-dir .data-migration/source/<export-name>/r2/objects --out .data-migration/manifest.json`
   Resolve every reported missing file or size mismatch before proceeding —
   re-request the specific object from the ChatGPT chat rather than guessing.
6. **Company Owner review.** Present row counts, the file manifest summary,
   and the two known gaps (no posted accounting transactions, no
   posted/executed owner contract) for acceptance before touching the new
   production database.
7. **Provision target (see hosting setup).** Once the new Cloudflare D1
   database and R2 bucket exist, apply every migration to it
   (`wrangler d1 migrations apply <db> --remote`), run the same
   `import-json-export.mjs` command against it (or export the applied D1 to
   a local file first and run it there, then load the result), and upload
   each manifested file with its original key
   (`wrangler r2 object put <bucket>/<key> --file=...`).
8. **Baseline the target and verify.**
   `node scripts/migration/baseline.mjs --sqlite <exported-or-local-copy-of-target> --out .data-migration/baseline-target.json --label "new-cloudflare-target"`
   `node scripts/migration/verify.mjs --before .data-migration/baseline-source.json --after .data-migration/baseline-target.json`
   A `MATCH` result is required before cutover. Re-run `file-manifest.mjs`
   against the target's storage keys and the same `--files-dir` to confirm
   nothing was dropped during upload.
9. **Final delta.** If the ChatGPT Sites app kept running after step 2,
   repeat steps 2, 4, 5, 7, and 8 for a short delta window immediately before
   cutover, instead of re-exporting everything.
10. **Cutover.** Company Owner accepts the verified target. Point the new
    Worker deployment live. Keep the ChatGPT Sites instance in a read-only,
    un-advertised state as a fallback until acceptance is final, then retire
    it per the project's separate communication to Mefford Contracting.
11. **Delete local exports.** Once accepted, delete `.data-migration/` from
    this machine; the accepted target D1/R2 is now the only production copy.
