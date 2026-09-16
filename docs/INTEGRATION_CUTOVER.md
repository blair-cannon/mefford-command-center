# Integration Cutover Runbook

Use separately for Microsoft, operational email, weather, Ramp, Chase, cards/banking, LinkedIn, Facebook, Google Analytics, newsletters, and surveys.

## Before Connection

1. Name business owner, technical owner, provider account, data scope, permissions, and rollback owner.
2. Store secrets only in hosted server-side environment values.
3. Verify least privilege, redirect/webhook URIs, client-state validation, rate limits, idempotency, renewal, and revocation.
4. Map source, destination, conflict rule, deletion rule, and prohibited fields.
5. Define success from verified provider evidence—not credential presence or request acceptance.

## Cutover

Company Owner approves the window and external effects. Capture a pre-cutover snapshot. Connect one provider and workflow at a time. Run read-only reconciliation first, then one idempotent controlled write and independently verify it. Confirm audit, retry, dead-letter, alert, and revocation behavior before expanding scope.

## Rollback

Disable outbound work, revoke credentials/subscriptions, preserve receipts, and reconcile uncertain actions before retrying. Never delete Command Center records to match a provider.

F-11 remains the provider-readiness program. No listed account should be connected until its individual checklist and end-to-end evidence are complete.
