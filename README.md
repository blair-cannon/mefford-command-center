# MeffCon Command Center

MeffCon Command Center is Mefford Contracting's single-tenant construction operating system. It coordinates sales, estimating, contracts, project controls, field operations, accounting, employee administration, documents, integrations, and audit evidence.

## Production Architecture

- Vinext/React application deployed as a Cloudflare Worker through ChatGPT Sites
- Cloudflare D1 is the authoritative transactional database
- Cloudflare R2 stores controlled source files and project evidence
- Microsoft Entra ID is the intended permanent employee identity provider; the ChatGPT identity bridge is temporary and canonicalizes Jordan to `jmefford@meffcon.com`
- External delivery and provider actions fail closed when their connection is unavailable
- Database changes are append-only numbered Drizzle migrations; production deployment is allowed only after clean replay, typecheck, build, behavioral tests, coverage, and mutation controls

## Ownership

| Area | Accountable owner |
| --- | --- |
| Business authority and production release | Company Owner |
| Application, hosting, identity, recovery, integrations | IT Administrator |
| Financial controls and reconciliations | Accounting Administrator |
| Employee lifecycle and benefits | Human Resources / Benefits Administrator |
| Legal templates and contract language | Attorney + Company Owner |
| Project and field operating workflows | Department owner + Company Owner |

No operator may use recovery, integration, or administrative access to assume a business approval reserved for another role.

## Required Operator Reading

- [Operator Handbook](docs/OPERATOR_HANDBOOK.md)
- [Deployment and Rollback](docs/DEPLOYMENT_AND_ROLLBACK.md)
- [Backup, Restore, and Disaster Recovery](docs/BACKUP_RESTORE_DR.md)
- [ChatGPT Sites to Self-Hosted Data Migration](docs/DATA_MIGRATION_PLAN.md)
- [Retention and Legal Hold](docs/RETENTION_POLICY.md)
- [Integration Cutover](docs/INTEGRATION_CUTOVER.md)
- [Architecture Decisions](docs/architecture/ADR-0001-BOUNDARIES_AND_OWNERSHIP.md)
- [Microsoft Entra and Graph Setup](docs/MICROSOFT_ENTRA_GRAPH_SETUP.md)

## Development and Verification

Use Node.js 22.13 or newer. Preserve the existing Sites lifecycle, lockfile, D1/R2 bindings, and numbered migration history.

```bash
npm run typecheck
npm run test:controls
npm run test:mutation
npm run build
```

`npm run build` is the production gate. It validates the Worker artifact and runs all controls. A Sites checkpoint is the only approved publication path.

## Architecture Rules

- `app/page.tsx` is the orchestration shell, not a home for every workflow.
- Major workspaces are lazy-loaded and owned in dedicated modules.
- API routes enforce authorization and protected transitions on the server.
- D1 is authoritative; browser state is never a business record.
- R2 originals are retained; database rows carry identity, revision, access, and audit metadata.
- Scheduled work is idempotent, leased, retry-bounded, and observable.
- Generated or distributed templates must pass the F-14 governed-source release gate.

Never place secrets in client code, commits, screenshots, logs, or support tickets.
