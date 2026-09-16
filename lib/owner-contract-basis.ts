export const OWNER_CONTRACT_BASIS_KINDS = ["scope", "drawings"] as const;

export type OwnerContractBasisKind = (typeof OWNER_CONTRACT_BASIS_KINDS)[number];

export type OwnerContractBasisFile = {
  id: number;
  name: string;
  category: string;
  revision: string;
  contentType: string;
  sizeBytes?: number;
  size?: string;
};

export type OwnerContractBasisAttachment = {
  kind: OwnerContractBasisKind;
  label: string;
  fileId: number;
  name: string;
  revision: string;
  category: string;
  contentType: string;
  sizeBytes: number;
};

type BasisFieldConfig = {
  label: string;
  fileId: string;
  name: string;
  revision: string;
  category: string;
  contentType: string;
  sizeBytes: string;
};

export const OWNER_CONTRACT_BASIS_FIELDS: Record<OwnerContractBasisKind, BasisFieldConfig> = {
  scope: {
    label: "Scope PDF",
    fileId: "CONTRACT_BASIS_SCOPE_PDF_FILE_ID",
    name: "CONTRACT_BASIS_SCOPE_PDF_NAME",
    revision: "CONTRACT_BASIS_SCOPE_PDF_REVISION",
    category: "CONTRACT_BASIS_SCOPE_PDF_CATEGORY",
    contentType: "CONTRACT_BASIS_SCOPE_PDF_CONTENT_TYPE",
    sizeBytes: "CONTRACT_BASIS_SCOPE_PDF_SIZE_BYTES",
  },
  drawings: {
    label: "Drawing PDF",
    fileId: "CONTRACT_BASIS_DRAWINGS_PDF_FILE_ID",
    name: "CONTRACT_BASIS_DRAWINGS_PDF_NAME",
    revision: "CONTRACT_BASIS_DRAWINGS_PDF_REVISION",
    category: "CONTRACT_BASIS_DRAWINGS_PDF_CATEGORY",
    contentType: "CONTRACT_BASIS_DRAWINGS_PDF_CONTENT_TYPE",
    sizeBytes: "CONTRACT_BASIS_DRAWINGS_PDF_SIZE_BYTES",
  },
};

const basisFieldKeys = new Set(
  Object.values(OWNER_CONTRACT_BASIS_FIELDS).flatMap((config) => [
    config.fileId,
    config.name,
    config.revision,
    config.category,
    config.contentType,
    config.sizeBytes,
  ]),
);

export function isOwnerContractBasisField(field: string) {
  return basisFieldKeys.has(field);
}

export function isPdfProjectFile(file: Pick<OwnerContractBasisFile, "name" | "contentType">) {
  return file.contentType.toLowerCase() === "application/pdf" || /\.pdf$/i.test(file.name);
}

export function ownerContractBasisAttachments(fields: Record<string, unknown>) {
  return OWNER_CONTRACT_BASIS_KINDS.flatMap((kind) => {
    const config = OWNER_CONTRACT_BASIS_FIELDS[kind];
    const fileId = Number(String(fields[config.fileId] || ""));
    const name = String(fields[config.name] || "").trim();
    if (!Number.isInteger(fileId) || fileId < 1 || !name) return [];
    return [{
      kind,
      label: config.label,
      fileId,
      name,
      revision: String(fields[config.revision] || "").trim() || "Not Identified",
      category: String(fields[config.category] || "").trim(),
      contentType: String(fields[config.contentType] || "application/pdf").trim(),
      sizeBytes: Math.max(0, Number(String(fields[config.sizeBytes] || "0")) || 0),
    } satisfies OwnerContractBasisAttachment];
  });
}

export function withOwnerContractBasisFile(
  fields: Record<string, string>,
  kind: OwnerContractBasisKind,
  file: OwnerContractBasisFile | null,
) {
  const next = { ...fields };
  const config = OWNER_CONTRACT_BASIS_FIELDS[kind];
  if (!file) {
    for (const key of [config.fileId, config.name, config.revision, config.category, config.contentType, config.sizeBytes]) delete next[key];
    return next;
  }
  next[config.fileId] = String(file.id);
  next[config.name] = file.name;
  next[config.revision] = file.revision || next[config.revision] || "Not Identified";
  next[config.category] = file.category;
  next[config.contentType] = file.contentType || "application/pdf";
  next[config.sizeBytes] = String(file.sizeBytes || "");
  return next;
}

export function withOwnerContractBasisRevision(
  fields: Record<string, string>,
  kind: OwnerContractBasisKind,
  revision: string,
) {
  return { ...fields, [OWNER_CONTRACT_BASIS_FIELDS[kind].revision]: revision };
}
