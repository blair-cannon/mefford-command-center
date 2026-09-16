export const ACCOUNT_NUMBER_POLICY = "MEFFCON-4-DIGIT-2026-09";
export const ACCOUNT_NUMBER_RANGES = [
  { category: "Cash Accounts", start: 1000, end: 1109 },
  { category: "Current Assets", start: 1110, end: 1599 },
  { category: "WIP Assets", start: 1600, end: 1799 },
  { category: "Other Assets", start: 1800, end: 1999 },
  { category: "Fixed Assets", start: 2000, end: 2999 },
  { category: "Accumulated Depreciation", start: 3000, end: 3999 },
  { category: "Current Liabilities", start: 4000, end: 4499 },
  { category: "Long Term Liabilities", start: 4500, end: 4949 },
  { category: "System Control / Clearing", start: 4950, end: 4999 },
  { category: "Equity", start: 5000, end: 5699 },
  { category: "Owners Drawing", start: 5700, end: 5999 },
  { category: "Operating Income", start: 6000, end: 6499 },
  { category: "Other Income", start: 6500, end: 6999 },
  { category: "Direct Expense", start: 7000, end: 7999 },
  { category: "Overhead Expense", start: 8000, end: 9549 },
  { category: "Administrative Expense", start: 9550, end: 9759 },
  { category: "After Tax Income Expense", start: 9760, end: 9999 },
] as const;

// Stable compatibility rule: historical journal identifiers and amounts stay intact.
export function currentAccountNumber(value: unknown): string {
  const number = String(value ?? "").trim();
  return /^[1-9]\d{2}$/.test(number) ? `${number}0` : number;
}

export function accountNumberError(number: string, category: string): string {
  if (!/^[1-9]\d{3}$/.test(number)) return "Use Exactly Four Digits From 1000 Through 9999.";
  const range = ACCOUNT_NUMBER_RANGES.find(item => item.category === category);
  if (!range || Number(number) < range.start || Number(number) > range.end) return range
    ? `${category} Accounts Must Use ${range.start} Through ${range.end}.`
    : "Select A Valid Account Category.";
  return "";
}

export function normalizeAccountReferences<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => normalizeAccountReferences(item)) as T;
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = (key === "accountNumber" || /AccountNumber$/.test(key)) && !["legacyAccountNumber", "originalAccountNumber"].includes(key)
      ? currentAccountNumber(item) : normalizeAccountReferences(item);
  }
  const source = value as Record<string, unknown>;
  if (source.accountNumber && currentAccountNumber(source.accountNumber) !== source.accountNumber) result.originalAccountNumber = source.originalAccountNumber || source.accountNumber;
  if (source.destination === "Company Overhead" && typeof source.code === "string") result.code = currentAccountNumber(source.code);
  return result as T;
}
