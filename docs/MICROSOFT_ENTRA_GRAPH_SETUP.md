# Mefford Command Center — Microsoft Entra ID and Graph setup

This is the implementation contract for Blain. It reflects the code deployed from this repository; it is not a generic Microsoft checklist.

**Update (2026-09-18):** Command Center now runs self-hosted on Cloudflare
(`https://mefford-project-command.mefford-project-command.workers.dev`), not ChatGPT Sites. The
"private Sites access policy" described below no longer exists on this deployment — that was the
only thing establishing who was signed in at all, so the Entra flow this doc sets up needs to
become the primary login itself (a real session, not just an additional proof layered on Sites'
identity). That code change is tracked separately and not yet built. This doc's app-registration,
permissions, and secret-handling steps are still exactly right and can proceed now.

## 1. What this changes—and what it does not

Command Center used to keep two separate gates (this described the ChatGPT Sites deployment;
see the update note above for the current, self-hosted state):

1. The private Sites access policy authenticates the visitor to the hosted Site.
2. Command Center requires an owner-approved Microsoft directory grant. The Microsoft account must then complete a single-tenant Entra authorization-code + PKCE identity proof.

A Microsoft 365 account never grants Command Center access by itself. Directory sync only creates a candidate. Only a Company Owner can grant, activate, suspend, revoke, or restore access. Blain can configure and reconcile Microsoft, but cannot approve access.

The Entra callback verifies the Microsoft tenant, immutable object ID, and mailbox address. It retains no delegated access token or refresh token. Outlook, Teams, directory automation, webhook subscriptions, and SharePoint storage use the server-side application identity. Mail and calendar endpoints still require an owner-approved individual mailbox mapping, so activity is created or sent from that person’s Mefford mailbox and is audited under that person.

## 2. Entra app registration

Create one app registration in the Mefford Microsoft 365 tenant.

| Setting | Required value |
| --- | --- |
| Name | `Mefford Command Center` |
| Supported account types | Accounts in this organizational directory only (single tenant) |
| Platform | Web |
| Redirect URI | `https://mefford-project-command.mefford-project-command.workers.dev/api/microsoft-auth/callback` (will change if/when a custom domain is added — update here and in the app registration if so) |
| Implicit grant / hybrid flow | Off |
| Public client flows | Off |
| Client type | Confidential web application |

Do not register `localhost`, a wildcard callback, `/api/auth/callback`, or the Site home page as the production redirect. The code rejects any configured redirect URI that does not exactly match the value above.

Create a client secret for the server runtime. Record its expiration in IT’s secret-rotation calendar. Never place the secret value in chat, source code, a client component, a `NEXT_PUBLIC_*` variable, or browser storage.

## 3. Graph permissions expected by the current code

### Delegated permissions — identity proof only

| Permission | Why the code needs it |
| --- | --- |
| OpenID scopes `openid`, `profile`, `email` | Complete the single-tenant sign-in and identify the account. |
| `User.Read` | Call `/me` and verify the immutable Entra object ID and mailbox address against the Owner-approved grant. |

The callback does not request `offline_access`, `Mail.*`, `Calendars.*`, or SharePoint delegated scopes. It stores no delegated tokens.

### Application permissions — background and operational Graph calls

| Permission | Current code path |
| --- | --- |
| `User.Read.All` | Hourly/on-demand `/users` directory reconciliation. |
| `Mail.ReadWrite` | Read folders/messages; create folders; mark, move, and manage approved users’ mailbox items. |
| `Mail.Send` | Send from the owner-approved individual mailbox and retain the provider receipt. |
| `Calendars.ReadWrite` | Read calendar views; create/update/delete events; create Outlook invitations and Teams-enabled calendar events; subscribe to event changes. |
| `Sites.Selected` | Create folders and copy files only inside the specifically granted Mefford SharePoint site. Grant this app `write` on that one site after admin consent. Do not substitute tenant-wide `Sites.ReadWrite.All` unless a documented exception is approved by Jordan. |
| `OnlineMeetings.Read.All` | Resolve a Teams online meeting by organizer and join URL. |
| `OnlineMeetingArtifact.Read.All` | Read attendance artifacts for controlled meeting evidence. |
| `OnlineMeetingTranscript.Read.All` | Detect/read meeting transcript evidence. |

All application permissions require administrator consent. Application permissions to mailbox/calendar data are tenant-wide unless Microsoft-side scoping is applied. Before live use, restrict the service principal to approved Mefford mailboxes with Exchange application RBAC (or the current Microsoft-supported equivalent), and apply the required Teams application-access policy to only approved organizers. Command Center’s internal owner grant is an additional control; it is not a substitute for Microsoft-side least privilege.

## 4. Exact server-side environment variable names

Enter these in the Site’s protected server runtime settings. Values marked **secret** must never be exposed client-side.

### Core tenant and Entra proof

| Variable | Classification | Value / purpose |
| --- | --- | --- |
| `MICROSOFT_GRAPH_TENANT_ID` | Configuration | Mefford tenant ID GUID. Used in tenant-specific authorize and token URLs; `common` and `organizations` are not accepted as the intended setup. |
| `MICROSOFT_GRAPH_CLIENT_ID` | Configuration | Entra application/client ID GUID. |
| `MICROSOFT_GRAPH_CLIENT_SECRET` | **Secret** | Entra client secret value, not its secret ID. Used only on the server for token exchange and client credentials. |
| `MICROSOFT_GRAPH_REDIRECT_URI` | Configuration | Exactly `https://mefford-project-command.mefford-project-command.workers.dev/api/microsoft-auth/callback`. |
| `MICROSOFT_GRAPH_AUTH_STATE_KEY` | **Secret** | Base64url-encoded 32-byte random key used to AES-GCM encrypt the short-lived PKCE verifier/state cookie. Generate outside chat and store only in protected runtime settings. |
| `MICROSOFT_ENTRA_PROOF_REQUIRED` | Control switch | Start with `false`. Change to `true` only after Jordan and Blain have both completed identity proof and the access smoke test has passed. |
| `MICROSOFT_ACCESS_CONTROL_ENFORCED` | Control switch | Start with `false`. Change to `true` only after directory reconciliation, owner grants, disable/re-enable testing, and rollback validation pass. |

### Outlook, Teams, and webhook operations

| Variable | Classification | Value / purpose |
| --- | --- | --- |
| `MICROSOFT_MEETINGS_MAILBOX` | Configuration | Fallback organizer only for unattended meeting/subscription work. Use an explicitly approved Mefford mailbox; person-initiated actions use the actor’s owner-approved mapping. |
| `MICROSOFT_OPERATIONAL_MAILBOX` | Configuration | Fallback sender for unattended operational notices. Person-initiated email uses the actor’s owner-approved mailbox. |
| `MICROSOFT_GRAPH_WEBHOOK_URL` | Configuration | `https://mefford-project-command.mefford-project-command.workers.dev/api/meetings/microsoft-webhook` |
| `MICROSOFT_GRAPH_WEBHOOK_CLIENT_STATE` | **Secret** | Unique high-entropy Graph subscription client-state secret. Do not reuse the client secret or authentication-state key. |

### SharePoint mapping and activation

| Variable | Classification | Value / purpose |
| --- | --- | --- |
| `MICROSOFT_SHAREPOINT_SITE_ID` | Configuration | Graph site ID for the approved Mefford Command Center site. |
| `MICROSOFT_SHAREPOINT_ESTIMATES_DRIVE_ID` | Configuration | Document-library drive ID for estimates. |
| `MICROSOFT_SHAREPOINT_ESTIMATES_ROOT_ITEM_ID` | Configuration | Approved estimates root item ID. |
| `MICROSOFT_SHAREPOINT_PROJECTS_DRIVE_ID` | Configuration | Document-library drive ID for projects. |
| `MICROSOFT_SHAREPOINT_PROJECTS_ROOT_ITEM_ID` | Configuration | Approved projects root item ID. |
| `MICROSOFT_SHAREPOINT_PEOPLE_DRIVE_ID` | Configuration | Restricted people/employee document-library drive ID. |
| `MICROSOFT_SHAREPOINT_PEOPLE_ROOT_ITEM_ID` | Configuration | Approved employee root item ID. |
| `MICROSOFT_SHAREPOINT_TEMPLATES_DRIVE_ID` | Configuration | Controlled company-templates document-library drive ID. |
| `MICROSOFT_SHAREPOINT_TEMPLATES_ROOT_ITEM_ID` | Configuration | Approved templates root item ID. |
| `MICROSOFT_SHAREPOINT_DRIVE_ID` | Optional fallback | A common drive only if all four workspace types intentionally share one drive. Specific values above take precedence. |
| `MICROSOFT_SHAREPOINT_ROOT_ITEM_ID` | Optional fallback | A common root only if all four workspace types intentionally share one root. Specific values above take precedence. |
| `MICROSOFT_SHAREPOINT_MODE` | Control switch | Leave unset/`Mapping Pending` initially. First owner-approved live mode must be `Copy Only`. `Dual Store` and `SharePoint Primary` require later evidence and owner approval. |
| `MICROSOFT_SHAREPOINT_PERMISSION_POLICY_VERIFIED` | Control switch | Leave `false` until IT tests library inheritance and every restricted group outside Command Center. Then set `true`. |

The SharePoint adapter has no delete operation. It never deletes the Command Center R2 source, uses conflict behavior `fail`, and does not silently overwrite. Enabling Graph credentials alone does not activate SharePoint provisioning.

## 5. Exact authentication flow

1. The private Site authenticates Jordan or Blain and provides the server-only authenticated-user headers.
2. Command Center canonicalizes Jordan’s current Site identity (`djmeff22@gmail.com`) to `jmefford@meffcon.com`.
3. Server code confirms the Microsoft directory account exists, is enabled/present, and has an Owner-approved Command Center grant.
4. The user opens `GET /api/microsoft-auth/start`.
5. The server generates a random state and PKCE verifier, stores only the SHA-256 state hash in D1, and puts the verifier/state in a 10-minute AES-GCM encrypted `HttpOnly; Secure; SameSite=Lax` cookie.
6. The server redirects to the tenant-specific `/oauth2/v2.0/authorize` endpoint with authorization code flow, PKCE `S256`, exact redirect URI, and only `openid profile email User.Read`.
7. Microsoft returns to the exact callback. The server binds the response to the Site-authenticated actor, validates the encrypted cookie, validates the one-time unexpired D1 transaction, and exchanges the code server-to-server using the PKCE verifier and client secret.
8. The server calls Graph `/me` and requires both the immutable object ID and email address to equal the Owner-approved directory record.
9. The server records only the identity proof, tenant ID, timestamps, and audit evidence. Delegated access and refresh tokens are discarded and never stored or sent to the browser.
10. Outlook/Teams/SharePoint operations continue through server-only client credentials. Every person-specific action must first pass the Owner-approved identity mapping; activity is attributed to that person’s Mefford mailbox.

## 6. Safe activation order

1. Register the single-tenant app and exact Web redirect.
2. Add delegated `User.Read`; add the application permissions above; grant admin consent.
3. Apply Microsoft-side Exchange and Teams application-access restrictions.
4. Grant `Sites.Selected` write access to only the approved Mefford SharePoint site.
5. Add protected server environment values. Keep both enforcement switches `false`; keep SharePoint in `Mapping Pending`.
6. Run Microsoft directory reconciliation. Confirm no user received access automatically.
7. Jordan approves Jordan and Blain by immutable Microsoft object ID.
8. Jordan and Blain each visit `/api/microsoft-auth/start` and sign in with their own Mefford Microsoft account.
9. Smoke-test directory paging, Jordan mail send/read/write, Blain mail send/read/write, calendar creation/deletion, a Teams invite/join link, subscription validation, and audit receipts.
10. Test disabling one Microsoft account: the next reconciliation must block it; re-enabling must not restore access without Jordan’s reapproval.
11. Set `MICROSOFT_ENTRA_PROOF_REQUIRED=true`. Re-test both accounts and rollback by returning it to `false` if either fails.
12. Set `MICROSOFT_ACCESS_CONTROL_ENFORCED=true` only after the access gate passes. Do not change the Site’s Jordan/Blain private access policy during this step.
13. Map SharePoint IDs, verify external library permissions, set `MICROSOFT_SHAREPOINT_PERMISSION_POLICY_VERIFIED=true`, then start with `MICROSOFT_SHAREPOINT_MODE=Copy Only`.
14. Confirm copied file hash/size/evidence while the Command Center source remains intact. Do not promote SharePoint to a primary source until a separate owner-approved test proves bidirectional mapping and rollback.

## 7. Stop conditions

Stop and leave the integration unverified if any of these occur:

- Microsoft accepts a personal account, guest account, wrong tenant, wrong object ID, or wrong mailbox.
- A new Microsoft 365 user receives Command Center access without an Owner decision.
- Jordan’s action is sent as Blain, Blain’s action is sent as Jordan, or either is sent as a generic Command Center mailbox.
- Microsoft-side application permissions can reach mailboxes or sites outside the approved scope.
- The webhook accepts an incorrect or missing client-state secret.
- SharePoint overwrites a conflict, removes the R2 source, exposes HR/benefit/payroll files to a project group, or marks a copy verified without provider evidence.
- Health shows `Live` before the related smoke tests and provider receipts exist.

## 8. Secret handling

Blain should enter secret values directly into protected Site runtime settings. Do not send them to Jordan in email or chat. Store the recovery record in the company-approved password/secret manager, with owner, creation date, expiry, rotation date, and the app registration object ID. Rotate a suspected or exposed secret immediately and repeat the smoke tests before returning the integration to verified status.
