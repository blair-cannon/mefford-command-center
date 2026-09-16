import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MOBILE_LIVE_ONLY_ACTIONS,
  MOBILE_DEVICE_TEST_MATRIX,
  MOBILE_OFFLINE_RECORD_TYPES,
  MOBILE_PRIMARY_NAVIGATION,
  MOBILE_PUSH_CATEGORIES,
  canQueueOfflineAction,
  isSensitiveActionLabel,
  offlineSessionExpired,
  offlineSessionExpiresAt,
  quickActionsForActor,
  requiresLiveConnection,
  resolveOfflineConflict,
} from "../lib/mobile-core.js";

test("formal release matrix covers every approved iPhone and iPad in both orientations", () => {
  assert.deepEqual(MOBILE_DEVICE_TEST_MATRIX.map((item) => item.device), ["Small iPhone", "Large iPhone", "iPad Mini", "Standard iPad", "iPad Pro"]);
  for (const item of MOBILE_DEVICE_TEST_MATRIX) {
    assert.equal(item.portrait[0] < item.portrait[1], true, `${item.device} portrait`);
    assert.equal(item.landscape[0] > item.landscape[1], true, `${item.device} landscape`);
  }
});

test("phone navigation uses the approved five role-aware destinations", () => {
  assert.deepEqual(
    MOBILE_PRIMARY_NAVIGATION.map((item) => item.label),
    ["My Work", "Project", "Quick Add", "Notifications", "More"],
  );
});

test("approved field records queue offline while sensitive actions remain live-only", () => {
  for (const type of ["Daily Logs", "Pre-Work Checklists", "Quality", "Photos", "RFIs", "Safety", "Schedule", "Acknowledgments"]) {
    assert.equal(canQueueOfflineAction(type), true, type);
  }
  assert.equal(canQueueOfflineAction("Contracts"), false);
  assert.equal(canQueueOfflineAction("Financial Approval"), false);
  for (const action of MOBILE_LIVE_ONLY_ACTIONS) assert.equal(requiresLiveConnection(action), true, action);
});

test("trusted offline sessions use a rolling seven-day expiration", () => {
  const connected = "2026-08-01T12:00:00.000Z";
  assert.equal(offlineSessionExpiresAt(connected), "2026-08-08T12:00:00.000Z");
  assert.equal(offlineSessionExpired(connected, "2026-08-08T11:59:59.000Z"), false);
  assert.equal(offlineSessionExpired(connected, "2026-08-08T12:00:01.000Z"), true);
});

test("offline conflicts always preserve both versions for review", () => {
  assert.equal(
    resolveOfflineConflict("2026-08-15T14:00:00Z", "2026-08-15T13:00:00Z"),
    "preserve_both_review_required",
  );
  assert.equal(
    resolveOfflineConflict("2026-08-15T12:00:00Z", "2026-08-15T13:00:00Z"),
    "apply_queued_record",
  );
});

test("sensitive-action detection covers all approved Face ID gates", () => {
  for (const label of [
    "Approve Financial Invoice",
    "Owner Override",
    "Execute Contract",
    "Approve Final Payment",
    "Complete Total Project Closeout",
  ]) assert.equal(isSensitiveActionLabel(label), true, label);
  assert.equal(isSensitiveActionLabel("Save Daily Log"), false);
});

test("role-aware Quick Add preserves field access and restricts accounting capture", () => {
  const field = quickActionsForActor({ accessLevel: "Employee", designations: ["Superintendent"] });
  const owner = quickActionsForActor({ accessLevel: "Company Owner", designations: [] });
  assert.equal(field.some((action) => action.id === "daily-log"), true);
  assert.equal(field.some((action) => action.id === "receipt"), false);
  assert.equal(owner.some((action) => action.id === "receipt"), true);
});

test("push categories match the approved operational-notification scope", () => {
  assert.deepEqual(MOBILE_PUSH_CATEGORIES, [
    "Assignments",
    "Approvals",
    "Mentions",
    "Due Items",
    "Escalations",
    "Safety Alerts",
    "Upload / Sync Failures",
  ]);
});

test("installable app shell and service worker provide offline and push lifecycle", async () => {
  const [manifestText, worker] = await Promise.all([
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/?source=installed");
  assert.match(worker, /addEventListener\("push"/);
  assert.match(worker, /addEventListener\("sync"/);
  assert.match(worker, /CLEAR_MOBILE_CACHE/);
  assert.match(worker, /if \(url\.origin !== self\.location\.origin \|\| url\.pathname\.startsWith\("\/api\/"\)\) return;/);
});

test("mobile UI wires install, Face ID, scanning, dictation and accessible navigation", async () => {
  const source = await readFile(new URL("../app/mobile-command.tsx", import.meta.url), "utf8");
  assert.match(source, /beforeinstallprompt/);
  assert.match(source, /navigator\.credentials\.create/);
  assert.match(source, /navigator\.credentials\.get/);
  assert.match(source, /Scan & OCR/);
  assert.match(source, /capture="environment"/);
  assert.match(source, /SpeechRecognition/);
  assert.match(source, /review\. It was not submitted automatically/);
  assert.match(source, /aria-label="Primary mobile navigation"/);
  assert.match(source, /Seven-day rolling offline trust/);
  assert.match(source, /Trusted Device Session Unlock/);
  assert.match(source, /WEB_PUSH_VAPID_PUBLIC_KEY|push-config/);
});

test("OCR is real for images and multi-page PDFs and always requires human review", async () => {
  const [ocr, mobile] = await Promise.all([
    readFile(new URL("../lib/mobile-ocr.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/mobile-command.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(ocr, /createWorker/);
  assert.match(ocr, /pdfjs-dist/);
  assert.match(ocr, /getTextContent/);
  assert.match(ocr, /worker\.recognize/);
  assert.match(mobile, /ocrReviewRequired: true/);
  assert.match(mobile, /runOcr/);
});

test("field photo markup creates a separate copy with captions and before-after pairing", async () => {
  const [editor, page] = await Promise.all([
    readFile(new URL("../app/mobile-media-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(editor, /Arrow/);
  assert.match(editor, /Circle/);
  assert.match(editor, /pairRole/);
  assert.match(editor, /original remains unchanged/i);
  assert.match(page, /photoMarkups/);
  assert.match(page, /originalPreserved: true/);
});

test("offline project records and files are AES-GCM encrypted before IndexedDB storage", async () => {
  const client = await readFile(new URL("../lib/mobile-client.ts", import.meta.url), "utf8");
  assert.match(client, /AES-GCM/);
  assert.match(client, /device-crypto/);
  assert.match(client, /extractable|generateKey\([^]*false/);
  assert.match(client, /encrypted: true/);
  assert.match(client, /saveAssignedProjectSnapshot/);
});

test("background sync decrypts only inside the service worker and resumes visible uploads", async () => {
  const worker = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.match(worker, /processEncryptedOutbox/);
  assert.match(worker, /crypto\.subtle\.decrypt/);
  assert.match(worker, /COMMAND_MOBILE_SYNC_PROGRESS/);
  assert.match(worker, /Background Mobile Upload/);
});

test("operational push uses VAPID and opens the exact assigned work target", async () => {
  const [push, latest, worker] = await Promise.all([
    readFile(new URL("../lib/mobile-push.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/mobile/push/latest/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
  ]);
  assert.match(push, /Authorization: `vapid/);
  assert.match(push, /WEB_PUSH_VAPID_PRIVATE_KEY/);
  assert.match(latest, /actionTarget/);
  assert.match(worker, /api\/mobile\/push\/latest/);
});

test("records capture location only at submission and queue approved failures", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /captureSubmissionLocation\(\)/);
  assert.match(page, /Captured once at field-record submission with device permission/);
  assert.match(page, /queueOfflineMobileRecord/);
  assert.match(page, /This action requires a live connection/);
  assert.match(page, /signatureEvidence/);
  assert.match(page, /signatureImage/);
  assert.match(page, /mobileDeviceId/);
});

test("device sessions and audits are durable and remotely revocable", async () => {
  const [schema, route, migration] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/mobile/device/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0004_clever_phalanx.sql", import.meta.url), "utf8"),
  ]);
  assert.match(schema, /mobileDeviceSessions/);
  assert.match(schema, /mobileDeviceAudits/);
  assert.match(migration, /CREATE TABLE `mobile_device_sessions`/);
  assert.match(route, /action === "revoke"/);
  assert.match(route, /Face ID Step-Up Confirmed/);
  assert.match(route, /verifyWebAuthnAssertion/);
  assert.match(route, /crypto\.subtle\.verify/);
  assert.match(route, /OFFLINE_SESSION_MS = 7/);
});

test("offline sync preserves conflicts and creates permanent audit history", async () => {
  const route = await readFile(new URL("../app/api/mobile/sync/route.ts", import.meta.url), "utf8");
  assert.match(route, /Preserve Both And Require Reviewed Resolution/);
  assert.match(route, /PM Review/);
  assert.match(route, /recordAudits/);
  assert.match(route, /preservedConflict/);
  assert.match(MOBILE_OFFLINE_RECORD_TYPES.join("|"), /Visitor Records/);
});
