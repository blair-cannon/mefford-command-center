# F-06 Test And Internal-Control Environment

## Control objective

No Command Center release may be treated as safe because source text contains an expected phrase, a screen renders, or TypeScript compiles. A production checkpoint must demonstrate observable behavior at the authorization, HTTP, database, object-storage, accounting, scheduler, workflow, and health-evidence boundaries.

## Mandatory release gates

The production build stops on the first failure in this sequence:

1. F-07 spreadsheet dependency provenance, integrity, isolation, timeout, and import-limit verification.
2. Strict TypeScript verification with zero errors.
3. ESLint static-control verification.
4. Bounded production compilation.
5. Compiled-artifact existence, size, binding, and route validation.
6. The complete automated suite against the newly compiled artifact.
7. Minimum critical-module coverage of 85% lines, 70% branches, and 85% functions.
8. A 100% mutation score for the defined critical health and scheduler decision mutations.

The checkpoint command runs this sequence. There is no separate production path that omits the controls.

## Behavioral test layers

| Layer | Required evidence |
| --- | --- |
| Compiled Worker HTTP | Anonymous denial; canonical session identity; project read/create/delete through real Request and Response objects |
| Role matrix | Company Owner, Administrator, Project Manager, ordinary Employee, and inactive identity boundaries |
| Ephemeral D1 | Every migration replayed in order into a clean database; critical tables and indexes verified |
| Transaction controls | Injected statement failure rolls back the entire D1 batch |
| Ephemeral R2 | Put, read, list, delete, and injected storage failures remain observable |
| Accounting | Whole-cent balance, immutable journal detail, idempotency, unbalanced-entry denial, hard-close denial |
| Scheduler | One outcome per slot, exclusive ownership, deferred outcomes, exhausted failure, dead letter, stale-run timeout |
| Property invariants | Thousands of deterministic generated money, schedule, evidence, identity, and project-health scenarios |
| Mutation detection | Deliberately broken fail-closed, scheduler, scoring, and critical-guardrail decisions must be caught |
| Existing workflow contracts | Static wiring and content regressions remain useful secondary evidence but cannot satisfy F-06 alone |

## Isolation and safety

- D1 is an in-memory database created separately for each behavioral test file.
- All migrations replay from zero; production data is never read or altered.
- R2 is an isolated in-memory object bucket with deterministic fault injection.
- Test identities use reserved `*.test@meffcon.com` addresses except the two canonical owner/admin fixtures.
- Microsoft access enforcement is disabled only inside the isolated harness; Microsoft security and webhook controls have their own fail-closed contract tests.
- The compiled Worker receives test bindings through a dedicated Node loader. Application source code does not receive a test-only authentication bypass.
- Generated cases use a fixed seed so every failure is reproducible.

## Separation of claims

A green release gate proves only the controls executed for that artifact. Runtime System Health continues to require independent current D1, R2, authentication, delivery, scheduler, and provider evidence. A passing build cannot mark an unconfigured provider as connected and cannot convert missing production evidence into success.

## Change-control requirements

Any change to authentication, authorization, accounting, owner deletion, scheduling, migrations, Microsoft webhook security, project-health guardrails, or file storage must add or update behavioral tests. Coverage may increase but may not fall below the enforced thresholds. A changed mutation target stops the build until the mutation control is deliberately reviewed and updated.

## Full-platform pressure audit

After the verified release build, run `node scripts/platform-pressure-1000.mjs`. It uses the compiled Worker by default, twenty isolated 50-project company databases, and eight test processes. Every project follows the quote-to-closeout journey. Source fingerprints before and after must match; all 1,000 results, balanced ledgers, database integrity, and zero external requests must pass. Production records and provider services are not used.

Then run the independent accounting operational audit with `node --experimental-strip-types --import ./tests/support/f06-cloudflare-loader.mjs --test tests/accounting-operational-audit.integration.test.mjs`. Preserve both results in the dated release evidence. An interrupted run does not count as a completed passing result.
