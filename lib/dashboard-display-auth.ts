const DISPLAY_EMAIL = "dashboards@meffcon.com";
const DISPLAY_COOKIE = "mefford_dashboard_session";
const PBKDF2_ITERATIONS = 100_000;
const SESSION_DAYS = 30;
const LOGIN_WINDOW_MINUTES = 15;
const MAX_LOGIN_FAILURES = 10;

export { DISPLAY_EMAIL, PBKDF2_ITERATIONS };

type DisplayCredential = {
  email: string;
  password_salt: string;
  password_hash: string;
  iterations: number;
  updated_at: string;
  updated_by: string;
};

export async function ensureDashboardDisplayTables() {
  const { env } = await import("cloudflare:workers");
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS dashboard_display_credentials (
      email text PRIMARY KEY NOT NULL,
      password_salt text NOT NULL,
      password_hash text NOT NULL,
      iterations integer NOT NULL DEFAULT 100000,
      updated_at text NOT NULL,
      updated_by text NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS dashboard_display_sessions (
      token_hash text PRIMARY KEY NOT NULL,
      email text NOT NULL,
      expires_at text NOT NULL,
      created_at text NOT NULL
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS dashboard_display_sessions_expiry_idx ON dashboard_display_sessions(expires_at)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS dashboard_display_audits (
      id integer PRIMARY KEY AUTOINCREMENT,
      action text NOT NULL,
      actor text NOT NULL,
      detail text NOT NULL DEFAULT '',
      created_at text NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS dashboard_display_login_failures (
      fingerprint_hash text NOT NULL,
      failed_at text NOT NULL
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS dashboard_display_login_failures_lookup_idx ON dashboard_display_login_failures(fingerprint_hash, failed_at)`),
  ]);
}

export async function dashboardLoginAllowed(request: Request) {
  await ensureDashboardDisplayTables();
  const { env } = await import("cloudflare:workers");
  const fingerprint = await loginFingerprint(request);
  const cutoff = new Date(Date.now() - LOGIN_WINDOW_MINUTES * 60_000).toISOString();
  const row = await env.DB.prepare(`SELECT COUNT(*) AS failures FROM dashboard_display_login_failures WHERE fingerprint_hash = ? AND failed_at >= ?`)
    .bind(fingerprint, cutoff)
    .first<{ failures: number }>();
  return Number(row?.failures || 0) < MAX_LOGIN_FAILURES;
}

export async function recordDashboardLoginFailure(request: Request) {
  await ensureDashboardDisplayTables();
  const { env } = await import("cloudflare:workers");
  const now = new Date();
  const cutoff = new Date(now.getTime() - LOGIN_WINDOW_MINUTES * 60_000).toISOString();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM dashboard_display_login_failures WHERE failed_at < ?`).bind(cutoff),
    env.DB.prepare(`INSERT INTO dashboard_display_login_failures (fingerprint_hash, failed_at) VALUES (?, ?)`)
      .bind(await loginFingerprint(request), now.toISOString()),
  ]);
}

export async function clearDashboardLoginFailures(request: Request) {
  await ensureDashboardDisplayTables();
  const { env } = await import("cloudflare:workers");
  await env.DB.prepare(`DELETE FROM dashboard_display_login_failures WHERE fingerprint_hash = ?`)
    .bind(await loginFingerprint(request))
    .run();
}

export async function dashboardCredential() {
  await ensureDashboardDisplayTables();
  const { env } = await import("cloudflare:workers");
  return env.DB.prepare(`SELECT email, password_salt, password_hash, iterations, updated_at, updated_by FROM dashboard_display_credentials WHERE email = ? LIMIT 1`)
    .bind(DISPLAY_EMAIL)
    .first<DisplayCredential>();
}

export async function setDashboardPassword(password: string, actor: string) {
  const normalized = normalizePassword(password);
  if (normalized.length < 12) throw new Error("The dashboard password must contain at least 12 characters.");
  if (normalized.length > 256) throw new Error("The dashboard password is too long.");
  await ensureDashboardDisplayTables();
  const { env } = await import("cloudflare:workers");
  const salt = randomToken(24);
  const passwordHash = await pbkdf2(normalized, salt, PBKDF2_ITERATIONS);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO dashboard_display_credentials (email, password_salt, password_hash, iterations, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET password_salt = excluded.password_salt, password_hash = excluded.password_hash, iterations = excluded.iterations, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
      .bind(DISPLAY_EMAIL, salt, passwordHash, PBKDF2_ITERATIONS, now, actor),
    env.DB.prepare(`DELETE FROM dashboard_display_sessions WHERE email = ?`).bind(DISPLAY_EMAIL),
    env.DB.prepare(`INSERT INTO dashboard_display_audits (action, actor, detail, created_at) VALUES ('Password Set Or Reset', ?, 'All prior display sessions revoked', ?)`)
      .bind(actor, now),
  ]);
}

export async function authenticateDashboardPassword(password: string) {
  const credential = await dashboardCredential();
  if (!credential) return false;
  const iterations = Math.min(Math.max(Number(credential.iterations) || PBKDF2_ITERATIONS, 1), PBKDF2_ITERATIONS);
  const candidate = await pbkdf2(normalizePassword(password), credential.password_salt, iterations);
  return constantTimeEqual(candidate, credential.password_hash);
}

export async function createDashboardSession() {
  await ensureDashboardDisplayTables();
  const { env } = await import("cloudflare:workers");
  const token = randomToken(32);
  const hash = await sha256(token);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM dashboard_display_sessions WHERE expires_at <= ?`).bind(createdAt.toISOString()),
    env.DB.prepare(`INSERT INTO dashboard_display_sessions (token_hash, email, expires_at, created_at) VALUES (?, ?, ?, ?)`)
      .bind(hash, DISPLAY_EMAIL, expiresAt.toISOString(), createdAt.toISOString()),
    env.DB.prepare(`INSERT INTO dashboard_display_audits (action, actor, detail, created_at) VALUES ('Display Login', ?, 'Read-only dashboard session created', ?)`)
      .bind(DISPLAY_EMAIL, createdAt.toISOString()),
  ]);
  return { token, expiresAt };
}

export async function validateDashboardSession(request: Request) {
  const token = cookieValue(request, DISPLAY_COOKIE);
  if (!token) return false;
  await ensureDashboardDisplayTables();
  const { env } = await import("cloudflare:workers");
  const hash = await sha256(token);
  const session = await env.DB.prepare(`SELECT email, expires_at FROM dashboard_display_sessions WHERE token_hash = ? AND email = ? LIMIT 1`)
    .bind(hash, DISPLAY_EMAIL)
    .first<{ email: string; expires_at: string }>();
  if (!session || session.expires_at <= new Date().toISOString()) return false;
  return true;
}

export async function revokeDashboardSession(request: Request) {
  const token = cookieValue(request, DISPLAY_COOKIE);
  if (!token) return;
  await ensureDashboardDisplayTables();
  const { env } = await import("cloudflare:workers");
  await env.DB.prepare(`DELETE FROM dashboard_display_sessions WHERE token_hash = ?`).bind(await sha256(token)).run();
}

export function dashboardSessionCookie(request: Request, token: string, expiresAt: Date) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${DISPLAY_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secure}`;
}

export function expiredDashboardSessionCookie(request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${DISPLAY_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function cookieValue(request: Request, name: string) {
  const source = request.headers.get("cookie") || "";
  const entry = source.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  if (!entry) return "";
  try { return decodeURIComponent(entry.slice(name.length + 1)); } catch { return ""; }
}

function normalizePassword(password: string) {
  return String(password || "").normalize("NFKC");
}

async function pbkdf2(password: string, salt: string, iterations: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations }, key, 256);
  return hex(new Uint8Array(bits));
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return hex(new Uint8Array(digest));
}

async function loginFingerprint(request: Request) {
  const address = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const agent = request.headers.get("user-agent") || "unknown";
  return sha256(`${address}\n${agent}`);
}

function randomToken(bytes: number) {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
}

function hex(values: Uint8Array) {
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
