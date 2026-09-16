import { canReadFileScope, fileUploadScopeError } from "../../../../lib/project-file-access";
import { getCommandActor, resolveCommandActor } from "../../../../lib/server-actor";
import { projectFiles } from "../../../../db/schema";
import { ensureProjectFileSchema } from "../../../../lib/project-file-schema";
import { enforceOnboardingAccess } from "../../../../lib/onboarding";
import { normalizeUploadContentType } from "../../../../lib/photo-uploads";

const MAX_FILE_BYTES = 1024 * 1024 * 1024;
const MAX_PART_BYTES = 25 * 1024 * 1024;

type MultipartFileDetails = {
  projectId?: string;
  name?: string;
  category?: string;
  revision?: string;
  access?: string;
  contentType?: string;
  sizeBytes?: number;
  storageKey?: string;
  uploadId?: string;
  parts?: Array<{ partNumber: number; etag: string }>;
};

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  const action = new URL(request.url).searchParams.get("action");
  const details = (await request.json()) as MultipartFileDetails;
  const { getDb } = await import("../../../../db");
  const scopeError = await fileUploadScopeError(getDb(), actor, { projectId: details.projectId || "", category: details.category, contentType: details.contentType, access: details.access });
  if (scopeError) return Response.json({ error: scopeError }, { status: 403 });
  if (action === "create") return createUpload(details, actor);
  if (action === "complete") return completeUpload(details, actor);
  return Response.json({ error: "A valid multipart action is required" }, { status: 400 });
}

export async function PUT(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  const search = new URL(request.url).searchParams;
  const projectId = search.get("projectId")?.trim() ?? "";
  const storageKey = search.get("storageKey")?.trim() ?? "";
  const uploadId = search.get("uploadId")?.trim() ?? "";
  const partNumber = Number(search.get("partNumber"));
  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (
    !validStorageKey(projectId, storageKey) ||
    !uploadId ||
    !Number.isInteger(partNumber) ||
    partNumber < 1 ||
    partNumber > 10000 ||
    !request.body ||
    contentLength < 1 ||
    contentLength > MAX_PART_BYTES
  ) {
    return Response.json({ error: "The upload part is invalid" }, { status: 400 });
  }
  const { env } = await import("cloudflare:workers");
  const { getDb } = await import("../../../../db");
  if (!(await canReadFileScope(getDb(), actor, { projectId }))) return Response.json({ error: "Assigned Project File Access Is Required" }, { status: 403 });
  if (!(await ownsUpload(projectId, storageKey, uploadId, actor.email))) return Response.json({ error: "This Upload Belongs To Another Session Or Has Expired" }, { status: 403 });
  const upload = env.BUCKET.resumeMultipartUpload(storageKey, uploadId);
  try {
    const part = await upload.uploadPart(partNumber, request.body);
    return Response.json({ partNumber: part.partNumber, etag: part.etag });
  } catch {
    return Response.json({ error: "This file part could not be stored" }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  const details = (await request.json()) as MultipartFileDetails;
  const { getDb } = await import("../../../../db");
  if (!(await canReadFileScope(getDb(), actor, { projectId: details.projectId || "" }))) return Response.json({ error: "Assigned Project File Access Is Required" }, { status: 403 });
  if (!validStorageKey(details.projectId ?? "", details.storageKey ?? "") || !details.uploadId) {
    return Response.json({ error: "The multipart upload is invalid" }, { status: 400 });
  }
  const { env } = await import("cloudflare:workers");
  if (!(await ownsUpload(details.projectId!, details.storageKey!, details.uploadId!, actor.email))) return Response.json({ error: "This Upload Belongs To Another Session Or Has Expired" }, { status: 403 });
  await env.BUCKET.resumeMultipartUpload(
    details.storageKey!,
    details.uploadId,
  ).abort();
  await env.BUCKET.delete(uploadSessionKey(details.uploadId!));
  return Response.json({ aborted: true });
}

async function createUpload(
  details: MultipartFileDetails,
  actor: ReturnType<typeof getCommandActor>,
) {
  const projectId = details.projectId?.trim() ?? "";
  const name = details.name?.trim() ?? "";
  const sizeBytes = Number(details.sizeBytes);
  if (!projectId || !name || !Number.isFinite(sizeBytes) || sizeBytes < 1) {
    return Response.json({ error: "A file and project are required" }, { status: 400 });
  }
  if (sizeBytes > MAX_FILE_BYTES) {
    return Response.json({ error: "Individual files must be 1 GB or smaller" }, { status: 413 });
  }
  const safeName = name.replace(/[^a-zA-Z0-9._ -]+/g, "-");
  const storageKey = `${projectId}/${crypto.randomUUID()}-${safeName}`;
  const contentType = normalizeUploadContentType(name, details.contentType);
  const { env } = await import("cloudflare:workers");
  const upload = await env.BUCKET.createMultipartUpload(storageKey, {
    httpMetadata: {
      contentType,
    },
    customMetadata: {
      uploadedBy: actor.email,
      category: details.category || "Drawings",
    },
  });
  await env.BUCKET.put(uploadSessionKey(upload.uploadId), JSON.stringify({ ...details, projectId, storageKey, name, contentType, sizeBytes, actorEmail: actor.email, uploadId: upload.uploadId }), { httpMetadata: { contentType: "application/json" } });
  return Response.json({
    storageKey,
    uploadId: upload.uploadId,
    partSize: MAX_PART_BYTES,
  });
}

async function completeUpload(
  details: MultipartFileDetails,
  actor: ReturnType<typeof getCommandActor>,
) {
  const projectId = details.projectId?.trim() ?? "";
  const storageKey = details.storageKey?.trim() ?? "";
  const uploadId = details.uploadId?.trim() ?? "";
  const parts = details.parts ?? [];
  const contentType = normalizeUploadContentType(details.name || "", details.contentType);
  if (
    !validStorageKey(projectId, storageKey) ||
    !uploadId ||
    !details.name ||
    !Number.isFinite(details.sizeBytes) ||
    !parts.length ||
    parts.some(
      (part) =>
        !Number.isInteger(part.partNumber) ||
        part.partNumber < 1 ||
        !part.etag,
    )
  ) {
    return Response.json({ error: "Complete multipart details are required" }, { status: 400 });
  }
  const [{ getDb }, { env }] = await Promise.all([
    import("../../../../db"),
    import("cloudflare:workers"),
  ]);
  const session = await ownsUpload(projectId, storageKey, uploadId, actor.email);
  if (!session) return Response.json({ error: "This Upload Belongs To Another Session Or Has Expired" }, { status: 403 });
  for (const key of ["name", "category", "revision", "access", "sizeBytes"] as const) {
    if (String(details[key] ?? "") !== String(session[key] ?? "")) return Response.json({ error: "Upload Details Changed. Start A New Upload." }, { status: 409 });
  }
  if (contentType !== session.contentType) return Response.json({ error: "Upload Content Type Changed. Start A New Upload." }, { status: 409 });
  const upload = env.BUCKET.resumeMultipartUpload(storageKey, uploadId);
  try {
    if (!(await env.BUCKET.head(storageKey))) await upload.complete([...parts].sort((a, b) => a.partNumber - b.partNumber));
  } catch {
    return Response.json({ error: "The large file could not be completed" }, { status: 502 });
  }
  const object = await env.BUCKET.head(storageKey);
  if (!object || object.size !== Number(session.sizeBytes) || object.size > MAX_FILE_BYTES) return Response.json({ error: "The Completed File Size Does Not Match The Upload" }, { status: 409 });
  await ensureProjectFileSchema();
  const [saved] = await getDb()
    .insert(projectFiles)
    .values({
      projectId,
      name: details.name,
      category: details.category || "Drawings",
      revision: details.revision || "New Upload",
      storageKey,
      contentType,
      sizeBytes: Number(details.sizeBytes),
      uploadedBy: actor.name,
      access: details.access || "Project team",
    })
    .returning();
  await env.BUCKET.delete(uploadSessionKey(uploadId));
  let microsoftFileMapping: Awaited<ReturnType<(typeof import("../../../../lib/sharepoint-storage"))["queueProjectFileForSharePoint"]>> | null = null;
  let microsoftFileWarning = "";
  try {
    const { queueProjectFileForSharePoint } = await import("../../../../lib/sharepoint-storage");
    microsoftFileMapping = await queueProjectFileForSharePoint({
      projectFileId: saved.id,
      projectId: saved.projectId,
      name: saved.name,
      category: saved.category,
      storageKey: saved.storageKey,
      sizeBytes: saved.sizeBytes,
      uploadedBy: actor.name,
      uploadedByEmail: actor.email,
    });
  } catch (error) {
    microsoftFileWarning = error instanceof Error ? error.message : "Microsoft File Mapping Could Not Be Registered";
  }
  return Response.json({ file: toClientFile(saved), microsoftFileMapping, microsoftFileWarning }, { status: 201 });
}

function uploadSessionKey(uploadId: string) { return "multipart-upload-sessions/" + encodeURIComponent(uploadId); }

async function ownsUpload(projectId: string, storageKey: string, uploadId: string, email: string) {
  const { env } = await import("cloudflare:workers");
  const object = await env.BUCKET.get(uploadSessionKey(uploadId));
  if (!object) return null;
  const session = await object.json<MultipartFileDetails & { actorEmail: string }>();
  return session.actorEmail === email && session.projectId === projectId && session.storageKey === storageKey ? session : null;
}

function validStorageKey(projectId: string, storageKey: string) {
  return Boolean(
    projectId &&
      storageKey.startsWith(`${projectId}/`) &&
      !storageKey.includes(".."),
  );
}

function toClientFile(file: {
  id: number;
  name: string;
  category: string;
  revision: string;
  uploadedBy: string;
  contentType: string;
  createdAt: string;
  sizeBytes: number;
  access: string;
}) {
  return {
    id: file.id,
    name: file.name,
    category: file.category,
    revision: file.revision,
    uploadedBy: file.uploadedBy,
    contentType: file.contentType,
    createdAt: file.createdAt,
    date: new Intl.DateTimeFormat("en-US", {
      month: "numeric",
      day: "numeric",
      year: "numeric",
    }).format(new Date(`${file.createdAt}Z`)),
    size: formatFileSize(file.sizeBytes),
    access: file.access,
    stored: true,
  };
}

function formatFileSize(sizeBytes: number) {
  return sizeBytes >= 1_000_000_000
    ? `${(sizeBytes / 1_000_000_000).toFixed(2)} GB`
    : `${Math.max(0.1, sizeBytes / 1_000_000).toFixed(1)} MB`;
}
