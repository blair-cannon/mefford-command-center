import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PDF_AND_PHOTO_UPLOAD_ACCEPT,
  PHOTO_UPLOAD_ACCEPT,
  VIDEO_UPLOAD_ACCEPT,
  isPdfOrPhotoUpload,
  isPhotoUpload,
  isVideoUpload,
  normalizeUploadContentType,
  normalizePhotoContentType,
  storedFileResponseHeaders,
} from "../lib/photo-uploads.ts";

test("photo picker contract includes phone, web, legacy, and camera raw formats", () => {
  for (const extension of [".jpg", ".png", ".gif", ".webp", ".heic", ".heif", ".avif", ".bmp", ".tif", ".tiff", ".svg", ".svgz", ".ico", ".jp2", ".jxl", ".psd", ".raw", ".dng", ".cr2", ".cr3", ".nef", ".arw", ".rw2", ".orf", ".raf"]) {
    assert.match(PHOTO_UPLOAD_ACCEPT, new RegExp(`(?:^|,)\\${extension}(?:,|$)`), extension);
  }
  assert.match(PHOTO_UPLOAD_ACCEPT, /image\/\*/);
  assert.match(PDF_AND_PHOTO_UPLOAD_ACCEPT, /application\/pdf/);
  assert.match(VIDEO_UPLOAD_ACCEPT, /\.mkv/);
});

test("HEIC and HEIF remain photos when browsers omit or generalize MIME type", () => {
  assert.equal(isPhotoUpload({ name: "jobsite.HEIC", type: "" }), true);
  assert.equal(isPhotoUpload({ name: "jobsite.heif", type: "application/octet-stream" }), true);
  assert.equal(normalizePhotoContentType("jobsite.HEIC", ""), "image/heic");
  assert.equal(normalizePhotoContentType("jobsite.heif", "application/octet-stream"), "image/heif");
  assert.equal(isPhotoUpload({ name: "customer-logo.svg", type: "" }), true);
  assert.equal(normalizeUploadContentType("customer-logo.svg", ""), "image/svg+xml");
  assert.equal(isVideoUpload({ name: "walkthrough.mkv", type: "" }), true);
});

test("unknown file types remain storable and unsafe active formats download safely", () => {
  assert.equal(normalizeUploadContentType("coordination.custom", ""), "application/octet-stream");
  const unknown = storedFileResponseHeaders({ name: "coordination.custom", contentType: "", sizeBytes: 42 });
  assert.match(unknown["Content-Disposition"], /^attachment;/);
  assert.equal(unknown["X-Content-Type-Options"], "nosniff");
  const svg = storedFileResponseHeaders({ name: "logo.svg", contentType: "", sizeBytes: 100 });
  assert.equal(svg["Content-Type"], "image/svg+xml");
  assert.match(svg["Content-Security-Policy"], /sandbox/);
});

test("all reported image MIME types pass while non-photo documents stay distinct", () => {
  assert.equal(isPhotoUpload({ name: "future-format.xyz", type: "image/future" }), true);
  assert.equal(isPhotoUpload({ name: "contract.pdf", type: "application/pdf" }), false);
  assert.equal(isPdfOrPhotoUpload({ name: "invoice.pdf", type: "" }), true);
  assert.equal(isPdfOrPhotoUpload({ name: "notes.txt", type: "text/plain" }), false);
});

test("Daily Logs and every shared upload path use the platform-wide compatibility contract", async () => {
  const [page, layout, compatibility, filesApi, multipartApi, marketingApi, vendorApi, vendorBidApi, assetsApi, reviewApi, proposalApi] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/photo-upload-compatibility.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/files/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/files/multipart/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/marketing/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/vendor-portal/files/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/vendor-portal/bids/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/assets/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/review/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/proposals/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /aria-label="Upload jobsite photos"[\s\S]{0,180}accept=\{PHOTO_UPLOAD_ACCEPT\}/);
  assert.match(layout, /<PhotoUploadCompatibility \/>/);
  assert.match(compatibility, /MutationObserver/);
  assert.match(compatibility, /PHOTO_UPLOAD_ACCEPT/);
  assert.match(compatibility, /removeAttribute\("accept"\)/);
  assert.match(compatibility, /formatRequired/);
  assert.match(filesApi, /photoUploadContentType\(file\)/);
  assert.match(filesApi, /storedFileResponseHeaders/);
  assert.match(multipartApi, /normalizeUploadContentType/);
  assert.match(marketingApi, /isPhotoUpload\(file\)/);
  assert.match(vendorApi, /normalizeUploadContentType/);
  assert.doesNotMatch(vendorBidApi, /Quote OCR Requires A PDF Or Image File/);
  assert.doesNotMatch(assetsApi, /ALLOWED_(?:FILE_TYPES|EXTENSIONS)/);
  assert.doesNotMatch(reviewApi, /ALLOWED_(?:FILE_TYPES|EXTENSIONS)/);
  assert.match(proposalApi, /isPhotoUpload/);
  assert.match(page, /data-format-required="true" accept="application\/pdf"/);
});
