"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { openPlaidSession, type PlaidSession } from "../../plaid-link";

export default function PlaidReturnPage() {
  const [notice, setNotice] = useState("Resuming your bank connection…");
  useEffect(() => {
    let mounted = true;
    let handler: { destroy: () => void } | undefined;
    async function resume() {
      if (!new URL(window.location.href).searchParams.has("oauth_state_id")) throw new Error("No bank authorization was returned. Start again from Cash Management.");
      const response = await fetch("/api/accounting-plaid?resume=1", { cache: "no-store" });
      const session = await response.json() as PlaidSession;
      if (!response.ok) throw new Error(session.error || "The bank connection session expired.");
      if (!mounted) return;
      handler = await openPlaidSession({ session, redirectUri: window.location.href, onDone: message => { if (mounted) setNotice(message); }, onError: message => { if (mounted) setNotice(message); }, onCancel: () => { if (mounted) setNotice("Bank connection canceled."); } });
      if (!mounted) handler.destroy();
    }
    void resume().catch(error => { if (mounted) setNotice(error.message); });
    return () => { mounted = false; handler?.destroy(); };
  }, []);
  return <main className="accounting-workspace plaid-oauth-return"><h1>Bank Connection</h1><p role="status">{notice}</p><Link href="/">Return To Command Center</Link></main>;
}
