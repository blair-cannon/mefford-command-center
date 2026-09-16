# Deployment and Rollback Runbook

## Normal Release

1. Confirm scope and publication approval.
2. Inspect the current live site and access policy.
3. Make the smallest coherent source change.
4. Add one forward-only numbered migration for schema changes and replay every migration from zero.
5. Run focused tests and TypeScript checks.
6. Create a Sites checkpoint; full build, tests, coverage, and mutation controls must pass.
7. Monitor the immutable deployment until terminal success and record the public version.

## Rollback

Rollback deploys the last known-good saved version; it is not a Git reset and does not reverse D1 migrations. The Company Owner authorizes it. IT records current and target versions, verifies forward schema compatibility, stops duplicative external actions, deploys the compatible saved version, then verifies authentication, project read, one authorized write, file retrieval, scheduler ledger, and financial read-only reporting.

If a migration is incompatible, use a tested forward repair migration. Never delete or rewrite an applied migration.
