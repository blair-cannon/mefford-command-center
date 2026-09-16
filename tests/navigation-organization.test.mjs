import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const estimateEditor = fs.readFileSync(new URL("../app/estimate-editor.tsx", import.meta.url), "utf8");

function folderSource(collectionStart, label, nextLabel) {
  const start = page.indexOf(`label: "${label}"`, page.indexOf(collectionStart));
  const end = nextLabel
    ? page.indexOf(`label: "${nextLabel}"`, start + 1)
    : page.indexOf("];", start);
  assert.ok(start >= 0 && end > start, `${label} folder must exist`);
  return page.slice(start, end);
}

test("project management owns budget procurement closeout and every contract workflow", () => {
  const section = folderSource("const navFolders", "Project Management", "Site Management");
  for (const target of [
    "Budget",
    "Contracts",
    "Subcontracts",
    "Change Orders",
    "Purchase Orders",
    "Procurement",
    "Design & Drawings",
    "Closeout",
  ]) assert.match(section, new RegExp(`target: "${target}"`));
  assert.doesNotMatch(
    page.slice(page.indexOf("const navFolders"), page.indexOf("const companyNavFolders")),
    /label: "Contracts",\s*icon: "C"/,
  );
});

test("Design and Drawings is a dedicated Project Management section, not a utility shortcut", () => {
  const section = folderSource("const navFolders", "Project Management", "Site Management");
  assert.match(section, /target: "Design & Drawings"/);
  assert.equal(page.indexOf("const projectUtilityItems"), -1);
});

test("Quality is inside Site Management and is not a separate Project Tool", () => {
  const siteManagement = folderSource("const navFolders", "Site Management", null);
  assert.match(siteManagement, /target: "Quality"/);
  assert.equal(page.indexOf("const projectUtilityItems"), -1);
});

test("Admin is a sequenced operating flow and Lien Waivers remains under Accounting", () => {
  const admin = folderSource("const companyNavFolders", "Admin", null);
  const accounting = folderSource("const companyNavFolders", "Accounting", "Admin");
  for (const target of ["Admin Command", "Admin Goals", "Admin People", "Admin Requests", "Admin Templates", "Admin Access", "Admin Operations"]) {
    assert.match(admin, new RegExp(`target: "${target}"`));
  }
  assert.match(admin, /label: "Team & Access", target: "Admin Access"/);
  assert.match(accounting, /target: "Lien Waivers"/);
  assert.equal(page.indexOf("const projectUtilityItems"), -1);
});

test("estimate header contains the four requested live summary values", () => {
  for (const label of [
    "TOTAL CONTRACT PRICE",
    "TOTAL CONTRACTOR FEES · DOLLARS",
    "TOTAL CONTRACTOR FEES · % OF TOTAL PRICE",
    "COST PER SQ FT",
  ]) assert.match(estimateEditor, new RegExp(label));
  assert.match(estimateEditor, /moneyPerSquareFoot\(summary\.costPerSquareFoot\)/);
});
