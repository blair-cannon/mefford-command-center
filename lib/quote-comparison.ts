import { bidderIsLeveled, latestBid, missingAddendumAcknowledgments, type BidPackageData, type BidderRecord } from "./procurement";
import { roundMoney } from "./money.js";

const ignored = new Set("a an the and or of to for in on with all complete furnish provide install installation including includes include labor material materials work scope shall be per as required drawings specifications by from is are supply contractor subcontractor".split(" "));
const tokens = (value: string) => [...new Set(value.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter(word => word.length > 2 && !ignored.has(word)).map(word => word.replace(/s$/, "")))];
const parts = (value: string) => value.split(/\n|;|•/).map(part => part.replace(/^\s*[-*\d.)]+\s*/, "").trim()).filter(Boolean);
const overlaps = (required: string[], text: string) => { const found = new Set(tokens(text)); return required.filter(word => found.has(word)).length / Math.max(1, required.length); };

export function reviewQuoteScope(data: BidPackageData, bidder: BidderRecord) {
  const bid = latestBid(bidder);
  const quoted = bid?.ocr?.reviewedScope || "";
  const evidence = parts(quoted);
  const coverage = parts(data.scopeDescription).map(requirement => {
    const terms = tokens(requirement);
    const match = evidence.map(text => ({ text, score: overlaps(terms, text) })).sort((a, b) => b.score - a.score)[0];
    const explicitOmission = evidence.find(text => overlaps(terms, text) >= 0.6 && /\b(?:exclud\w*|not included|by others|owner[- ]supplied|not provided|not in (?:our|this) (?:scope|price|quote))\b/i.test(text));
    const excluded = terms.length > 0 && (overlaps(terms, bid?.exclusions || "") >= 0.6 || Boolean(explicitOmission));
    const status = excluded ? "Excluded" as const : terms.length && match?.score >= 0.75 ? "Found In Quote" as const : "Not Confirmed" as const;
    return { requirement, status, evidence: excluded ? explicitOmission || bid?.exclusions || "" : status === "Found In Quote" ? match.text : "No clear matching statement in the reviewed quote." };
  });
  const unresolved = coverage.filter(item => item.status !== "Found In Quote");
  const documentedResolution = String(bidder.leveling?.scopeResolution || "").trim();
  const issues: string[] = [];
  if (!bid) issues.push("No quote received");
  if (bid?.ocr?.status !== "Human Reviewed") issues.push("Original price and scope need human review");
  if (!coverage.length) issues.push("Package scope is missing");
  if (unresolved.length && documentedResolution.length < 20) issues.push(`${unresolved.length} scope requirement(s) need a documented resolution`);
  const addenda = missingAddendumAcknowledgments(data, bidder);
  if (addenda.length) issues.push(`${addenda.length} addendum acknowledgment(s) missing`);
  if (!bidderIsLeveled(bidder)) issues.push("Complete the five individual leveling checks");
  const amount = bidderIsLeveled(bidder) ? Number(bidder.leveling.leveledAmount) : Number(bid?.ocr?.reviewedPrice ?? bid?.total ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) issues.push("A positive comparable price is required");
  return { vendorId: bidder.vendorId, vendorName: bidder.vendorName, bidRevisionId: bid?.id || "", quotedAmount: roundMoney(bid?.ocr?.reviewedPrice ?? bid?.total ?? 0), comparableAmount: roundMoney(amount), budgetDifference: roundMoney(amount - data.budgetAmount), coverage, documentedResolution, issues, eligible: issues.length === 0 };
}

export function comparePackageQuotes(data: BidPackageData) {
  const quotes = data.bidders.filter(bidder => latestBid(bidder)).map(bidder => reviewQuoteScope(data, bidder));
  const priced = quotes.filter(quote => quote.quotedAmount > 0).sort((a, b) => a.quotedAmount - b.quotedAmount || a.vendorName.localeCompare(b.vendorName));
  const comparable = quotes.filter(quote => quote.eligible).sort((a, b) => a.comparableAmount - b.comparableAmount || a.vendorName.localeCompare(b.vendorName));
  const recommended = comparable[0] || null;
  return { method: "Quote text comparison with estimator confirmation", quotes, lowestQuoted: priced[0] || null, recommended, recommendation: recommended
    ? `${recommended.vendorName} has the lowest reviewed comparable price (${recommended.comparableAmount.toFixed(2)}). Scope checks, documented resolutions, and required addenda are complete. ${comparable.length} comparable quote(s).`
    : "No recommendation yet. Resolve the scope flags, confirm original quotes, and finish the individual leveling checks." };
}
