import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const meetings = fs.readFileSync(new URL("../lib/meetings.ts", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../lib/meeting-server.ts", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../app/api/meetings/route.ts", import.meta.url), "utf8");
const ui = fs.readFileSync(new URL("../app/meetings-center.tsx", import.meta.url), "utf8");
const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const work = fs.readFileSync(new URL("../lib/my-work.ts", import.meta.url), "utf8");

test("the eight approved meeting types include the three requested departments", () => {
  for (const type of ["Quarterly Rock/Review", "Weekly L10", "Project Design", "Project Owner", "Project Subcontractor", "Sales/Estimating Department", "Operations Department", "Accounting Department"]) assert.match(meetings, new RegExp(type.replace("/", "\\/")));
  assert.doesNotMatch(meetings, /Internal Project/);
  assert.match(page, /target: "Quarterly Rock\/Review"/);
  assert.match(page, /target: "Weekly L10"/);
  assert.match(page, /Project Subcontractor Meetings/);
});

test("meeting records are durable and carry into My Work", () => {
  for (const table of ["meeting_series", "meeting_occurrences", "meeting_attendees", "meeting_agenda_items", "meeting_decisions", "meeting_action_items", "meeting_attachments", "meeting_audits"]) assert.match(server, new RegExp(table));
  assert.match(api, /Assignment Not Confirmed/);
  assert.match(work, /meeting-action:/);
  assert.match(work, /3-Day Overdue/);
  assert.match(server, /carry_count/);
});

test("human authority gates decisions recording publication and finalization", () => {
  assert.match(api, /Only The Named Decision-Maker May Confirm This Decision/);
  assert.match(api, /Authorized Mefford Leader Permission Required/);
  assert.match(api, /Recording Selection And Audit Reason Are Required/);
  assert.match(api, /Auto-Publication Held/);
  assert.match(api, /Minutes Finalized And Locked/);
  assert.match(ui, /Save Draft Minutes/);
  assert.match(api, /Never approve, publish by judgment/i);
});

test("Microsoft, PDF, contract value, and setup controls are real workflows", () => {
  assert.match(api, /createMicrosoftMeeting/);
  assert.match(api, /sendMeetingMinutesMail/);
  assert.match(api, /sync_teams_evidence/);
  assert.match(api, /createMeetingMinutesPdf/);
  assert.match(server, /ownerFinancialSnapshot/);
  assert.match(ui, /Owner Contract Value/);
  assert.match(page, /Required Project Meeting Schedule/);
  assert.match(page, /Only a Company Owner can mark a type Not Required/);
});

test("quarterly completion establishes the linked weekly L10", () => {
  assert.match(api, /createQuarterlyLinkedL10/);
  assert.match(api, /Weekly L10 Series Established From Quarterly/);
  assert.match(server, /Quarterly Rock/);
  assert.match(server, /rock-review/);
});

test("meeting workspaces expose topic requests, saved edits, source settings, and printing without a placeholder agenda", () => {
  for (const label of ["Request Topic", "Edit Topic", "Save Discussion Changes", "Agenda Sources And Managers", "Print Agenda / PDF", "Removed Topics", "Create First Meeting"]) assert.ok(ui.includes(label), label);
  assert.doesNotMatch(ui, /className="meeting-blueprint"|className="form-rule"/);
});
