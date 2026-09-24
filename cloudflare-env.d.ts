declare namespace Cloudflare {
  interface Env {
    ASSETS: Fetcher;
    BUCKET: R2Bucket;
    DB: D1Database;
    MICROSOFT_GRAPH_CLIENT_ID?: string;
    MICROSOFT_GRAPH_CLIENT_SECRET?: string;
    MICROSOFT_GRAPH_TENANT_ID?: string;
    MICROSOFT_MEETINGS_MAILBOX?: string;
    PLAID_CLIENT_ID?: string;
    PLAID_SECRET?: string;
    PLAID_ENV?: string;
    PLAID_LAYER_TEMPLATE_ID?: string;
    PLAID_TOKEN_ENCRYPTION_KEY?: string;
  }
}
