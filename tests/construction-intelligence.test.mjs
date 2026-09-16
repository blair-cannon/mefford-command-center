import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [records, quality, scheduleApi, scheduleLib, drawingApi, drawingClient, drawingLib, search, page, scheduleWorkspace, assistant, css] = await Promise.all([
  readFile(new URL("../app/api/records/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/quality-control/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/schedule-intelligence/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/construction-schedule.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/drawing-intelligence/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/drawing-client.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/drawing-intelligence.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/search/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/schedule-workspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/command-assistant.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
]);

test("every executed change order creates an immutable linked contract amendment", () => {
  assert.match(records, /syncExecutedChangeOrderContract/);
  assert.match(records, /recordType: "Contracts"/);
  assert.match(records, /contractDocumentType: "Executed Change Order Amendment"/);
  assert.match(records, /sourceChangeOrderId/);
  assert.match(records, /dateLocked: true/);
  assert.match(records, /An Executed Change Order And Its Contract Amendment Are Immutable/);
  assert.match(page, /Was Added To Contracts/);
});

test("schedule progress is hard-gated by its linked pre-work checklist", () => {
  assert.match(records, /Pre-Work Checklist Required Before/);
  assert.match(records, /preWorkStatus/);
  assert.match(records, /\["Passed", "Override Documented"\]/);
  assert.match(quality, /syncLinkedScheduleReadiness/);
  assert.match(quality, /Field progress is now allowed/);
  assert.match(quality, /Field progress remains blocked/);
});

test("schedule intelligence calculates CPM lookaheads forecast and preserves human authority", () => {
  assert.match(scheduleLib, /topologicalOrder/);
  assert.match(scheduleLib, /totalFloatDays/);
  assert.match(scheduleLib, /criticalPath/);
  assert.match(scheduleLib, /lookahead14/);
  assert.match(scheduleLib, /forecastFinish/);
  assert.match(scheduleApi, /draft-from-drawings/);
  assert.match(scheduleApi, /requiresHumanReview: true/);
  assert.match(scheduleApi, /writesApplied: false/);
  assert.match(scheduleApi, /OpenAI Is Not Connected/);
  assert.match(scheduleWorkspace, /I reviewed every activity, date, duration/);
});

test("drawing uploads receive OCR sheet revision and searchable metadata", () => {
  assert.match(drawingClient, /recognizeMobileDocument/);
  assert.match(drawingClient, /\/api\/drawing-intelligence/);
  assert.match(drawingLib, /sheetNumber/);
  assert.match(drawingLib, /revisionDate/);
  assert.match(drawingLib, /extractDrawingSheets/);
  assert.match(drawingApi, /sourceFileIsAuthoritative: true/);
  assert.match(drawingApi, /Human Review Required/);
  assert.match(page, /indexDrawingUpload/);
});

test("global search includes OCR text and remains permission filtered", () => {
  assert.match(search, /canAssistantReadSection/);
  assert.match(search, /Drawing Intelligence/);
  assert.match(search, /searchableData/);
  assert.match(search, /permissionFiltered: true/);
  assert.match(page, /\/api\/search/);
});

test("command search matches human phrases across punctuation", () => {
  assert.match(page, /query\.match\(\/\[a-z0-9\]\+\/g\)/);
  assert.match(page, /terms\.every\(\(term\) => searchable\.includes\(term\)\)/);
});

test("drawing OCR processes the complete uploaded PDF", async () => {
  const ocr = await readFile(new URL("../lib/mobile-ocr.ts", import.meta.url), "utf8");
  assert.match(ocr, /pageNumber <= pdf\.numPages/);
  assert.doesNotMatch(ocr, /MAX_PDF_PAGES/);
});

test("assistant launcher stays available in its reserved header slot without pretending a disconnected AI is live", () => {
  assert.match(assistant, /configured \? "Ask AI" : "Connect AI"/);
  assert.match(assistant, /OPENAI CONNECTION REQUIRED/);
  assert.match(css, /\.assistant-launcher\{position:static;inset:auto/);
  assert.doesNotMatch(css, /\.assistant-launcher\{position:fixed/);
  assert.doesNotMatch(assistant, /permissionLocked \|\| !configured/);
});
