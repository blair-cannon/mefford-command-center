"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  DESIGN_STARTUP_STANDARD_PERCENT,
  MEFFORD_CORE_VALUES,
  PROPOSAL_PACKET_TYPES,
  PROPOSAL_VISUAL_PLACEMENTS,
  alignScheduleMilestonesToDuration,
  designStartupGmpForPrice,
  isDesignBuildProposal,
  normalizeProposalData,
  proposalScopeTotal,
  proposalIssueErrors,
  type ProposalData,
  type ProposalExperienceSnapshot,
  type ProposalPacketType,
  type ProposalTeamMember,
  type ProposalVisual,
} from "../lib/proposals";
import { prepareDocumentImage, isDocumentReadyImage } from "../lib/client-image-normalization";
import { PDF_AND_PHOTO_UPLOAD_ACCEPT, PHOTO_UPLOAD_ACCEPT, isPdfOrPhotoUpload, isPhotoUpload } from "../lib/photo-uploads";
import { OWNER_CONTRACT_TYPES, contractTemplate, type OwnerContractType } from "../lib/owner-contracts";
import { CurrencyInput } from "./currency-input";

type ProposalActor = {
  name: string;
  email: string;
  accessLevel: "Company Owner" | "Administrator" | "Employee";
  designations: string[];
};

type ProposalRecord = {
  id: string;
  type?: string;
  title: string;
  owner: string;
  due: string;
  status: string;
  meta: string;
  recordDate?: string;
  data?: Record<string, unknown>;
};

type SourceSummary = {
  contactLinked: boolean;
  estimateLinked: boolean;
  estimateStatus: string;
  bidPackageCount: number;
  receivedQuoteCount: number;
  selectedQuoteCount: number;
  unselectedBidPackageCount: number;
};
type DeliveryConnection = { configured: boolean; mode: string };

type ProposalSourceFile = {
  id: number;
  name: string;
  category: string;
  revision: string;
  contentType: string;
  size: string;
  date: string;
  source: "Estimate Files" | "Design Reconstruction";
};

type ProposalTeamOption = Omit<ProposalTeamMember, "includeInProposal"> & {
  includeByDefault: boolean; profileStatus: string; designations: string[]; sectors: string[]; deliveryMethods: string[];
};

const proposalSteps = [
  ["details", "01", "Project Brief"],
  ["story", "02", "Project Read + Core Values"],
  ["team", "03", "Project Team"],
  ["schedule", "04", "Proposed Schedule"],
  ["basis", "05", "Proposal Basis"],
  ["scope", "06", "Scope Of Work"],
  ["visuals", "07", "Photos & Drawings"],
  ["commercials", "08", "Commercial & Next Move"],
  ["review", "09", "Final Review"],
] as const;

const engagementSteps = [
  ["details", "01", "Project Brief"],
  ["story", "02", "The Letter"],
  ["team", "03", "Project Team"],
  ["approach", "04", "Core Values"],
  ["schedule", "05", "Proposed Schedule"],
  ["basis", "06", "Engagement Basis"],
  ["scope", "07", "Services"],
  ["visuals", "08", "Photos & Drawings"],
  ["commercials", "09", "Fee & Next Step"],
  ["review", "10", "Final Review"],
] as const;

export function OwnerProposalStudio({
  opportunity,
  actor,
  onClose,
  onOpportunitySaved,
  onPrepareContract,
}: {
  opportunity: ProposalRecord;
  actor: ProposalActor;
  onClose: () => void;
  onOpportunitySaved: (record: ProposalRecord) => void;
  onPrepareContract?: () => void;
}) {
  const [packetType, setPacketType] = useState<ProposalPacketType>("Construction Proposal");
  const [records, setRecords] = useState<ProposalRecord[]>([]);
  const [record, setRecord] = useState<ProposalRecord | null>(null);
  const [data, setData] = useState<ProposalData | null>(null);
  const [permissions, setPermissions] = useState<{ canIssue: boolean; accessLevel: string }>({ canIssue: ["Company Owner", "Administrator"].includes(actor.accessLevel), accessLevel: actor.accessLevel });
  const [activeStep, setActiveStep] = useState<(typeof engagementSteps)[number][0]>("details");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [availableFiles, setAvailableFiles] = useState<ProposalSourceFile[]>([]);
  const [teamOptions, setTeamOptions] = useState<ProposalTeamOption[]>([]);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [aiInstructions, setAiInstructions] = useState("");
  const [intelligenceLoading, setIntelligenceLoading] = useState<"project-read" | "proposal-schedule" | "">("");
  const [uploadingCustomerLogo, setUploadingCustomerLogo] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [uploadingDesignDrawings, setUploadingDesignDrawings] = useState(false);
  const [notice, setNotice] = useState("");
  const [wordBusy, setWordBusy] = useState(false);
  const [deliveryConnection, setDeliveryConnection] = useState<DeliveryConnection>({ configured: false, mode: "Checking Connection" });

  async function refreshDeliveryStatus() {
    setSaving(true);
    try {
      const response = await fetch(`/api/proposals?opportunityId=${encodeURIComponent(opportunity.id)}`, { cache: "no-store" });
      const result = await response.json() as { records?: ProposalRecord[]; deliveryConnection?: DeliveryConnection; error?: string };
      if (!response.ok || !result.deliveryConnection) throw new Error(result.error || "Delivery status could not be checked.");
      setDeliveryConnection(result.deliveryConnection);
      const current = result.records?.find(item => item.id === record?.id);
      if (current && record?.status === "Issued") { selectRecord(current); setRecords(result.records!); }
      setNotice(result.deliveryConnection.configured ? "Email Connection Settings Are Present. The Send Result Will Confirm Whether The Provider Accepts This Proposal." : "Email Is Not Connected. The Issued PDF Can Be Downloaded; A Company Administrator Must Connect Outgoing Email Before Sending Here.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Delivery status could not be checked."); }
    finally { setSaving(false); }
  }

  async function downloadWord() {
    if (!data || wordBusy || saving) return;
    setWordBusy(true);
    try {
      const saved = await requestAction("save");
      if (!saved) return;
      const url = `/api/proposals/document?opportunityId=${encodeURIComponent(opportunity.id)}&recordId=${encodeURIComponent(saved.id)}&format=docx`;
      // Use the server attachment directly so browser download managers retain
      // the filename and receive the file without a transient blob URL.
      window.location.assign(url);
      setNotice("Word Copy Ready. Edit The Fields, Save As .docx, Then Upload Edited Word.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "The Word Copy Could Not Be Downloaded."); }
    finally { setWordBusy(false); }
  }

  async function uploadEditedWord(file: File | undefined) {
    if (!file || !data || !record || wordBusy || saving) return;
    if (JSON.stringify(normalizeProposalData(record.data)) !== JSON.stringify(data)) { setNotice("There Are Unsaved Studio Edits. Save Them And Download A New Word Copy, Or Reopen The Saved Draft Before Uploading."); return; }
    setWordBusy(true); setNotice("");
    try {
      const form = new FormData(); form.set("action", "import-word"); form.set("opportunityId", opportunity.id); form.set("packetType", packetType); form.set("file", file);
      const response = await fetch("/api/proposals", { method: "POST", body: form });
      const result = await response.json() as { error?: string; record?: ProposalRecord; opportunity?: ProposalRecord; changes?: unknown[] };
      if (!response.ok || !result.record) throw new Error(result.error || "The Word Changes Could Not Be Saved.");
      selectRecord(result.record); setRecords(current => [result.record!, ...current.filter(item => item.id !== result.record!.id)]);
      if (result.opportunity) onOpportunitySaved(result.opportunity);
      setNotice(`${result.changes?.length || 0} Word Changes Saved To The Draft. The Uploaded File And Change History Were Retained.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "The Word Changes Could Not Be Saved."); }
    finally { setWordBusy(false); }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/proposals?opportunityId=${encodeURIComponent(opportunity.id)}`, { cache: "no-store" });
        const result = await response.json() as { records?: ProposalRecord[]; source?: SourceSummary; teamOptions?: ProposalTeamOption[]; aiConfigured?: boolean; deliveryConnection?: DeliveryConnection; permissions?: { canIssue: boolean; accessLevel: string }; error?: string };
        if (!response.ok) throw new Error(result.error || "The Proposal Studio Could Not Be Loaded.");
        if (cancelled) return;
        const loaded = result.records ?? [];
        setRecords(loaded);
        setTeamOptions(result.teamOptions ?? []);
        setAiConfigured(result.aiConfigured === true);
        if (result.deliveryConnection) setDeliveryConnection(result.deliveryConnection);
        if (result.permissions) setPermissions(result.permissions);
        const construction = loaded.find((item) => item.data?.packetType === "Construction Proposal");
        if (construction) selectRecord(construction);
        else await requestAction("generate", "Construction Proposal", undefined, cancelled);
      } catch (error) {
        if (!cancelled) setNotice(error instanceof Error ? error.message : "The Proposal Studio Could Not Be Loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    (async () => {
      try {
        const sources = await Promise.all([
          fetch(`/api/files?projectId=${encodeURIComponent(`ESTIMATE-${opportunity.id}`)}`, { cache: "no-store" }),
          fetch(`/api/files?projectId=${encodeURIComponent(`DESIGN-${opportunity.id}`)}`, { cache: "no-store" }),
        ]);
        const payloads = await Promise.all(sources.map(async (response) => {
          const result = await response.json() as { files?: Omit<ProposalSourceFile, "source">[]; error?: string };
          if (!response.ok) throw new Error(result.error || "Proposal Source Files Are Unavailable.");
          return result.files ?? [];
        }));
        if (!cancelled) setAvailableFiles([
          ...payloads[0].map((file) => ({ ...file, source: "Estimate Files" as const })),
          ...payloads[1].map((file) => ({ ...file, category: "02-Design & Drawings", source: "Design Reconstruction" as const })),
        ].filter((file, index, all) => all.findIndex((candidate) => candidate.id === file.id) === index));
      } catch (error) {
        if (!cancelled) setNotice(error instanceof Error ? error.message : "Proposal Source Files Are Unavailable.");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opportunity.id]);

  const issueErrors = useMemo(() => data ? proposalIssueErrors(data) : [], [data]);
  const includedScopeTotal = useMemo(() => data ? proposalScopeTotal(data.scopeSections) : 0, [data]);
  const scopePriceMatches = data ? Math.abs(data.contractPrice - includedScopeTotal) < 0.005 : true;
  const proposalStatus = String(record?.status || data?.status || "Draft");
  const isIssued = proposalStatus === "Issued";
  const isReadyForReview = proposalStatus === "Ready For Review";
  const isApprovedToSend = proposalStatus === "Approved To Send";
  const isWorkflowLocked = isIssued || isReadyForReview || isApprovedToSend;
  const canReview = permissions.accessLevel === "Company Owner";
  const isEngagement = packetType === "Preconstruction Letter of Engagement";
  const designBuildProposal = data ? isDesignBuildProposal(data) : false;
  const documentSteps = isEngagement ? engagementSteps : proposalSteps;

  function selectRecord(next: ProposalRecord) {
    setRecord(next);
    setData(normalizeProposalData(next.data));
    setPacketType((next.data?.packetType as ProposalPacketType) || "Construction Proposal");
  }

  async function requestAction(
    action: "generate" | "refresh" | "save" | "submit-review" | "issue" | "start-revision" | "send-owner",
    type = packetType,
    nextData: ProposalData | undefined = data ?? undefined,
    cancelled = false,
  ) {
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, opportunityId: opportunity.id, packetType: type, data: nextData, ...(action === "send-owner" ? { confirmedRecipient: data?.ownerContactEmail } : {}) }),
      });
      const result = await response.json() as { record?: ProposalRecord; opportunity?: ProposalRecord; source?: SourceSummary; reviewOpenItems?: string[]; error?: string };
      if (!response.ok || !result.record) throw new Error(result.error || "The Proposal Could Not Be Saved.");
      if (cancelled) return;
      setRecords((current) => [result.record!, ...current.filter((item) => item.id !== result.record?.id)]);
      selectRecord(result.record);
      if (result.opportunity) onOpportunitySaved(result.opportunity);
      const ownerDelivery = normalizeProposalData(result.record.data).ownerDelivery;
      const messages: Record<string, string> = {
        generate: `${type} Built From The Connected Contact Estimate And Quote Records!`,
        refresh: "Live Project Information And The Current Mefford Proposal Language Have Been Refreshed.",
        save: "Draft Saved To The Permanent Estimating Record.",
        "submit-review": result.reviewOpenItems?.length
          ? `Company Owner Review Created With ${result.reviewOpenItems.length} Issue-Readiness Item${result.reviewOpenItems.length === 1 ? "" : "s"} Open.`
          : "Company Owner Review Created.",
        "send-owner": ownerDelivery?.status === "Provider Accepted" ? `Proposal Accepted By The Email Provider For ${ownerDelivery.recipient}.` : `Proposal Delivery ${ownerDelivery?.status || "Pending"}: ${ownerDelivery?.error || "Check delivery status."}`,
        issue: `Project Owner Copy Issued And Ready For Delivery To ${data?.ownerContactEmail || data?.ownerName || "The Project Owner"}.`,
        "start-revision": `Revision ${Number(result.record.data?.revision || 1)} Started. The Prior Issued Copy Remains Immutable.`,
      };
      setNotice(messages[action]);
      return result.record;
    } catch (error) {
      if (!cancelled) setNotice(error instanceof Error ? error.message : "The Proposal Could Not Be Saved.");
      return null;
    } finally {
      if (!cancelled) setSaving(false);
    }
  }

  async function choosePacket(nextType: ProposalPacketType) {
    if (saving || nextType === packetType) return;
    setPacketType(nextType);
    const existing = records.find((item) => item.data?.packetType === nextType);
    if (existing) selectRecord(existing);
    else await requestAction("generate", nextType, undefined);
  }

  async function decideReview(decision: "Approved" | "Returned") {
    if (!record) return;
    const note = decision === "Returned" ? window.prompt("Return Reason")?.trim() || "" : "";
    if (decision === "Returned" && note.length < 8) {
      setNotice("Enter A Specific Return Reason Of At Least 8 Characters.");
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/owner-approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "decide", approvalItemId: `owner-proposal:MEFFORD-SALES:${record.id}`, decision, note }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "The Proposal Decision Could Not Be Recorded.");
      const reload = await fetch(`/api/proposals?opportunityId=${encodeURIComponent(opportunity.id)}`, { cache: "no-store" });
      const refreshed = await reload.json() as { records?: ProposalRecord[]; opportunity?: ProposalRecord; error?: string };
      if (!reload.ok) throw new Error(refreshed.error || "The Proposal Could Not Be Reloaded.");
      const next = refreshed.records?.find((item) => item.id === record.id);
      if (next) {
        setRecords((current) => [next, ...current.filter((item) => item.id !== next.id)]);
        selectRecord(next);
      }
      if (refreshed.opportunity) onOpportunitySaved(refreshed.opportunity);
      setNotice(decision === "Approved" ? "Approved To Send To The Project Owner." : "Returned To Draft.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Proposal Decision Could Not Be Recorded.");
    } finally {
      setSaving(false);
    }
  }

  function update<K extends keyof ProposalData>(field: K, value: ProposalData[K]) {
    setData((current) => current ? { ...current, [field]: value } : current);
  }

  function updateScopeSections(scopeSections: ProposalData["scopeSections"]) {
    setData((current) => {
      if (!current) return current;
      const contractPrice = proposalScopeTotal(scopeSections);
      return {
        ...current,
        scopeSections,
        contractPrice,
        designStartupGmp: current.designStartupGmpManual
          ? Math.min(current.designStartupGmp, contractPrice)
          : designStartupGmpForPrice(contractPrice),
      };
    });
  }

  function updateContractPrice(contractPrice: number) {
    setData((current) => current ? {
      ...current,
      contractPrice,
      designStartupGmp: current.designStartupGmpManual
        ? Math.min(current.designStartupGmp, contractPrice)
        : designStartupGmpForPrice(contractPrice),
    } : current);
  }

  function updateDesignStartupGmp(value: number) {
    setData((current) => current ? {
      ...current,
      designStartupGmp: Math.min(current.contractPrice, Math.max(0, value)),
      designStartupGmpManual: true,
    } : current);
  }

  function resetDesignStartupGmp() {
    setData((current) => current ? {
      ...current,
      designStartupGmp: designStartupGmpForPrice(current.contractPrice),
      designStartupGmpManual: false,
    } : current);
  }

  function updateDesignStartupService(id: string, changes: Partial<ProposalData["designStartupServices"][number]>) {
    setData((current) => current ? {
      ...current,
      designStartupServices: current.designStartupServices.map((service) => service.id === id ? { ...service, ...changes } : service),
    } : current);
  }

  async function storeProposalSource(file: File, category: string, revision: string, access = "Owner Proposal · Draft Visual Source") {
    const form = new FormData();
    form.set("file", file);
    form.set("projectId", `ESTIMATE-${opportunity.id}`);
    form.set("category", category);
    form.set("revision", revision);
    form.set("access", access);
    const response = await fetch("/api/files", { method: "POST", body: form });
    const result = await response.json() as { file?: Omit<ProposalSourceFile, "source">; error?: string };
    if (!response.ok || !result.file) throw new Error(result.error || `${file.name} Could Not Be Uploaded.`);
    const saved = { ...result.file, source: "Estimate Files" as const };
    setAvailableFiles((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
    return saved;
  }

  async function prepareAndStoreProposalImage(file: File, category: string, revision: string, options: { useOriginalWhenPreviewUnavailable?: boolean; access?: string } = {}) {
    if (!isPhotoUpload(file)) throw new Error(`${file.name} Is Not Recognized As An Image File.`);
    let prepared: Awaited<ReturnType<typeof prepareDocumentImage>>;
    try {
      prepared = await prepareDocumentImage(file);
    } catch (error) {
      const saved = await storeProposalSource(file, options.useOriginalWhenPreviewUnavailable ? category : `${category} / Original Upload`, `${revision} · Original Preserved · Preview Unavailable`, options.access);
      if (options.useOriginalWhenPreviewUnavailable) return { saved, documentReady: false, converted: false };
      throw new Error(`${file.name} Was Stored In The Estimate Files, But This Browser Could Not Prepare It For The Proposal PDF. ${error instanceof Error ? error.message : ""}`.trim());
    }
    if (prepared.converted) await storeProposalSource(file, `${category} / Original Upload`, `${revision} · Original Preserved`, options.access);
    const saved = await storeProposalSource(prepared.file, category, prepared.converted ? `${revision} · Document Copy From ${file.name}` : revision, options.access);
    return { saved, documentReady: true, converted: prepared.converted };
  }

  async function uploadCustomerLogo(file: File | undefined) {
    if (!file || uploadingCustomerLogo) return;
    setUploadingCustomerLogo(true);
    try {
      if (!isPhotoUpload(file)) throw new Error("Choose Any Image File For The Customer Logo.");
      if (file.size > 10 * 1024 * 1024) throw new Error("The customer logo must be smaller than 10 MB.");
      const prepared = await prepareAndStoreProposalImage(file, "Proposal Customer Logo", "Current Customer Brand", { access: "Owner Proposal · Customer Brand" });
      update("customerLogoFileId", prepared.saved.id);
      setNotice(prepared.converted ? "Customer Logo Accepted. The Original Was Preserved And A PDF-Ready Copy Was Created." : "Customer Logo Selected For The Prepared For Area.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The customer logo could not be uploaded.");
    } finally {
      setUploadingCustomerLogo(false);
    }
  }

  function setTeamMember(option: ProposalTeamOption, included: boolean) {
    setData((current) => {
      if (!current) return current;
      const exists = current.teamMembers.some((member) => member.employeeEmail === option.employeeEmail);
      const teamMembers = exists
        ? current.teamMembers.map((member) => member.employeeEmail === option.employeeEmail ? { ...member, includeInProposal: included } : member)
        : [...current.teamMembers, { ...option, includeInProposal: included }];
      return { ...current, teamMembers };
    });
  }

  function toggleExperience(email: string, experience: ProposalExperienceSnapshot, included: boolean) {
    setData((current) => current ? { ...current, teamMembers: current.teamMembers.map((member) => member.employeeEmail !== email ? member : {
      ...member,
      experience: included ? [...member.experience.filter((item) => item.id !== experience.id), experience] : member.experience.filter((item) => item.id !== experience.id),
    }) } : current);
  }

  async function requestIntelligence(action: "project-read" | "proposal-schedule") {
    if (intelligenceLoading) return;
    setIntelligenceLoading(action);
    setNotice("");
    try {
      const response = await fetch("/api/proposals/intelligence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, opportunityId: opportunity.id, instructions: aiInstructions, data }) });
      const result = await response.json() as { executiveSummary?: string; projectUnderstanding?: string; approachIntroduction?: string; approachPhases?: ProposalData["approachPhases"]; scheduleNarrative?: string; scheduleMilestones?: ProposalData["scheduleMilestones"]; intelligence?: ProposalData["proposalIntelligence"]; connectionRequired?: boolean; error?: string };
      if (!response.ok) throw new Error(result.connectionRequired ? "OpenAI is not connected. Connect it before generating project-specific proposal intelligence." : result.error || "Proposal intelligence could not be generated.");
      setData((current) => current ? { ...current, ...(result.executiveSummary ? { executiveSummary: result.executiveSummary } : {}), ...(result.projectUnderstanding ? { projectUnderstanding: result.projectUnderstanding } : {}), ...(result.approachIntroduction ? { approachIntroduction: result.approachIntroduction } : {}), ...(result.approachPhases ? { approachPhases: result.approachPhases } : {}), ...(result.scheduleNarrative ? { scheduleNarrative: result.scheduleNarrative } : {}), ...(result.scheduleMilestones ? { scheduleMilestones: result.scheduleMilestones } : {}), ...(result.intelligence ? { proposalIntelligence: result.intelligence } : {}) } : current);
      setNotice("A cited draft is ready for human review. Nothing was issued or written back automatically.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Proposal intelligence could not be generated.");
    } finally {
      setIntelligenceLoading("");
    }
  }

  function approveProposalIntelligence() {
    if (data) update("proposalIntelligence", { ...data.proposalIntelligence, status: "Approved", approvedAt: new Date().toISOString(), approvedBy: actor.email });
  }

  function addVisual(file: ProposalSourceFile, kind: ProposalVisual["kind"], requestedPlacement?: ProposalVisual["placement"]) {
    setData((current) => {
      if (!current || current.visuals.some((item) => item.fileId === file.id)) return current;
      const placement = requestedPlacement || (kind === "Drawing PDF"
        ? "Design Drawing"
        : current.visuals.some((item) => item.included && item.kind === "Photo" && item.placement === "Project Photo")
          ? "After Project Read"
          : "Project Photo");
      const visual: ProposalVisual = {
        id: `VISUAL-${file.id}`,
        fileId: file.id,
        kind,
        name: file.name,
        contentType: file.contentType,
        placement,
        caption: "",
        pageSelection: kind === "Drawing PDF" ? "All" : "",
        included: true,
      };
      return { ...current, visuals: [...current.visuals, visual] };
    });
  }

  function updateVisual(id: string, changes: Partial<ProposalVisual>) {
    setData((current) => current ? {
      ...current,
      visuals: current.visuals.map((item) => {
        if (item.id === id) return { ...item, ...changes };
        if (changes.placement === "Project Photo" && item.placement === "Project Photo") return { ...item, placement: "After Project Read" };
        return item;
      }),
    } : current);
  }

  function moveVisual(index: number, direction: -1 | 1) {
    setData((current) => {
      if (!current) return current;
      const target = index + direction;
      if (target < 0 || target >= current.visuals.length) return current;
      const visuals = [...current.visuals];
      [visuals[index], visuals[target]] = [visuals[target], visuals[index]];
      return { ...current, visuals };
    });
  }

  async function uploadProposalPhotos(files: FileList | null) {
    const selected = Array.from(files || []);
    if (!selected.length || uploadingPhotos) return;
    setUploadingPhotos(true);
    try {
      for (const file of selected) {
        if (!isPhotoUpload(file)) throw new Error(`${file.name} Is Not Recognized As An Image File.`);
        if (file.size > 15 * 1024 * 1024) throw new Error(`${file.name} must be smaller than 15 MB.`);
        const prepared = await prepareAndStoreProposalImage(file, "05-Owner Proposal & LOE", "Proposal Studio Visual Source");
        addVisual(prepared.saved, "Photo");
      }
      setNotice(`${selected.length} Proposal Photo${selected.length === 1 ? "" : "s"} Accepted And Selected. Original Files Were Preserved When A Document Copy Was Needed.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Proposal Photos Could Not Be Uploaded.");
    } finally {
      setUploadingPhotos(false);
    }
  }

  async function uploadDesignDrawings(files: FileList | null) {
    const selected = Array.from(files || []);
    if (!selected.length || uploadingDesignDrawings) return;
    setUploadingDesignDrawings(true);
    try {
      for (const file of selected) {
        if (!isPdfOrPhotoUpload(file)) throw new Error(`${file.name} Must Be A PDF Or Image File.`);
        if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name} Must Be Smaller Than 25 MB.`);
        if (file.type.toLowerCase() === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
          const saved = await storeProposalSource(file, "Proposal Design Drawing", "Proposal Studio Design Drawing");
          addVisual(saved, "Drawing PDF", "Design Drawing");
          continue;
        }
        const prepared = await prepareAndStoreProposalImage(file, "Proposal Design Drawing", "Proposal Studio Design Drawing");
        addVisual(prepared.saved, "Photo", "Design Drawing");
      }
      setNotice(`${selected.length} Design Drawing${selected.length === 1 ? "" : "s"} Selected For The Dedicated PDF Section.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Design Drawing Could Not Be Uploaded.");
    } finally {
      setUploadingDesignDrawings(false);
    }
  }

  async function addStoredProposalPhoto(file: ProposalSourceFile, placement?: ProposalVisual["placement"]) {
    if (isDocumentReadyImage({ name: file.name, type: file.contentType })) {
      addVisual(file, "Photo", placement);
      return;
    }
    setUploadingPhotos(true);
    try {
      const response = await fetch(`/api/files?id=${file.id}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`${file.name} Could Not Be Read.`);
      const source = new File([await response.blob()], file.name, { type: file.contentType });
      const prepared = await prepareDocumentImage(source);
      const saved = await storeProposalSource(prepared.file, "05-Owner Proposal & LOE", `Document Copy From Stored File ${file.id}`);
      addVisual(saved, "Photo", placement);
      setNotice(`${file.name} Was Preserved And A PDF-Ready Copy Was Selected.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `${file.name} Could Not Be Prepared For The Proposal PDF.`);
    } finally {
      setUploadingPhotos(false);
    }
  }

  async function openPdf() {
    if (!record) return;
    const preview = window.open("", "_blank");
    if (preview) preview.opener = null;
    const savedRecord = isWorkflowLocked ? record : await requestAction("save");
    if (!savedRecord) {
      preview?.close();
      return;
    }
    const url = `/api/proposals/document?opportunityId=${encodeURIComponent(opportunity.id)}&recordId=${encodeURIComponent(savedRecord.id)}`;
    if (preview) preview.location.href = url;
    else window.open(url, "_blank", "noopener,noreferrer");
  }

  if (loading || !data) {
    return <div className="proposal-studio-layer"><section className="proposal-loading"><Image src="/mefford-logo.png" unoptimized alt="Mefford Contracting" width={711} height={738} priority /><strong>Building The Project Owner Packet</strong><span>Connecting contact, opportunity, estimate, and quote information...</span>{notice ? <p>{notice}</p> : null}<button onClick={onClose}>Close</button></section></div>;
  }

  return <div className="proposal-studio-layer" role="dialog" aria-modal="true" aria-label={`${packetType} Studio`}>
    <section className="proposal-studio-shell">
      <header className="proposal-studio-header">
        <div className="proposal-studio-brand"><Image src="/mefford-logo.png" unoptimized alt="Mefford Contracting" width={711} height={738} priority /><span><b>PROJECT OWNER DOCUMENTS</b><strong>{data.projectName}</strong><small>{record?.id} / Revision {data.revision}</small></span></div>
        <div className="proposal-type-switch" aria-label="Document type">{PROPOSAL_PACKET_TYPES.map((type) => <button key={type} disabled={saving || wordBusy} className={packetType === type ? "active" : ""} onClick={() => void choosePacket(type)}><span>{type === "Construction Proposal" ? "BUILD" : "PLAN"}</span><strong>{type === "Construction Proposal" ? "Project Proposal" : "Engagement Letter"}</strong></button>)}</div>
        <div className="proposal-header-actions"><span className={`proposal-status ${String(record?.status || "Draft").toLowerCase().replaceAll(" ", "-")}`}>{record?.status || "Draft"}</span><button aria-label="Close Proposal Studio" disabled={saving || wordBusy} onClick={onClose}>×</button></div>
      </header>

      {notice ? <button className="proposal-notice" onClick={() => setNotice("")}>{notice}<span>×</span></button> : null}

      {proposalStatus === "Draft" ? <section className="proposal-word-actions" aria-label="Word Editing">
        <button className="secondary-action" disabled={saving || wordBusy} onClick={() => void requestAction("refresh")}>Pull Latest Project Data</button>
        <button className="secondary-action" disabled={saving || wordBusy} onClick={() => void downloadWord()}>Download Editable Word</button>
        <label className="secondary-action">{wordBusy ? "Processing Word…" : "Upload Edited Word"}<input aria-label="Upload Edited Word" type="file" accept=".docx" disabled={saving || wordBusy} onChange={event => { void uploadEditedWord(event.target.files?.[0]); event.target.value = ""; }} /></label>

      </section> : null}

      <div className="proposal-studio-body">
        <nav className="proposal-step-rail" aria-label="Document sections">{documentSteps.map(([id, number, label]) => <button key={id} className={activeStep === id ? "active" : ""} onClick={() => setActiveStep(id)}><span>{number}</span><strong>{label}</strong><i>{stepComplete(id, data) ? "✓" : ""}</i></button>)}</nav>

        <main className="proposal-editor-panel">
        {isIssued && permissions.canIssue ? <div className="proposal-owner-delivery"><strong>Project Owner Delivery</strong><span>{data.ownerContactName || data.ownerName} · {data.ownerContactEmail || "Email missing from issued copy"}</span>
          <small>{deliveryConnection.configured ? `${deliveryConnection.mode} · Connection Settings Present` : "Email Not Connected · Download Is Available"}</small>
          <small>{data.ownerDelivery?.revision === data.revision ? `${data.ownerDelivery.status} · ${data.ownerDelivery.error || data.ownerDelivery.acceptedAt}` : "Issued PDF ready to submit"}</small>
          {data.ownerDelivery?.revision === data.revision && data.ownerDelivery.receiptId ? <small>Provider Receipt: {data.ownerDelivery.receiptId}</small> : null}
          <button className="secondary-action" disabled={saving || wordBusy} onClick={() => void refreshDeliveryStatus()}>Refresh Delivery Status</button>
          <button className="primary-action" disabled={saving || wordBusy || !deliveryConnection.configured || !data.ownerContactEmail || (data.ownerDelivery?.revision === data.revision && (["Sending", "Provider Accepted"].includes(data.ownerDelivery.status) || (data.ownerDelivery.status === "Retry" && (!data.ownerDelivery.safeToRetry || Date.parse(data.ownerDelivery.retryAt || "") > Date.now()))))} onClick={() => void requestAction("send-owner")}>Send Issued PDF To This Owner</button>
        </div> : null}
          <fieldset disabled={isWorkflowLocked || wordBusy || saving}>
            {activeStep === "details" ? <>
              <EditorHeading title="Project Details" />
              <div className="proposal-form-grid">
                <ProposalField label="Project Name"  wide><input value={data.projectName} onChange={(event) => update("projectName", event.target.value)} /></ProposalField>
                <ProposalField label="Project Owner / Client" ><input value={data.ownerName} onChange={(event) => update("ownerName", event.target.value)} /></ProposalField>
                <ProposalField label="Project Owner Contact" ><input value={data.ownerContactName} onChange={(event) => update("ownerContactName", event.target.value)} /></ProposalField>
                <ProposalField label="Contact Title" ><input value={data.ownerContactTitle} onChange={(event) => update("ownerContactTitle", event.target.value)} /></ProposalField>
                <ProposalField label="Contact Email" ><input type="email" value={data.ownerContactEmail} onChange={(event) => update("ownerContactEmail", event.target.value)} /></ProposalField>
                <ProposalField label="Contact Phone" ><input value={data.ownerContactPhone} onChange={(event) => update("ownerContactPhone", event.target.value)} /></ProposalField>
                <ProposalField label="Project Location"  wide><input value={data.projectLocation} onChange={(event) => update("projectLocation", event.target.value)} /></ProposalField>
                <ProposalField label="Target Start Date" ><input type="date" value={data.targetStartDate} onChange={(event) => setData((current) => current ? { ...current, targetStartDate: event.target.value, scheduleMilestones: alignScheduleMilestonesToDuration(current.scheduleMilestones, event.target.value, current.durationMonths) } : current)} /></ProposalField>
                <ProposalField label="Project Duration In Months" ><input type="number" min="0" step="0.5" value={data.durationMonths || ""} onChange={(event) => { const durationMonths = Number(event.target.value || 0); setData((current) => current ? { ...current, durationMonths, scheduleMilestones: alignScheduleMilestonesToDuration(current.scheduleMilestones, current.targetStartDate, durationMonths) } : current); }} /></ProposalField>

                <ProposalField label="Prepared By" ><input value={data.preparedBy} onChange={(event) => update("preparedBy", event.target.value)} /></ProposalField>
                <ProposalField label="Prepared By Email" ><input type="email" value={data.preparedByEmail} onChange={(event) => update("preparedByEmail", event.target.value)} /></ProposalField>
                <ProposalField label="Document Date" ><input type="date" value={data.proposalDate} onChange={(event) => update("proposalDate", event.target.value)} /></ProposalField>
                <ProposalField label="Valid Through" ><input type="date" value={data.validThrough} onChange={(event) => update("validThrough", event.target.value)} /></ProposalField>
              </div>
              <section className="proposal-customer-brand"><div>{data.customerLogoFileId ? <Image src={`/api/files?id=${data.customerLogoFileId}`} alt={`${data.ownerName} logo`} width={240} height={120} unoptimized /> : <span>Customer logo</span>}</div><label className="secondary-action">{uploadingCustomerLogo ? "Uploading..." : data.customerLogoFileId ? "Replace Customer Logo" : "Upload Customer Logo"}<input type="file" accept={PHOTO_UPLOAD_ACCEPT} disabled={uploadingCustomerLogo} onChange={(event) => { void uploadCustomerLogo(event.target.files?.[0]); event.target.value = ""; }} /></label></section>
            </> : null}

            {activeStep === "story" ? <>
              <EditorHeading title={isEngagement ? "Engagement Letter" : "Proposal Text"} />

              <ProposalField label="Document Title" ><input value={data.title} onChange={(event) => update("title", event.target.value)} /></ProposalField>
              <ProposalField label={isEngagement ? "Letter Descriptor" : "Cover Line"} ><input value={data.subtitle} onChange={(event) => update("subtitle", event.target.value)} /></ProposalField>
              <ProposalField label={isEngagement ? "Opening Letter" : "Proposal Opening"} ><textarea rows={7} value={data.executiveSummary} onChange={(event) => update("executiveSummary", event.target.value)} /></ProposalField>
              <ProposalField label="Our Understanding" ><textarea rows={7} value={data.projectUnderstanding} onChange={(event) => update("projectUnderstanding", event.target.value)} /></ProposalField>
              {!isEngagement ? <><ProposalField label="Core Values Introduction" ><textarea rows={3} value={data.approachIntroduction} onChange={(event) => update("approachIntroduction", event.target.value)} /></ProposalField><div className="proposal-repeat-list">{data.approachPhases.slice(0, 4).map((phase, index) => <article key={phase.id}><label className="proposal-include"><span>{String(index + 1).padStart(2, "0")}</span></label><div><strong>{MEFFORD_CORE_VALUES[index]}</strong><textarea aria-label={`${MEFFORD_CORE_VALUES[index]} project commitment`} rows={3} value={phase.description} onChange={(event) => update("approachPhases", data.approachPhases.map((item) => item.id === phase.id ? { ...item, title: MEFFORD_CORE_VALUES[index], included: true, description: event.target.value } : item))} /></div></article>)}</div></> : null}
              <section className="proposal-ai-card"><header><div><span>DRAWING-ASSISTED DRAFT</span><strong>Project-Specific Read</strong></div><i className={aiConfigured ? "ready" : "warning"}>{aiConfigured ? "Connected" : "Connection Required"}</i></header><textarea rows={3} value={aiInstructions} onChange={(event) => setAiInstructions(event.target.value)} placeholder="Optional direction: owner priorities, known constraints, phasing, occupied-site concerns..." /><div><button type="button" className="primary-action" disabled={!aiConfigured || Boolean(intelligenceLoading)} onClick={() => void requestIntelligence("project-read")}>{intelligenceLoading === "project-read" ? "Reviewing Sources..." : "Draft From Project Sources"}</button>{data.proposalIntelligence.status === "Draft" ? <button type="button" className="secondary-action" onClick={approveProposalIntelligence}>Approve Reviewed Draft</button> : null}</div>{data.proposalIntelligence.citations.length ? <ul>{data.proposalIntelligence.citations.map((citation) => <li key={`${citation.sourceId}-${citation.detail}`}><b>{citation.label}</b> — {citation.detail}</li>)}</ul> : null}{data.proposalIntelligence.openQuestions.length ? <aside><b>Open Questions</b>{data.proposalIntelligence.openQuestions.map((question) => <span key={question}>{question}</span>)}</aside> : null}</section>
            </> : null}

            {activeStep === "team" ? <>
              <EditorHeading title="Project Team" />
              <div className="proposal-form-grid"><ProposalField label="Proposed Project Manager" ><select value={data.proposedProjectManagerEmail} onChange={(event) => update("proposedProjectManagerEmail", event.target.value)}><option value="">Select project manager</option>{teamOptions.map((option) => <option key={option.employeeEmail} value={option.employeeEmail}>{option.displayName} · {option.companyTitle}</option>)}</select></ProposalField><ProposalField label="Proposed Site Superintendent" ><select value={data.proposedSuperintendentEmail} onChange={(event) => update("proposedSuperintendentEmail", event.target.value)}><option value="">Select superintendent</option>{teamOptions.map((option) => <option key={option.employeeEmail} value={option.employeeEmail}>{option.displayName} · {option.companyTitle}</option>)}</select></ProposalField></div>
              <div className="proposal-team-grid">{teamOptions.map((option) => { const selected = data.teamMembers.find((member) => member.employeeEmail === option.employeeEmail); const approved = option.profileStatus === "Approved"; return <article key={option.employeeEmail} className={selected?.includeInProposal ? "selected" : ""}><header>{option.headshotFileId ? <Image src={`/api/files?id=${option.headshotFileId}`} alt="" width={96} height={96} unoptimized /> : <span>{initials(option.displayName)}</span>}<div><strong>{option.displayName}</strong><small>{option.companyTitle}</small><i>{approved ? "Company Owner Approved" : option.profileStatus}</i></div><label><input type="checkbox" disabled={!approved} checked={selected?.includeInProposal === true} onChange={(event) => setTeamMember(option, event.target.checked)} /> Include</label></header>{selected?.includeInProposal ? <><p>{selected.professionalSummary}</p><div>{option.experience.map((experience) => <label key={experience.id}><input type="checkbox" checked={selected.experience.some((item) => item.id === experience.id)} onChange={(event) => toggleExperience(option.employeeEmail, experience, event.target.checked)} /><span><b>{experience.projectName}</b><small>{experience.role} · {experience.completionDate || "Completed project"}</small></span></label>)}</div></> : null}</article>; })}</div>
            </> : null}

            {activeStep === "schedule" ? <>
              <EditorHeading title="Schedule" />
              <section className="proposal-ai-card"><header><div><span>PRE-AWARD PLANNING</span><strong>Schedule Draft</strong></div><i className={aiConfigured ? "ready" : "warning"}>{aiConfigured ? "Connected" : "Connection Required"}</i></header><button type="button" className="primary-action" disabled={!aiConfigured || Boolean(intelligenceLoading)} onClick={() => void requestIntelligence("proposal-schedule")}>{intelligenceLoading === "proposal-schedule" ? "Building Draft..." : "Draft Proposed Schedule"}</button></section>
              <ProposalField label="Schedule Narrative" ><textarea rows={5} value={data.scheduleNarrative} onChange={(event) => update("scheduleNarrative", event.target.value)} /></ProposalField>
              <div className="proposal-milestones">{data.scheduleMilestones.map((milestone, index) => <article key={milestone.id}><label><input type="checkbox" checked={milestone.included} onChange={(event) => update("scheduleMilestones", data.scheduleMilestones.map((item) => item.id === milestone.id ? { ...item, included: event.target.checked } : item))} /> {String(index + 1).padStart(2, "0")}</label><input aria-label={`Milestone ${index + 1}`} value={milestone.title} onChange={(event) => update("scheduleMilestones", data.scheduleMilestones.map((item) => item.id === milestone.id ? { ...item, title: event.target.value } : item))} /><input type="date" value={milestone.startDate} onChange={(event) => update("scheduleMilestones", data.scheduleMilestones.map((item) => item.id === milestone.id ? { ...item, startDate: event.target.value } : item))} /><input type="date" value={milestone.endDate} onChange={(event) => update("scheduleMilestones", data.scheduleMilestones.map((item) => item.id === milestone.id ? { ...item, endDate: event.target.value } : item))} /><select value={milestone.phase} onChange={(event) => update("scheduleMilestones", data.scheduleMilestones.map((item) => item.id === milestone.id ? { ...item, phase: event.target.value } : item))}><option>Preconstruction</option><option>Procurement</option><option>Construction</option><option>Turnover</option></select></article>)}</div>
            </> : null}

            {activeStep === "basis" ? <>
              <EditorHeading title="Assumptions & Exclusions" />
              <div className="proposal-two-column"><ProposalField label="Assumptions" ><textarea rows={12} value={data.assumptions.join("\n")} onChange={(event) => update("assumptions", textLines(event.target.value))} /></ProposalField><ProposalField label="Exclusions" ><textarea rows={12} value={data.exclusions.join("\n")} onChange={(event) => update("exclusions", textLines(event.target.value))} /></ProposalField></div>
            </> : null}

            {activeStep === "visuals" ? <>
              <EditorHeading title="Photos & Drawings" />
              <section className="proposal-visual-toolbar">
                <div><strong>{data.visuals.filter((item) => item.included).length} Selected Visuals</strong><span>Any image format · drawing PDFs · up to 30 PDF drawing pages</span></div>
                <div className="proposal-visual-actions">
                  <label className="secondary-action">{uploadingPhotos ? "Uploading Photos..." : "＋ Upload Project Photos"}<input type="file" accept={PHOTO_UPLOAD_ACCEPT} multiple disabled={uploadingPhotos || uploadingDesignDrawings} onChange={(event) => { void uploadProposalPhotos(event.target.files); event.target.value = ""; }} /></label>
                  <label className="primary-action">{uploadingDesignDrawings ? "Uploading Drawing..." : "＋ Upload Design Drawing"}<input type="file" accept={PDF_AND_PHOTO_UPLOAD_ACCEPT} multiple disabled={uploadingPhotos || uploadingDesignDrawings} onChange={(event) => { void uploadDesignDrawings(event.target.files); event.target.value = ""; }} /></label>
                </div>
              </section>

              <div className="proposal-visual-section">
                <header><div><span>PACKET ORDER</span><strong>Selected Visuals</strong></div></header>
                {data.visuals.length ? <div className="proposal-selected-visuals">{data.visuals.map((visual, index) => <article key={visual.id} className={visual.included ? "" : "excluded"}>
                  <div className="proposal-visual-thumb">{visual.kind === "Photo" ? <Image src={`/api/files?id=${visual.fileId}`} alt="" width={200} height={150} unoptimized /> : <span>PDF</span>}</div>
                  <div className="proposal-visual-fields">
                    <header><div><span>{visual.placement === "Design Drawing" ? "Design Drawing" : visual.kind}</span><strong>{visual.name}</strong></div><label><input type="checkbox" checked={visual.included} onChange={(event) => updateVisual(visual.id, { included: event.target.checked })} /> Include</label></header>
                    <div className="proposal-visual-controls">
                      <label><span>Placement</span><select value={visual.placement} onChange={(event) => updateVisual(visual.id, { placement: event.target.value as ProposalVisual["placement"] })}>{PROPOSAL_VISUAL_PLACEMENTS.filter((placement) => visual.kind !== "Drawing PDF" || placement !== "Project Photo").map((placement) => <option key={placement}>{placement}</option>)}</select></label>
                      {visual.kind === "Drawing PDF" ? <label><span>Pages</span><input value={visual.pageSelection} onChange={(event) => updateVisual(visual.id, { pageSelection: event.target.value })} placeholder="All or 1-3, 7" /></label> : null}
                      <label className="proposal-visual-caption"><span>Caption / Exhibit Note</span><input value={visual.caption} onChange={(event) => updateVisual(visual.id, { caption: event.target.value })} placeholder={visual.kind === "Photo" ? "What the owner should notice" : "Drawing set or design context"} /></label>
                    </div>
                    <footer><button type="button" disabled={index === 0} onClick={() => moveVisual(index, -1)}>↑ Earlier</button><button type="button" disabled={index === data.visuals.length - 1} onClick={() => moveVisual(index, 1)}>↓ Later</button><span /><button type="button" onClick={() => update("visuals", data.visuals.filter((item) => item.id !== visual.id))}>Remove</button></footer>
                  </div>
                </article>)}</div> : <div className="proposal-visual-empty"><strong>Picture Here If Uploaded</strong></div>}
              </div>

              <div className="proposal-source-library">
                <section><header><span>PHOTO SOURCES</span><strong>Estimate Photos</strong></header><div>{availableFiles.filter((file) => isPhotoUpload({ name: file.name, type: file.contentType })).map((file) => { const selected = data.visuals.some((item) => item.fileId === file.id); return <article key={file.id}>{isDocumentReadyImage({ name: file.name, type: file.contentType }) ? <Image src={`/api/files?id=${file.id}`} alt="" width={108} height={92} unoptimized /> : <span className="proposal-source-pdf">{file.name.split(".").pop()?.toUpperCase() || "IMAGE"}</span>}<div><strong>{file.name}</strong><span>{file.source} · {file.size}</span></div><button type="button" disabled={selected || uploadingPhotos} onClick={() => void addStoredProposalPhoto(file)}>{selected ? "Selected" : "Add Photo"}</button></article>; })}</div>{!availableFiles.some((file) => isPhotoUpload({ name: file.name, type: file.contentType })) ? <small>No estimate photos are stored yet.</small> : null}</section>
                <section><header><span>DESIGN SOURCES</span><strong>Design Drawings</strong></header><div>{availableFiles.filter((file) => (file.contentType.toLowerCase() === "application/pdf" || isPhotoUpload({ name: file.name, type: file.contentType })) && (file.source === "Design Reconstruction" || /design|drawing/i.test(file.category))).map((file) => { const selected = data.visuals.some((item) => item.fileId === file.id); const isPdf = file.contentType.toLowerCase() === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"); return <article key={file.id}>{isPdf || !isDocumentReadyImage({ name: file.name, type: file.contentType }) ? <span className="proposal-source-pdf">{isPdf ? "PDF" : file.name.split(".").pop()?.toUpperCase() || "IMAGE"}</span> : <Image src={`/api/files?id=${file.id}`} alt="" width={108} height={92} unoptimized />}<div><strong>{file.name}</strong><span>{file.source} · {file.revision}</span></div><button type="button" disabled={selected || uploadingDesignDrawings} onClick={() => isPdf ? addVisual(file, "Drawing PDF", "Design Drawing") : void addStoredProposalPhoto(file, "Design Drawing")}>{selected ? "Selected" : "Add Drawing"}</button></article>; })}</div>{!availableFiles.some((file) => (file.contentType.toLowerCase() === "application/pdf" || isPhotoUpload({ name: file.name, type: file.contentType })) && (file.source === "Design Reconstruction" || /design|drawing/i.test(file.category))) ? <small>No design drawings are currently stored in 02-Design & Drawings.</small> : null}</section>
              </div>
            </> : null}

            {activeStep === "approach" ? <>
              <EditorHeading title="Approach" />
              <ProposalField label={isEngagement ? "Engagement Introduction" : "Delivery Introduction"} ><textarea rows={4} value={data.approachIntroduction} onChange={(event) => update("approachIntroduction", event.target.value)} /></ProposalField>
              <div className="proposal-repeat-list">{data.approachPhases.slice(0, 4).map((phase, index) => <article key={phase.id}><label className="proposal-include"><span>{String(index + 1).padStart(2, "0")}</span></label><div><strong>{MEFFORD_CORE_VALUES[index]}</strong><textarea aria-label={`${MEFFORD_CORE_VALUES[index]} project commitment`} rows={5} value={phase.description} onChange={(event) => update("approachPhases", data.approachPhases.map((item) => item.id === phase.id ? { ...item, title: MEFFORD_CORE_VALUES[index], included: true, description: event.target.value } : item))} /></div></article>)}</div>
            </> : null}

            {activeStep === "scope" ? <>
              <EditorHeading title="Scope Of Work" />
              <div className="proposal-scope-toolbar"><span><b>{data.scopeSections.filter((item) => item.included).length}</b> Included Sections</span><label><input type="checkbox" checked={data.showSectionPricing} onChange={(event) => update("showSectionPricing", event.target.checked)} /> Show Section Pricing In Project Owner PDF</label><button type="button" onClick={() => updateScopeSections([...data.scopeSections, { id: `SCOPE-CUSTOM-${Date.now()}`, title: "Additional Scope", description: "", amount: 0, included: true, sourceLabel: "Manual Addition", sourceRevisionId: "" }])}>＋ Add Scope</button></div>
              <div className="proposal-scope-list">{data.scopeSections.map((scope) => <article key={scope.id} className={scope.included ? "" : "excluded"}><label className="proposal-include"><input type="checkbox" checked={scope.included} onChange={(event) => updateScopeSections(data.scopeSections.map((item) => item.id === scope.id ? { ...item, included: event.target.checked } : item))} /><span>{scope.included ? "✓" : "-"}</span></label><div><header><input aria-label={`${scope.title} title`} value={scope.title} onChange={(event) => update("scopeSections", data.scopeSections.map((item) => item.id === scope.id ? { ...item, title: event.target.value } : item))} /><small>{scope.sourceLabel}</small><CurrencyInput aria-label={`${scope.title} amount`} value={scope.amount} allowNegative onValueChange={(value) => updateScopeSections(data.scopeSections.map((item) => item.id === scope.id ? { ...item, amount: Number(value || 0) } : item))} /></header><textarea aria-label={`${scope.title} description`} rows={3} value={scope.description} onChange={(event) => update("scopeSections", data.scopeSections.map((item) => item.id === scope.id ? { ...item, description: event.target.value } : item))} /></div></article>)}</div>
            </> : null}

            {activeStep === "commercials" ? <>
              <EditorHeading title="Price & Terms" />
              <section className="proposal-price-card"><span>{packetType === "Construction Proposal" ? "TOTAL PROPOSED CONTRACT" : "TOTAL ENGAGEMENT FEE"}</span><div><b>$</b><CurrencyInput aria-label="Project Owner Document Price" value={data.contractPrice} onValueChange={(value) => updateContractPrice(Number(value || 0))} /></div><footer><small>Included Scope: {money(includedScopeTotal)} · Source Estimate: {money(data.sourceSnapshot.estimateContractValue)} · {scopePriceMatches ? "Reconciled" : "Manual Override"}</small>{!scopePriceMatches ? <button type="button" onClick={() => updateContractPrice(includedScopeTotal)}>Use Included Scope Total</button> : null}</footer></section>
              {designBuildProposal ? <section className="proposal-design-startup">
                <header>
                  <div><span>INCLUDED WITHIN THE TOTAL PROJECT PRICE</span><strong>Upfront Design And Permitting Startup GMP</strong><small>This amount is part of the project budget above. It is not an added fee.</small></div>
                  <label><span>{data.designStartupGmpManual ? "MANUAL OVERRIDE" : `STANDARD ${DESIGN_STARTUP_STANDARD_PERCENT}%`}</span><CurrencyInput aria-label="Design and permitting startup GMP" value={data.designStartupGmp} onValueChange={(value) => updateDesignStartupGmp(Number(value || 0))} /></label>
                </header>
                <div className="proposal-design-startup-control"><span>Standard {DESIGN_STARTUP_STANDARD_PERCENT}%: <b>{money(designStartupGmpForPrice(data.contractPrice))}</b></span>{data.designStartupGmpManual ? <button type="button" onClick={resetDesignStartupGmp}>Use Standard {DESIGN_STARTUP_STANDARD_PERCENT}%</button> : null}</div>

                <div className="proposal-design-startup-list"><h3>Startup Services That May Be Used</h3>{data.designStartupServices.map((service) => <article key={service.id} className={`${service.included ? "" : "excluded"} ${service.id === "DESIGN-STARTUP-ARCHITECTURAL" ? "highlighted" : ""}`.trim()}><label><input type="checkbox" checked={service.included} onChange={(event) => updateDesignStartupService(service.id, { included: event.target.checked })} /><span>{service.included ? "INCLUDED AS NEEDED" : "NOT LISTED"}</span></label><input aria-label={`${service.title} title`} value={service.title} onChange={(event) => updateDesignStartupService(service.id, { title: event.target.value })} /><textarea aria-label={`${service.title} description`} rows={3} value={service.description} onChange={(event) => updateDesignStartupService(service.id, { description: event.target.value })} /></article>)}</div>
              </section> : null}
              <div className="proposal-form-grid">
                <ProposalField label="Deposit When Approved (%)" ><input type="number" min="0" max="100" step="0.1" value={data.depositPercent} onChange={(event) => update("depositPercent", Number(event.target.value || 0))} /></ProposalField>
                <ProposalField label="Price Valid Through" ><input type="date" value={data.validThrough} onChange={(event) => update("validThrough", event.target.value)} /></ProposalField>
              </div>
              <ProposalField label="Payment Terms" ><textarea rows={3} value={data.paymentTerms} onChange={(event) => update("paymentTerms", event.target.value)} /></ProposalField>
              {!isEngagement ? <ProposalField label="Project Owner Contract Type" ><select value={data.recommendedContractType} onChange={(event) => update("recommendedContractType", event.target.value as OwnerContractType)}>{OWNER_CONTRACT_TYPES.map((type) => <option key={type} value={type}>{contractTemplate(type).label}</option>)}</select></ProposalField> : null}
              {isEngagement ? <ProposalField label="Engagement Recommendation" ><textarea rows={5} value={data.nextSteps} onChange={(event) => update("nextSteps", event.target.value)} /></ProposalField> : null}
              <ProposalField label="Recommended Next Steps" ><textarea rows={6} value={data.recommendationSteps.join("\n")} onChange={(event) => update("recommendationSteps", textLines(event.target.value))} /></ProposalField>
              {!isEngagement && onPrepareContract ? <button type="button" className="proposal-contract-handoff" onClick={onPrepareContract}><strong>Prepare Contract Draft →</strong></button> : null}
            </> : null}

            {activeStep === "review" ? <>
              <EditorHeading title="Review" />
              {isEngagement ? <EngagementPreview data={data} /> : <ProposalPreview data={data} />}
              <div className="proposal-review-grid"><article><span>Connected Sources</span><strong>{data.sourceSnapshot.estimateScopeCount} Estimate Scopes</strong><small>{data.sourceSnapshot.bidPackageCount} Bid Packages · {data.sourceSnapshot.selectedQuoteCount} Selected Quotes</small></article><article><span>Project Owner Scope</span><strong>{data.scopeSections.filter((item) => item.included).length} Sections</strong><small>{data.showSectionPricing ? "Section Pricing Shown" : "Lump Sum Presentation"}</small></article><article><span>Photos & Drawings</span><strong>{data.visuals.filter((item) => item.included).length} Visuals</strong><small>{data.visuals.filter((item) => item.included && item.placement === "Design Drawing").length} Design Drawing{data.visuals.filter((item) => item.included && item.placement === "Design Drawing").length === 1 ? "" : "s"}</small></article><article><span>Issue Readiness</span><strong>{issueErrors.length ? `${issueErrors.length} Items Open` : "Ready"}</strong><small>{issueErrors.join(" · ") || "Required Project Owner information is complete"}</small></article></div>

              <button type="button" className="proposal-preview-button" onClick={() => void openPdf()}>Save And Open Full Branded PDF Preview ↗</button>
            </> : null}
          </fieldset>
        </main>

      </div>

      <footer className="proposal-studio-footer">
        <div><strong>{proposalStatus} / Revision {data.revision}</strong><span>{isIssued ? `Issued ${displayDate(data.issuedAt.slice(0, 10))} By ${data.issuedBy}` : isApprovedToSend ? `Approved For ${data.ownerContactEmail || data.ownerName || "Project Owner"}` : isReadyForReview ? "Company Owner Decision Required" : "Draft"}</span></div>
        <span />
        <button className="secondary-action proposal-footer-preview" disabled={saving || wordBusy} onClick={() => void openPdf()}>{isIssued ? "Open Issued Project Owner PDF" : isEngagement ? "Preview Engagement PDF" : "Preview Proposal PDF"}</button>
        {proposalStatus === "Draft" ? <><button className="secondary-action" disabled={saving || wordBusy} onClick={() => void requestAction("save")}>{saving ? "Saving..." : "Save Draft"}</button><button className="primary-action large" disabled={saving || wordBusy} onClick={() => void requestAction("submit-review")}>Send For Company Owner Review →</button></> : null}
        {isReadyForReview && canReview ? <><button className="secondary-action" disabled={saving || wordBusy} onClick={() => void decideReview("Returned")}>Return To Draft</button><button className="primary-action large" disabled={saving || wordBusy || issueErrors.length > 0} onClick={() => void decideReview("Approved")}>Approve To Send →</button></> : null}
        {isReadyForReview && !canReview ? <button className="secondary-action" disabled>Company Owner Review Pending</button> : null}
        {isApprovedToSend && permissions.canIssue ? <button className="primary-action large" disabled={saving || wordBusy || issueErrors.length > 0} onClick={() => void requestAction("issue")}>Create Approved PDF →</button> : null}
        {isApprovedToSend && !permissions.canIssue ? <button className="secondary-action" disabled>Company Owner Or Administrator Must Issue The PDF</button> : null}

        {isIssued ? <button className="primary-action large" disabled={saving || wordBusy} onClick={() => void requestAction("start-revision")}>Start Revision {data.revision + 1} →</button> : null}
      </footer>
    </section>
  </div>;
}

function EditorHeading({ title }: { title: string }) {
  return <header className="proposal-editor-heading"><h2>{title}</h2></header>;
}

function ProposalField({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={`proposal-field ${wide ? "wide" : ""}`}><span><b>{label}</b></span>{children}</label>;
}

function ProposalPreview({ data }: { data: ProposalData }) {
  return <section className="owner-doc-preview owner-doc-proposal-preview">
    <header><Image src="/mefford-logo.png" unoptimized alt="" width={711} height={738} /><span>PROJECT PROPOSAL<small>Revision {data.revision} / {displayDate(data.proposalDate)}</small></span></header>
    <div className="owner-doc-preview-title"><small>A PROPOSAL FOR</small><h2>{data.projectName}</h2><p>{data.projectLocation || "Project location to be confirmed"}</p><em>{data.subtitle}</em></div>
    <div className="owner-doc-preview-values"><span>OUR CORE VALUES</span>{MEFFORD_CORE_VALUES.map((value) => <b key={value}>{value}</b>)}</div>
    <footer><span>PREPARED FOR<strong>{data.ownerContactName || "Owner contact to be confirmed"}</strong><small>{data.ownerName || "Customer company to be confirmed"}</small>{data.ownerContactTitle ? <small>{data.ownerContactTitle}</small> : null}{data.ownerContactEmail || data.ownerContactPhone ? <small>{[data.ownerContactEmail, data.ownerContactPhone].filter(Boolean).join(" · ")}</small> : null}{data.customerLogoFileId ? <Image src={`/api/files?id=${data.customerLogoFileId}`} alt={`${data.ownerName} logo`} width={180} height={80} unoptimized /> : null}</span><span>MEFFORD CONTRACTING<strong>Built Around The Work</strong><small>Valid through {displayDate(data.validThrough)}</small></span></footer>
  </section>;
}

function EngagementPreview({ data }: { data: ProposalData }) {
  return <section className="owner-doc-preview owner-doc-engagement-preview">
    <header><Image src="/mefford-logo.png" unoptimized alt="" width={711} height={738} /><span>MEFFORD CONTRACTING, LLC<small>833-MEFFCON / MEFFCON.COM</small></span></header>
    <div className="owner-doc-letter-address"><time>{displayDate(data.proposalDate)}</time><strong>{data.ownerContactName || `${data.ownerName} Team`}</strong>{data.ownerContactName ? <span>{data.ownerName}</span> : null}<span>{data.projectLocation || "Project location to be confirmed"}</span></div>
    <div className="owner-doc-letter-body"><b>RE: {data.projectName}</b><p>Dear {salutationName(data.ownerContactName, data.ownerName)},</p><p>{data.executiveSummary}</p></div>
    <aside><span>ENGAGEMENT FEE<strong>{money(data.contractPrice)}</strong></span><span>VALID THROUGH<strong>{displayDate(data.validThrough)}</strong></span></aside>
    <footer><span>OUR CORE VALUES</span>{MEFFORD_CORE_VALUES.map((value) => <b key={value}>{value}</b>)}</footer>
  </section>;
}

function stepComplete(step: string, data: ProposalData) {
  if (step === "details") return Boolean(data.projectName && data.ownerName && (data.publicBid || data.ownerContactName) && data.projectLocation && data.targetStartDate && data.durationMonths > 0);
  if (step === "story") return Boolean(data.executiveSummary && data.projectUnderstanding);
  if (step === "team") return Boolean(data.proposedProjectManagerEmail && data.proposedSuperintendentEmail && data.teamMembers.some((item) => item.includeInProposal));
  if (step === "schedule") return Boolean(data.scheduleNarrative && data.scheduleMilestones.some((item) => item.included && item.title && item.startDate && item.endDate));
  if (step === "basis") return data.assumptions.length > 0 && data.exclusions.length > 0;
  if (step === "visuals") return data.visuals.every((item) => !item.included || item.kind === "Photo" || /^(?:all|\d+(?:-\d+)?(?:\s*,\s*\d+(?:-\d+)?)*)$/i.test(item.pageSelection.trim()));
  if (step === "approach") return data.approachPhases.some((item) => item.included && item.description);
  if (step === "scope") return data.scopeSections.some((item) => item.included && item.description);
  if (step === "commercials") return data.contractPrice > 0 && (!isDesignBuildProposal(data) || data.designStartupGmp > 0) && Boolean(data.paymentTerms && data.validThrough && data.recommendationSteps.length && (data.packetType !== "Preconstruction Letter of Engagement" || data.nextSteps));
  return proposalIssueErrors(data).length === 0;
}

function textLines(value: string) {
  return value.split(/\r?\n/).map((item) => item.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);
}

function displayDate(value: string) {
  if (!value) return "Not Set";
  const [year, month, day] = value.split("-").map(Number);
  return year && month && day ? `${month}/${day}/${year}` : value;
}

function salutationName(contactName: string, ownerName: string) {
  const first = contactName.trim().split(/\s+/).filter(Boolean)[0];
  return first || `${ownerName.trim() || "Project"} Team`;
}

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((item) => item[0]?.toUpperCase()).join("") || "MC";
}
