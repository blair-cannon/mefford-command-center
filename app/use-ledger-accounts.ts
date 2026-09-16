"use client";
import { useEffect, useState } from "react";
import { buildAccountCatalog, selectableLedgerAccounts, type LedgerAccount } from "../lib/accounting-catalog";

export function useLedgerAccounts(enabled = true) {
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/records?projectId=MEFFORD-ACCOUNTING&recordType=Chart%20Of%20Accounts");
        const result = await response.json() as { records?: Parameters<typeof buildAccountCatalog>[0]; error?: string };
        if (!response.ok) throw new Error(result.error || "The Chart Of Accounts Could Not Be Loaded.");
        const current = selectableLedgerAccounts(buildAccountCatalog(result.records || []));
        if (!cancelled) { setAccounts(current); setError(""); }
      } catch (error) { if (!cancelled) { setAccounts([]); setError(error instanceof Error ? error.message : "The Chart Of Accounts Could Not Be Loaded."); } }
    };
    void load();
    window.addEventListener("command:chart-updated", load);
    return () => { cancelled = true; window.removeEventListener("command:chart-updated", load); };
  }, [enabled]);
  return { accounts, error };
}
