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

A D1 file is a plain SQLite file, so these tools also work directly against
`.wrangler/state/.../*.sqlite` for local D1, or against a `.sql` dump loaded
into a scratch file with `sqlite3 scratch.sqlite < dump.sql`.

## Procedure

1. **Freeze the source.** Company Owner authorizes a freeze window. Confirm
   no one is actively editing Command Center data in the ChatGPT Sites app
   for the duration of the export.
2. **Export D1.** Request a full SQL dump (or table-by-table row export) of
   every table from the ChatGPT project chat — the only place with live
   access to that database. Save it to `.data-migration/source/d1-export.sql`.
   Load it into a scratch file to work with the tooling:
   `sqlite3 .data-migration/source/d1.sqlite < .data-migration/source/d1-export.sql`.
3. **Export R2.** Request every object's bytes for the storage keys found in
   step 2 (there is no bulk R2 listing via the CLI — Cloudflare's S3-compatible
   API or dashboard access would be needed for a bucket-wide listing; absent
   that, drive the export from the known D1 storage keys instead). Save each
   file under `.data-migration/source/files/<key>` so its path matches its
   storage key exactly.
4. **Baseline the source.**
   `node scripts/migration/baseline.mjs --sqlite .data-migration/source/d1.sqlite --out .data-migration/baseline-source.json --label "chatgpt-sites-source"`
5. **Build and clear the file manifest.**
   `node scripts/migration/file-manifest.mjs --sqlite .data-migration/source/d1.sqlite --files-dir .data-migration/source/files --out .data-migration/manifest.json`
   Resolve every reported missing file or size mismatch before proceeding —
   re-request the specific object from the ChatGPT chat rather than guessing.
6. **Company Owner review.** Present row counts, the file manifest summary,
   and the two known gaps (no posted accounting transactions, no
   posted/executed owner contract) for acceptance before touching the new
   production database.
7. **Provision target (see hosting setup).** Once the new Cloudflare D1
   database and R2 bucket exist, import the dump
   (`wrangler d1 execute <db> --remote --file=.data-migration/source/d1-export.sql`,
   or via a local D1 first as a dry run) and upload each manifested file with
   its original key (`wrangler r2 object put <bucket>/<key> --file=...`).
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
