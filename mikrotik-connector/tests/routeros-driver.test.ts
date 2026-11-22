import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Track whether the real RouterOS client module is ever loaded or constructed.
 * vi.mock factories run lazily on first import, so `moduleLoads` stays 0 if mock
 * mode never imports ./node-client.js. The real class is replaced by a spy that
 * cannot open any network connection.
 */
const realClient = vi.hoisted(() => ({ moduleLoads: 0, constructed: 0 }));

vi.mock("../src/routeros/node-client.js", () => {
  realClient.moduleLoads += 1;
  class NodeRouterOsClient {
    constructor() {
      realClient.constructed += 1;
    }
    async health(): Promise<never> {
      throw new Error("real RouterOS client must not be used in tests");
    }
  }
  return { NodeRouterOsClient };
});

// Belt and braces: even if something imported node-routeros, it could not connect.
vi.mock("node-routeros", () => {
  class RouterOSAPI {
    constructor() {
      throw new Error("node-routeros must not be constructed in tests");
    }
  }
  return { RouterOSAPI };
});

import { createApp } from "../src/app.js";
import { DEFAULT_PROFILE_NAME, RESIDENT_PROFILE_NAME, loadConfig } from "../src/config.js";
import { createDevMockRouterOsClient, createRouterOsClient } from "../src/routeros/client-factory.js";
import { MockRouterOsClient } from "../src/routeros/mock-client.js";
import { log } from "../src/logger.js";

const SECRET = "local-dev-connector-secret-at-least-32-chars";

beforeEach(() => {
  vi.spyOn(log, "info").mockImplementation(() => undefined);
  vi.spyOn(log, "warn").mockImplementation(() => undefined);
  vi.spyOn(log, "error").mockImplementation(() => undefined);
});

describe("ROUTEROS_DRIVER config", () => {
  it("defaults to the real driver when unset", () => {
    const cfg = loadConfig({ CONNECTOR_SECRET: SECRET, CONNECTOR_MODE: "local" } as NodeJS.ProcessEnv);
    expect(cfg.routerosDriver).toBe("real");
  });

  it("treats an empty ROUTEROS_DRIVER as the real driver", () => {
    const cfg = loadConfig({ CONNECTOR_SECRET: SECRET, CONNECTOR_MODE: "local", ROUTEROS_DRIVER: "  " } as NodeJS.ProcessEnv);
    expect(cfg.routerosDriver).toBe("real");
  });

  it("accepts explicit real driver in production", () => {
    const cfg = loadConfig({
      CONNECTOR_SECRET: "p".repeat(40),
      CONNECTOR_MODE: "production",
      MIKROTIK_API_PASSWORD: "router-pass",
      ROUTEROS_DRIVER: "real",
      MIKROTIK_API_TLS: "true",
      MIKROTIK_API_TLS_CA_FILE: "/etc/kissmet/routeros-ca.pem"
    } as NodeJS.ProcessEnv);
    expect(cfg.mode).toBe("production");
    expect(cfg.mikrotikApiTls).toBe(true);
    expect(cfg.mikrotikApiPort).toBe(8729);
    expect(cfg.routerosDriver).toBe("real");
  });

  it("accepts mock in local mode without RouterOS host or password", () => {
    const cfg = loadConfig({
      CONNECTOR_SECRET: SECRET,
      CONNECTOR_MODE: "local",
      ROUTEROS_DRIVER: "mock"
    } as NodeJS.ProcessEnv);
    expect(cfg.mode).toBe("local");
    expect(cfg.routerosDriver).toBe("mock");
    expect(cfg.mikrotikApiPassword).toBe("");
  });

  it("accepts mock with NODE_ENV=test / development (case-insensitive driver value)", () => {
    for (const NODE_ENV of ["test", "development"]) {
      const cfg = loadConfig({ CONNECTOR_SECRET: SECRET, NODE_ENV, ROUTEROS_DRIVER: "MOCK" } as NodeJS.ProcessEnv);
      expect(cfg.routerosDriver).toBe("mock");
      expect(cfg.mode).toBe("local");
    }
  });

  it("rejects mock when CONNECTOR_MODE=production, even with otherwise valid production config", () => {
    expect(() =>
      loadConfig({
        CONNECTOR_SECRET: "p".repeat(40),
        CONNECTOR_MODE: "production",
        MIKROTIK_API_PASSWORD: "router-pass",
        ROUTEROS_DRIVER: "mock"
      } as NodeJS.ProcessEnv)
    ).toThrow(/ROUTEROS_DRIVER=mock is not allowed when CONNECTOR_MODE=production/);
  });

  it("rejects mock for production aliases (CONNECTOR_MODE=prod, NODE_ENV=production)", () => {
    expect(() =>
      loadConfig({ CONNECTOR_SECRET: "p".repeat(40), CONNECTOR_MODE: "prod", ROUTEROS_DRIVER: "mock" } as NodeJS.ProcessEnv)
    ).toThrow(/not allowed when CONNECTOR_MODE=production/);
    expect(() =>
      loadConfig({ CONNECTOR_SECRET: "p".repeat(40), NODE_ENV: "production", ROUTEROS_DRIVER: "mock" } as NodeJS.ProcessEnv)
    ).toThrow(/not allowed when CONNECTOR_MODE=production/);
  });

  describe("either production indicator rejects mock (conflicting CONNECTOR_MODE / NODE_ENV)", () => {
    const load = (env: Record<string, string>) =>
      loadConfig({ CONNECTOR_SECRET: SECRET, ROUTEROS_DRIVER: "mock", ...env } as NodeJS.ProcessEnv);
    const REJECT = /ROUTEROS_DRIVER=mock is not allowed/;

    it("rejects NODE_ENV=production even when CONNECTOR_MODE=local", () => {
      expect(() => load({ NODE_ENV: "production", CONNECTOR_MODE: "local" })).toThrow(REJECT);
    });

    it("rejects CONNECTOR_MODE=production even when NODE_ENV=development", () => {
      expect(() =>
        load({ CONNECTOR_MODE: "production", NODE_ENV: "development", CONNECTOR_SECRET: "p".repeat(40) })
      ).toThrow(REJECT);
    });

    it("rejects NODE_ENV=prod with a non-production CONNECTOR_MODE", () => {
      expect(() => load({ NODE_ENV: "prod", CONNECTOR_MODE: "local" })).toThrow(REJECT);
    });

    it("rejects CONNECTOR_MODE=prod with NODE_ENV=development", () => {
      expect(() => load({ CONNECTOR_MODE: "prod", NODE_ENV: "development" })).toThrow(REJECT);
    });

    it("rejects mixed-case and whitespace-padded production values on either variable", () => {
      for (const value of [" Production ", "PRODUCTION", "\tProd\n", " pRoD"]) {
        expect(() => load({ NODE_ENV: value, CONNECTOR_MODE: "local" })).toThrow(REJECT);
        expect(() => load({ CONNECTOR_MODE: value, NODE_ENV: "development" })).toThrow(REJECT);
      }
    });

    it("allows mock when both indicators are local/development", () => {
      const cfg = load({ CONNECTOR_MODE: "local", NODE_ENV: "development" });
      expect(cfg.mode).toBe("local");
      expect(cfg.routerosDriver).toBe("mock");
    });

    it("leaves the real driver unchanged for NODE_ENV=production + CONNECTOR_MODE=local (CONNECTOR_MODE wins → local)", () => {
      const cfg = loadConfig({
        CONNECTOR_SECRET: SECRET,
        NODE_ENV: "production",
        CONNECTOR_MODE: "local",
        ROUTEROS_DRIVER: "real",
        // NODE_ENV=production is a production indicator, so TLS is mandatory here too.
        MIKROTIK_API_TLS: "true",
        MIKROTIK_API_TLS_CA_FILE: "/etc/kissmet/routeros-ca.pem"
      } as NodeJS.ProcessEnv);
      expect(cfg.mode).toBe("local");
      expect(cfg.routerosDriver).toBe("real");
    });
  });

  it("rejects unsupported driver values without echoing them", () => {
    for (const value of ["fake", "routeros", "true"]) {
      let message = "";
      try {
        loadConfig({ CONNECTOR_SECRET: SECRET, ROUTEROS_DRIVER: value } as NodeJS.ProcessEnv);
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toMatch(/ROUTEROS_DRIVER must be one of: real, mock/);
      expect(message).not.toContain(value);
    }
  });
});

describe("RouterOS client factory", () => {
  beforeEach(() => {
    realClient.moduleLoads = 0;
    realClient.constructed = 0;
  });

  it("mock driver returns an in-memory mock and never loads or constructs the real client", async () => {
    const cfg = loadConfig({ CONNECTOR_SECRET: SECRET, ROUTEROS_DRIVER: "mock" } as NodeJS.ProcessEnv);
    const client = await createRouterOsClient(cfg);
    expect(client).toBeInstanceOf(MockRouterOsClient);
    expect(realClient.moduleLoads).toBe(0);
    expect(realClient.constructed).toBe(0);
    const health = await client.health();
    expect(health.board).toBe("mock");
    expect(await client.getProfile(DEFAULT_PROFILE_NAME)).not.toBeNull();
  });

  it("refuses a hand-built production + mock config (defence in depth)", async () => {
    const cfg = { ...loadConfig({ CONNECTOR_SECRET: SECRET, ROUTEROS_DRIVER: "mock" } as NodeJS.ProcessEnv), mode: "production" as const };
    await expect(createRouterOsClient(cfg)).rejects.toThrow(/not allowed when CONNECTOR_MODE=production/);
    expect(realClient.constructed).toBe(0);
  });

  it("real driver (default) constructs NodeRouterOsClient (spied; no connection)", async () => {
    const cfg = loadConfig({ CONNECTOR_SECRET: SECRET, CONNECTOR_MODE: "local" } as NodeJS.ProcessEnv);
    const client = await createRouterOsClient(cfg);
    expect(client).not.toBeInstanceOf(MockRouterOsClient);
    expect(realClient.constructed).toBe(1);
  });

  it("dev mock seeds only the RouterOS default profile", () => {
    const client = createDevMockRouterOsClient();
    expect([...client.profiles.keys()]).toEqual([DEFAULT_PROFILE_NAME]);
    expect(client.users.size).toBe(0);
  });
});

describe("connector HTTP API through ROUTEROS_DRIVER=mock", () => {
  async function buildMockApp() {
    realClient.moduleLoads = 0;
    realClient.constructed = 0;
    const cfg = loadConfig({
      CONNECTOR_SECRET: SECRET,
      CONNECTOR_MODE: "local",
      ROUTEROS_DRIVER: "mock"
    } as NodeJS.ProcessEnv);
    const client = await createRouterOsClient(cfg);
    return { app: createApp(cfg, client), client };
  }

  const auth = { Authorization: `Bearer ${SECRET}` };
  const jsonAuth = { ...auth, "Content-Type": "application/json" };

  it("serves process health and authenticated deep health from the mock", async () => {
    const { app } = await buildMockApp();
    expect((await app.request("/health")).status).toBe(200);

    expect((await app.request("/v1/health")).status).toBe(401);

    const res = await app.request("/v1/health", { headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.data.routeros).toBe("reachable");
    expect(body.data.board).toBe("mock");
    expect(body.data.routerosDriver).toBe("mock");
    expect(body.data.mikrotikHost).toBe("mock (in-memory)");
    expect(body.data).not.toHaveProperty("mikrotikApiPort");
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(realClient.constructed).toBe(0);
  });

  it("creates, disables, enables and removes a resident HotSpot user end to end", async () => {
    const { app, client } = await buildMockApp();
    const username = "KSM-RES-9001";

    const created = await app.request("/v1/users", {
      method: "POST",
      headers: jsonAuth,
      body: JSON.stringify({ username, password: "mock-only-password" })
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { ok: boolean; data: { created: boolean; user: { profile: string } } };
    expect(createdBody.data.created).toBe(true);
    expect(createdBody.data.user.profile).toBe(RESIDENT_PROFILE_NAME);
    expect(JSON.stringify(createdBody)).not.toContain("mock-only-password");

    const again = await app.request("/v1/users", {
      method: "POST",
      headers: jsonAuth,
      body: JSON.stringify({ username, password: "mock-only-password" })
    });
    expect(again.status).toBe(200);

    const disabled = await app.request(`/v1/users/${username}/disable`, { method: "POST", headers: auth });
    expect(disabled.status).toBe(200);
    const fetched = await app.request(`/v1/users/${username}`, { headers: auth });
    expect(((await fetched.json()) as { data: { disabled: boolean } }).data.disabled).toBe(true);

    const enabled = await app.request(`/v1/users/${username}/enable`, { method: "POST", headers: auth });
    expect(enabled.status).toBe(200);
    expect((client as MockRouterOsClient).users.get(username)?.disabled).toBe(false);

    const removed = await app.request(`/v1/users/${username}`, { method: "DELETE", headers: auth });
    expect(removed.status).toBe(200);
    expect((await app.request(`/v1/users/${username}`, { headers: auth })).status).toBe(404);

    // Default profile untouched; resident profile created with shared-users=3.
    const mock = client as MockRouterOsClient;
    expect(mock.profiles.get(DEFAULT_PROFILE_NAME)?.sharedUsers).toBe(1);
    expect(mock.profiles.get(RESIDENT_PROFILE_NAME)?.sharedUsers).toBe(3);
    expect(realClient.moduleLoads).toBe(0);
    expect(realClient.constructed).toBe(0);
  });
});
