import type { Env } from "../types/bindings";

export interface ConnectorUser {
  id: string;
  name: string;
  profile: string;
  disabled: boolean;
  comment?: string;
}

export interface ConnectorSession {
  id: string;
  user: string;
  address?: string;
  macAddress?: string;
  uptime?: string;
}

export class ConnectorUnavailableError extends Error {
  constructor(message = "Internet connector unavailable") {
    super(message);
    this.name = "ConnectorUnavailableError";
  }
}

/** Default bounded timeout for Worker → connector calls (ms). */
export const CONNECTOR_REQUEST_TIMEOUT_MS = 12_000;

export function assertProductionConnectorUrl(url: string, appEnv: string | undefined): void {
  const env = (appEnv ?? "").toLowerCase();
  if (env !== "production" && env !== "staging") return;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ConnectorUnavailableError("Internet connector URL is invalid");
  }
  if (parsed.protocol !== "https:") {
    throw new ConnectorUnavailableError("Internet connector URL must use HTTPS in production");
  }
  if (parsed.username || parsed.password) {
    throw new ConnectorUnavailableError("Internet connector URL must not embed credentials");
  }
}

export class MikroTikConnectorClient {
  constructor(
    private readonly baseUrl: string | undefined,
    private readonly secret: string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly options: {
      appEnv?: string;
      timeoutMs?: number;
    } = {}
  ) {}

  static fromEnv(env: Env, fetchImpl: typeof fetch = fetch) {
    return new MikroTikConnectorClient(env.MIKROTIK_CONNECTOR_URL, env.MIKROTIK_CONNECTOR_SECRET, fetchImpl, {
      appEnv: env.APP_ENV,
      timeoutMs: CONNECTOR_REQUEST_TIMEOUT_MS
    });
  }

  get configured(): boolean {
    return Boolean(this.baseUrl?.trim() && this.secret?.trim());
  }

  private requireConfig() {
    if (!this.configured) {
      throw new ConnectorUnavailableError("Internet connector is not configured");
    }
    assertProductionConnectorUrl(this.baseUrl!.trim(), this.options.appEnv);
  }

  private url(path: string) {
    return `${this.baseUrl!.replace(/\/$/, "")}${path}`;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    this.requireConfig();
    const timeoutMs = this.options.timeoutMs ?? CONNECTOR_REQUEST_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(this.url(path), {
        method,
        headers: {
          Authorization: `Bearer ${this.secret}`,
          "x-correlation-id": crypto.randomUUID(),
          ...(body !== undefined ? { "Content-Type": "application/json" } : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
    } catch (e) {
      const aborted = e instanceof Error && (e.name === "AbortError" || /aborted/i.test(e.message));
      throw new ConnectorUnavailableError(
        aborted ? "Internet connector request timed out" : "Internet connector unreachable"
      );
    } finally {
      clearTimeout(timer);
    }

    type ConnectorPayload = { ok?: boolean; data?: T; error?: { message?: string; code?: string } };
    let payload: ConnectorPayload | null = null;
    try {
      payload = await response.json() as ConnectorPayload;
    } catch {
      payload = null;
    }

    if (!response.ok || !payload?.ok) {
      const code = payload?.error?.code;
      if (response.status === 404 || code === "not_found") {
        throw new Error(payload?.error?.message ?? "HotSpot user not found");
      }
      if (response.status === 409 || code === "profile_conflict") {
        throw new Error(payload?.error?.message ?? "Internet profile conflict");
      }
      if (response.status === 401 || code === "unauthorized") {
        throw new ConnectorUnavailableError("Internet connector unauthorized");
      }
      if (response.status === 429 || code === "rate_limited") {
        throw new ConnectorUnavailableError("Internet connector rate limited");
      }
      if (response.status >= 500 || code === "unavailable") {
        throw new ConnectorUnavailableError("Internet connector unavailable");
      }
      throw new Error(payload?.error?.message ?? "Internet connector request failed");
    }

    return payload.data as T;
  }

  /**
   * Authenticated deep health (RouterOS path). Process-only /health is for host probes.
   */
  health() {
    return this.request<{
      process: string;
      routeros: string;
      board?: string;
      version?: string;
      mikrotikHost?: string;
      mikrotikApiPort?: number;
    }>("GET", "/v1/health");
  }

  ensureResidentProfile() {
    return this.request<{ profile: { name: string; sharedUsers: number }; created: boolean }>(
      "POST",
      "/v1/ensureResidentProfile"
    );
  }

  getUser(username: string) {
    return this.request<ConnectorUser>("GET", `/v1/users/${encodeURIComponent(username)}`);
  }

  createUser(input: { username: string; password: string; comment?: string }) {
    return this.request<{ user: ConnectorUser; created: boolean }>("POST", "/v1/users", input);
  }

  disableUser(username: string) {
    return this.request<ConnectorUser>("POST", `/v1/users/${encodeURIComponent(username)}/disable`);
  }

  enableUser(username: string) {
    return this.request<ConnectorUser>("POST", `/v1/users/${encodeURIComponent(username)}/enable`);
  }

  resetUserPassword(username: string, password: string) {
    return this.request<ConnectorUser>("POST", `/v1/users/${encodeURIComponent(username)}/reset-password`, { password });
  }

  removeUser(username: string) {
    return this.request<{ removed: boolean }>("DELETE", `/v1/users/${encodeURIComponent(username)}`);
  }

  listActiveSessions(username: string) {
    return this.request<ConnectorSession[]>("GET", `/v1/users/${encodeURIComponent(username)}/sessions`);
  }

  disconnectSessions(username: string) {
    return this.request<{ disconnected: number }>("POST", `/v1/users/${encodeURIComponent(username)}/disconnect`);
  }
}
