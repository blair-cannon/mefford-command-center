"use client";

import {
  OWNER_CONTRACT_PRIMARY_PARTY_FIELDS,
  OWNER_CONTRACT_ROUTING_OVERRIDE_FIELDS,
  contractFieldInput,
  contractFieldLabel,
} from "../lib/owner-contracts";
import type { OwnerContractFieldSource } from "../lib/owner-contract-prefill";

const primarySourceFallback: Record<string, string> = {
  OWNER_PRIMARY_CONTACT_NAME: "OWNER_SIGNATORY",
  OWNER_PRIMARY_CONTACT_TITLE: "OWNER_SIGNATORY_TITLE",
  OWNER_PRIMARY_CONTACT_EMAIL: "OWNER_NOTICE_EMAIL",
  OWNER_PRIMARY_CONTACT_PHONE: "OWNER_NOTICE_PHONE",
  OWNER_PRIMARY_MAILING_ADDRESS_LINE_1: "OWNER_NOTICE_ADDRESS_LINE_1",
  OWNER_PRIMARY_MAILING_ADDRESS_LINE_2: "OWNER_NOTICE_ADDRESS_LINE_2",
};

const exceptionGroups = [
  {
    title: "Different Contract Signer",
    detail: "Only complete this when someone other than the primary contact will sign.",
    fields: ["OWNER_SIGNER_NAME_OVERRIDE", "OWNER_SIGNER_TITLE_OVERRIDE", "OWNER_SIGNER_EMAIL_OVERRIDE", "OWNER_SIGNER_PHONE_OVERRIDE"],
  },
  {
    title: "Different Contract Notice Contact",
    detail: "Only complete this when formal notices must go somewhere else.",
    fields: ["OWNER_NOTICE_CONTACT_OVERRIDE", "OWNER_NOTICE_EMAIL_OVERRIDE", "OWNER_NOTICE_PHONE_OVERRIDE", "OWNER_NOTICE_ADDRESS_LINE_1_OVERRIDE", "OWNER_NOTICE_ADDRESS_LINE_2_OVERRIDE"],
  },
  {
    title: "Different Invoice Recipient",
    detail: "Enter an accounts-payable route only when it differs from the primary contact.",
    fields: ["OWNER_INVOICE_RECIPIENT_OVERRIDE"],
  },
  {
    title: "Different Jobsite Contact",
    detail: "Enter a field contact only when it differs from the primary contact.",
    fields: ["OWNER_SITE_CONTACT_OVERRIDE"],
  },
] as const;

export function OwnerContactRoutingPanel({
  fields,
  required,
  sources,
  disabled = false,
  onChange,
}: {
  fields: Record<string, string>;
  required: string[];
  sources: Record<string, OwnerContractFieldSource>;
  disabled?: boolean;
  onChange: (field: string, value: string) => void;
}) {
  const exceptionCount = OWNER_CONTRACT_ROUTING_OVERRIDE_FIELDS.filter((field) => String(fields[field] || "").trim()).length;
  return <section className="contract-contact-routing owner-contact-routing-panel">
    <header>
      <div><h3>Project Owner And Primary Contact</h3></div>
      <ul aria-label="Primary contact routing"><li>Authorized Contact</li><li>Signer</li><li>Notices</li><li>Invoices</li><li>Jobsite</li></ul>
    </header>

    <div className="owner-contact-subsection">
      <div><h4>Project Owner</h4><p>Use the legal company name once. Add the entity type and state when the contract requires it.</p></div>
      <div className="contract-field-grid owner-company-fields">
        {["OWNER_LEGAL_NAME", "OWNER_ENTITY_AND_STATE"].map((field) => <OwnerRoutingField key={field} field={field} value={fields[field] || ""} required={primaryFieldRequired(field, required)} source={sourceFor(field, sources)} disabled={disabled} onChange={(value) => onChange(field, value)} />)}
      </div>
    </div>

    <div className="owner-contact-subsection">
      <div><h4>Primary Contact</h4><p>The linked CRM contact fills these fields. Any edit here flows to every matching contract section.</p></div>
      <div className="contract-field-grid owner-primary-contact-fields">
        {OWNER_CONTRACT_PRIMARY_PARTY_FIELDS.filter((field) => !["OWNER_LEGAL_NAME", "OWNER_ENTITY_AND_STATE"].includes(field)).map((field) => <OwnerRoutingField key={field} field={field} value={fields[field] || ""} required={primaryFieldRequired(field, required)} source={sourceFor(field, sources)} disabled={disabled} onChange={(value) => onChange(field, value)} />)}
      </div>
    </div>

    <details className="owner-routing-exceptions">
      <summary><span><strong>Use Different People Or Delivery Details</strong><small>Optional exceptions only. Leave a field blank and it follows the primary contact.</small></span><b>{exceptionCount ? `${exceptionCount} Set` : "Optional"}</b></summary>
      <div className="owner-routing-exception-grid">
        {exceptionGroups.map((group) => <section key={group.title}><header><h4>{group.title}</h4><p>{group.detail}</p></header><div className="contract-field-grid">{group.fields.map((field) => <OwnerRoutingField key={field} field={field} value={fields[field] || ""} required={false} source={String(fields[field] || "").trim() ? sources[field] : { kind: "Standard", label: "Uses Primary Contact" }} disabled={disabled} override onChange={(value) => onChange(field, value)} />)}</div></section>)}
      </div>
    </details>
  </section>;
}

function OwnerRoutingField({
  field,
  value,
  required,
  source,
  disabled,
  override = false,
  onChange,
}: {
  field: string;
  value: string;
  required: boolean;
  source?: OwnerContractFieldSource;
  disabled: boolean;
  override?: boolean;
  onChange: (value: string) => void;
}) {
  const input = contractFieldInput(field);
  const placeholder = override ? "Leave blank to use the primary contact" : undefined;
  return <label className={`contract-field ${input === "textarea" ? "wide" : ""} ${required && !value.trim() ? "required-open" : ""}`} data-field={field}>
    <span><em className="contract-field-label-text">{contractFieldLabel(field)}</em><i className={`contract-field-source ${(source?.kind || "open").toLowerCase()}`}>{source?.label || "Enter Here"}</i>{required ? <b>Required</b> : null}</span>
    {input === "textarea" ? <textarea rows={3} value={value} placeholder={placeholder} disabled={disabled} onChange={(event) => onChange(event.target.value)} /> : <input type={input} value={value} placeholder={placeholder} disabled={disabled} onChange={(event) => onChange(event.target.value)} />}
  </label>;
}

function sourceFor(field: string, sources: Record<string, OwnerContractFieldSource>) {
  return sources[field] || sources[primarySourceFallback[field]];
}

function primaryFieldRequired(field: string, required: string[]) {
  if (field === "OWNER_LEGAL_NAME") return required.some((item) => ["OWNER_LEGAL_NAME", "OWNER_LEGAL_NAME_AND_STATUS", "OWNER_ADDRESS_REPRESENTATIVE_CONTACT"].includes(item));
  if (field === "OWNER_ENTITY_AND_STATE") return required.includes("OWNER_ENTITY_AND_STATE");
  if (field === "OWNER_PRIMARY_CONTACT_NAME") return required.some((item) => ["OWNER_AUTHORIZED_REPRESENTATIVE", "OWNER_ADDRESS_REPRESENTATIVE_CONTACT", "INVOICE_DELIVERY_METHOD_RECIPIENT", "NOTICE_REQUIREMENTS_AND_ADDRESSES"].includes(item));
  if (field === "OWNER_PRIMARY_CONTACT_EMAIL") return required.includes("INVOICE_DELIVERY_METHOD_RECIPIENT");
  if (field === "OWNER_PRIMARY_MAILING_ADDRESS_LINE_1") return required.some((item) => ["OWNER_NOTICE_ADDRESS_LINE_1", "OWNER_ADDRESS_REPRESENTATIVE_CONTACT", "NOTICE_REQUIREMENTS_AND_ADDRESSES"].includes(item));
  return false;
}
