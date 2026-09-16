import { formatMoney, moneyDecimal } from "./money";

export const OWNER_CONTRACT_TYPES = [
  "Design-Build GMP",
  "Design-Build Lump Sum",
  "Plan & Spec Lump Sum",
  "Time & Materials",
  "External Contract",
] as const;

export type OwnerContractType = (typeof OWNER_CONTRACT_TYPES)[number];
export type OwnerContractInstrument = "Phase 1 Agreement" | "GMP Exhibit A" | "Primary Agreement" | "External Agreement Mapping";

export const SMALL_PROJECT_PRICING_METHODS = [
  {
    value: "Lump Sum",
    code: "LUMP_SUM",
    description: "One fixed price, adjusted only by allowance reconciliation and signed Change Orders.",
  },
  {
    value: "Time & Materials",
    code: "TIME_AND_MATERIALS",
    description: "Actual documented cost plus the agreed fee, with no maximum contract price.",
  },
  {
    value: "Time & Materials Not to Exceed",
    code: "TIME_AND_MATERIALS_NTE",
    description: "Actual documented cost plus the agreed fee, capped unless changed in writing.",
  },
] as const;

export type SmallProjectPricingMethod = (typeof SMALL_PROJECT_PRICING_METHODS)[number]["value"];

export const OWNER_CONTRACT_PRIMARY_PARTY_FIELDS = [
  "OWNER_LEGAL_NAME",
  "OWNER_ENTITY_AND_STATE",
  "OWNER_PRIMARY_CONTACT_NAME",
  "OWNER_PRIMARY_CONTACT_TITLE",
  "OWNER_PRIMARY_CONTACT_EMAIL",
  "OWNER_PRIMARY_CONTACT_PHONE",
  "OWNER_PRIMARY_MAILING_ADDRESS_LINE_1",
  "OWNER_PRIMARY_MAILING_ADDRESS_LINE_2",
] as const;

export const OWNER_CONTRACT_ROUTING_OVERRIDE_FIELDS = [
  "OWNER_SIGNER_NAME_OVERRIDE",
  "OWNER_SIGNER_TITLE_OVERRIDE",
  "OWNER_SIGNER_EMAIL_OVERRIDE",
  "OWNER_SIGNER_PHONE_OVERRIDE",
  "OWNER_NOTICE_CONTACT_OVERRIDE",
  "OWNER_NOTICE_EMAIL_OVERRIDE",
  "OWNER_NOTICE_PHONE_OVERRIDE",
  "OWNER_NOTICE_ADDRESS_LINE_1_OVERRIDE",
  "OWNER_NOTICE_ADDRESS_LINE_2_OVERRIDE",
  "OWNER_INVOICE_RECIPIENT_OVERRIDE",
  "OWNER_SITE_CONTACT_OVERRIDE",
] as const;

export const OWNER_CONTRACT_DERIVED_CONTACT_FIELDS = [
  "OWNER_LEGAL_NAME_AND_STATUS",
  "OWNER_ADDRESS_REPRESENTATIVE_CONTACT",
  "OWNER_AUTHORIZED_REPRESENTATIVE",
  "OWNER_RECIPIENT",
  "OWNER_NOTICE_CONTACT",
  "OWNER_SIGNATORY",
  "OWNER_SIGNATORY_TITLE",
  "OWNER_SIGNATORY_EMAIL",
  "OWNER_SIGNATORY_PHONE",
  "OWNER_NOTICE_EMAIL",
  "OWNER_NOTICE_PHONE",
  "OWNER_NOTICE_ADDRESS_LINE_1",
  "OWNER_NOTICE_ADDRESS_LINE_2",
  "OWNER_EMAIL",
  "OWNER_PHONE",
  "OWNER_DELIVERY_ADDRESS",
  "OWNER_MAILING_ADDRESS",
  "OWNER_REPRESENTATIVE_AUTHORIZED_TO_ACKNOWLEDGE_TICKETS",
  "INVOICE_DELIVERY_METHOD_RECIPIENT",
  "INVOICE_RECIPIENT",
  "OWNER_INVOICE_RECIPIENT",
  "PRIMARY_SITE_CONTACT",
  "OWNER_PRIMARY_SITE_CONTACT",
  "OWNER_SITE_CONTACT",
  "PROJECT_OWNER_PRIMARY_SITE_CONTACT",
  "PROJECT_OWNER_CONTACT_NAME",
  "PROJECT_OWNER_CONTACT_TITLE",
  "PROJECT_OWNER_CONTACT_EMAIL",
  "PROJECT_OWNER_CONTACT_PHONE",
  "BILLING_CONTACT",
  "OWNER_BILLING_CONTACT",
  "NOTICE_REQUIREMENTS_AND_ADDRESSES",
] as const;

export const OWNER_CONTRACT_CONTACT_ROUTING_FIELDS = [
  ...OWNER_CONTRACT_PRIMARY_PARTY_FIELDS,
  ...OWNER_CONTRACT_ROUTING_OVERRIDE_FIELDS,
  ...OWNER_CONTRACT_DERIVED_CONTACT_FIELDS,
] as const;

export type ContractProjectSource = {
  number: string;
  name: string;
  site?: string;
  ownerName?: string;
  ownerContactName?: string;
  ownerContactTitle?: string;
  ownerContactEmail?: string;
  ownerContactPhone?: string;
  ownerContactAddressLine1?: string;
  ownerContactAddressLine2?: string;
  ownerContractDate?: string;
  architect?: string;
  projectType?: string;
  contractAmount?: string;
  startDate?: string;
  substantialDate?: string;
  finalDate?: string;
  projectManager?: string;
  superintendent?: string;
  paymentTerms?: string;
  retainageInitialPercent?: string;
  retainageAfterHalfPercent?: string;
};

export type ContractActorSource = { name: string; email: string };

export type OwnerContractCommercialTermsInput = {
  paymentTerms?: unknown;
  retainageInitialPercent?: unknown;
  retainageAfterHalfPercent?: unknown;
};

export type OwnerContractCommercialTerms = {
  paymentTerms: string;
  retainageInitialPercent: string;
  retainageAfterHalfPercent: string;
  retainageTerms: string;
};

export type OwnerContractContactRouting = {
  fields: Record<string, string>;
  manualFieldKeys: string[];
};

export type OwnerContractTemplate = {
  id: string;
  version: string;
  label: string;
  shortLabel: string;
  description: string;
  htmlPath: string;
  docxPath: string | null;
  source: "Mefford" | "External";
  instruments: readonly string[];
};

export const OWNER_CONTRACT_TEMPLATES: Record<OwnerContractType, OwnerContractTemplate> = {
  "Design-Build GMP": {
    id: "MC-OWN-DBGMP-001",
    version: "Rev. 3.0 · Current Controlled Master",
    label: "Design-Build GMP",
    shortLabel: "DB GMP",
    description: "Start design first. Exhibit A adds the final GMP and construction approval.",
    htmlPath: "/contract-templates/legal-review/design-build-gmp-agreement.html",
    docxPath: "/contract-templates/legal-review/design-build-gmp-agreement.docx",
    source: "Mefford",
    instruments: ["Phase 1 Agreement", "GMP Exhibit A"],
  },
  "Design-Build Lump Sum": {
    id: "MC-OWN-DBLS-001",
    version: "Rev. 1.2 · Current Controlled Master",
    label: "Design-Build Lump Sum",
    shortLabel: "DB LS",
    description: "Design and construction under one fixed-price contract.",
    htmlPath: "/contract-templates/legal-review/design-build-lump-sum.html",
    docxPath: "/contract-templates/legal-review/design-build-lump-sum.docx",
    source: "Mefford",
    instruments: ["Primary Agreement"],
  },
  "Plan & Spec Lump Sum": {
    id: "MC-OWN-LSPS-001",
    version: "Rev. 1.2 · Current Controlled Master",
    label: "Plan & Spec Lump Sum",
    shortLabel: "P&S LS",
    description: "Fixed-price construction using the Project Owner's plans and specifications.",
    htmlPath: "/contract-templates/legal-review/plan-and-specifications-lump-sum.html",
    docxPath: "/contract-templates/legal-review/plan-and-specifications-lump-sum.docx",
    source: "Mefford",
    instruments: ["Primary Agreement"],
  },
  "Time & Materials": {
    id: "MC-OWN-SMALL-001",
    version: "Rev. 2.0 · Current Controlled Master",
    label: "Small Projects / T&M",
    shortLabel: "SP / T&M",
    description: "Uses the new small-project agreement with lump sum, T&M, or T&M not-to-exceed pricing.",
    htmlPath: "/contract-templates/legal-review/time-and-materials.html",
    docxPath: null,
    source: "Mefford",
    instruments: ["Primary Agreement"],
  },
  "External Contract": {
    id: "MC-OWN-EXT-001",
    version: "v0.1 Controlled Intake",
    label: "External Contract",
    shortLabel: "EXT",
    description: "Use another party's contract and track its requirements here.",
    htmlPath: "/contract-templates/external-contract-cover.html",
    docxPath: null,
    source: "External",
    instruments: ["External Agreement Mapping"],
  },
};

const DESIGN_BUILD_GMP_EXHIBIT_A_TEMPLATE: OwnerContractTemplate = {
  id: "MC-OWN-DBGMP-001-A",
  version: "Rev. 3.0 · Current Controlled Master",
  label: "Design-Build GMP · Exhibit A",
  shortLabel: "GMP A",
  description: "Final GMP, cost details, allowances, and construction approval.",
  htmlPath: "/contract-templates/legal-review/design-build-gmp-exhibit-a.html",
  docxPath: "/contract-templates/legal-review/design-build-gmp-exhibit-a.docx",
  source: "Mefford",
  instruments: ["GMP Exhibit A"],
};

const LEGACY_OWNER_CONTRACT_TEMPLATES: Partial<Record<OwnerContractType, OwnerContractTemplate>> = {
  "Design-Build GMP": {
    ...OWNER_CONTRACT_TEMPLATES["Design-Build GMP"],
    version: "Rev. 2.1 · Archived Controlled Master",
    htmlPath: "/contract-templates/legal-review/archive/design-build-gmp-agreement-rev-2.1.html",
    docxPath: "/contract-templates/legal-review/archive/design-build-gmp-agreement-rev-2.1.docx",
  },
  "Design-Build Lump Sum": {
    ...OWNER_CONTRACT_TEMPLATES["Design-Build Lump Sum"],
    version: "Rev. 1.0 · Archived Controlled Master",
    htmlPath: "/contract-templates/legal-review/archive/design-build-lump-sum-rev-1.0.html",
    docxPath: "/contract-templates/legal-review/archive/design-build-lump-sum-rev-1.0.docx",
  },
  "Plan & Spec Lump Sum": {
    ...OWNER_CONTRACT_TEMPLATES["Plan & Spec Lump Sum"],
    version: "Rev. 1.0 · Archived Controlled Master",
    htmlPath: "/contract-templates/legal-review/archive/plan-and-specifications-lump-sum-rev-1.0.html",
    docxPath: "/contract-templates/legal-review/archive/plan-and-specifications-lump-sum-rev-1.0.docx",
  },
  "Time & Materials": {
    ...OWNER_CONTRACT_TEMPLATES["Time & Materials"],
    version: "Rev. 1.0 · Archived Controlled Master",
    htmlPath: "/contract-templates/legal-review/archive/time-and-materials-rev-1.0.html",
    docxPath: "/contract-templates/legal-review/archive/time-and-materials-rev-1.0.docx",
  },
};

const PREVIOUS_TIME_AND_MATERIALS_TEMPLATE: OwnerContractTemplate = {
  id: "MC-OWN-TM-001",
  version: "Rev. 1.2 · Archived Controlled Master",
  label: "Time & Materials",
  shortLabel: "T&M",
  description: "Prior Time & Materials controlled master retained for released and executed contracts.",
  htmlPath: "/contract-templates/legal-review/archive/time-and-materials-rev-1.2.html",
  docxPath: "/contract-templates/legal-review/archive/time-and-materials-rev-1.2.docx",
  source: "Mefford",
  instruments: ["Primary Agreement"],
};

const LEGACY_DESIGN_BUILD_GMP_EXHIBIT_A_TEMPLATE: OwnerContractTemplate = {
  ...DESIGN_BUILD_GMP_EXHIBIT_A_TEMPLATE,
  version: "Rev. 2.1 · Archived Controlled Master",
  htmlPath: "/contract-templates/legal-review/archive/design-build-gmp-exhibit-a-rev-2.1.html",
  docxPath: "/contract-templates/legal-review/archive/design-build-gmp-exhibit-a-rev-2.1.docx",
};

const signatureFields = new Set([
  "CONTRACTOR_SIGNATURE", "CONTRACTOR_SIGNATURE_DATE", "OWNER_SIGNATURE", "OWNER_SIGNATURE_DATE",
  "DESIGN_BUILDER_SIGNATURE", "DESIGN_BUILDER_SIGNATURE_DATE", "DB_AMENDMENT_DESIGN_BUILDER_SIGNATURE",
  "DB_AMENDMENT_DESIGN_BUILDER_DATE", "DB_AMENDMENT_OWNER_SIGNATURE", "DB_AMENDMENT_OWNER_DATE",
]);

const executionControlFields = new Set([
  "DOCUMENT_HASH_AT_EXECUTION", "SIGNATURE_AUDIT_RECORD_ID", "TEMPLATE_AND_ATTACHMENT_HASHES", "TEMPLATE_HASH",
  "EXTERNAL_CONTRACT_FILE_ID", "EXTERNAL_CONTRACT_FILE_NAME",
]);

const systemManagedContractFields = new Set([
  "SMALL_PROJECT_PRICING_METHOD_CODE",
  "SMALL_PROJECT_PRICING_METHOD_LABEL",
  "SMALL_PROJECT_PRICE_TERMS",
  "SMALL_PROJECT_CONTRACT_ARRANGEMENT",
  "SMALL_PROJECT_CHANGE_ORDER_TERMS",
  "SMALL_PROJECT_COST_REPORTING_TERMS",
  "SMALL_PROJECT_GUARANTEE_TERMS",
]);

const smallProjectPricingFields = new Set([
  "SMALL_PROJECT_PRICING_METHOD",
  "SMALL_PROJECT_CONTRACT_AMOUNT",
  "TIME_AND_MATERIALS_RATE_SCHEDULE",
  "CONTRACTOR_FEE_PROFIT_PERCENTAGE",
]);

export function isOwnerContractType(value: unknown): value is OwnerContractType {
  return OWNER_CONTRACT_TYPES.includes(value as OwnerContractType);
}

export function normalizeOwnerContractType(value: unknown): OwnerContractType | null {
  if (isOwnerContractType(value)) return value;
  if (value === "Design-Build") return "Design-Build GMP";
  if (value === "Lump Sum") return "Plan & Spec Lump Sum";
  if (value === "T&M") return "Time & Materials";
  return null;
}

export function normalizeSmallProjectPricingMethod(value: unknown): SmallProjectPricingMethod {
  const normalized = String(value || "").trim().toLowerCase().replaceAll("&", "and").replace(/[^a-z0-9]+/g, " ").trim();
  if (normalized === "lump sum" || normalized === "fixed price") return "Lump Sum";
  if (normalized === "time and materials" || normalized === "t m" || normalized === "tandm") return "Time & Materials";
  if (normalized === "time and materials not to exceed" || normalized === "t m not to exceed" || normalized === "tandm not to exceed" || normalized === "nte") {
    return "Time & Materials Not to Exceed";
  }
  return "Time & Materials Not to Exceed";
}

export function withOwnerContractComputedFields(
  type: OwnerContractType,
  sourceFields: Record<string, string>,
) {
  const fields = { ...sourceFields };
  if (type !== "Time & Materials") return fields;

  const method = normalizeSmallProjectPricingMethod(fields.SMALL_PROJECT_PRICING_METHOD);
  const definition = SMALL_PROJECT_PRICING_METHODS.find((item) => item.value === method)!;
  const amount = normalizeMoney(fields.SMALL_PROJECT_CONTRACT_AMOUNT || fields.NTE_AMOUNT_OR_NOT_APPLICABLE || "");
  const displayedAmount = amount ? formatMoney(amount) : "Not Completed";
  const fee = normalizePercent(fields.CONTRACTOR_FEE_PROFIT_PERCENTAGE, 0);
  const displayedFee = `${fee}%`;

  fields.SMALL_PROJECT_PRICING_METHOD = method;
  fields.SMALL_PROJECT_PRICING_METHOD_CODE = definition.code;
  fields.SMALL_PROJECT_PRICING_METHOD_LABEL = method;
  fields.SMALL_PROJECT_CONTRACT_AMOUNT = amount;
  fields.NTE_AMOUNT_OR_NOT_APPLICABLE = amount;

  if (method === "Lump Sum") {
    fields.SMALL_PROJECT_PRICE_TERMS = `Owner will pay Contractor the fixed Contract Price of ${displayedAmount}, subject only to allowance reconciliation and signed Change Orders.`;
    fields.SMALL_PROJECT_CONTRACT_ARRANGEMENT = "The Parties selected a Lump Sum arrangement. Contractor bears ordinary cost variance within the agreed scope; Owner remains responsible for allowances and authorized changes.";
    fields.SMALL_PROJECT_CHANGE_ORDER_TERMS = "Every scope change must state the lump-sum price adjustment and time adjustment before changed Work begins.";
    fields.SMALL_PROJECT_COST_REPORTING_TERMS = "Detailed cost reconciliation is not required for unchanged Lump Sum Work.";
  } else if (method === "Time & Materials") {
    fields.SMALL_PROJECT_PRICE_TERMS = `Owner will pay actual documented Project costs plus the agreed ${displayedFee} Contractor fee. This arrangement has no fixed price and no not-to-exceed amount.`;
    fields.SMALL_PROJECT_CONTRACT_ARRANGEMENT = "The Parties selected open Time and Materials. Any estimate or forecast is a planning tool only and is not a guarantee of final cost.";
    fields.SMALL_PROJECT_CHANGE_ORDER_TERMS = "A written Change Order is required for a material change in scope, rates, fee, or Contract Time; ordinary cost variance within the stated scope is documented through T&M reporting.";
    fields.SMALL_PROJECT_COST_REPORTING_TERMS = "Contractor will provide the weekly T&M tickets and reconciliation required by Section 2.";
  } else {
    fields.SMALL_PROJECT_PRICE_TERMS = `Owner will pay actual documented Project costs plus the agreed ${displayedFee} Contractor fee, up to a not-to-exceed amount of ${displayedAmount} unless changed in writing. If actual charges are lower, Owner pays the lower amount.`;
    fields.SMALL_PROJECT_CONTRACT_ARRANGEMENT = "The Parties selected Time and Materials Not to Exceed. The cap is a maximum control, not a lump-sum entitlement or a forecast guarantee.";
    fields.SMALL_PROJECT_CHANGE_ORDER_TERMS = "Contractor may not exceed the not-to-exceed amount without a written Change Order that adjusts the cap and, when applicable, the Contract Time.";
    fields.SMALL_PROJECT_COST_REPORTING_TERMS = "Contractor will provide the weekly T&M tickets, reconciliation, and remaining-cap balance required by Section 2.";
  }

  const guarantyRequired = /^(?:yes|y|true|1)$/i.test(String(fields.PERSONAL_GUARANTY_REQUIRED_YES_OR_NO || "").trim());
  const guarantorName = String(fields.GUARANTOR_NAME || "").trim();
  fields.PERSONAL_GUARANTY_REQUIRED_YES_OR_NO = guarantyRequired ? "YES" : "NO";
  fields.SMALL_PROJECT_GUARANTEE_TERMS = guarantyRequired
    ? `${guarantorName || "The named guarantor"}, signing in an individual capacity, personally and unconditionally guarantees Owner’s payment obligations under this Contract. The guarantor should sign a separate guaranty approved for this Project before Work begins.`
    : "No personal guaranty is required under this Contract.";
  return fields;
}

export function defaultContractInstrument(type: OwnerContractType): OwnerContractInstrument {
  if (type === "Design-Build GMP") return "Phase 1 Agreement";
  if (type === "External Contract") return "External Agreement Mapping";
  return "Primary Agreement";
}

export function normalizeOwnerContractCommercialTerms(
  input: OwnerContractCommercialTermsInput,
): OwnerContractCommercialTerms {
  const paymentTerms = String(input.paymentTerms || "").trim()
    || "Monthly progress payments; undisputed amounts due as required by Project-state law.";
  const retainageInitialPercent = normalizePercent(input.retainageInitialPercent, 10);
  const retainageAfterHalfPercent = normalizePercent(input.retainageAfterHalfPercent, 5);
  return {
    paymentTerms,
    retainageInitialPercent,
    retainageAfterHalfPercent,
    retainageTerms: `${retainageInitialPercent}% until 50% completion, then ${retainageAfterHalfPercent}%; release as required by Project-state law.`,
  };
}

export function applyOwnerContractCommercialTerms(
  fields: Record<string, string>,
  terms: OwnerContractCommercialTerms,
) {
  fields.PAYMENT_TERMS = terms.paymentTerms;
  fields.REMAINING_PAYMENT_SCHEDULE = terms.paymentTerms;
  fields.RETAINAGE_TERMS = terms.retainageTerms;
  fields.RETAINAGE_TERMS_AND_RELEASE = terms.retainageTerms;
  fields.CONSTRUCTION_RETAINAGE = terms.retainageTerms;
  fields.RETAINAGE_PERCENTAGE = terms.retainageInitialPercent;
  return fields;
}

/**
 * Turns the single Project Owner record into every contact-shaped placeholder
 * used by the controlled contract masters. The verbose placeholder set remains
 * available to the templates, but people only maintain one primary record and
 * optional, explicitly named routing exceptions.
 */
export function synchronizeOwnerContractContactFields(
  sourceFields: Record<string, string>,
  sourceManualFieldKeys: Iterable<string> = [],
): OwnerContractContactRouting {
  const fields = { ...sourceFields };
  const manual = new Set(Array.from(sourceManualFieldKeys, String).filter((field) => /^[A-Z0-9_]+$/.test(field)));
  const text = (field: string) => String(fields[field] || "").trim();
  const first = (...values: string[]) => values.map((value) => String(value || "").trim()).find(Boolean) || "";
  const representativeParts = splitOwnerRepresentative(first(text("OWNER_AUTHORIZED_REPRESENTATIVE"), text("OWNER_NOTICE_CONTACT")));

  promoteLegacyPrimary("OWNER_PRIMARY_CONTACT_NAME", ["OWNER_SIGNATORY", "PROJECT_OWNER_CONTACT_NAME"], fields, manual);
  promoteLegacyPrimary("OWNER_PRIMARY_CONTACT_TITLE", ["OWNER_SIGNATORY_TITLE", "PROJECT_OWNER_CONTACT_TITLE"], fields, manual);
  promoteLegacyPrimary("OWNER_PRIMARY_CONTACT_EMAIL", ["OWNER_NOTICE_EMAIL", "OWNER_EMAIL", "OWNER_SIGNATORY_EMAIL", "PROJECT_OWNER_CONTACT_EMAIL"], fields, manual);
  promoteLegacyPrimary("OWNER_PRIMARY_CONTACT_PHONE", ["OWNER_NOTICE_PHONE", "OWNER_PHONE", "OWNER_SIGNATORY_PHONE", "PROJECT_OWNER_CONTACT_PHONE"], fields, manual);
  promoteLegacyPrimary("OWNER_PRIMARY_MAILING_ADDRESS_LINE_1", ["OWNER_NOTICE_ADDRESS_LINE_1"], fields, manual);
  promoteLegacyPrimary("OWNER_PRIMARY_MAILING_ADDRESS_LINE_2", ["OWNER_NOTICE_ADDRESS_LINE_2"], fields, manual);

  if (!manual.has("OWNER_PRIMARY_CONTACT_NAME") && !text("OWNER_PRIMARY_CONTACT_NAME") && representativeParts.name) fields.OWNER_PRIMARY_CONTACT_NAME = representativeParts.name;
  if (!manual.has("OWNER_PRIMARY_CONTACT_TITLE") && !text("OWNER_PRIMARY_CONTACT_TITLE") && representativeParts.title) fields.OWNER_PRIMARY_CONTACT_TITLE = representativeParts.title;

  promoteLegacyException("OWNER_INVOICE_RECIPIENT_OVERRIDE", ["INVOICE_DELIVERY_METHOD_RECIPIENT", "INVOICE_RECIPIENT", "OWNER_INVOICE_RECIPIENT"], fields, manual);
  promoteLegacyException("OWNER_SITE_CONTACT_OVERRIDE", ["PRIMARY_SITE_CONTACT", "OWNER_PRIMARY_SITE_CONTACT", "OWNER_SITE_CONTACT", "PROJECT_OWNER_PRIMARY_SITE_CONTACT"], fields, manual);

  const enteredLegalName = String(fields.OWNER_LEGAL_NAME || "");
  const enteredEntityAndState = String(fields.OWNER_ENTITY_AND_STATE || "");
  let legalName = manual.has("OWNER_LEGAL_NAME") ? text("OWNER_LEGAL_NAME") : first(text("OWNER_LEGAL_NAME"), text("OWNER_LEGAL_NAME_AND_STATUS"));
  let entityAndState = text("OWNER_ENTITY_AND_STATE");
  const priorLegalAndStatus = text("OWNER_LEGAL_NAME_AND_STATUS");
  if (!manual.has("OWNER_ENTITY_AND_STATE") && !entityAndState && legalName && priorLegalAndStatus.toLowerCase().startsWith(legalName.toLowerCase())) {
    entityAndState = priorLegalAndStatus.slice(legalName.length).replace(/^[\s,·;-]+/, "").trim();
  }
  if (!manual.has("OWNER_LEGAL_NAME") && !legalName && priorLegalAndStatus) legalName = priorLegalAndStatus;

  const primaryName = text("OWNER_PRIMARY_CONTACT_NAME");
  const primaryTitle = text("OWNER_PRIMARY_CONTACT_TITLE");
  const primaryEmail = text("OWNER_PRIMARY_CONTACT_EMAIL");
  const primaryPhone = text("OWNER_PRIMARY_CONTACT_PHONE");
  const primaryAddressLine1 = text("OWNER_PRIMARY_MAILING_ADDRESS_LINE_1");
  const primaryAddressLine2 = text("OWNER_PRIMARY_MAILING_ADDRESS_LINE_2");
  const representative = [primaryName, primaryTitle].filter(Boolean).join(" · ");
  const primaryDirectContact = [representative, primaryEmail, primaryPhone].filter(Boolean).join(" · ");
  const primaryMailingAddress = [primaryAddressLine1, primaryAddressLine2].filter(Boolean).join("\n");

  const signerName = first(text("OWNER_SIGNER_NAME_OVERRIDE"), primaryName);
  const signerTitle = first(text("OWNER_SIGNER_TITLE_OVERRIDE"), primaryTitle);
  const signerEmail = first(text("OWNER_SIGNER_EMAIL_OVERRIDE"), primaryEmail);
  const noticeContact = first(text("OWNER_NOTICE_CONTACT_OVERRIDE"), representative);
  const noticeEmail = first(text("OWNER_NOTICE_EMAIL_OVERRIDE"), primaryEmail);
  const noticePhone = first(text("OWNER_NOTICE_PHONE_OVERRIDE"), primaryPhone);
  const noticeAddressLine1 = first(text("OWNER_NOTICE_ADDRESS_LINE_1_OVERRIDE"), primaryAddressLine1);
  const noticeAddressLine2 = first(text("OWNER_NOTICE_ADDRESS_LINE_2_OVERRIDE"), primaryAddressLine2);
  const noticeMailingAddress = [noticeAddressLine1, noticeAddressLine2].filter(Boolean).join("\n");
  const fullContactBlock = [legalName, primaryAddressLine1, primaryAddressLine2, representative, primaryEmail, primaryPhone].filter(Boolean).join("\n");
  const noticeBlock = [legalName, noticeAddressLine1, noticeAddressLine2, noticeContact, noticeEmail, noticePhone].filter(Boolean).join("\n");
  const invoiceRecipient = first(
    text("OWNER_INVOICE_RECIPIENT_OVERRIDE"),
    primaryEmail
      ? ["Email", primaryName, primaryEmail].filter(Boolean).join(" · ")
      : primaryMailingAddress
        ? ["Mail", primaryName, primaryMailingAddress.replaceAll("\n", ", ")].filter(Boolean).join(" · ")
        : primaryDirectContact,
  );
  const siteContact = first(text("OWNER_SITE_CONTACT_OVERRIDE"), primaryDirectContact);

  // Preserve the exact in-progress value for editable source fields. Derived
  // contract fields still use the trimmed values above, but trimming the source
  // on every keypress made it impossible to type a space between words.
  fields.OWNER_LEGAL_NAME = manual.has("OWNER_LEGAL_NAME") ? enteredLegalName : legalName;
  fields.OWNER_ENTITY_AND_STATE = manual.has("OWNER_ENTITY_AND_STATE") ? enteredEntityAndState : entityAndState;
  fields.OWNER_LEGAL_NAME_AND_STATUS = [legalName, entityAndState].filter(Boolean).join(", ");
  fields.OWNER_ADDRESS_REPRESENTATIVE_CONTACT = fullContactBlock;
  fields.OWNER_AUTHORIZED_REPRESENTATIVE = representative;
  fields.OWNER_REPRESENTATIVE_AUTHORIZED_TO_ACKNOWLEDGE_TICKETS = representative;
  fields.OWNER_SIGNATORY = signerName;
  fields.OWNER_SIGNATORY_TITLE = signerTitle;
  fields.OWNER_SIGNATORY_EMAIL = signerEmail;
  fields.OWNER_SIGNATORY_PHONE = first(text("OWNER_SIGNER_PHONE_OVERRIDE"), primaryPhone);
  fields.OWNER_RECIPIENT = noticeContact;
  fields.OWNER_NOTICE_CONTACT = noticeContact;
  fields.OWNER_NOTICE_EMAIL = noticeEmail;
  fields.OWNER_EMAIL = noticeEmail;
  fields.OWNER_NOTICE_PHONE = noticePhone;
  fields.OWNER_PHONE = noticePhone;
  fields.OWNER_NOTICE_ADDRESS_LINE_1 = noticeAddressLine1;
  fields.OWNER_NOTICE_ADDRESS_LINE_2 = noticeAddressLine2;
  fields.OWNER_DELIVERY_ADDRESS = noticeMailingAddress;
  fields.OWNER_MAILING_ADDRESS = primaryMailingAddress;
  fields.NOTICE_REQUIREMENTS_AND_ADDRESSES = noticeBlock;
  fields.INVOICE_DELIVERY_METHOD_RECIPIENT = invoiceRecipient;
  fields.INVOICE_RECIPIENT = invoiceRecipient;
  fields.OWNER_INVOICE_RECIPIENT = invoiceRecipient;
  fields.PRIMARY_SITE_CONTACT = siteContact;
  fields.OWNER_PRIMARY_SITE_CONTACT = siteContact;
  fields.OWNER_SITE_CONTACT = siteContact;
  fields.PROJECT_OWNER_PRIMARY_SITE_CONTACT = siteContact;
  fields.PROJECT_OWNER_CONTACT_NAME = primaryName;
  fields.PROJECT_OWNER_CONTACT_TITLE = primaryTitle;
  fields.PROJECT_OWNER_CONTACT_EMAIL = primaryEmail;
  fields.PROJECT_OWNER_CONTACT_PHONE = primaryPhone;
  fields.BILLING_CONTACT = primaryDirectContact;
  fields.OWNER_BILLING_CONTACT = primaryDirectContact;

  for (const field of OWNER_CONTRACT_ROUTING_OVERRIDE_FIELDS) {
    if (text(field)) manual.add(field);
    else manual.delete(field);
  }
  for (const field of OWNER_CONTRACT_DERIVED_CONTACT_FIELDS) manual.delete(field);
  return { fields, manualFieldKeys: [...manual] };
}

function promoteLegacyPrimary(
  canonicalField: string,
  legacyFields: string[],
  fields: Record<string, string>,
  manual: Set<string>,
) {
  const manualLegacy = legacyFields.find((field) => manual.has(field) && String(fields[field] || "").trim());
  if (!manual.has(canonicalField) && manualLegacy) {
    fields[canonicalField] = String(fields[manualLegacy] || "").trim();
    manual.add(canonicalField);
  }
  if (!manual.has(canonicalField) && !String(fields[canonicalField] || "").trim()) {
    const legacy = legacyFields.find((field) => String(fields[field] || "").trim());
    if (legacy) fields[canonicalField] = String(fields[legacy] || "").trim();
  }
}

function promoteLegacyException(
  overrideField: string,
  legacyFields: string[],
  fields: Record<string, string>,
  manual: Set<string>,
) {
  if (String(fields[overrideField] || "").trim()) {
    manual.add(overrideField);
    return;
  }
  const legacy = legacyFields.find((field) => manual.has(field) && String(fields[field] || "").trim());
  if (!legacy) return;
  fields[overrideField] = String(fields[legacy] || "").trim();
  manual.add(overrideField);
}

function splitOwnerRepresentative(value: string) {
  const [name = "", ...title] = value.split(/\s+·\s+/);
  return { name: name.trim(), title: title.join(" · ").trim() };
}

export function contractTemplate(type: OwnerContractType, instrument: OwnerContractInstrument = defaultContractInstrument(type)) {
  return type === "Design-Build GMP" && instrument === "GMP Exhibit A" ? DESIGN_BUILD_GMP_EXHIBIT_A_TEMPLATE : OWNER_CONTRACT_TEMPLATES[type];
}

export function contractTemplateForStoredVersion(
  type: OwnerContractType,
  instrument: OwnerContractInstrument,
  storedVersion: string,
) {
  const current = contractTemplate(type, instrument);
  if (type === "External Contract") return current;
  const version = storedVersion.trim();
  if (type === "Time & Materials" && /^Rev\. 1\.2(?:\b|\s|·)/.test(version)) return PREVIOUS_TIME_AND_MATERIALS_TEMPLATE;
  if (version && !/^Rev\. (?:2\.1|1\.0)(?:\b|\s|·)/.test(version)) return current;
  if (type === "Design-Build GMP" && instrument === "GMP Exhibit A") return LEGACY_DESIGN_BUILD_GMP_EXHIBIT_A_TEMPLATE;
  return LEGACY_OWNER_CONTRACT_TEMPLATES[type] || current;
}
export function isSignatureContractField(field: string) { return signatureFields.has(field); }
export function isExecutionControlField(field: string) { return executionControlFields.has(field); }
export function isSystemManagedContractField(field: string) { return systemManagedContractFields.has(field); }
export function isSmallProjectPricingField(field: string) { return smallProjectPricingFields.has(field); }

export function contractFieldLabel(field: string) {
  const exact: Record<string, string> = {
    OWNER_LEGAL_NAME: "Project Owner Legal Name",
    OWNER_LEGAL_NAME_AND_STATUS: "Project Owner Legal Name And Entity Type",
    OWNER_ENTITY_AND_STATE: "Entity Type And State",
    OWNER_PRIMARY_CONTACT_NAME: "Primary Contact Name",
    OWNER_PRIMARY_CONTACT_TITLE: "Primary Contact Title",
    OWNER_PRIMARY_CONTACT_EMAIL: "Primary Contact Email",
    OWNER_PRIMARY_CONTACT_PHONE: "Primary Contact Phone",
    OWNER_PRIMARY_MAILING_ADDRESS_LINE_1: "Project Owner Mailing Address",
    OWNER_PRIMARY_MAILING_ADDRESS_LINE_2: "City, State And ZIP (Optional)",
    OWNER_SIGNER_NAME_OVERRIDE: "Different Signer Name",
    OWNER_SIGNER_TITLE_OVERRIDE: "Different Signer Title / Authority",
    OWNER_SIGNER_EMAIL_OVERRIDE: "Different Signer Email",
    OWNER_SIGNER_PHONE_OVERRIDE: "Different Signer Phone",
    OWNER_NOTICE_CONTACT_OVERRIDE: "Different Notice Recipient",
    OWNER_NOTICE_EMAIL_OVERRIDE: "Different Notice Email",
    OWNER_NOTICE_PHONE_OVERRIDE: "Different Notice Phone",
    OWNER_NOTICE_ADDRESS_LINE_1_OVERRIDE: "Different Notice Address",
    OWNER_NOTICE_ADDRESS_LINE_2_OVERRIDE: "Notice City, State And ZIP",
    OWNER_INVOICE_RECIPIENT_OVERRIDE: "Different Invoice Delivery / Recipient",
    OWNER_SITE_CONTACT_OVERRIDE: "Different Primary Jobsite Contact",
    OWNER_ADDRESS_REPRESENTATIVE_CONTACT: "Project Owner Address And Contact (Automatic)",
    OWNER_AUTHORIZED_REPRESENTATIVE: "Authorized Project Owner Contact",
    OWNER_RECIPIENT: "Project Owner Notice Recipient",
    OWNER_SIGNATORY: "Contract Signer Name",
    OWNER_SIGNATORY_TITLE: "Contract Signer Title / Authority",
    OWNER_SIGNATORY_EMAIL: "Contract Signer Email",
    OWNER_SIGNATORY_PHONE: "Contract Signer Phone",
    OWNER_NOTICE_CONTACT: "Project Owner Notice Contact",
    OWNER_NOTICE_ADDRESS_LINE_1: "Project Owner Mailing Address Line 1",
    OWNER_NOTICE_ADDRESS_LINE_2: "Project Owner Mailing Address Line 2 (Optional)",
    OWNER_NOTICE_EMAIL: "Project Owner Notice Email",
    OWNER_NOTICE_PHONE: "Project Owner Notice Phone",
    OWNER_EMAIL: "Project Owner Email",
    OWNER_PHONE: "Project Owner Phone",
    OWNER_DELIVERY_ADDRESS: "Project Owner Mailing Address",
    PRIMARY_SITE_CONTACT: "Primary Project Site Contact",
    OWNER_S_TOTAL_PROJECT_BUDGET: "Project Owner Total Project Budget",
    OWNER_TOTAL_PROJECT_BUDGET: "Project Owner Total Project Budget",
    OWNER_TARGET_BUDGET: "Project Owner Target Budget",
    OWNER_CRITERIA_ID_VERSION_AND_DATE: "Project Requirements Document",
    FINAL_OWNER_CRITERIA_ID_VERSION_AND_DATE: "Final Project Requirements Document",
    PROJECT_NAME_AND_ADDRESS: "Project Name And Location",
    PROJECT_SITE_ADDRESS: "Project Location",
    PROJECT_DESCRIPTION: "Project Scope Summary",
    LUMP_SUM_CONTRACT_SUM: "Fixed Contract Price",
    TOTAL_LUMP_SUM_CONTRACT_SUM_AMOUNT: "Fixed Contract Price",
    PHASE_ONE_DESIGN_AND_PRECONSTRUCTION_FEE: "Phase 1 Design And Preconstruction Fee",
    TOTAL_PHASE_ONE_FEE: "Total Phase 1 Fee",
    DESIGN_PRECONSTRUCTION_INCLUDED_AMOUNT: "Design And Preconstruction Amount",
    DESIGN_MILESTONES_AND_ANTICIPATED_GMP_PROPOSAL_DATE: "Design Milestones And Target GMP Date",
    CONDITIONS_BEFORE_CONSTRUCTION_COMMENCEMENT: "Requirements Before Construction Starts",
    CONSTRUCTION_COMMENCEMENT_DATE: "Construction Start Date",
    CONSTRUCTION_SCOPE_OF_WORK: "Construction Scope",
    CONSTRUCTION_EXCLUSIONS: "Construction Exclusions",
    SMALL_PROJECT_PRICING_METHOD: "Price Arrangement",
    SMALL_PROJECT_CONTRACT_AMOUNT: "Contract Amount Or NTE Cap",
    TIME_AND_MATERIALS_RATE_SCHEDULE: "T&M Labor And Equipment Rate Schedule",
    OWNER_PROPERTY_INTEREST: "Project Owner's Interest In The Property",
    ALLOWANCE_SCHEDULE_OR_NONE: "Allowance Schedule (Or None)",
    ALLOWANCES_AMOUNT: "Total Included Allowances",
    CONTRACT_DOCUMENTS_AND_PROPOSALS: "Contract Documents And Incorporated Proposals",
    OWNER_MEETING_INTERVAL_DAYS: "Project Owner Meeting Interval (Days)",
    INVOICE_FREQUENCY: "Invoice Frequency",
    LATE_PAYMENT_INTEREST_PERCENTAGE: "Late-Payment Interest (Annual Percentage)",
    STOP_WORK_AFTER_DAYS: "Nonpayment Stop-Work Trigger (Days)",
    INSPECTION_PERIOD_DAYS: "Project Owner Inspection Period (Business Days)",
    FINAL_PAYMENT_DUE_DAYS: "Final Payment Due After Completion (Business Days)",
    PUBLIC_LIABILITY_INSURANCE_AMOUNT: "Commercial General Liability Limit",
    PERMIT_RESPONSIBILITY: "Permit Responsibility",
    WARRANTY_PERIOD_MONTHS: "Correction Period (Months)",
    GOVERNING_LAW: "Governing Law",
    VENUE: "Court Venue",
    MEDIATION_LOCATION: "Mediation Location",
    PERSONAL_GUARANTY_REQUIRED_YES_OR_NO: "Personal Guaranty Required? (Yes Or No)",
    GUARANTOR_NAME: "Personal Guarantor Name",
    CONTRACTOR_FEE_PROFIT_PERCENTAGE: "Contractor Fee And Profit Percentage",
    INITIAL_DEPOSIT_OR_ADVANCE: "Starting Deposit Or Advance",
    INVOICE_DELIVERY_METHOD_RECIPIENT: "Invoice Delivery And Recipient",
    CONTRACTOR_SIGNATORY: "Mefford Authorized Signer",
    CONTRACTOR_SIGNATORY_TITLE: "Mefford Signer Title",
    EXTERNAL_CONTRACT_CONTROLS_CONFIRMATION: "Controlling Document Confirmation",
    EXTERNAL_CONTRACT_SOURCE_PARTY: "Contract Issued By",
    EXTERNAL_CONTRACT_FILE_REVISION: "External Contract Version / Revision",
    EXTERNAL_CONTRACT_AMOUNT: "Contract Amount In External Agreement",
    EXTERNAL_CHANGE_ORDER_PROCEDURE: "Change Order Procedure",
    EXTERNAL_DISPUTE_AND_TERMINATION_TERMS: "Dispute / Suspension / Termination Terms",
    FINAL_GMP_COST_BREAKDOWN_AND_SOV: "Final GMP Cost Breakdown / Schedule Of Values",
    DESIGN_AND_CONSTRUCTION_SCOPE: "Design And Construction Scope",
  };
  if (exact[field]) return exact[field];
  return field.replaceAll("_OR_NONE", "").replaceAll("_OR_NA", "").replaceAll("_OR_TBD", "")
    .replaceAll("_AND_", " / ").replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace("Gmp", "GMP").replace("Nte", "NTE").replace("Sov", "SOV").replace("Bim", "BIM")
    .replace("Cgl", "CGL").replace("Wc", "WC").replace("Ffe", "FF&E").replace("Db ", "DB ")
    .replace(/\bOwner S\b/g, "Owner's").replace(/\bBuilder S\b/g, "Builder's").replace(/\bContractor S\b/g, "Contractor's")
    .replace(/\bProject Owner\b/g, "__PROJECT_OWNER__").replace(/\bOwner\b/g, "Project Owner").replaceAll("__PROJECT_OWNER__", "Project Owner")
    .replaceAll(" Scope Of Work", " Scope").replaceAll(" Item Specific Markup", " Markup Percentage")
    .replaceAll(" Straight Time Hr", " Regular Hourly Rate").replaceAll(" Overtime Hr", " Overtime Hourly Rate")
    .replaceAll(" Double Time Hr", " Double-Time Hourly Rate");
}

export function contractFieldGroup(field: string) {
  if (/EXTERNAL_CONTRACT|CONTROLLING_DOCUMENT|INTERNAL_CONTRACT_REVIEW/.test(field)) return "External Contract Intake & Mapping";
  if (/SIGNATORY|SIGNATURE|NOTICE_|AUTHORIZED_REPRESENTATIVE/.test(field)) return "Parties, Notices & Signatures";
  if (/PROJECT_|OWNER_CRITERIA|PROGRAM|SITE_|SPACE_|AESTHETIC|ZONING|OCCUPANCY/.test(field)) return "Project Details & Project Owner Requirements";
  if (/DESIGN|ARCHITECT|ENGINEER|BIM|INSTRUMENT|LICENSE|DISCIPLINE|PROFESSIONAL/.test(field)) return "Design Services";
  if (/AMOUNT|FEE|RATE|COST|MARKUP|ALLOWANCE|CONTINGENCY|GMP|BUDGET|BUYOUT|SAVINGS|PAYMENT|RETAINAGE|BILLING|SOV/.test(field)) return "Price, Billing & Accounting";
  if (/DATE|SCHEDULE|MILESTONE|COMPLETION|DELAY|LIQUIDATED|PHASE_1|PHASE_2|EARLY_WORK/.test(field)) return "Schedule & Phasing";
  if (/INSURANCE|LIABILITY|RISK|BOND|COVERAGE|SUBROGATION|SAFETY/.test(field)) return "Insurance, Bonds & Risk";
  if (/SCOPE|EXCLUSION|ASSUMPTION|PROCUREMENT|SUBCONTRACTOR|MATERIAL|EQUIPMENT|PERMIT|TESTING|COMMISSIONING|CLOSEOUT/.test(field)) return "Scope & Project Controls";
  return "Legal, Attachments & Document Control";
}

export function contractFieldInput(field: string): "date" | "email" | "number" | "text" | "textarea" {
  if (field.endsWith("_DATE") || field === "EFFECTIVE_DATE" || field.includes("COMPLETION_DATE")) return "date";
  if (field.endsWith("_EMAIL")) return "email";
  if (isScalarMoneyContractField(field) || isPercentageContractField(field)) return "number";
  if (/SCOPE|EXCLUSION|ASSUMPTION|CLARIFICATION|REQUIREMENT|RULE|DELIVERABLE|MILESTONE|INDEX|PROTOCOL|CONTROL|TREATMENT|ALLOCATION|PROCESS|SCHEDULE|TERMS|PROCEDURE|BREAKDOWN|NOTES/.test(field)) return "textarea";
  return "text";
}

export function isPercentageContractField(field: string) {
  if (/TERMS|NOTES|RULES|TREATMENT|BASIS|METHOD|CALCULATION|SCOPE|VALIDITY|DATE|SCHEDULE|REQUIREMENTS|DOCUMENTATION|CATEGORIES/.test(field)) return false;
  return /PERCENT|PERCENTAGE|MARKUP|RETAINAGE_PERCENTAGE|PERMITTED_MARKUP_OR_FEE/.test(field);
}

export function isScalarMoneyContractField(field: string) {
  if (isPercentageContractField(field) || /RETAINAGE|TERMS|NOTES|RULES|TREATMENT|BASIS|METHOD|CALCULATION|SCOPE|VALIDITY|DATE|SCHEDULE|REQUIREMENTS|DOCUMENTATION|CATEGORIES|IN_WORDS|OR_NONE|OR_TBD|OR_NOT_APPLICABLE/.test(field)) return false;
  return /AMOUNT|BUDGET|PRICE|COST_OF_THE_WORK|LUMP_SUM|CONTINGENC(?:Y|IES)|ALLOWANCES?|DEPOSIT|ADVANCE|(?:^|_)FEE(?:_|$)|HOURLY_RATE|UNIT_PRICE|_HR$|_HOURLY$|_DAILY$|_WEEKLY$/.test(field);
}

export function normalizeContractMoneyFields(value: Record<string, string>) {
  return Object.fromEntries(Object.entries(value).map(([field, fieldValue]) => {
    if (!isScalarMoneyContractField(field) || !String(fieldValue).trim()) return [field, fieldValue];
    const parsed = Number(String(fieldValue).replace(/[$,]/g, ""));
    return [field, Number.isFinite(parsed) ? moneyDecimal(parsed) : fieldValue];
  }));
}

export function defaultContractFields(type: OwnerContractType, project: ContractProjectSource, actor: ContractActorSource, instrument: OwnerContractInstrument = defaultContractInstrument(type)) {
  const projectState = inferProjectState(project.site || "");
  const amount = normalizeMoney(project.contractAmount || "");
  const template = contractTemplate(type, instrument);
  const isDesignBuild = type === "Design-Build GMP" || type === "Design-Build Lump Sum";
  const ownerAndStatus = project.ownerName || "";
  const projectAndAddress = [project.name, project.site].filter(Boolean).join(" · ");
  const ownerRepresentative = [project.ownerContactName, project.ownerContactTitle].filter(Boolean).join(" · ");
  const ownerContact = [ownerRepresentative, project.ownerContactEmail, project.ownerContactPhone].filter(Boolean).join(" · ");
  const ownerMailingAddress = [project.ownerContactAddressLine1, project.ownerContactAddressLine2].filter(Boolean).join("\n");
  const invoiceRecipient = project.ownerContactEmail
    ? ["Email", project.ownerContactName, project.ownerContactEmail].filter(Boolean).join(" · ")
    : ownerContact;
  const contractorContact = [actor.name, actor.email].filter(Boolean).join(" · ");
  const commercial = normalizeOwnerContractCommercialTerms(project);
  const common: Record<string, string> = {
    OWNER_LEGAL_NAME: project.ownerName || "", OWNER_LEGAL_NAME_AND_STATUS: ownerAndStatus,
    OWNER_PRIMARY_CONTACT_NAME: project.ownerContactName || "", OWNER_PRIMARY_CONTACT_TITLE: project.ownerContactTitle || "",
    OWNER_PRIMARY_CONTACT_EMAIL: project.ownerContactEmail || "", OWNER_PRIMARY_CONTACT_PHONE: project.ownerContactPhone || "",
    OWNER_PRIMARY_MAILING_ADDRESS_LINE_1: project.ownerContactAddressLine1 || "", OWNER_PRIMARY_MAILING_ADDRESS_LINE_2: project.ownerContactAddressLine2 || "",
    OWNER_ADDRESS_REPRESENTATIVE_CONTACT: [ownerMailingAddress, ownerContact].filter(Boolean).join("\n"), OWNER_ENTITY_AND_STATE: "",
    OWNER_AUTHORIZED_REPRESENTATIVE: ownerRepresentative, OWNER_RECIPIENT: ownerRepresentative,
    OWNER_NOTICE_CONTACT: ownerRepresentative, OWNER_SIGNATORY: project.ownerContactName || "",
    OWNER_SIGNATORY_TITLE: project.ownerContactTitle || "", OWNER_SIGNATORY_EMAIL: project.ownerContactEmail || "",
    OWNER_NOTICE_EMAIL: project.ownerContactEmail || "", OWNER_EMAIL: project.ownerContactEmail || "",
    OWNER_NOTICE_PHONE: project.ownerContactPhone || "", OWNER_PHONE: project.ownerContactPhone || "",
    OWNER_NOTICE_ADDRESS_LINE_1: project.ownerContactAddressLine1 || "", OWNER_NOTICE_ADDRESS_LINE_2: project.ownerContactAddressLine2 || "",
    OWNER_DELIVERY_ADDRESS: ownerMailingAddress, PRIMARY_SITE_CONTACT: ownerContact,
    OWNER_REPRESENTATIVE_AUTHORIZED_TO_ACKNOWLEDGE_TICKETS: ownerRepresentative,
    INVOICE_DELIVERY_METHOD_RECIPIENT: invoiceRecipient,
    PROJECT: project.name, PROJECT_NAME: project.name, PROJECT_NAME_AND_ADDRESS: projectAndAddress, PROJECT_NUMBER: project.number,
    PROJECT_SITE_ADDRESS: project.site || "", PROJECT_DESCRIPTION: "", PROJECT_STATE: projectState,
    PROJECT_TYPE: project.projectType || "", PROJECT_TYPE_OR_CLASSIFICATION: project.projectType || "",
    EFFECTIVE_DATE: project.ownerContractDate || "", AGREEMENT_EFFECTIVE_DATE: project.ownerContractDate || "",
    DOCUMENT_EFFECTIVE_DATE: project.ownerContractDate || "", ORIGINAL_AGREEMENT_DATE: project.ownerContractDate || "",
    EXHIBIT_A_EFFECTIVE_DATE: instrument === "GMP Exhibit A" ? project.ownerContractDate || "" : "",
    CONSTRUCTION_COMMENCEMENT_DATE: project.startDate || "", NOTICE_TO_PROCEED_DATE: project.startDate || "",
    DESIGN_COMMENCEMENT: project.startDate || "", SUBSTANTIAL_COMPLETION_DATE: project.substantialDate || "",
    FINAL_COMPLETION_DATE: project.finalDate || "", SUBSTANTIAL_COMPLETION_DATE_OR_TBD: project.substantialDate || "TBD",
    FINAL_COMPLETION_DATE_OR_TBD: project.finalDate || "TBD",
    CONTRACTOR_AUTHORIZED_REPRESENTATIVE: contractorContact,
    DESIGN_BUILDER_AUTHORIZED_REPRESENTATIVE: contractorContact,
    CONTRACTOR_REPRESENTATIVE_AND_CONTACT: contractorContact,
    DESIGN_BUILDER_REPRESENTATIVE_AND_CONTACT: contractorContact,
    CONTRACTOR_SIGNATORY: actor.name, CONTRACTOR_NOTICE_EMAIL: actor.email,
    DESIGN_BUILDER_SIGNATORY: actor.name, DESIGN_BUILDER_NOTICE_EMAIL: actor.email,
    PROJECT_MANAGER_NAME: project.projectManager || "", PROJECT_MANAGER_NAME_OR_FIRM: project.projectManager || "",
    PROJECT_MANAGER_CONTACT: project.projectManager || "", PROJECT_MANAGER_CONTACT_INCLUDED_SCOPE: project.projectManager || "",
    SUPERINTENDENT_CONTACT_INCLUDED_SCOPE: project.superintendent || "",
    APPROXIMATE_SIZE_AND_CAPACITY: "", DESIGN_MILESTONES_AND_REVIEW_DATES: "",
    OWNER_LENDER_OR_PROGRAM_MANAGER: "", GENERAL_CONDITIONS_INCLUDED_AMOUNT: "", INSURANCE_AND_BONDS_AMOUNT: "",
    ALLOWANCES_AMOUNT: type === "Time & Materials" ? "0.00" : "", DESIGN_BUILDER_CONTINGENCY_AMOUNT: "", OWNER_CONTINGENCY_AMOUNT: "",
    PAYMENT_TERMS: commercial.paymentTerms, REMAINING_PAYMENT_SCHEDULE: commercial.paymentTerms,
    RETAINAGE_TERMS: commercial.retainageTerms, RETAINAGE_TERMS_AND_RELEASE: commercial.retainageTerms,
    CONSTRUCTION_RETAINAGE: commercial.retainageTerms, RETAINAGE_PERCENTAGE: commercial.retainageInitialPercent,
    GOVERNING_LAW_AND_VENUE: projectState === "Kentucky" ? "Kentucky law; Fayette County, Kentucky unless the Project-state addendum requires otherwise." : `${projectState || "Project-state"} law and the venue stated in the approved Project-state addendum.`,
    STATE_ADDENDUM_ID_AND_VERSION: projectState ? `${projectState} Addendum · Counsel-Approved Current Version` : "Project-State Addendum Required",
    PERSONAL_GUARANTY_REQUIRED_YES_OR_NO: "NO", BOND_REQUIREMENTS_OR_NONE: "None unless separately approved in writing",
    PROJECT_SPECIFIC_AMENDMENTS_OR_NONE: "None", LIQUIDATED_DAMAGES_OR_NONE: "None unless separately approved in writing",
    LIQUIDATED_DAMAGES_AMOUNT_SCOPE_CAP_OR_NONE: "None unless separately approved in writing",
    TERMINATION_FEE_OR_NONE: "None unless stated in the executed Project Terms", OWNER_TARGET_BUDGET: amount,
    OWNER_S_TOTAL_PROJECT_BUDGET: amount, OWNER_TOTAL_PROJECT_BUDGET: amount,
    GMP_AMOUNT_OR_TBD: type === "Design-Build GMP" ? "TBD pending executed Exhibit A" : amount,
    GMP_AMOUNT: instrument === "GMP Exhibit A" ? amount : type === "Design-Build GMP" ? "" : amount,
    LUMP_SUM_AMOUNT: amount, LUMP_SUM_CONTRACT_SUM: amount, TOTAL_LUMP_SUM_CONTRACT_SUM_AMOUNT: amount,
    NTE_AMOUNT_OR_NOT_APPLICABLE: type === "Time & Materials" ? amount : "",
    SMALL_PROJECT_PRICING_METHOD: "Time & Materials Not to Exceed",
    SMALL_PROJECT_CONTRACT_AMOUNT: type === "Time & Materials" ? amount : "",
    OWNER_PROPERTY_INTEREST: "owner, lessee, or authorized contracting party",
    ALLOWANCE_SCHEDULE_OR_NONE: "None identified in the current estimate or proposal.",
    CONTRACT_DOCUMENTS_AND_PROPOSALS: "This Contract; the approved scope and exclusions; and signed Change Orders.",
    CONSTRUCTION_EXCLUSIONS: "None stated beyond the Contract Documents.",
    OWNER_MEETING_INTERVAL_DAYS: "7", INVOICE_FREQUENCY: "monthly",
    INITIAL_DEPOSIT_OR_ADVANCE: "0.00", LATE_PAYMENT_INTEREST_PERCENTAGE: "12", STOP_WORK_AFTER_DAYS: "45",
    CONTRACT_TIME_OR_DURATION: project.startDate && project.finalDate ? `${project.startDate} through ${project.finalDate}` : "To be confirmed before release",
    INSPECTION_PERIOD_DAYS: "10", FINAL_PAYMENT_DUE_DAYS: "3",
    ADDITIONAL_FINAL_PAYMENT_CONDITIONS: "the Contract Documents",
    PUBLIC_LIABILITY_INSURANCE_AMOUNT: "2000000.00",
    PERMIT_RESPONSIBILITY: "Contractor will obtain permits specifically assigned to Contractor in the Contract Documents. Owner will provide information, approvals, and fees assigned to Owner.",
    WARRANTY_PERIOD_MONTHS: "12", GOVERNING_LAW: "the laws of the Commonwealth of Kentucky",
    VENUE: "Fayette County, Kentucky", MEDIATION_LOCATION: "the offices of Miller, Edwards, Rambicure, PLLC",
    GUARANTOR_NAME: "",
    ESTIMATED_COST_OF_THE_WORK: amount, PHASE_ONE_DESIGN_AND_PRECONSTRUCTION_FEE: type === "Design-Build GMP" ? "" : amount,
    TOTAL_PHASE_ONE_FEE: type === "Design-Build GMP" ? "" : amount, EXTERNAL_CONTRACT_AMOUNT: type === "External Contract" ? amount : "",
    DESIGN_SERVICES_INCLUDED_OR_EXCLUDED: isDesignBuild ? "INCLUDED" : "EXCLUDED",
    OWNER_DESIGN_PROFESSIONAL_OR_NA: project.architect || "N/A", OWNER_DESIGN_PROFESSIONAL: project.architect || "To be completed",
    OWNER_S_ARCHITECT_ENGINEER: project.architect || "To be completed", ARCHITECT_ENGINEER_AND_CONTACT: project.architect || "To be completed",
    DESIGN_PROFESSIONAL_LEGAL_NAME_LICENSE_AND_STATE: project.architect || "To be completed before release",
    DESIGN_PROFESSIONAL_NAME_LICENSE_AND_STATE: project.architect || "N/A", PROJECT_DOCUMENT_ID: `${project.number}-${template.id}-DRAFT`,
    OWNER_CRITERIA_ID_VERSION_AND_DATE: `${project.number}-OWNER-CRITERIA · Draft`,
    FINAL_OWNER_CRITERIA_ID_VERSION_AND_DATE: `${project.number}-OWNER-CRITERIA · Final approval required`,
    EXTERNAL_CONTRACT_CONTROLS_CONFIRMATION: "", EXTERNAL_CONTRACT_FILE_ID: "", EXTERNAL_CONTRACT_FILE_NAME: "",
  };
  if (type === "Design-Build Lump Sum") {
    common.DESIGN_AND_CONSTRUCTION_SCOPE = "";
    common.DESIGN_DELIVERABLES_AND_CRITERIA = "";
  }
  if (type === "Plan & Spec Lump Sum") {
    common.DRAWING_AND_SPECIFICATION_INDEX = "";
    common.ADDENDA_AND_SUPPLEMENTARY_CONDITIONS = "None identified";
  }
  return withOwnerContractComputedFields(type, synchronizeOwnerContractContactFields(common).fields);
}

export function requiredContractFields(
  type: OwnerContractType,
  instrument: OwnerContractInstrument = defaultContractInstrument(type),
  fields: Record<string, string> = {},
) {
  if (type === "External Contract") return [
    "OWNER_LEGAL_NAME", "PROJECT_NAME", "PROJECT_NUMBER", "PROJECT_SITE_ADDRESS", "EFFECTIVE_DATE",
    "EXTERNAL_CONTRACT_SOURCE_PARTY", "EXTERNAL_CONTRACT_FILE_ID", "EXTERNAL_CONTRACT_FILE_NAME", "EXTERNAL_CONTRACT_FILE_REVISION",
    "EXTERNAL_CONTRACT_CONTROLS_CONFIRMATION", "EXTERNAL_CONTRACT_AMOUNT", "CONSTRUCTION_SCOPE_OF_WORK",
    "CONSTRUCTION_COMMENCEMENT_DATE", "SUBSTANTIAL_COMPLETION_DATE", "FINAL_COMPLETION_DATE", "PAYMENT_TERMS", "RETAINAGE_TERMS",
    "INSURANCE_AND_BOND_REQUIREMENTS", "EXTERNAL_CHANGE_ORDER_PROCEDURE", "NOTICE_REQUIREMENTS_AND_ADDRESSES",
    "EXTERNAL_DISPUTE_AND_TERMINATION_TERMS", "INTERNAL_CONTRACT_REVIEWER_AND_DATE", "CONTRACTOR_SIGNATORY", "CONTRACTOR_SIGNATORY_TITLE",
  ];
  if (type === "Design-Build GMP" && instrument === "GMP Exhibit A") return [
    "ORIGINAL_AGREEMENT_DATE", "EXHIBIT_A_EFFECTIVE_DATE", "OWNER_LEGAL_NAME", "PROJECT_NAME",
    "PROJECT_SITE_ADDRESS", "PROJECT_NUMBER", "GMP_AMOUNT", "SUBSTANTIAL_COMPLETION_DATE", "FINAL_COMPLETION_DATE",
    "GMP_PROPOSAL_DATE", "GMP_EXPIRATION_DATE", "FEE_BASIS", "DESIGN_BUILDER_S_FEE",
    "COST_OF_THE_WORK_SUBTOTAL", "OTHER_ASSUMPTION_OR_CLARIFICATION",
    "EXCLUSION_OR_DEFERRED_SCOPE_1_EXCLUSION_OR_DEFERRED_SCOPE",
    "CONDITIONS_BEFORE_COMMENCEMENT", "CONSTRUCTION_RETAINAGE",
  ];
  if (type === "Design-Build GMP") return [
    "EFFECTIVE_DATE", "OWNER_LEGAL_NAME", "OWNER_ENTITY_AND_STATE", "OWNER_NOTICE_ADDRESS_LINE_1",
    "PROJECT_NAME", "PROJECT_SITE_ADDRESS", "PROJECT_DESCRIPTION", "OWNER_S_TOTAL_PROJECT_BUDGET",
    "PHASE_ONE_DESIGN_AND_PRECONSTRUCTION_FEE", "AMOUNT_DUE_UPON_EXECUTION",
    "PROJECT_PROGRAM_AND_INTENDED_USE", "SCOPE_QUALITY_AND_PERFORMANCE_REQUIREMENTS",
    "DESIGN_MILESTONES_AND_ANTICIPATED_GMP_PROPOSAL_DATE", "OWNER_AUTHORIZED_REPRESENTATIVE",
    "DESIGN_BUILDER_REPRESENTATIVE_AND_CONTACT", "DESIGN_PROFESSIONAL_LEGAL_NAME_LICENSE_AND_STATE",
    "TOTAL_PHASE_ONE_FEE", "REMAINING_PAYMENT_SCHEDULE",
  ];
  if (type === "Design-Build Lump Sum") return [
    "EFFECTIVE_DATE", "OWNER_LEGAL_NAME_AND_STATUS", "OWNER_ADDRESS_REPRESENTATIVE_CONTACT",
    "PROJECT_NAME_AND_ADDRESS", "PROJECT_DESCRIPTION", "LUMP_SUM_CONTRACT_SUM",
    "DESIGN_PRECONSTRUCTION_INCLUDED_AMOUNT", "AMOUNT_DUE_UPON_EXECUTION", "SUBSTANTIAL_COMPLETION_DATE",
    "CONSTRUCTION_SCOPE_OF_WORK", "EXCLUSIONS", "DESIGN_PROFESSIONAL_LEGAL_NAME_LICENSE_AND_STATE",
    "CONDITIONS_BEFORE_CONSTRUCTION_COMMENCEMENT", "CONSTRUCTION_RETAINAGE",
  ];
  if (type === "Plan & Spec Lump Sum") return [
    "EFFECTIVE_DATE", "OWNER_LEGAL_NAME_AND_STATUS", "OWNER_ADDRESS_REPRESENTATIVE_CONTACT",
    "PROJECT_NAME_AND_ADDRESS", "PROJECT_DESCRIPTION", "LUMP_SUM_CONTRACT_SUM", "NOTICE_TO_PROCEED_DATE",
    "SUBSTANTIAL_COMPLETION_DATE", "ARCHITECT_ENGINEER_AND_CONTACT", "CONSTRUCTION_SCOPE_OF_WORK",
    "CONSTRUCTION_EXCLUSIONS", "DRAWING_SET_INDEX_TITLE_IDENTIFIER", "SPECIFICATION_SET_INDEX_TITLE_IDENTIFIER",
    "BID_ASSUMPTIONS_AND_CLARIFICATIONS", "CONSTRUCTION_RETAINAGE",
  ];
  const pricingMethod = normalizeSmallProjectPricingMethod(fields.SMALL_PROJECT_PRICING_METHOD);
  const required = [
    "EFFECTIVE_DATE", "OWNER_LEGAL_NAME", "OWNER_PRIMARY_CONTACT_NAME",
    "OWNER_PRIMARY_CONTACT_EMAIL", "OWNER_PRIMARY_MAILING_ADDRESS_LINE_1", "OWNER_PROPERTY_INTEREST",
    "PROJECT_NAME", "PROJECT_NUMBER", "PROJECT_SITE_ADDRESS", "SMALL_PROJECT_PRICING_METHOD",
    "CONSTRUCTION_SCOPE_OF_WORK", "CONSTRUCTION_EXCLUSIONS", "CONTRACT_DOCUMENTS_AND_PROPOSALS",
    "ALLOWANCE_SCHEDULE_OR_NONE", "ALLOWANCES_AMOUNT", "INVOICE_DELIVERY_METHOD_RECIPIENT",
    "PAYMENT_TERMS", "RETAINAGE_TERMS", "NOTICE_TO_PROCEED_DATE", "CONTRACT_TIME_OR_DURATION",
    "SUBSTANTIAL_COMPLETION_DATE_OR_TBD", "FINAL_COMPLETION_DATE_OR_TBD", "PERMIT_RESPONSIBILITY",
    "PUBLIC_LIABILITY_INSURANCE_AMOUNT", "OWNER_NOTICE_CONTACT", "OWNER_NOTICE_EMAIL",
    "OWNER_NOTICE_ADDRESS_LINE_1", "CONTRACTOR_SIGNATORY", "CONTRACTOR_NOTICE_EMAIL",
    "OWNER_SIGNATORY", "OWNER_SIGNATORY_TITLE", "GOVERNING_LAW", "VENUE", "MEDIATION_LOCATION",
    "PERSONAL_GUARANTY_REQUIRED_YES_OR_NO",
  ];
  if (pricingMethod !== "Time & Materials") required.push("SMALL_PROJECT_CONTRACT_AMOUNT");
  if (pricingMethod !== "Lump Sum") required.push("TIME_AND_MATERIALS_RATE_SCHEDULE", "CONTRACTOR_FEE_PROFIT_PERCENTAGE");
  if (/^(?:yes|y|true|1)$/i.test(String(fields.PERSONAL_GUARANTY_REQUIRED_YES_OR_NO || "").trim())) required.push("GUARANTOR_NAME");
  return required;
}

export function contractAmountField(type: OwnerContractType, instrument: OwnerContractInstrument = defaultContractInstrument(type)) {
  if (type === "Time & Materials") return "SMALL_PROJECT_CONTRACT_AMOUNT";
  if (type === "External Contract") return "EXTERNAL_CONTRACT_AMOUNT";
  if (type === "Design-Build GMP") return instrument === "GMP Exhibit A" ? "GMP_AMOUNT" : "PHASE_ONE_DESIGN_AND_PRECONSTRUCTION_FEE";
  return "LUMP_SUM_CONTRACT_SUM";
}

function inferProjectState(site: string) {
  const value = site.toLowerCase();
  if (value.includes("kentucky") || /\bky\b/.test(value)) return "Kentucky";
  if (value.includes("ohio") || /\boh\b/.test(value)) return "Ohio";
  if (value.includes("indiana") || /\bin\b/.test(value)) return "Indiana";
  if (value.includes("tennessee") || /\btn\b/.test(value)) return "Tennessee";
  return "";
}

function normalizeMoney(value: string) {
  const amount = Number(String(value).replace(/[$,]/g, ""));
  return Number.isFinite(amount) && amount > 0 ? moneyDecimal(amount) : "";
}

function normalizePercent(value: unknown, fallback: number) {
  const amount = Number(String(value ?? "").replace("%", "").trim());
  const bounded = Number.isFinite(amount) ? Math.min(100, Math.max(0, amount)) : fallback;
  return Number.isInteger(bounded) ? String(bounded) : String(Math.round(bounded * 100) / 100);
}
