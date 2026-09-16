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
  assert.match(entra, /https:\/\/mefford-project-command\.jordan-mefor-1272\.chatgpt\.site\/api\/microsoft-auth\/callback/);
  assert.match(entra, /login\.microsoftonline\.com\/\$\{encodeURIComponent\(config\.tenantId\)\}\/oauth2\/v2\.0\/authorize/);
  assert.doesNotMatch(entra, /login\.microsoftonline\.com\/(common|organizations|consumers)/);
  assert.match(entra, /response_type:\s*"code"/);
  assert.match(entra, /code_challenge_method:\s*"S256"/);
  assert.match(entra, /grant_type:\s*"authorization_code"/);
  assert.match(entra, /code_verifier:\s*cookie\.verifier/);
  assert.match(entra, /MICROSOFT_GRAPH_REDIRECT_URI/);
});

test("state is one-time actor-bound encrypted and short lived", () => {
  assert.match(entra, /AUTH_LIFETIME_SECONDS = 10 \* 60/);
  assert.match(entra, /sha256Hex\(state\)/);
  assert.match(entra, /AES-GCM/);
  assert.match(entra, /HttpOnly; Secure; SameSite=Lax/);
  assert.match(entra, /actor_email !== actor\.email\.toLowerCase\(\)/);
  assert.match(entra, /consumed_at/);
  assert.match(entra, /WHERE state_hash = \? AND consumed_at = ''/);
  assert.match(entra, /consumedChanges !== 1/);
  assert.match(startRoute, /Cache-Control/);
  assert.match(callbackRoute, /Referrer-Policy/);
});

test("identity proof cannot bypass the owner-approved immutable Microsoft mapping", () => {
  assert.match(startRoute, /approvedMicrosoftIdentityForActor/);
  assert.match(callbackRoute, /approvedMicrosoftIdentityForActor/);
  assert.match(entra, /profile\.id !== identity\.providerSubject/);
  assert.match(entra, /verifiedEmail !== identity\.microsoftEmail\.toLowerCase\(\)/);
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
