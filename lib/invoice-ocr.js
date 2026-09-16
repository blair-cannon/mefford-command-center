const TOTAL_CONTEXT = [
  [/amount\s+due/i, 130],
  [/balance\s+due/i, 125],
  [/invoice\s+total/i, 120],
  [/grand\s+total/i, 115],
  [/total\s+due/i, 110],
  [/total/i, 70],
];

const LOW_VALUE_CONTEXT = /subtotal|tax|deposit|retainage|unit\s+price|previous\s+balance|payment|credit/i;

/**
 * Conservative Accounts Payable OCR suggestions. The original invoice remains
 * authoritative and Accounting must confirm the fields before saving.
 * @param {string} rawText
 */
export function extractInvoiceFields(rawText) {
  const text = String(rawText || "").replace(/\r/g, "").replace(/[\t ]+/g, " ").trim();
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const invoiceNumber = firstCapture(lines, [
    /(?:invoice|inv)\s*(?:number|no\.?|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,})/i,
    /(?:number|no\.?)\s*[:#-]\s*([A-Z0-9][A-Z0-9._/-]{2,})/i,
  ]);
  const poReference = firstCapture(lines, [
    /(?:purchase\s+order|p\.?o\.?)\s*(?:number|no\.?|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,})/i,
  ]);
  const dueDate = labeledDate(lines, /(?:payment\s+)?due\s+date|due\s+on/i);
  const invoiceDate = labeledDate(lines, /invoice\s+date|date\s+issued|issued\s+on/i) || (!dueDate ? labeledDate(lines, /^date\b/i) : "");
  const amounts = [];
  lines.forEach((line, lineIndex) => {
    for (const match of line.matchAll(/(?:\$\s*)?(\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d{1,7}\.\d{2})/g)) {
      const value = Number(String(match[1]).replace(/,/g, ""));
      if (!Number.isFinite(value) || value <= 0) continue;
      const contextScore = TOTAL_CONTEXT.reduce((score, [pattern, points]) => pattern.test(line) ? Math.max(score, points) : score, 0);
      const currencyScore = /\$/.test(match[0]) ? 10 : 0;
      const penalty = LOW_VALUE_CONTEXT.test(line) ? 50 : 0;
      amounts.push({ value, line, lineIndex, score: contextScore + currencyScore - penalty });
    }
  });
  amounts.sort((left, right) => right.score - left.score || right.value - left.value || right.lineIndex - left.lineIndex);
  const total = amounts[0] || null;
  const vendor = likelyVendor(lines);
  const description = likelyDescription(lines);
  const detected = [vendor, invoiceNumber, invoiceDate, dueDate, total?.value, poReference, description].filter(Boolean).length;
  return {
    vendor,
    invoiceNumber,
    invoiceDate,
    dueDate,
    total: total?.value || 0,
    totalSource: total?.line || "",
    poReference,
    description,
    confidence: detected >= 5 && (total?.score || 0) >= 100 ? "High" : detected ? "Review Required" : "Not Detected",
    characterCount: text.length,
  };
}

function firstCapture(lines, patterns) {
  for (const line of lines) for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match?.[1]) return match[1].replace(/[.,;:]+$/g, "").trim().slice(0, 80);
  }
  return "";
}

function labeledDate(lines, label) {
  for (const line of lines) {
    if (!label.test(line)) continue;
    const match = line.match(/(?:\b(\d{4}-\d{1,2}-\d{1,2})\b|\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b|\b((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4})\b)/i);
    if (match) return isoDate(match[1] || match[2] || match[3]);
  }
  return "";
}

function isoDate(value) {
  const source = String(value || "").trim();
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(source)) {
    const [year, month, day] = source.split("-").map(Number);
    return validDate(year, month, day);
  }
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(source)) {
    const [month, day, rawYear] = source.split(/[/-]/).map(Number);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    return validDate(year, month, day);
  }
  const parsed = new Date(`${source} 12:00:00 UTC`);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function validDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    : "";
}

function likelyVendor(lines) {
  return lines.slice(0, 12).find((line) => {
    if (line.length < 3 || line.length > 80) return false;
    if (/invoice|bill\s+to|ship\s+to|date|phone|fax|email|www\.|https?:|amount|total|page\s+\d/i.test(line)) return false;
    if (/^\d+[\s-]|\b\d{5}(?:-\d{4})?\b/.test(line)) return false;
    return /[A-Za-z]{3}/.test(line) && !/^[-_#*]+$/.test(line);
  })?.replace(/\s{2,}.*/, "").trim().slice(0, 120) || "";
}

function likelyDescription(lines) {
  const candidates = lines.filter((line) => {
    if (line.length < 12 || line.length > 220) return false;
    if (/invoice|bill\s+to|ship\s+to|amount|subtotal|tax|total|payment|terms|phone|email|www\.|signature/i.test(line)) return false;
    if (/\$\s*\d|\d{1,3}(?:,\d{3})+\.\d{2}/.test(line)) return false;
    return /\b(?:labor|material|service|equipment|rental|repair|install|construction|delivery|maintenance|work|provided|furnished)\b/i.test(line);
  });
  return candidates.slice(0, 4).join("; ").replace(/\s+/g, " ").slice(0, 1000);
}
