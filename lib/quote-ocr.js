const PRICE_CONTEXT = [
  [/grand\s+total/i, 120],
  [/total\s+(?:bid|proposal|price|quote|contract)/i, 115],
  [/(?:bid|proposal|quote)\s+total/i, 110],
  [/lump\s+sum/i, 100],
  [/base\s+bid/i, 95],
  [/total/i, 65],
];

const LOW_VALUE_CONTEXT = /subtotal|tax|deposit|retainage|unit\s+price|per\s+(?:hour|day|month|unit)|allowance|alternate/i;
const SCOPE_HEADING = /^(?:scope(?:\s+of\s+work)?|work\s+included|included\s+work|proposal\s+description|project\s+description|description\s+of\s+work|we\s+propose|inclusions?)\b\s*(?:\(continued\))?\s*:?(.*)$/i;
const STOP_HEADING = /^(?:scope|work\s+included|inclusions?|exclusions?|alternates?|allowances?|qualifications?|clarifications?|schedule|terms|payment|warranty|grand\s+total|base\s+bid|lump\s+sum|total|price|signature|acceptance)\b\s*:?/i;

/**
 * Extracts review suggestions from quote text. The source file remains authoritative;
 * every suggestion must be confirmed by a person before the quote can be submitted.
 * @param {string} rawText
 */
export function extractQuoteFields(rawText) {
  const text = String(rawText || "").replace(/\r/g, "").replace(/[\t ]+/g, " ").trim();
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const prices = [];

  lines.forEach((line, lineIndex) => {
    const previous = lines[lineIndex - 1] || "";
    const context = /^[\s$\d,.()-]+$/.test(line) ? `${previous} ${line}` : line;
    const amountMatches = [...line.matchAll(/(?:\$\s*)?(\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d+(?:\.\d{2})?)/g)];
    for (const match of amountMatches) {
      const value = Number(String(match[1]).replace(/,/g, ""));
      if (!Number.isFinite(value) || value <= 0) continue;
      // A credit, date, day count, or reference number is not a positive bid.
      if (/[-(]\s*$/.test(line.slice(0, match.index)) || /[\d.,]$/.test(line.slice(0, match.index)) || /^[\d.,]/.test(line.slice(match.index + match[0].length))) continue;
      const contextScore = PRICE_CONTEXT.reduce((score, [pattern, points]) => pattern.test(context) ? Math.max(score, points) : score, 0);
      const currencyScore = /\$/.test(match[0]) ? 12 : 0;
      if (!currencyScore && !contextScore) continue;
      if (!currencyScore && !/[,]|\.\d{2}$/.test(match[1]) && !(contextScore >= 95 && amountMatches.length === 1 && !/\b(?:days?|hours?|months?|reference|number)\b/i.test(context))) continue;
      const penalty = LOW_VALUE_CONTEXT.test(context) ? 45 : 0;
      prices.push({ value, line: context, lineIndex, score: contextScore + currencyScore - penalty });
    }
  });

  prices.sort((left, right) => right.score - left.score || right.value - left.value || right.lineIndex - left.lineIndex);
  const bestPrice = prices[0] || null;
  const ambiguous = bestPrice && new Set(prices.filter(item => item.score === bestPrice.score).map(item => item.value)).size > 1;
  const scope = extractScope(lines);

  return {
    exclusions: extractSection(lines, "exclusions?"),
    alternates: extractSection(lines, "alternates?"),
    allowances: extractSection(lines, "allowances?"),
    qualifications: extractSection(lines, "qualifications?"),
    clarifications: extractSection(lines, "clarifications?"),
    schedule: extractSection(lines, "schedule"),
    price: ambiguous ? 0 : bestPrice?.value || 0,
    priceSource: bestPrice?.line || "",
    priceWarnings: ambiguous ? ["More than one conflicting total was found. Enter the correct total after checking the original."] : [],
    scope,
    confidence: !ambiguous && bestPrice?.score >= 100 && scope.length >= 40 ? "High" : bestPrice || scope ? "Review Required" : "Not Detected",
    characterCount: text.length,
  };
}

function extractSection(lines, heading) {
  const pattern = new RegExp(`^${heading}\\b\\s*(?:\\(continued\\))?\\s*:?(.*)$`, "i");
  const collected = [];
  for (let start = 0; start < lines.length; start++) {
    const match = lines[start].match(pattern);
    if (!match) continue;
    collected.push(match[1].trim());
    for (let index = start + 1; index < lines.length; index++) {
      if (STOP_HEADING.test(lines[index])) break;
      if (/^--- /.test(lines[index])) continue;
      collected.push(lines[index]);
    }
  }
  return uniqueLines(collected).join("\n").slice(0, 10000);
}

function extractScope(lines) {
  const scopes = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(SCOPE_HEADING);
    if (!match) continue;
    const collected = [];
    if (match[1]?.trim()) collected.push(match[1].trim());
    for (let next = index + 1; next < lines.length; next += 1) {
      const line = lines[next];
      if (STOP_HEADING.test(line)) break;
      if (/^--- /.test(line)) continue;
      if (/^(?:date|to|from|project|attention)\s*:/i.test(line) && collected.length) break;
      collected.push(line.replace(/^[-•*]\s*/, ""));
    }
    const scope = cleanScope(collected.join("\n"));
    if (scope.length >= 12) scopes.push(...scope.split("\n"));
  }
  if (scopes.length) return uniqueLines(scopes).join("\n").slice(0, 20000);

  const likelyScope = lines
    .filter((line) => /\b(?:furnish|provide|install|labor|material|equipment|work includes|included in|construction of|perform)\b/i.test(line))
    .filter((line) => !/\$\s*\d/.test(line))
    .slice(0, 8);
  return cleanScope(likelyScope.join(" "));
}

function uniqueLines(lines) {
  const seen = new Set();
  return lines.filter(line => {
    const key = line.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
}

function cleanScope(value) {
  return String(value || "")
    .replace(/[\t ]+/g, " ")
    .replace(/^(?:scope(?: of work)?|work included|inclusions?)\s*:?\s*/i, "")
    .trim()
    .slice(0, 20000);
}
