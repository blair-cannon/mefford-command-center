"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CloseButton } from "./close-button";
import { openPlaidSession, plaidAction, type PlaidSession } from "./plaid-link";

type Item = { id: string; institution_name: string; environment: string; status: string; last_synced_at: string | null; last_notice: string };
type Account = { id: string; item_id: string; cash_account_id: string | null; name: string; mask: string; account_type: string; subtype: string; currency: string; current_cents: number | null; available_cents: number | null; limit_cents: number | null; updated_at: string };
type Data = { configured: boolean; layerReady: boolean; environment: string; missing: string[]; items: Item[]; accounts: Account[]; cashAccounts: Array<{ id: string; title: string }>; transactions: Array<{ id: string; cash_account_id: string; transaction_date: string; description: string; amount_cents: number; status: string }> };
const money = (value: number | null, currency = "USD") => value === null ? "Unavailable" : /^[A-Z]{3}$/.test(currency) ? new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value / 100) : `${(value / 100).toFixed(2)} ${currency}`;
const date = (value: string | null) => value ? new Date(value).toLocaleString() : "Not synced";

export function AccountingBankConnections({ onAccountsChanged }: { onAccountsChanged: () => Promise<void> }) {
  const [data, setData] = useState<Data | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [phone, setPhone] = useState("");
  const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null);
  const active = useRef<{ destroy: () => void } | null>(null);
  const mounted = useRef(true);
  const connectAttempt = useRef(0);
  const load = useCallback(async () => {
    const response = await fetch("/api/accounting-plaid", { cache: "no-store" });
    const result = await response.json() as Data & { error?: string };
    if (!response.ok) throw new Error(result.error || "Bank connections could not be loaded.");
    if (mounted.current) setData(result);
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load().catch(error => setNotice(error.message));
    return () => { mounted.current = false; connectAttempt.current++; active.current?.destroy(); };
  }, [load]);
  async function refresh(notice: string) { setNotice(notice); await Promise.all([load(), onAccountsChanged()]); }
  async function action(body: Record<string, unknown>) {
    setBusy(true); setNotice("");
    try { const result = await plaidAction(body); await refresh(result.notice); }
    catch (error) { setNotice(error instanceof Error ? error.message : "The account could not be updated."); }
    finally { setBusy(false); setConfirmDisconnect(null); }
  }
  async function connect(mode: "layer" | "link", itemId?: string) {
    const attempt = ++connectAttempt.current;
    const current = () => mounted.current && connectAttempt.current === attempt;
    setBusy(true); setNotice("");
    try {
      const digits = phone.replace(/\D/g, "");
      const normalized = digits.length === 10 ? `+1${digits}` : `+${digits}`;
      if (mode === "layer" && !itemId && !/^\+1\d{10}$/.test(normalized)) throw new Error("Enter a US phone number for Plaid Layer, or use bank search.");
      const session = await plaidAction<PlaidSession>({ action: "start", mode, phone: normalized, itemId });
      if (!current()) return;
      active.current?.destroy();
      const handler = await openPlaidSession({ session, phone: normalized,
        onDone: message => { if (!current()) return; setBusy(false); setAdding(false); setPhone(""); void refresh(message).catch(error => setNotice(error.message)); },
        onError: message => { if (current()) { setNotice(message); setBusy(false); } },
        onCancel: () => { if (current()) { setNotice("Bank connection canceled."); setBusy(false); } },
        onFallback: () => { if (current()) void connect("link"); },
      });
      if (current()) active.current = handler; else handler.destroy();
    } catch (error) { if (current()) { setNotice(error instanceof Error ? error.message : "Plaid could not be opened."); setBusy(false); } }
  }
  return <section className="accounting-control-panel plaid-connections">
    <div className="plaid-toolbar"><h2>Bank And Credit Accounts</h2><button disabled={busy || !data?.configured} onClick={() => setAdding(true)}>Add Bank Or Credit Card</button><button disabled={busy} onClick={() => { void load().catch(error => setNotice(error.message)); }}>Refresh Accounts</button></div>
    {notice ? <div className="accounting-notice" role="status">{notice}</div> : null}
    {!data ? <p>{notice ? "Accounts unavailable." : "Loading bank connections…"}</p> : <>
      {!data.configured ? <p role="status">Plaid setup required: {data.missing.join(", ")}. Ask the site administrator to configure these values securely.</p> : null}
      {data.environment === "sandbox" ? <p role="status">Sandbox mode — test accounts cannot be assigned to live accounting.</p> : null}
      {adding ? <div className="plaid-add-account"><div className="plaid-toolbar"><h3>Add Bank Or Credit Card</h3><CloseButton aria-label="Close bank connection form" onClick={() => { connectAttempt.current++; active.current?.destroy(); setBusy(false); setAdding(false); setPhone(""); }} /></div>
        {data.layerReady ? <label>Phone Number For Plaid<input type="tel" autoComplete="tel" value={phone} onChange={event => setPhone(event.target.value)} placeholder="(555) 555-5555" disabled={busy} /></label> : <p>Layer template not configured. Bank search is available through Plaid Link.</p>}
        <div className="plaid-toolbar">{data.layerReady ? <button disabled={busy} onClick={() => void connect("layer")}>{busy ? "Connecting…" : "Continue With Plaid Layer"}</button> : null}<button disabled={busy} onClick={() => void connect("link")}>Search For My Bank</button></div>
      </div> : null}
      {!data.items.length ? <p>No bank or credit-card connections.</p> : null}
      <div className="plaid-item-list">{data.items.map(item => <article key={item.id} className="plaid-item">
        <div className="plaid-toolbar"><h3>{data.accounts.find(account => account.item_id === item.id)?.name || item.institution_name}</h3><span>{item.status} · {item.environment}</span></div>
        <p className="plaid-secondary">Last sync: {date(item.last_synced_at)}</p>
        {item.last_notice ? <p>{item.last_notice}</p> : null}
        {item.status !== "Disconnected" ? <div className="plaid-toolbar"><button disabled={busy || !data.configured || item.environment !== data.environment} onClick={() => void action({ action: "sync", itemId: item.id })}>Sync Transactions</button><button disabled={busy || !data.configured || item.environment !== data.environment} onClick={() => void connect("link", item.id)}>Reconnect</button><button disabled={busy || !data.configured || item.environment !== data.environment} onClick={() => setConfirmDisconnect(item.id)}>Disconnect</button></div> : null}
        {confirmDisconnect === item.id ? <div className="plaid-disconnect"><p>Disconnect this bank connection? Imported accounting history will be retained.</p><div className="plaid-toolbar"><button disabled={busy} onClick={() => void action({ action: "disconnect", itemId: item.id })}>Confirm Disconnect</button><button disabled={busy} onClick={() => setConfirmDisconnect(null)}>Cancel</button></div></div> : null}
        <div className="plaid-account-list">{data.accounts.filter(account => account.item_id === item.id).map(account => <article key={account.id} className="plaid-account">
          <h4>{account.name}{account.mask ? ` · •••• ${account.mask}` : ""}</h4><p className="plaid-secondary">{account.account_type === "credit" ? "Credit card" : "Bank account"} · {account.subtype} · {account.currency}</p>
          <dl><div><dt>{account.account_type === "credit" ? "Amount Owed" : "Current Balance"}</dt><dd>{money(account.current_cents, account.currency)}</dd></div><div><dt>{account.account_type === "credit" ? "Available Credit" : "Available Balance"}</dt><dd>{money(account.available_cents, account.currency)}</dd></div></dl>
          {account.cash_account_id ? <p>Accounting Account: {data.cashAccounts.find(cash => cash.id === account.cash_account_id)?.title || account.cash_account_id}</p> : item.status !== "Disconnected" && item.environment === "production" && account.currency === "USD" ? <AccountAssignment account={account} data={data} disabled={busy || !data.configured || item.environment !== data.environment} assign={cashAccountId => void action({ action: "map", accountId: account.id, cashAccountId })} /> : null}
        </article>)}</div>
      </article>)}</div>
      {data.transactions.length ? <section><h3>Recent Bank Feed Activity</h3><div className="plaid-feed">{data.transactions.map(transaction => <article key={transaction.id}><strong>{transaction.description}</strong><span>{data.cashAccounts.find(account => account.id === transaction.cash_account_id)?.title} · {transaction.transaction_date}</span><span>{money(transaction.amount_cents)} · {transaction.status}</span></article>)}</div></section> : null}
    </>}
  </section>;
}
function AccountAssignment({ account, data, disabled, assign }: { account: Account; data: Data; disabled: boolean; assign: (id: string) => void }) {
  const [selection, setSelection] = useState("");
  const assigned = new Set(data.accounts.map(row => row.cash_account_id));
  return <div className="plaid-account-assignment"><label>Accounting Account<select value={selection} disabled={disabled} onChange={event => setSelection(event.target.value)} aria-label={`Accounting account for ${account.name}`}><option value="">Select Account</option><option value="new">Create New Accounting Account</option>{data.cashAccounts.filter(row => !assigned.has(row.id)).map(row => <option key={row.id} value={row.id}>{row.title}</option>)}</select></label><button disabled={disabled || !selection} onClick={() => assign(selection)}>Assign Account</button></div>;
}
