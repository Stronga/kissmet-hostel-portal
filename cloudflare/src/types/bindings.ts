/** Runtime APP_ENV. Wrangler also defines a `test` deploy env that sets APP_ENV=local for CI. */
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
   * Cloudflare Access service token (Worker secrets) for the connector Tunnel hostname.
   * When both are set the Worker sends CF-Access-Client-Id / CF-Access-Client-Secret.
   */
  MIKROTIK_CONNECTOR_ACCESS_CLIENT_ID?: string;
  MIKROTIK_CONNECTOR_ACCESS_CLIENT_SECRET?: string;
  /** HMAC secret (>=32 chars) for Pi → Worker POST /connector/heartbeat. Worker secret only. */
  CONNECTOR_HEARTBEAT_SECRET?: string;
  /** Previous heartbeat secret, accepted during rotation overlap only. Worker secret only. */
  CONNECTOR_HEARTBEAT_SECRET_PREVIOUS?: string;
  /** Comma-separated lowercase connector UUIDs allowed to send heartbeats (non-secret var). */
  CONNECTOR_HEARTBEAT_ALLOWED_IDS?: string;
  /** Seconds without a heartbeat before Admin shows the connector as stale (default 180). */
  CONNECTOR_HEARTBEAT_STALE_SECONDS?: string;

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
  /**
   * Staging-only OTP test-path secret. Worker secret, never a wrangler [vars] value.
   * The /staging/otp-test route is 404 unless APP_ENV=staging and this secret is set.
   * If this is present in production, validateProductionConfig flags a critical issue
   * and the route still returns 404.
   */
  STAGING_OTP_TEST_KEY?: string;
}
