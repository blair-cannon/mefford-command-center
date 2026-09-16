"use client";

import { useEffect, useState } from "react";
import { extractQuoteFields } from "../lib/quote-ocr";
import { recognizeMobileDocument } from "../lib/mobile-ocr";
import { SignaturePad } from "./signature-pad";
import { CurrencyInput } from "./currency-input";
import { isPdfOrPhotoUpload } from "../lib/photo-uploads";
import { summaryDrilldownProps } from "./summary-drilldown";

type PortalData = {
  verified: boolean;
  invite: {
    id: string;
    company?: string;
    email?: string;
    emailHint?: string;
    expiresAt?: string;
    sessionExpiresAt?: string | null;
    locked?: boolean;
    expired?: boolean;
  };
  vendor?: {
    id: string;
    legalName: string;
    dbaName: string;
    vendorType: string;
    status: string;
    contactName: string;
    contactEmail: string;
    contactPhone: string;
    address: Record<string, unknown>;
    trades: string[];
    serviceAreas: string[];
  };
  compliance?: {
    blocked: boolean;
    missing: string[];
    expired: string[];
    activeOverride?: { reason: string; expiresAt: string } | null;
  };
  documents?: Array<{
    id: string;
    kind: string;
    fileName: string;
    status: string;
    expirationDate?: string | null;
    createdAt: string;
  }>;
  projectAccess?: Array<{
    id: string;
    projectId: string;
    projectName: string;
    status: string;
    trade: string;
    contractReference: string;
    costCode: string;
    committedAmount: string;
    permissions: string[];
    sharedRecords: string[];
    openQualityItems?: number;
  }>;
  submissions?: Array<{
    id: string;
    projectId: string;
    submissionType: string;
    title: string;
    amount: string;
    periodEnd?: string | null;
    status: string;
    attachmentName: string;
    apRecordId: string;
    submittedAt: string;
    payload: Record<string, unknown>;
  }>;
  correspondence?: Array<{
    id: string;
    projectId: string;
    recordType: "RFIs" | "Submittals";
    title: string;
    status: string;
    due: string;
    details: string;
    specificationReference: string;
    drawingReference: string;
    scheduleReference: string;
  }>;
  designReviews?: Array<{
    id: string;
    projectId: string;
    title: string;
    discipline: string;
    phase: string;
    due: string;
    instructions: string;
    revision: { id: string; label: string; fileId: number; fileName: string; description: string };
  }>;
  designUploads?: Array<{
    id: string;
    projectId: string;
    title: string;
    discipline: string;
    phase: string;
    status: string;
    latestRevision: string;
  }>;
  bidPackages?: Array<{
    id: string;
    projectId: string;
    title: string;
    status: string;
    trade: string;
    costCode: string;
    scopeDescription: string;
    deadline: string;
    openUntil: string;
    reopenedReason: string;
    acceptingBids: boolean;
    bidInstructions: string;
    addenda: Array<{ id: string; number: number; title: string; body: string; issuedAt: string; attachmentFileId: number; attachmentName: string; acknowledged: boolean }>;
    publicAnswers: Array<{ id: string; question: string; answer: string; issuedAt: string }>;
    questions: Array<{ id: string; question: string; askedAt: string; status: string }>;
    revisions: Array<{ id: string; revision: number; total: number; baseBid: number; fileId: number; fileName: string; receivedAt: string; superseded: boolean; ocr?: { status: string; extractedPrice: number; extractedScope: string; reviewedPrice: number; reviewedScope: string; reviewedBy: string; reviewedAt: string } }>;
    currentBid?: { revision: number; total: number; fileId: number; fileName: string; ocr?: { status: string; extractedPrice: number; extractedScope: string; reviewedPrice: number; reviewedScope: string; reviewedBy: string; reviewedAt: string } } | null;
    archive: { projectId: string; category: string; retention: string };
  }>;
  qualityItems?: Array<{
    id: string;
    projectId: string;
    title: string;
    status: string;
    due: string;
    description: string;
    exactLocation: string;
    inspectionStage: string;
    responsibleTrade: string;
    reference: string;
    beforePhotoFileIds: number[];
    afterPhotoFileIds: number[];
    canCorrect: boolean;
    canDesignerAccept: boolean;
    proposalOnly: boolean;
  }>;
  closeoutRequirements?: Array<{
    id: string;
    projectId: string;
    title: string;
    category: string;
    status: string;
    due: string;
    instructions: string;
    critical: boolean;
    nextApproval: string;
    submittedFiles: Array<{ fileId: number; fileName: string; uploadedAt: string }>;
    ownerReadOnly?: boolean;
  }>;
  lienWaivers?: Array<{
    id: string;
    projectId: string;
    title: string;
    status: string;
    formType: string;
    amount: number;
    throughDate: string;
    commitmentReference: string;
    payApplicationReference: string;
    exceptions: string;
    canSign: boolean;
  }>;
};

type PortalView = "Overview" | "Bidding" | "Compliance" | "Billing" | "Quality" | "Closeout" | "Collaboration";

const documentKinds = [
  "W-9",
  "General Liability",
  "Workers Compensation",
  "Auto Liability",
  "Umbrella Insurance",
  "Trade License",
  "Safety Program",
  "Final Lien Waiver",
  "Warranty",
  "O&M Manuals",
  "As-Built Drawings",
];

const initialBilling = {
  projectId: "",
  submissionType: "Invoice" as "Invoice" | "AIA Pay Application",
  invoiceNumber: "",
  applicationNumber: "",
  periodEnd: "",
  amount: "",
  description: "",
  finalApplication: false,
  scheduledValue: "",
  previousPayments: "",
  workCompleted: "",
  storedMaterials: "",
  approvedChangeOrders: "",
  retainagePercent: "10",
};

export function VendorPortal({ inviteId }: { inviteId: string }) {
  const [sessionToken, setSessionToken] = useState("");
  const [data, setData] = useState<PortalData | null>(null);
  const [code, setCode] = useState("");
  const [view, setView] = useState<PortalView>("Overview");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [profile, setProfile] = useState({ contactPhone: "", street: "", city: "", state: "KY", postalCode: "", trades: "", serviceAreas: "" });
  const [documentDraft, setDocumentDraft] = useState({ kind: "W-9", effectiveDate: "", expirationDate: "" });
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [billing, setBilling] = useState(initialBilling);
  const [billingFile, setBillingFile] = useState<File | null>(null);
  const [signingWaiverId, setSigningWaiverId] = useState("");
  const [waiverSignature, setWaiverSignature] = useState({ signerName: "", signerTitle: "", signatureImage: "", signatureConsent: false });
  const [selectedCorrespondenceId, setSelectedCorrespondenceId] = useState("");
  const [correspondenceResponse, setCorrespondenceResponse] = useState({ responseText: "", responseStatus: "Approved", costImpact: "No" as "No" | "Yes" | "Unknown", scheduleImpact: "No" as "No" | "Yes" | "Unknown" });
  const [correspondenceFile, setCorrespondenceFile] = useState<File | null>(null);
  const [selectedDesignReviewId, setSelectedDesignReviewId] = useState("");
  const [designReviewDraft, setDesignReviewDraft] = useState({ reviewDecision: "Approved" as "Approved" | "Approved As Noted" | "Revise And Resubmit" | "Rejected", reviewComments: "", costImpact: "No" as "No" | "Yes" | "Unknown", scheduleImpact: "No" as "No" | "Yes" | "Unknown" });
  const [designReviewFile, setDesignReviewFile] = useState<File | null>(null);
  const [designUploadDraft, setDesignUploadDraft] = useState({ projectId: "", recordId: "", revisionLabel: "", revisionDescription: "" });
  const [designUploadFile, setDesignUploadFile] = useState<File | null>(null);
  const [selectedBidId, setSelectedBidId] = useState("");
  const [bidDraft, setBidDraft] = useState({ baseBid: "", total: "", scope: "", alternates: "", allowances: "", exclusions: "", qualifications: "", clarifications: "", schedule: "" });
  const [bidFile, setBidFile] = useState<File | null>(null);
  const [quoteOcr, setQuoteOcr] = useState({ status: "idle" as "idle" | "scanning" | "ready" | "error", percent: 0, label: "", extractedPrice: 0, extractedScope: "", confidence: "", characterCount: 0, completedAt: "", confirmed: false });
  const [bidQuestion, setBidQuestion] = useState("");
  const [qualityProposal, setQualityProposal] = useState({ projectId: "", title: "", description: "", exactLocation: "", inspectionStage: "Preparatory" as "Preparatory" | "Work-In-Place" | "Final", responsibleTrade: "", reference: "" });
  const [qualityProposalFiles, setQualityProposalFiles] = useState<File[]>([]);
  const [qualityCorrectionId, setQualityCorrectionId] = useState("");
  const [qualityCorrection, setQualityCorrection] = useState({ acknowledgment: false, correctionDate: "", correctionNotes: "" });
  const [qualityCorrectionFiles, setQualityCorrectionFiles] = useState<File[]>([]);
  const [qualityDesignerId, setQualityDesignerId] = useState("");
  const [qualityDesigner, setQualityDesigner] = useState({ qualityDecision: "Accept" as "Accept" | "Reject", qualityComments: "" });
  const [closeoutRequirementId, setCloseoutRequirementId] = useState("");
  const [closeoutFiles, setCloseoutFiles] = useState<File[]>([]);
  const [closeoutNotes, setCloseoutNotes] = useState("");
  const [ownerWarranty, setOwnerWarranty] = useState({ projectId: "", title: "", exactLocation: "", description: "", urgency: "Normal" as "Normal" | "Urgent" });

  function headers(token = sessionToken): Record<string, string> {
    return token ? { "x-vendor-invite": inviteId, "x-vendor-session": token } : {};
  }

  async function load(token = sessionToken) {
    setLoading(true);
    try {
      const response = await fetch(`/api/vendor-portal?inviteId=${encodeURIComponent(inviteId)}`, { headers: headers(token) });
      const next = await response.json() as PortalData & { error?: string };
      if (!response.ok) throw new Error(next.error || "The Vendor Portal Is Unavailable.");
      if (next.verified && token) {
        const bidResponse = await fetch("/api/vendor-portal/bids", { headers: headers(token) });
        const bidResult = await bidResponse.json() as { packages?: PortalData["bidPackages"]; error?: string };
        if (bidResponse.ok) next.bidPackages = bidResult.packages || [];
      }
      setData(next);
      if (next.vendor) {
        const address = next.vendor.address || {};
        setProfile({
          contactPhone: next.vendor.contactPhone || "",
          street: String(address.street || ""),
          city: String(address.city || ""),
          state: String(address.state || "KY"),
          postalCode: String(address.postalCode || ""),
          trades: next.vendor.trades.join(", "),
          serviceAreas: next.vendor.serviceAreas.join(", "),
        });
        setBilling((current) => ({ ...current, projectId: current.projectId || next.projectAccess?.find((item) => item.permissions.includes("Invoice") || item.permissions.includes("AIA Pay Application"))?.projectId || "" }));
        setQualityProposal((current) => ({ ...current, projectId: current.projectId || next.projectAccess?.find((item) => item.permissions.includes("Quality Proposal"))?.projectId || "" }));
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Vendor Portal Is Unavailable.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = window.sessionStorage.getItem(`vendor-session:${inviteId}`) || "";
      setSessionToken(stored);
      void load(stored);
    }, 0);
    return () => window.clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteId]);

  async function verifyCode() {
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/vendor-portal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "verify-code", inviteId, code }),
      });
      const result = await response.json() as { verified?: boolean; sessionToken?: string; error?: string };
      if (!response.ok || !result.sessionToken) throw new Error(result.error || "The Code Could Not Be Verified.");
      window.sessionStorage.setItem(`vendor-session:${inviteId}`, result.sessionToken);
      setSessionToken(result.sessionToken);
      setNotice("Identity Verified. Controlled Portal Access Is Active.");
      await load(result.sessionToken);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Code Could Not Be Verified.");
    } finally {
      setSaving(false);
    }
  }

  async function updateProfile() {
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/vendor-portal", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers() },
        body: JSON.stringify({
          action: "update-profile",
          contactPhone: profile.contactPhone,
          address: { street: profile.street, city: profile.city, state: profile.state, postalCode: profile.postalCode },
          trades: splitList(profile.trades),
          serviceAreas: splitList(profile.serviceAreas),
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "The Profile Could Not Be Saved.");
      setNotice("Company Profile Saved.");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Profile Could Not Be Saved.");
    } finally {
      setSaving(false);
    }
  }

  async function bidAction(action: "ask-question" | "acknowledge-addendum", payload: Record<string, unknown>, success: string) {
    setSaving(true); setNotice("");
    try {
      const response = await fetch("/api/vendor-portal/bids", { method: "POST", headers: { "content-type": "application/json", ...headers() }, body: JSON.stringify({ action, ...payload }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "The Bid Portal Action Could Not Be Completed.");
      setNotice(success); setBidQuestion(""); await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "The Bid Portal Action Could Not Be Completed."); }
    finally { setSaving(false); }
  }

  async function scanBidQuote(file: File | null) {
    setBidFile(file);
    setQuoteOcr({ status: file ? "scanning" : "idle", percent: 0, label: file ? "Preparing quote OCR" : "", extractedPrice: 0, extractedScope: "", confidence: "", characterCount: 0, completedAt: "", confirmed: false });
    if (!file) return;
    if (!isPdfOrPhotoUpload(file)) {
      setQuoteOcr({ status: "ready", percent: 100, label: "This File Type Cannot Be OCR-Scanned. Enter The Price And Scope Below, Compare Them To The Original, And Confirm Your Review.", extractedPrice: 0, extractedScope: "", confidence: "Manual Review", characterCount: 0, completedAt: new Date().toISOString(), confirmed: false });
      return;
    }
    try {
      const text = await recognizeMobileDocument(file, (progress) => {
        setQuoteOcr((current) => ({ ...current, status: "scanning", percent: progress.percent, label: progress.label, confirmed: false }));
      });
      const extracted = extractQuoteFields(text);
      setBidDraft((current) => ({
        ...current,
        baseBid: current.baseBid || (extracted.price ? String(extracted.price) : ""),
        total: current.total || (extracted.price ? String(extracted.price) : ""),
        scope: current.scope || extracted.scope,
        exclusions: current.exclusions || extracted.exclusions,
        alternates: current.alternates || extracted.alternates,
        allowances: current.allowances || extracted.allowances,
        qualifications: current.qualifications || extracted.qualifications,
        clarifications: current.clarifications || extracted.clarifications,
        schedule: current.schedule || extracted.schedule,
      }));
      setQuoteOcr({ status: "ready", percent: 100, label: "Price and scope ready for human review", extractedPrice: extracted.price, extractedScope: extracted.scope, confidence: extracted.confidence, characterCount: extracted.characterCount, completedAt: new Date().toISOString(), confirmed: false });
    } catch (error) {
      setQuoteOcr({ status: "ready", percent: 100, label: `OCR Could Not Read This File. Enter The Price And Scope Below, Compare Them To The Original, And Confirm Your Review. ${error instanceof Error ? error.message : ""}`.trim(), extractedPrice: 0, extractedScope: "", confidence: "Manual Review", characterCount: 0, completedAt: new Date().toISOString(), confirmed: false });
    }
  }

  async function submitBid() {
    const selected = data?.bidPackages?.find((item) => `${item.projectId}|${item.id}` === selectedBidId);
    if (!selected || !bidFile) return;
    setSaving(true); setNotice("");
    try {
      const form = new FormData();
      form.set("file", bidFile); form.set("uploadType", "Bid Submission"); form.set("projectId", selected.projectId); form.set("recordId", selected.id);
      const uploadResponse = await fetch("/api/vendor-portal/files", { method: "POST", headers: headers(), body: form });
      const upload = await uploadResponse.json() as { fileId?: number; fileName?: string; error?: string };
      if (!uploadResponse.ok || !upload.fileId || !upload.fileName) throw new Error(upload.error || "The Permanent Quote File Could Not Be Stored.");
      const response = await fetch("/api/vendor-portal/bids", { method: "POST", headers: { "content-type": "application/json", ...headers() }, body: JSON.stringify({ action: "submit-bid", projectId: selected.projectId, recordId: selected.id, ...bidDraft, total: Number(bidDraft.total), baseBid: Number(bidDraft.baseBid || bidDraft.total), fileId: upload.fileId, fileName: upload.fileName, ocrReviewConfirmed: quoteOcr.confirmed, ocrExtractedPrice: quoteOcr.extractedPrice, ocrExtractedScope: quoteOcr.extractedScope, ocrCharacterCount: quoteOcr.characterCount, ocrCompletedAt: quoteOcr.completedAt }) });
      const result = await response.json() as { error?: string; notice?: string };
      if (!response.ok) throw new Error(result.error || "The Bid Could Not Be Submitted.");
      setNotice(result.notice || "Bid Received And Permanently Archived.");
      setBidDraft({ baseBid: "", total: "", scope: "", alternates: "", allowances: "", exclusions: "", qualifications: "", clarifications: "", schedule: "" }); setBidFile(null); setQuoteOcr({ status: "idle", percent: 0, label: "", extractedPrice: 0, extractedScope: "", confidence: "", characterCount: 0, completedAt: "", confirmed: false }); await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "The Bid Could Not Be Submitted."); }
    finally { setSaving(false); }
  }

  async function uploadDocument() {
    if (!documentFile) return;
    setSaving(true);
    setNotice("");
    try {
      const form = new FormData();
      form.set("file", documentFile);
      form.set("uploadType", "Compliance");
      form.set("kind", documentDraft.kind);
      form.set("effectiveDate", documentDraft.effectiveDate);
      form.set("expirationDate", documentDraft.expirationDate);
      const response = await fetch("/api/vendor-portal/files", { method: "POST", headers: headers(), body: form });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "The Document Could Not Be Uploaded.");
      setNotice(`${documentDraft.kind} Uploaded For Mefford Review.`);
      setDocumentFile(null);
      setDocumentDraft({ kind: "W-9", effectiveDate: "", expirationDate: "" });
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Document Could Not Be Uploaded.");
    } finally {
      setSaving(false);
    }
  }

  async function submitBilling() {
    if (!billingFile) {
      setNotice("Attach The Invoice Or Pay Application PDF Before Submitting.");
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      const form = new FormData();
      form.set("file", billingFile);
      form.set("uploadType", "Billing");
      form.set("projectId", billing.projectId);
      const upload = await fetch("/api/vendor-portal/files", { method: "POST", headers: headers(), body: form });
      const uploadResult = await upload.json() as { storageKey?: string; fileName?: string; error?: string };
      if (!upload.ok || !uploadResult.storageKey) throw new Error(uploadResult.error || "Billing Support Could Not Be Uploaded.");
      const response = await fetch("/api/vendor-portal", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers() },
        body: JSON.stringify({
          action: "submit-billing",
          ...billing,
          amount: billing.submissionType === "AIA Pay Application" ? aiaCalculated : Number(billing.amount),
          scheduledValue: Number(billing.scheduledValue),
          previousPayments: Number(billing.previousPayments),
          workCompleted: Number(billing.workCompleted),
          storedMaterials: Number(billing.storedMaterials),
          approvedChangeOrders: Number(billing.approvedChangeOrders),
          retainagePercent: Number(billing.retainagePercent),
          attachmentStorageKey: uploadResult.storageKey,
          attachmentName: uploadResult.fileName,
        }),
      });
      const result = await response.json() as { error?: string; notice?: string; status?: string; blockers?: string[] };
      if (!response.ok) throw new Error(result.error || "Billing Could Not Be Submitted.");
      setNotice(result.notice || `Billing Received With Status ${result.status}.`);
      setBilling((current) => ({ ...initialBilling, projectId: current.projectId }));
      setBillingFile(null);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Billing Could Not Be Submitted.");
    } finally {
      setSaving(false);
    }
  }

  async function signLienWaiver() {
    const waiver = data?.lienWaivers?.find((item) => item.id === signingWaiverId);
    if (!waiver || !waiverSignature.signerName.trim() || !waiverSignature.signerTitle.trim() || !waiverSignature.signatureImage || !waiverSignature.signatureConsent) {
      setNotice("Drawn Signature Authorized Signer Name Title And Electronic-Signature Consent Are Required.");
      return;
    }
    setSaving(true); setNotice("");
    try {
      const response = await fetch("/api/vendor-portal", { method: "POST", headers: { "content-type": "application/json", ...headers() }, body: JSON.stringify({ action: "sign-lien-waiver", projectId: waiver.projectId, recordId: waiver.id, ...waiverSignature }) });
      const result = await response.json() as { error?: string; notice?: string };
      if (!response.ok) throw new Error(result.error || "The Lien Waiver Could Not Be Signed.");
      setNotice(result.notice || "Lien Waiver Signed For Mefford Accounting Review.");
      setSigningWaiverId(""); setWaiverSignature({ signerName: "", signerTitle: "", signatureImage: "", signatureConsent: false }); await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "The Lien Waiver Could Not Be Signed."); }
    finally { setSaving(false); }
  }

  async function submitCorrespondenceResponse() {
    const record = data?.correspondence?.find((item) => item.id === selectedCorrespondenceId);
    if (!record || !correspondenceResponse.responseText.trim()) {
      setNotice("A Complete Response Is Required.");
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      let attachmentStorageKey = "";
      let attachmentName = "";
      if (correspondenceFile) {
        const form = new FormData();
        form.set("file", correspondenceFile);
        form.set("uploadType", "Collaboration");
        form.set("projectId", record.projectId);
        const upload = await fetch("/api/vendor-portal/files", { method: "POST", headers: headers(), body: form });
        const result = await upload.json() as { storageKey?: string; fileName?: string; error?: string };
        if (!upload.ok || !result.storageKey) throw new Error(result.error || "Response Support Could Not Be Uploaded.");
        attachmentStorageKey = result.storageKey;
        attachmentName = result.fileName || correspondenceFile.name;
      }
      const response = await fetch("/api/vendor-portal", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers() },
        body: JSON.stringify({
          action: "submit-correspondence-response",
          projectId: record.projectId,
          recordId: record.id,
          ...correspondenceResponse,
          attachmentStorageKey,
          attachmentName,
        }),
      });
      const result = await response.json() as { error?: string; notice?: string };
      if (!response.ok) throw new Error(result.error || "The Response Could Not Be Submitted.");
      setNotice(result.notice || "Response Received For Mefford PM Review.");
      setSelectedCorrespondenceId("");
      setCorrespondenceResponse({ responseText: "", responseStatus: "Approved", costImpact: "No", scheduleImpact: "No" });
      setCorrespondenceFile(null);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Response Could Not Be Submitted.");
    } finally {
      setSaving(false);
    }
  }

  async function submitDesignReview() {
    const review = data?.designReviews?.find((item) => item.id === selectedDesignReviewId);
    if (!review || !designReviewDraft.reviewComments.trim()) {
      setNotice("A Design Decision And Review Comments Are Required.");
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      let attachmentStorageKey = "";
      let attachmentName = "";
      if (designReviewFile) {
        const form = new FormData();
        form.set("file", designReviewFile);
        form.set("uploadType", "Collaboration");
        form.set("projectId", review.projectId);
        const upload = await fetch("/api/vendor-portal/files", { method: "POST", headers: headers(), body: form });
        const result = await upload.json() as { storageKey?: string; fileName?: string; error?: string };
        if (!upload.ok || !result.storageKey) throw new Error(result.error || "Design Review Support Could Not Be Uploaded.");
        attachmentStorageKey = result.storageKey;
        attachmentName = result.fileName || designReviewFile.name;
      }
      const response = await fetch("/api/vendor-portal", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers() },
        body: JSON.stringify({ action: "submit-design-review", projectId: review.projectId, recordId: review.id, ...designReviewDraft, attachmentStorageKey, attachmentName }),
      });
      const result = await response.json() as { error?: string; notice?: string };
      if (!response.ok) throw new Error(result.error || "The Design Review Could Not Be Submitted.");
      setNotice(result.notice || "Design Review Recorded For Mefford PM Action.");
      setSelectedDesignReviewId("");
      setDesignReviewDraft({ reviewDecision: "Approved", reviewComments: "", costImpact: "No", scheduleImpact: "No" });
      setDesignReviewFile(null);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Design Review Could Not Be Submitted.");
    } finally {
      setSaving(false);
    }
  }

  async function submitDesignRevision() {
    const designPackage = data?.designUploads?.find((item) => item.projectId === designUploadDraft.projectId && item.id === designUploadDraft.recordId);
    if (!designPackage || !designUploadDraft.revisionLabel.trim() || !designUploadDraft.revisionDescription.trim() || !designUploadFile) {
      setNotice("Choose A Design Package, Add The Revision Label And Narrative, And Attach The New File.");
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      const form = new FormData();
      form.set("file", designUploadFile);
      form.set("uploadType", "Design Revision");
      form.set("projectId", designPackage.projectId);
      form.set("recordId", designPackage.id);
      form.set("revisionLabel", designUploadDraft.revisionLabel);
      const upload = await fetch("/api/vendor-portal/files", { method: "POST", headers: headers(), body: form });
      const uploadResult = await upload.json() as { fileId?: number; fileName?: string; error?: string };
      if (!upload.ok || !uploadResult.fileId || !uploadResult.fileName) throw new Error(uploadResult.error || "The Design File Could Not Be Stored.");
      const response = await fetch("/api/vendor-portal", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers() },
        body: JSON.stringify({
          action: "submit-design-revision",
          projectId: designPackage.projectId,
          recordId: designPackage.id,
          revisionLabel: designUploadDraft.revisionLabel,
          revisionDescription: designUploadDraft.revisionDescription,
          designFileId: uploadResult.fileId,
          designFileName: uploadResult.fileName,
        }),
      });
      const result = await response.json() as { error?: string; notice?: string };
      if (!response.ok) throw new Error(result.error || "The Design Revision Could Not Be Submitted.");
      setNotice(result.notice || "Design Revision Received For Mefford Review.");
      setDesignUploadDraft({ projectId: "", recordId: "", revisionLabel: "", revisionDescription: "" });
      setDesignUploadFile(null);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Design Revision Could Not Be Submitted.");
    } finally {
      setSaving(false);
    }
  }

  async function uploadQualityEvidence(projectId: string, recordId: string, files: File[]) {
    const ids: number[] = [];
    for (const file of files) {
      const form = new FormData(); form.set("file", file); form.set("uploadType", "Quality Evidence"); form.set("projectId", projectId); if (recordId) form.set("recordId", recordId);
      const response = await fetch("/api/vendor-portal/files", { method: "POST", headers: headers(), body: form });
      const result = await response.json() as { fileId?: number; error?: string };
      if (!response.ok || !result.fileId) throw new Error(result.error || `${file.name} Could Not Be Stored As Quality Evidence.`);
      ids.push(result.fileId);
    }
    return ids;
  }

  async function submitQualityProposal() {
    if (!qualityProposalFiles.length) { setNotice("A Before Photo Is Required For A Quality Proposal."); return; }
    setSaving(true); setNotice("");
    try {
      const beforePhotoFileIds = await uploadQualityEvidence(qualityProposal.projectId, "", qualityProposalFiles);
      const response = await fetch("/api/vendor-portal", { method: "POST", headers: { "content-type": "application/json", ...headers() }, body: JSON.stringify({ action: "submit-quality-proposal", ...qualityProposal, beforePhotoFileIds }) });
      const result = await response.json() as { error?: string; notice?: string };
      if (!response.ok) throw new Error(result.error || "The Quality Proposal Could Not Be Submitted.");
      setNotice(result.notice || "Quality Proposal Submitted For Mefford PM Validation.");
      setQualityProposal((current) => ({ ...current, title: "", description: "", exactLocation: "", responsibleTrade: "", reference: "" })); setQualityProposalFiles([]); await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "The Quality Proposal Could Not Be Submitted."); }
    finally { setSaving(false); }
  }

  async function submitQualityCorrection() {
    const item = data?.qualityItems?.find((candidate) => candidate.id === qualityCorrectionId);
    if (!item || !qualityCorrectionFiles.length) { setNotice("Choose An Assigned Item And Attach After Photos."); return; }
    setSaving(true); setNotice("");
    try {
      const afterPhotoFileIds = await uploadQualityEvidence(item.projectId, item.id, qualityCorrectionFiles);
      const response = await fetch("/api/vendor-portal", { method: "POST", headers: { "content-type": "application/json", ...headers() }, body: JSON.stringify({ action: "submit-quality-correction", projectId: item.projectId, recordId: item.id, ...qualityCorrection, afterPhotoFileIds }) });
      const result = await response.json() as { error?: string; notice?: string };
      if (!response.ok) throw new Error(result.error || "The Correction Package Could Not Be Submitted.");
      setNotice(result.notice || "Correction Package Submitted For Superintendent Verification."); setQualityCorrectionId(""); setQualityCorrection({ acknowledgment: false, correctionDate: "", correctionNotes: "" }); setQualityCorrectionFiles([]); await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "The Correction Package Could Not Be Submitted."); }
    finally { setSaving(false); }
  }

  async function submitQualityDesignerAcceptance() {
    const item = data?.qualityItems?.find((candidate) => candidate.id === qualityDesignerId);
    if (!item) return;
    setSaving(true); setNotice("");
    try {
      const response = await fetch("/api/vendor-portal", { method: "POST", headers: { "content-type": "application/json", ...headers() }, body: JSON.stringify({ action: "submit-quality-designer-acceptance", projectId: item.projectId, recordId: item.id, ...qualityDesigner }) });
      const result = await response.json() as { error?: string; notice?: string };
      if (!response.ok) throw new Error(result.error || "The Designer Decision Could Not Be Submitted.");
      setNotice(result.notice || "Designer Quality Decision Recorded."); setQualityDesignerId(""); setQualityDesigner({ qualityDecision: "Accept", qualityComments: "" }); await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "The Designer Decision Could Not Be Submitted."); }
    finally { setSaving(false); }
  }

  async function submitCloseoutRequirement() {
    const requirement = data?.closeoutRequirements?.find((item) => `${item.projectId}|${item.id}` === closeoutRequirementId);
    if (!requirement || !closeoutFiles.length) { setNotice("Choose An Assigned Closeout Requirement And Attach At Least One File."); return; }
    setSaving(true); setNotice("");
    try {
      const fileIds: number[] = [];
      const fileNames: string[] = [];
      for (const file of closeoutFiles) {
        const form = new FormData(); form.set("file", file); form.set("uploadType", "Closeout Submission"); form.set("projectId", requirement.projectId); form.set("recordId", requirement.id);
        const upload = await fetch("/api/vendor-portal/files", { method: "POST", headers: headers(), body: form });
        const uploadResult = await upload.json() as { fileId?: number; fileName?: string; error?: string };
        if (!upload.ok || !uploadResult.fileId) throw new Error(uploadResult.error || `${file.name} Could Not Be Stored.`);
        fileIds.push(uploadResult.fileId); fileNames.push(uploadResult.fileName || file.name);
      }
      const response = await fetch("/api/vendor-portal", { method: "POST", headers: { "content-type": "application/json", ...headers() }, body: JSON.stringify({ action: "submit-closeout-requirement", projectId: requirement.projectId, recordId: requirement.id, fileIds, fileNames, notes: closeoutNotes }) });
      const result = await response.json() as { error?: string; notice?: string };
      if (!response.ok) throw new Error(result.error || "The Closeout Requirement Could Not Be Submitted.");
      setNotice(result.notice || "Closeout Requirement Submitted For Controlled Mefford Review."); setCloseoutFiles([]); setCloseoutNotes(""); setCloseoutRequirementId(""); await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "The Closeout Requirement Could Not Be Submitted."); }
    finally { setSaving(false); }
  }

  async function submitOwnerWarrantyRequest() {
    if (!ownerWarranty.projectId) return;
    setSaving(true); setNotice("");
    try {
      const response = await fetch("/api/vendor-portal", { method: "POST", headers: { "content-type": "application/json", ...headers() }, body: JSON.stringify({ action: "submit-owner-warranty-request", ...ownerWarranty }) });
      const result = await response.json() as { error?: string; notice?: string };
      if (!response.ok) throw new Error(result.error || "The Warranty Request Could Not Be Submitted.");
      setNotice(result.notice || "Warranty Request Routed To Mefford.");
      setOwnerWarranty((current) => ({ projectId: current.projectId, title: "", exactLocation: "", description: "", urgency: "Normal" }));
      await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "The Warranty Request Could Not Be Submitted."); }
    finally { setSaving(false); }
  }

  async function downloadOwnerCloseout(projectId: string, exportType: "master" | "thumb-drive") {
    setSaving(true); setNotice("");
    try {
      const response = await fetch(`/api/closeout/package?projectId=${encodeURIComponent(projectId)}&export=${exportType}`, { headers: headers() });
      if (!response.ok) { const result = await response.json() as { error?: string }; throw new Error(result.error || "The Closeout Package Could Not Be Downloaded."); }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const fileName = disposition.match(/filename="([^"]+)"/)?.[1] || `${projectId}_${exportType === "master" ? "Master_Closeout_Packet.pdf" : "Thumb_Drive_Closeout.zip"}`;
      const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = fileName; link.click(); URL.revokeObjectURL(url);
    } catch (error) { setNotice(error instanceof Error ? error.message : "The Closeout Package Could Not Be Downloaded."); }
    finally { setSaving(false); }
  }

  const selectedAccess = data?.projectAccess?.find((item) => item.projectId === billing.projectId);
  const billingAccess = data?.projectAccess?.filter((item) => item.permissions.includes("Invoice") || item.permissions.includes("AIA Pay Application")) || [];
  const aiaGross = Number(billing.workCompleted || 0) + Number(billing.storedMaterials || 0) + Number(billing.approvedChangeOrders || 0);
  const aiaRetainage = aiaGross * Number(billing.retainagePercent || 0) / 100;
  const aiaCalculated = Math.max(0, Math.round((aiaGross - aiaRetainage - Number(billing.previousPayments || 0)) * 100) / 100);

  if (loading && !data) return <main className="vendor-portal-page"><section className="vendor-code-card"><PortalMark /><p>Loading Controlled Vendor Access…</p></section></main>;

  if (!data?.verified || !data.vendor) {
    const inviteUnavailable = /invite is not available|vendor record not found/i.test(notice);
    return <main className="vendor-portal-page"><section className="vendor-code-card">
      <header><PortalMark /><span>MEFFORD CONTRACTING</span></header>
      <p className="eyebrow orange-text">VENDOR PORTAL · CONTROLLED ACCESS</p>
      <h1>{data?.invite.company || "Vendor Access"}</h1>
      <p>Enter the six-digit code sent to {data?.invite.emailHint || "the invited email address"}. This code is a second gate after Site sign-in.</p>
      {notice ? <div className="form-error">{notice}</div> : null}
      {inviteUnavailable || data?.invite.expired || data?.invite.locked ? <div className="vendor-hard-block"><strong>{inviteUnavailable ? "INVITE NOT AVAILABLE" : data?.invite.locked ? "INVITE LOCKED" : "INVITE EXPIRED"}</strong><span>Ask Mefford Contracting to issue a new controlled invite.</span></div> : <>
        <label>One-Time Code<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" /></label>
        <button className="primary-action large" disabled={saving || code.length !== 6} onClick={() => void verifyCode()}>{saving ? "Verifying…" : "Verify And Open Portal"}</button>
      </>}
      <footer><span>Code expires 7 days after issue.</span><span>Five failed attempts lock the invite.</span></footer>
    </section></main>;
  }

  const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const selectedBid = data.bidPackages?.find((item) => `${item.projectId}|${item.id}` === selectedBidId) || data.bidPackages?.[0] || null;
  const qualityProposalAccess = data.projectAccess?.filter((item) => item.permissions.includes("Quality Proposal")) || [];
  const qualityCorrections = data.qualityItems?.filter((item) => item.canCorrect) || [];
  const qualityDesignerReviews = data.qualityItems?.filter((item) => item.canDesignerAccept) || [];
  const ownerCloseoutAccess = data.projectAccess?.filter((item) => item.permissions.includes("Owner Closeout Read Only")) || [];
  return <main className="vendor-portal-page active">
    <header className="vendor-portal-header"><div><PortalMark /><span><b>MEFFORD</b><small>VENDOR PORTAL</small></span></div><div><strong>{data.vendor.legalName}</strong><small>Verified Controlled Session · {data.invite.sessionExpiresAt ? `Expires ${formatDateTime(data.invite.sessionExpiresAt)}` : "Active"}</small></div></header>
    <div className="vendor-portal-shell">
      <aside className="vendor-portal-nav"><p>WORKSPACE</p>{(["Overview", "Bidding", "Compliance", "Billing", "Quality", "Closeout", "Collaboration"] as PortalView[]).map((item) => <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}><span>{item.slice(0, 2).toUpperCase()}</span>{item}{item === "Compliance" && data.compliance?.blocked ? <b>!</b> : item === "Bidding" && data.bidPackages?.length ? <b>{data.bidPackages.length}</b> : item === "Quality" && data.qualityItems?.filter((quality) => quality.status !== "Closed").length ? <b>{data.qualityItems.filter((quality) => quality.status !== "Closed").length}</b> : item === "Closeout" && data.closeoutRequirements?.filter((requirement) => !["Approved", "Not Applicable"].includes(requirement.status)).length ? <b>{data.closeoutRequirements.filter((requirement) => !["Approved", "Not Applicable"].includes(requirement.status)).length}</b> : null}</button>)}<div><strong>Need Help?</strong><span>Contact your Mefford Project Manager. Portal access never exposes internal financials or unrelated jobs.</span></div></aside>
      <section className="vendor-portal-content">
        {notice ? <div className={/could not|required|block|locked|expired/i.test(notice) ? "form-error" : "inline-success"}>{notice}</div> : null}
        <header className="vendor-portal-title"><div><p className="eyebrow orange-text">{view.toUpperCase()}</p><h1>{view === "Overview" ? `Welcome, ${data.vendor.contactName}` : view}</h1><span>{view === "Overview" ? "Complete each requirement once; Command Center carries it into every approved project workflow." : view === "Bidding" ? "Submit confidential bids, revisions, questions, and addendum acknowledgments through your permanent procurement record." : view === "Compliance" ? "Upload current company, insurance, license, and safety records." : view === "Billing" ? "Submit standard invoices or AIA-style pay applications for controlled review." : view === "Quality" ? "Submit controlled proposals, trade correction packages, and assigned designer acceptance without seeing internal project data." : view === "Closeout" ? "Begin closeout uploads at any time. Every file stays permanently versioned and enters Mefford’s separate approval flow." : "Only information Mefford explicitly shares with your company appears here."}</span></div><i className={data.compliance?.blocked ? "blocked" : "clear"}>{data.compliance?.blocked ? "PAYMENT HOLD" : "COMPLIANCE CLEAR"}</i></header>

        {view === "Overview" ? <div className="vendor-portal-overview">
          <section className={data.compliance?.blocked ? "vendor-portal-alert blocked" : "vendor-portal-alert clear"}><span>{data.compliance?.blocked ? "!" : "✓"}</span><div><strong>{data.compliance?.blocked ? "Payment Is Held Until Compliance Is Complete" : "Required Compliance Is Current"}</strong><p>{data.compliance?.blocked ? `Bidding, award, contracts, project access, field work, invoice submission, and AP review remain active. Missing: ${data.compliance.missing.join(", ") || "None"}. Expired: ${data.compliance.expired.join(", ") || "None"}.` : "Submissions still require normal Mefford review and approval."}</p>{data.compliance?.activeOverride ? <small>Temporary Owner Approval: {data.compliance.activeOverride.reason} · Expires {formatDateTime(data.compliance.activeOverride.expiresAt)}</small> : null}</div></section>
          <section className="vendor-portal-metrics"><article {...summaryDrilldownProps({ title: "Assigned Vendor Projects", rows: (data.projectAccess || []).map((access) => ({ id: access.id, title: access.projectName, subtitle: `${access.projectId} · ${access.trade || "Scope Pending"}`, value: currency.format(Number(access.committedAmount || 0)), status: access.status, meta: access.contractReference || "No Contract Or PO Shared" })) })}><span>ASSIGNED PROJECTS</span><strong>{data.projectAccess?.length || 0}</strong><small>Explicitly Shared</small></article><article {...summaryDrilldownProps({ title: "Vendor Payment Hold Requirements", rows: [...(data.compliance?.missing || []).map((item) => ({ id: `missing-${item}`, title: item, status: "Missing", meta: "Required For Payment" })), ...(data.compliance?.expired || []).map((item) => ({ id: `expired-${item}`, title: item, status: "Expired", meta: "Renewal Required For Payment" }))] })}><span>PAYMENT REQUIREMENTS</span><strong>{(data.compliance?.missing.length || 0) + (data.compliance?.expired.length || 0)}</strong><small>Payment Hold Items</small></article><article {...summaryDrilldownProps({ title: "Vendor Billing Submissions", rows: (data.submissions || []).map((submission) => ({ id: submission.id, title: submission.title, subtitle: `${submission.projectId} · ${submission.submissionType}`, value: currency.format(Number(submission.amount || 0)), status: submission.status, meta: `${submission.attachmentName} · ${formatDateTime(submission.submittedAt)}`, onOpen: () => setView("Billing"), openLabel: "Open Billing →" })) })}><span>BILLING SUBMISSIONS</span><strong>{data.submissions?.length || 0}</strong><small>All Periods</small></article></section>
          <section className="vendor-profile-card"><div className="vendor-section-heading"><div><h2>Company Profile</h2><p>Mefford confirms legal identity; you may update operating details.</p></div><span>{data.vendor.status.toUpperCase()}</span></div><div className="vendor-profile-grid"><label>Legal Company Name<input readOnly value={data.vendor.legalName} /></label><label>Portal Email<input readOnly value={data.vendor.contactEmail} /></label><label>Phone<input value={profile.contactPhone} onChange={(event) => setProfile((current) => ({ ...current, contactPhone: event.target.value }))} /></label><label>Street Address<input value={profile.street} onChange={(event) => setProfile((current) => ({ ...current, street: event.target.value }))} /></label><label>City<input value={profile.city} onChange={(event) => setProfile((current) => ({ ...current, city: event.target.value }))} /></label><label>State<input value={profile.state} onChange={(event) => setProfile((current) => ({ ...current, state: event.target.value }))} /></label><label>Postal Code<input value={profile.postalCode} onChange={(event) => setProfile((current) => ({ ...current, postalCode: event.target.value }))} /></label><label>Trades / Services<input value={profile.trades} onChange={(event) => setProfile((current) => ({ ...current, trades: event.target.value }))} /></label><label>Service Areas<input value={profile.serviceAreas} onChange={(event) => setProfile((current) => ({ ...current, serviceAreas: event.target.value }))} /></label></div><button className="primary-action" disabled={saving} onClick={() => void updateProfile()}>{saving ? "Saving…" : "Save Company Profile"}</button></section>
          <section className="vendor-shared-projects"><div className="vendor-section-heading"><div><h2>Shared Projects</h2><p>Nothing outside these scopes is accessible.</p></div></div>{!data.projectAccess?.length ? <div className="vendor-empty"><b>No Project Access Yet</b><span>Complete compliance while Mefford prepares the assignment.</span></div> : data.projectAccess.map((access) => <article key={access.id}><header><span><b>{access.projectName}</b><small>{access.projectId} · {access.trade || "Scope Pending"}</small></span><i className={access.status.toLowerCase().replaceAll(" ", "-")}>{access.status}</i></header><dl><div><dt>Contract / PO</dt><dd>{access.contractReference || "Not Shared"}</dd></div><div><dt>Committed Amount</dt><dd>{currency.format(Number(access.committedAmount || 0))}</dd></div></dl></article>)}</section>
        </div> : null}

        {view === "Bidding" ? <div className="vendor-bidding">
          <section className="vendor-bid-confidentiality"><span>🔒</span><div><strong>Confidential Bid Workspace</strong><p>You can see only your company&apos;s quotes and revisions. Mefford sees bids as received; no bidder can see a competitor. Every quote, revision, question, addendum, and acknowledgment is retained permanently.</p></div></section>
          <div className="vendor-bid-layout"><aside><header><h2>Invited Packages</h2><span>{data.bidPackages?.length || 0}</span></header>{!data.bidPackages?.length ? <div className="vendor-empty"><b>No Bid Invitations</b><span>Only packages explicitly shared with your company appear here.</span></div> : data.bidPackages.map((item) => <button key={`${item.projectId}-${item.id}`} className={selectedBid?.id === item.id && selectedBid?.projectId === item.projectId ? "active" : ""} onClick={() => setSelectedBidId(`${item.projectId}|${item.id}`)}><b>{item.id} · {item.title}</b><small>{item.trade} · {item.status}</small><span>Due {formatDateTime(item.openUntil)}</span></button>)}</aside>
            <main>{selectedBid ? <>
              <section className="vendor-bid-heading"><div><p>{selectedBid.projectId} · {selectedBid.trade}</p><h2>{selectedBid.id} · {selectedBid.title}</h2><span>{selectedBid.scopeDescription}</span></div><i className={selectedBid.acceptingBids ? "open" : "locked"}>{selectedBid.acceptingBids ? "OPEN FOR BIDS" : "DEADLINE LOCKED"}</i></section>
              <section className="vendor-bid-facts"><div><span>Bid Deadline</span><b>{formatDateTime(selectedBid.openUntil)}</b></div><div><span>Cost Code</span><b>{selectedBid.costCode}</b></div><div><span>Permanent File Home</span><b>{selectedBid.archive.category}</b><small>{selectedBid.archive.projectId}</small></div></section>
              {selectedBid.reopenedReason ? <div className="vendor-hard-block neutral"><strong>AUDITED PM REOPENING</strong><span>{selectedBid.reopenedReason} · Open until {formatDateTime(selectedBid.openUntil)}</span></div> : null}
              <section className="vendor-bid-addenda"><header><div><h3>Addenda & Shared Answers</h3><p>All bidder identities are removed from shared Q&A.</p></div></header>{!selectedBid.addenda.length && !selectedBid.publicAnswers.length ? <div className="vendor-empty"><b>No Addenda Or Shared Answers</b></div> : <>{selectedBid.addenda.map((item) => <article key={item.id}><div><b>Addendum {item.number} · {item.title}</b><p>{item.body}</p><small>Issued {formatDateTime(item.issuedAt)}{item.attachmentName ? ` · ${item.attachmentName}` : ""}</small></div>{item.attachmentFileId ? <button onClick={() => window.open(`/api/vendor-portal/files?bidProjectId=${encodeURIComponent(selectedBid.projectId)}&bidRecordId=${encodeURIComponent(selectedBid.id)}&bidFileId=${item.attachmentFileId}`, "_blank", "noopener,noreferrer")}>Open Addendum ↗</button> : null}{item.acknowledged ? <i>ACKNOWLEDGED</i> : <button disabled={saving} onClick={() => void bidAction("acknowledge-addendum", { projectId: selectedBid.projectId, recordId: selectedBid.id, addendumId: item.id }, `Addendum ${item.number} Acknowledged`)}>Acknowledge</button>}</article>)}{selectedBid.publicAnswers.map((item) => <article key={item.id} className="qa"><div><b>{item.question}</b><p>{item.answer}</p><small>Shared With All Bidders · {formatDateTime(item.issuedAt)}</small></div></article>)}</>}</section>
              <section className="vendor-bid-question"><header><div><h3>Private Bidder Question</h3><p>Mefford will anonymize any answer shared with all bidders.</p></div></header><textarea rows={3} value={bidQuestion} onChange={(event) => setBidQuestion(event.target.value)} placeholder="Ask a scope, drawing, schedule, or commercial question" /><button disabled={saving || bidQuestion.trim().length < 8} onClick={() => void bidAction("ask-question", { projectId: selectedBid.projectId, recordId: selectedBid.id, question: bidQuestion }, "Private Question Sent To Mefford")}>Submit Private Question</button>{selectedBid.questions.map((item) => <small key={item.id}>{item.id} · {item.status} · {formatDateTime(item.askedAt)}</small>)}</section>
              <section className="vendor-bid-form">
                <header><div><h3>{selectedBid.currentBid ? `Submit Bid Revision ${selectedBid.revisions.length + 1}` : "Submit Confidential Bid"}</h3><p>Attach the quote first. Command Center scans price and scope before you review and submit.</p></div><span>OCR + HUMAN REVIEW</span></header>
                <label className="vendor-file-picker billing"><input type="file" onChange={(event) => void scanBidQuote(event.target.files?.[0] || null)} /><span>＋</span><b>{bidFile?.name || "Attach Quote Or Supporting File"}</b><small>Any File Type · 25 MB Maximum · OCR When Readable · Original Preserved</small></label>
                {quoteOcr.status !== "idle" ? <section className={`quote-ocr-review ${quoteOcr.status}`}>
                  <header><div><b>{quoteOcr.status === "scanning" ? "Scanning Quote" : quoteOcr.status === "ready" ? "Price And Scope Detected" : "Quote Scan Needs Attention"}</b><span>{quoteOcr.label}</span></div><i>{quoteOcr.status === "ready" ? quoteOcr.confidence.toUpperCase() : `${quoteOcr.percent}%`}</i></header>
                  {quoteOcr.status === "scanning" ? <div className="quote-ocr-progress"><span style={{ width: `${quoteOcr.percent}%` }} /></div> : null}
                  {quoteOcr.status === "ready" ? <><div className="quote-ocr-detected"><span><small>OCR PRICE</small><strong>{quoteOcr.extractedPrice ? currency.format(quoteOcr.extractedPrice) : "Not Detected"}</strong></span><span><small>OCR SCOPE</small><strong>{quoteOcr.extractedScope || "Not Detected — enter the complete quoted scope below"}</strong></span></div><label className="vendor-final-check"><input type="checkbox" checked={quoteOcr.confirmed} onChange={(event) => setQuoteOcr((current) => ({ ...current, confirmed: event.target.checked }))} /><span>I compared the price and scope below to the attached quote and confirm the reviewed values are correct.</span></label></> : null}
                </section> : null}
                <div className="vendor-bid-fields"><label>Base Bid<CurrencyInput min="0" value={bidDraft.baseBid} onValueChange={(value) => setBidDraft((current) => ({ ...current, baseBid: value, total: current.total || value }))} /></label><label>Total Bid<CurrencyInput min="0" value={bidDraft.total} onValueChange={(value) => setBidDraft((current) => ({ ...current, total: value }))} /></label><label className="wide">Quoted Scope<textarea rows={4} value={bidDraft.scope} onChange={(event) => setBidDraft((current) => ({ ...current, scope: event.target.value }))} placeholder="Review and complete the actual labor, material, equipment, and limits included in this quote" /></label><label>Alternates<textarea rows={2} value={bidDraft.alternates} onChange={(event) => setBidDraft((current) => ({ ...current, alternates: event.target.value }))} /></label><label>Allowances<textarea rows={2} value={bidDraft.allowances} onChange={(event) => setBidDraft((current) => ({ ...current, allowances: event.target.value }))} /></label><label>Exclusions<textarea rows={2} value={bidDraft.exclusions} onChange={(event) => setBidDraft((current) => ({ ...current, exclusions: event.target.value }))} /></label><label>Qualifications<textarea rows={2} value={bidDraft.qualifications} onChange={(event) => setBidDraft((current) => ({ ...current, qualifications: event.target.value }))} /></label><label>Clarifications<textarea rows={2} value={bidDraft.clarifications} onChange={(event) => setBidDraft((current) => ({ ...current, clarifications: event.target.value }))} /></label><label>Schedule / Duration<textarea rows={2} value={bidDraft.schedule} onChange={(event) => setBidDraft((current) => ({ ...current, schedule: event.target.value }))} /></label></div>
                <div className="vendor-hard-block neutral"><strong>PERMANENT VERSION CONTROL</strong><span>The original quote, OCR suggestions, reviewed price and scope, verified user, and received time remain together. Submission does not award work or create a commitment.</span></div><button className="primary-action large" disabled={saving || !selectedBid.acceptingBids || !bidFile || quoteOcr.status !== "ready" || !quoteOcr.confirmed || Number(bidDraft.total) <= 0 || bidDraft.scope.trim().length < 10} onClick={() => void submitBid()}>{saving ? "Submitting…" : selectedBid.currentBid ? "Submit Reviewed Bid Revision" : "Submit Reviewed Confidential Bid"}</button>
              </section>
              <section className="vendor-bid-history"><header><div><h3>Your Permanent Bid History</h3><p>Superseded versions remain visible and downloadable.</p></div><span>{selectedBid.revisions.length} REVISION{selectedBid.revisions.length === 1 ? "" : "S"}</span></header>{!selectedBid.revisions.length ? <div className="vendor-empty"><b>No Bid Submitted</b></div> : [...selectedBid.revisions].reverse().map((revision) => <article key={revision.id}><div><b>Revision {revision.revision} · {currency.format(revision.total)}</b><small>{revision.fileName} · {formatDateTime(revision.receivedAt)}</small></div><i>{revision.superseded ? "SUPERSEDED · RETAINED" : "CURRENT"}</i><button onClick={() => window.open(`/api/vendor-portal/files?bidProjectId=${encodeURIComponent(selectedBid.projectId)}&bidRecordId=${encodeURIComponent(selectedBid.id)}&bidFileId=${revision.fileId}`, "_blank", "noopener,noreferrer")}>Open Quote ↗</button></article>)}</section>
            </> : <div className="vendor-empty"><b>Select A Bid Package</b></div>}</main></div>
        </div> : null}

        {view === "Compliance" ? <div className="vendor-portal-compliance">
          <section className="vendor-upload-card"><div className="vendor-section-heading"><div><h2>Upload Compliance Or Closeout File</h2><p>Every upload enters Pending Review. A newer file supersedes only after Mefford approval.</p></div></div><div className="vendor-upload-grid"><label>Document Type<select value={documentDraft.kind} onChange={(event) => setDocumentDraft((current) => ({ ...current, kind: event.target.value }))}>{documentKinds.map((kind) => <option key={kind}>{kind}</option>)}</select></label><label>Effective Date<input type="date" value={documentDraft.effectiveDate} onChange={(event) => setDocumentDraft((current) => ({ ...current, effectiveDate: event.target.value }))} /></label><label>Expiration Date<input type="date" value={documentDraft.expirationDate} onChange={(event) => setDocumentDraft((current) => ({ ...current, expirationDate: event.target.value }))} /></label><label className="vendor-file-picker"><input type="file" onChange={(event) => setDocumentFile(event.target.files?.[0] || null)} /><span>＋</span><b>{documentFile?.name || "Choose Any File Type"}</b><small>25 MB Maximum</small></label></div><button className="primary-action" disabled={saving || !documentFile} onClick={() => void uploadDocument()}>{saving ? "Uploading…" : "Upload For Mefford Review"}</button></section>
          <section className="vendor-document-list"><div className="vendor-section-heading"><div><h2>Document Register</h2><p>Required company compliance remains separate from final closeout deliverables.</p></div><span>{data.documents?.length || 0} FILES</span></div>{!data.documents?.length ? <div className="vendor-empty"><b>No Documents Uploaded</b></div> : data.documents.map((document) => <article key={document.id}><span><b>{document.kind}</b><small>{document.fileName} · Uploaded {formatDate(document.createdAt)}</small></span><span>{document.expirationDate ? `Expires ${formatDate(document.expirationDate)}` : "No Expiration"}</span><i className={document.status.toLowerCase().replaceAll(" ", "-")}>{document.status}</i></article>)}</section>
        </div> : null}

        {view === "Billing" ? <div className="vendor-portal-billing">
          <section className="vendor-billing-form"><div className="vendor-section-heading"><div><h2>New Billing Submission</h2><p>Choose a standard invoice or an AIA-style pay application. Nothing is automatically approved, posted, or paid.</p></div></div><div className="vendor-billing-grid"><label>Project<select value={billing.projectId} onChange={(event) => setBilling((current) => ({ ...current, projectId: event.target.value }))}><option value="">Select Shared Project</option>{billingAccess.map((access) => <option key={access.id} value={access.projectId}>{access.projectName} · {access.status}</option>)}</select></label><label>Billing Type<select value={billing.submissionType} onChange={(event) => setBilling((current) => ({ ...current, submissionType: event.target.value as typeof billing.submissionType, amount: "" }))}><option>Invoice</option><option>AIA Pay Application</option></select></label><label>{billing.submissionType === "Invoice" ? "Invoice Number" : "Application Number"}<input value={billing.submissionType === "Invoice" ? billing.invoiceNumber : billing.applicationNumber} onChange={(event) => setBilling((current) => billing.submissionType === "Invoice" ? { ...current, invoiceNumber: event.target.value } : { ...current, applicationNumber: event.target.value })} /></label><label>Period Ending<input type="date" value={billing.periodEnd} onChange={(event) => setBilling((current) => ({ ...current, periodEnd: event.target.value }))} /></label></div>
            {billing.submissionType === "AIA Pay Application" ? <div className="vendor-aia-fields"><label>Scheduled Value<CurrencyInput min="0" value={billing.scheduledValue} onValueChange={(value) => setBilling((current) => ({ ...current, scheduledValue: value }))} /></label><label>Previous Payments<CurrencyInput min="0" value={billing.previousPayments} onValueChange={(value) => setBilling((current) => ({ ...current, previousPayments: value }))} /></label><label>Work Completed To Date<CurrencyInput min="0" value={billing.workCompleted} onValueChange={(value) => setBilling((current) => ({ ...current, workCompleted: value }))} /></label><label>Stored Materials<CurrencyInput min="0" value={billing.storedMaterials} onValueChange={(value) => setBilling((current) => ({ ...current, storedMaterials: value }))} /></label><label>Approved Change Orders<CurrencyInput allowNegative value={billing.approvedChangeOrders} onValueChange={(value) => setBilling((current) => ({ ...current, approvedChangeOrders: value }))} /></label><label>Retainage %<input type="number" min="0" max="100" step="0.1" value={billing.retainagePercent} onChange={(event) => setBilling((current) => ({ ...current, retainagePercent: event.target.value }))} /></label><div><span>CALCULATED CURRENT PAYMENT DUE</span><strong>{currency.format(aiaCalculated)}</strong><small>Gross earned less retainage and previous payments</small></div></div> : null}
            <div className="vendor-billing-grid"><label>Current Amount<CurrencyInput min="0" readOnly={billing.submissionType === "AIA Pay Application"} value={billing.submissionType === "AIA Pay Application" ? String(aiaCalculated) : billing.amount} onValueChange={(value) => setBilling((current) => ({ ...current, amount: value }))} /></label><label className="wide">Description / Notes<textarea rows={3} value={billing.description} onChange={(event) => setBilling((current) => ({ ...current, description: event.target.value }))} /></label></div>
            <label className="vendor-final-check"><input type="checkbox" checked={billing.finalApplication} onChange={(event) => setBilling((current) => ({ ...current, finalApplication: event.target.checked }))} /><span>This is the final invoice or pay application. Final lien waiver, warranty, O&M manuals, as-builts, and all assigned quality items must be approved before AP handoff.</span></label>
            <label className="vendor-file-picker billing"><input type="file" onChange={(event) => setBillingFile(event.target.files?.[0] || null)} /><span>＋</span><b>{billingFile?.name || "Attach Invoice Or Pay Application"}</b><small>Any File Type · 25 MB Maximum</small></label>
            {data.compliance?.blocked ? <div className="vendor-hard-block"><strong>PAYMENT HOLD</strong><span>Your invoice can proceed through intake and AP review. Payment cannot be approved until compliance is current or an active temporary Owner approval exists.</span></div> : null}
            {selectedAccess?.openQualityItems ? <div className={billing.finalApplication ? "vendor-hard-block" : "vendor-hard-block neutral"}><strong>{billing.finalApplication ? "FINAL PAYMENT QUALITY BLOCK" : "OPEN QUALITY WARNING"}</strong><span>{selectedAccess.openQualityItems} open quality item{selectedAccess.openQualityItems === 1 ? "" : "s"} remain assigned on this project. Progress billing may continue through normal review; final AP handoff is blocked until every item is accepted and closed.</span></div> : null}
            <button className="primary-action large" disabled={saving || !billing.projectId || !billingFile || !(billing.submissionType === "AIA Pay Application" ? aiaCalculated : Number(billing.amount))} onClick={() => void submitBilling()}>{saving ? "Submitting…" : "Submit For Mefford Review"}</button>
          </section>
          <section className="vendor-submission-history"><div className="vendor-section-heading"><div><h2>Submission History</h2><p>Status is visible without exposing internal project financials.</p></div></div>{!data.submissions?.length ? <div className="vendor-empty"><b>No Billing History</b></div> : data.submissions.map((submission) => <article key={submission.id}><span><b>{submission.title}</b><small>{submission.projectId} · Period {formatDate(submission.periodEnd || "")}</small></span><strong>{currency.format(Number(submission.amount))}</strong><i className={submission.status.toLowerCase().replaceAll(" ", "-")}>{submission.status}</i></article>)}</section>
          <section className="vendor-waiver-register"><div className="vendor-section-heading"><div><h2>Linked Lien Waivers</h2><p>Project billing creates the correct conditional request. Cleared payment creates an unsigned unconditional request; nothing is signed automatically.</p></div><span>{data.lienWaivers?.filter((item) => item.canSign).length || 0} TO SIGN</span></div>{!data.lienWaivers?.length ? <div className="vendor-empty"><b>No Lien Waiver Requests Yet</b><span>Requests appear here when Mefford receives linked project billing.</span></div> : data.lienWaivers.map((waiver) => <article key={waiver.id}><header><span><b>{waiver.id} · {waiver.title}</b><small>{waiver.projectId} · {waiver.commitmentReference} · Through {formatDate(waiver.throughDate)}</small></span><i>{waiver.status}</i></header><div><strong>{currency.format(waiver.amount)}</strong><span>{waiver.payApplicationReference}</span><small>Exceptions: {waiver.exceptions}</small></div>{waiver.canSign ? <button className="primary-action" onClick={() => { setSigningWaiverId(waiver.id); setWaiverSignature({ signerName: data.vendor?.contactName || "", signerTitle: "Authorized Representative", signatureImage: "", signatureConsent: false }); }}>Review And Sign</button> : <em>{waiver.status}</em>}</article>)}</section>
          {signingWaiverId ? <section className="vendor-waiver-sign"><div className="vendor-section-heading"><div><h2>Electronic Waiver Signature</h2><p>Review the amount, through-date, exceptions, and conditional or unconditional status above before signing.</p></div></div><label>Authorized Signer<input value={waiverSignature.signerName} onChange={(event) => setWaiverSignature((current) => ({ ...current, signerName: event.target.value }))} /></label><label>Signer Title<input value={waiverSignature.signerTitle} onChange={(event) => setWaiverSignature((current) => ({ ...current, signerTitle: event.target.value }))} /></label><SignaturePad value={waiverSignature.signatureImage} onChange={(signatureImage) => setWaiverSignature((current) => ({ ...current, signatureImage }))} label="Authorized Claimant Signature" /><label className="vendor-final-check"><input type="checkbox" checked={waiverSignature.signatureConsent} onChange={(event) => setWaiverSignature((current) => ({ ...current, signatureConsent: event.target.checked }))} /><span>I am authorized to sign for this company, I reviewed the payment-specific waiver, and I consent to this electronic signature and permanent audit record.</span></label><div className="vendor-hard-block neutral"><strong>MEFFORD ACCOUNTING REVIEW REMAINS</strong><span>Your signature does not approve, post, or pay the billing submission.</span></div><div className="vendor-response-actions"><button className="secondary-action" onClick={() => setSigningWaiverId("")}>Cancel</button><button className="primary-action large" disabled={saving || !waiverSignature.signerName || !waiverSignature.signerTitle || !waiverSignature.signatureImage || !waiverSignature.signatureConsent} onClick={() => void signLienWaiver()}>{saving ? "Signing…" : "Sign And Route To Accounting"}</button></div></section> : null}
        </div> : null}

        {view === "Quality" ? <div className="vendor-quality">
          <section className="vendor-quality-rule"><span>Q</span><div><strong>Controlled Quality Participation</strong><p>Outside parties may propose an issue, correct an assigned item, or provide an assigned designer decision. Only a Mefford PM can validate a proposal and create the formal project record.</p></div></section>
          <section className="vendor-quality-register"><div className="vendor-section-heading"><div><h2>Shared Quality Register</h2><p>Only items explicitly submitted by or assigned to your company appear here.</p></div><span>{data.qualityItems?.length || 0} SHARED</span></div>{!data.qualityItems?.length ? <div className="vendor-empty"><b>No Quality Items Shared</b><span>Assigned corrections, designer decisions, and submitted proposals will appear here.</span></div> : data.qualityItems.map((item) => <article key={`${item.projectId}-${item.id}`}><header><span><b>{item.id} · {item.title}</b><small>{item.projectId} · {item.inspectionStage} · Due {formatDate(item.due)}</small></span><i>{item.status}</i></header><p>{item.description}</p><dl><div><dt>Exact Location</dt><dd>{item.exactLocation || "Pending PM Validation"}</dd></div><div><dt>Responsible Trade</dt><dd>{item.responsibleTrade || "Pending PM Validation"}</dd></div><div><dt>Reference</dt><dd>{item.reference || "—"}</dd></div></dl>{item.proposalOnly ? <em>PROPOSAL ONLY · PM VALIDATION REQUIRED</em> : null}</article>)}</section>

          {qualityProposalAccess.length ? <section className="vendor-quality-form"><div className="vendor-section-heading"><div><h2>Propose A Quality Or Punch Item</h2><p>Exact location, responsible trade, description, and before photos are required. Submission does not assign or formalize the item.</p></div><span>PM VALIDATION GATE</span></div><div className="vendor-quality-grid"><label>Project<select value={qualityProposal.projectId} onChange={(event) => setQualityProposal((current) => ({ ...current, projectId: event.target.value }))}><option value="">Select Authorized Project</option>{qualityProposalAccess.map((access) => <option key={access.id} value={access.projectId}>{access.projectName}</option>)}</select></label><label>Inspection Stage<select value={qualityProposal.inspectionStage} onChange={(event) => setQualityProposal((current) => ({ ...current, inspectionStage: event.target.value as typeof qualityProposal.inspectionStage }))}><option>Preparatory</option><option>Work-In-Place</option><option>Final</option></select></label><label>Item Title<input value={qualityProposal.title} onChange={(event) => setQualityProposal((current) => ({ ...current, title: event.target.value }))} /></label><label>Exact Location<input value={qualityProposal.exactLocation} onChange={(event) => setQualityProposal((current) => ({ ...current, exactLocation: event.target.value }))} placeholder="Building, level, room, grid, elevation, or area" /></label><label>Responsible Trade<input value={qualityProposal.responsibleTrade} onChange={(event) => setQualityProposal((current) => ({ ...current, responsibleTrade: event.target.value }))} /></label><label>Drawing / Specification / Commissioning Reference<input value={qualityProposal.reference} onChange={(event) => setQualityProposal((current) => ({ ...current, reference: event.target.value }))} /></label><label className="wide">Observed Condition<textarea rows={4} value={qualityProposal.description} onChange={(event) => setQualityProposal((current) => ({ ...current, description: event.target.value }))} /></label><label className="vendor-file-picker wide"><input type="file" accept="image/*" multiple onChange={(event) => setQualityProposalFiles(Array.from(event.target.files || []))} /><span>＋</span><b>{qualityProposalFiles.length ? `${qualityProposalFiles.length} Before Photo${qualityProposalFiles.length === 1 ? "" : "s"} Selected` : "Attach Before Photos"}</b><small>Required · Permanent Quality Evidence</small></label></div><button className="primary-action large" disabled={saving || !qualityProposal.projectId || qualityProposal.title.trim().length < 4 || qualityProposal.description.trim().length < 10 || qualityProposal.exactLocation.trim().length < 3 || qualityProposal.responsibleTrade.trim().length < 2 || !qualityProposalFiles.length} onClick={() => void submitQualityProposal()}>{saving ? "Submitting…" : "Submit Proposal To Mefford PM"}</button></section> : null}

          <div className="vendor-quality-actions">
            <section className="vendor-quality-form"><div className="vendor-section-heading"><div><h2>Submit Trade Correction</h2><p>Acknowledgment, correction date, notes, and after photos are required before Superintendent verification.</p></div><span>{qualityCorrections.length} ASSIGNED</span></div>{!qualityCorrections.length ? <div className="vendor-empty"><b>No Correction Package Required</b></div> : <><label>Assigned Item<select value={qualityCorrectionId} onChange={(event) => setQualityCorrectionId(event.target.value)}><option value="">Select Assigned Item</option>{qualityCorrections.map((item) => <option key={`${item.projectId}-${item.id}`} value={item.id}>{item.projectId} · {item.id} · {item.title}</option>)}</select></label><label className="vendor-final-check"><input type="checkbox" checked={qualityCorrection.acknowledgment} onChange={(event) => setQualityCorrection((current) => ({ ...current, acknowledgment: event.target.checked }))} /><span>We acknowledge responsibility for reviewing and correcting this assigned condition.</span></label><label>Correction Date<input type="date" value={qualityCorrection.correctionDate} onChange={(event) => setQualityCorrection((current) => ({ ...current, correctionDate: event.target.value }))} /></label><label>Correction Notes<textarea rows={4} value={qualityCorrection.correctionNotes} onChange={(event) => setQualityCorrection((current) => ({ ...current, correctionNotes: event.target.value }))} /></label><label className="vendor-file-picker"><input type="file" accept="image/*" multiple onChange={(event) => setQualityCorrectionFiles(Array.from(event.target.files || []))} /><span>＋</span><b>{qualityCorrectionFiles.length ? `${qualityCorrectionFiles.length} After Photo${qualityCorrectionFiles.length === 1 ? "" : "s"} Selected` : "Attach After Photos"}</b><small>Required · Permanent Verification Evidence</small></label><button className="primary-action large" disabled={saving || !qualityCorrectionId || !qualityCorrection.acknowledgment || !qualityCorrection.correctionDate || qualityCorrection.correctionNotes.trim().length < 10 || !qualityCorrectionFiles.length} onClick={() => void submitQualityCorrection()}>{saving ? "Submitting…" : "Request Superintendent Verification"}</button></>}</section>
            <section className="vendor-quality-form"><div className="vendor-section-heading"><div><h2>Designer Acceptance</h2><p>Use only for items tied to design, specifications, or commissioning and explicitly assigned to your company.</p></div><span>{qualityDesignerReviews.length} ASSIGNED</span></div>{!qualityDesignerReviews.length ? <div className="vendor-empty"><b>No Designer Acceptance Required</b></div> : <><label>Assigned Item<select value={qualityDesignerId} onChange={(event) => setQualityDesignerId(event.target.value)}><option value="">Select Assigned Item</option>{qualityDesignerReviews.map((item) => <option key={`${item.projectId}-${item.id}`} value={item.id}>{item.projectId} · {item.id} · {item.title}</option>)}</select></label><fieldset><legend>Designer Decision</legend>{(["Accept", "Reject"] as const).map((decision) => <label key={decision} className={qualityDesigner.qualityDecision === decision ? "active" : ""}><input type="radio" checked={qualityDesigner.qualityDecision === decision} onChange={() => setQualityDesigner((current) => ({ ...current, qualityDecision: decision }))} />{decision}</label>)}</fieldset><label>Designer Comments<textarea rows={5} value={qualityDesigner.qualityComments} onChange={(event) => setQualityDesigner((current) => ({ ...current, qualityComments: event.target.value }))} /></label><div className="vendor-hard-block neutral"><strong>SEPARATE PM CLOSE GATE</strong><span>Your decision becomes permanent evidence. Mefford PM acceptance remains a separate final closure step.</span></div><button className="primary-action large" disabled={saving || !qualityDesignerId || qualityDesigner.qualityComments.trim().length < 8} onClick={() => void submitQualityDesignerAcceptance()}>{saving ? "Recording…" : "Record Designer Decision"}</button></>}</section>
          </div>
        </div> : null}

        {view === "Closeout" ? <div className="vendor-closeout">
          <section className="vendor-closeout-rule"><span>CL</span><div><strong>{ownerCloseoutAccess.length ? "PERMANENT OWNER CLOSEOUT ACCESS" : "START EARLY · FINAL PAYMENT GATE"}</strong><p>{ownerCloseoutAccess.length ? "Review closeout progress, download accepted Owner packages, and route warranty requests through Mefford without seeing internal project financials." : "Upload warranties, O&M manuals, training media, as-builts, lien releases, and final records as soon as they are ready. The 90-day reminders do not limit access."}</p></div></section>
          {ownerCloseoutAccess.length ? <><section className="owner-portal-package-grid">{ownerCloseoutAccess.map((access) => <article key={access.id}><span>READ-ONLY · PERMANENT</span><h2>{access.projectName}</h2><p>{access.projectId} · Accepted items are compiled from the controlled approval record.</p><div><button disabled={saving} onClick={() => void downloadOwnerCloseout(access.projectId, "master")}>Download Master PDF</button><button disabled={saving} onClick={() => void downloadOwnerCloseout(access.projectId, "thumb-drive")}>Download Media ZIP</button></div></article>)}</section><section className="owner-warranty-portal"><div className="vendor-section-heading"><div><h2>Request Warranty Service</h2><p>Requests route to Mefford first and remain in the permanent project history.</p></div></div><label>Project<select value={ownerWarranty.projectId} onChange={(event) => setOwnerWarranty((current) => ({ ...current, projectId: event.target.value }))}><option value="">Select Project</option>{ownerCloseoutAccess.map((access) => <option key={access.id} value={access.projectId}>{access.projectName}</option>)}</select></label><label>Issue Title<input value={ownerWarranty.title} onChange={(event) => setOwnerWarranty((current) => ({ ...current, title: event.target.value }))} /></label><label>Exact Location<input value={ownerWarranty.exactLocation} onChange={(event) => setOwnerWarranty((current) => ({ ...current, exactLocation: event.target.value }))} /></label><label>Urgency<select value={ownerWarranty.urgency} onChange={(event) => setOwnerWarranty((current) => ({ ...current, urgency: event.target.value as "Normal" | "Urgent" }))}><option>Normal</option><option>Urgent</option></select></label><label className="wide">Description<textarea rows={4} value={ownerWarranty.description} onChange={(event) => setOwnerWarranty((current) => ({ ...current, description: event.target.value }))} /></label><button className="primary-action" disabled={saving || !ownerWarranty.projectId || ownerWarranty.title.trim().length < 4 || ownerWarranty.exactLocation.trim().length < 3 || ownerWarranty.description.trim().length < 10} onClick={() => void submitOwnerWarrantyRequest()}>Route Warranty Request To Mefford</button></section></> : null}
          <section className="vendor-closeout-register"><div className="vendor-section-heading"><div><h2>{ownerCloseoutAccess.length ? "Project Closeout Status" : "Your Assigned Closeout Requirements"}</h2><p>{ownerCloseoutAccess.length ? "Read-only status shows completed and remaining approval gates. Internal financial values and unrelated project records remain private." : "Each requirement shows its current status and the next Mefford approval. You never see another bidder, trade, budget, or internal financial record."}</p></div><span>{data.closeoutRequirements?.length || 0} {ownerCloseoutAccess.length ? "ITEMS" : "ASSIGNED"}</span></div>{!data.closeoutRequirements?.length ? <div className="vendor-empty"><b>No Closeout Requirements Assigned Yet</b><span>Requirements appear automatically after the project commitment is connected.</span></div> : data.closeoutRequirements.map((item) => <article key={`${item.projectId}-${item.id}`} className={["Approved", "Not Applicable"].includes(item.status) ? "complete" : "open"}><header><span><b>{item.id} · {item.title}</b><small>{item.projectId} · {item.category} · Due {formatDate(item.due)}</small></span><i>{item.status}</i></header><p>{item.instructions}</p><div><span><b>{item.submittedFiles.length}</b><small>Permanent File{item.submittedFiles.length === 1 ? "" : "s"}</small></span><span><b>{item.nextApproval}</b><small>Next Approval</small></span><span><b>{item.critical ? "HIGH" : "STANDARD"}</b><small>Closeout Weight</small></span></div>{!item.ownerReadOnly && !["Approved", "Not Applicable"].includes(item.status) ? <button className="primary-action" onClick={() => setCloseoutRequirementId(`${item.projectId}|${item.id}`)}>Upload / Correct This Requirement</button> : ["Approved", "Not Applicable"].includes(item.status) ? <em>✓ ACCEPTED INTO PROJECT CLOSEOUT</em> : <em>READ-ONLY · APPROVALS REMAIN</em>}</article>)}</section>
          {closeoutRequirementId ? <section className="vendor-closeout-form"><div className="vendor-section-heading"><div><h2>Submit {closeoutRequirementId.split("|")[1]}</h2><p>Every new file creates a permanent version. Mefford review and final payment remain separate gates.</p></div></div><label className="vendor-file-picker"><input type="file" multiple onChange={(event) => setCloseoutFiles(Array.from(event.target.files || []))} /><span>＋</span><b>{closeoutFiles.length ? `${closeoutFiles.length} File${closeoutFiles.length === 1 ? "" : "s"} Selected` : "Choose Closeout Files"}</b><small>PDF, Image, Or Video · 25 MB Each</small></label><label>Submission Notes<textarea rows={4} value={closeoutNotes} onChange={(event) => setCloseoutNotes(event.target.value)} placeholder="Identify equipment, location, warranty dates, revision, or other information Mefford should verify." /></label><div className="vendor-hard-block neutral"><strong>NO AUTOMATIC APPROVAL OR PAYMENT</strong><span>Submission records your company’s acknowledgment and routes the next Mefford review. It cannot approve an invoice, release retainage, post a payment, or close the project.</span></div><div className="vendor-response-actions"><button className="secondary-action" onClick={() => { setCloseoutRequirementId(""); setCloseoutFiles([]); setCloseoutNotes(""); }}>Cancel</button><button className="primary-action large" disabled={saving || !closeoutFiles.length} onClick={() => void submitCloseoutRequirement()}>{saving ? "Submitting…" : "Submit Permanent Closeout Version"}</button></div></section> : null}
        </div> : null}

        {view === "Collaboration" ? <div className="vendor-collaboration">
          <section className="vendor-design-upload-form"><div className="vendor-section-heading"><div><h2>Upload New Design Revision</h2><p>Upload only to a discipline package assigned to your company. Every file becomes a permanent working revision for Mefford review.</p></div><span>{data.designUploads?.length || 0} ASSIGNED</span></div><div className="vendor-design-upload-grid"><label>Assigned Design Package<select value={`${designUploadDraft.projectId}|${designUploadDraft.recordId}`} onChange={(event) => { const [projectId, recordId] = event.target.value.split("|"); setDesignUploadDraft((current) => ({ ...current, projectId: projectId || "", recordId: recordId || "" })); }}><option value="|">Select Controlled Package</option>{data.designUploads?.map((item) => <option key={`${item.projectId}-${item.id}`} value={`${item.projectId}|${item.id}`}>{item.projectId} · {item.discipline} · {item.title}</option>)}</select></label><label>Revision Label<input value={designUploadDraft.revisionLabel} onChange={(event) => setDesignUploadDraft((current) => ({ ...current, revisionLabel: event.target.value }))} placeholder="Example: Rev 2 or P1" /></label><label className="wide">Revision Narrative<textarea rows={3} value={designUploadDraft.revisionDescription} onChange={(event) => setDesignUploadDraft((current) => ({ ...current, revisionDescription: event.target.value }))} placeholder="Describe what changed and why" /></label><label className="vendor-file-picker wide"><input type="file" onChange={(event) => setDesignUploadFile(event.target.files?.[0] || null)} /><span>＋</span><b>{designUploadFile?.name || "Choose New Design File"}</b><small>25 MB Maximum · Permanent Controlled Revision</small></label></div><div className="vendor-hard-block neutral"><strong>WORKING REVISION CONTROL</strong><span>Upload does not create a Current Set, approve design, execute a contract, or change cost. Designer disposition and Mefford PM release remain separate gates.</span></div><button className="primary-action large" disabled={saving || !designUploadDraft.recordId || !designUploadDraft.revisionLabel.trim() || !designUploadDraft.revisionDescription.trim() || !designUploadFile} onClick={() => void submitDesignRevision()}>{saving ? "Uploading…" : "Submit Permanent Revision To Mefford"}</button></section>
          <section className="vendor-design-review-register"><div className="vendor-section-heading"><div><h2>Architect / Engineer Design Reviews</h2><p>Review only the revision explicitly assigned to your company. Your approval does not make it the project Current Set; Mefford PM release remains required.</p></div><span>{data.designReviews?.length || 0} OPEN</span></div>
            {!data.designReviews?.length ? <div className="vendor-empty"><b>No Design Reviews Assigned</b><span>Controlled discipline packages appear here after the Mefford PM sends them.</span></div> : data.designReviews.map((review) => <article key={`${review.projectId}-${review.id}`} className={selectedDesignReviewId === review.id ? "active" : ""}><header><span><b>{review.id} · {review.title}</b><small>{review.projectId} · {review.discipline} · {review.phase}</small></span><i>DUE {formatDate(review.due)}</i></header><p>{review.instructions || "Review the latest revision and provide a controlled disposition."}</p><div className="vendor-design-file"><span><b>{review.revision.label}</b><small>{review.revision.fileName} · {review.revision.description || "No Revision Narrative"}</small></span><button onClick={() => window.open(`/api/vendor-portal/files?designProjectId=${encodeURIComponent(review.projectId)}&designRecordId=${encodeURIComponent(review.id)}&designFileId=${review.revision.fileId}`, "_blank", "noopener,noreferrer")}>Open Assigned Revision ↗</button></div><button className="primary-action" onClick={() => setSelectedDesignReviewId(review.id)}>Record Designer Review</button></article>)}
          </section>
          {selectedDesignReviewId ? <section className="vendor-design-review-form"><div className="vendor-section-heading"><div><h2>Designer Disposition · {selectedDesignReviewId}</h2><p>Your name, company, decision, comments, impacts, and timestamp become part of the permanent project audit.</p></div></div><label>Designer Decision<select value={designReviewDraft.reviewDecision} onChange={(event) => setDesignReviewDraft((current) => ({ ...current, reviewDecision: event.target.value as "Approved" | "Approved As Noted" | "Revise And Resubmit" | "Rejected" }))}><option>Approved</option><option>Approved As Noted</option><option>Revise And Resubmit</option><option>Rejected</option></select></label><label>Review Comments / Conditions<textarea rows={6} value={designReviewDraft.reviewComments} onChange={(event) => setDesignReviewDraft((current) => ({ ...current, reviewComments: event.target.value }))} /></label><div className="vendor-impact-grid"><VendorImpactQuestion label="Cost Impact" value={designReviewDraft.costImpact} onChange={(value) => setDesignReviewDraft((current) => ({ ...current, costImpact: value }))} /><VendorImpactQuestion label="Schedule Impact" value={designReviewDraft.scheduleImpact} onChange={(value) => setDesignReviewDraft((current) => ({ ...current, scheduleImpact: value }))} /></div><div className="vendor-hard-block neutral"><strong>IMPACT AND RELEASE CONTROL</strong><span>Yes or Unknown creates linked Mefford exposure. Designer approval still requires a separate PM release before Current Set status.</span></div><label className="vendor-file-picker"><input type="file" onChange={(event) => setDesignReviewFile(event.target.files?.[0] || null)} /><span>＋</span><b>{designReviewFile?.name || "Attach Markup Or Review Letter (Optional)"}</b><small>Any File Type · 25 MB Maximum</small></label><div className="vendor-response-actions"><button className="secondary-action" onClick={() => setSelectedDesignReviewId("")}>Cancel</button><button className="primary-action large" disabled={saving || !designReviewDraft.reviewComments.trim()} onClick={() => void submitDesignReview()}>{saving ? "Submitting…" : "Submit Designer Review"}</button></div></section> : null}
          <section className="vendor-correspondence-register"><div className="vendor-section-heading"><div><h2>Assigned RFIs And Submittals</h2><p>You may respond only to records a Mefford PM formally issued and explicitly assigned to your company.</p></div><span>{data.correspondence?.length || 0} OPEN</span></div>
            {!data.correspondence?.length ? <div className="vendor-empty"><b>No Responses Required</b><span>New formal RFIs or submittals will appear here after PM issuance.</span></div> : data.correspondence.map((record) => <article key={`${record.projectId}-${record.id}`} className={selectedCorrespondenceId === record.id ? "active" : ""}><header><span><b>{record.id} · {record.title}</b><small>{record.projectId} · Due {formatDate(record.due)}</small></span><i>{record.status}</i></header><p>{record.details}</p><dl><div><dt>Specification</dt><dd>{record.specificationReference || "—"}</dd></div><div><dt>Drawing</dt><dd>{record.drawingReference || "—"}</dd></div><div><dt>Schedule</dt><dd>{record.scheduleReference || "—"}</dd></div></dl><button className="primary-action" onClick={() => { setSelectedCorrespondenceId(record.id); setCorrespondenceResponse((current) => ({ ...current, responseStatus: record.recordType === "Submittals" ? "Approved" : "Answered" })); }}>Prepare Controlled Response</button></article>)}
          </section>
          {selectedCorrespondenceId ? <section className="vendor-correspondence-response"><div className="vendor-section-heading"><div><h2>{data.correspondence?.find((item) => item.id === selectedCorrespondenceId)?.recordType === "Submittals" ? "Resubmit Package" : "Respond To"} {selectedCorrespondenceId}</h2><p>Mefford’s Project Manager reviews and distributes your response. You cannot issue new formal records from this portal.</p></div></div><label>{data.correspondence?.find((item) => item.id === selectedCorrespondenceId)?.recordType === "Submittals" ? "Revision Notes" : "Response"}<textarea rows={6} value={correspondenceResponse.responseText} onChange={(event) => setCorrespondenceResponse((current) => ({ ...current, responseText: event.target.value }))} /></label><div className="vendor-impact-grid"><VendorImpactQuestion label="Cost Impact" value={correspondenceResponse.costImpact} onChange={(value) => setCorrespondenceResponse((current) => ({ ...current, costImpact: value }))} /><VendorImpactQuestion label="Schedule Impact" value={correspondenceResponse.scheduleImpact} onChange={(value) => setCorrespondenceResponse((current) => ({ ...current, scheduleImpact: value }))} /></div><div className="vendor-hard-block neutral"><strong>MANDATORY IMPACT CONTROL</strong><span>Yes or Unknown creates a linked Mefford change-order exposure and/or schedule-risk action. It does not approve cost or modify the contract.</span></div><label className="vendor-file-picker"><input type="file" onChange={(event) => setCorrespondenceFile(event.target.files?.[0] || null)} /><span>＋</span><b>{correspondenceFile?.name || (data.correspondence?.find((item) => item.id === selectedCorrespondenceId)?.recordType === "Submittals" ? "Attach Revised Package (Required)" : "Attach Response Support (Optional)")}</b><small>Any File Type · 25 MB Maximum</small></label><div className="vendor-response-actions"><button className="secondary-action" onClick={() => setSelectedCorrespondenceId("")}>Cancel</button><button className="primary-action large" disabled={saving || !correspondenceResponse.responseText.trim() || (data.correspondence?.find((item) => item.id === selectedCorrespondenceId)?.recordType === "Submittals" && !correspondenceFile)} onClick={() => void submitCorrespondenceResponse()}>{saving ? "Submitting…" : data.correspondence?.find((item) => item.id === selectedCorrespondenceId)?.recordType === "Submittals" ? "Submit Revised Package To PM" : "Submit Response To Mefford PM"}</button></div></section> : null}
          <section className="vendor-collaboration-grid">{[
            ["Contracts", "View and sign only the subcontract or purchase order Mefford explicitly shares.", "PROJECT SCOPE ACTIVE"],
            ["Toolbox Talks", "Assigned safety acknowledgements will appear here for signature.", "CONTROLLED SHARE"],
            ["Closeout", "Use the dedicated Closeout workspace for every assigned requirement and permanent file version.", "FINAL PAYMENT GATE"],
          ].map(([title, text, status]) => <article key={title}><span>{title.slice(0, 2).toUpperCase()}</span><h2>{title}</h2><p>{text}</p><i>{status}</i></article>)}</section><div className="permission-note"><strong>Least-Privilege Portal</strong><span>No internal markup, project budgets, other vendor data, employee records, or unshared projects are available through this portal.</span></div></div> : null}
      </section>
    </div>
  </main>;
}

function PortalMark() {
  return <svg className="vendor-portal-mark" viewBox="0 0 44 44" aria-hidden="true"><path d="M22 2 40 12v20L22 42 4 32V12Z" fill="#8f2f27"/><path d="M12 30V14h5l5 8 5-8h5v16h-5V22l-5 8-5-8v8Z" fill="white"/></svg>;
}

function VendorImpactQuestion({ label, value, onChange }: { label: string; value: "No" | "Yes" | "Unknown"; onChange: (next: "No" | "Yes" | "Unknown") => void }) {
  return <fieldset><legend>{label} <b>Required</b></legend>{(["No", "Yes", "Unknown"] as const).map((answer) => <label key={answer} className={value === answer ? "active" : ""}><input type="radio" checked={value === answer} onChange={() => onChange(answer)} />{answer}</label>)}</fieldset>;
}

function splitList(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function formatDate(value: string) {
  if (!value) return "—";
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
