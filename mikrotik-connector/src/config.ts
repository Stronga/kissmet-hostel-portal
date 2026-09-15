export type ConnectorMode = "local" | "production";

export interface ConnectorConfig {
  port: number;
  bindHost: string;
  connectorSecret: string;
  mikrotikHost: string;
  mikrotikApiPort: number;
  mikrotikApiUser: string;
  mikrotikApiPassword: string;
  mode: ConnectorMode;
  /** Max JSON body bytes for mutating routes. */
  maxBodyBytes: number;
  /** Soft per-IP request budget window (ms). */
  rateLimitWindowMs: number;
  /** Max authenticated requests per IP per window. */
  rateLimitMax: number;
  /** RouterOS connect/write timeout (ms). */
  routerosTimeoutMs: number;
}

const MIN_PRODUCTION_SECRET_LENGTH = 32;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ConnectorConfig {
  const connectorSecret = env.CONNECTOR_SECRET?.trim() || env.MIKROTIK_CONNECTOR_SECRET?.trim();
  if (!connectorSecret) {
    throw new Error("CONNECTOR_SECRET is required");
  }

  const modeRaw = (env.CONNECTOR_MODE ?? env.NODE_ENV ?? "local").trim().toLowerCase();
  const mode: ConnectorMode = modeRaw === "production" || modeRaw === "prod" ? "production" : "local";

  if (mode === "production" && connectorSecret.length < MIN_PRODUCTION_SECRET_LENGTH) {
    throw new Error(
      `CONNECTOR_SECRET must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters in production`
    );
  }

  if (mode === "production" && /replace-with|changeme|test-connector|secret123/i.test(connectorSecret)) {
    throw new Error("CONNECTOR_SECRET looks like a placeholder; refuse to start in production");
  }

  const mikrotikApiPassword = env.MIKROTIK_API_PASSWORD ?? "";
  if (mode === "production" && !mikrotikApiPassword.trim()) {
    throw new Error("MIKROTIK_API_PASSWORD is required in production");
  }

  return {
    port: Number(env.PORT ?? "8788"),
    bindHost: (env.BIND_HOST ?? "127.0.0.1").trim() || "127.0.0.1",
    connectorSecret,
    mikrotikHost: env.MIKROTIK_HOST?.trim() || "192.168.88.1",
    mikrotikApiPort: Number(env.MIKROTIK_API_PORT ?? "8728"),
    mikrotikApiUser: env.MIKROTIK_API_USER?.trim() || "portal-api",
    mikrotikApiPassword,
    mode,
    maxBodyBytes: Number(env.MAX_BODY_BYTES ?? String(16 * 1024)),
    rateLimitWindowMs: Number(env.RATE_LIMIT_WINDOW_MS ?? "60000"),
    rateLimitMax: Number(env.RATE_LIMIT_MAX ?? "120"),
    routerosTimeoutMs: Number(env.ROUTEROS_TIMEOUT_MS ?? "10000")
  };
}

export const RESIDENT_PROFILE_NAME = "Kissmet-Residents";
export const RESIDENT_SHARED_USERS = 3;
export const DEFAULT_PROFILE_NAME = "default";
