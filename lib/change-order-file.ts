export const CHANGE_FILE_CATEGORIES = ["Requests", "RFIs & Submittals", "Drawings", "Photos & Field Records", "Pricing", "Approvals", "Executed Documents", "Other"] as const;
export type ChangeFileCategory = typeof CHANGE_FILE_CATEGORIES[number];
export type ChangeFileDocument = { id: number; name: string; category: string; revision: string; uploadedBy: string; createdAt: string; sizeBytes?: number; access?: string; available?: boolean };
export type ChangeFileEntry = {
  id: string; recordId: string; kind: string; category: string; title: string; note: string;
  actorName: string; actorEmail: string; createdAt: string;
  snapshot: { files?: ChangeFileDocument[]; source?: Record<string, unknown>; before?: unknown; after?: unknown; [key: string]: unknown };
};
export type ChangeFileCase = {
  rootId: string; records: Array<{ id: string; title: string; status: string }>;
  entries: ChangeFileEntry[]; files: ChangeFileDocument[];
  sources: Array<{ id: string; title: string; type: string; status: string }>;
  canManage: boolean;
};

export function changeFileRoot(record: { id: string; data?: Record<string, unknown> }) {
  return record.id.startsWith("PCO-") ? record.id : String(record.data?.originPco || record.id);
}

export function fileBelongsToChange(file: Pick<ChangeFileDocument, "category" | "revision">, rootId: string, recordIds: string[]) {
  return file.category.startsWith(`Change Orders / ${rootId} / `) ||
    recordIds.some(id => file.revision === `${id} Supporting File` || file.revision === `${id} Executed Supporting File` || file.revision.startsWith(`${id} · `));
}
