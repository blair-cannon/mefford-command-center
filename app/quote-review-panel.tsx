"use client";

import { useEffect, useRef, useState } from "react";
import { CurrencyInput } from "./currency-input";
import type { BidPackageData, BidderRecord } from "../lib/procurement";
import { comparePackageQuotes } from "../lib/quote-comparison";
import { extractQuoteFields } from "../lib/quote-ocr.js";
import { recognizeMobileDocument } from "../lib/mobile-ocr";
import { emptyQuoteReview } from "../lib/quote-intake";

type Post = (action: string, payload: Record<string, unknown>, success: string) => Promise<unknown>;
const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const checks = [
  ["scopeComplete", "Scope coverage and gaps resolved"], ["exclusionsReviewed", "Exclusions reviewed"],
  ["alternatesReviewed", "Alternates and allowances reviewed"], ["clarificationsComplete", "Clarifications and schedule confirmed"],
  ["budgetCompared", "Comparable price checked against budget"],
] as const;

export function QuoteReviewPanel({ recordId, data, vendors, post, saving }: { recordId: string; data: BidPackageData; vendors: Array<{ id: string; name: string }>; post: Post; saving: boolean }) {
  const review = comparePackageQuotes(data);
  const [open, setOpen] = useState(false);
  const [intakeBusy, setIntakeBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  return <section className="estimate-quote-review">
    <header><div><h3>Scope Review & Low Subcontractor Recommendation</h3><p>{review.recommendation}</p></div><button className="primary" disabled={saving || intakeBusy} onClick={() => open ? setConfirmClose(true) : setOpen(true)}>{open ? "Close Quote Intake" : "Upload Received Quote"}</button></header>
    {confirmClose ? <div className="quote-review-warning"><p>Close this quote intake and discard its unsaved review?</p><button onClick={() => setConfirmClose(false)}>Keep Editing</button> <button onClick={() => { setOpen(false); setConfirmClose(false); }}>Discard Unsaved Intake</button></div> : null}

    {review.lowestQuoted && review.lowestQuoted.vendorId !== review.recommended?.vendorId ? <p className="quote-review-warning">Lowest quoted: {review.lowestQuoted.vendorName} · {money(review.lowestQuoted.quotedAmount)}. {review.lowestQuoted.issues.join(". ") || "Another bid has a lower comparable amount after adjustments."}</p> : null}
    {open ? <QuoteIntake key={recordId} recordId={recordId} data={data} vendors={vendors} post={post} onBusyChange={setIntakeBusy} onSaved={() => { setOpen(false); setConfirmClose(false); }} /> : null}
    <div className="quote-review-cards">{data.bidders.filter(bidder => bidder.revisions.length).map(bidder => <LevelingReview key={`${recordId}:${bidder.vendorId}:${bidder.revisions.at(-1)?.id}:${bidder.leveling.completedAt}`} recordId={recordId} data={data} bidder={bidder} post={post} saving={saving} />)}</div>
  </section>;
}

function LevelingReview({ recordId, data, bidder, post, saving }: { recordId: string; data: BidPackageData; bidder: BidderRecord; post: Post; saving: boolean }) {
  const [draft, setDraft] = useState(bidder.leveling);
  const review = comparePackageQuotes(data).quotes.find(item => item.vendorId === bidder.vendorId)!;
  return <details className="quote-leveling-card"><summary><strong>{bidder.vendorName}</strong><span>{review.eligible ? "Comparable · " : "Review Needed · "}{money(review.comparableAmount)}</span></summary>
    <ul className="quote-scope-matches">{review.coverage.map((item, i) => <li key={i}><span className={item.status === "Found In Quote" ? "scope-found" : "scope-unresolved"}>{item.status}</span><b>{item.requirement}</b><p>{item.evidence}</p></li>)}</ul>
    <fieldset disabled={saving}><div className="quote-leveling-checks">{checks.map(([key, label]) => <label key={key}><input type="checkbox" checked={draft[key]} onChange={event => setDraft(current => ({ ...current, [key]: event.target.checked }))} />{label}</label>)}</div>
    <label>Comparable price, including documented scope adjustments<CurrencyInput aria-label={`${bidder.vendorName} comparable price`} value={String(draft.leveledAmount)} onValueChange={value => setDraft(current => ({ ...current, leveledAmount: Number(value) }))} /></label>
    <label>Scope gap resolution — explain who covers each missing or excluded item<textarea rows={3} value={draft.scopeResolution || ""} onChange={event => setDraft(current => ({ ...current, scopeResolution: event.target.value }))} placeholder="Name the missing scope, responsible party, and amount included in the comparable price." /></label>
    <label>Price adjustments, clarifications, and review notes<textarea rows={3} value={draft.notes} onChange={event => setDraft(current => ({ ...current, notes: event.target.value }))} /></label>
    <button className="primary" disabled={saving} onClick={() => void post("update-leveling", { recordId, vendorId: bidder.vendorId, leveling: draft }, "Individual Scope And Price Review Saved")}>Save Review & Recalculate Recommendation</button></fieldset>
  </details>;
}

function QuoteIntake({ recordId, data, vendors, post, onSaved, onBusyChange }: { recordId: string; data: BidPackageData; vendors: Array<{ id: string; name: string }>; post: Post; onSaved: () => void; onBusyChange: (busy: boolean) => void }) {
  const [vendorId, setVendorId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [quote, setQuote] = useState(emptyQuoteReview);
  const uploadedFile = useRef<{ file: File; id: number } | null>(null);
  const readSequence = useRef(0);
  const saveActive = useRef(false);
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false); }, [busy, onBusyChange]);
  async function readFile(selected: File | null) {
    const sequence = ++readSequence.current;
    setFile(selected); setQuote(emptyQuoteReview()); uploadedFile.current = null; setNotice("");
    if (!selected) return;
    setBusy(true); setNotice("Reading the original quote…");
    try {
      const text = await recognizeMobileDocument(selected, progress => setNotice(progress.label));
      if (sequence !== readSequence.current) return;
      const extracted = extractQuoteFields(text);
      setQuote(current => ({ ...current, extractedPrice: extracted.price, reviewedPrice: extracted.price, extractedScope: extracted.scope, reviewedScope: extracted.scope, characterCount: extracted.characterCount, exclusions: extracted.exclusions, alternates: extracted.alternates, allowances: extracted.allowances, qualifications: extracted.qualifications, clarifications: extracted.clarifications, schedule: extracted.schedule }));
      setNotice(`${extracted.confidence}. ${extracted.priceWarnings.join(" ")} Confirm the suggested price and scope against the original. Enter exclusions and terms below.`);
    } catch { if (sequence === readSequence.current) setNotice("Text could not be extracted. Enter the price and scope after reviewing the original file; the original will still be preserved."); }
    finally { if (sequence === readSequence.current) setBusy(false); }
  }
  async function save() {
    if (!file || busy || saveActive.current) return;
    saveActive.current = true;
    setBusy(true); setNotice("Saving the original quote and review…");
    try {
      if (uploadedFile.current?.file !== file) {
        const form = new FormData(); form.set("file", file); form.set("projectId", data.folderProjectId); form.set("category", data.folderCategory); form.set("revision", `${recordId} · Original Subcontractor Quote`); form.set("access", "Internal Procurement");
        const response = await fetch("/api/files", { method: "POST", body: form });
        const result = await response.json() as { file?: { id: number }; error?: string };
        if (!response.ok || !result.file) throw new Error(result.error || "Original quote could not be saved");
        uploadedFile.current = { file, id: result.file.id };
      }
      const saved = await post("record-quote", { recordId, vendorId, quote: { ...quote, fileId: uploadedFile.current.id } }, "Original Quote Recorded · Scope Comparison Ready");
      if (saved) onSaved(); else setNotice("The original file was saved. The quote review was not recorded; correct the error shown above and try again.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Quote could not be saved"); }
    finally { saveActive.current = false; setBusy(false); }
  }
  return <div className="quote-intake-form"><h4>Record A Quote Received By Your Team</h4><p>Choose an existing vendor or add a Prospective Bidder below. Recording a received quote does not send an invitation.</p>
    <fieldset disabled={busy}><div className="procurement-form-grid"><label>Vendor<select value={vendorId} onChange={event => { setVendorId(event.target.value); setQuote(current => ({ ...current, confirmed: false })); }}><option value="">Choose vendor</option>{vendors.map(vendor => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></label><label>Original PDF or photo<input type="file" accept="application/pdf,image/*" disabled={busy} onChange={event => void readFile(event.target.files?.[0] || null)} /></label><label>Reviewed total price<CurrencyInput aria-label="Reviewed quote total" value={String(quote.reviewedPrice)} onValueChange={value => setQuote(current => ({ ...current, reviewedPrice: Number(value), confirmed: false }))} /></label><label className="wide">Actual scope included in quote<textarea rows={5} value={quote.reviewedScope} onChange={event => setQuote(current => ({ ...current, reviewedScope: event.target.value, confirmed: false }))} /></label>
    {(["exclusions", "alternates", "allowances", "qualifications", "clarifications", "schedule"] as const).map(field => <label key={field}>{field.charAt(0).toUpperCase() + field.slice(1)}<textarea rows={2} value={quote[field]} onChange={event => setQuote(current => ({ ...current, [field]: event.target.value, confirmed: false }))} /></label>)}</div>
    {data.addenda.map(addendum => <label key={addendum.id} className="quote-confirm"><input type="checkbox" checked={quote.acknowledgedAddenda.includes(addendum.id)} onChange={event => setQuote(current => ({ ...current, confirmed: false, acknowledgedAddenda: event.target.checked ? [...current.acknowledgedAddenda, addendum.id] : current.acknowledgedAddenda.filter(id => id !== addendum.id) }))} />Original quote confirms Addendum {addendum.number}: {addendum.title}</label>)}
    <label className="quote-confirm"><input type="checkbox" checked={quote.confirmed} onChange={event => setQuote(current => ({ ...current, confirmed: event.target.checked }))} />I reviewed the original file and confirmed the price, included scope, exclusions, and terms above.</label>
    </fieldset><p role="status">{notice}</p><button className="primary" disabled={busy || !file || !vendorId || !quote.confirmed || quote.reviewedPrice <= 0 || quote.reviewedScope.trim().length < 12} onClick={() => void save()}>Save Original & Review Quote</button>
  </div>;
}
