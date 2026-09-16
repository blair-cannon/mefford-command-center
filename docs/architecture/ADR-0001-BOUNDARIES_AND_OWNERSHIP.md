# ADR-0001: Application Boundaries and Ownership

Status: Accepted 2026-08-23

The application shell owns authentication-aware navigation, project selection, and composition. Major workspaces own UI and local interaction state in separate lazy-loaded modules. API routes own authorization, validation, permanent writes, and business transitions. Domain libraries own deterministic policy.

D1 is the transactional source of truth; R2 is the binary source. Providers are reconciled systems, never proof of success merely because a request was sent.

## Rules

- Review any workspace approaching 50 KB for extraction.
- Keep `app/page.tsx` below 500 KB and free of Babel's 500 KB de-optimization warning.
- Lazy-load new major sections.
- Put shared policy in `lib/` without React dependencies.
- Use the durable outbox for cross-domain changes.
- Use forward-only migrations.
- Background jobs and integrations cannot grant business approvals.

F-15 separated Schedule and Team & Access from the application shell, preserving behavior behind lazy boundaries and reducing the shell below 500 KB.
