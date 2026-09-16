export class WorkspaceRequestError extends Error {
  status: number;
  retryable: boolean;

  constructor(message: string, status = 0, retryable = true) {
    super(message);
    this.name = "WorkspaceRequestError";
    this.status = status;
    this.retryable = retryable;
  }
}

/** Read-only requests may recover once from an interrupted or non-JSON response.
 * Never treat a failed response as an empty list, and never retry a denied request.
 * Mutations deliberately cannot use this helper.
 */
export async function readWorkspaceJson<T>(
  url: string,
  label: string,
  valid: (body: Record<string, unknown>) => boolean,
  signal?: AbortSignal,
): Promise<T> {
  const unavailable = `${label} could not be loaded. Try again.`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    signal?.throwIfAborted();
    try {
      const timeout = AbortSignal.timeout(20_000);
      const response = await fetch(url, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      const retryable = response.ok || [408, 429, 500, 502, 503, 504].includes(response.status);
      let body: unknown;
      if (response.headers.get("content-type")?.includes("application/json")) {
        try { body = await response.json(); } catch { /* A truncated response is not an empty collection. */ }
      }
      const object = body && typeof body === "object" && !Array.isArray(body)
        ? body as Record<string, unknown>
        : null;
      if (!response.ok) {
        const message = typeof object?.error === "string" ? object.error
          : response.status === 401 ? "Your session needs verification. Refresh and sign in again."
          : response.status === 403 ? `Access to ${label.toLowerCase()} was denied.`
          : unavailable;
        throw new WorkspaceRequestError(message, response.status, retryable);
      }
      if (!object || !valid(object)) throw new WorkspaceRequestError(unavailable, response.status);
      return object as T;
    } catch (error) {
      signal?.throwIfAborted();
      const failure = error instanceof WorkspaceRequestError ? error : new WorkspaceRequestError(unavailable);
      if (!failure.retryable || attempt === 1) throw failure;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new WorkspaceRequestError(unavailable);
}
