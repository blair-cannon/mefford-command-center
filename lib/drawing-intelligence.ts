export type DrawingMetadata = {
  sheetNumber: string;
  sheetTitle: string;
  discipline: string;
  revision: string;
  revisionDate: string;
  detectedPages: number;
  confidence: number;
  needsReview: boolean;
};

const disciplineByPrefix: Record<string, string> = {
  A: "Architectural", C: "Civil", E: "Electrical", FP: "Fire Protection",
  G: "General", L: "Landscape", M: "Mechanical", P: "Plumbing",
  S: "Structural", T: "Technology", ID: "Interior Design",
};

export function extractDrawingMetadata(text: string, fileName = "", suppliedRevision = ""): DrawingMetadata {
  const normalized = String(text || "").replace(/\r/g, "\n").replace(/[ \t]+/g, " ");
  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  const sheetPattern = /\b((?:FP|ID|[ACEGLMPST])[-.]?\d{1,3}(?:[.-]\d{1,3})?)\b/i;
  const sheetMatch = lines.map((line) => line.match(sheetPattern)).find(Boolean) || fileName.match(sheetPattern);
  const sheetNumber = String(sheetMatch?.[1] || "").toUpperCase().replace(/\s/g, "");
  const prefix = sheetNumber.match(/^[A-Z]+/)?.[0] || "";
  const revisionMatch = normalized.match(/\b(?:REV(?:ISION)?|ISSUE)\s*(?:NO\.?|#|:)?\s*([A-Z0-9.-]{1,12})\b/i);
  const dateMatches = [...normalized.matchAll(/\b(20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[/-]\d{1,2}[/-](?:20)?\d{2})\b/g)].map((match) => match[1]);
  const numberLine = sheetNumber ? lines.findIndex((line) => line.toUpperCase().includes(sheetNumber)) : -1;
  const titleCandidates = lines.slice(Math.max(0, numberLine - 4), numberLine < 0 ? 12 : numberLine + 5)
    .filter((line) => line.length >= 4 && line.length <= 90 && !sheetPattern.test(line) && !/^(date|scale|drawn|checked|project|revision|sheet)\b/i.test(line));
  const sheetTitle = titleCandidates.sort((a, b) => b.length - a.length)[0] || "";
  const detectedPages = Math.max(
    [...normalized.matchAll(/--- PAGE \d+/g)].length,
    [...normalized.matchAll(/--- IMAGE \d+/g)].length,
    normalized.trim() ? 1 : 0,
  );
  const signals = [sheetNumber, sheetTitle, disciplineByPrefix[prefix], revisionMatch?.[1] || suppliedRevision, dateMatches.at(-1), normalized.length > 120 ? "text" : ""].filter(Boolean).length;
  const confidence = Math.min(99, Math.round((signals / 6) * 100));
  return {
    sheetNumber,
    sheetTitle,
    discipline: disciplineByPrefix[prefix] || "Unclassified",
    revision: String(revisionMatch?.[1] || suppliedRevision || "").trim(),
    revisionDate: normalizeDate(dateMatches.at(-1) || ""),
    detectedPages,
    confidence,
    needsReview: !sheetNumber || confidence < 67,
  };
}

export function extractDrawingSheets(text: string, fileName = "", suppliedRevision = "") {
  const sections = String(text || "").split(/(?=--- (?:PAGE|IMAGE) \d+)/).filter((section) => section.trim());
  const source = sections.length ? sections : [text];
  return source.map((section, index) => ({
    page: Number(section.match(/--- (?:PAGE|IMAGE) (\d+)/)?.[1] || index + 1),
    ...extractDrawingMetadata(section, fileName, suppliedRevision),
  }));
}

function normalizeDate(value: string) {
  if (!value) return "";
  const parts = value.split(/[/-]/).map(Number);
  if (parts[0] > 1900) return `${parts[0]}-${String(parts[1]).padStart(2, "0")}-${String(parts[2]).padStart(2, "0")}`;
  const year = parts[2] < 100 ? 2000 + parts[2] : parts[2];
  return `${year}-${String(parts[0]).padStart(2, "0")}-${String(parts[1]).padStart(2, "0")}`;
}
