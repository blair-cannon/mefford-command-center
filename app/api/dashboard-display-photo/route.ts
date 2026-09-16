import { validateDashboardSession } from "../../../lib/dashboard-display-auth";
import { isPhotoUpload, storedFileResponseHeaders } from "../../../lib/photo-uploads";

export async function GET(request: Request) {
  if (!await validateDashboardSession(request)) return Response.json({ error: "Dashboard display login required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "A Valid Review Photo Is Required" }, { status: 400 });
  const { env } = await import("cloudflare:workers");
  const file = await env.DB.prepare(`SELECT id, project_id, name, category, storage_key, content_type, size_bytes FROM project_files WHERE id = ? LIMIT 1`).bind(id).first<{ id: number; project_id: string; name: string; category: string; storage_key: string; content_type: string; size_bytes: number }>();
  if (!file || !isPhotoUpload({ name: file.name, type: file.content_type })) return Response.json({ error: "Dashboard Photo Not Found" }, { status: 404 });
  if (file.category === "Customer Survey Photo" && file.project_id === "MEFFORD-SALES") {
    const responses = await env.DB.prepare(`SELECT data_json FROM command_records WHERE project_id = 'MEFFORD-SALES' AND record_type = 'Marketing Customer Survey Response'`).all<{ data_json: string }>();
    const consented = (responses.results || []).some((row) => { const data = parse(row.data_json); return (data.displayConsent === true || data.marketingConsent === true) && Array.isArray(data.photoIds) && data.photoIds.map(Number).includes(id); });
    if (!consented) return Response.json({ error: "Customer Display Consent Is Required" }, { status: 403 });
  } else if (file.category === "Photos") {
    const project = await env.DB.prepare(`SELECT status FROM projects WHERE number = ? LIMIT 1`).bind(file.project_id).first<{ status: string }>();
    if (!project || ["Deletion Quarantine", "Cancelled"].includes(project.status)) return Response.json({ error: "Active Project Photo Required" }, { status: 403 });
  } else {
    return Response.json({ error: "This Image Is Not Approved For Dashboard Display" }, { status: 403 });
  }
  const object = await env.BUCKET.get(file.storage_key);
  if (!object) return Response.json({ error: "Review Photo Content Not Found" }, { status: 404 });
  return new Response(object.body, { headers: storedFileResponseHeaders({ name: file.name, contentType: file.content_type, sizeBytes: file.size_bytes, cacheControl: "private, max-age=300" }) });
}

function parse(value: string) { try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; } }
