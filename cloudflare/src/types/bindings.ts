export type AppEnv = "local" | "staging" | "production";

export interface Env {
  DB: D1Database;
  DOCUMENTS: R2Bucket;
  APP_NAME: string;
  APP_ENV: AppEnv;
  APP_VERSION: string;
  PUBLIC_BASE_URL: string;
  /** Comma-separated explicit browser origins for Admin + Resident portals. Historical name. */
  ADMIN_ALLOWED_ORIGINS?: string;
  /** Local/dev only: force OTP console capture when not production. */
  DEV_OTP_LOG?: string;
  /** Always-on MikroTik connector base URL (optional locally — missing → sync_failed safely). */
  MIKROTIK_CONNECTOR_URL?: string;
  /** Shared Bearer secret for Worker → connector (optional locally). */
  MIKROTIK_CONNECTOR_SECRET?: string;

  /**
   * OTP SMS delivery provider selection.
   * - local/CI: omit or `mock` (default) — never sends paid SMS
   * - production: must be `arkesel` (fail-closed otherwise)
   * - staging: `arkesel` only when explicitly set
   */
  SMS_PROVIDER?: string;
  /**
   * Arkesel API key — Cloudflare Worker secret only. Never put in wrangler.toml.
   * Used only by the Worker SMS adapter; browsers never receive this.
   */
  ARKESEL_API_KEY?: string;
  /**
   * Approved Arkesel Sender ID (configuration-driven; do not hard-code KISSMET).
   * Non-secret var; set after NCA/business approval. Missing → fail-closed send.
   */
  ARKESEL_SENDER_ID?: string;
  /** Optional override of Arkesel SMS send URL (tests). Defaults to official V2 endpoint. */
  ARKESEL_SMS_ENDPOINT?: string;
}
