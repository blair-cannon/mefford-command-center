import { validateDashboardSession } from "../../../lib/dashboard-display-auth";
import { dashboardRevision, waitForDashboardRevision } from "../../../lib/dashboard-live";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!await validateDashboardSession(request)) {
    return Response.json(
      { error: "Dashboard display login required." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  const rawSince = Number(new URL(request.url).searchParams.get("since") || 0);
  const since = Number.isSafeInteger(rawSince) && rawSince >= 0 ? rawSince : 0;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode("retry: 1000\nevent: ready\ndata: {}\n\n"));
      try {
        const initial = await dashboardRevision();
        if (initial.revision !== since) {
          controller.enqueue(encoder.encode(event("dashboard", initial)));
          controller.close();
          return;
        }
        const next = await waitForDashboardRevision(since, request.signal);
        controller.enqueue(encoder.encode(event(next.changed ? "dashboard" : "heartbeat", next)));
      } catch {
        controller.enqueue(encoder.encode(event("reconnect", { revision: since })));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "private, no-store, max-age=0",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function event(name: string, payload: Record<string, unknown>) {
  return `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;
}
