"use client";

import { useEffect, useState } from "react";

type Question = { key: string; label: string };
type UploadedPhoto = { id: number; name: string };
type SurveyDetail = { projectName: string; milestone: string; milestoneDescription: string; recipientName: string; recipientEmail: string; responseDue: string; questions: Question[]; uploadedPhotos: UploadedPhoto[] };

export default function CustomerSurveyPage() {
  const [token, setToken] = useState("");
  const [survey, setSurvey] = useState<SurveyDetail | null>(null);
  const [completed, setCompleted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<{ respondentName: string; respondentEmail: string; comments: string; displayConsent: boolean; ratings: Record<string, number>; photoIds: number[] }>({ respondentName: "", respondentEmail: "", comments: "", displayConsent: false, ratings: {}, photoIds: [] });

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const nextToken = new URLSearchParams(window.location.search).get("token") || "";
      if (cancelled) return;
      setToken(nextToken);
      if (!nextToken) { setError("This survey link is incomplete."); setLoading(false); return; }
      fetch(`/api/customer-survey?token=${encodeURIComponent(nextToken)}`, { cache: "no-store" })
        .then(async (response) => { const result = await response.json() as { error?: string; completed?: boolean; survey?: SurveyDetail }; if (!response.ok) throw new Error(result.error || "This survey is unavailable."); if (!cancelled) { setSurvey(result.survey || null); setCompleted(Boolean(result.completed)); setForm((current) => ({ ...current, respondentName: result.survey?.recipientName || "", respondentEmail: result.survey?.recipientEmail || "", photoIds: (result.survey?.uploadedPhotos || []).map((photo) => photo.id) })); } })
        .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "This survey is unavailable."); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, []);

  async function uploadPhotos(files: FileList | null) {
    if (!files?.length || !survey) return;
    setUploading(true); setError("");
    try {
      for (const file of Array.from(files)) {
        const body = new FormData(); body.set("token", token); body.set("file", file);
        const response = await fetch("/api/customer-survey", { method: "PUT", body });
        const result = await response.json() as { error?: string; photo?: UploadedPhoto };
        if (!response.ok || !result.photo) throw new Error(result.error || `${file.name} could not be uploaded.`);
        setSurvey((current) => current ? { ...current, uploadedPhotos: [...current.uploadedPhotos, result.photo!] } : current);
        setForm((current) => ({ ...current, photoIds: [...current.photoIds, result.photo!.id] }));
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "A photo could not be uploaded."); }
    finally { setUploading(false); }
  }

  async function submit() {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/customer-survey", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, ...form }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Your survey could not be saved.");
      setCompleted(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Your survey could not be saved."); }
    finally { setSaving(false); }
  }

  const allRated = Boolean(survey?.questions.length) && survey!.questions.every((question) => form.ratings[question.key] >= 1 && form.ratings[question.key] <= 5);
  return <main className="public-survey-shell"><section className="public-survey-card"><header><div className="public-survey-mark">MC</div><div><p>MEFFORD CONTRACTING</p><h1>Project Check-In</h1><span>Four or five quick five-star questions. Every response is recorded and helps us improve.</span></div></header>
    {loading ? <div className="public-survey-state"><b>Opening your secure survey…</b></div> : completed ? <div className="public-survey-thanks"><span>✓</span><h2>Thank you.</h2><p>Your feedback has been securely recorded. Your rating counts in our totals; identifying details, comments, and photos remain private unless you gave display permission.</p></div> : error && !survey ? <div className="public-survey-state error"><b>Survey unavailable</b><span>{error}</span></div> : survey ? <>
      <section className="public-survey-project"><small>{survey.milestone.toUpperCase()}</small><h2>{survey.projectName}</h2><p>{survey.milestoneDescription}</p></section>
      <div className="public-survey-fields"><label>Your name<input value={form.respondentName} onChange={(event) => setForm({ ...form, respondentName: event.target.value })} autoComplete="name" /></label><label>Email <small>optional</small><input type="email" value={form.respondentEmail} onChange={(event) => setForm({ ...form, respondentEmail: event.target.value })} autoComplete="email" /></label></div>
      <section className="public-survey-ratings"><h2>How are we doing?</h2>{survey.questions.map((question) => <fieldset key={question.key}><legend>{question.label}</legend><div>{[1, 2, 3, 4, 5].map((rating) => <button type="button" key={rating} aria-label={`${rating} star${rating === 1 ? "" : "s"}`} className={form.ratings[question.key] === rating ? "selected" : ""} onClick={() => setForm({ ...form, ratings: { ...form.ratings, [question.key]: rating } })}><b>{"★".repeat(rating)}</b><span>{rating === 1 ? "Poor" : rating === 5 ? "Excellent" : `${rating} stars`}</span></button>)}</div></fieldset>)}</section>
      <div className="public-survey-long"><label>Comments <small>optional</small><textarea rows={5} value={form.comments} onChange={(event) => setForm({ ...form, comments: event.target.value })} placeholder="What went well? What could we improve?" /></label></div>
      <section className="public-survey-photos"><div><h2>Add project photos <small>optional</small></h2><p>Up To Eight Photos In Any Image Format, 15 MB Each.</p></div><label className="public-survey-upload"><input type="file" accept="image/*,.heic,.heif" multiple disabled={uploading || survey.uploadedPhotos.length >= 8} onChange={(event) => void uploadPhotos(event.target.files)} /><span>{uploading ? "Uploading…" : "Choose Photos"}</span></label>{survey.uploadedPhotos.length ? <ul>{survey.uploadedPhotos.map((photo) => <li key={photo.id}>✓ {photo.name}</li>)}</ul> : null}</section>
      <label className="public-survey-consent"><input type="checkbox" checked={form.displayConsent} onChange={(event) => setForm({ ...form, displayConsent: event.target.checked })} /><span><b>I permit Mefford Contracting to display my name, project, comments, and uploaded photos with this review.</b><small>Leaving this unchecked keeps those details private. Your star rating will still be included anonymously in the review average and totals.</small></span></label>
      {error ? <div className="public-survey-inline-error">{error}</div> : null}<button className="public-survey-submit" disabled={saving || uploading || !form.respondentName.trim() || !allRated} onClick={() => void submit()}>{saving ? "Saving securely…" : "Submit My Feedback"}</button>
    </> : null}
    <footer>Single-use secure survey · Project information stays private without consent · No payment or account information is requested</footer>
  </section></main>;
}
