import { browserOcrOptions } from "./ocr-assets";
import { boundedOcrScale, mergeRecognizedPage, needsPageOcr } from "./ocr-document";

export type MobileOcrProgress = { percent: number; label: string };

export async function recognizeMobileDocument(file: File, onProgress?: (progress: MobileOcrProgress) => void) {
  if (file.size > 25 * 1024 * 1024) throw new Error("OCR supports files up to 25 MB. Review the original manually or upload a smaller copy.");
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return recognizePdf(file, onProgress);
  const recognize = await imageReader(onProgress);
  try {
    const text = await recognize.read(file);
    if (!text.trim()) throw new Error("No readable text was found. Review the original and enter its details manually.");
    onProgress?.({ percent: 100, label: "OCR text ready for review" });
    return `--- IMAGE 1 ---\n${text}`;
  } finally { await recognize.close(); }
}

async function recognizePdf(file: File, onProgress?: (progress: MobileOcrProgress) => void) {
  onProgress?.({ percent: 2, label: "Opening PDF" });
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() });
  let reader: Awaited<ReturnType<typeof imageReader>> | undefined;
  let pageNumber = 1;
  try {
    const pdf = await loadingTask.promise;
    const sections: string[] = [];
    const rasterOps = new Set([pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageMaskXObject, pdfjs.OPS.paintImageXObjectRepeat, pdfjs.OPS.paintInlineImageXObjectGroup]);
    for (; pageNumber <= pdf.numPages; pageNumber++) {
      const progress = (percent: number, label: string) => onProgress?.({ percent: Math.min(98, Math.round(3 + ((pageNumber - 1 + percent / 100) / pdf.numPages) * 95)), label: `${label} · page ${pageNumber} of ${pdf.numPages}` });
      progress(0, "Reading PDF");
      const page = await pdf.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const embedded = content.items.map(item => "str" in item ? `${String(item.str)}${item.hasEOL ? "\n" : " "}` : "").join("").replace(/[\t ]+/g, " ").trim();
        const operators = await page.getOperatorList();
        let visual = "";
        if (needsPageOcr(embedded, operators.fnArray.some(op => rasterOps.has(op)))) {
          if (!reader) reader = await imageReader(value => progress(value.percent, value.label));
          const normal = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: boundedOcrScale(normal.width, normal.height) });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          try {
            const context = canvas.getContext("2d", { willReadFrequently: true });
            if (!context) throw new Error("This browser could not prepare the scanned page.");
            await page.render({ canvas, canvasContext: context, viewport }).promise;
            const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
            if (!blob) throw new Error("The scanned page could not be read.");
            visual = await reader.read(blob);
          } finally { canvas.width = 0; canvas.height = 0; }
        }
        sections.push(mergeRecognizedPage(embedded, visual, pageNumber));
      } finally { page.cleanup(); }
    }
    onProgress?.({ percent: 100, label: `All ${pdf.numPages} PDF pages ready for review` });
    return sections.join("\n\n").trim();
  } catch (error) {
    throw new Error(`PDF page ${pageNumber} could not be fully read. Review the original before entering its price and scope. ${error instanceof Error ? error.message : ""}`);
  } finally { try { await reader?.close(); } finally { await loadingTask.destroy(); } }
}

async function imageReader(onProgress?: (progress: MobileOcrProgress) => void) {
  onProgress?.({ percent: 3, label: "Loading on-device OCR" });
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    ...browserOcrOptions(window.location.origin),
    logger: message => onProgress?.({ percent: Math.max(3, Math.min(98, Math.round(Number(message.progress || 0) * 100))), label: String(message.status || "Reading text").replace(/_/g, " ") }),
  });
  return { read: async (file: Blob) => (await worker.recognize(file)).data.text.trim(), close: () => worker.terminate() };
}
