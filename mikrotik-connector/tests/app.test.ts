import { describe, expect, it, beforeEach } from "vitest";
import { createApp } from "../src/app.js";
import { MockRouterOsClient } from "../src/routeros/mock-client.js";
import type { ConnectorConfig } from "../src/config.js";
import { DEFAULT_PROFILE_NAME } from "../src/config.js";

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

  it("rejects missing bearer auth", async () => {
    const res = await app.request("/v1/ensureResidentProfile", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("ensures profile with auth", async () => {
    const res = await app.request("/v1/ensureResidentProfile", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.connectorSecret}` }
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; data: { profile: { sharedUsers: number } } };
    expect(body.ok).toBe(true);
    expect(body.data.profile.sharedUsers).toBe(3);
  });

  it("creates and disables a user", async () => {
    const headers = {
      Authorization: `Bearer ${config.connectorSecret}`,
      "Content-Type": "application/json"
    };
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
  });
});
