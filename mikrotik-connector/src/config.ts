export type ConnectorMode = "local" | "production";

/**
 * RouterOS client driver.
 * - `real` (default): node-routeros API client → MikroTik.
 * - `mock`: in-memory MockRouterOsClient for local development / automated tests only.
 *   Never talks to a router. Refused when CONNECTOR_MODE=production.
 */
export type RouterOsDriver = "real" | "mock";

const ROUTEROS_DRIVERS: readonly RouterOsDriver[] = ["real", "mock"];

export interface ConnectorConfig {
  port: number;
  bindHost: string;
  connectorSecret: string;
  mikrotikHost: string;
  mikrotikApiPort: number;
  mikrotikApiUser: string;
  mikrotikApiPassword: string;
  mode: ConnectorMode;
  /** RouterOS client driver (`real` unless ROUTEROS_DRIVER=mock in non-production). */
  routerosDriver: RouterOsDriver;
  /** Max JSON body bytes for mutating routes. */
  maxBodyBytes: number;
  /** Soft per-IP request budget window (ms). */
  rateLimitWindowMs: number;
  /** Max authenticated requests per client key per window (counted after auth succeeds). */
  rateLimitMax: number;
  /**
   * Max failed-auth (401) attempts per client key per window before that key is locked out
   * (429) for the rest of the window. Default 20. Optional for backward-compatible configs.
   */
  authFailRateLimitMax?: number;
  /**
   * Trust CF-Connecting-IP / right-most X-Forwarded-For for the rate-limit key.
   * Default false (socket address only). Set true only behind cloudflared / a local proxy.
   */
  trustProxy?: boolean;
  /** RouterOS connect/write timeout (ms). */
  routerosTimeoutMs: number;
}

const MIN_PRODUCTION_SECRET_LENGTH = 32;

/**
 * Parse a required positive integer env var. Unset uses `fallback`.
 * Rejects zero, negative, fractional, NaN, Infinity, empty, and non-numeric values.
 * Number() already trims ASCII whitespace, so " 60 " is accepted.
 * The error names the variable and does not echo the raw value or any secret.
 */
function parsePositiveInteger(name: string, value: string | undefined, fallback: number): number {
  const n = Number(value ?? String(fallback));
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return n;
}

function parseBool(name: string, value: string | undefined, fallback: boolean): boolean {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "") return fallback;
  if (v === "true" || v === "1" || v === "yes" || v === "on") return true;
  if (v === "false" || v === "0" || v === "no" || v === "off") return false;
  throw new Error(`${name} must be true or false (got an unsupported value)`);
}

function isProductionValue(value: string | undefined): boolean {
  const v = (value ?? "").trim().toLowerCase();
  return v === "production" || v === "prod";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ConnectorConfig {
  const connectorSecret = env.CONNECTOR_SECRET?.trim() || env.MIKROTIK_CONNECTOR_SECRET?.trim();
  if (!connectorSecret) {
    throw new Error("CONNECTOR_SECRET is required");
  }

  const modeRaw = (env.CONNECTOR_MODE ?? env.NODE_ENV ?? "local").trim().toLowerCase();
  const mode: ConnectorMode = modeRaw === "production" || modeRaw === "prod" ? "production" : "local";

  const driverRaw = (env.ROUTEROS_DRIVER ?? "").trim().toLowerCase();
  const routerosDriver: RouterOsDriver = driverRaw === "" ? "real" : (driverRaw as RouterOsDriver);
  if (!ROUTEROS_DRIVERS.includes(routerosDriver)) {
    throw new Error(
      `ROUTEROS_DRIVER must be one of: ${ROUTEROS_DRIVERS.join(", ")} (got an unsupported value)`
    );
  }

  // Mock guard uses an either-indicator rule: CONNECTOR_MODE takes precedence for `mode`
  // above, so NODE_ENV=production + CONNECTOR_MODE=local would otherwise allow mock.
  if (routerosDriver === "mock" && (mode === "production" || isProductionValue(env.CONNECTOR_MODE) || isProductionValue(env.NODE_ENV))) {
    throw new Error(
      "ROUTEROS_DRIVER=mock is not allowed when CONNECTOR_MODE=production or NODE_ENV=production; refuse to start (mock is development/test only)"
    );
  }

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

  const trustProxy = parseBool("TRUST_PROXY", env.TRUST_PROXY, false);

  return {
    port: Number(env.PORT ?? "8788"),
    bindHost: (env.BIND_HOST ?? "127.0.0.1").trim() || "127.0.0.1",
    connectorSecret,
    mikrotikHost: env.MIKROTIK_HOST?.trim() || "192.168.88.1",
    mikrotikApiPort: Number(env.MIKROTIK_API_PORT ?? "8728"),
    mikrotikApiUser: env.MIKROTIK_API_USER?.trim() || "portal-api",
    mikrotikApiPassword,
    mode,
    routerosDriver,
    maxBodyBytes: Number(env.MAX_BODY_BYTES ?? String(16 * 1024)),
    rateLimitWindowMs: parsePositiveInteger("RATE_LIMIT_WINDOW_MS", env.RATE_LIMIT_WINDOW_MS, 60_000),
    rateLimitMax: parsePositiveInteger("RATE_LIMIT_MAX", env.RATE_LIMIT_MAX, 120),
    authFailRateLimitMax: parsePositiveInteger("AUTH_FAIL_RATE_LIMIT_MAX", env.AUTH_FAIL_RATE_LIMIT_MAX, 20),
    trustProxy,
    routerosTimeoutMs: Number(env.ROUTEROS_TIMEOUT_MS ?? "10000")
  };
}

export const RESIDENT_PROFILE_NAME = "Kissmet-Residents";
export const RESIDENT_SHARED_USERS = 3;
export const DEFAULT_PROFILE_NAME = "default";
