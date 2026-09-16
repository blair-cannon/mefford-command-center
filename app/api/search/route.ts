import { canReadProject } from "../../../lib/project-access";
import { canReadFileScope } from "../../../lib/project-file-access";
import { desc, eq } from "drizzle-orm";
import { commandRecords, commandWorkItems, companyMembers, projectFiles, projects } from "../../../db/schema";
import { canAssistantReadSection, type AssistantActor } from "../../../lib/assistant-policy";
import { enforceOnboardingAccess } from "../../../lib/onboarding";
import { resolveCommandActor } from "../../../lib/server-actor";

type SearchResult = { kind: "Project" | "Record" | "File" | "Work"; title: string; detail: string; target: string; projectId: string; fileId: number; score: number };

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  const search = new URL(request.url).searchParams;
  const query = search.get("q")?.trim() || "";
  const activeProjectId = search.get("projectId")?.trim() || "";
  if (query.length < 2) return Response.json({ results: [] });
  const terms = Array.from(new Set(query.toLowerCase().match(/[a-z0-9.-]{2,}/g) || [])).slice(0, 12);
  const { getDb } = await import("../../../db");
  const db = getDb();
  const member = actor.email ? await db.select().from(companyMembers).where(eq(companyMembers.email, actor.email)).limit(1) : [];
  const assistantActor: AssistantActor = {
    name: actor.name,
    email: actor.email,
    accessLevel: (member[0]?.companyAccessLevel || actor.accessLevel) as AssistantActor["accessLevel"],
    designations: parseList(member[0]?.designationsJson || "[]"),
    permissionLocked: false,
  };
  const [projectRows, recordRows, fileRows, workRows] = await Promise.all([
    db.select().from(projects).orderBy(desc(projects.updatedAt)),
    db.select().from(commandRecords).orderBy(desc(commandRecords.updatedAt)),
    db.select().from(projectFiles).orderBy(desc(projectFiles.id)),
    actor.email ? db.select().from(commandWorkItems).where(eq(commandWorkItems.recipientEmail, actor.email)).orderBy(desc(commandWorkItems.updatedAt)) : Promise.resolve([]),
  ]);
  const projectVisibility = await Promise.all(projectRows.map(project => canReadProject(db, actor, project)));
  const visibleProjectIds = new Set(projectRows.filter((_, index) => projectVisibility[index]).map(project => project.number));
  const results: SearchResult[] = [];
  for (const project of projectRows) {
    if (!visibleProjectIds.has(project.number)) continue;
    const score = rank(`${project.number} ${project.name} ${project.site} ${project.status}`, terms, project.number === activeProjectId);
    if (score) results.push({ kind: "Project", title: project.name, detail: `${project.number} · ${project.site} · ${project.status}`, target: "Project Overview", projectId: project.number, fileId: 0, score });
  }
  for (const record of recordRows) {
    const section = recordSection(record.recordType);
    if (!canAssistantReadSection(assistantActor, section) || (!record.projectId.startsWith("MEFFORD-") && !visibleProjectIds.has(record.projectId))) continue;
    const data = parse(record.dataJson);
    const text = `${record.id} ${record.title} ${record.owner} ${record.status} ${record.meta} ${record.recordType} ${searchableData(data)}`;
    const matchedScore = rank(text, terms, record.projectId === activeProjectId);
    const score = matchedScore ? matchedScore + (record.recordType === "Drawing Intelligence" ? 2 : 0) : 0;
    if (!score) continue;
    const drawing = record.recordType === "Drawing Intelligence";
    const fileId = drawing ? Number(data.fileId || 0) : 0;
    const sheetSummary = drawing && Array.isArray(data.sheets) ? data.sheets.slice(0, 4).map((sheet) => sheet && typeof sheet === "object" ? String((sheet as Record<string, unknown>).sheetNumber || "") : "").filter(Boolean).join(", ") : "";
    results.push({ kind: "Record", title: record.title, detail: `${record.projectId} · ${drawing ? `Drawing OCR ${sheetSummary}` : record.recordType} · ${record.status}`, target: drawing ? "Design & Drawings" : section, projectId: record.projectId, fileId, score });
  }
  for (const file of fileRows) {
    if (!(await canReadFileScope(db, actor, file))) continue;
    if (!visibleProjectIds.has(file.projectId) && file.projectId !== "MEFFORD-PEOPLE") continue;
    const target = file.projectId === "MEFFORD-PEOPLE" ? "Employee Portal" : /design|drawing/i.test(file.category) ? "Design & Drawings" : "Documents";
    if (!canAssistantReadSection(assistantActor, target)) continue;
    const score = rank(`${file.name} ${file.category} ${file.revision} ${file.uploadedBy}`, terms, file.projectId === activeProjectId);
    if (score) results.push({ kind: "File", title: file.name, detail: `${file.projectId} · ${file.category} · ${file.revision}`, target, projectId: file.projectId, fileId: file.id, score });
  }
  for (const item of workRows) {
    const score = rank(`${item.title} ${item.message} ${item.kind} ${item.sourceRecordId}`, terms, item.projectId === activeProjectId);
    if (score) results.push({ kind: "Work", title: item.title, detail: `${item.projectId} · ${item.kind} · ${item.status}`, target: item.actionTarget || "My Work", projectId: item.projectId, fileId: 0, score });
  }
  const unique = results.sort((left, right) => right.score - left.score || left.title.localeCompare(right.title)).filter((item, index, list) => list.findIndex((candidate) => candidate.kind === item.kind && candidate.title === item.title && candidate.projectId === item.projectId && candidate.fileId === item.fileId) === index).slice(0, 40).map((item) => ({ kind: item.kind, title: item.title, detail: item.detail, target: item.target, projectId: item.projectId, fileId: item.fileId }));
  return Response.json({ results: unique, query, permissionFiltered: true });
}

function rank(value: string, terms: string[], active: boolean) {
  const haystack = value.toLowerCase();
  if (!terms.every((term) => haystack.includes(term))) return 0;
  return terms.reduce((score, term) => score + (haystack.startsWith(term) ? 10 : haystack.includes(` ${term}`) ? 6 : 3), active ? 4 : 0);
}
function recordSection(recordType: string) { const map: Record<string, string> = { "Quality Inspections": "Quality", "Quality Items": "Quality", "Drawing Intelligence": "Design & Drawings", "AP Invoice": "Accounts Payable", "AR Invoice": "Owner Billing", "Payroll Report": "Payroll Reports", "Toolbox Talks": "Safety" }; return map[recordType] || recordType; }
function parse(value: string) { try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; } }
function parseList(value: string) { try { const parsed = JSON.parse(value) as unknown; return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; } }
function searchableData(value: Record<string, unknown>) { return JSON.stringify(value).slice(0, 120_000); }
