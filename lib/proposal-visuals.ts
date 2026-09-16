import type { ProposalVisual } from "./proposals";

export type ProposalVisualAsset = ProposalVisual & { bytes: Uint8Array };

export function proposalPageIndexes(selection: string, pageCount: number, maximum = 30) {
  if (!Number.isInteger(pageCount) || pageCount <= 0) throw new Error("The selected drawing PDF has no importable pages.");
  const requested = selection.trim();
  const indexes: number[] = [];
  if (!requested || /^all$/i.test(requested)) {
    for (let index = 0; index < Math.min(pageCount, maximum); index += 1) indexes.push(index);
    if (pageCount > maximum) throw new Error(`Select no more than ${maximum} drawing pages for one proposal packet.`);
    return indexes;
  }
  if (!/^\d+(?:-\d+)?(?:\s*,\s*\d+(?:-\d+)?)*$/.test(requested)) {
    throw new Error("Drawing pages must be All or a list such as 1-3, 7.");
  }
  for (const part of requested.split(",").map((value) => value.trim())) {
    const [startText, endText] = part.split("-");
    const start = Number(startText);
    const end = Number(endText || startText);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > pageCount) {
      throw new Error(`Drawing page selection ${part} is outside the PDF's ${pageCount} pages.`);
    }
    for (let page = start; page <= end; page += 1) {
      if (!indexes.includes(page - 1)) indexes.push(page - 1);
      if (indexes.length > maximum) throw new Error(`Select no more than ${maximum} drawing pages for one proposal packet.`);
    }
  }
  return indexes;
}

