"use client";

type LinkHandler = { open: () => void; destroy: () => void; submit: (input: { phone_number: string }) => void };
type LinkOptions = { token: string; receivedRedirectUri?: string; onLoad: () => void; onSuccess: (publicToken: string | null) => void; onExit: (error: { error_code?: string } | null) => void; onEvent: (event: string) => void };
type PlaidSdk = { create: (options: LinkOptions) => LinkHandler };
let sdkPromise: Promise<PlaidSdk> | undefined;
export function loadPlaidSdk() {
  const current = (window as Window & { Plaid?: PlaidSdk }).Plaid;
  if (current) return Promise.resolve(current);
  if (!sdkPromise) sdkPromise = new Promise<PlaidSdk>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    script.async = true;
    const timer = window.setTimeout(() => { script.remove(); sdkPromise = undefined; reject(new Error("Plaid did not load. Check the connection and retry.")); }, 20000);
    script.onload = () => { window.clearTimeout(timer); const sdk = (window as Window & { Plaid?: PlaidSdk }).Plaid; if (sdk) resolve(sdk); else { sdkPromise = undefined; reject(new Error("Plaid did not load. Please retry.")); } };
    script.onerror = () => { window.clearTimeout(timer); script.remove(); sdkPromise = undefined; reject(new Error("Plaid could not load. Check the connection and retry.")); };
    document.head.appendChild(script);
  });
  return sdkPromise;
}
export async function plaidAction<T extends { error?: string } = { notice: string; error?: string }>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/accounting-plaid", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json() as T;
  if (!response.ok) throw new Error(data.error || "The bank connection could not be completed.");
  return data;
}
export type PlaidSession = { sessionId: string; linkToken: string; mode: string; error?: string };
export async function openPlaidSession(options: { session: PlaidSession; phone?: string; redirectUri?: string; onDone: (notice: string) => void; onError: (message: string) => void; onFallback?: () => void; onCancel: () => void }) {
  const sdk = await loadPlaidSdk();
  let finished = false;
  let initialized = false;
  let timer: number | undefined;
  const handler = sdk.create({
    token: options.session.linkToken,
    ...(options.redirectUri ? { receivedRedirectUri: options.redirectUri } : {}),
    onLoad: () => {
      if (finished || initialized) return;
      initialized = true; window.clearTimeout(timer);
      if (options.session.mode === "layer" && !options.redirectUri) {
        handler.submit({ phone_number: options.phone || "" });
        timer = window.setTimeout(() => { if (!finished) { finished = true; handler.destroy(); options.onError("Plaid Layer did not respond. Please retry or use bank search."); } }, 45000);
      } else handler.open();
    },
    onEvent: event => {
      if (finished || options.redirectUri) return;
      if (event === "LAYER_READY") { window.clearTimeout(timer); handler.open(); }
      if ((event === "LAYER_NOT_AVAILABLE" || event === "LAYER_AUTOFILL_NOT_AVAILABLE")) { window.clearTimeout(timer); finished = true; handler.destroy(); options.onFallback?.(); }
    },
    onSuccess: publicToken => {
      if (finished) return;
      finished = true; window.clearTimeout(timer);
      void plaidAction({ action: "complete", sessionId: options.session.sessionId, publicToken }).then(result => options.onDone(result.notice)).catch(error => options.onError(error instanceof Error ? error.message : "Connection could not be saved.")).finally(() => handler.destroy());
    },
    onExit: error => { if (finished) return; finished = true; window.clearTimeout(timer); handler.destroy(); if (error) options.onError("The bank connection was not completed. Please retry or use bank search."); else options.onCancel(); },
  });
  if (!initialized && !finished) timer = window.setTimeout(() => { if (!finished) { finished = true; handler.destroy(); options.onError("Plaid did not initialize. Please retry."); } }, 45000);
  return { destroy: () => { finished = true; window.clearTimeout(timer); handler.destroy(); } };
}
