# Deployment and Rollback Runbook

This app is moving from ChatGPT Sites hosting to a self-hosted Cloudflare
account (see [Data Migration Plan](DATA_MIGRATION_PLAN.md)). Steps 1–5 below
are unchanged either way; step 6–7 differ by hosting path. Once the
self-hosted deployment is accepted as production, the Sites section becomes
historical — keep it only until the ChatGPT Sites instance is fully retired.

## Normal Release

1. Confirm scope and publication approval.
2. Inspect the current live site and access policy.
3. Make the smallest coherent source change.
4. Add one forward-only numbered migration for schema changes and replay every migration from zero.
5. Run focused tests and TypeScript checks.
6. **Self-hosted (current):** `npm run deploy` (see below). **Sites (legacy, during transition only):** create a Sites checkpoint; full build, tests, coverage, and mutation controls must pass.
7. Monitor the immutable deployment until terminal success and record the public version.

## Self-hosted release (Cloudflare)

`npm run build` (`vinext build`) emits a deploy-ready `dist/server/wrangler.json`
on every build — bindings come from `vite.config.ts`'s `localBindingConfig`,
sourced from `.openai/hosting.json` (binding *names*: `DB`, `BUCKET`) plus
these environment variables (real D1/R2 *identifiers*, set only when building
for production — leave unset for local dev, which uses Miniflare's emulated
D1/R2 and placeholder values):

| Variable | Purpose |
| --- | --- |
| `CF_D1_DATABASE_NAME` | The production D1 database's name (`wrangler d1 create` output). |
| `CF_D1_DATABASE_ID` | The production D1 database's UUID (`wrangler d1 create` output). |
| `CF_R2_BUCKET_NAME` | The production R2 bucket's name (`wrangler r2 bucket create` output). |

There is deliberately no separate, hand-maintained `wrangler.toml`/`wrangler.jsonc`
for production — one drifting out of sync with `vite.config.ts` (worker name,
compatibility flags, cron triggers) would be worse than parameterizing the one
source of truth that already exists.

**Release:** run `npm run deploy` (`scripts/deploy.sh`). It builds with the
production D1/R2 identifiers, applies any pending D1 migrations, and deploys
the Worker, in that order — one command for the whole release. The production
identifiers are baked in as defaults in the script; override any of them by
setting the same-named environment variable before running it.

If a step needs to be run by hand (e.g. re-running just the deploy after a
migration already applied), the script's steps translate directly:

```bash
CF_D1_DATABASE_NAME=<name> CF_D1_DATABASE_ID=<uuid> CF_R2_BUCKET_NAME=<bucket> npm run build
```

`dist/server/wrangler.json`'s `migrations_dir` is hardcoded by the Cloudflare
Vite plugin to a `migrations/` folder that doesn't exist in this repo — our
migrations live in `drizzle/` — so `wrangler d1 migrations apply <db-name>
--remote -c dist/server/wrangler.json` as-is fails with "No migrations
present". Patch a copy of the generated config first:

```bash
node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync('dist/server/wrangler.json'));c.d1_databases[0].migrations_dir='$(pwd)/drizzle';fs.writeFileSync('/tmp/wrangler-migrations.json',JSON.stringify(c));"
npx wrangler d1 migrations apply <db-name> --remote -c /tmp/wrangler-migrations.json
```

Then deploy the Worker itself, which does not need that patched
`migrations_dir` (it only matters to the migrations subcommand):

```bash
npx wrangler deploy -c dist/server/wrangler.json
```

Set/rotate secrets with `npx wrangler secret put <NAME>` (never in `vars` or
committed config).

## Rollback

Rollback deploys the last known-good saved version; it is not a Git reset and does not reverse D1 migrations. The Company Owner authorizes it. IT records current and target versions, verifies forward schema compatibility, stops duplicative external actions, deploys the compatible saved version, then verifies authentication, project read, one authorized write, file retrieval, scheduler ledger, and financial read-only reporting.

If a migration is incompatible, use a tested forward repair migration. Never delete or rewrite an applied migration.
