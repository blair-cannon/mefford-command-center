export const LIEN_WAIVER_CONTROL_TYPE = "Lien Waiver Project Control";
export const LIEN_WAIVER_RECORD_TYPE = "Lien Waiver";

export const LIEN_WAIVER_JURISDICTIONS = ["KY", "IN", "WV", "TN", "MN", "IL"] as const;
export type LienWaiverJurisdiction = (typeof LIEN_WAIVER_JURISDICTIONS)[number];

export const LIEN_WAIVER_PROJECT_CLASSES = ["Private", "Public / Bonded"] as const;
export type LienWaiverProjectClass = (typeof LIEN_WAIVER_PROJECT_CLASSES)[number];

export const LIEN_WAIVER_TYPES = [
  "conditional-progress",
  "unconditional-progress",
  "conditional-final",
  "unconditional-final",
] as const;
export type LienWaiverType = (typeof LIEN_WAIVER_TYPES)[number];

export type LienWaiverRule = {
  state: LienWaiverJurisdiction;
  name: string;
  authority: string;
  authorityUrl: string;
  control: string;
  companionRequirement: string;
  counselNote: string;
};

export const LIEN_WAIVER_RULES: Record<LienWaiverJurisdiction, LienWaiverRule> = {
  KY: {
    state: "KY",
    name: "Kentucky",
    authority: "KRS 376.070(3)",
    authorityUrl: "https://apps.legislature.ky.gov/law/statutes/statute.aspx?id=35287",
    control: "Use a written payment-specific waiver. Preserve the payment amount, through-date, retainage, and listed exceptions.",
    companionRequirement: "Confirm lower-tier claimants and prior payments before final release.",
    counselNote: "Kentucky recognizes written waivers in this payment context; no Command Center form becomes an advance contract waiver.",
  },
  IN: {
    state: "IN",
    name: "Indiana",
    authority: "IC 32-28-3-16",
    authorityUrl: "https://iga.in.gov/laws/2025/ic/titles/32",
    control: "Never use an unconditional waiver before collected payment. Confirm whether the Class 2 structure or utility exceptions apply.",
    companionRequirement: "Project classification review is required before the first waiver is issued.",
    counselNote: "Indiana voids many contract provisions that require lien or payment-bond rights to be waived before payment and also restricts agreements not to file a lien notice.",
  },
  WV: {
    state: "WV",
    name: "West Virginia",
    authority: "W. Va. Code §38-2-21",
    authorityUrl: "https://code.wvlegislature.gov/38-2-21/",
    control: "Track every lower-tier claimant. Owner payment generally does not eliminate subcontractor, laborer, or supplier lien rights.",
    companionRequirement: "Collect and reconcile lower-tier waivers and supplier exceptions with every applicable draw.",
    counselNote: "The waiver register must not treat payment to an upstream contractor as proof that lower tiers were paid.",
  },
  TN: {
    state: "TN",
    name: "Tennessee",
    authority: "Tenn. Code Ann. §66-11-124",
    authorityUrl: "https://codes.findlaw.com/tn/title-66-property/tn-code-sect-66-11-124/",
    control: "Keep lien releases separate from the governing contract and tie each release to furnished work and a specific payment.",
    companionRequirement: "Scan contracts for prohibited advance-waiver language and branch public work to payment-bond claims.",
    counselNote: "Tennessee declares contract provisions purporting to waive lien rights void and against public policy.",
  },
  MN: {
    state: "MN",
    name: "Minnesota",
    authority: "Minn. Stat. §337.10, subd. 2",
    authorityUrl: "https://www.revisor.mn.gov/statutes/cite/337.10",
    control: "Unconditional waivers require recorded cleared payment; a conditional form remains conditional until the stated funds are received.",
    companionRequirement: "Preserve payment evidence and retainage separately; flag potential third-party reliance before correction.",
    counselNote: "Minnesota voids contract provisions requiring lien or payment-bond claim waiver before payment, subject to its third-party reliance language.",
  },
  IL: {
    state: "IL",
    name: "Illinois",
    authority: "770 ILCS 60/1 and 770 ILCS 60/5",
    authorityUrl: "https://www.ilga.gov/ftp/ILCS/Ch%200770/Act%200060/077000600K1.html",
    control: "Never place an advance waiver in an award contract. Tie each waiver to the stated dollar amount, through-date, and payment status.",
    companionRequirement: "Route the applicable sworn contractor statement or affidavit and lower-tier schedule with owner-payment review.",
    counselNote: "Illinois makes award-stage waivers unenforceable and separately requires sworn payment information in specified owner-payment situations.",
  },
};

export const LIEN_WAIVER_FORM_LABELS: Record<LienWaiverType, string> = {
  "conditional-progress": "Conditional Waiver And Release On Progress Payment",
  "unconditional-progress": "Unconditional Waiver And Release On Progress Payment",
  "conditional-final": "Conditional Waiver And Release On Final Payment",
  "unconditional-final": "Unconditional Waiver And Release On Final Payment",
};

export function isLienWaiverJurisdiction(value: unknown): value is LienWaiverJurisdiction {
  return LIEN_WAIVER_JURISDICTIONS.includes(String(value).toUpperCase() as LienWaiverJurisdiction);
}

export function isLienWaiverProjectClass(value: unknown): value is LienWaiverProjectClass {
  return LIEN_WAIVER_PROJECT_CLASSES.includes(String(value) as LienWaiverProjectClass);
}

export function isLienWaiverType(value: unknown): value is LienWaiverType {
  return LIEN_WAIVER_TYPES.includes(String(value) as LienWaiverType);
}

export function unconditionalTypeFor(type: LienWaiverType): LienWaiverType {
  return type === "conditional-final" || type === "unconditional-final"
    ? "unconditional-final"
    : "unconditional-progress";
}

export function isConditionalWaiver(type: LienWaiverType) {
  return type.startsWith("conditional-");
}

export function isFinalWaiver(type: LienWaiverType) {
  return type.endsWith("-final");
}

export function waiverReleaseSubject(projectClass: LienWaiverProjectClass) {
  return projectClass === "Public / Bonded"
    ? "payment-bond and related payment claims"
    : "mechanic's lien and related payment-bond claims";
}

export function canIssueUnconditionalWaiver(input: { clearedPaymentAt?: string; clearedPaymentReference?: string }) {
  return Boolean(input.clearedPaymentAt?.trim() && input.clearedPaymentReference?.trim());
}

export function waiverPaymentGate(status: string, ownerOverride?: unknown) {
  return status === "Approved — Payment May Proceed" || Boolean(ownerOverride);
}

export function waiverDocumentCopy(input: {
  type: LienWaiverType;
  projectClass: LienWaiverProjectClass;
  amount: number;
  throughDate: string;
  paymentReference?: string;
}) {
  const subject = waiverReleaseSubject(input.projectClass);
  const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(input.amount);
  const final = isFinalWaiver(input.type);
  if (isConditionalWaiver(input.type)) {
    return `This waiver becomes effective only when the undersigned actually receives collected funds in the amount of ${amount} for the payment identified below. When effective, the undersigned releases ${subject} for labor, services, equipment, and materials furnished through ${input.throughDate}${final ? " and through completion of the undersigned's contracted scope" : ""}, except retainage and the claims expressly listed in this document.`;
  }
  return `The undersigned acknowledges actual receipt of collected funds in the amount of ${amount}${input.paymentReference ? ` under payment reference ${input.paymentReference}` : ""}. The undersigned therefore releases ${subject} for labor, services, equipment, and materials furnished through ${input.throughDate}${final ? " and through completion of the undersigned's contracted scope" : ""}, except only the claims expressly listed in this document.`;
}
