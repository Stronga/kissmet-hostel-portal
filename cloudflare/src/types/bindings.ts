export type AppEnv = "local" | "staging" | "production";

export interface Env {
  DB: D1Database;
  DOCUMENTS: R2Bucket;
  APP_NAME: string;
  APP_ENV: AppEnv;
  APP_VERSION: string;
  PUBLIC_BASE_URL: string;
  ADMIN_ALLOWED_ORIGINS?: string;
}
