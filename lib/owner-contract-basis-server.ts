import {
  OWNER_CONTRACT_BASIS_FIELDS,
  OWNER_CONTRACT_BASIS_KINDS,
  isPdfProjectFile,
  ownerContractBasisAttachments,
  withOwnerContractBasisFile,
  type OwnerContractBasisAttachment,
} from "./owner-contract-basis";

type ProjectFileRow = {
  id: number;
  project_id: string;
  name: string;
  category: string;
  revision: string;
  content_type: string;
  size_bytes: number;
};

export async function validateOwnerContractBasisPdfs(
  database: D1Database,
  projectId: string,
  sourceFields: Record<string, string>,
) {
  let fields = { ...sourceFields };
  for (const kind of OWNER_CONTRACT_BASIS_KINDS) {
    const config = OWNER_CONTRACT_BASIS_FIELDS[kind];
    const rawId = String(fields[config.fileId] || "").trim();
    if (!rawId) {
      fields = withOwnerContractBasisFile(fields, kind, null);
      continue;
    }
    if (!/^\d+$/.test(rawId)) throw new Error(`${config.label} Selection Is Invalid`);
    const file = await database.prepare(
      `SELECT id, project_id, name, category, revision, content_type, size_bytes
       FROM project_files WHERE id = ? AND project_id = ? LIMIT 1`,
    ).bind(Number(rawId), projectId).first<ProjectFileRow>();
    if (!file) throw new Error(`${config.label} Must Belong To This Project`);
    if (!isPdfProjectFile({ name: file.name, contentType: file.content_type })) {
      throw new Error(`${config.label} Must Be A PDF`);
    }
    const enteredRevision = String(fields[config.revision] || "").trim();
    fields = withOwnerContractBasisFile(fields, kind, {
      id: file.id,
      name: file.name,
      category: file.category,
      revision: enteredRevision || file.revision || "Not Identified",
      contentType: "application/pdf",
      sizeBytes: file.size_bytes,
    });
  }
  return { fields, attachments: ownerContractBasisAttachments(fields) };
}

export function ownerContractBasisAccessStatements(
  database: D1Database,
  projectId: string,
  attachments: OwnerContractBasisAttachment[],
) {
  return attachments.map((attachment) => database.prepare(
    `UPDATE project_files
     SET access = CASE
       WHEN lower(access) LIKE '%owner%' OR lower(access) LIKE '%client%' THEN access
       WHEN trim(access) = '' THEN 'Project Owner Contract Basis'
       ELSE access || ' · Project Owner Contract Basis'
     END
     WHERE id = ? AND project_id = ?`,
  ).bind(attachment.fileId, projectId));
}
