import { ensureOwnerPortalSchema, ownerPortalSession } from "../../../../lib/owner-portal";
import { storedFileResponseHeaders } from "../../../../lib/photo-uploads";

export async function GET(request: Request) {
  const { env } = await import("cloudflare:workers");
  const database = env.DB;
  await ensureOwnerPortalSchema(database);
  const session = await ownerPortalSession(database, request);
  if (!session) return Response.json({ error: "Project Owner Session Is Missing Or Expired" }, { status: 401 });
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Owner Document Is Required" }, { status: 400 });
  const row = await database.prepare(
    `SELECT id, project_id, name, category, storage_key, content_type, size_bytes, access
     FROM project_files WHERE id = ? AND project_id = ? LIMIT 1`,
  ).bind(id, session.project_id).first<{
    id: number; project_id: string; name: string; category: string; storage_key: string;
    content_type: string; size_bytes: number; access: string;
  }>();
  if (!row || row.category === "Turnover Bonus Agreement" || !/(owner|client)/i.test(row.access) || /^(Safety|SDS|Visitor|Incident)/i.test(row.category)) {
    return Response.json({ error: "This File Has Not Been Released To The Project Owner" }, { status: 403 });
  }
  const object = await env.BUCKET.get(row.storage_key);
  if (!object) return Response.json({ error: "File Content Not Found" }, { status: 404 });
  await database.prepare(`INSERT INTO owner_portal_audits (project_id, contract_record_id, actor_type, actor_name, actor_email, action, detail) VALUES (?, ?, 'Project Owner', ?, ?, 'Owner Document Opened', ?)`).bind(session.project_id, session.contract_record_id, session.contact_name, session.email, `${row.id} · ${row.name}`).run();
  return new Response(object.body, { headers: storedFileResponseHeaders({ name: row.name, contentType: row.content_type, sizeBytes: row.size_bytes }) });
}
