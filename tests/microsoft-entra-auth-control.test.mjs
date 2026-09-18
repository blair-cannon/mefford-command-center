import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [entra, startRoute, callbackRoute, access, graph, runtime, guide, outlookUi, accessUi] = await Promise.all([
  readFile(new URL("../lib/microsoft-entra-auth.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/microsoft-auth/start/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/microsoft-auth/callback/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/microsoft-access-server.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/microsoft-graph.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/integration-runtime.ts", import.meta.url), "utf8"),
  readFile(new URL("../docs/MICROSOFT_ENTRA_GRAPH_SETUP.md", import.meta.url), "utf8"),
  readFile(new URL("../app/employee-outlook-center.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/microsoft-access-center.tsx", import.meta.url), "utf8"),
]);

test("single-tenant Entra proof uses the exact production callback and authorization code PKCE", () => {
  assert.match(entra, /https:\/\/mefford-project-command\.mefford-project-command\.workers\.dev\/api\/microsoft-auth\/callback/);
  assert.match(entra, /login\.microsoftonline\.com\/\$\{encodeURIComponent\(config\.tenantId\)\}\/oauth2\/v2\.0\/authorize/);
  assert.doesNotMatch(entra, /login\.microsoftonline\.com\/(common|organizations|consumers)/);
  assert.match(entra, /response_type:\s*"code"/);
  assert.match(entra, /code_challenge_method:\s*"S256"/);
  assert.match(entra, /grant_type:\s*"authorization_code"/);
  assert.match(entra, /code_verifier:\s*cookie\.verifier/);
  assert.match(entra, /MICROSOFT_GRAPH_REDIRECT_URI/);
});

// Since the ChatGPT Sites access-policy header no longer exists on the
// self-hosted deployment, the state cookie can no longer be bound to an
// already-known actor — nobody is known until Microsoft's own callback says
// who signed in. It is still one-time, encrypted, and short-lived.
test("state is one-time encrypted and short lived", () => {
  assert.match(entra, /AUTH_LIFETIME_SECONDS = 10 \* 60/);
  assert.match(entra, /sha256Hex\(state\)/);
  assert.match(entra, /AES-GCM/);
  assert.match(entra, /HttpOnly; Secure; SameSite=Lax/);
  assert.match(entra, /consumed_at/);
  assert.match(entra, /WHERE state_hash = \? AND consumed_at = ''/);
  assert.match(entra, /consumedChanges !== 1/);
  assert.match(startRoute, /Cache-Control/);
  assert.match(callbackRoute, /Referrer-Policy/);
});

// Entra's callback now only proves *who* signed in (there is no pre-approved
// identity to compare it against anymore — that was only possible when Sites
// supplied a known actor before the Microsoft round trip). Authorization is
// decided after the fact, by authorizeVerifiedMicrosoftIdentity, strictly
// from the verified email/object ID: unregistered or inactive company
// members are rejected, and anyone else needs an owner-approved
// microsoft_access_grants row (or the owner-bootstrap exception while
// enforcement is off) before a login session is ever issued.
test("identity proof cannot bypass the owner-approved immutable Microsoft mapping", () => {
  assert.doesNotMatch(startRoute, /resolveCommandActor|approvedMicrosoftIdentityForActor/);
  assert.match(callbackRoute, /authorizeVerifiedMicrosoftIdentity/);
  assert.match(callbackRoute, /authorization\.allowed/);
  assert.match(callbackRoute, /redirectToApp\("not-approved"/);
  assert.doesNotMatch(callbackRoute, /Response\.json/);
  assert.match(access, /export async function authorizeVerifiedMicrosoftIdentity/);
  assert.match(access, /FROM company_members WHERE lower\(email\) = \?/);
  assert.match(access, /Unregistered/);
  assert.match(access, /Inactive/);
  assert.match(access, /accessStatusAllowsSignIn/);
  assert.match(entra, /issueCommandSessionCookie/);
  assert.match(callbackRoute, /issueCommandSessionCookie/);
  assert.match(access, /microsoftEntraProofStatus/);
  assert.match(access, /MICROSOFT Identity Is Not Authorized|Microsoft Identity Is Not Authorized/);
  assert.match(access, /MICROSOFT_ENTRA_PROOF_REQUIRED|proof\.required/);
});

test("delegated proof requests minimum identity scopes and retains no delegated tokens", () => {
  for (const scope of ["openid", "profile", "email", "User.Read"]) assert.match(entra, new RegExp(`"${scope.replace(".", "\\.")}"`));
  for (const scope of ["offline_access", "Mail.ReadWrite", "Mail.Send", "Calendars.ReadWrite", "Sites.ReadWrite.All"]) {
    assert.doesNotMatch(entra, new RegExp(`"${scope.replaceAll(".", "\\.")}"`));
  }
  assert.doesNotMatch(entra, /refresh_token/);
  assert.doesNotMatch(entra, /encrypted_access_token|encrypted_refresh_token/);
  assert.match(entra, /No delegated access or refresh tokens are retained/);
});

test("client secret and authentication-state key remain server-only", () => {
  assert.match(entra, /MICROSOFT_GRAPH_CLIENT_SECRET/);
  assert.match(entra, /MICROSOFT_GRAPH_AUTH_STATE_KEY/);
  assert.doesNotMatch(outlookUi, /MICROSOFT_GRAPH_CLIENT_SECRET|MICROSOFT_GRAPH_AUTH_STATE_KEY|NEXT_PUBLIC_MICROSOFT/);
  assert.doesNotMatch(accessUi, /MICROSOFT_GRAPH_CLIENT_SECRET|MICROSOFT_GRAPH_AUTH_STATE_KEY|NEXT_PUBLIC_MICROSOFT/);
  assert.match(startRoute, /beginMicrosoftEntraAuthorization/);
  assert.match(callbackRoute, /completeMicrosoftEntraAuthorization/);
});

test("application Graph remains server-side and health requires the new auth contract", () => {
  assert.match(graph, /grant_type:\s*"client_credentials"/);
  assert.match(graph, /scope:\s*"https:\/\/graph\.microsoft\.com\/\.default"/);
  for (const variable of [
    "MICROSOFT_GRAPH_TENANT_ID",
    "MICROSOFT_GRAPH_CLIENT_ID",
    "MICROSOFT_GRAPH_CLIENT_SECRET",
    "MICROSOFT_GRAPH_REDIRECT_URI",
    "MICROSOFT_GRAPH_AUTH_STATE_KEY",
  ]) assert.match(runtime, new RegExp(variable));
});

test("Blain handoff documents exact least-privilege permissions and activation controls", () => {
  for (const permission of [
    "User.Read.All",
    "Mail.ReadWrite",
    "Mail.Send",
    "Calendars.ReadWrite",
    "Sites.Selected",
    "OnlineMeetings.Read.All",
    "OnlineMeetingArtifact.Read.All",
    "OnlineMeetingTranscript.Read.All",
  ]) assert.match(guide, new RegExp(permission.replaceAll(".", "\\.")));
  assert.match(guide, /MICROSOFT_ENTRA_PROOF_REQUIRED/);
  assert.match(guide, /MICROSOFT_ACCESS_CONTROL_ENFORCED/);
  assert.match(guide, /MICROSOFT_SHAREPOINT_MODE=Copy Only/);
  assert.match(guide, /never grants Command Center access/i);
});
