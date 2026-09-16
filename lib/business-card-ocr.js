const TITLE_WORDS = /\b(owner|president|vice president|vp|chief|ceo|cfo|coo|cto|director|manager|project manager|estimator|architect|engineer|sales|business development|account executive|superintendent|principal|partner|founder|consultant|coordinator|administrator)\b/i;
const COMPANY_WORDS = /\b(llc|l\.l\.c\.?|inc\.?|incorporated|corp\.?|corporation|company|co\.?|construction|contracting|contractors?|architects?|architecture|design|engineering|development|developers?|properties|realty|group|services|solutions|enterprises?|electric|electrical|plumbing|mechanical|roofing|interiors?|builders?|building|insurance|bank|university|association)\b/i;
const STREET_WORDS = /\b(?:street|st\.?|road|rd\.?|avenue|ave\.?|boulevard|blvd\.?|drive|dr\.?|lane|ln\.?|court|ct\.?|circle|cir\.?|parkway|pkwy\.?|highway|hwy\.?|route|way|place|pl\.?|trail|trl\.?)\b/i;
const STATE_CODES = "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";

export function extractBusinessCardFields(rawText) {
  const raw = String(rawText || "").replace(/--- (?:IMAGE|PAGE)[^\n]*---/gi, "\n");
  const lines = raw.split(/\r?\n/).map(cleanLine).filter(Boolean);
  const email = firstMatch(raw, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i).toLowerCase();
  const website = extractWebsite(raw);
  const phone = extractPhone(lines);
  const location = extractAddress(lines);
  const titleResult = extractTitle(lines);
  const nameResult = extractName(lines, titleResult.index);
  const company = extractCompany(lines, nameResult.index, titleResult.index);
  const detected = [nameResult.firstName, nameResult.lastName, company, titleResult.value, email, phone, location.address, location.city, location.state, location.postalCode, website].filter(Boolean).length;

  return {
    firstName: nameResult.firstName,
    lastName: nameResult.lastName,
    company,
    jobTitle: titleResult.value,
    email,
    phone,
    address: location.address,
    city: location.city,
    state: location.state,
    postalCode: location.postalCode,
    website,
    confidence: detected >= 7 ? "High Confidence" : detected >= 4 ? "Medium Confidence" : "Low Confidence",
    characterCount: raw.trim().length,
  };
}

function cleanLine(value) {
  return String(value || "").replace(/^[•|·]+|[•|·]+$/g, "").replace(/\s+/g, " ").trim();
}

function firstMatch(value, pattern) {
  return String(value || "").match(pattern)?.[0] || "";
}

function extractWebsite(raw) {
  const withoutEmails = String(raw || "").replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, " ");
  const candidates = withoutEmails.match(/\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}\/?[^\s,;|]*/gi) || [];
  const value = candidates.find((candidate) => {
    const normalized = candidate.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/[.)]+$/, "").toLowerCase();
    return !candidate.includes("@") && Boolean(normalized);
  }) || "";
  return value.replace(/^https?:\/\//i, "").replace(/[.)]+$/, "");
}

function extractPhone(lines) {
  const candidates = [];
  lines.forEach((line, index) => {
    const matches = line.match(/(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}(?:\s*(?:x|ext\.?|extension)\s*\d+)?/gi) || [];
    matches.forEach((value) => candidates.push({ value, score: /\b(mobile|cell|direct|m|c)\b/i.test(line) ? 2 : /\b(phone|office|p|o)\b/i.test(line) ? 1 : 0, index }));
  });
  const selected = candidates.sort((left, right) => right.score - left.score || left.index - right.index)[0]?.value || "";
  const extension = selected.match(/(?:x|ext\.?|extension)\s*(\d+)/i)?.[1] || "";
  const digits = selected.replace(/\D/g, "").replace(/^1(?=\d{10})/, "").slice(0, 10);
  if (digits.length !== 10) return selected.trim();
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}${extension ? ` ext. ${extension}` : ""}`;
}

function extractAddress(lines) {
  let address = "";
  let city = "";
  let state = "";
  let postalCode = "";
  const cityStatePattern = new RegExp(`^([A-Za-z .'-]+?),?\\s+(${STATE_CODES})\\s+(\\d{5}(?:-\\d{4})?)$`, "i");
  const combinedPattern = new RegExp(`^(.*?${STREET_WORDS.source}(?:\\s+(?:suite|ste\\.?|unit|#)\\s*[A-Z0-9-]+)?)\\s*,?\\s+([A-Za-z .'-]+?),?\\s+(${STATE_CODES})\\s+(\\d{5}(?:-\\d{4})?)$`, "i");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const commaLocation = line.match(new RegExp(`^(.*${STREET_WORDS.source}[^,]*(?:,\\s*(?:suite|ste\\.?|unit|#)\\s*[A-Z0-9-]+)?),\\s*([^,]+),\\s*(${STATE_CODES})\\s+(\\d{5}(?:-\\d{4})?)$`, "i"));
    if (commaLocation) {
      return { address: cleanLine(commaLocation[1]), city: cleanLine(commaLocation[2]), state: commaLocation[3].toUpperCase(), postalCode: commaLocation[4] };
    }
    const combined = line.match(combinedPattern);
    if (combined) {
      return { address: cleanLine(combined[1]), city: cleanLine(combined[2]), state: combined[3].toUpperCase(), postalCode: combined[4] };
    }
    if (!address && /^\d{1,8}\s+/.test(line) && STREET_WORDS.test(line)) {
      address = line.replace(/,\s*$/, "");
      const next = lines[index + 1]?.match(cityStatePattern);
      if (next) {
        city = cleanLine(next[1]);
        state = next[2].toUpperCase();
        postalCode = next[3];
      }
    }
    if (!city) {
      const location = line.match(cityStatePattern);
      if (location) {
        city = cleanLine(location[1]);
        state = location[2].toUpperCase();
        postalCode = location[3];
      }
    }
  }
  return { address, city, state, postalCode };
}

function extractTitle(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    const segments = lines[index].split(/\s*[|•·]\s*|\s+-\s+/).map(cleanLine).filter(Boolean);
    const titleSegment = segments.find((segment) => TITLE_WORDS.test(segment));
    if (titleSegment) return { value: titleSegment, index };
    const commaParts = lines[index].split(/,\s*/).map(cleanLine).filter(Boolean);
    if (commaParts.length > 1 && TITLE_WORDS.test(commaParts.slice(1).join(", "))) return { value: commaParts.slice(1).join(", "), index };
    if (TITLE_WORDS.test(lines[index]) && !looksLikeContactLine(lines[index])) return { value: lines[index], index };
  }
  return { value: "", index: -1 };
}

function extractName(lines, titleIndex) {
  const inline = lines.flatMap((line, index) => {
    const parts = line.split(/\s*[|•·]\s*|\s+-\s+|,\s*(?=[A-Za-z])/).map(cleanLine).filter(Boolean);
    return parts.filter((part) => looksLikeName(part)).map((part) => ({ line: part, index, score: index === titleIndex ? 4 : 0 }));
  });
  const candidates = lines.flatMap((line, index) => looksLikeName(line) ? [{ line, index, score: titleIndex >= 0 && index === titleIndex - 1 ? 5 : index < 5 ? 2 : 0 }] : []);
  const selected = [...inline, ...candidates].sort((left, right) => right.score - left.score || left.index - right.index)[0];
  if (!selected) return { firstName: "", lastName: "", index: -1 };
  const parts = selected.line.split(/\s+/).filter(Boolean);
  return { firstName: titleCase(parts[0]), lastName: parts.slice(1).map(titleCase).join(" "), index: selected.index };
}

function extractCompany(lines, nameIndex, titleIndex) {
  const eligible = lines.map((line, index) => ({ line, index })).filter(({ line }) => !looksLikeContactLine(line) && !STREET_WORDS.test(line) && !TITLE_WORDS.test(line) && !looksLikeName(line));
  const explicit = eligible.find(({ line }) => COMPANY_WORDS.test(line));
  if (explicit) return explicit.line;
  const adjacent = eligible.find(({ index }) => index === titleIndex + 1 || index === nameIndex - 1 || index === nameIndex + 1);
  return adjacent?.line || "";
}

function looksLikeName(line) {
  if (!line || looksLikeContactLine(line) || COMPANY_WORDS.test(line) || TITLE_WORDS.test(line) || STREET_WORDS.test(line) || /\d/.test(line)) return false;
  const parts = line.replace(/\b(Mr|Mrs|Ms|Dr)\.?\s+/i, "").split(/\s+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 4) return false;
  return parts.every((part) => /^[A-Za-z][A-Za-z'’-]*\.?$/.test(part));
}

function looksLikeContactLine(line) {
  return /@|(?:https?:\/\/|www\.)|\b[A-Z0-9.-]+\.(?:com|net|org|co|io|us)\b/i.test(line) || /(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}/.test(line);
}

function titleCase(value) {
  if (!value) return "";
  return value.split(/([-’'])/).map((part) => /^[-’']$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join("");
}
