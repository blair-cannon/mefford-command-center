import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { authorizedProjectAreas, preferredWorkspace } from "../lib/project-workspace.ts";

test("project work areas cannot expose unavailable financial tools or empty steps", () => {
  const tools = ["Daily Logs", "Safety", "RFIs", "Documents"].map(target => ({ target, label: target, group: "Projects" }));
  const areas = authorizedProjectAreas(tools);
  assert.deepEqual(areas.map(area => area.id), ["coordinate", "field"]);
  assert.deepEqual(areas.flatMap(area => area.tools.map(tool => tool.target)), ["RFIs", "Daily Logs", "Safety"]);
  assert.deepEqual(authorizedProjectAreas([]), []);
});

test("PM landing respects locked access and the leadership dashboard", () => {
  assert.equal(preferredWorkspace({ accessLevel: "Employee", designations: ["Project Manager"] }), "Project Overview");
  assert.equal(preferredWorkspace({ accessLevel: "Company Owner", designations: ["Project Manager"] }), "Dashboard");
  assert.equal(preferredWorkspace({ accessLevel: "Administrator" }), "Dashboard");
  assert.equal(preferredWorkspace({ accessLevel: "Employee", designations: ["Accountant"] }), "My Work");
  assert.equal(preferredWorkspace({ accessLevel: "Company Owner", permissionLocked: true }), "Employee Portal");
});

test("every project-specific menu destination is reachable through the project workspace", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const folders = page.slice(page.indexOf("const navFolders"), page.indexOf("const preconstructionNavGroups"));
  const targets = folders.split("\n").filter(line => !line.includes("company: true")).flatMap(line => [...line.matchAll(/target: "([^"]+)"/g)].map(match => match[1]));
  const tools = targets.map(target => ({ target, label: target, group: "Projects" }));
  assert.deepEqual(new Set(authorizedProjectAreas(tools).flatMap(area => area.tools.map(tool => tool.target))), new Set(targets));
});

test("project accounting retains context and cannot silently switch to a different eligible job", () => {
  const accounting = readFileSync(new URL("../app/accounting-erp.tsx", import.meta.url), "utf8");
  const waivers = readFileSync(new URL("../app/lien-waivers.tsx", import.meta.url), "utf8");
  const billing = readFileSync(new URL("../app/owner-billing.tsx", import.meta.url), "utf8");
  assert.match(accounting, /<OwnerBillingWorkspace actor=\{actor\} initialProjectId=\{initialProjectId\}/);
  assert.match(accounting, /<LienWaiverWorkspace actor=\{actor\} initialProjectId=\{initialProjectId\}/);
  assert.match(waivers, /initialProjectId && !rows\.some\(\(item\) => item\.number === initialProjectId\)/);
  assert.match(billing, /\[projectNumber, setProjectNumber\] = useState\(initialProjectId\)/);
});
