import { resolveCommandActor } from "../../../lib/server-actor";
import { enforceOnboardingAccess } from "../../../lib/onboarding";
import { accountingGuard } from "../../../lib/accounting-ledger";
import { decryptPlaidToken, encryptPlaidToken, plaidConfiguration, PlaidFailure, plaidRequest, plaidUserId, refreshPlaidAccounts, savePlaidItem, syncPlaidItem, withPlaidItem } from "../../../lib/plaid";

type Session = { id: string; actor_email: string; environment: string; mode: string; item_id: string | null; encrypted_link_token: string; status: string; expires_at: string };
const response = (data: unknown, status = 200, headers: HeadersInit = {}) => Response.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
const now = () => new Date().toISOString();
async function context(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) throw new PlaidFailure("Authentication required.", 401);
  const lock = await enforceOnboardingAccess(request);
  if (lock) return { blocked: lock } as const;
  const { env } = await import("cloudflare:workers");
  const member = await env.DB.prepare("SELECT company_access_level, designations_json FROM company_members WHERE email = ? AND is_active = 1").bind(actor.email).first<{ company_access_level: string; designations_json: string }>();
  const roles: unknown = JSON.parse(member?.designations_json || "[]");
  if (!member || !(member.company_access_level === "Company Owner" || Array.isArray(roles) && roles.some(role => ["Accountant", "Financial Administrator"].includes(role)))) throw new PlaidFailure("Bank connections require a Company Owner, Accountant, or Financial Administrator.", 403);
  return { actor, env, db: env.DB } as const;
}
function fail(error: unknown) {
  if (error instanceof PlaidFailure) return response({ error: error.message, code: error.code }, error.status);
  // Provider payloads and tokens must never appear in logs or error responses.
  return response({ error: "The bank connection could not be saved. Refresh and retry; contact the administrator if it continues." }, 500);
}
export async function GET(request: Request) {
  try {
    const ctx = await context(request); if (ctx.blocked) return ctx.blocked;
    const { db, env, actor } = ctx;
    if (new URL(request.url).searchParams.has("resume")) {
      const id = request.headers.get("cookie")?.match(/(?:^|;\s*)mefford_plaid_session=([\w-]+)/)?.[1] || "";
      const session = await db.prepare("SELECT * FROM accounting_plaid_sessions WHERE id = ? AND actor_email = ? AND environment = ? AND status = 'Open' AND expires_at > ?").bind(id, actor.email, env.PLAID_ENV || "", now()).first<Session>();
      if (!session) throw new PlaidFailure("This bank connection session expired. Return to Cash Management and start again.", 409);
      return response({ sessionId: session.id, mode: session.mode, linkToken: await decryptPlaidToken(env, session.encrypted_link_token, session.id) });
    }
    const [items, accounts, cash, transactions] = await Promise.all([
      db.prepare("SELECT id, institution_name, environment, status, last_synced_at, last_notice FROM accounting_plaid_items ORDER BY created_at DESC").all(),
      db.prepare("SELECT id, item_id, cash_account_id, name, mask, account_type, subtype, currency, current_cents, available_cents, limit_cents, updated_at FROM accounting_plaid_accounts ORDER BY name").all(),
      db.prepare("SELECT id, title FROM command_records WHERE project_id = 'MEFFORD-ACCOUNTING' AND record_type = 'Cash Account' ORDER BY title").all(),
      db.prepare("SELECT id, cash_account_id, transaction_date, description, amount_cents, status FROM accounting_bank_transactions WHERE imported_batch_id LIKE 'PLAID:%' ORDER BY updated_at DESC LIMIT 50").all(),
    ]);
    return response({ ...plaidConfiguration(env), redirectUri: `${new URL(request.url).origin}/accounting/plaid-return`, items: items.results, accounts: accounts.results, cashAccounts: cash.results, transactions: transactions.results });
  } catch (error) { return fail(error); }
}
export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") throw new PlaidFailure("Open bank connections from Command Center to continue.", 403);
    if (!request.headers.get("content-type")?.includes("application/json")) throw new PlaidFailure("A JSON request is required.", 415);
    const ctx = await context(request); if (ctx.blocked) return ctx.blocked;
    const { db, env, actor } = ctx;
    if (!plaidConfiguration(env).configured) throw new PlaidFailure("Plaid setup is incomplete. Configure the connection in the site environment.", 503);
    const body = await request.json() as { action?: string; mode?: string; sessionId?: string; publicToken?: string; phone?: string; itemId?: string; accountId?: string; cashAccountId?: string };
    if (body.action === "start") {
      const recent = await db.prepare("SELECT COUNT(*) AS count FROM accounting_plaid_sessions WHERE actor_email = ? AND created_at > ?").bind(actor.email, new Date(Date.now() - 300000).toISOString()).first<{ count: number }>();
      if ((recent?.count || 0) >= 12) throw new PlaidFailure("Too many connection attempts. Wait a few minutes and retry.", 429);
      const mode = body.itemId ? "update" : body.mode === "link" ? "link" : "layer";
      if (mode === "layer" && !env.PLAID_LAYER_TEMPLATE_ID) throw new PlaidFailure("The Plaid Layer template has not been configured. Use bank search or complete Layer setup.", 503);
      const user = { client_user_id: await plaidUserId(actor.email), ...(body.phone && /^\+1\d{10}$/.test(body.phone) ? { phone_number: body.phone } : {}) };
      const redirect_uri = `${new URL(request.url).origin}/accounting/plaid-return`;
      let token: string, expiration: string;
      if (mode === "layer") {
        const result = await plaidRequest<{ link: { link_token: string; expiration: string } }>(env, "/session/token/create", { template_id: env.PLAID_LAYER_TEMPLATE_ID, user: { client_user_id: user.client_user_id }, redirect_uri });
        token = result.link.link_token; expiration = result.link.expiration;
      } else {
        const create = async (accessToken?: string) => plaidRequest<{ link_token: string; expiration: string }>(env, "/link/token/create", { user, client_name: "Mefford Command Center", country_codes: ["US"], language: "en", redirect_uri, ...(accessToken ? { access_token: accessToken } : { products: ["transactions"], account_filters: { depository: { account_subtypes: ["checking", "savings", "money market", "cash management"] }, credit: { account_subtypes: ["credit card"] } } }) });
        const result = body.itemId ? await withPlaidItem(db, env, body.itemId, (_item, access) => create(access)) : await create();
        token = result.link_token; expiration = result.expiration;
      }
      const id = crypto.randomUUID();
      await db.prepare("INSERT INTO accounting_plaid_sessions (id, actor_email, environment, mode, item_id, encrypted_link_token, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id, actor.email, env.PLAID_ENV, mode, body.itemId || null, await encryptPlaidToken(env, token, id), expiration, now()).run();
      await db.prepare("DELETE FROM accounting_plaid_sessions WHERE expires_at < ?").bind(new Date(Date.now() - 86400000).toISOString()).run();
      return response({ sessionId: id, mode, linkToken: token }, 200, { "Set-Cookie": `mefford_plaid_session=${id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=14400` });
    }
    if (body.action === "complete") {
      const session = await db.prepare("SELECT * FROM accounting_plaid_sessions WHERE id = ? AND actor_email = ? AND environment = ? AND expires_at > ?").bind(body.sessionId || "", actor.email, env.PLAID_ENV, now()).first<Session>();
      if (!session) throw new PlaidFailure("The connection session expired or belongs to another user.", 409);
      if (session.status === "Complete") return response({ notice: "Bank connection already saved. Refresh the account list." });
      if (session.mode !== "update" && (typeof body.publicToken !== "string" || !body.publicToken.trim() || body.publicToken.length > 2000)) throw new PlaidFailure("Plaid did not return a valid connection token.");
      const claimed = await db.prepare("UPDATE accounting_plaid_sessions SET status = 'Processing' WHERE id = ? AND status = 'Open'").bind(session.id).run();
      if (claimed.meta.changes !== 1) throw new PlaidFailure("This connection is already being saved. Refresh the account list before starting again.", 409);
      const itemIds: string[] = [];
      try {
        if (session.mode === "update") { if (session.item_id) itemIds.push(session.item_id); }
        else {
          const connected = session.mode === "layer"
            ? (await plaidRequest<{ items: Array<{ item_id: string; access_token: string }> }>(env, "/user_account/session/get", { public_token: body.publicToken })).items
            : [await plaidRequest<{ item_id: string; access_token: string }>(env, "/item/public_token/exchange", { public_token: body.publicToken })];
          if (!connected?.length) throw new PlaidFailure("No bank or credit-card connection was returned. Please connect again.");
          for (const item of connected) itemIds.push(await savePlaidItem(db, env, item, actor));
        }
        await db.prepare("UPDATE accounting_plaid_sessions SET status = 'Complete', encrypted_link_token = '' WHERE id = ?").bind(session.id).run();
      } catch (error) {
        await db.prepare("UPDATE accounting_plaid_sessions SET status = 'Failed', encrypted_link_token = '' WHERE id = ?").bind(session.id).run();
        throw error;
      }
      let needsRefresh = false;
      for (const id of itemIds) {
        try { await withPlaidItem(db, env, id, async (item, token, lock) => {
          await refreshPlaidAccounts(db, env, item, token, lock, actor);
          await db.prepare("UPDATE accounting_plaid_items SET status = 'Connected', last_notice = '', updated_at = ? WHERE id = ? AND lock_id = ?").bind(now(), id, lock).run();
        }); } catch { needsRefresh = true; }
      }
      return response({ notice: needsRefresh ? "Connection saved. Select Sync to retrieve accounts when the bank is ready." : "Connection saved. Assign each account to begin importing transactions." }, 200, { "Set-Cookie": "mefford_plaid_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" });
    }
    if (body.action === "sync" && body.itemId) return response(await syncPlaidItem(db, env, body.itemId, actor));
    if (body.action === "map" && body.accountId) {
      const account = await db.prepare("SELECT * FROM accounting_plaid_accounts WHERE id = ?").bind(body.accountId).first<{ id: string; item_id: string; cash_account_id: string | null; name: string; mask: string; account_type: string; currency: string }>();
      if (!account) throw new PlaidFailure("Account not found.", 404);
      return response(await withPlaidItem(db, env, account.item_id, async (item, _token, lock) => {
        if (item.environment !== "production") throw new PlaidFailure("Sandbox accounts cannot be assigned to live accounting.");
        if (account.currency !== "USD") throw new PlaidFailure("Only USD accounts can be imported into this accounting ledger.");
        if (account.cash_account_id) throw new PlaidFailure("This account is already assigned. Disconnect the connection before changing its assignment.", 409);
        const id = body.cashAccountId === "new" ? `CASH-${crypto.randomUUID()}` : body.cashAccountId || "";
        const existing = await db.prepare("SELECT data_json FROM command_records WHERE project_id = 'MEFFORD-ACCOUNTING' AND record_type = 'Cash Account' AND id = ?").bind(id).first<{ data_json: string }>();
        if (body.cashAccountId !== "new" && !existing) throw new PlaidFailure("Choose an existing accounting account or create a new one.");
        const linked = await db.prepare("SELECT id FROM accounting_plaid_accounts WHERE cash_account_id = ?").bind(id).first();
        if (linked) throw new PlaidFailure("That accounting account already has a bank connection. Use Reconnect for the existing connection.", 409);
        const data = { ...(existing ? JSON.parse(existing.data_json) : { name: account.name, lastFour: account.mask, bookBalance: 0 }), accountType: account.account_type, plaidAccountId: account.id, noSensitiveAccountData: true };
        await db.batch([
          accountingGuard(db, { recordId: id, actor, summary: "Assigned a Plaid account for transaction reconciliation; no journal entries posted.", condition: "EXISTS (SELECT 1 FROM accounting_plaid_items WHERE id = ? AND lock_id = ?) AND EXISTS (SELECT 1 FROM accounting_plaid_accounts WHERE id = ? AND cash_account_id IS NULL)", bindings: [item.id, lock, account.id] }),
          db.prepare("INSERT INTO command_records (project_id, id, record_type, title, owner, due, status, meta, data_json, created_at, updated_at) VALUES ('MEFFORD-ACCOUNTING', ?, 'Cash Account', ?, ?, '', 'Needs Review', 'Plaid connected', ?, ?, ?) ON CONFLICT(project_id, id) DO UPDATE SET data_json = json_set(command_records.data_json, '$.accountType', json_extract(excluded.data_json, '$.accountType'), '$.plaidAccountId', json_extract(excluded.data_json, '$.plaidAccountId')), updated_at = excluded.updated_at").bind(id, `${account.name}${account.mask ? ` · ${account.mask}` : ""}`, actor.name, JSON.stringify(data), now(), now()),
          db.prepare("UPDATE accounting_plaid_accounts SET cash_account_id = ?, updated_at = ? WHERE id = ?").bind(id, now(), account.id),
          db.prepare("UPDATE accounting_plaid_items SET cursor = '', updated_at = ? WHERE id = ? AND lock_id = ?").bind(now(), item.id, lock),
        ]);
        return { notice: "Account assigned. Select Sync to import available transactions." };
      }));
    }
    if (body.action === "disconnect" && body.itemId) return response(await withPlaidItem(db, env, body.itemId, async (item, token, lock) => {
      try { await plaidRequest(env, "/item/remove", { access_token: token }); } catch (error) { if (!(error instanceof PlaidFailure) || error.code !== "ITEM_NOT_FOUND") throw error; }
      await db.batch([
        accountingGuard(db, { recordId: item.id, actor, summary: "Disconnected Plaid access; accounting and reconciliation history retained.", condition: "EXISTS (SELECT 1 FROM accounting_plaid_items WHERE id = ? AND lock_id = ?)", bindings: [item.id, lock] }),
        db.prepare("UPDATE accounting_plaid_items SET status = 'Disconnected', encrypted_access_token = '', last_notice = 'Disconnected. Accounting history retained.', updated_at = ? WHERE id = ?").bind(now(), item.id),
        db.prepare("UPDATE accounting_plaid_accounts SET cash_account_id = NULL WHERE item_id = ?").bind(item.id),
      ]);
      return { notice: "Bank connection disconnected. Accounting history retained." };
    }));
    throw new PlaidFailure("Choose a valid bank connection action.");
  } catch (error) { return fail(error); }
}
