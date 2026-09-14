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

export class MikroTikConnectorClient {
  constructor(
    private readonly baseUrl: string | undefined,
    private readonly secret: string | undefined,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  static fromEnv(env: Env, fetchImpl: typeof fetch = fetch) {
    return new MikroTikConnectorClient(env.MIKROTIK_CONNECTOR_URL, env.MIKROTIK_CONNECTOR_SECRET, fetchImpl);
  }

  get configured(): boolean {
    return Boolean(this.baseUrl?.trim() && this.secret?.trim());
  }

  private requireConfig() {
    if (!this.configured) {
      throw new ConnectorUnavailableError("Internet connector is not configured");
    }
  }

  private url(path: string) {
    return `${this.baseUrl!.replace(/\/$/, "")}${path}`;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    this.requireConfig();
    let response: Response;
    try {
      response = await this.fetchImpl(this.url(path), {
        method,
        headers: {
          Authorization: `Bearer ${this.secret}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
    } catch {
      throw new ConnectorUnavailableError("Internet connector unreachable");
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
      if (response.status >= 500 || code === "unavailable") {
        throw new ConnectorUnavailableError("Internet connector unavailable");
      }
      throw new Error(payload?.error?.message ?? "Internet connector request failed");
    }

    return payload.data as T;
  }

  health() {
    return this.request<{ ok: true; board?: string; version?: string }>("GET", "/health");
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
