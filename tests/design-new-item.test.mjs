import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const design = fs.readFileSync(new URL("../app/design-lifecycle.tsx", import.meta.url), "utf8");

test("Design And Drawings workspace action opens the real design package form", () => {
  assert.match(page, /active === "Design & Drawings"/);
  assert.match(page, /<DesignLifecycleWorkspace/);
  assert.match(design, /New \{scope === "Sales" \? "Sales Design" : "Design Package"\}/);
  assert.match(design, /disabled=\{!canCreate/);
  assert.match(design, /window\.addEventListener\("command:new-design-package"/);
  assert.match(design, /setPanel\("create"\)/);
  assert.match(design, /onClick=\{openCreatePanel\}/);
});

test("generic new-item handling cannot open an unsupported blank modal", () => {
  assert.match(page, /if \(!workspaceCopy\[nextType\]\)/);
  assert.match(page, /Use The Controls Inside \$\{nextType\} To Create Its Records/);
});
