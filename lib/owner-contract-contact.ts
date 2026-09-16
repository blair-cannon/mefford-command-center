import type { OwnerContractPrefillContact } from "./owner-contract-prefill";

const SALES_PROJECT_ID = "MEFFORD-SALES";
const CONTACT_RECORD_TYPE = "Sales Contacts";

type SalesContactRow = {
  id: string;
  title: string;
  status?: string;
  data_json: string;
  updated_at?: string;
};

export type OwnerContractContactMatchBasis =
  | "contact-id"
  | "email"
  | "phone"
  | "name-and-company"
  | "contact-name"
  | "company";

export type OwnerContractContactReference = {
  contactId?: unknown;
  contactName?: unknown;
  company?: unknown;
  email?: unknown;
  phone?: unknown;
};

export type LinkedOwnerContractContact = {
  recordId: string;
  contact: OwnerContractPrefillContact;
  matchBasis: OwnerContractContactMatchBasis;
  active?: boolean;
  updatedAt?: string;
};

export function ownerContractContactReference(...values: unknown[]): OwnerContractContactReference {
  const sources = values.map(parseObject);
  const firstField = (keys: string[]) => {
    for (const source of sources) {
      for (const key of keys) {
        const value = text(source[key]);
        if (value) return value;
      }
    }
    return "";
  };
  return {
    contactId: firstField(["contactId", "ownerContactRecordId", "sourceContactRecordId"]),
    contactName: firstField(["contactName", "ownerContactName", "projectOwnerContactName"]),
    company: firstField(["company", "ownerName", "owner_name"]),
    email: firstField(["contactEmail", "ownerContactEmail", "projectOwnerContactEmail"]),
    phone: firstField(["contactPhone", "ownerContactPhone", "projectOwnerContactPhone"]),
  };
}

export async function loadLinkedOwnerContractContact(
  database: D1Database,
  contactIdValue: unknown,
): Promise<LinkedOwnerContractContact | null> {
  const contactId = String(contactIdValue || "").trim();
  if (!contactId) return null;
  const row = await database.prepare(
    `SELECT id, title, status, data_json, updated_at
     FROM command_records
     WHERE project_id = ? AND id = ? AND record_type = ?
     LIMIT 1`,
  ).bind(SALES_PROJECT_ID, contactId, CONTACT_RECORD_TYPE).first<SalesContactRow>();
  if (!row) return null;
  return contactFromRow(row, "contact-id");
}

/**
 * Resolves legacy and estimate-originated opportunities that contain useful CRM
 * identity data but no contact id. Fallbacks are deliberately exact and only
 * choose a unique contact, so a same-company match cannot silently select the
 * wrong person when multiple contacts exist.
 */
export async function resolveOwnerContractContact(
  database: D1Database,
  reference: OwnerContractContactReference,
): Promise<LinkedOwnerContractContact | null> {
  const linked = await loadLinkedOwnerContractContact(database, reference.contactId);
  if (linked) return linked;

  const rows = await database.prepare(
    `SELECT id, title, status, data_json, updated_at
     FROM command_records
     WHERE project_id = ? AND record_type = ?
     ORDER BY updated_at DESC, id ASC
     LIMIT 1000`,
  ).bind(SALES_PROJECT_ID, CONTACT_RECORD_TYPE).all<SalesContactRow>();
  const candidates = (rows.results || []).map((row) => contactFromRow(row, "company"));
  return selectOwnerContractContact(candidates, reference);
}

export function selectOwnerContractContact(
  candidates: LinkedOwnerContractContact[],
  reference: OwnerContractContactReference,
): LinkedOwnerContractContact | null {
  const contactId = text(reference.contactId);
  if (contactId) {
    const candidate = candidates.find((item) => item.recordId === contactId);
    if (candidate) return matched(candidate, "contact-id");
  }

  const email = normalizeEmail(reference.email);
  if (email) {
    const candidate = uniquePreferred(candidates.filter((item) => normalizeEmail(item.contact.email) === email));
    if (candidate) return matched(candidate, "email");
  }

  const phone = normalizePhone(reference.phone);
  if (phone.length >= 7) {
    const candidate = uniquePreferred(candidates.filter((item) => normalizePhone(item.contact.phone) === phone));
    if (candidate) return matched(candidate, "phone");
  }

  const contactName = normalizeWords(reference.contactName);
  const company = normalizeCompany(reference.company);
  if (contactName && company) {
    const candidate = uniquePreferred(candidates.filter((item) =>
      normalizeWords(item.contact.name) === contactName && normalizeCompany(item.contact.company) === company,
    ));
    if (candidate) return matched(candidate, "name-and-company");
  }

  if (contactName) {
    const candidate = uniquePreferred(candidates.filter((item) => normalizeWords(item.contact.name) === contactName));
    if (candidate) return matched(candidate, "contact-name");
  }

  if (company) {
    const candidate = uniquePreferred(candidates.filter((item) => normalizeCompany(item.contact.company) === company));
    if (candidate) return matched(candidate, "company");
  }

  return null;
}

export function normalizeOwnerContractCompany(value: unknown) {
  const words = normalizeWords(value).split(" ").filter(Boolean);
  const legalSuffixes = new Set(["co", "company", "corp", "corporation", "inc", "incorporated", "llc", "llp", "lp", "ltd", "limited"]);
  while (words.length > 1 && legalSuffixes.has(words.at(-1) || "")) words.pop();
  return words.join(" ");
}

function contactFromRow(row: SalesContactRow, matchBasis: OwnerContractContactMatchBasis): LinkedOwnerContractContact {
  const data = parseObject(row.data_json);
  const firstName = String(data.firstName || "").trim();
  const lastName = String(data.lastName || "").trim();
  return {
    recordId: row.id,
    matchBasis,
    active: !/inactive|archived|deleted/i.test(`${row.status || ""} ${String(data.relationshipStatus || "")}`),
    updatedAt: row.updated_at || "",
    contact: {
      name: row.title.trim() || [firstName, lastName].filter(Boolean).join(" "),
      firstName,
      lastName,
      company: String(data.company || "").trim(),
      jobTitle: String(data.jobTitle || "").trim(),
      email: String(data.email || "").trim(),
      phone: String(data.phone || "").trim(),
      address: String(data.address || "").trim(),
      addressLine1: String(data.addressLine1 || "").trim(),
      addressLine2: String(data.addressLine2 || "").trim(),
      city: String(data.city || "").trim(),
      state: String(data.state || "").trim(),
      postalCode: String(data.postalCode || "").trim(),
    },
  };
}

function uniquePreferred(candidates: LinkedOwnerContractContact[]) {
  if (!candidates.length) return null;
  const active = candidates.filter((candidate) => candidate.active !== false);
  const preferred = active.length ? active : candidates;
  return preferred.length === 1 ? preferred[0] : null;
}

function matched(candidate: LinkedOwnerContractContact, matchBasis: OwnerContractContactMatchBasis) {
  return { ...candidate, matchBasis };
}

function normalizeEmail(value: unknown) {
  return text(value).toLowerCase();
}

function normalizePhone(value: unknown) {
  const digits = text(value).replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

function normalizeWords(value: unknown) {
  return text(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeCompany(value: unknown) {
  return normalizeOwnerContractCompany(value);
}

function text(value: unknown) {
  return String(value || "").trim();
}

function parseObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
