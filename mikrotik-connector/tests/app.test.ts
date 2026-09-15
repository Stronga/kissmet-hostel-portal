import { describe, expect, it, beforeEach } from "vitest";
import { createApp } from "../src/app.js";
import { MockRouterOsClient } from "../src/routeros/mock-client.js";
import type { ConnectorConfig } from "../src/config.js";
import { DEFAULT_PROFILE_NAME, RESIDENT_PROFILE_NAME } from "../src/config.js";

const config: ConnectorConfig = {
  port: 8788,
  connectorSecret: "test-connector-secret",
  mikrotikHost: "192.168.88.1",
  mikrotikApiPort: 8728,
  mikrotikApiUser: "portal-api",
  mikrotikApiPassword: "unused"
};

describe("connector HTTP API", () => {
  let client: MockRouterOsClient;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    client = new MockRouterOsClient();
    client.profiles.set(DEFAULT_PROFILE_NAME, { id: "*0", name: DEFAULT_PROFILE_NAME, sharedUsers: 250 });
    app = createApp(config, client);
  });

  function authHeaders(json = false): Record<string, string> {
    return {
      Authorization: `Bearer ${config.connectorSecret}`,
      ...(json ? { "Content-Type": "application/json" } : {})
    };
  }

  it("rejects missing bearer auth", async () => {
    const res = await app.request("/v1/ensureResidentProfile", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("health endpoint works without mutating profiles", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(client.profiles.has(RESIDENT_PROFILE_NAME)).toBe(false);
  });

  it("ensures profile with auth", async () => {
    const res = await app.request("/v1/ensureResidentProfile", {
      method: "POST",
      headers: authHeaders()
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; data: { profile: { sharedUsers: number } } };
    expect(body.ok).toBe(true);
    expect(body.data.profile.sharedUsers).toBe(3);
  });

  it("maps profile conflict to 409", async () => {
    client.profiles.set(RESIDENT_PROFILE_NAME, { id: "*9", name: RESIDENT_PROFILE_NAME, sharedUsers: 99 });
    const res = await app.request("/v1/ensureResidentProfile", { method: "POST", headers: authHeaders() });
    expect(res.status).toBe(409);
    const body = await res.json() as { ok: boolean; error: { code: string } };
    expect(body.error.code).toBe("profile_conflict");
  });

  it("creates, enables, disables, resets, lists sessions, and disconnects", async () => {
    const headers = authHeaders(true);
    const create = await app.request("/v1/users", {
      method: "POST",
      headers,
      body: JSON.stringify({ username: "KSM-RES-0099", password: "temp-pass" })
    });
    expect(create.status).toBe(201);

    const disable = await app.request("/v1/users/KSM-RES-0099/disable", { method: "POST", headers });
    expect(disable.status).toBe(200);
    const disabledBody = await disable.json() as { data: { disabled: boolean } };
    expect(disabledBody.data.disabled).toBe(true);

    const enable = await app.request("/v1/users/KSM-RES-0099/enable", { method: "POST", headers });
    expect((await enable.json() as { data: { disabled: boolean } }).data.disabled).toBe(false);

    const reset = await app.request("/v1/users/KSM-RES-0099/reset-password", {
      method: "POST",
      headers,
      body: JSON.stringify({ password: "new-temp" })
    });
    expect(reset.status).toBe(200);
    expect(client.passwords.get("KSM-RES-0099")).toBe("new-temp");

    client.sessions.set("KSM-RES-0099", [{ id: "*1", user: "KSM-RES-0099", address: "10.0.0.9" }]);
    const sessions = await app.request("/v1/users/KSM-RES-0099/sessions", { headers });
    expect(((await sessions.json()) as { data: unknown[] }).data).toHaveLength(1);

    const disconnect = await app.request("/v1/users/KSM-RES-0099/disconnect", { method: "POST", headers });
    expect(((await disconnect.json()) as { data: { disconnected: number } }).data.disconnected).toBe(1);
  });

  it("maps missing user to 404", async () => {
    const res = await app.request("/v1/users/KSM-RES-missing/disable", {
      method: "POST",
      headers: authHeaders()
    });
    expect(res.status).toBe(404);
  });
});
