/**
 * Extracts review suggestions from registrations, insurance cards, inspection
 * records, warranties, and maintenance receipts. A person must confirm the
 * source before any empty asset-profile field is populated.
 * @param {string} rawText
 */
export function extractAssetDocumentFields(rawText) {
  const text = String(rawText || "").replace(/\r/g, "").replace(/[\t ]+/g, " ").trim();
  const vin = text.toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/)?.[0] || "";
  const licensePlate = capture(text, /(?:license\s*(?:plate|no\.?|number)|plate\s*(?:no\.?|number)|tag\s*(?:no\.?|number))\s*[:#-]?\s*([A-Z0-9 -]{3,12})/i);
  const policyNumber = capture(text, /(?:policy|certificate)\s*(?:no\.?|number|#)\s*[:#-]?\s*([A-Z0-9._/-]{4,30})/i);
  const documentNumber = capture(text, /(?:registration|inspection|warranty|invoice|work\s*order)\s*(?:no\.?|number|#)\s*[:#-]?\s*([A-Z0-9._/-]{3,30})/i);
  const expirationDate = labeledDate(text, /(?:expiration|expires|expiry|valid\s+through|coverage\s+ends?|warranty\s+ends?)/i);
  const serviceDate = labeledDate(text, /(?:service\s+date|invoice\s+date|work\s+performed|inspection\s+date|effective\s+date)/i);
  const amount = bestAmount(text);
  const detected = [vin, licensePlate, policyNumber, documentNumber, expirationDate, serviceDate, amount].filter(Boolean).length;
  return { vin, licensePlate, policyNumber, documentNumber, expirationDate, serviceDate, amount, confidence: detected >= 4 ? "High" : detected ? "Review Required" : "Not Detected", characterCount: text.length };
}

function capture(text, pattern) {
  return text.match(pattern)?.[1]?.replace(/\s{2,}.*/, "").replace(/[.,;:]+$/g, "").trim().slice(0, 80) || "";
}

function labeledDate(text, label) {
  for (const line of text.split("\n")) {
    if (!label.test(line)) continue;
    const match = line.match(/\b(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/);
    if (!match) continue;
    const parts = match[1].split(/[/-]/).map(Number);
    const [year, month, day] = match[1].startsWith(String(parts[0]).padStart(4, "0")) && parts[0] > 1900 ? parts : [parts[2] < 100 ? 2000 + parts[2] : parts[2], parts[0], parts[1]];
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) return date.toISOString().slice(0, 10);
  }
  return "";
}

function bestAmount(text) {
  const candidates = [];
  text.split("\n").forEach((line) => {
    for (const match of line.matchAll(/\$\s*(\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d{1,7}\.\d{2})/g)) {
      const value = Number(match[1].replace(/,/g, ""));
      if (!Number.isFinite(value) || value <= 0) continue;
      const score = /amount\s+due|invoice\s+total|grand\s+total|total/i.test(line) ? 100 : /subtotal|tax|unit/i.test(line) ? -40 : 0;
      candidates.push({ value, score });
    }
  });
  candidates.sort((left, right) => right.score - left.score || right.value - left.value);
  return candidates[0]?.value || 0;
}
