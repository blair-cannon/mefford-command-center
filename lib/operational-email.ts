import { parseRetryAfter, type DeliveryAttemptResult } from "./delivery-control";
import { sendMicrosoftMailAccepted } from "./microsoft-graph";

type OperationalEmailInput = {
  to: string | string[];
  subject: string;
  text: string;
  senderEmail?: string;
  idempotencyKey: string;
  channel?: string;
  safeguards?: Record<string, boolean>;
  attachments?: Array<{ name: string; contentType: string; base64: string }>;
};

export async function operationalEmailConnection(senderEmail = "") {
  const { env } = await import("cloudflare:workers");
  const values = env as unknown as Record<string, unknown>;
  const mailbox = senderEmail.trim().toLowerCase() || text(values.MICROSOFT_OPERATIONAL_MAILBOX).toLowerCase();
  const graphReady = Boolean(
    mailbox
    && text(values.MICROSOFT_GRAPH_TENANT_ID)
    && text(values.MICROSOFT_GRAPH_CLIENT_ID)
    && text(values.MICROSOFT_GRAPH_CLIENT_SECRET),
  );
  const webhookReady = Boolean(text(values.OPERATIONAL_EMAIL_WEBHOOK_URL));
  return {
    configured: graphReady || webhookReady,
    mode: graphReady ? "Microsoft 365" : webhookReady ? "Operational Adapter" : "Connection Required",
    senderEmail: graphReady ? mailbox : "",
    missing: graphReady || webhookReady
      ? []
      : ["Microsoft Graph credentials + MICROSOFT_OPERATIONAL_MAILBOX", "Or OPERATIONAL_EMAIL_WEBHOOK_URL"],
  };
}

export async function sendOperationalEmail(input: OperationalEmailInput): Promise<DeliveryAttemptResult> {
  const recipients = [...new Set((Array.isArray(input.to) ? input.to : [input.to]).map((item) => item.trim().toLowerCase()).filter(Boolean))];
  if (!recipients.length || recipients.some(value => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) return rejected("A valid email address is required for every recipient", "Permanent");
  const connection = await operationalEmailConnection(input.senderEmail);
  if (!connection.configured) {
    return {
      outcome: "Deferred",
      provider: "",
      providerReceiptId: "",
      providerStatus: 0,
      acceptedAt: "",
      error: "Operational email is waiting for Microsoft 365 or the approved delivery adapter",
      errorClass: "Connection Required",
      retryAfterSeconds: 0,
    };
  }
  if (connection.mode === "Microsoft 365") {
    try {
      const receipt = await sendMicrosoftMailAccepted(connection.senderEmail, {
        subject: input.subject,
        bodyText: input.text,
        recipients,
        clientRequestId: input.idempotencyKey,
        attachments: input.attachments,
      });
      return {
        outcome: "Provider Accepted",
        provider: "Microsoft Graph",
        providerReceiptId: receipt.requestId || receipt.clientRequestId,
        providerStatus: receipt.status,
        acceptedAt: receipt.acceptedAt,
        error: "",
        errorClass: "",
        retryAfterSeconds: 0,
      };
    } catch (error) {
      return graphFailure(error);
    }
  }

  const { env } = await import("cloudflare:workers");
  const values = env as unknown as Record<string, unknown>;
  const webhookUrl = text(values.OPERATIONAL_EMAIL_WEBHOOK_URL);
  const webhookToken = text(values.OPERATIONAL_EMAIL_WEBHOOK_TOKEN);
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
        ...(webhookToken ? { Authorization: `Bearer ${webhookToken}` } : {}),
      },
      body: JSON.stringify({
        channel: input.channel || "operational-notification-only",
        idempotencyKey: input.idempotencyKey,
        from: input.senderEmail || undefined,
        to: recipients.length === 1 ? recipients[0] : recipients,
        subject: input.subject,
        text: input.text,
        attachments: input.attachments || [],
        safeguards: input.safeguards || {},
      }),
    });
    const body = await response.clone().json().catch(() => ({})) as Record<string, unknown>;
    const receiptId = text(body.receiptId || body.id || response.headers.get("x-request-id") || response.headers.get("location") || input.idempotencyKey);
    if (response.ok) {
      return {
        outcome: "Provider Accepted",
        provider: "Operational Email Adapter",
        providerReceiptId: receiptId,
        providerStatus: response.status,
        acceptedAt: new Date().toISOString(),
        error: "",
        errorClass: "",
        retryAfterSeconds: 0,
      };
    }
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    return {
      outcome: retryable ? "Retry" : "Rejected",
      provider: "Operational Email Adapter",
      providerReceiptId: receiptId,
      providerStatus: response.status,
      acceptedAt: "",
      error: text(body.message || body.error) || `Email provider returned ${response.status}`,
      errorClass: retryable ? "Transient" : "Permanent",
      retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")),
    };
  } catch (error) {
    return rejected(error instanceof Error ? error.message : "Operational email request failed", "Transient", "Operational Email Adapter");
  }
}

function graphFailure(error: unknown): DeliveryAttemptResult {
  const value = error as { status?: number; requestId?: string; retryAfterSeconds?: number; message?: string };
  const status = Number(value?.status || 0);
  const retryable = !status || status === 408 || status === 429 || status >= 500;
  return {
    outcome: retryable ? "Retry" : "Rejected",
    provider: "Microsoft Graph",
    providerReceiptId: text(value?.requestId),
    providerStatus: status,
    acceptedAt: "",
    error: text(value?.message) || "Microsoft Graph mail request failed",
    errorClass: retryable ? "Transient" : "Permanent",
    retryAfterSeconds: Number(value?.retryAfterSeconds || 0),
  };
}

function rejected(error: string, errorClass: "Transient" | "Permanent", provider = ""): DeliveryAttemptResult {
  return { outcome: errorClass === "Transient" ? "Retry" : "Rejected", provider, providerReceiptId: "", providerStatus: 0, acceptedAt: "", error, errorClass, retryAfterSeconds: 0 };
}

function text(value: unknown) {
  return String(value || "").trim();
}
