import type { CommandActor } from "./server-actor";

export const MICROSOFT_ENTRA_REDIRECT_URI =
  "https://mefford-project-command.jordan-mefor-1272.chatgpt.site/api/microsoft-auth/callback";

export const MICROSOFT_ENTRA_DELEGATED_SCOPES = [
  "openid",
  "profile",
  "email",
  "User.Read",
] as const;

type Statement = {
  bind: (...values: unknown[]) => Statement;
  first: <T>() => Promise<T | null>;
  run: () => Promise<{ meta?: { changes?: number } } | unknown>;
};

type Database = {
  prepare: (query: string) => Statement;
  batch: (statements: Statement[]) => Promise<unknown>;
};

type ApprovedIdentity = {
  microsoftEmail: string;
  providerSubject: string;
};

type AuthConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  stateKey: string;
};

type AuthTransaction = {
  state_hash: string;
  actor_email: string;
  provider_subject: string;
  microsoft_email: string;
  expires_at: string;
  consumed_at: string;
};

type IdentityProof = {
  provider_subject: string;
  command_actor_email: string;
  microsoft_email: string;
  tenant_id: string;
  verified_at: string;
  last_verified_at: string;
  revoked_at: string;
};

const AUTH_COOKIE = "mefford_microsoft_auth";
const AUTH_LIFETIME_SECONDS = 10 * 60;

export async function ensureMicrosoftEntraAuthSchema(database?: Database) {
  const db = database || await authDatabase();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS microsoft_entra_auth_transactions (
      state_hash text PRIMARY KEY NOT NULL,
      actor_email text NOT NULL,
      provider_subject text NOT NULL,
      microsoft_email text NOT NULL,
      expires_at text NOT NULL,
      consumed_at text NOT NULL DEFAULT '',
      outcome text NOT NULL DEFAULT 'Started',
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS microsoft_entra_auth_expiry_idx ON microsoft_entra_auth_transactions (expires_at, consumed_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS microsoft_entra_identity_proofs (
      provider_subject text PRIMARY KEY NOT NULL,
      command_actor_email text NOT NULL,
      microsoft_email text NOT NULL,
      tenant_id text NOT NULL,
      auth_method text NOT NULL DEFAULT 'Authorization Code + PKCE',
      verified_at text NOT NULL,
      last_verified_at text NOT NULL,
      revoked_at text NOT NULL DEFAULT '',
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS microsoft_entra_identity_actor_idx ON microsoft_entra_identity_proofs (command_actor_email)`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS microsoft_entra_identity_email_idx ON microsoft_entra_identity_proofs (microsoft_email)`),
  ]);
}

export async function microsoftEntraAuthConnection() {
  const values = await authEnvironment();
  const config = authConfig(values);
  const redirectValue = clean(values.MICROSOFT_GRAPH_REDIRECT_URI);
  const required = clean(values.MICROSOFT_ENTRA_PROOF_REQUIRED).toLowerCase() === "true";
  const missing = [
    "MICROSOFT_GRAPH_TENANT_ID",
    "MICROSOFT_GRAPH_CLIENT_ID",
    "MICROSOFT_GRAPH_CLIENT_SECRET",
    "MICROSOFT_GRAPH_REDIRECT_URI",
    "MICROSOFT_GRAPH_AUTH_STATE_KEY",
  ].filter((key) => !clean(values[key]));
  const tenantId = clean(values.MICROSOFT_GRAPH_TENANT_ID);
  const clientId = clean(values.MICROSOFT_GRAPH_CLIENT_ID);
  const stateKey = clean(values.MICROSOFT_GRAPH_AUTH_STATE_KEY);
  if (tenantId && !validGuid(tenantId)) missing.push("MICROSOFT_GRAPH_TENANT_ID must be the Mefford tenant GUID");
  if (clientId && !validGuid(clientId)) missing.push("MICROSOFT_GRAPH_CLIENT_ID must be the Entra application GUID");
  if (stateKey && !validStateKey(stateKey)) missing.push("MICROSOFT_GRAPH_AUTH_STATE_KEY must be a base64url-encoded 32-byte key");
  if (redirectValue && redirectValue !== MICROSOFT_ENTRA_REDIRECT_URI) {
    missing.push(`MICROSOFT_GRAPH_REDIRECT_URI must exactly equal ${MICROSOFT_ENTRA_REDIRECT_URI}`);
  }
  return {
    configured: Boolean(config),
    required,
    redirectUri: MICROSOFT_ENTRA_REDIRECT_URI,
    authorizationFlow: "Single-Tenant Authorization Code + PKCE",
    delegatedScopes: [...MICROSOFT_ENTRA_DELEGATED_SCOPES],
    tokenStorage: "No delegated access or refresh tokens are retained",
    missing,
  };
}

export async function microsoftEntraProofStatus(actor: CommandActor, identity: ApprovedIdentity) {
  const connection = await microsoftEntraAuthConnection();
  const db = await authDatabase();
  await ensureMicrosoftEntraAuthSchema(db);
  const proof = await db.prepare(`SELECT * FROM microsoft_entra_identity_proofs
    WHERE provider_subject = ? AND lower(command_actor_email) = ? AND lower(microsoft_email) = ? LIMIT 1`)
    .bind(identity.providerSubject, actor.email.toLowerCase(), identity.microsoftEmail.toLowerCase())
    .first<IdentityProof>();
  const verified = Boolean(
    proof
    && !proof.revoked_at
    && proof.tenant_id === clean((await authEnvironment()).MICROSOFT_GRAPH_TENANT_ID),
  );
  return {
    ...connection,
    verified,
    verifiedAt: verified ? proof?.last_verified_at || proof?.verified_at || "" : "",
    microsoftEmail: identity.microsoftEmail,
    connectUrl: "/api/microsoft-auth/start",
  };
}

export async function beginMicrosoftEntraAuthorization(actor: CommandActor, identity: ApprovedIdentity) {
  const values = await authEnvironment();
  const config = authConfig(values);
  if (!config) throw new MicrosoftEntraAuthError("Microsoft Entra authentication is not fully configured", 503);
  const db = await authDatabase();
  await ensureMicrosoftEntraAuthSchema(db);
  const state = randomBase64Url(32);
  const verifier = randomBase64Url(64);
  const challenge = await sha256Base64Url(verifier);
  const stateHash = await sha256Hex(state);
  const expiresAt = new Date(Date.now() + AUTH_LIFETIME_SECONDS * 1_000).toISOString();
  await db.batch([
    db.prepare(`DELETE FROM microsoft_entra_auth_transactions WHERE expires_at < ?`).bind(new Date().toISOString()),
    db.prepare(`INSERT INTO microsoft_entra_auth_transactions
      (state_hash, actor_email, provider_subject, microsoft_email, expires_at, consumed_at, outcome)
      VALUES (?, ?, ?, ?, ?, '', 'Started')`)
      .bind(stateHash, actor.email.toLowerCase(), identity.providerSubject, identity.microsoftEmail.toLowerCase(), expiresAt),
  ]);
  const cookiePayload = await encryptCookie(config.stateKey, {
    state,
    verifier,
    actorEmail: actor.email.toLowerCase(),
    expiresAt,
  });
  const url = new URL(`https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/authorize`);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.redirectUri,
    response_mode: "query",
    scope: MICROSOFT_ENTRA_DELEGATED_SCOPES.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
    login_hint: identity.microsoftEmail,
  }).toString();
  return {
    authorizationUrl: url.toString(),
    cookie: `${AUTH_COOKIE}=${cookiePayload}; Path=/api/microsoft-auth/callback; Max-Age=${AUTH_LIFETIME_SECONDS}; HttpOnly; Secure; SameSite=Lax`,
  };
}

export async function completeMicrosoftEntraAuthorization(request: Request, actor: CommandActor, identity: ApprovedIdentity) {
  const values = await authEnvironment();
  const config = authConfig(values);
  if (!config) throw new MicrosoftEntraAuthError("Microsoft Entra authentication is not fully configured", 503);
  const requestUrl = new URL(request.url);
  const providerError = clean(requestUrl.searchParams.get("error"));
  if (providerError) throw new MicrosoftEntraAuthError("Microsoft sign-in was cancelled or denied", 400);
  const code = clean(requestUrl.searchParams.get("code"));
  const state = clean(requestUrl.searchParams.get("state"));
  if (!code || !state) throw new MicrosoftEntraAuthError("Microsoft sign-in response is incomplete", 400);
  const cookieValue = readCookie(request.headers.get("cookie"), AUTH_COOKIE);
  if (!cookieValue) throw new MicrosoftEntraAuthError("Microsoft sign-in state cookie is missing", 400);
  const cookie = await decryptCookie(config.stateKey, cookieValue);
  if (
    cookie.state !== state
    || cookie.actorEmail !== actor.email.toLowerCase()
    || new Date(cookie.expiresAt).getTime() <= Date.now()
  ) {
    throw new MicrosoftEntraAuthError("Microsoft sign-in state validation failed", 400);
  }
  const db = await authDatabase();
  await ensureMicrosoftEntraAuthSchema(db);
  const stateHash = await sha256Hex(state);
  const transaction = await db.prepare(`SELECT * FROM microsoft_entra_auth_transactions WHERE state_hash = ? LIMIT 1`)
    .bind(stateHash).first<AuthTransaction>();
  if (
    !transaction
    || transaction.consumed_at
    || transaction.actor_email !== actor.email.toLowerCase()
    || transaction.provider_subject !== identity.providerSubject
    || transaction.microsoft_email !== identity.microsoftEmail.toLowerCase()
    || new Date(transaction.expires_at).getTime() <= Date.now()
  ) {
    throw new MicrosoftEntraAuthError("Microsoft sign-in transaction is invalid or expired", 400);
  }
  const consumedAt = new Date().toISOString();
  const consumeResult = await db.prepare(`UPDATE microsoft_entra_auth_transactions
    SET consumed_at = ?, outcome = 'Exchanging', updated_at = ?
    WHERE state_hash = ? AND consumed_at = ''`)
    .bind(consumedAt, consumedAt, stateHash).run();
  const consumedChanges = Number((consumeResult as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 1);
  if (consumedChanges !== 1) throw new MicrosoftEntraAuthError("Microsoft sign-in transaction was already consumed", 400);

  const tokenResponse = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: config.redirectUri,
        code_verifier: cookie.verifier,
        scope: MICROSOFT_ENTRA_DELEGATED_SCOPES.join(" "),
      }),
    },
  );
  const token = await tokenResponse.json().catch(() => ({})) as { access_token?: string; error_description?: string };
  if (!tokenResponse.ok || !token.access_token) {
    await markOutcome(db, stateHash, "Token Exchange Failed");
    throw new MicrosoftEntraAuthError(token.error_description || "Microsoft token exchange failed", 502);
  }
  const profileResponse = await fetch("https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName", {
    headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/json" },
  });
  const profile = await profileResponse.json().catch(() => ({})) as {
    id?: string;
    displayName?: string;
    mail?: string;
    userPrincipalName?: string;
    error?: { message?: string };
  };
  if (!profileResponse.ok || !profile.id) {
    await markOutcome(db, stateHash, "Profile Verification Failed");
    throw new MicrosoftEntraAuthError(profile.error?.message || "Microsoft profile verification failed", 502);
  }
  const verifiedEmail = clean(profile.mail || profile.userPrincipalName).toLowerCase();
  if (profile.id !== identity.providerSubject || verifiedEmail !== identity.microsoftEmail.toLowerCase()) {
    await markOutcome(db, stateHash, "Approved Identity Mismatch");
    throw new MicrosoftEntraAuthError("Signed-in Microsoft account does not match the owner-approved identity", 403);
  }
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT INTO microsoft_entra_identity_proofs
      (provider_subject, command_actor_email, microsoft_email, tenant_id, auth_method, verified_at, last_verified_at, revoked_at, updated_at)
      VALUES (?, ?, ?, ?, 'Authorization Code + PKCE', ?, ?, '', ?)
      ON CONFLICT(provider_subject) DO UPDATE SET
        command_actor_email = excluded.command_actor_email,
        microsoft_email = excluded.microsoft_email,
        tenant_id = excluded.tenant_id,
        auth_method = excluded.auth_method,
        last_verified_at = excluded.last_verified_at,
        revoked_at = '',
        updated_at = excluded.updated_at`)
      .bind(identity.providerSubject, actor.email.toLowerCase(), identity.microsoftEmail.toLowerCase(), config.tenantId, now, now, now),
    db.prepare(`UPDATE microsoft_entra_auth_transactions SET outcome = 'Verified', updated_at = ? WHERE state_hash = ?`)
      .bind(now, stateHash),
  ]);
  return {
    verified: true,
    microsoftEmail: identity.microsoftEmail,
    providerSubject: identity.providerSubject,
    tenantId: config.tenantId,
    verifiedAt: now,
    clearCookie: `${AUTH_COOKIE}=; Path=/api/microsoft-auth/callback; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
  };
}

export class MicrosoftEntraAuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function authConfig(values: Record<string, unknown>): AuthConfig | null {
  const config = {
    tenantId: clean(values.MICROSOFT_GRAPH_TENANT_ID),
    clientId: clean(values.MICROSOFT_GRAPH_CLIENT_ID),
    clientSecret: clean(values.MICROSOFT_GRAPH_CLIENT_SECRET),
    redirectUri: clean(values.MICROSOFT_GRAPH_REDIRECT_URI),
    stateKey: clean(values.MICROSOFT_GRAPH_AUTH_STATE_KEY),
  };
  if (
    !Object.values(config).every(Boolean)
    || !validGuid(config.tenantId)
    || !validGuid(config.clientId)
    || !validStateKey(config.stateKey)
    || config.redirectUri !== MICROSOFT_ENTRA_REDIRECT_URI
  ) return null;
  return config;
}

async function authEnvironment() {
  const { env } = await import("cloudflare:workers");
  return env as unknown as Record<string, unknown>;
}

async function authDatabase() {
  const values = await authEnvironment();
  return values.DB as Database;
}

async function markOutcome(db: Database, stateHash: string, outcome: string) {
  await db.prepare(`UPDATE microsoft_entra_auth_transactions SET outcome = ?, updated_at = ? WHERE state_hash = ?`)
    .bind(outcome, new Date().toISOString(), stateHash).run();
}

function randomBase64Url(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function sha256Base64Url(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function encryptCookie(keyValue: string, value: Record<string, string>) {
  const key = await importStateKey(keyValue);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return `${base64Url(iv)}.${base64Url(new Uint8Array(ciphertext))}`;
}

async function decryptCookie(keyValue: string, value: string) {
  try {
    const [ivValue, ciphertextValue] = value.split(".");
    if (!ivValue || !ciphertextValue) throw new Error("Invalid encrypted cookie");
    const key = await importStateKey(keyValue);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64Url(ivValue) },
      key,
      fromBase64Url(ciphertextValue),
    );
    const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as Record<string, unknown>;
    const result = {
      state: clean(parsed.state),
      verifier: clean(parsed.verifier),
      actorEmail: clean(parsed.actorEmail).toLowerCase(),
      expiresAt: clean(parsed.expiresAt),
    };
    if (!Object.values(result).every(Boolean)) throw new Error("Incomplete encrypted cookie");
    return result;
  } catch {
    throw new MicrosoftEntraAuthError("Microsoft sign-in state cookie could not be verified", 400);
  }
}

async function importStateKey(value: string) {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64Url(value);
  } catch {
    throw new MicrosoftEntraAuthError("MICROSOFT_GRAPH_AUTH_STATE_KEY must be a base64url-encoded 32-byte key", 503);
  }
  if (bytes.byteLength !== 32) {
    throw new MicrosoftEntraAuthError("MICROSOFT_GRAPH_AUTH_STATE_KEY must be a base64url-encoded 32-byte key", 503);
  }
  const rawKey = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function validGuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validStateKey(value: string) {
  try {
    return fromBase64Url(value).byteLength === 32;
  } catch {
    return false;
  }
}

function readCookie(header: string | null, name: string) {
  for (const item of (header || "").split(";")) {
    const [key, ...parts] = item.trim().split("=");
    if (key === name) return parts.join("=");
  }
  return "";
}

function clean(value: unknown) {
  return String(value || "").trim();
}
