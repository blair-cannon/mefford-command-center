const LEGAL_SUFFIXES = new Set(["llc", "lc", "llp", "lp", "inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "limited", "pllc", "pc"]);
const ACRONYM_STOP_WORDS = new Set(["and", "of", "the", "for"]);

export function companyIdentity(value) {
  const display = String(value || "").replace(/&/g, " and ").replace(/[^a-zA-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  const tokens = display.toLowerCase().split(" ").filter(Boolean);
  const baseTokens = tokens.filter((token, index) => !(index === 0 && token === "the") && !(index >= tokens.length - 2 && LEGAL_SUFFIXES.has(token)));
  const significant = baseTokens.filter((token) => !ACRONYM_STOP_WORDS.has(token));
  return {
    display,
    tokens: baseTokens,
    key: baseTokens.join(""),
    acronym: significant.map((token) => token[0]).join(""),
  };
}

export function findCompanyMatches(input, candidates, limit = 3) {
  const unique = [...new Set((candidates || []).map((value) => String(value || "").trim()).filter(Boolean))];
  const scored = unique.map((company) => ({ company, score: companyMatchScore(input, company), reason: companyMatchReason(input, company) }))
    .filter((item) => item.score >= 72)
    .sort((left, right) => right.score - left.score || left.company.localeCompare(right.company));
  return scored.slice(0, limit);
}

export function companyMatchScore(leftValue, rightValue) {
  const left = companyIdentity(leftValue);
  const right = companyIdentity(rightValue);
  if (!left.key || !right.key) return 0;
  if (left.display.toLowerCase() === right.display.toLowerCase()) return 100;
  if (left.key === right.key) return 98;
  if ((left.key.length <= 8 && left.key === right.acronym) || (right.key.length <= 8 && right.key === left.acronym)) return 96;
  const distance = levenshtein(left.key, right.key);
  const longest = Math.max(left.key.length, right.key.length);
  if (longest >= 7 && distance <= 1) return 92;
  if (longest >= 9 && distance <= 2) return 86;
  const overlap = tokenSimilarity(left.tokens, right.tokens);
  if (overlap >= .8) return 88;
  if (overlap >= .6) return 78;
  if (Math.min(left.key.length, right.key.length) >= 6 && (left.key.startsWith(right.key) || right.key.startsWith(left.key))) return 76;
  return 0;
}

function companyMatchReason(leftValue, rightValue) {
  const left = companyIdentity(leftValue);
  const right = companyIdentity(rightValue);
  if (left.key === right.key) return "Same name after punctuation and legal endings are normalized";
  if ((left.key.length <= 8 && left.key === right.acronym) || (right.key.length <= 8 && right.key === left.acronym)) return "Acronym matches the existing company";
  if (levenshtein(left.key, right.key) <= 2) return "Likely spelling variation";
  return "Company words substantially overlap";
}

function tokenSimilarity(left, right) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  return union ? intersection / union : 0;
}

function levenshtein(left, right) {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) current[column] = Math.min(current[column - 1] + 1, previous[column] + 1, previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1));
    previous = current;
  }
  return previous[right.length];
}
