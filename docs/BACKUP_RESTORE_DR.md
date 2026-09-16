# Backup, Restore, and Disaster Recovery

## Objectives

| System | RPO | RTO | Required evidence |
| --- | ---: | ---: | --- |
| D1 records | 15 minutes | 4 hours | Recovery point, counts, invariants, sampled records |
| R2 controlled files | 24 hours | 8 hours | Object inventory, hashes, sampled retrievals, orphan report |
| Source and migrations | Every checkpoint | 2 hours | Saved version, commit, clean replay, production build |
| External providers | Provider-dependent | 1 business day | Receipts and exception queue; never inferred success |

## Restore Procedure

1. Declare incident, recovery point, scope, and Company Owner authorization.
2. Put affected writes in maintenance mode; stop outbound actions.
3. Restore to a separate target—never over the only production copy.
4. Restore D1 and apply only later forward migrations included in the chosen application version.
5. Restore/reconcile R2 and report missing, duplicate, hash-mismatch, and orphan objects.
6. Run schema replay, authorization, financial balance, record/file linkage, and scheduler-idempotency controls.
7. Compare critical table counts and sample projects, contracts, files, accounting events, identities, and audits.
8. Obtain Company Owner acceptance before reopening writes or delivery.
9. Reconcile providers from durable receipts; never blindly replay email, payment, signature, or calendar actions.

Quarterly, IT restores the latest approved recovery point into an isolated target and records timing, recovery point, migration version, D1 counts, R2 samples, failed invariants, achieved RPO/RTO, operator, owner reviewer, and remediation dates. Automated schema replay does not replace the real platform/file drill.
