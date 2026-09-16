import { COMMAND_CENTER_CHART_OF_ACCOUNTS, type LedgerAccountSeed } from "../app/accounting-data";
import { currentAccountNumber } from "./accounting-numbering";

type AccountRecord = { id: string; title: string; status: string; type?: string; recordType?: string; record_type?: string; data?: Record<string, unknown>; dataJson?: string; data_json?: string };
export type LedgerAccount = LedgerAccountSeed & { status: string; source: string; persistedId?: string };

export function accountRecordData(record: AccountRecord): Record<string, unknown> {
  if (record.data) return record.data;
  try { return JSON.parse(record.dataJson || record.data_json || "{}"); } catch { return {}; }
}

export function buildAccountCatalog(records: AccountRecord[] = []): LedgerAccount[] {
  const accounts = new Map(COMMAND_CENTER_CHART_OF_ACCOUNTS.map(account => [account.accountNumber, {
    ...account, status: account.defaultStatus, source: account.isSystemControl ? "System Control" : "Legacy Opening COA · Imported 08/11/26",
  } as LedgerAccount]));
  const seen = new Set<string>();
  for (const record of records.filter(row => (row.type || row.recordType || row.record_type) === "Chart Of Accounts")) {
    const data = accountRecordData(record);
    const number = currentAccountNumber(data.accountNumber || record.id);
    if (seen.has(number)) throw new Error(`Account ${number} Has Conflicting Legacy And Current Records. Resolve The Duplicate Before Posting.`);
    seen.add(number);
    const seed = accounts.get(number);
    accounts.set(number, { ...seed, accountNumber: number, legacyAccountNumber: seed?.legacyAccountNumber || String(data.legacyAccountNumber || (/^[1-9]\d{2}$/.test(record.id) ? record.id : "")),
      legacyName: record.title || seed?.legacyName || "Unnamed Account", category: String(data.category || seed?.category || "Uncategorized"),
      normalBalance: data.normalBalance === "Credit" ? "Credit" : data.normalBalance === "Debit" ? "Debit" : seed?.normalBalance || "Debit",
      defaultStatus: seed?.defaultStatus || "Pending Review", status: seed?.isSystemControl ? "Active" : record.status,
      source: String(data.source || seed?.source || "Command Center"), persistedId: record.id });
  }
  return [...accounts.values()].sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));
}

export function selectableLedgerAccounts(accounts: LedgerAccount[]) {
  return accounts.filter(account => account.status === "Active" || (account.status === "Pending Review" && Boolean(account.legacyAccountNumber)));
}
