// Versioned assets come from the locked dependencies and are served by this Site.
export const OCR_ASSET_PATH = "/ocr/tesseract-6.0.1-core-6.1.2-eng-1.0.0";

export function browserOcrOptions(origin: string) {
  const base = new URL(`${OCR_ASSET_PATH}/`, origin).href;
  return { workerPath: `${base}worker.min.js`, corePath: base, langPath: base, workerBlobURL: false, gzip: true };
}
