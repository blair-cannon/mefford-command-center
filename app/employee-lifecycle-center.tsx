"use client";

import { useEffect, useState } from "react";
import { prepareDocumentImage } from "../lib/client-image-normalization";
import { PHOTO_UPLOAD_ACCEPT, isPhotoUpload } from "../lib/photo-uploads";

type ServiceRequest = { id: string; employeeName: string; category: string; subject: string; details: string; priority: string; status: string; routedRole: string; assignedToName: string; secondaryApprovalRole: string; primaryApprovedByName: string; resolution: string; confidential: boolean; createdAt: string };
type LeaveRequest = { id: string; employeeName: string; leaveType: string; startDate: string; endDate: string; requestedHours: number; status: string; approverName: string; decisionNote: string; calendarEventId: string };
type Profile = { employeeEmail: string; preferredName: string; phone: string; address1: string; address2: string; city: string; state: string; postalCode: string; emergencyContactName: string; emergencyContactPhone: string; emergencyContactRelationship: string; shirtSize: string; jacketSize: string; vestSize: string; communicationPreference: string; professionalBio: string };
type ProposalProfile = { employeeEmail: string; displayName: string; companyTitle: string; proposalRoleLabel: string; professionalSummary: string; credentialsJson: string; sectorsJson: string; deliveryMethodsJson: string; priorExperienceJson: string; headshotFileId: number | null; leadershipProfile: boolean; includeByDefault: boolean; status: string };
type ProposalExperience = { id: string; employeeEmail: string; projectName: string; projectLocation: string; role: string; projectType: string; completionDate: string; summary: string; photoFileIdsJson: string; status: string; customerPermission: string };
type Feedback = { id: string; feedbackType: string; employeeName: string; recipientEmail: string; rating: number | null; note: string; confidential: boolean; createdAt: string };
type LifecycleData = { myRequests: ServiceRequest[]; queue: ServiceRequest[]; myLeave: LeaveRequest[]; leaveQueue: LeaveRequest[]; balance: null | { planYear: number; availableHours: number; usedHours: number; source: string; updatedAt: string }; profile: Profile; proposalProfile: ProposalProfile; proposalExperience: ProposalExperience[]; proposalProfileQueue: ProposalProfile[]; proposalExperienceQueue: ProposalExperience[]; canApproveProposalProfiles: boolean; feedback: Feedback[]; canManage: boolean; roles: string[]; routes: Array<{ category: string; primary: string; secondary?: string; confidential?: boolean }>; policies: Record<string, string>; error?: string };

function useLifecycle() {
  const [data, setData] = useState<LifecycleData | null>(null);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  async function load() {
    const response = await fetch("/api/employee-lifecycle", { cache: "no-store" });
    const result = await response.json() as LifecycleData;
    if (!response.ok) throw new Error(result.error || "Employee Services Are Unavailable.");
    setData(result);
  }
  useEffect(() => { let cancelled = false; fetch("/api/employee-lifecycle", { cache: "no-store" }).then(async (response) => { const result = await response.json() as LifecycleData; if (!response.ok) throw new Error(result.error || "Employee Services Are Unavailable."); return result; }).then((result) => !cancelled && setData(result)).catch((error) => !cancelled && setNotice(error instanceof Error ? error.message : "Employee Services Are Unavailable.")); return () => { cancelled = true; }; }, []);
  async function action(payload: Record<string, unknown>) {
    setSaving(true); setNotice("");
    try {
      const response = await fetch("/api/employee-lifecycle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json() as { error?: string; notice?: string };
      if (!response.ok) throw new Error(result.error || "The Employee Update Could Not Be Saved.");
      await load(); setNotice(result.notice || "Saved."); return true;
    } catch (error) { setNotice(error instanceof Error ? error.message : "The Employee Update Could Not Be Saved."); return false; } finally { setSaving(false); }
  }
  return { data, notice, setNotice, saving, action };
}

export function EmployeeRequestsAndLeave({ initialCategory = "IT Issue" }: { initialCategory?: string } = {}) {
  const { data, notice, saving, action } = useLifecycle();
  const [mode, setMode] = useState<"request" | "leave">("request");
  const [request, setRequest] = useState({ category: initialCategory, subject: "", details: "", priority: "Normal" });
  const [leave, setLeave] = useState({ leaveType: "Vacation", startDate: "", endDate: "", requestedHours: 8, note: "" });
  if (!data) return <section className="employee-home-card employee-service-card"><span>{notice || "Opening Employee Requests..."}</span></section>;
  const route = data.routes.find((item) => item.category === request.category);
  const remaining = data.balance ? data.balance.availableHours - data.balance.usedHours : null;
  async function submitRequest() {
    if (await action({ action: "create_request", ...request })) setRequest({ ...request, subject: "", details: "", priority: "Normal" });
  }
  async function submitLeave() {
    if (await action({ action: "create_leave", ...leave })) setLeave({ leaveType: "Vacation", startDate: "", endDate: "", requestedHours: 8, note: "" });
  }
  return <section className="employee-home-card employee-service-card">
    <header><div><p className="eyebrow orange-text">HELP &amp; TIME OFF</p><h2>Ask Once. We Route It.</h2><span>Choose what you need. Command Center sends it to whoever holds the correct role today and keeps the answer with your request.</span></div><div className="employee-view-toggle"><button className={mode === "request" ? "active" : ""} onClick={() => setMode("request")}>Employee Request</button><button className={mode === "leave" ? "active" : ""} onClick={() => setMode("leave")}>Vacation / Leave</button></div></header>
    {notice ? <div className="accounting-notice" role="status">{notice}</div> : null}
    {mode === "request" ? <div className="employee-service-layout"><div className="employee-service-form"><label>What Do You Need?<select value={request.category} onChange={(event) => setRequest({ ...request, category: event.target.value })}>{data.routes.map((item) => <option key={item.category}>{item.category}</option>)}</select></label><div className="employee-route-preview"><i>→</i><span><small>ROUTES AUTOMATICALLY TO</small><strong>{route?.primary}</strong>{route?.secondary ? <em>Then {route.secondary} · Two Different Approvers Required</em> : null}</span></div><label>Short Subject<input value={request.subject} onChange={(event) => setRequest({ ...request, subject: event.target.value })} placeholder="What can we help with?" /></label><label>Details<textarea value={request.details} onChange={(event) => setRequest({ ...request, details: event.target.value })} placeholder="Tell us enough to handle it without making you repeat yourself." /></label><label>Priority<select value={request.priority} onChange={(event) => setRequest({ ...request, priority: event.target.value })}><option>Normal</option><option>Urgent</option></select></label><button className="primary-action large" disabled={saving || request.subject.trim().length < 3 || request.details.trim().length < 8} onClick={() => void submitRequest()}>{saving ? "Sending..." : "Send My Request"}</button></div><RequestHistory items={data.myRequests} /></div> : <div className="employee-service-layout"><div className="employee-service-form"><div className={`employee-balance ${remaining === null ? "unknown" : ""}`}><span><small>{new Date().getFullYear()} LEAVE BALANCE</small><strong>{remaining === null ? "Not Entered Yet" : `${remaining} Hours Available`}</strong><em>{remaining === null ? "Administration has not entered or connected an official balance. Nothing is guessed." : `${data.balance!.usedHours} used · ${data.balance!.availableHours} plan hours`}</em></span></div><label>Leave Type<select value={leave.leaveType} onChange={(event) => setLeave({ ...leave, leaveType: event.target.value })}><option>Vacation</option><option>Personal</option><option>Medical</option><option>Bereavement</option><option>Unpaid Leave</option></select></label><div className="field-grid"><label>Start Date<input type="date" value={leave.startDate} onChange={(event) => setLeave({ ...leave, startDate: event.target.value })} /></label><label>End Date<input type="date" value={leave.endDate} onChange={(event) => setLeave({ ...leave, endDate: event.target.value })} /></label><label>Hours Requested<input type="number" min="1" max="400" value={leave.requestedHours} onChange={(event) => setLeave({ ...leave, requestedHours: Number(event.target.value) })} /></label></div><label>Anything We Should Know?<textarea value={leave.note} onChange={(event) => setLeave({ ...leave, note: event.target.value })} placeholder="Optional scheduling context" /></label><button className="primary-action large" disabled={saving || !leave.startDate || !leave.endDate || leave.requestedHours < 1} onClick={() => void submitLeave()}>{saving ? "Sending..." : "Request Time Off"}</button></div><LeaveHistory items={data.myLeave} /></div>}
  </section>;
}

export function EmployeeProfileEditor() {
  const { data, notice, setNotice, saving, action } = useLifecycle();
  const [profileDraft, setProfile] = useState<Profile | null>(null);
  const [proposalDraft, setProposal] = useState<ProposalProfile | null>(null);
  const [uploading, setUploading] = useState(false);
  if (!data) return <section className="employee-home-card employee-profile-editor"><span>{notice || "Opening Your Profile..."}</span></section>;
  const profile = profileDraft || data.profile;
  const proposal = proposalDraft || data.proposalProfile;
  const change = (key: keyof Profile, value: string) => setProfile({ ...profile, [key]: value });
  const proposalChange = <K extends keyof ProposalProfile>(key: K, value: ProposalProfile[K]) => setProposal({ ...proposal, [key]: value });
  async function uploadHeadshot(file: File | undefined) {
    if (!file || uploading) return;
    setUploading(true);
    try {
      if (!isPhotoUpload(file)) throw new Error("Choose Any Recognized Image File For The Headshot.");
      const upload = async (source: File, category: string, revision: string) => {
        const form = new FormData(); form.set("file", source); form.set("projectId", "MEFFORD-PEOPLE"); form.set("category", category); form.set("revision", revision); form.set("access", "Employee + Company Owner");
        const response = await fetch("/api/files", { method: "POST", body: form });
        const result = await response.json() as { file?: { id: number }; error?: string };
        if (!response.ok || !result.file) throw new Error(result.error || "Headshot Could Not Be Uploaded.");
        return result.file;
      };
      let prepared: Awaited<ReturnType<typeof prepareDocumentImage>>;
      try {
        prepared = await prepareDocumentImage(file);
      } catch (conversionError) {
        const saved = await upload(file, `Proposal Headshots / ${proposal.employeeEmail}`, "Current Customer-Facing Headshot · Original Format");
        proposalChange("headshotFileId", saved.id);
        setNotice(`${file.name} Was Accepted And Stored. This Browser Could Not Create A Proposal-Ready Preview, So The Original Will Remain Downloadable. ${conversionError instanceof Error ? conversionError.message : ""}`.trim());
        return;
      }
      if (prepared.converted) await upload(file, `Proposal Headshots / ${proposal.employeeEmail}`, "Original Image Preserved");
      const saved = await upload(prepared.file, `Proposal Headshots / ${proposal.employeeEmail}`, prepared.converted ? `Current Customer-Facing Headshot · Document Copy From ${file.name}` : "Current Customer-Facing Headshot");
      proposalChange("headshotFileId", saved.id);
      setNotice(prepared.converted ? "Headshot Accepted. The Original Was Preserved And A Proposal-Ready Copy Was Created." : "Headshot Uploaded.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Headshot Could Not Be Uploaded.");
    } finally { setUploading(false); }
  }
  return <section className="employee-home-card employee-profile-editor"><header><div><p className="eyebrow orange-text">MY PROFILE</p><h2>Private Employee Information + Customer-Facing Experience</h2><span>Your home and emergency information stays private. Proposal content is stored separately and cannot appear in an owner packet until the Company Owner approves it.</span></div></header>{notice ? <div className="accounting-notice">{notice}</div> : null}<div className="employee-profile-form">
    <fieldset><legend>Private Employee Information</legend><div className="field-grid"><label>Preferred Name<input value={profile.preferredName} onChange={(event) => change("preferredName", event.target.value)} /></label><label>Phone<input type="tel" value={profile.phone} onChange={(event) => change("phone", event.target.value)} /></label><label>Best Way To Reach Me<select value={profile.communicationPreference} onChange={(event) => change("communicationPreference", event.target.value)}><option>Email</option><option>Teams</option><option>Phone</option><option>Text</option></select></label><label>Street Address<input value={profile.address1} onChange={(event) => change("address1", event.target.value)} /></label><label>Address Line 2 <small>Optional</small><input value={profile.address2} onChange={(event) => change("address2", event.target.value)} /></label><label>City<input value={profile.city} onChange={(event) => change("city", event.target.value)} /></label><label>State<input value={profile.state} onChange={(event) => change("state", event.target.value)} /></label><label>ZIP Code<input value={profile.postalCode} onChange={(event) => change("postalCode", event.target.value)} /></label><label>Emergency Contact<input value={profile.emergencyContactName} onChange={(event) => change("emergencyContactName", event.target.value)} /></label><label>Emergency Phone<input type="tel" value={profile.emergencyContactPhone} onChange={(event) => change("emergencyContactPhone", event.target.value)} /></label></div><button className="secondary-action" disabled={saving} onClick={() => void action({ action: "save_profile", profile })}>Save Private Profile</button></fieldset>
    <fieldset className="proposal-profile-fieldset"><legend>Customer-Facing Proposal Profile</legend><div className="proposal-profile-status"><strong>{proposal.status}</strong><span>{proposal.status === "Approved" ? "Available to Proposal Studio" : "Not available to proposals until Company Owner approval"}</span></div><div className="field-grid"><label>Display Name<input value={proposal.displayName} onChange={(event) => proposalChange("displayName", event.target.value)} /></label><label>Company Title<input value={proposal.companyTitle} onChange={(event) => proposalChange("companyTitle", event.target.value)} /></label><label>Role Label In Proposals<input value={proposal.proposalRoleLabel} onChange={(event) => proposalChange("proposalRoleLabel", event.target.value)} /></label><label>Customer-Safe Headshot <small>Any Image Format</small><input type="file" accept={PHOTO_UPLOAD_ACCEPT} disabled={uploading} onChange={(event) => { void uploadHeadshot(event.target.files?.[0]); event.target.value = ""; }} /></label></div><label>Professional Summary<textarea rows={5} value={proposal.professionalSummary} onChange={(event) => proposalChange("professionalSummary", event.target.value)} /></label><div className="field-grid"><label>Credentials <small>One per line</small><textarea rows={5} value={jsonLines(proposal.credentialsJson)} onChange={(event) => proposalChange("credentialsJson", linesJson(event.target.value))} /></label><label>Experience Before Mefford Contracting <small>One item per line</small><textarea rows={5} value={jsonLines(proposal.priorExperienceJson)} onChange={(event) => proposalChange("priorExperienceJson", linesJson(event.target.value))} /></label><label>Sectors <small>One per line</small><textarea rows={5} value={jsonLines(proposal.sectorsJson)} onChange={(event) => proposalChange("sectorsJson", linesJson(event.target.value))} /></label><label>Delivery Methods <small>One per line</small><textarea rows={5} value={jsonLines(proposal.deliveryMethodsJson)} onChange={(event) => proposalChange("deliveryMethodsJson", linesJson(event.target.value))} /></label></div><button className="primary-action large" disabled={saving || !proposal.displayName || !proposal.companyTitle || !proposal.professionalSummary} onClick={() => void action({ action: "save_proposal_profile", proposalProfile: proposal })}>{saving ? "Submitting..." : "Submit Customer-Facing Profile"}</button></fieldset>
    {data.proposalExperience.length ? <fieldset><legend>Mefford Contracting Project History</legend><p>Completed assignments are added automatically. Photos and summaries appear only after customer permission and Company Owner approval.</p><div className="proposal-experience-list">{data.proposalExperience.map((item) => <article key={item.id}><strong>{item.projectName}</strong><span>{item.role} · {item.completionDate}</span><small>{item.status} · Customer use: {item.customerPermission}</small></article>)}</div></fieldset> : null}
  </div></section>;
}

export function EmployeeExperienceCenter() {
  const { data, notice, saving, action } = useLifecycle();
  const [form, setForm] = useState({ feedbackType: "Idea", recipientEmail: "", rating: 5, note: "", anonymous: false });
  if (!data) return <section className="employee-home-card employee-experience-card"><span>{notice || "Opening Employee Voice..."}</span></section>;
  async function submit() { if (await action({ action: "submit_feedback", ...form })) setForm({ feedbackType: "Idea", recipientEmail: "", rating: 5, note: "", anonymous: false }); }
  return <section className="employee-home-card employee-experience-card"><header><div><p className="eyebrow orange-text">EMPLOYEE VOICE</p><h2>Ideas, Recognition And Real Concerns</h2><span>Send an idea, recognize a teammate, answer a pulse check, or raise a private concern without hunting for the right person.</span></div></header>{notice ? <div className="accounting-notice">{notice}</div> : null}<div className="employee-experience-layout"><div className="employee-service-form"><label>What Are You Sharing?<select value={form.feedbackType} onChange={(event) => setForm({ ...form, feedbackType: event.target.value, anonymous: false })}><option>Idea</option><option>Recognition</option><option>Pulse</option><option>Concern</option></select></label>{form.feedbackType === "Recognition" ? <label>Teammate Email<input type="email" value={form.recipientEmail} onChange={(event) => setForm({ ...form, recipientEmail: event.target.value })} placeholder="teammate@meffcon.com" /></label> : null}{form.feedbackType === "Pulse" ? <label>How Is Work Feeling?<select value={form.rating} onChange={(event) => setForm({ ...form, rating: Number(event.target.value) })}><option value={5}>5 · Great</option><option value={4}>4 · Good</option><option value={3}>3 · Mixed</option><option value={2}>2 · Difficult</option><option value={1}>1 · Need Help</option></select></label> : null}<label>Your Note<textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="Say what matters. Be specific enough that we can act." /></label>{["Pulse", "Concern"].includes(form.feedbackType) ? <label className="employee-anonymous"><input type="checkbox" checked={form.anonymous} onChange={(event) => setForm({ ...form, anonymous: event.target.checked })} /><span><strong>Send Without My Name</strong><small>Your employee identity will not be stored on this submission.</small></span></label> : null}<button className="primary-action large" disabled={saving || form.note.trim().length < 5} onClick={() => void submit()}>{saving ? "Sending..." : "Send"}</button></div><div className="employee-history"><header><span>RECENTLY SHARED WITH YOU</span><b>{data.feedback.length}</b></header>{data.feedback.filter((item) => item.recipientEmail || item.feedbackType === "Recognition").slice(0, 8).map((item) => <article key={item.id}><div><strong>{item.feedbackType}</strong><span>{item.note}</span></div><small>{item.employeeName} · {new Date(item.createdAt).toLocaleDateString("en-US")}</small></article>)}{!data.feedback.length ? <Empty label="Nothing Shared Yet" detail="Ideas and recognition will stay easy to find here." /> : null}</div></div></section>;
}

export function EmployeeManagerQueue() {
  const { data, notice, saving, action } = useLifecycle();
  const [resolution, setResolution] = useState<Record<string, string>>({});
  if (!data) return <section className="employee-home-card employee-manager-card"><span>{notice || "Opening Your Team Queue..."}</span></section>;
  if (!data.canManage && !data.queue.length && !data.leaveQueue.length) return null;
  return <section className="employee-home-card employee-manager-card"><header><div><p className="eyebrow orange-text">MY ROLE QUEUE</p><h2>Employee Requests Waiting On You</h2><span>This queue follows your live company role. If the role is reassigned, the work follows it.</span></div><b>{data.queue.filter((item) => !["Closed", "Approved"].includes(item.status)).length + data.leaveQueue.filter((item) => item.status === "Pending Review").length} OPEN</b></header>{notice ? <div className="accounting-notice">{notice}</div> : null}<div className="employee-manager-grid"><div className="employee-history"><header><span>SERVICE REQUESTS</span><b>{data.queue.length}</b></header>{data.queue.slice(0, 30).map((item) => <article key={item.id}><div><strong>{item.category} · {item.employeeName}</strong><span>{item.subject}</span><small>{item.details}</small><em>{item.status} · {item.routedRole}{item.secondaryApprovalRole ? ` → ${item.secondaryApprovalRole}` : ""}</em></div>{!["Closed"].includes(item.status) ? <div className="manager-request-actions">{item.status !== "Approved" ? <button disabled={saving} onClick={() => void action({ action: "approve_request", id: item.id })}>Approve Step</button> : null}<input value={resolution[item.id] || ""} onChange={(event) => setResolution({ ...resolution, [item.id]: event.target.value })} placeholder="Resolution" /><button disabled={saving || (resolution[item.id] || "").trim().length < 5} onClick={() => void action({ action: "close_request", id: item.id, resolution: resolution[item.id] })}>Close</button></div> : null}</article>)}{!data.queue.length ? <Empty label="No Service Requests" detail="Anything routed to your role will appear here." /> : null}</div><div className="employee-history"><header><span>VACATION / LEAVE</span><b>{data.leaveQueue.length}</b></header>{data.leaveQueue.slice(0, 30).map((item) => <article key={item.id}><div><strong>{item.employeeName} · {item.leaveType}</strong><span>{item.startDate} Through {item.endDate} · {item.requestedHours} Hours</span><em>{item.status}{item.calendarEventId ? " · Outlook Calendar Synced" : ""}</em></div>{item.status === "Pending Review" ? <div className="manager-request-actions"><button disabled={saving} onClick={() => void action({ action: "decide_leave", id: item.id, decision: "Approved" })}>Approve</button><button className="danger-outline-action" disabled={saving} onClick={() => void action({ action: "decide_leave", id: item.id, decision: "Declined", decisionNote: "Declined through employee role queue" })}>Decline</button></div> : null}</article>)}{!data.leaveQueue.length ? <Empty label="No Leave Requests" detail="Pending requests will appear here." /> : null}</div></div></section>;
}

export function ProposalProfileApprovalQueue() {
  const { data, notice, saving, action } = useLifecycle();
  if (!data || !data.canApproveProposalProfiles) return null;
  const profiles = data.proposalProfileQueue.filter((item) => item.status !== "Approved");
  const experience = data.proposalExperienceQueue.filter((item) => item.status !== "Approved" || item.customerPermission !== "Approved");
  return <section className="employee-home-card employee-manager-card"><header><div><p className="eyebrow orange-text">OWNER PROPOSAL APPROVALS</p><h2>Control What Customers See</h2><span>Only the Company Owner can approve customer-facing employee profiles, project history, and completion photos.</span></div><b>{profiles.length + experience.length} OPEN</b></header>{notice ? <div className="accounting-notice">{notice}</div> : null}<div className="employee-manager-grid"><div className="employee-history"><header><span>EMPLOYEE PROFILES</span><b>{profiles.length}</b></header>{profiles.map((item) => <article key={item.employeeEmail}><div><strong>{item.displayName || item.employeeEmail}</strong><span>{item.companyTitle} · {item.proposalRoleLabel}</span><small>{item.professionalSummary}</small><em>{item.status}</em></div><div className="manager-request-actions"><button disabled={saving} onClick={() => void action({ action: "approve_proposal_profile", employeeEmail: item.employeeEmail, status: "Approved" })}>Approve</button><button className="danger-outline-action" disabled={saving} onClick={() => void action({ action: "approve_proposal_profile", employeeEmail: item.employeeEmail, status: "Declined" })}>Decline</button></div></article>)}{!profiles.length ? <Empty label="No Profiles Waiting" detail="Submitted customer-facing profiles will appear here." /> : null}</div><div className="employee-history"><header><span>PROJECT EXPERIENCE + PHOTOS</span><b>{experience.length}</b></header>{experience.map((item) => <article key={item.id}><div><strong>{item.projectName}</strong><span>{item.role} · {item.employeeEmail}</span><small>{item.summary || `${item.projectLocation} · ${item.completionDate}`}</small><em>{item.status} · Customer permission: {item.customerPermission}</em></div><div className="manager-request-actions"><button disabled={saving} onClick={() => void action({ action: "approve_proposal_experience", id: item.id, status: "Approved", customerPermission: "Approved" })}>Approve For Customer Use</button><button className="danger-outline-action" disabled={saving} onClick={() => void action({ action: "approve_proposal_experience", id: item.id, status: "Declined", customerPermission: "Review Required" })}>Decline</button></div></article>)}{!experience.length ? <Empty label="No Experience Waiting" detail="Closeout-generated experience will appear here for review." /> : null}</div></div></section>;
}

function RequestHistory({ items }: { items: ServiceRequest[] }) {
  return <div className="employee-history"><header><span>MY REQUESTS</span><b>{items.length}</b></header>{items.slice(0, 20).map((item) => <article key={item.id}><div><strong>{item.subject}</strong><span>{item.category} · {item.routedRole}</span><em>{item.status}{item.assignedToName ? ` · With ${item.assignedToName}` : " · Awaiting Role Assignment"}</em>{item.resolution ? <small>Resolution: {item.resolution}</small> : null}</div><time>{new Date(item.createdAt).toLocaleDateString("en-US")}</time></article>)}{!items.length ? <Empty label="No Requests Yet" detail="Your requests and answers will stay here." /> : null}</div>;
}

function LeaveHistory({ items }: { items: LeaveRequest[] }) {
  return <div className="employee-history"><header><span>MY TIME-OFF REQUESTS</span><b>{items.length}</b></header>{items.slice(0, 20).map((item) => <article key={item.id}><div><strong>{item.leaveType} · {item.requestedHours} Hours</strong><span>{item.startDate} Through {item.endDate}</span><em>{item.status}{item.approverName ? ` · ${item.approverName}` : ""}{item.calendarEventId ? " · Calendar Synced" : ""}</em>{item.decisionNote ? <small>{item.decisionNote}</small> : null}</div></article>)}{!items.length ? <Empty label="No Time-Off Requests" detail="Request time off once and track the answer here." /> : null}</div>;
}

function Empty({ label, detail }: { label: string; detail: string }) {
  return <div className="employee-history-empty"><strong>{label}</strong><span>{detail}</span></div>;
}

function jsonLines(value: string) {
  try { const parsed = JSON.parse(value) as unknown; return Array.isArray(parsed) ? parsed.map(String).join("\n") : ""; } catch { return ""; }
}

function linesJson(value: string) {
  return JSON.stringify(value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean));
}
