/**
 * Prepares the static tesseract.js OCR assets (worker script, wasm core, and
 * English trained data) so they can be served as static files under
 * `public/ocr/...`. The target path must match `OCR_ASSET_PATH` in
 * `lib/ocr-assets.ts`, which is derived from the locked dependency versions:
 * tesseract.js, tesseract.js-core, and @tesseract.js-data/eng.
 *
 * Reconstructed after the original file was missing from the exported
 * project (see repo history) — regenerated from the locked package
 * versions in package-lock.json rather than recovered verbatim.
 */
import { mkdir, copyFile, readFile, writeFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const TESSERACT_JS_VERSION = "6.0.1";
const TESSERACT_CORE_VERSION = "6.1.2";
const ENG_DATA_VERSION = "1.0.0";

const OCR_ASSET_DIR_NAME = `tesseract-${TESSERACT_JS_VERSION}-core-${TESSERACT_CORE_VERSION}-eng-${ENG_DATA_VERSION}`;

// This app always calls createWorker("eng", 1, ...) (OEM.LSTM_ONLY), so
// tesseract.js's browser getCore() only ever resolves to the "lstm" or
// "simd-lstm" wasm.js core (never the legacy non-LSTM cores). We ship both
// LSTM variants in full (asm.js + wasm + wasm.js) so both SIMD-capable and
// non-SIMD browsers work, plus the worker script and the English language
// data — exactly 8 files, matching scripts/verify-ocr-assets.mjs's
// requirement of 8 manifest-listed assets.
const CORE_FILES = [
  "tesseract-core-lstm.js",
  "tesseract-core-lstm.wasm",
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-simd-lstm.js",
  "tesseract-core-simd-lstm.wasm",
  "tesseract-core-simd-lstm.wasm.js",
];

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

// Returns the prepared assets directory's absolute path, so callers can use
// it directly as tesseract.js's `langPath` (and, in the browser, the
// equivalent public URL — see lib/ocr-assets.ts's OCR_ASSET_PATH). This
// matters: passing an undefined langPath makes tesseract.js silently fall
// back to fetching its default assets from a remote CDN, which is both a
// network dependency this app shouldn't have at runtime and how a call site
// (tests/scanned-quotes.integration.test.mjs) that relies on this return
// value ends up making an unwanted network call if it's missing.
export async function prepareOcrAssets(cwd: string): Promise<string> {
  const targetDir = path.join(cwd, "public", "ocr", OCR_ASSET_DIR_NAME);
  const manifestPath = path.join(targetDir, "manifest.json");

  if (await exists(manifestPath)) {
    return targetDir;
  }

  await mkdir(targetDir, { recursive: true });

  const tesseractJsDist = path.join(cwd, "node_modules", "tesseract.js", "dist");
  const corePkgDir = path.join(cwd, "node_modules", "tesseract.js-core");
  const engDataDir = path.join(cwd, "node_modules", "@tesseract.js-data", "eng", "4.0.0");

  const copies: Array<[string, string]> = [
    [path.join(tesseractJsDist, "worker.min.js"), "worker.min.js"],
    [path.join(engDataDir, "eng.traineddata.gz"), "eng.traineddata.gz"],
    ...CORE_FILES.map((name): [string, string] => [path.join(corePkgDir, name), name]),
  ];

  for (const [src, name] of copies) {
    await copyFile(src, path.join(targetDir, name));
  }

  const assets = [];
  for (const [, name] of copies) {
    const bytes = await readFile(path.join(targetDir, name));
    assets.push({
      name,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }

  await writeFile(manifestPath, JSON.stringify({ assets }, null, 2));

  return targetDir;
}
