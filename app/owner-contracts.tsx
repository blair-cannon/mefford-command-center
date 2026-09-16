"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  OWNER_CONTRACT_CONTACT_ROUTING_FIELDS,
  OWNER_CONTRACT_ROUTING_OVERRIDE_FIELDS,
  OWNER_CONTRACT_TYPES,
  contractFieldGroup,
  contractFieldInput,
  contractFieldLabel,
  contractTemplate,
  contractTemplateForStoredVersion,
  defaultContractInstrument,
  defaultContractFields,
  isExecutionControlField,
  isScalarMoneyContractField,
  isSignatureContractField,
  isSmallProjectPricingField,
  isSystemManagedContractField,
  normalizeOwnerContractType,
  requiredContractFields,
  synchronizeOwnerContractContactFields,
  type OwnerContractInstrument,
  type OwnerContractType,
} from "../lib/owner-contracts";
import { CurrencyInput } from "./currency-input";
import { ContractBasisAttachments } from "./contract-basis-attachments";
import { OwnerContactRoutingPanel } from "./owner-contact-routing-panel";
import { SmallProjectPricingPanel } from "./small-project-pricing-panel";
import { SignaturePad } from "./signature-pad";
import { summaryDrilldownProps } from "./summary-drilldown";
import {
  mergeOwnerContractPrefill,
  type OwnerContractFieldSource,
  type OwnerContractPrefill,
} from "../lib/owner-contract-prefill";
import { isOwnerContractBasisField, ownerContractBasisAttachments } from "../lib/owner-contract-basis";

type ContractRecord = {
  id: string;
  type?: string;
  title: string;
  owner: string;
  due: string;
  status: string;
  meta: string;
  recordDate?: string;
  dateLocked?: boolean;
  data?: Record<string, unknown>;
};

type ContractProject = {
  number: string;
  name: string;
  site: string;
  ownerName: string;
  ownerContractDate: string;
  architect: string;
  contractAmount: string;
  startDate: string;
  substantialDate: string;
  finalDate: string;
  projectManager: string;
  superintendent?: string;
  projectType?: string;
  ownerContractType?: OwnerContractType;
  ownerContractStatus?: string;
  ownerContractRecordId?: string;
  paymentTerms?: string;
  retainageInitialPercent?: string;
  retainageAfterHalfPercent?: string;
};

type ContractActor = {
  name: string;
  email: string;
  accessLevel: string;
};

type SignatureData = {
  signerName?: string;
  signerTitle?: string;
  signerEmail?: string;
  signatureImage?: string;
  signedAt?: string;
};

type ContractWorkflow = {
  access?: { status?: string; contact_name?: string; contact_email?: string; approved_revision_id?: string; invited_at?: string };
  revisions?: Array<{ id: string; revision_number: number; phase: string; snapshot_hash: string; note: string; created_by_name: string; created_at: string; frozen_at?: string | null; fields?: Record<string, unknown> }>;
  changeRequests?: Array<{ id: string; clause_key: string; request_type: string; proposed_text: string; comment: string; status: string; mefford_response: string; created_by_name: string; created_at: string }>;
  invites?: Array<{ id: string; contact_name: string; email: string; status: string; expires_at: string; verified_at?: string | null; revoked_at?: string | null }>;
  audits?: Array<{ id: number; action: string; detail: string; actor_name: string; created_at: string }>;
  contract?: ContractRecord | null;
  prefill?: OwnerContractPrefill;
  invite?: { id: string; link: string; code: string; email: string; expiresAt: string; deliveryStatus: string };
};
type WorkflowRevision = NonNullable<ContractWorkflow["revisions"]>[number];
type ContractStudioStep = "setup" | "required" | "additional" | "review" | "signatures";

const groupOrder = [
  "External Contract Intake & Mapping",
  "Parties, Notices & Signatures",
  "Project Details & Project Owner Requirements",
  "Price, Billing & Accounting",
  "Schedule & Phasing",
  "Scope & Project Controls",
  "Design Services",
  "Insurance, Bonds & Risk",
  "Legal, Attachments & Document Control",
];

const ownerContactRoutingFieldSet = new Set<string>(OWNER_CONTRACT_CONTACT_ROUTING_FIELDS);

export function OwnerContractWorkspace({
  project,
  actor,
  records,
  onRecordsChange,
  onProjectChange,
  onClose,
}: {
  project: ContractProject;
  actor: ContractActor;
  records: ContractRecord[];
  onRecordsChange: (records: ContractRecord[]) => void;
  onProjectChange: (changes: Partial<ContractProject>) => void;
  onClose: () => void;
}) {
  const controlledRecord = records.find((record) => Boolean(normalizeOwnerContractType(record.data?.contractType)));
  const storedType = normalizeOwnerContractType(controlledRecord?.data?.contractType);
  const initialType = storedType || normalizeOwnerContractType(project.ownerContractType) || "Plan & Spec Lump Sum";
  const [contractType, setContractType] = useState<OwnerContractType>(initialType);
  const activeInstrument = String(normalizeOwnerContractType(controlledRecord?.data?.contractType) === contractType ? controlledRecord?.data?.activeInstrument || defaultContractInstrument(contractType) : defaultContractInstrument(contractType)) as OwnerContractInstrument;
  const initialManualFieldKeys = normalizeStringArray(controlledRecord?.data?.manualFieldKeys);
  const initialRouting = synchronizeOwnerContractContactFields({
    ...defaultContractFields(initialType, project, actor, activeInstrument),
    ...normalizeFields(controlledRecord?.data?.fields),
  }, initialManualFieldKeys);
  const [fields, setFields] = useState<Record<string, string>>(() => initialRouting.fields);
  const fieldsRef = useRef(fields);
  const [templateFields, setTemplateFields] = useState<string[]>([]);

  const [fieldSources, setFieldSources] = useState<Record<string, OwnerContractFieldSource>>(() => normalizeFieldSources(controlledRecord?.data?.fieldSources));
  const [manualFieldKeys, setManualFieldKeys] = useState<Set<string>>(() => new Set(initialRouting.manualFieldKeys));
  const [paymentTerms, setPaymentTerms] = useState(String(controlledRecord?.data?.paymentTerms || project.paymentTerms || fields.PAYMENT_TERMS || ""));
  const [retainageInitialPercent, setRetainageInitialPercent] = useState(Number(controlledRecord?.data?.retainageInitialPercent ?? project.retainageInitialPercent ?? 10));
  const [retainageAfterHalfPercent, setRetainageAfterHalfPercent] = useState(Number(controlledRecord?.data?.retainageAfterHalfPercent ?? project.retainageAfterHalfPercent ?? 5));
  const [query, setQuery] = useState("");
  const [studioStep, setStudioStep] = useState<ContractStudioStep>("setup");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [signingRole, setSigningRole] = useState<"owner" | "mefford" | null>(null);
  const [signerName, setSignerName] = useState("");
  const [signerTitle, setSignerTitle] = useState("");
  const [signerEmail, setSignerEmail] = useState("");
  const [signatureImage, setSignatureImage] = useState("");
  const [signatureConsent, setSignatureConsent] = useState(false);
  const [workflow, setWorkflow] = useState<ContractWorkflow>({});
  const [requestResponse, setRequestResponse] = useState<Record<string, string>>({});
  const [revisionCompareId, setRevisionCompareId] = useState("");
  const [uploadingExternal, setUploadingExternal] = useState(false);
  const status = controlledRecord?.status || "Not Created";
  const isEditable = !controlledRecord || ["Draft", "Draft Preparation", "Mefford Revision", "GMP Exhibit A Draft"].includes(status);
  const template = isEditable
    ? contractTemplate(contractType, activeInstrument)
    : contractTemplateForStoredVersion(contractType, activeInstrument, String(controlledRecord?.data?.templateVersion || ""));

  useEffect(() => {
    fieldsRef.current = fields;
  }, [fields]);

  useEffect(() => {
    let cancelled = false;
    fetch(template.htmlPath)
      .then((response) => response.text())
      .then((html) => {
        if (cancelled) return;
        const tags = Array.from(html.matchAll(/\{\{([A-Z0-9_]+)\}\}/g), (match) => match[1]);
        setTemplateFields(Array.from(new Set(tags)).sort());
      })
      .catch(() => !cancelled && setNotice("The Controlled Contract Field Index Could Not Be Loaded."));
    return () => { cancelled = true; };
  }, [template.htmlPath]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/contracts?projectId=${encodeURIComponent(project.number)}&contractType=${encodeURIComponent(contractType)}&activeInstrument=${encodeURIComponent(activeInstrument)}`)
      .then((response) => response.json().then((result) => ({ response, result })))
      .then(({ response, result }) => {
        if (cancelled || !response.ok) return;
        const loadedWorkflow = result as ContractWorkflow;
        setWorkflow(loadedWorkflow);
        if (loadedWorkflow.prefill) {
          const storedData = loadedWorkflow.contract?.data || {};
          const storedFields = normalizeFields(storedData.fields);
          const manual = resolveManualKeys(storedData.manualFieldKeys, storedFields, loadedWorkflow.prefill);

          const merged = mergeOwnerContractPrefill({ ...fieldsRef.current, ...storedFields }, loadedWorkflow.prefill!, manual, true);
          const routing = synchronizeOwnerContractContactFields(merged.fields, manual);
          const routedManual = new Set(routing.manualFieldKeys);
          setManualFieldKeys(routedManual);
          setFields(routing.fields);
          setFieldSources({ ...normalizeFieldSources(storedData.fieldSources), ...loadedWorkflow.prefill.sources, ...manualSources(routedManual) });
          if (!manual.has("PAYMENT_TERMS")) setPaymentTerms((current) => loadedWorkflow.prefill?.fields.PAYMENT_TERMS || current);
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [activeInstrument, contractType, project.number]);

  const required = requiredContractFields(contractType, activeInstrument, fields);
  const missingRequired = required.filter((field) => !fields[field]?.trim());
  const editableTemplateFields = templateFields.filter((field) =>
    !isSignatureContractField(field)
    && !isExecutionControlField(field)
    && !isSystemManagedContractField(field)
    && !isSmallProjectPricingField(field)
  );
  const filledCount = editableTemplateFields.filter((field) => fields[field]?.trim()).length;
  const signatures = parseObject(controlledRecord?.data?.signatures);
  const ownerSignature = parseObject(signatures.owner) as SignatureData;
  const meffordSignature = parseObject(signatures.mefford) as SignatureData;
  const ownerContact = {
    name: fields.OWNER_SIGNATORY || fields.OWNER_PRIMARY_CONTACT_NAME || "",
    email: fields.OWNER_SIGNATORY_EMAIL || fields.OWNER_PRIMARY_CONTACT_EMAIL || fields.OWNER_NOTICE_EMAIL || "",
  };
  const basisAttachments = ownerContractBasisAttachments(fields);
  const workflowStatus = String(workflow.access?.status || status);
  const workflowStatusLabel = contractWorkflowStatusLabel(workflowStatus);
  const isExecuted = status === "Executed";
  const isCompanyOwner = actor.accessLevel === "Company Owner";
  const projectOwnerReviewStarted = ["Approved for Owner Review", "Owner Review", "Changes Requested", "Mefford Revision", "Owner Review Complete", "Ready for Signature", "Owner Signed", "Executed"].includes(workflowStatus);
  const groupedFields = (() => {
    const visible = editableTemplateFields.filter((field) => {
      if (ownerContactRoutingFieldSet.has(field)) return false;
      if (studioStep === "required" && !required.includes(field)) return false;
      if (studioStep === "additional" && required.includes(field)) return false;
      if (!query.trim()) return true;
      return `${field} ${contractFieldLabel(field)} ${contractFieldGroup(field)}`.toLowerCase().includes(query.toLowerCase());
    });
    return groupOrder.map((group) => ({ group, fields: visible.filter((field) => contractFieldGroup(field) === group) })).filter((entry) => entry.fields.length);
  })();

  function chooseType(nextType: OwnerContractType) {
    if (!isEditable) return;
    setContractType(nextType);
    setFields((current) => synchronizeOwnerContractContactFields({ ...defaultContractFields(nextType, project, actor, defaultContractInstrument(nextType)), ...current, DESIGN_SERVICES_INCLUDED_OR_EXCLUDED: nextType.startsWith("Design-Build") ? "INCLUDED" : "EXCLUDED" }, manualFieldKeys).fields);
    setNotice(`${nextType} Selected. Refreshing Project, Contact, Estimate, And Proposal Information.`);
  }

  async function uploadExternalContract(file: File) {
    setUploadingExternal(true);
    setNotice("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("projectId", project.number);
      form.set("category", "Contracts / External Agreement");
      form.set("revision", fields.EXTERNAL_CONTRACT_FILE_REVISION || "Received External Contract");
      form.set("access", "Project Owner And Contract Team");
      const response = await fetch("/api/files", { method: "POST", body: form });
      const result = await response.json() as { file?: { id: number; name: string; revision: string }; error?: string };
      if (!response.ok || !result.file) throw new Error(result.error || "The External Contract Could Not Be Uploaded.");
      setFields((current) => ({ ...current, EXTERNAL_CONTRACT_FILE_ID: String(result.file?.id || ""), EXTERNAL_CONTRACT_FILE_NAME: result.file?.name || "", EXTERNAL_CONTRACT_FILE_REVISION: result.file?.revision || current.EXTERNAL_CONTRACT_FILE_REVISION }));
      setNotice(`${result.file.name} Is Now The Preserved Controlling Source. Complete The Mapping Before Internal Review.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The External Contract Could Not Be Uploaded.");
    } finally {
      setUploadingExternal(false);
    }
  }

  function setField(field: string, value: string) {
    const nextManual = new Set(manualFieldKeys);
    const routingOverrideField = OWNER_CONTRACT_ROUTING_OVERRIDE_FIELDS.includes(field as (typeof OWNER_CONTRACT_ROUTING_OVERRIDE_FIELDS)[number]);
    if (routingOverrideField && !value.trim()) nextManual.delete(field);
    else nextManual.add(field);
    const routing = synchronizeOwnerContractContactFields({ ...fields, [field]: value }, nextManual);
    setFields(routing.fields);
    setManualFieldKeys(new Set(routing.manualFieldKeys));
    setFieldSources((current) => {
      const next = { ...current };
      if (value.trim()) next[field] = { kind: "Manual", label: "Manual Override" };
      else delete next[field];
      return next;
    });
    if (field === "PAYMENT_TERMS") setPaymentTerms(value);
  }

  function markRetainageManual() {
    const keys = ["RETAINAGE_PERCENTAGE", "RETAINAGE_TERMS", "RETAINAGE_TERMS_AND_RELEASE", "CONSTRUCTION_RETAINAGE"];
    setManualFieldKeys((current) => new Set([...current, ...keys]));
    setFieldSources((current) => ({ ...current, ...manualSources(keys) }));
  }

  async function refreshSourceData() {
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch(`/api/contracts?projectId=${encodeURIComponent(project.number)}&contractType=${encodeURIComponent(contractType)}&activeInstrument=${encodeURIComponent(activeInstrument)}`);
      const result = await response.json() as ContractWorkflow & { error?: string };
      if (!response.ok || !result.prefill) throw new Error(result.error || "Project And Estimate Information Could Not Be Refreshed.");
      const merged = mergeOwnerContractPrefill(fields, result.prefill, manualFieldKeys, true);
      const routing = synchronizeOwnerContractContactFields(merged.fields, manualFieldKeys);
      const routedManual = new Set(routing.manualFieldKeys);

      setFields(routing.fields);
      setManualFieldKeys(routedManual);
      setFieldSources({ ...result.prefill.sources, ...manualSources(routedManual) });
      if (!routedManual.has("PAYMENT_TERMS")) setPaymentTerms(routing.fields.PAYMENT_TERMS || paymentTerms);
      setWorkflow(result);
      setNotice("Project data refreshed.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Project And Estimate Information Could Not Be Refreshed.");
    } finally {
      setSaving(false);
    }
  }

  async function save(releaseForSignature: boolean) {
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          projectId: project.number,
          recordId: controlledRecord?.id,
          contractType,
          releaseForSignature,
          fields: { ...fields, PAYMENT_TERMS: paymentTerms },
          paymentTerms,
          retainageInitialPercent,
          retainageAfterHalfPercent,
          manualFieldKeys: [...manualFieldKeys],
        }),
      });
      const result = await response.json() as { record?: ContractRecord; project?: Partial<ContractProject>; error?: string; missingFields?: string[] };
      if (!response.ok || !result.record) {
        if (result.missingFields?.length) setStudioStep("required");
        throw new Error(result.error || "The Project Owner Contract Could Not Be Saved.");
      }
      onRecordsChange([result.record, ...records.filter((record) => record.id !== result.record?.id)]);
      if (result.project) onProjectChange(result.project);
      await refreshWorkflow();
      setNotice(releaseForSignature ? "Controlled Draft Saved. Internal Review And Company Owner Approval Are Still Required Before Sending It To The Project Owner." : "Contract Draft Saved. Project Accounting And Project Owner Billing Were Updated From The Same Data.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Project Owner Contract Could Not Be Saved.");
    } finally {
      setSaving(false);
    }
  }

  async function refreshWorkflow() {
    const response = await fetch(`/api/contracts?projectId=${encodeURIComponent(project.number)}`);
    const result = await response.json() as ContractWorkflow & { error?: string };
    if (!response.ok) throw new Error(result.error || "The Contract Workflow Could Not Be Refreshed.");
    setWorkflow(result);
    if (result.contract) onRecordsChange([result.contract, ...records.filter((record) => record.id !== result.contract?.id)]);
    return result;
  }

  async function workflowAction(action: string, payload: Record<string, unknown> = {}, success = "Contract Workflow Updated.") {
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, projectId: project.number, recordId: controlledRecord?.id, ...payload }),
      });
      const result = await response.json() as ContractWorkflow & { error?: string; missingFields?: string[] };
      if (!response.ok) {
        if (result.missingFields?.length) setStudioStep("required");
        throw new Error(result.error || "The Contract Workflow Could Not Be Updated.");
      }
      setWorkflow(result);
      if (result.contract) onRecordsChange([result.contract, ...records.filter((record) => record.id !== result.contract?.id)]);
      setNotice(success);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Contract Workflow Could Not Be Updated.");
    } finally {
      setSaving(false);
    }
  }

  function beginSignature(role: "owner" | "mefford") {
    setSigningRole(role);
    setSignatureImage("");
    setSignatureConsent(false);
    if (role === "owner") {
      setSignerName(fields.OWNER_SIGNATORY || fields.OWNER_AUTHORIZED_REPRESENTATIVE || "");
      setSignerTitle(fields.OWNER_SIGNATORY_TITLE || "");
      setSignerEmail(fields.OWNER_NOTICE_EMAIL || "");
    } else {
      setSignerName(fields.CONTRACTOR_SIGNATORY || fields.DESIGN_BUILDER_SIGNATORY || actor.name);
      setSignerTitle(fields.CONTRACTOR_SIGNATORY_TITLE || fields.DESIGN_BUILDER_SIGNATORY_TITLE || "");
      setSignerEmail(fields.CONTRACTOR_NOTICE_EMAIL || fields.DESIGN_BUILDER_NOTICE_EMAIL || actor.email);
    }
  }

  async function submitSignature() {
    if (!controlledRecord || !signingRole) return;
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sign",
          projectId: project.number,
          recordId: controlledRecord.id,
          signature: { role: signingRole, signerName, signerTitle, signerEmail, signatureImage, consent: signatureConsent },
        }),
      });
      const result = await response.json() as { record?: ContractRecord; fullyExecuted?: boolean; instrumentExecuted?: boolean; nextStep?: string; error?: string };
      if (!response.ok || !result.record) throw new Error(result.error || "The Signature Could Not Be Saved.");
      onRecordsChange([result.record, ...records.filter((record) => record.id !== result.record?.id)]);
      onProjectChange({ ownerContractStatus: result.record.status, ownerContractRecordId: result.record.id });
      setSigningRole(null);
      setNotice(result.fullyExecuted ? "Project Owner Contract Fully Executed. The Locked Record Is Synchronized With Projects, Accounting, And Project Owner Billing." : result.instrumentExecuted ? `Phase 1 Design Authorization Executed And Preserved. ${result.nextStep || "Open GMP Exhibit A When Design Is Complete."}` : "Signature Captured. The Same Contract Packet Is Ready For The Remaining Signer.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Signature Could Not Be Saved.");
    } finally {
      setSaving(false);
    }
  }

  function openDocument() {
    if (!controlledRecord) return;
    window.open(`/api/contracts/document?projectId=${encodeURIComponent(project.number)}&recordId=${encodeURIComponent(controlledRecord.id)}`, "_blank", "noopener,noreferrer");
  }

  return <div className="proposal-studio-layer owner-contract-studio-layer" role="dialog" aria-modal="true" aria-label={`${project.name} Project Owner Contract Builder`}>
    <section className="owner-contract-workspace proposal-studio-shell project-contract-studio-shell">
    <header className="proposal-studio-header project-contract-studio-header">
      <div className="proposal-studio-brand"><Image src="/mefford-logo.png" unoptimized alt="Mefford Contracting" width={711} height={738} priority /><span><b>PROJECT OWNER CONTRACT</b><strong>{project.name}</strong><small>{controlledRecord?.id || "No Controlled Contract Yet"}</small></span></div>
      <div className="project-contract-header-summary"><span>Current Contract</span><strong>{template.label}</strong><small>{template.description}</small></div>
      <div className="proposal-header-actions"><span className={`proposal-status ${workflowStatus.toLowerCase().replaceAll(" ", "-")}`}>{workflowStatusLabel}</span><button aria-label="Close Project Owner Contract Builder" onClick={onClose}>×</button></div>
    </header>

    {notice ? <button className="proposal-notice" onClick={() => setNotice("")}>{notice}<span>×</span></button> : null}

    <section className="proposal-source-strip project-contract-source-strip">
      <button className="secondary-action" disabled={saving || !isEditable} onClick={() => void refreshSourceData()}>Pull Latest Project Data</button>
      {missingRequired.length ? <span className="studio-open-items">{missingRequired.length} Required Terms Open</span> : null}
    </section>

    <div className="proposal-studio-body project-contract-studio-body">
      <nav className="proposal-step-rail" aria-label="Project Owner Contract Sections">
        <button className={studioStep === "setup" ? "active" : ""} onClick={() => setStudioStep("setup")}><span>01</span><strong>Contract Setup</strong><i>{controlledRecord ? "✓" : ""}</i></button>
        <button className={studioStep === "required" ? "active" : ""} onClick={() => { setStudioStep("required"); setQuery(""); }}><span>02</span><strong>Required Terms</strong><i>{missingRequired.length || "✓"}</i></button>
        <button className={studioStep === "additional" ? "active" : ""} onClick={() => { setStudioStep("additional"); setQuery(""); }}><span>03</span><strong>Additional Clauses</strong><i /></button>
        <button className={studioStep === "review" ? "active" : ""} onClick={() => setStudioStep("review")}><span>04</span><strong>Project Owner Review</strong><i>{projectOwnerReviewStarted ? "✓" : ""}</i></button>
        <button className={studioStep === "signatures" ? "active" : ""} onClick={() => setStudioStep("signatures")}><span>05</span><strong>Signatures</strong><i>{isExecuted ? "✓" : ""}</i></button>
      </nav>

      <main className="proposal-editor-panel project-contract-editor-panel">

    {studioStep === "setup" ? <fieldset className="project-contract-studio-view">
    <div className="proposal-editor-heading"><h2>Contract Setup</h2></div>

    <section className="contract-type-picker" aria-label="Project Owner Contract Type">
      {OWNER_CONTRACT_TYPES.map((type) => {
        const item = contractTemplate(type);
        return <button key={type} className={contractType === type ? "active" : ""} disabled={!isEditable} onClick={() => chooseType(type)}><strong>{item.label}</strong><small>{item.description}</small><i>{item.id}</i></button>;
      })}
    </section>

    {contractType === "Time & Materials" ? <SmallProjectPricingPanel fields={fields} disabled={!isEditable} onChange={setField} /> : null}

    {contractType === "Design-Build GMP" ? <section className="gmp-instrument-strip"><article className={activeInstrument === "Phase 1 Agreement" ? "active" : "complete"}><span>1</span><div><strong>Phase 1 Design Authorization</strong><small>Design scope, fee, deliverables, and target date.</small></div></article><article className={activeInstrument === "GMP Exhibit A" ? "active" : status === "Phase 1 Executed" ? "ready" : "locked"}><span>2</span><div><strong>GMP Exhibit A</strong><small>Final GMP, cost details, and construction dates.</small></div></article></section> : null}

    {contractType === "External Contract" ? <section className="external-contract-intake"><header><div><h2>Add The Other Party’s Contract</h2></div><i>{fields.EXTERNAL_CONTRACT_FILE_ID ? "SOURCE PRESERVED" : "SOURCE REQUIRED"}</i></header><div><label className="external-contract-upload"><input type="file" disabled={!isEditable || uploadingExternal} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadExternalContract(file); event.currentTarget.value = ""; }} /><span>＋</span><strong>{uploadingExternal ? "Uploading Controlling Contract…" : fields.EXTERNAL_CONTRACT_FILE_NAME || "Choose The External Contract"}</strong><small>Any File Type · Uploaded Version Is Permanent</small></label>{fields.EXTERNAL_CONTRACT_FILE_ID ? <article><b>{fields.EXTERNAL_CONTRACT_FILE_NAME}</b><span>File {fields.EXTERNAL_CONTRACT_FILE_ID} · {fields.EXTERNAL_CONTRACT_FILE_REVISION || "Confirm The Revision"}</span><a href={`/api/files?id=${encodeURIComponent(fields.EXTERNAL_CONTRACT_FILE_ID)}`} target="_blank" rel="noreferrer">Open Controlling File ↗</a></article> : null}</div><label className="award-confirmation"><input type="checkbox" disabled={!isEditable || !fields.EXTERNAL_CONTRACT_FILE_ID} checked={fields.EXTERNAL_CONTRACT_CONTROLS_CONFIRMATION === "YES — THE UPLOADED EXTERNAL AGREEMENT CONTROLS"} onChange={(event) => setField("EXTERNAL_CONTRACT_CONTROLS_CONFIRMATION", event.target.checked ? "YES — THE UPLOADED EXTERNAL AGREEMENT CONTROLS" : "")} /><span><strong>Controlling Document</strong>The uploaded contract controls. This record only connects it to Mefford’s project systems.</span></label></section> : null}

    <ContractBasisAttachments projectId={project.number} fields={fields} disabled={!isEditable || saving} onChange={setFields} onNotice={setNotice} />

    <section className="contract-flow-summary">
      <article {...summaryDrilldownProps({ title: "Controlled Project Owner Contract Template", rows: [{ id: template.id, title: template.label, subtitle: contractType, value: template.version, status: "Current" }] })}><span>Template</span><strong>{template.id}</strong><small>{template.version}</small></article>
      <article {...summaryDrilldownProps({ title: "Project Owner Contract Field Completion", rows: editableTemplateFields.map((field) => ({ id: field, title: contractFieldLabel(field), value: fields[field]?.trim() ? "Complete" : "Open", status: required.includes(field) && !fields[field]?.trim() ? "Required Open" : fields[field]?.trim() ? "Complete" : "Optional Open", meta: fields[field]?.trim() || undefined })) })}><span>Fields</span><strong>{filledCount} / {editableTemplateFields.length || "—"}</strong><small>{missingRequired.length ? `${missingRequired.length} Required Open` : "Required Fields Complete"}</small></article>
      <article {...summaryDrilldownProps({ title: "Project Contract Synchronization", rows: [{ id: project.number, title: project.name, subtitle: `${project.ownerName} · ${contractType}`, value: project.contractAmount, status: workflowStatusLabel, meta: `${project.startDate} → ${project.finalDate}` }] })}><span>Project Sync</span><strong>Active</strong><small>Project Owner · Dates · Value</small></article>
      <article {...summaryDrilldownProps({ title: "Accounting Contract Synchronization", rows: [{ id: controlledRecord?.id || project.number, title: `${project.name} Accounting Terms`, subtitle: paymentTerms, value: `${retainageInitialPercent}% / ${retainageAfterHalfPercent}% Retainage`, status: controlledRecord ? "Synchronized" : "Draft" }] })}><span>Accounting Sync</span><strong>Active</strong><small>Billing · Retainage · Payment Terms</small></article>
    </section>
    <OwnerContactRoutingPanel fields={fields} required={required} sources={fieldSources} disabled={!isEditable} onChange={setField} />
    <div className="contract-accounting-strip"><label>Payment Terms<textarea rows={2} value={paymentTerms} disabled={!isEditable} onChange={(event) => { setPaymentTerms(event.target.value); setField("PAYMENT_TERMS", event.target.value); }} /></label><label>Retainage Before 50%<span><input type="number" min="0" max="100" step="0.1" value={retainageInitialPercent} disabled={!isEditable} onChange={(event) => { setRetainageInitialPercent(Number(event.target.value)); markRetainageManual(); }} />%</span></label><label>Retainage After 50%<span><input type="number" min="0" max="100" step="0.1" value={retainageAfterHalfPercent} disabled={!isEditable} onChange={(event) => { setRetainageAfterHalfPercent(Number(event.target.value)); markRetainageManual(); }} />%</span></label></div>
    </fieldset> : null}

    {studioStep === "review" ? <fieldset className="project-contract-studio-view">
      <div className="proposal-editor-heading"><h2>Review & Release</h2></div>
      <section className="owner-portal-control-strip"><article {...summaryDrilldownProps({ title: "Project Owner Contract Portal Access", rows: workflow.access ? [{ id: workflow.access.approved_revision_id || controlledRecord?.id || project.number, title: workflow.access.contact_name || project.ownerName, subtitle: workflow.access.contact_email || "No Project Owner Login Has Been Issued", status: workflowStatusLabel, meta: workflow.access.invited_at ? `Invited ${workflow.access.invited_at}` : "Not Released" }] : [] })}><span>PROJECT OWNER ACCESS</span><strong>{workflowStatus === "Dormant" ? "Prepared · Not Active" : workflowStatusLabel}</strong><small>{workflow.access?.contact_email || "No Project Owner Login Has Been Issued"}</small></article><article {...summaryDrilldownProps({ title: "Project Owner Contract Revisions", rows: (workflow.revisions || []).map((revision) => ({ id: revision.id, title: `Revision ${revision.revision_number}`, subtitle: `${revision.phase} · ${revision.created_by_name}`, status: revision.frozen_at ? "Frozen" : "Current", meta: revision.note || revision.snapshot_hash })) })}><span>REVISIONS</span><strong>{workflow.revisions?.length || 0}</strong><small>Saved Contract Versions</small></article><article {...summaryDrilldownProps({ title: "Open Project Owner Contract Change Requests", rows: (workflow.changeRequests || []).filter((request) => request.status === "Open").map((request) => ({ id: request.id, title: `${request.request_type} · ${request.clause_key}`, subtitle: request.created_by_name || workflow.access?.contact_name || project.ownerName, status: request.status, meta: request.comment || request.proposed_text || request.created_at })) })}><span>OPEN REQUESTS</span><strong>{workflow.changeRequests?.filter((request) => request.status === "Open").length || 0}</strong><small>Project Owner Changes To Review</small></article><article {...summaryDrilldownProps({ title: "Project Owner Contract Portal Invites", rows: (workflow.invites || []).filter((invite) => !invite.revoked_at).map((invite) => ({ id: invite.id, title: invite.email || workflow.access?.contact_email || project.ownerName, subtitle: invite.contact_name || "Project Owner Contact", status: invite.status, meta: invite.expires_at ? `Expires ${invite.expires_at}` : undefined })) })}><span>ACTIVE INVITE</span><strong>{workflow.invites?.find((invite) => !invite.revoked_at)?.status || "None"}</strong><small>Sent Only After Approval</small></article></section>
    </fieldset> : null}

    {studioStep === "required" || studioStep === "additional" ? <fieldset className="project-contract-studio-view">
      <div className="proposal-editor-heading"><h2>{studioStep === "required" ? "Required Terms" : "Additional Clauses"}</h2></div>
      <input className="contract-studio-search" aria-label="Search Contract Fields" placeholder="Search Contract Fields" value={query} onChange={(event) => setQuery(event.target.value)} />
    <section className="contract-editor-shell">
      {groupedFields.map(({ group, fields: groupFields }, index) => <details key={group} className="contract-field-group" open={index < 3 || Boolean(query)}><summary><span><strong>{group}</strong><small>{groupFields.filter((field) => fields[field]?.trim()).length} of {groupFields.length} complete</small></span><b>{groupFields.filter((field) => required.includes(field) && !fields[field]?.trim()).length || "✓"}</b></summary><div className="contract-field-grid">{groupFields.map((field) => <ContractField key={field} field={field} value={fields[field] || ""} required={required.includes(field)} source={fieldSources[field]} disabled={!isEditable} onChange={(value) => setField(field, value)} />)}</div></details>)}
      {!groupedFields.length ? <div className="contract-empty-fields">{templateFields.length ? "No Fields Match This Search." : "Loading Controlled Contract Fields..."}</div> : null}
    </section>
    </fieldset> : null}

    {studioStep === "review" ? <section className="owner-negotiation-workspace">
      <header><div><h2>Project Owner Review And Revisions</h2></div><i>{workflowStatusLabel}</i></header>
      <div className="owner-negotiation-actions">
        <button className="secondary-action" disabled={saving || !controlledRecord || !["Draft", "Draft Preparation", "Mefford Revision", "GMP Exhibit A Draft"].includes(status)} onClick={() => void workflowAction("submit-internal-review", {}, "Draft Submitted For Internal Review.")}>Submit Internal Review</button>
        {contractType === "Design-Build GMP" && status === "Phase 1 Executed" ? <button className="primary-action" disabled={saving} onClick={() => void workflowAction("open-gmp-exhibit-a", {}, "Phase 1 Was Preserved. GMP Exhibit A Is Open For Preparation.")}>Open GMP Exhibit A</button> : null}
        <button className="secondary-action" disabled={saving || !isCompanyOwner || !["Internal Review", "Mefford Revision"].includes(status)} onClick={() => void workflowAction("approve-owner-review", {}, "Company Owner Approved This Revision For Project Owner Review.")}>Company Owner: Approve For Project Owner Review</button>
        <button className="primary-action" disabled={saving || !["Approved for Owner Review", "Owner Review", "Changes Requested", "Owner Review Complete"].includes(workflowStatus) || !ownerContact.name.trim() || !ownerContact.email.trim()} onClick={() => void workflowAction("issue-owner-invite", { contactName: ownerContact.name, contactEmail: ownerContact.email }, "Secure Project Owner Invite Created.")}>Send Or Resend To Project Owner</button>
        <button className="secondary-action" disabled={saving || !isCompanyOwner || status !== "Owner Review Complete"} onClick={() => void workflowAction("approve-final", {}, "Final Revision Frozen. Project Owner Signature Is Now Available.")}>Company Owner: Approve Final Contract</button>
      </div>
      <div className="owner-invite-form"><label>Contract Signer<input value={ownerContact.name} readOnly /></label><label>Signer Email<input type="email" value={ownerContact.email} readOnly /></label></div>
      {workflow.invite ? <div className="owner-invite-issued"><div><strong>{workflow.invite.deliveryStatus}</strong><span>{workflow.invite.email} · Expires {displayDateTime(workflow.invite.expiresAt)}</span><code>{workflow.invite.link}</code><b>One-time code {workflow.invite.code}</b></div><button onClick={() => void navigator.clipboard.writeText(`${workflow.invite?.link}\nOne-time code: ${workflow.invite?.code}`).then(() => setNotice("Secure Invite Link And Code Copied."))}>Copy Secure Invite</button></div> : null}
      {workflow.changeRequests?.length ? <section className="owner-request-queue"><header><div><h3>Project Owner Change Requests</h3></div><b>{workflow.changeRequests.filter((request) => request.status === "Open").length} OPEN</b></header>{workflow.changeRequests.map((request) => <article key={request.id}><div><strong>{contractFieldLabel(request.clause_key)}</strong><small>{request.request_type} · {request.created_by_name} · {displayDateTime(request.created_at)}</small><p>{request.comment}</p>{request.proposed_text ? <blockquote>{request.proposed_text}</blockquote> : null}{request.mefford_response ? <em>Mefford: {request.mefford_response}</em> : null}</div><i>{request.status}</i>{request.status === "Open" ? <div><textarea rows={3} value={requestResponse[request.id] || ""} onChange={(event) => setRequestResponse((current) => ({ ...current, [request.id]: event.target.value }))} placeholder="Response To The Project Owner" /><span><button disabled={saving || !requestResponse[request.id]?.trim()} onClick={() => void workflowAction("respond-change-request", { changeRequestId: request.id, decision: "Rejected", response: requestResponse[request.id] }, "Change Request Rejected With Permanent Response.")}>Reject</button><button disabled={saving || !requestResponse[request.id]?.trim()} onClick={() => void workflowAction("respond-change-request", { changeRequestId: request.id, decision: "Revised", response: requestResponse[request.id] }, "Mefford Revision Response Recorded.")}>Revise</button><button disabled={saving || !requestResponse[request.id]?.trim()} onClick={() => void workflowAction("respond-change-request", { changeRequestId: request.id, decision: "Accepted", response: requestResponse[request.id] }, "Requested Language Accepted Into A New Mefford Revision.")}>Accept Language</button></span></div> : null}</article>)}</section> : null}
      {workflow.revisions?.length ? <section className="owner-revision-history"><header><div><h3>Revision History</h3></div><select value={revisionCompareId} onChange={(event) => setRevisionCompareId(event.target.value)}><option value="">Select Revision To Compare</option>{workflow.revisions.slice(1).map((revision) => <option key={revision.id} value={revision.id}>R{revision.revision_number} · {revision.phase}</option>)}</select></header>{workflow.revisions.slice(0, 8).map((revision) => <article key={revision.id}><span>R{revision.revision_number}</span><div><strong>{revision.phase}</strong><small>{revision.created_by_name} · {displayDateTime(revision.created_at)}</small><p>{revision.note}</p></div><code>{revision.snapshot_hash.slice(0, 12)}</code></article>)}{revisionCompareId ? <RevisionComparison current={workflow.revisions[0]} prior={workflow.revisions.find((revision) => revision.id === revisionCompareId)} /> : null}</section> : null}
    </section> : null}

    {studioStep === "signatures" ? <fieldset className="project-contract-studio-view">
      <div className="proposal-editor-heading"><h2>Signatures</h2></div>
      <section className="contract-signature-route">
      <header><div><h2>Signature Progress</h2><p>{activeInstrument}</p></div>{controlledRecord ? <button className="secondary-action" onClick={openDocument}>Open Signable Contract</button> : null}</header>
      <ol><li className={controlledRecord ? "complete" : "active"}><span>{controlledRecord ? "✓" : "1"}</span><div><strong>Controlled Draft</strong><small>Project and estimate details fill the draft.</small></div></li><li className={projectOwnerReviewStarted ? "complete" : controlledRecord ? "active" : "locked"}><span>{projectOwnerReviewStarted ? "✓" : "2"}</span><div><strong>Mefford Company Owner Approval</strong></div></li><li className={ownerSignature.signedAt ? "complete" : status === "Ready for Signature" ? "active" : "locked"}><span>{ownerSignature.signedAt ? "✓" : "3"}</span><div><strong>Project Owner Signature</strong><small>{ownerSignature.signedAt ? `${ownerSignature.signerName} · ${displayDateTime(ownerSignature.signedAt)}` : status === "Ready for Signature" ? "Available In The Project Owner Portal" : "Waiting For Final Approval"}</small></div></li><li className={meffordSignature.signedAt ? "complete" : ownerSignature.signedAt && ["Owner Signed", "Partially Signed"].includes(status) ? "active" : "locked"}><span>{meffordSignature.signedAt ? "✓" : "4"}</span><div><strong>Mefford Countersignature</strong><small>{meffordSignature.signedAt ? `${meffordSignature.signerName} · ${displayDateTime(meffordSignature.signedAt)}` : "Available After The Project Owner Signs"}</small></div>{ownerSignature.signedAt && ["Owner Signed", "Partially Signed"].includes(status) && !meffordSignature.signedAt ? <button onClick={() => beginSignature("mefford")}>Countersign</button> : null}</li><li className={isExecuted ? "complete" : "locked"}><span>{isExecuted ? "✓" : "5"}</span><div><strong>Executed Contract</strong><small>{isExecuted ? "Locked And Synchronized" : "Created After Both Signatures"}</small></div></li></ol>
      </section>
    </fieldset> : null}

      </main>

    </div>

    <footer className="proposal-studio-footer project-contract-studio-footer"><div><strong>{workflowStatusLabel}</strong><span>{controlledRecord?.id || "No Controlled Contract Yet"}</span></div><span />{controlledRecord ? <a className="secondary-action" href={`/api/contracts/document?projectId=${encodeURIComponent(project.number)}&recordId=${encodeURIComponent(controlledRecord.id)}&format=docx`} download>Download Editable Word Copy</a> : null}{template.docxPath ? <a className="secondary-action" href={template.docxPath} download>Download Blank Word Master</a> : null}{contractType === "External Contract" && fields.EXTERNAL_CONTRACT_FILE_ID ? <a className="secondary-action" href={`/api/files?id=${encodeURIComponent(fields.EXTERNAL_CONTRACT_FILE_ID)}`} target="_blank" rel="noreferrer">Open Controlling Contract</a> : null}{controlledRecord ? <button className="secondary-action" onClick={openDocument}>{contractType === "External Contract" ? "Preview Control Record" : "Preview Or Print Contract"}</button> : null}<button className="primary-action large" disabled={saving || !isEditable} onClick={() => void save(false)}>{saving ? "Saving…" : !isEditable ? "Released Revision Is Read-Only" : missingRequired.length ? `Save Draft · ${missingRequired.length} Required Open` : "Save Controlled Draft"}</button></footer>

    </section>
    {signingRole ? <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSigningRole(null)}><section className="record-modal wide owner-contract-sign-modal" role="dialog" aria-modal="true" aria-labelledby="contract-sign-title"><div className="modal-heading"><div><h2 id="contract-sign-title">{signingRole === "owner" ? "Project Owner Signature" : "Mefford Countersignature"}</h2><span>{controlledRecord?.id} · {template.id} · {contractWorkflowStatusLabel(controlledRecord?.status || "")}</span></div><button aria-label="Close Signature" onClick={() => setSigningRole(null)}>×</button></div><div className="field-grid"><label className="field-label">Printed Name<input value={signerName} onChange={(event) => setSignerName(event.target.value)} /></label><label className="field-label">Title And Authority<input value={signerTitle} onChange={(event) => setSignerTitle(event.target.value)} /></label><label className="field-label wide">Email<input type="email" value={signerEmail} onChange={(event) => setSignerEmail(event.target.value)} /></label></div><SignaturePad value={signatureImage} onChange={setSignatureImage} label={signingRole === "owner" ? "Draw Project Owner Signature" : "Draw Mefford Signature"} /><label className="award-confirmation"><input type="checkbox" checked={signatureConsent} onChange={(event) => setSignatureConsent(event.target.checked)} /><span><strong>Electronic Signature Consent</strong>I reviewed this exact controlled contract packet{basisAttachments.length ? `, including its ${basisAttachments.length} listed contract-basis PDF${basisAttachments.length === 1 ? "" : "s"},` : ""} and intend this signature to be binding. No later field or attachment changes are authorized by this signature.</span></label><div className="modal-actions"><button className="secondary-action" onClick={() => setSigningRole(null)}>Cancel</button><button className="primary-action large" disabled={saving || !signerName.trim() || !signerTitle.trim() || !signatureImage || !signatureConsent} onClick={() => void submitSignature()}>{saving ? "Recording Signature…" : "Sign Exact Contract Packet"}</button></div></section></div> : null}
  </div>;
}

function RevisionComparison({ current, prior }: { current?: WorkflowRevision; prior?: WorkflowRevision }) {
  if (!current || !prior) return null;
  const currentFields = current.fields || {};
  const priorFields = prior.fields || {};
  const changed = Array.from(new Set([...Object.keys(priorFields), ...Object.keys(currentFields)])).filter((key) => !isOwnerContractBasisField(key) && String(priorFields[key] || "") !== String(currentFields[key] || ""));
  return <div className="owner-revision-compare"><header><strong>R{prior.revision_number} → R{current.revision_number}</strong><span>{changed.length} changed clause{changed.length === 1 ? "" : "s"}</span></header>{changed.length ? changed.slice(0, 30).map((key) => <article key={key}><b>{contractFieldLabel(key)}</b><span><small>R{prior.revision_number}</small>{String(priorFields[key] || "Not included")}</span><span><small>R{current.revision_number}</small>{String(currentFields[key] || "Not included")}</span></article>) : <p>No contract language changed between these snapshots.</p>}</div>;
}

function ContractField({ field, value, required, source, disabled, onChange }: { field: string; value: string; required: boolean; source?: OwnerContractFieldSource; disabled: boolean; onChange: (value: string) => void }) {
  const input = contractFieldInput(field);
  return <label className={`contract-field ${required && !value.trim() ? "required-open" : ""}`}><span><em className="contract-field-label-text">{contractFieldLabel(field)}</em><i className={`contract-field-source ${(source?.kind || "open").toLowerCase()}`}>{source?.label || "Enter Here"}</i>{required ? <b>Required</b> : null}</span>{input === "textarea" ? <textarea rows={3} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} /> : input === "number" && isScalarMoneyContractField(field) ? <CurrencyInput value={value} disabled={disabled} onValueChange={onChange} /> : <input type={input} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />}</label>;
}

function normalizeFields(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, fieldValue]) => [key, String(fieldValue ?? "")])) as Record<string, string>;
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter((field) => /^[A-Z0-9_]+$/.test(field)) : [];
}

function normalizeFieldSources(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string, OwnerContractFieldSource>;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([field, raw]) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const source = raw as Record<string, unknown>;
    const kind = String(source.kind || "") as OwnerContractFieldSource["kind"];
    if (!(["Project", "Estimate", "Proposal", "Standard", "Manual"] as const).includes(kind)) return [];
    return [[field, { kind, label: String(source.label || kind), ...(source.recordId ? { recordId: String(source.recordId) } : {}) }]];
  })) as Record<string, OwnerContractFieldSource>;
}

function resolveManualKeys(value: unknown, storedFields: Record<string, string>, prefill: OwnerContractPrefill) {
  const explicit = normalizeStringArray(value);
  if (Array.isArray(value)) return new Set(explicit);
  return new Set(Object.entries(storedFields).filter(([field, fieldValue]) =>
    fieldValue.trim() && (!prefill.fields[field] || prefill.fields[field] !== fieldValue),
  ).map(([field]) => field));
}

function manualSources(fields: Iterable<string>) {
  return Object.fromEntries(Array.from(fields, (field) => [field, { kind: "Manual" as const, label: "Manual Override" }]));
}

function parseObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function contractWorkflowStatusLabel(value: string) {
  const labels: Record<string, string> = {
    "Approved for Owner Review": "Approved For Project Owner Review",
    "Owner Review": "Project Owner Review",
    "Owner Review Complete": "Project Owner Review Complete",
    "Owner Signed": "Project Owner Signed",
  };
  return labels[value] || value;
}

function displayDateTime(value: unknown) {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? "Signed" : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }).format(date);
}
