import { ensureMeetingTables } from "../../../../lib/meeting-server";
import { ensureMicrosoftSubscriptionSchema } from "../../../../lib/microsoft-subscriptions";
import { createMicrosoftWebhookStore, handleMicrosoftWebhookRequest, type MicrosoftWebhookDatabase } from "../../../../lib/microsoft-webhook-security";

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  const runtime = env as unknown as Record<string, unknown> & { DB: MicrosoftWebhookDatabase };
  try {
    await ensureMicrosoftSubscriptionSchema(runtime.DB);
    return await handleMicrosoftWebhookRequest({
      request,
      clientState: String(runtime.MICROSOFT_GRAPH_WEBHOOK_CLIENT_STATE || ""),
      store: createMicrosoftWebhookStore(runtime.DB),
      beforeAccept: ensureMeetingTables,
    });
  } catch {
    return Response.json({ error: "Microsoft Graph Webhook Protection Is Unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
