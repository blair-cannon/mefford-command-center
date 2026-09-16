const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Normalize a monetary value to the system's cents precision.
 *
 * @param {unknown} value
 * @returns {number}
 */
export function roundMoney(value) {
  const parsed = typeof value === "string"
    ? Number(value.replace(/[$,]/g, ""))
    : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  const adjustment = parsed < 0 ? -Number.EPSILON : Number.EPSILON;
  const rounded = Math.round((parsed + adjustment) * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

/**
 * Return the exact two-decimal representation used in saved documents and exports.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function moneyDecimal(value) {
  return roundMoney(value).toFixed(2);
}

/**
 * Format a monetary value for people while always retaining cents.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function formatMoney(value) {
  return USD_FORMATTER.format(roundMoney(value));
}

export function currencyRawValue(value, allowNegative = false) {
  const input = String(value ?? "").replaceAll(",", "").replace(/[^0-9.\-]/g, "");
  const negative = allowNegative && input.startsWith("-");
  const unsigned = input.replaceAll("-", "");
  const [whole = "", ...decimalParts] = unsigned.split(".");
  const decimal = decimalParts.join("").slice(0, 2);
  if (!whole && !decimalParts.length) return negative ? "-" : "";
  return `${negative ? "-" : ""}${whole || "0"}${decimalParts.length ? `.${decimal}` : ""}`;
}

export function formatCurrencyInput(value, allowNegative = false) {
  const raw = currencyRawValue(value, allowNegative);
  if (!raw || raw === "-") return raw;
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole, decimal] = unsigned.split(".");
  const grouped = (whole || "0").replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${raw.includes(".") ? `.${decimal ?? ""}` : ""}`;
}

export function settleCurrencyInput(value, allowNegative = false) {
  const raw = currencyRawValue(value, allowNegative);
  if (!raw || raw === "-") return "";
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "";
}
