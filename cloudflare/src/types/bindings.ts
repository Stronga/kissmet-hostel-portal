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
}
