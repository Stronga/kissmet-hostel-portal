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
  /**
   * RouterOS API over TLS (api-ssl, default port 8729). Default false for backward
   * compatibility; the production env template sets true. Optional for older test configs.
   */
  mikrotikApiTls?: boolean;
  /** PEM CA bundle (e.g. the RouterOS local CA) used to verify the api-ssl certificate. */
  mikrotikApiTlsCaFile?: string;
  /** Optional SHA-256 certificate pin, normalised to Node's `AA:BB:..` fingerprint256 form. */
  mikrotikApiTlsFingerprint256?: string;
  /** Optional hostname to verify the certificate against (default: MIKROTIK_HOST). */
  mikrotikApiTlsServername?: string;
  /** Lab-only: skip certificate verification. Refused in production. */
  mikrotikApiTlsInsecure?: boolean;
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

/** Parse a TCP port (1-65535). Unset uses `fallback`. Never echoes the raw value. */
function parsePort(name: string, value: string | undefined, fallback: number): number {
  const n = parsePositiveInteger(name, value, fallback);
  if (n > 65_535) {
    throw new Error(`${name} must be a TCP port between 1 and 65535`);
  }
  return n;
}

/** True for loopback listen addresses (127.0.0.0/8, ::1, localhost). */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/** Normalise a SHA-256 fingerprint (hex, optional colons/spaces) to `AA:BB:...`; throws if malformed. */
export function normaliseFingerprint256(raw: string): string {
  const hex = raw.replace(/[\s:]/g, "").toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(hex)) {
    throw new Error("MIKROTIK_API_TLS_FINGERPRINT256 must be a SHA-256 fingerprint (64 hex digits, colons optional)");
  }
  return hex.match(/.{2}/g)!.join(":");
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

/**
 * Either-indicator production rule: production if CONNECTOR_MODE **or** NODE_ENV says
 * production/prod (case-insensitive, trimmed). Used for every production-only guard so that
 * NODE_ENV=production cannot be silently overridden by CONNECTOR_MODE=local.
 */
export function isProductionEnv(env: NodeJS.ProcessEnv): boolean {
  return isProductionValue(env.CONNECTOR_MODE) || isProductionValue(env.NODE_ENV);
}

/**
 * True only when the environment is *explicitly* non-production: at least one of
 * CONNECTOR_MODE / NODE_ENV is set to a non-empty value and neither says production.
 * An unset environment is not "explicitly non-production" (it would default to local mode,
 * but plaintext RouterOS API is not allowed on that default).
 */
export function isExplicitNonProductionEnv(env: NodeJS.ProcessEnv): boolean {
  if (isProductionEnv(env)) return false;
  return Boolean(env.CONNECTOR_MODE?.trim() || env.NODE_ENV?.trim());
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
  const production = mode === "production" || isProductionEnv(env);
  if (routerosDriver === "mock" && production) {
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
  const bindHost = (env.BIND_HOST ?? "127.0.0.1").trim() || "127.0.0.1";

  // TRUST_PROXY makes CF-Connecting-IP / X-Forwarded-For authoritative for rate-limit keys.
  // That is only safe when the socket is reachable solely through the local proxy (cloudflared).
  if (trustProxy && !isLoopbackHost(bindHost)) {
    throw new Error(
      "TRUST_PROXY=true requires a loopback BIND_HOST (127.0.0.1); forwarded headers are spoofable on a reachable port"
    );
  }
  if (mode === "production" && !isLoopbackHost(bindHost)) {
    throw new Error("BIND_HOST must be a loopback address (127.0.0.1) in production; expose the connector via cloudflared");
  }

  // --- RouterOS API transport -------------------------------------------------------------
  const mikrotikApiTls = parseBool("MIKROTIK_API_TLS", env.MIKROTIK_API_TLS, false);
  const mikrotikApiTlsInsecure = parseBool("MIKROTIK_API_TLS_INSECURE_SKIP_VERIFY", env.MIKROTIK_API_TLS_INSECURE_SKIP_VERIFY, false);
  const caFileRaw = env.MIKROTIK_API_TLS_CA_FILE?.trim() || undefined;
  const fingerprintRaw = env.MIKROTIK_API_TLS_FINGERPRINT256?.trim() || undefined;
  const servernameRaw = env.MIKROTIK_API_TLS_SERVERNAME?.trim() || undefined;
  const mikrotikApiPort = parsePort("MIKROTIK_API_PORT", env.MIKROTIK_API_PORT, mikrotikApiTls ? 8729 : 8728);

  if (!mikrotikApiTls && (caFileRaw || fingerprintRaw || servernameRaw || mikrotikApiTlsInsecure)) {
    throw new Error("MIKROTIK_API_TLS_* settings require MIKROTIK_API_TLS=true");
  }
  let mikrotikApiTlsFingerprint256: string | undefined;
  // Encrypted RouterOS API is mandatory in production (either indicator). Plaintext 8728 is only
  // permitted for the real driver when the environment is explicitly non-production.
  if (routerosDriver === "real" && !mikrotikApiTls) {
    if (production) {
      throw new Error(
        "MIKROTIK_API_TLS=true is required in production (RouterOS api-ssl on 8729 with MIKROTIK_API_TLS_CA_FILE); plaintext RouterOS API is refused"
      );
    }
    if (!isExplicitNonProductionEnv(env)) {
      throw new Error(
        "Plaintext RouterOS API requires an explicitly non-production environment (set CONNECTOR_MODE=local or NODE_ENV=development/test), or set MIKROTIK_API_TLS=true"
      );
    }
  }
  if (mikrotikApiTls) {
    if (mikrotikApiPort === 8728) {
      throw new Error("MIKROTIK_API_PORT=8728 is the plaintext RouterOS API; api-ssl listens on 8729");
    }
    if (mikrotikApiTlsInsecure && production) {
      throw new Error("MIKROTIK_API_TLS_INSECURE_SKIP_VERIFY is not allowed in production; configure MIKROTIK_API_TLS_CA_FILE");
    }
    if (!mikrotikApiTlsInsecure && !caFileRaw) {
      throw new Error(
        "MIKROTIK_API_TLS=true requires MIKROTIK_API_TLS_CA_FILE (RouterOS CA certificate); self-signed certificates are rejected without it"
      );
    }
    if (production && !caFileRaw) {
      throw new Error("MIKROTIK_API_TLS_CA_FILE is required in production (certificate verification cannot be disabled)");
    }
    if (caFileRaw && !caFileRaw.startsWith("/") && production) {
      throw new Error("MIKROTIK_API_TLS_CA_FILE must be an absolute path in production");
    }
    if (fingerprintRaw) mikrotikApiTlsFingerprint256 = normaliseFingerprint256(fingerprintRaw);
  }

  return {
    port: parsePort("PORT", env.PORT, 8788),
    bindHost,
    connectorSecret,
    mikrotikHost: env.MIKROTIK_HOST?.trim() || "192.168.88.1",
    mikrotikApiPort,
    mikrotikApiUser: env.MIKROTIK_API_USER?.trim() || "portal-api",
    mikrotikApiPassword,
    mode,
    routerosDriver,
    maxBodyBytes: parsePositiveInteger("MAX_BODY_BYTES", env.MAX_BODY_BYTES, 16 * 1024),
    rateLimitWindowMs: parsePositiveInteger("RATE_LIMIT_WINDOW_MS", env.RATE_LIMIT_WINDOW_MS, 60_000),
    rateLimitMax: parsePositiveInteger("RATE_LIMIT_MAX", env.RATE_LIMIT_MAX, 120),
    authFailRateLimitMax: parsePositiveInteger("AUTH_FAIL_RATE_LIMIT_MAX", env.AUTH_FAIL_RATE_LIMIT_MAX, 20),
    trustProxy,
    routerosTimeoutMs: parsePositiveInteger("ROUTEROS_TIMEOUT_MS", env.ROUTEROS_TIMEOUT_MS, 10_000),
    mikrotikApiTls,
    mikrotikApiTlsCaFile: mikrotikApiTls ? caFileRaw : undefined,
    mikrotikApiTlsFingerprint256,
    mikrotikApiTlsServername: mikrotikApiTls ? servernameRaw : undefined,
    mikrotikApiTlsInsecure: mikrotikApiTls ? mikrotikApiTlsInsecure : false
  };
}

export const RESIDENT_PROFILE_NAME = "Kissmet-Residents";
export const RESIDENT_SHARED_USERS = 3;
export const DEFAULT_PROFILE_NAME = "default";
