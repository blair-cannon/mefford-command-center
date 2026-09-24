import { accountingGuard } from "./accounting-ledger";
import type { CommandActor } from "./server-actor";

export type PlaidEnvironment = { PLAID_CLIENT_ID?: string; PLAID_SECRET?: string; PLAID_ENV?: string; PLAID_LAYER_TEMPLATE_ID?: string; PLAID_TOKEN_ENCRYPTION_KEY?: string };
export type PlaidItem = { id: string; plaid_item_id: string; environment: string; encrypted_access_token: string; cursor: string; status: string };
type PlaidAccount = { account_id: string; name: string; mask: string | null; type: string; subtype: string | null; balances: { current: number | null; available: number | null; limit: number | null; iso_currency_code: string | null } };
type AccountsResponse = { accounts: PlaidAccount[]; item: { item_id: string; institution_id: string | null } };
type PlaidTransaction = { transaction_id: string; account_id: string; date: string; name: string; amount: number; pending: boolean; iso_currency_code: string | null; pending_transaction_id: string | null };
type SyncPage = { added: PlaidTransaction[]; modified: PlaidTransaction[]; removed: Array<{ transaction_id: string }>; next_cursor: string; has_more: boolean };
export class PlaidFailure extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = "") { super(message); this.status = status; this.code = code; }
}

export function plaidConfiguration(env: PlaidEnvironment) {
  const missing = ["PLAID_CLIENT_ID", "PLAID_SECRET", "PLAID_ENV", "PLAID_TOKEN_ENCRYPTION_KEY"].filter(key => !env[key as keyof PlaidEnvironment]?.trim());
  if (env.PLAID_ENV && !["sandbox", "production"].includes(env.PLAID_ENV)) missing.push("PLAID_ENV must be sandbox or production");
  if (env.PLAID_TOKEN_ENCRYPTION_KEY && !/^[A-Za-z0-9+/]{43}=$/.test(env.PLAID_TOKEN_ENCRYPTION_KEY)) missing.push("PLAID_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  return { configured: missing.length === 0, layerReady: missing.length === 0 && Boolean(env.PLAID_LAYER_TEMPLATE_ID?.trim()), environment: env.PLAID_ENV || "Not configured", missing };
}
export async function plaidRequest<T>(env: PlaidEnvironment, path: string, body: Record<string, unknown>): Promise<T> {
  if (!plaidConfiguration(env).configured) throw new PlaidFailure("Plaid setup is incomplete. Configure the connection in the site environment.", 503);
  let response: Response;
  try {
    response = await fetch(`https://${env.PLAID_ENV}.plaid.com${path}`, {
      method: "POST", headers: { "Content-Type": "application/json", "Plaid-Version": "2020-09-14" },
      body: JSON.stringify({ ...body, client_id: env.PLAID_CLIENT_ID, secret: env.PLAID_SECRET }), signal: AbortSignal.timeout(20000),
    });
  } catch { throw new PlaidFailure("Plaid could not be reached. Please retry.", 502); }
  const data = await response.json() as T & { error_code?: string; request_id?: string };
  if (!response.ok || data.error_code) {
    const code = data.error_code || "PROVIDER_ERROR";
    const message = code === "ITEM_LOGIN_REQUIRED" ? "This connection needs bank authorization again. Select Reconnect." : code === "PRODUCT_NOT_READY" ? "The bank is still preparing transactions. Sync again shortly." : code === "INVALID_CREDENTIALS" || code === "INVALID_API_KEYS" ? "Plaid credentials need to be checked in the site environment." : "Plaid could not complete this request. Please retry or check the Plaid connection settings.";
    throw new PlaidFailure(message, 502, code);
  }
  return data;
}
export async function plaidUserId(email: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`mefford-command-center:${email.toLowerCase()}`));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}
function base64(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)); }
async function encryptionKey(env: PlaidEnvironment) {
  if (!env.PLAID_TOKEN_ENCRYPTION_KEY || !/^[A-Za-z0-9+/]{43}=$/.test(env.PLAID_TOKEN_ENCRYPTION_KEY)) throw new PlaidFailure("Plaid token protection is not configured.", 503);
  return crypto.subtle.importKey("raw", Uint8Array.from(atob(env.PLAID_TOKEN_ENCRYPTION_KEY), char => char.charCodeAt(0)), "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function encryptPlaidToken(env: PlaidEnvironment, value: string, context: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(context) }, await encryptionKey(env), new TextEncoder().encode(value));
  return `v1.${base64(iv)}.${base64(new Uint8Array(encrypted))}`;
}
export async function decryptPlaidToken(env: PlaidEnvironment, value: string, context: string) {
  try {
    const [version, iv, cipher] = value.split(".");
    if (version !== "v1" || !iv || !cipher) throw new Error("Invalid ciphertext");
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: Uint8Array.from(atob(iv), char => char.charCodeAt(0)), additionalData: new TextEncoder().encode(context) }, await encryptionKey(env), Uint8Array.from(atob(cipher), char => char.charCodeAt(0)));
    return new TextDecoder().decode(plain);
  } catch { throw new PlaidFailure("The saved Plaid connection could not be unlocked. Check the token encryption key.", 503); }
}
function cents(value: number | null) { if (value === null) return null; const result = Math.round(value * 100); if (!Number.isFinite(value) || !Number.isSafeInteger(result)) throw new PlaidFailure("Plaid returned an invalid amount.", 502); return result; }
export function plaidTransactionCents(amount: number) { return -(cents(amount) ?? 0); }
const now = () => new Date().toISOString();
function lockGuard(db: D1Database, item: PlaidItem, lock: string, actor: CommandActor, summary: string) {
  return accountingGuard(db, { recordId: item.id, actor, summary, condition: "EXISTS (SELECT 1 FROM accounting_plaid_items WHERE id = ? AND lock_id = ? AND status <> 'Disconnected')", bindings: [item.id, lock] });
}
export async function withPlaidItem<T>(db: D1Database, env: PlaidEnvironment, id: string, work: (item: PlaidItem, accessToken: string, lock: string) => Promise<T>) {
  const lock = crypto.randomUUID();
  const claimed = await db.prepare("UPDATE accounting_plaid_items SET lock_id = ?, lock_expires_at = ? WHERE id = ? AND environment = ? AND status <> 'Disconnected' AND (lock_id = '' OR lock_expires_at < ?)").bind(lock, new Date(Date.now() + 300000).toISOString(), id, env.PLAID_ENV, now()).run();
  if (claimed.meta.changes !== 1) throw new PlaidFailure("This connection is busy, disconnected, or belongs to a different Plaid environment. Refresh and retry.", 409);
  try {
    const item = await db.prepare("SELECT * FROM accounting_plaid_items WHERE id = ?").bind(id).first<PlaidItem>();
    if (!item) throw new PlaidFailure("Connection not found.", 404);
    return await work(item, await decryptPlaidToken(env, item.encrypted_access_token, item.id), lock);
  } catch (error) {
    if (error instanceof PlaidFailure) await db.prepare("UPDATE accounting_plaid_items SET status = CASE WHEN ? = 'ITEM_LOGIN_REQUIRED' THEN 'Needs reconnect' ELSE status END, last_notice = ?, updated_at = ? WHERE id = ? AND lock_id = ?").bind(error.code, error.message, now(), id, lock).run();
    throw error;
  } finally { await db.prepare("UPDATE accounting_plaid_items SET lock_id = '', lock_expires_at = '' WHERE id = ? AND lock_id = ?").bind(id, lock).run(); }
}

export async function refreshPlaidAccounts(db: D1Database, env: PlaidEnvironment, item: PlaidItem, token: string, lock: string, actor: CommandActor) {
  const result = await plaidRequest<AccountsResponse>(env, "/accounts/get", { access_token: token });
  if (result.item.item_id !== item.plaid_item_id) throw new PlaidFailure("Plaid account identity did not match the connection.", 502);
  const accounts = result.accounts.filter(account => ["depository", "credit"].includes(account.type));
  for (let start = 0; start < accounts.length; start += 40) {
    await db.batch([lockGuard(db, item, lock, actor, "Refreshed Plaid account balances; book balances unchanged."), ...accounts.slice(start, start + 40).map(account => db.prepare(`INSERT INTO accounting_plaid_accounts (id, item_id, plaid_account_id, name, mask, account_type, subtype, currency, current_cents, available_cents, limit_cents, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(item_id, plaid_account_id) DO UPDATE SET name = excluded.name, mask = excluded.mask, account_type = excluded.account_type, subtype = excluded.subtype, currency = excluded.currency, current_cents = excluded.current_cents, available_cents = excluded.available_cents, limit_cents = excluded.limit_cents, updated_at = excluded.updated_at`).bind(`${item.id}:${account.account_id}`, item.id, account.account_id, account.name.slice(0, 300), (account.mask || "").slice(-4), account.type, account.subtype || "", account.balances.iso_currency_code || "Unknown", cents(account.balances.current), cents(account.balances.available), cents(account.balances.limit ?? null), now()))]);
  }
  return accounts.length;
}

export async function savePlaidItem(db: D1Database, env: PlaidEnvironment, supplied: { item_id: string; access_token: string }, actor: CommandActor) {
  if (!supplied.item_id || !supplied.access_token) throw new PlaidFailure("Plaid returned an incomplete connection.", 502);
  const prior = await db.prepare("SELECT id FROM accounting_plaid_items WHERE environment = ? AND plaid_item_id = ?").bind(env.PLAID_ENV, supplied.item_id).first<{ id: string }>();
  const id = prior?.id || `PLAID-${crypto.randomUUID()}`;
  // Save the long-lived token before any further provider request. A failed
  // balance fetch can then be retried without exchanging a one-use token again.
  await db.prepare(`INSERT INTO accounting_plaid_items (id, plaid_item_id, environment, encrypted_access_token, created_email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(environment, plaid_item_id) DO NOTHING`).bind(id, supplied.item_id, env.PLAID_ENV, await encryptPlaidToken(env, supplied.access_token, id), actor.email, now(), now()).run();
  return id;
}

export async function syncPlaidItem(db: D1Database, env: PlaidEnvironment, id: string, actor: CommandActor) {
  return withPlaidItem(db, env, id, async (item, token, lock) => {
    const accountCount = await refreshPlaidAccounts(db, env, item, token, lock, actor);
    if (item.environment === "sandbox") {
      const notice = `${accountCount} sandbox accounts refreshed. Test transactions are excluded from live accounting.`;
      await db.prepare("UPDATE accounting_plaid_items SET last_synced_at = ?, last_notice = ?, updated_at = ? WHERE id = ? AND lock_id = ?").bind(now(), notice, now(), id, lock).run();
      return { notice };
    }
    const mappings = (await db.prepare("SELECT plaid_account_id, cash_account_id FROM accounting_plaid_accounts WHERE item_id = ? AND cash_account_id IS NOT NULL AND currency = 'USD'").bind(id).all<{ plaid_account_id: string; cash_account_id: string }>()).results;
    const byAccount = new Map(mappings.map(row => [row.plaid_account_id, row.cash_account_id]));
    let cursor = item.cursor;
    let pages: SyncPage[] = [];
    for (let retry = 0; retry < 3; retry++) {
      cursor = item.cursor; pages = [];
      try {
        for (let pageNumber = 0; ; pageNumber++) {
          if (pageNumber >= 35) throw new PlaidFailure("This connection has too much history for one sync. Ask the administrator to reduce the initial transaction history in Plaid.", 409);
          const page = await plaidRequest<SyncPage>(env, "/transactions/sync", { access_token: token, ...(cursor ? { cursor } : {}), count: 500 });
          pages.push(page); cursor = page.next_cursor;
          if (!page.has_more) break;
        }
        break;
      } catch (error) { if (!(error instanceof PlaidFailure) || error.code !== "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" || retry === 2) throw error; }
    }
    let imported = 0, reopened = 0;
    type BankRow = { id: string; status: string; matched_transaction_id: string; amount_cents: number; transaction_date: string; cash_account_id: string };
    const existing = (await db.prepare("SELECT id, status, matched_transaction_id, amount_cents, transaction_date, cash_account_id FROM accounting_bank_transactions WHERE imported_batch_id = ?").bind(`PLAID:${id}`).all<BankRow>()).results;
    const snapshots = new Map(existing.map(row => [row.id, row]));
    let statements: D1PreparedStatement[] = [];
    const flush = async () => { if (statements.length) { await db.batch(statements); statements = []; } };
    const transactionGuard = (transactionId: string, prior: BankRow | undefined, summary: string) => accountingGuard(db, {
      recordId: transactionId, actor, summary,
      condition: "EXISTS (SELECT 1 FROM accounting_plaid_items WHERE id = ? AND lock_id = ? AND status <> 'Disconnected') AND " + (prior ? "EXISTS (SELECT 1 FROM accounting_bank_transactions WHERE id = ? AND status = ? AND matched_transaction_id = ? AND amount_cents = ? AND transaction_date = ? AND cash_account_id = ?)" : "NOT EXISTS (SELECT 1 FROM accounting_bank_transactions WHERE id = ?)"),
      bindings: [item.id, lock, transactionId, ...(prior ? [prior.status, prior.matched_transaction_id, prior.amount_cents, prior.transaction_date, prior.cash_account_id] : [])],
    });
    // IDs make interrupted batches replay-safe. Snapshot guards also prevent a
    // concurrent reconciliation match from being overwritten by a feed update.
    for (const page of pages) {
      for (const transaction of [...page.added, ...page.modified]) {
        const cashId = byAccount.get(transaction.account_id);
        if (!cashId) continue;
        if (transaction.iso_currency_code !== "USD") throw new PlaidFailure("A connected account returned a non-USD transaction. Review its currency before importing.", 409);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(transaction.date)) throw new PlaidFailure("Plaid returned an invalid transaction date.", 502);
        const transactionId = `${id}:TX:${transaction.transaction_id}`;
        const amount = plaidTransactionCents(transaction.amount);
        const prior = snapshots.get(transactionId);
        const changed = Boolean(prior && (prior.amount_cents !== amount || prior.transaction_date !== transaction.date || prior.cash_account_id !== cashId || transaction.pending));
        const status = transaction.pending ? "Pending" : prior?.status === "Matched" && !changed ? "Matched" : "Unmatched";
        const matchedId = status === "Matched" ? prior?.matched_transaction_id || "" : "";
        statements.push(transactionGuard(transactionId, prior, `Plaid transaction ${transaction.transaction_id} refreshed${changed && prior?.status === "Matched" ? "; previous match reopened for review" : ""}.`));
        if (changed && prior?.matched_transaction_id) {
          reopened++;
          statements.push(db.prepare("UPDATE accounting_bank_transactions SET status = 'Unmatched', matched_transaction_id = '', updated_at = ? WHERE id = ? AND matched_transaction_id = ?").bind(now(), prior.matched_transaction_id, transactionId));
        }
        statements.push(db.prepare(`INSERT INTO accounting_bank_transactions (id, cash_account_id, transaction_date, source, reference, description, amount_cents, status, matched_transaction_id, imported_batch_id, created_by, created_email, created_at, updated_at) VALUES (?, ?, ?, 'Bank', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET transaction_date = excluded.transaction_date, description = excluded.description, amount_cents = excluded.amount_cents, status = excluded.status, matched_transaction_id = excluded.matched_transaction_id, updated_at = excluded.updated_at`).bind(transactionId, cashId, transaction.date, transaction.transaction_id, (transaction.name || "Bank transaction").slice(0, 500), amount, status, matchedId, `PLAID:${id}`, actor.name, actor.email, now(), now()));
        snapshots.set(transactionId, { id: transactionId, status, matched_transaction_id: matchedId, amount_cents: amount, transaction_date: transaction.date, cash_account_id: cashId });
        imported++;
        if (statements.length >= 60) await flush();
      }
      for (const removed of page.removed) {
        const transactionId = `${id}:TX:${removed.transaction_id}`;
        const prior = snapshots.get(transactionId);
        if (!prior) continue;
        if (prior.matched_transaction_id) reopened++;
        statements.push(
          transactionGuard(transactionId, prior, `Plaid removed transaction ${removed.transaction_id}; any prior match reopened for review.`),
          db.prepare("UPDATE accounting_bank_transactions SET status = 'Unmatched', matched_transaction_id = '', updated_at = ? WHERE id = ? AND matched_transaction_id = ?").bind(now(), prior.matched_transaction_id, transactionId),
          db.prepare("UPDATE accounting_bank_transactions SET status = 'Removed', matched_transaction_id = '', updated_at = ? WHERE id = ?").bind(now(), transactionId),
        );
        snapshots.set(transactionId, { ...prior, status: "Removed", matched_transaction_id: "" });
        if (statements.length >= 60) await flush();
      }
    }
    await flush();
    const notice = `${imported} transaction updates synced.${reopened ? ` ${reopened} previous matches reopened; review Bank Reconciliation.` : ""}${!byAccount.size ? " Assign an accounting account to import transactions." : !imported ? " No new transactions are available yet." : ""}`;
    await db.batch([lockGuard(db, item, lock, actor, notice), db.prepare("UPDATE accounting_plaid_items SET cursor = ?, last_synced_at = ?, last_notice = ?, status = 'Connected', updated_at = ? WHERE id = ? AND lock_id = ?").bind(cursor, now(), notice, now(), id, lock)]);
    return { notice };
  });
}
