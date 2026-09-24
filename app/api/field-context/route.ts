import { eq } from "drizzle-orm";
import { projects } from "../../../db/schema";
import { canReadProject } from "../../../lib/project-access";
import { resolveCommandActor } from "../../../lib/server-actor";
import { enforceOnboardingAccess } from "../../../lib/onboarding";

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const lock = await enforceOnboardingAccess(request); if (lock) return lock;
  const projectId = new URL(request.url).searchParams.get("projectId")?.trim() || "";
  const [{ getDb }, { env }] = await Promise.all([import("../../../db"), import("cloudflare:workers")]);
  const db = getDb();
  const project = (await db.select().from(projects).where(eq(projects.number, projectId)).limit(1))[0];
  if (!project || !(await canReadProject(db, actor, project))) return Response.json({ error: "Project Access Is Required" }, { status: 403 });
  const [members, vendors, logs, team, contracts] = await Promise.all([
    env.DB.prepare("SELECT display_name FROM company_members WHERE is_active = 1 ORDER BY display_name").all<{ display_name: string }>(),
    env.DB.prepare("SELECT DISTINCT v.legal_name FROM vendor_project_access a JOIN vendor_profiles v ON v.id = a.vendor_id WHERE a.project_id = ? AND a.status = 'Active' ORDER BY v.legal_name").bind(projectId).all<{ legal_name: string }>(),
    env.DB.prepare("SELECT data_json, record_date FROM command_records WHERE project_id = ? AND record_type = 'Daily Logs' AND status = 'Final' ORDER BY record_date DESC, updated_at DESC LIMIT 1").bind(projectId).first<{ data_json: string; record_date: string }>(),
    env.DB.prepare("SELECT data_json FROM command_records WHERE project_id = ? AND record_type = 'Project Team Assignment'").bind(projectId).all<{ data_json: string }>(),
    env.DB.prepare("SELECT data_json FROM command_records WHERE project_id = ? AND record_type = 'Subcontracts' AND status NOT IN ('Cancelled', 'Void', 'Terminated')").bind(projectId).all<{ data_json: string }>(),
  ]);
  let prior: Record<string, unknown> = {};
  try { prior = JSON.parse(logs?.data_json || "{}"); } catch { /* A malformed older record cannot supply autofill. */ }
  const names = (value: unknown) => Array.isArray(value) ? value.filter((name): name is string => typeof name === "string" && Boolean(name.trim())) : [];
  const field = (json: string, key: string) => { try { return String(JSON.parse(json)?.[key] || "").trim(); } catch { return ""; } };
  const active = new Set(members.results.map(member => member.display_name));
  return Response.json({
    employees: [...new Set([actor.name, project.superintendent, project.projectManager, ...team.results.map(row => field(row.data_json, "employeeName")), ...names(prior.employeesOnSite)].filter(name => name && (active.has(name) || name === actor.name)))],
    employeeDirectory: [...active],
    subcontractors: [...new Set([...vendors.results.map(vendor => vendor.legal_name), ...contracts.results.map(row => field(row.data_json, "subcontractor")), ...names(prior.subcontractorsOnSite)].filter(Boolean))],
    previousCrew: logs ? { date: logs.record_date, employees: names(prior.employeesOnSite), subcontractors: names(prior.subcontractorsOnSite) } : null,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
