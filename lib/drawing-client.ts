import { extractDrawingSheets } from "./drawing-intelligence";
import { isPdfOrPhotoUpload } from "./photo-uploads";

export type IndexedDrawingFile = { id?: number; name: string };

export async function indexDrawingUpload(
  sourceFile: File,
  storedFile: IndexedDrawingFile,
  projectId: string,
  category: string,
  revision: string,
  onProgress?: (percent: number, label: string) => void,
) {
  if (!storedFile.id || !isDrawingCategory(category)) return null;
  let ocrText = "";
  let ocrStatus = "Indexed From File Metadata";
  const supported = isPdfOrPhotoUpload(sourceFile);
  if (supported) {
    try {
      const { recognizeMobileDocument } = await import("./mobile-ocr");
      ocrText = await recognizeMobileDocument(sourceFile, (progress) => onProgress?.(progress.percent, progress.label));
      ocrStatus = ocrText ? "OCR Complete - Human Review Available" : "OCR Completed Without Detectable Text";
    } catch (error) {
      ocrStatus = `OCR Review Required - ${error instanceof Error ? error.message : "Text Could Not Be Read"}`;
    }
  } else {
    ocrStatus = "OCR Review Required - Unsupported Drawing Format";
  }
  const response = await fetch("/api/drawing-intelligence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId,
      fileId: storedFile.id,
      fileName: storedFile.name,
      category,
      suppliedRevision: revision,
      ocrText,
      ocrStatus,
      sheets: extractDrawingSheets(ocrText, storedFile.name, revision),
    }),
  });
  const result = await response.json() as { indexed?: boolean; error?: string };
  if (!response.ok) throw new Error(result.error || `${storedFile.name} Could Not Be Added To The Drawing Index`);
  return result;
}

export function isDrawingCategory(category: string) {
  return /drawing|floor plan|rendering|design/i.test(category);
}
