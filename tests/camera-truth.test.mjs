import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const mobile = fs.readFileSync(new URL("../app/mobile-command.tsx", import.meta.url), "utf8");

test("project camera surfaces never claim an unconnected live feed", () => {
  for (const falseClaim of ["All Assigned Cameras Online", "Live Cameras", "All Systems Online", "3 access points", "camera-tile live", "camera-scan"]) {
    assert.doesNotMatch(page, new RegExp(falseClaim));
  }
  assert.match(page, /UniFi Protect Connection Required/);
  assert.match(page, /No Live Camera Status/);
  assert.match(page, /Zero Feeds Assumed/);
  assert.match(page, /NO DEVICE OR FEED/);
});

test("camera planning remains useful without inventing device assignments", () => {
  assert.match(page, /reserveProjectCameraSlot/);
  assert.match(page, /No device or live feed was connected/);
  assert.match(page, /Planned Camera Slots/);
  assert.match(page, /no credentials device IDs snapshots or streams stored/);
  assert.match(styles, /Truthful camera readiness before UniFi integration/);
});

test("real field capture preserves originals and evidence", () => {
  assert.match(page, /capture="environment"/);
  assert.match(page, /Original preserved/);
  assert.match(page, /\/api\/files/);
  assert.match(mobile, /capture="environment"/);
  assert.match(mobile, /Save Original & OCR Record/);
  assert.match(mobile, /MobileMediaEditor/);
});
