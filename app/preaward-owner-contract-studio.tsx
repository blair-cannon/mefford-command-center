"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import {
  OWNER_CONTRACT_CONTACT_ROUTING_FIELDS,
  OWNER_CONTRACT_ROUTING_OVERRIDE_FIELDS,
  OWNER_CONTRACT_TYPES,
  contractAmountField,
  contractFieldGroup,
  contractFieldInput,
  contractFieldLabel,
  contractTemplate,
  defaultContractFields,
  defaultContractInstrument,
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
import { calculateEstimateSummary } from "./estimate-template";
import { OwnerContactRoutingPanel } from "./owner-contact-routing-panel";
import { SmallProjectPricingPanel } from "./small-project-pricing-panel";
import {
  mergeOwnerContractPrefill,
  type OwnerContractFieldSource,
  type OwnerContractPrefill,
} from "../lib/owner-contract-prefill";
import { isOwnerContractBasisField } from "../lib/owner-contract-basis";

type EstimateRecord = {
  id: string;
  title: string;
  owner: string;
  due: string;
  status: string;
  meta: string;
  recordDate?: string;
  data?: Record<string, unknown>;
};

type EstimateActor = {
  name: string;
  email: string;
  accessLevel: "Company Owner" | "Administrator" | "Employee";
  designations: string[];
};

type DraftRecord = EstimateRecord & { dateLocked?: boolean };
type DraftView = "setup" | "required" | "additional";

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

const commercialFieldKeys = new Set([
  "PAYMENT_TERMS",
  "RETAINAGE_TERMS",
  "RETAINAGE_TERMS_AND_RELEASE",
  "CONSTRUCTION_RETAINAGE",
  "RETAINAGE_PERCENTAGE",
]);

export function PreAwardOwnerContractStudio({
  opportunity,
  actor,
  onClose,
  onOpportunitySaved,
}: {
  opportunity: EstimateRecord;
  actor: EstimateActor;
  onClose: () => void;
  onOpportunitySaved: (record: EstimateRecord) => void;
}) {
  const initialType = inferContractType(opportunity);
  const initialRouting = synchronizeOwnerContractContactFields(draftDefaults(opportunity, actor, initialType));
  const [contractType, setContractType] = useState<OwnerContractType>(initialType);
  const [activeInstrument, setActiveInstrument] = useState<OwnerContractInstrument>(defaultContractInstrument(initialType));
  const [fields, setFields] = useState<Record<string, string>>(() => initialRouting.fields);
  const [templateFields, setTemplateFields] = useState<string[]>([]);
  const [paymentTerms, setPaymentTerms] = useState(fields.PAYMENT_TERMS || "");
  const [retainageInitialPercent, setRetainageInitialPercent] = useState("10");
  const [retainageAfterHalfPercent, setRetainageAfterHalfPercent] = useState("5");
  const [savedRecord, setSavedRecord] = useState<DraftRecord | null>(null);

  const [fieldSources, setFieldSources] = useState<Record<string, OwnerContractFieldSource>>({});
  const [manualFieldKeys, setManualFieldKeys] = useState<Set<string>>(() => new Set(initialRouting.manualFieldKeys));
  const [query, setQuery] = useState("");
  const [view, setView] = useState<DraftView>("setup");
  const [selectedGroup, setSelectedGroup] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/preaward-contracts?opportunityId=${encodeURIComponent(opportunity.id)}&contractType=${encodeURIComponent(initialType)}&activeInstrument=${encodeURIComponent(defaultContractInstrument(initialType))}`)
      .then(async (response) => ({ response, result: await response.json() as { record?: DraftRecord | null; prefill?: OwnerContractPrefill; error?: string } }))
      .then(({ response, result }) => {
        if (cancelled) return;
        if (!response.ok) throw new Error(result.error || "The Pre-Award Project Owner Contract Could Not Be Loaded.");
        const sourcePrefill = result.prefill || null;

        if (result.record) {
          const data = result.record.data || {};
          const storedType = normalizeOwnerContractType(data.contractType);
          if (storedType) {
            const instrument = String(data.activeInstrument || defaultContractInstrument(storedType)) as OwnerContractInstrument;
            setContractType(storedType);
            setActiveInstrument(instrument);
            const storedFields = normalizeFields(data.fields);
            const manual = resolveManualKeys(data.manualFieldKeys, storedFields, sourcePrefill);
            const current = { ...draftDefaults(opportunity, actor, storedType, instrument), ...storedFields };
            const merged = sourcePrefill ? mergeOwnerContractPrefill(current, sourcePrefill, manual, true) : { fields: current, sources: {} };
            const routing = synchronizeOwnerContractContactFields(merged.fields, manual);
            const routedManual = new Set(routing.manualFieldKeys);
            setManualFieldKeys(routedManual);
            setFields(routing.fields);
            setFieldSources({ ...normalizeFieldSources(data.fieldSources), ...merged.sources, ...manualSources(routedManual) });
            setPaymentTerms(String(data.paymentTerms || routing.fields.PAYMENT_TERMS || ""));
          }
          setRetainageInitialPercent(String(data.retainageInitialPercent || "10"));
          setRetainageAfterHalfPercent(String(data.retainageAfterHalfPercent || "5"));
          setSavedRecord(result.record);
        } else if (sourcePrefill) {
          const current = draftDefaults(opportunity, actor, initialType);
          const merged = mergeOwnerContractPrefill(current, sourcePrefill, [], true);
          const routing = synchronizeOwnerContractContactFields(merged.fields, []);
          setFields(routing.fields);
          setFieldSources(merged.sources);
          setPaymentTerms(routing.fields.PAYMENT_TERMS || "");
        }
      })
      .catch((error) => !cancelled && setNotice(error instanceof Error ? error.message : "The Pre-Award Project Owner Contract Could Not Be Loaded."))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [actor, initialType, opportunity]);

  useEffect(() => {
    let cancelled = false;
    fetch(contractTemplate(contractType, activeInstrument).htmlPath)
      .then((response) => response.text())
      .then((html) => {
        if (cancelled) return;
        const tags = Array.from(html.matchAll(/\{\{([A-Z0-9_]+)\}\}/g), (match) => match[1]);
        setTemplateFields(Array.from(new Set(tags)).sort());
      })
      .catch(() => !cancelled && setNotice("The Controlled Contract Field Index Could Not Be Loaded."));
    return () => { cancelled = true; };
  }, [contractType, activeInstrument]);

  const required = requiredContractFields(contractType, activeInstrument, fields);
  const editableFields = useMemo(() => {
    const source = templateFields.length ? templateFields : Array.from(new Set([...Object.keys(fields), ...required]));
    return source.filter((field) =>
      !isSignatureContractField(field)
      && !isExecutionControlField(field)
      && !isSystemManagedContractField(field)
      && !isSmallProjectPricingField(field)
      && !isOwnerContractBasisField(field)
    );
  }, [fields, required, templateFields]);
  const setupFields = useMemo(
    () => preAwardSetupFields(contractType, activeInstrument, editableFields, required),
    [activeInstrument, contractType, editableFields, required],
  );
  const setupFieldSet = useMemo(() => new Set<string>([...setupFields, ...OWNER_CONTRACT_CONTACT_ROUTING_FIELDS]), [setupFields]);
  const requiredDetailFields = useMemo(
    () => editableFields.filter((field) => required.includes(field) && !setupFieldSet.has(field) && !commercialFieldKeys.has(field)),
    [editableFields, required, setupFieldSet],
  );
  const additionalFields = useMemo(
    () => editableFields.filter((field) => !required.includes(field) && !setupFieldSet.has(field) && !commercialFieldKeys.has(field)),
    [editableFields, required, setupFieldSet],
  );
  const visibleGroups = useMemo(() => {
    const source = view === "required" ? requiredDetailFields : additionalFields;
    const visible = source.filter((field) => !query.trim() || `${field} ${contractFieldLabel(field)} ${contractFieldGroup(field)}`.toLowerCase().includes(query.toLowerCase()));
    return groupOrder
      .map((group) => ({ group, fields: visible.filter((field) => contractFieldGroup(field) === group) }))
      .filter((entry) => entry.fields.length);
  }, [additionalFields, query, requiredDetailFields, view]);
  const activeGroup = visibleGroups.some((entry) => entry.group === selectedGroup)
    ? selectedGroup
    : visibleGroups[0]?.group || "";
  const activeGroupFields = visibleGroups.find((entry) => entry.group === activeGroup)?.fields || [];
  const missingRequired = required.filter((field) => !String(fields[field] || "").trim());
  const missingRequiredDetails = requiredDetailFields.filter((field) => !String(fields[field] || "").trim());
  const revisionNumber = Number(savedRecord?.data?.revisionNumber || 0);

  function chooseType(nextType: OwnerContractType) {
    const nextInstrument = defaultContractInstrument(nextType);
    setContractType(nextType);
    setActiveInstrument(nextInstrument);
    setFields((current) => synchronizeOwnerContractContactFields({
      ...draftDefaults(opportunity, actor, nextType, nextInstrument),
      ...current,
      DESIGN_SERVICES_INCLUDED_OR_EXCLUDED: nextType.startsWith("Design-Build") ? "INCLUDED" : "EXCLUDED",
    }, manualFieldKeys).fields);
    setView("setup");
    setSelectedGroup("");
    setNotice(`${nextType} Selected. Refreshing Project, Contact, Estimate, And Proposal Information.`);
    void refreshSourcePrefill(nextType, nextInstrument);
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
    setFieldSources((current) => ({ ...current, ...manualSources(new Set(keys)) }));
  }

  async function refreshSourcePrefill(nextType = contractType, nextInstrument = activeInstrument) {
    try {
      const response = await fetch(`/api/preaward-contracts?opportunityId=${encodeURIComponent(opportunity.id)}&contractType=${encodeURIComponent(nextType)}&activeInstrument=${encodeURIComponent(nextInstrument)}`);
      const result = await response.json() as { prefill?: OwnerContractPrefill; error?: string };
      if (!response.ok || !result.prefill) throw new Error(result.error || "Project And Estimate Information Could Not Be Refreshed.");

      const merged = mergeOwnerContractPrefill(fields, result.prefill, manualFieldKeys, true);
      const routing = synchronizeOwnerContractContactFields(merged.fields, manualFieldKeys);
      const routedManual = new Set(routing.manualFieldKeys);
      setFields(routing.fields);
      setManualFieldKeys(routedManual);
      setFieldSources({ ...result.prefill.sources, ...manualSources(routedManual) });
      if (!routedManual.has("PAYMENT_TERMS")) setPaymentTerms(routing.fields.PAYMENT_TERMS || paymentTerms);
      setNotice("Project data refreshed.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Project And Estimate Information Could Not Be Refreshed.");
    }
  }

  async function saveDraft() {
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/preaward-contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opportunityId: opportunity.id,
          contractType,
          activeInstrument,
          fields: { ...fields, PAYMENT_TERMS: paymentTerms },
          paymentTerms,
          retainageInitialPercent,
          retainageAfterHalfPercent,
          manualFieldKeys: [...manualFieldKeys],
        }),
      });
      const result = await response.json() as { record?: DraftRecord; opportunity?: EstimateRecord; error?: string };
      if (!response.ok || !result.record || !result.opportunity) throw new Error(result.error || "The Pre-Award Project Owner Contract Could Not Be Saved.");
      setSavedRecord(result.record);
      setFieldSources(normalizeFieldSources(result.record.data?.fieldSources));
      onOpportunitySaved(result.opportunity);
      setNotice(`Pre-Award Draft R${String(result.record.data?.revisionNumber || "")} Saved Internally. It Has Not Awarded Or Committed The Project.`);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Pre-Award Project Owner Contract Could Not Be Saved.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveAndPreview() {
    const preview = window.open("about:blank", "_blank");
    if (preview) preview.opener = null;
    const saved = await saveDraft();
    if (!saved) {
      preview?.close();
      return;
    }
    const url = `/api/preaward-contracts/document?opportunityId=${encodeURIComponent(opportunity.id)}`;
    if (preview) preview.location.href = url;
    else window.open(url, "_blank", "noopener,noreferrer");
  }

  async function uploadExternalContract(file: File) {
    setUploading(true);
    setNotice("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("projectId", `ESTIMATE-${opportunity.id}`);
      form.set("category", "07-Contract");
      form.set("revision", "Pre-Award External Contract Source");
      form.set("access", "Internal Estimating And Contract Team");
      const response = await fetch("/api/files", { method: "POST", body: form });
      const result = await response.json() as { file?: { id: number; name: string; revision: string }; error?: string };
      if (!response.ok || !result.file) throw new Error(result.error || "The External Contract Could Not Be Uploaded.");
      setFields((current) => ({
        ...current,
        EXTERNAL_CONTRACT_FILE_ID: String(result.file?.id || ""),
        EXTERNAL_CONTRACT_FILE_NAME: result.file?.name || "",
        EXTERNAL_CONTRACT_FILE_REVISION: result.file?.revision || current.EXTERNAL_CONTRACT_FILE_REVISION || "",
      }));
      setNotice(`${result.file.name} Was Stored In The Estimate Contract Folder As An Internal Pre-Award Source.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The External Contract Could Not Be Uploaded.");
    } finally {
      setUploading(false);
    }
  }

  const template = contractTemplate(contractType, activeInstrument);
  return (
    <div className="proposal-studio-layer contract-writing-studio-layer" role="dialog" aria-modal="true" aria-labelledby="preaward-contract-title">
      <section className="proposal-studio-shell contract-writing-studio-shell">
        <header className="proposal-studio-header contract-writing-studio-header">
          <div className="proposal-studio-brand"><Image src="/mefford-logo.png" unoptimized alt="Mefford Contracting" width={711} height={738} priority /><span><b>PROJECT OWNER CONTRACTS</b><strong id="preaward-contract-title">{opportunity.title}</strong><small>{revisionNumber ? `Internal Draft · Revision ${revisionNumber}` : "Internal Draft · Not Saved"}</small></span></div>
          <label className="contract-studio-type-header"><span>Project Owner Contract Type</span><select value={contractType} onChange={(event) => chooseType(event.target.value as OwnerContractType)}>{OWNER_CONTRACT_TYPES.map((type) => <option key={type} value={type}>{contractTemplate(type).label}</option>)}</select><small>{template.description}</small></label>
          <div className="proposal-header-actions"><span className="proposal-status">Pre-Award Draft</span><button aria-label="Close Pre-Award Project Owner Contract" onClick={onClose}>×</button></div>
        </header>

        {notice ? <button className="proposal-notice" onClick={() => setNotice("")}>{notice}<span>×</span></button> : null}

        <section className="proposal-source-strip contract-studio-source-strip">
          <button className="secondary-action" type="button" onClick={() => void refreshSourcePrefill()} disabled={saving}>Pull Latest Project Data</button>
          {missingRequired.length ? <span className="studio-open-items">{missingRequired.length} Required Terms Open</span> : null}
        </section>

        <div className="proposal-studio-body contract-writing-studio-body">
          <nav className="proposal-step-rail" aria-label="Pre-Award Contract Drafting Sections">
            <button type="button" className={view === "setup" ? "active" : ""} onClick={() => setView("setup")}><span>01</span><strong>Contract Setup</strong><i>{setupFields.every((field) => String(fields[field] || "").trim()) ? "✓" : ""}</i></button>
            <button type="button" className={view === "required" ? "active" : ""} onClick={() => { setView("required"); setQuery(""); setSelectedGroup(""); }}><span>02</span><strong>Required Terms</strong><i>{missingRequiredDetails.length || "✓"}</i></button>
            <button type="button" className={view === "additional" ? "active" : ""} onClick={() => { setView("additional"); setQuery(""); setSelectedGroup(""); }}><span>03</span><strong>Additional Clauses</strong><i /></button>
          </nav>

          <main className="proposal-editor-panel contract-writing-editor-panel">
            {loading ? <div className="contract-empty-fields">Loading Existing Draft…</div> : <>
              {view === "setup" ? <fieldset className="contract-studio-view">
                <div className="proposal-editor-heading"><h2>Contract Setup</h2></div>

                {contractType === "Time & Materials" ? <SmallProjectPricingPanel fields={fields} onChange={setField} /> : null}
                <div className="preaward-setup-grid">{setupFields.map((field) => <ContractField key={field} field={field} value={fields[field] || ""} required={required.includes(field)} source={fieldSources[field]} onChange={(value) => setField(field, value)} />)}</div>
                <OwnerContactRoutingPanel fields={fields} required={required} sources={fieldSources} onChange={setField} />
                <section className="preaward-commercial-terms"><label><span>Payment Terms</span><textarea rows={2} value={paymentTerms} onChange={(event) => { setPaymentTerms(event.target.value); setField("PAYMENT_TERMS", event.target.value); }} /></label><label><span>Retainage Before 50%</span><div><input type="number" min="0" max="100" value={retainageInitialPercent} onChange={(event) => { setRetainageInitialPercent(event.target.value); markRetainageManual(); }} /><b>%</b></div></label><label><span>Retainage After 50%</span><div><input type="number" min="0" max="100" value={retainageAfterHalfPercent} onChange={(event) => { setRetainageAfterHalfPercent(event.target.value); markRetainageManual(); }} /><b>%</b></div></label></section>
                {contractType === "External Contract" ? <section className="preaward-external-source"><div><strong>Other Party’s Contract Draft</strong><span>{fields.EXTERNAL_CONTRACT_FILE_NAME || "No Source File Stored"}</span></div><label><input type="file" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadExternalContract(file); event.currentTarget.value = ""; }} />{uploading ? "Uploading…" : fields.EXTERNAL_CONTRACT_FILE_ID ? "Replace Source Draft" : "Choose Any File Type"}</label>{fields.EXTERNAL_CONTRACT_FILE_ID ? <a href={`/api/files?id=${encodeURIComponent(fields.EXTERNAL_CONTRACT_FILE_ID)}`} target="_blank" rel="noreferrer">Open Source ↗</a> : null}</section> : null}
                <ContractBasisAttachments projectId={`ESTIMATE-${opportunity.id}`} fields={fields} disabled={loading || saving} preAward onChange={setFields} onNotice={setNotice} />
              </fieldset> : null}

              {view !== "setup" ? <fieldset className="contract-studio-view">
                <div className="proposal-editor-heading"><h2>{view === "required" ? "Required Terms" : "Additional Clauses"}</h2></div>
                {view === "additional" ? <input className="contract-studio-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Additional Clauses" aria-label="Search Additional Contract Clauses" /> : null}
                {visibleGroups.length ? <div className="preaward-language-layout"><nav aria-label="Contract Field Groups">{visibleGroups.map((entry) => <button type="button" key={entry.group} className={activeGroup === entry.group ? "active" : ""} onClick={() => setSelectedGroup(entry.group)}><span>{entry.group}</span>{view === "required" ? <b>{entry.fields.filter((field) => !fields[field]?.trim()).length} Open</b> : <b>{entry.fields.length}</b>}</button>)}</nav><div className="preaward-language-fields"><header><strong>{activeGroup}</strong><span>{activeGroupFields.length} Field{activeGroupFields.length === 1 ? "" : "s"}</span></header><div className="contract-field-grid">{activeGroupFields.map((field) => <ContractField key={field} field={field} value={fields[field] || ""} required={required.includes(field)} source={fieldSources[field]} onChange={(value) => setField(field, value)} />)}</div></div></div> : <div className="contract-empty-fields">{view === "required" ? "All Required Terms Are In Contract Setup." : query ? "No Additional Clauses Match This Search." : "No Additional Clauses For This Contract Type."}</div>}
              </fieldset> : null}
            </>}
          </main>

        </div>

        <footer className="proposal-studio-footer contract-studio-footer"><div><strong>Internal Draft {revisionNumber ? `· Revision ${revisionNumber}` : ""}</strong><span>{missingRequired.length ? `${missingRequired.length} Required Terms Open` : "Required Terms Complete"}</span></div><span />{revisionNumber ? <a className="secondary-action" href={`/api/preaward-contracts/document?opportunityId=${encodeURIComponent(opportunity.id)}&format=docx`} download>Download Editable Word Copy</a> : null}<button className="secondary-action" type="button" onClick={onClose}>Close</button><button className="secondary-action" type="button" disabled={loading || saving} onClick={() => void saveAndPreview()}>{saving ? "Saving…" : "Save And Preview"}</button><button className="primary-action large" type="button" disabled={loading || saving} onClick={() => void saveDraft()}>{saving ? "Saving…" : "Save Draft"}</button></footer>
      </section>
    </div>
  );
}

function ContractField({ field, value, required, source, onChange }: { field: string; value: string; required: boolean; source?: OwnerContractFieldSource; onChange: (value: string) => void }) {
  const input = contractFieldInput(field);
  return <label className={`contract-field ${input === "textarea" ? "wide" : ""} ${required && !value.trim() ? "required-open" : ""}`} data-field={field}><span><em className="contract-field-label-text">{contractFieldLabel(field)}</em><i className={`contract-field-source ${(source?.kind || "open").toLowerCase()}`}>{source?.label || "Enter Here"}</i>{required ? <b>Required</b> : null}</span>{input === "textarea" ? <textarea rows={3} value={value} onChange={(event) => onChange(event.target.value)} /> : input === "number" && isScalarMoneyContractField(field) ? <CurrencyInput value={value} onValueChange={onChange} /> : <input type={input} value={value} onChange={(event) => onChange(event.target.value)} />}</label>;
}

function preAwardSetupFields(
  type: OwnerContractType,
  instrument: OwnerContractInstrument,
  editable: string[],
  required: string[],
) {
  const firstAvailable = (...candidates: string[]) => candidates.find((field) => editable.includes(field) || required.includes(field));
  const candidates = [
    firstAvailable("PROJECT_NAME_AND_ADDRESS", "PROJECT_NAME"),
    firstAvailable("PROJECT_SITE_ADDRESS"),
    contractAmountField(type, instrument),
    firstAvailable("EFFECTIVE_DATE", "AGREEMENT_EFFECTIVE_DATE", "DOCUMENT_EFFECTIVE_DATE", "ORIGINAL_AGREEMENT_DATE"),
    firstAvailable("CONSTRUCTION_COMMENCEMENT_DATE", "NOTICE_TO_PROCEED_DATE"),
    firstAvailable("SUBSTANTIAL_COMPLETION_DATE", "SUBSTANTIAL_COMPLETION_DATE_OR_TBD"),
    firstAvailable("FINAL_COMPLETION_DATE", "FINAL_COMPLETION_DATE_OR_TBD"),
  ].filter((field): field is string => Boolean(field));
  return Array.from(new Set(candidates)).filter((field) => editable.includes(field) || required.includes(field));
}

function inferContractType(opportunity: EstimateRecord): OwnerContractType {
  const direct = normalizeOwnerContractType(opportunity.data?.ownerContractType);
  if (direct) return direct;
  const handoff = opportunity.data?.proposalHandoff;
  if (handoff && typeof handoff === "object" && !Array.isArray(handoff)) {
    const fromHandoff = normalizeOwnerContractType((handoff as Record<string, unknown>).ownerContractType);
    if (fromHandoff) return fromHandoff;
  }
  return String(opportunity.data?.deliveryMethod || "").includes("Design-Build") ? "Design-Build Lump Sum" : "Plan & Spec Lump Sum";
}

function draftDefaults(opportunity: EstimateRecord, actor: EstimateActor, type: OwnerContractType, instrument = defaultContractInstrument(type)) {
  const handoff = opportunity.data?.proposalHandoff && typeof opportunity.data.proposalHandoff === "object" && !Array.isArray(opportunity.data.proposalHandoff)
    ? opportunity.data.proposalHandoff as Record<string, unknown>
    : {};
  return defaultContractFields(type, {
    number: "Pending Award",
    name: String(opportunity.data?.projectName || opportunity.title),
    site: String(opportunity.data?.projectLocation || ""),
    ownerName: String(handoff.ownerName || opportunity.data?.company || ""),
    ownerContractDate: String(handoff.ownerContractDate || ""),
    architect: String(opportunity.data?.architect || ""),
    contractAmount: estimateAmount(opportunity),
    startDate: String(handoff.targetStartDate || ""),
    substantialDate: String(handoff.substantialDate || ""),
    finalDate: String(handoff.finalDate || ""),
    projectManager: String(opportunity.data?.assignedProjectManager || opportunity.data?.assignedEstimator || actor.name),
  }, actor, instrument);
}

function estimateAmount(opportunity: EstimateRecord) {
  const amount = opportunity.data?.estimate
    ? calculateEstimateSummary(opportunity.data.estimate).contractValue
    : Number(opportunity.data?.estimatedValue || 0);
  return Number.isFinite(amount) && amount > 0 ? amount.toFixed(2) : "";
}

function normalizeFields(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string, string>;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, fieldValue]) => [key, String(fieldValue ?? "")])) as Record<string, string>;
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

function resolveManualKeys(value: unknown, storedFields: Record<string, string>, prefill: OwnerContractPrefill | null) {
  if (Array.isArray(value)) return new Set(value.map(String).filter((field) => /^[A-Z0-9_]+$/.test(field)));
  if (!prefill) return new Set(Object.keys(storedFields).filter((field) => storedFields[field]?.trim()));
  return new Set(Object.entries(storedFields).filter(([field, fieldValue]) =>
    fieldValue.trim() && (!prefill.fields[field] || prefill.fields[field] !== fieldValue),
  ).map(([field]) => field));
}

function manualSources(fields: Iterable<string>) {
  return Object.fromEntries(Array.from(fields, (field) => [field, { kind: "Manual" as const, label: "Manual Override" }]));
}
