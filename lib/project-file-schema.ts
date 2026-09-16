export async function ensureProjectFileSchema() {
  const { env } = await import("cloudflare:workers");
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS project_files (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      project_id text NOT NULL,
      name text NOT NULL,
      category text NOT NULL,
      revision text NOT NULL,
      storage_key text NOT NULL UNIQUE,
      content_type text NOT NULL,
      size_bytes integer NOT NULL,
      uploaded_by text NOT NULL,
      access text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS project_files_project_idx
      ON project_files (project_id)`),
  ]);
}
