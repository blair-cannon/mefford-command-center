import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const projectsSource = await readFile(
  new URL("../app/api/projects/route.ts", import.meta.url),
  "utf8",
);
const resetSource = await readFile(
  new URL("../app/api/projects/reset/route.ts", import.meta.url),
  "utf8",
);
test("an empty project database remains empty until an authorized user creates a project", () => {
  assert.doesNotMatch(projectsSource, /ensureDogPound|dogPoundProject|Dog Pound/);
  assert.match(pageSource, /useState<ProjectProfile\[]>\(\[\]\)/);
  assert.match(pageSource, /No Assigned Projects/);
  assert.match(pageSource, /Start First Project/);
  assert.match(pageSource, /projectListStatus === "ready" && \["Company Owner", "Administrator"\]\.includes\(sessionActor.accessLevel\)/);
});

test("the normal project reset requires the typed project name and has no automatic demo bypass", () => {
  assert.match(resetSource, /payload\.confirmation\?\.trim\(\) !== projectName/);
  assert.doesNotMatch(resetSource, /automaticKey|INITIAL_RESET_KEY|Dog Pound/);
  assert.doesNotMatch(pageSource, /SYSTEM-RESET-26-001|automaticKey/);
});

test("clean field records never begin with assumed attendance or weather", () => {
  assert.match(pageSource, /useState<string\[\]>\(\[\]\)/);
  assert.match(pageSource, /setEmployeesOnSite\(\[\]\)/);
  assert.match(pageSource, /setSubsOnSite\(\[\]\)/);
  assert.match(pageSource, /setToolboxAttendees\(\[\]\)/);
  assert.doesNotMatch(pageSource, /<strong>84°<\/strong>/);
  assert.doesNotMatch(pageSource, /<small>Good conditions<\/small>/);
  assert.match(pageSource, /Project Address Required For Automatic Weather/);
});
