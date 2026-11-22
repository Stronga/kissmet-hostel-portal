import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Full HTTP API coverage against the in-memory RouterOS mock only.
 *
 * Safety: the real RouterOS client module and node-routeros are replaced with
 * stubs that throw, so nothing in this file can open a socket to a router.
 * The app is built via loadConfig(ROUTEROS_DRIVER=mock) + createRouterOsClient,
 * i.e. the same P0 factory path `npm run dev` uses in mock mode.
 */
const realClient = vi.hoisted(() => ({ moduleLoads: 0, constructed: 0 }));

vi.mock("../src/routeros/node-client.js", () => {
  realClient.moduleLoads += 1;
  class NodeRouterOsClient {
    constructor() {
      realClient.constructed += 1;
      throw new Error("real RouterOS client must not be constructed in tests");
    }
  }
  return { NodeRouterOsClient };
});

vi.mock("node-routeros", () => {
  class RouterOSAPI {
    constructor() {
      throw new Error("node-routeros must not be constructed in tests");
    }
  }
  return { RouterOSAPI };
});

import { createApp } from "../src/app.js";
import { DEFAULT_PROFILE_NAME, RESIDENT_PROFILE_NAME, RESIDENT_SHARED_USERS, loadConfig } from "../src/config.js";
import type { ConnectorConfig } from "../src/config.js";
import { createRouterOsClient } from "../src/routeros/client-factory.js";
import { MockRouterOsClient } from "../src/routeros/mock-client.js";
import type { RouterOsClient } from "../src/routeros/types.js";
import { RouterOsUnavailableError } from "../src/routeros/types.js";
import { log } from "../src/logger.js";

const SECRET = "api-mock-connector-secret-at-least-32-chars";
const USER = "KSM-RES-0420";
const PASSWORD = "initial-mock-password-123";
const NEW_PASSWORD = "rotated-mock-password-456";

type LogSpy = ReturnType<typeof vi.spyOn>;
let logSpies: LogSpy[] = [];

beforeEach(() => {
  logSpies = [
    vi.spyOn(log, "info").mockImplementation(() => undefined),
    vi.spyOn(log, "warn").mockImplementation(() => undefined),
    vi.spyOn(log, "error").mockImplementation(() => undefined)
  ];
});

function loggedText(): string {
  return JSON.stringify(logSpies.flatMap((s) => s.mock.calls));
}

async function buildMockApp(overrides: Record<string, string> = {}) {
  const config = loadConfig({
    CONNECTOR_SECRET: SECRET,
    CONNECTOR_MODE: "local",
    NODE_ENV: "test",
    ROUTEROS_DRIVER: "mock",
    ...overrides
  } as NodeJS.ProcessEnv);
  const client = (await createRouterOsClient(config)) as MockRouterOsClient;
  expect(client).toBeInstanceOf(MockRouterOsClient);
  return { app: createApp(config, client), client, config };
}

const auth = { Authorization: `Bearer ${SECRET}` };
const jsonAuth = { ...auth, "Content-Type": "application/json" };

type App = ReturnType<typeof createApp>;

async function createUser(app: App, username = USER, password = PASSWORD) {
  return app.request("/v1/users", {
    method: "POST",
    headers: jsonAuth,
    body: JSON.stringify({ username, password })
  });
}

async function json<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Every response body must be free of the connector secret and any password used in the test. */
function expectNoSecrets(text: string, extra: string[] = []) {
  for (const needle of [SECRET, PASSWORD, NEW_PASSWORD, "Bearer ", ...extra]) {
    expect(text).not.toContain(needle);
  }
}

/** Every /v1 route family, with a valid body where one is needed. */
const V1_ROUTES: Array<{ name: string; method: string; path: string; body?: unknown }> = [
  { name: "deep health", method: "GET", path: "/v1/health" },
  { name: "ensure profile", method: "POST", path: "/v1/ensureResidentProfile" },
  { name: "get user", method: "GET", path: `/v1/users/${USER}` },
  { name: "create user", method: "POST", path: "/v1/users", body: { username: USER, password: PASSWORD } },
  { name: "disable", method: "POST", path: `/v1/users/${USER}/disable` },
  { name: "enable", method: "POST", path: `/v1/users/${USER}/enable` },
  { name: "reset password", method: "POST", path: `/v1/users/${USER}/reset-password`, body: { password: NEW_PASSWORD } },
  { name: "delete", method: "DELETE", path: `/v1/users/${USER}` },
  { name: "sessions", method: "GET", path: `/v1/users/${USER}/sessions` },
  { name: "disconnect", method: "POST", path: `/v1/users/${USER}/disconnect` }
];

function routeInit(route: (typeof V1_ROUTES)[number], headers: Record<string, string>): RequestInit {
  return {
    method: route.method,
    headers: route.body ? { ...headers, "Content-Type": "application/json" } : headers,
    ...(route.body ? { body: JSON.stringify(route.body) } : {})
  };
}

describe("mock API: safety preconditions", () => {
  it("builds through the P0 factory without loading the real RouterOS client", async () => {
    realClient.moduleLoads = 0;
    realClient.constructed = 0;
    const { config } = await buildMockApp();
    expect(config.routerosDriver).toBe("mock");
    expect(realClient.moduleLoads).toBe(0);
    expect(realClient.constructed).toBe(0);
  });
});

describe("GET /health (process liveness)", () => {
  it("is public, does not touch RouterOS, and leaks no config", async () => {
    const { app, client } = await buildMockApp();
    client.failNext = true; // would blow up any RouterOS call
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await json<{ ok: boolean; data: Record<string, unknown> }>(res);
    expect(body.ok).toBe(true);
    expect(body.data).toMatchObject({ status: "up", service: "kissmet-mikrotik-connector", mode: "local" });
    expect(typeof body.data.uptimeSec).toBe("number");
    expect(client.failNext).toBe(true); // RouterOS was not called
    expectNoSecrets(JSON.stringify(body));
  });

  it("generates a correlation id when none is supplied", async () => {
    const { app } = await buildMockApp();
    const res = await app.request("/health");
    expect(res.headers.get("x-correlation-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("GET /v1/health (deep health)", () => {
  it("returns mock router identity without host, port or secrets", async () => {
    const { app } = await buildMockApp({ MIKROTIK_HOST: "10.99.99.1", MIKROTIK_API_PASSWORD: "never-used-pass" });
    const res = await app.request("/v1/health", { headers: { ...auth, "x-correlation-id": "corr-deep-1" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-correlation-id")).toBe("corr-deep-1");
    const body = await json<{ ok: boolean; data: Record<string, unknown> }>(res);
    expect(body.data).toMatchObject({ process: "up", routeros: "reachable", board: "mock", routerosDriver: "mock" });
    const text = JSON.stringify(body);
    expectNoSecrets(text, ["10.99.99.1", "never-used-pass"]);
  });

  it("maps a mock failure to 503 with a fixed, sanitised message", async () => {
    const { app, client } = await buildMockApp();
    client.failNext = true;
    const res = await app.request("/v1/health", { headers: auth });
    expect(res.status).toBe(503);
    const body = await json<{ ok: boolean; error: Record<string, unknown> }>(res);
    expect(body).toEqual({
      ok: false,
      error: { code: "unavailable", message: "RouterOS path unavailable", process: "up", routeros: "unreachable" }
    });
  });
});

describe("POST /v1/ensureResidentProfile", () => {
  it("creates Kissmet-Residents with shared-users=3 on a fresh router", async () => {
    const { app, client } = await buildMockApp();
    const res = await app.request("/v1/ensureResidentProfile", { method: "POST", headers: auth });
    expect(res.status).toBe(200);
    const body = await json<{ ok: boolean; data: { created: boolean; profile: { name: string; sharedUsers: number } } }>(res);
    expect(body.data.created).toBe(true);
    expect(body.data.profile).toMatchObject({ name: RESIDENT_PROFILE_NAME, sharedUsers: RESIDENT_SHARED_USERS });
    expect(client.profiles.get(RESIDENT_PROFILE_NAME)?.sharedUsers).toBe(3);
  });

  it("is idempotent: second call returns the same profile and creates nothing", async () => {
    const { app, client } = await buildMockApp();
    const first = await json<{ data: { profile: { id: string } } }>(
      await app.request("/v1/ensureResidentProfile", { method: "POST", headers: auth })
    );
    const snapshot = structuredClone([...client.profiles.entries()]);
    const createSpy = vi.spyOn(client, "createProfile");

    const res = await app.request("/v1/ensureResidentProfile", { method: "POST", headers: auth });
    expect(res.status).toBe(200);
    const second = await json<{ data: { created: boolean; profile: { id: string; sharedUsers: number } } }>(res);
    expect(second.data.created).toBe(false);
    expect(second.data.profile.id).toBe(first.data.profile.id);
    expect(createSpy).not.toHaveBeenCalled();
    expect([...client.profiles.entries()]).toEqual(snapshot);
  });

  it("never modifies the RouterOS default profile (repeated calls)", async () => {
    const { app, client } = await buildMockApp();
    const before = structuredClone(client.profiles.get(DEFAULT_PROFILE_NAME));
    for (let i = 0; i < 3; i++) {
      await app.request("/v1/ensureResidentProfile", { method: "POST", headers: auth });
    }
    expect(client.profiles.get(DEFAULT_PROFILE_NAME)).toEqual(before);
    expect([...client.profiles.keys()].sort()).toEqual([DEFAULT_PROFILE_NAME, RESIDENT_PROFILE_NAME].sort());
  });

  it("does not create a default profile when the router has none", async () => {
    const { app, client } = await buildMockApp();
    client.profiles.delete(DEFAULT_PROFILE_NAME);
    const res = await app.request("/v1/ensureResidentProfile", { method: "POST", headers: auth });
    expect(res.status).toBe(200);
    expect(client.profiles.has(DEFAULT_PROFILE_NAME)).toBe(false);
    expect(client.profiles.has(RESIDENT_PROFILE_NAME)).toBe(true);
  });

  it("refuses (409) to alter a conflicting Kissmet-Residents profile", async () => {
    const { app, client } = await buildMockApp();
    client.profiles.set(RESIDENT_PROFILE_NAME, { id: "*7", name: RESIDENT_PROFILE_NAME, sharedUsers: 10 });
    const res = await app.request("/v1/ensureResidentProfile", { method: "POST", headers: auth });
    expect(res.status).toBe(409);
    expect((await json<{ error: { code: string } }>(res)).error.code).toBe("profile_conflict");
    expect(client.profiles.get(RESIDENT_PROFILE_NAME)?.sharedUsers).toBe(10);
  });
});

describe("POST /v1/users and GET /v1/users/:username", () => {
  it("creates a user on Kissmet-Residents with the default comment, and the password never leaves the mock", async () => {
    const { app, client } = await buildMockApp();
    const res = await createUser(app);
    expect(res.status).toBe(201);
    const text = await res.text();
    const body = JSON.parse(text) as { data: { created: boolean; user: Record<string, unknown> } };
    expect(body.data.created).toBe(true);
    expect(body.data.user).toMatchObject({ name: USER, profile: RESIDENT_PROFILE_NAME, disabled: false, comment: "Kissmet resident internet" });
    expect(client.passwords.get(USER)).toBe(PASSWORD);
    expectNoSecrets(text);
    expect(loggedText()).not.toContain(PASSWORD);
  });

  it("stores a custom comment", async () => {
    const { app, client } = await buildMockApp();
    const res = await app.request("/v1/users", {
      method: "POST",
      headers: jsonAuth,
      body: JSON.stringify({ username: USER, password: PASSWORD, comment: "Room 12B" })
    });
    expect(res.status).toBe(201);
    expect(client.users.get(USER)?.comment).toBe("Room 12B");
  });

  it("auto-ensures the resident profile before creating the user", async () => {
    const { app, client } = await buildMockApp();
    expect(client.profiles.has(RESIDENT_PROFILE_NAME)).toBe(false);
    await createUser(app);
    expect(client.profiles.get(RESIDENT_PROFILE_NAME)?.sharedUsers).toBe(3);
  });

  it("duplicate create is idempotent: 200, created=false, no duplicate, existing password kept", async () => {
    const { app, client } = await buildMockApp();
    await createUser(app);
    const createSpy = vi.spyOn(client, "createUser");
    const res = await createUser(app, USER, NEW_PASSWORD);
    expect(res.status).toBe(200);
    const body = await json<{ data: { created: boolean; user: { name: string } } }>(res);
    expect(body.data.created).toBe(false);
    expect(body.data.user.name).toBe(USER);
    expect(createSpy).not.toHaveBeenCalled();
    expect(client.users.size).toBe(1);
    // Current behaviour: a duplicate create does NOT rotate the password (use reset-password).
    expect(client.passwords.get(USER)).toBe(PASSWORD);
  });

  it("refuses to create a user (409) when Kissmet-Residents conflicts", async () => {
    const { app, client } = await buildMockApp();
    client.profiles.set(RESIDENT_PROFILE_NAME, { id: "*7", name: RESIDENT_PROFILE_NAME, sharedUsers: 1 });
    const res = await createUser(app);
    expect(res.status).toBe(409);
    expect(client.users.size).toBe(0);
  });

  it("GET returns the user without password fields", async () => {
    const { app } = await buildMockApp();
    await createUser(app);
    const res = await app.request(`/v1/users/${USER}`, { headers: auth });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text).data).toMatchObject({ name: USER, profile: RESIDENT_PROFILE_NAME });
    expect(text).not.toMatch(/password/i);
    expectNoSecrets(text);
  });

  it("GET unknown user returns 404 not_found", async () => {
    const { app } = await buildMockApp();
    const res = await app.request("/v1/users/KSM-RES-9999", { headers: auth });
    expect(res.status).toBe(404);
    expect((await json<{ error: { code: string } }>(res)).error.code).toBe("not_found");
  });

  it("there is no list-all-users route: GET /v1/users is 404", async () => {
    const { app } = await buildMockApp();
    const res = await app.request("/v1/users", { headers: auth });
    expect(res.status).toBe(404);
    // Note: the outer app.notFound ("Unknown route") answers, not api.notFound ("Unknown connector route").
    expect(await res.json()).toEqual({ ok: false, error: { code: "not_found", message: "Unknown route" } });
  });
});

describe("POST /v1/users/:username/disable and /enable", () => {
  it("disable then enable flips the flag and both are idempotent", async () => {
    const { app, client } = await buildMockApp();
    await createUser(app);
    const setSpy = vi.spyOn(client, "setUserDisabled");

    const d1 = await app.request(`/v1/users/${USER}/disable`, { method: "POST", headers: auth });
    expect(d1.status).toBe(200);
    expect((await json<{ data: { disabled: boolean } }>(d1)).data.disabled).toBe(true);
    const d2 = await app.request(`/v1/users/${USER}/disable`, { method: "POST", headers: auth });
    expect((await json<{ data: { disabled: boolean } }>(d2)).data.disabled).toBe(true);
    expect(setSpy).toHaveBeenCalledTimes(1);

    const e1 = await app.request(`/v1/users/${USER}/enable`, { method: "POST", headers: auth });
    expect((await json<{ data: { disabled: boolean } }>(e1)).data.disabled).toBe(false);
    const e2 = await app.request(`/v1/users/${USER}/enable`, { method: "POST", headers: auth });
    expect(e2.status).toBe(200);
    expect(setSpy).toHaveBeenCalledTimes(2);
    expect(client.users.get(USER)?.disabled).toBe(false);
  });

  it("disable does not alter password or profile", async () => {
    const { app, client } = await buildMockApp();
    await createUser(app);
    await app.request(`/v1/users/${USER}/disable`, { method: "POST", headers: auth });
    expect(client.passwords.get(USER)).toBe(PASSWORD);
    expect(client.users.get(USER)?.profile).toBe(RESIDENT_PROFILE_NAME);
  });
});

describe("POST /v1/users/:username/reset-password", () => {
  it("applies the new password in the mock and echoes neither password", async () => {
    const { app, client } = await buildMockApp();
    await createUser(app);
    const res = await app.request(`/v1/users/${USER}/reset-password`, {
      method: "POST",
      headers: jsonAuth,
      body: JSON.stringify({ password: NEW_PASSWORD })
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as { ok: boolean; data: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(Object.keys(body.data).sort()).toEqual(["comment", "disabled", "id", "name", "profile"]);
    expect(client.passwords.get(USER)).toBe(NEW_PASSWORD);
    expectNoSecrets(text);
    expect(loggedText()).not.toContain(NEW_PASSWORD);
    expect(loggedText()).not.toContain(PASSWORD);
  });

  it("rejects missing or empty password with 400 and leaves the old one", async () => {
    const { app, client } = await buildMockApp();
    await createUser(app);
    for (const body of [{}, { password: "" }]) {
      const res = await app.request(`/v1/users/${USER}/reset-password`, {
        method: "POST",
        headers: jsonAuth,
        body: JSON.stringify(body)
      });
      expect(res.status).toBe(400);
      expect((await json<{ error: { code: string } }>(res)).error.code).toBe("bad_request");
    }
    // Empty body is treated as {} → 400
    const empty = await app.request(`/v1/users/${USER}/reset-password`, { method: "POST", headers: jsonAuth });
    expect(empty.status).toBe(400);
    expect(client.passwords.get(USER)).toBe(PASSWORD);
  });
});

describe("GET /v1/users/:username/sessions and POST /disconnect", () => {
  const seed = (client: MockRouterOsClient) => {
    client.sessions.set(USER, [
      { id: "*A1", user: USER, address: "10.10.0.21", macAddress: "AA:BB:CC:00:00:01", uptime: "5m" },
      { id: "*A2", user: USER, address: "10.10.0.22", macAddress: "AA:BB:CC:00:00:02", uptime: "1h" }
    ]);
    client.sessions.set("KSM-RES-0421", [{ id: "*B1", user: "KSM-RES-0421", address: "10.10.0.30" }]);
  };

  it("lists only the requested user's active sessions", async () => {
    const { app, client } = await buildMockApp();
    await createUser(app);
    seed(client);
    const res = await app.request(`/v1/users/${USER}/sessions`, { headers: auth });
    expect(res.status).toBe(200);
    const body = await json<{ data: Array<{ id: string; user: string }> }>(res);
    expect(body.data.map((s) => s.id)).toEqual(["*A1", "*A2"]);
    expect(body.data.every((s) => s.user === USER)).toBe(true);
  });

  it("returns an empty list when the user has no sessions", async () => {
    const { app } = await buildMockApp();
    await createUser(app);
    const res = await app.request(`/v1/users/${USER}/sessions`, { headers: auth });
    expect(res.status).toBe(200);
    expect((await json<{ data: unknown[] }>(res)).data).toEqual([]);
  });

  it("disconnect removes all of the user's sessions and leaves other users alone", async () => {
    const { app, client } = await buildMockApp();
    await createUser(app);
    seed(client);
    const res = await app.request(`/v1/users/${USER}/disconnect`, { method: "POST", headers: auth });
    expect(res.status).toBe(200);
    expect((await json<{ data: { disconnected: number } }>(res)).data.disconnected).toBe(2);
    const after = await app.request(`/v1/users/${USER}/sessions`, { headers: auth });
    expect((await json<{ data: unknown[] }>(after)).data).toEqual([]);
    expect(client.sessions.get("KSM-RES-0421")).toHaveLength(1);
    // User account itself is untouched.
    expect(client.users.get(USER)?.disabled).toBe(false);
  });

  it("disconnect with no sessions is a successful no-op", async () => {
    const { app } = await buildMockApp();
    await createUser(app);
    const res = await app.request(`/v1/users/${USER}/disconnect`, { method: "POST", headers: auth });
    expect(res.status).toBe(200);
    expect((await json<{ data: { disconnected: number } }>(res)).data.disconnected).toBe(0);
  });
});

describe("DELETE /v1/users/:username", () => {
  it("removes the user, password and sessions", async () => {
    const { app, client } = await buildMockApp();
    await createUser(app);
    client.sessions.set(USER, [{ id: "*A1", user: USER }]);
    const res = await app.request(`/v1/users/${USER}`, { method: "DELETE", headers: auth });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, data: { removed: true } });
    expect(client.users.has(USER)).toBe(false);
    expect(client.passwords.has(USER)).toBe(false);
    expect(client.sessions.has(USER)).toBe(false);
    expect((await app.request(`/v1/users/${USER}`, { headers: auth })).status).toBe(404);
  });

  it("leaves the resident and default profiles in place", async () => {
    const { app, client } = await buildMockApp();
    await createUser(app);
    await app.request(`/v1/users/${USER}`, { method: "DELETE", headers: auth });
    expect(client.profiles.has(RESIDENT_PROFILE_NAME)).toBe(true);
    expect(client.profiles.has(DEFAULT_PROFILE_NAME)).toBe(true);
  });
});

describe("missing users", () => {
  for (const op of ["disable", "enable", "reset-password"] as const) {
    it(`${op} on a missing user returns 404 not_found`, async () => {
      const { app, client } = await buildMockApp();
      const res = await app.request(`/v1/users/KSM-RES-0000/${op}`, {
        method: "POST",
        headers: jsonAuth,
        body: op === "reset-password" ? JSON.stringify({ password: NEW_PASSWORD }) : undefined
      });
      expect(res.status).toBe(404);
      const text = await res.text();
      expect(JSON.parse(text).error.code).toBe("not_found");
      expectNoSecrets(text);
      expect(client.users.size).toBe(0);
    });
  }

  // Current, intentional-looking behaviour (matches NodeRouterOsClient: removeUser returns early,
  // listActiveSessions filters by user): these are idempotent successes, NOT 404.
  it("DELETE on a missing user is an idempotent 200 (not 404) — current behaviour", async () => {
    const { app } = await buildMockApp();
    const res = await app.request("/v1/users/KSM-RES-0000", { method: "DELETE", headers: auth });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, data: { removed: true } });
  });

  it("sessions on a missing user returns 200 [] (not 404) — current behaviour", async () => {
    const { app } = await buildMockApp();
    const res = await app.request("/v1/users/KSM-RES-0000/sessions", { headers: auth });
    expect(res.status).toBe(200);
    expect((await json<{ data: unknown[] }>(res)).data).toEqual([]);
  });

  it("disconnect on a missing user returns 200 disconnected=0 (not 404) — current behaviour", async () => {
    const { app } = await buildMockApp();
    const res = await app.request("/v1/users/KSM-RES-0000/disconnect", { method: "POST", headers: auth });
    expect(res.status).toBe(200);
    expect((await json<{ data: { disconnected: number } }>(res)).data.disconnected).toBe(0);
  });
});

describe("authentication on every /v1 route family", () => {
  const badHeaders: Array<[string, Record<string, string>]> = [
    ["missing Authorization", {}],
    ["wrong secret, same length", { Authorization: `Bearer ${"x".repeat(SECRET.length)}` }],
    ["wrong secret, different length", { Authorization: "Bearer short" }],
    ["secret prefix only", { Authorization: `Bearer ${SECRET.slice(0, -1)}` }],
    ["secret with extra suffix", { Authorization: `Bearer ${SECRET}x` }],
    ["empty bearer", { Authorization: "Bearer " }],
    ["Basic scheme", { Authorization: `Basic ${SECRET}` }],
    ["lower-case bearer scheme", { Authorization: `bearer ${SECRET}` }],
    ["raw secret without scheme", { Authorization: SECRET }],
    ["secret in a non-Authorization header", { "X-Connector-Secret": SECRET }]
  ];

  for (const route of V1_ROUTES) {
    it(`${route.method} ${route.path} (${route.name}) rejects all bad credentials with 401 and no side effects`, async () => {
      const { app, client } = await buildMockApp();
      client.users.set(USER, { id: "*1", name: USER, profile: RESIDENT_PROFILE_NAME, disabled: false });
      client.passwords.set(USER, PASSWORD);
      client.sessions.set(USER, [{ id: "*S1", user: USER }]);
      const before = JSON.stringify({
        p: [...client.profiles],
        u: [...client.users],
        s: [...client.sessions],
        pw: [...client.passwords]
      });

      for (const [, headers] of badHeaders) {
        const res = await app.request(route.path, routeInit(route, headers));
        expect(res.status).toBe(401);
        const text = await res.text();
        expect(JSON.parse(text)).toEqual({ ok: false, error: { code: "unauthorized", message: "Unauthorized" } });
        expectNoSecrets(text);
      }

      const after = JSON.stringify({
        p: [...client.profiles],
        u: [...client.users],
        s: [...client.sessions],
        pw: [...client.passwords]
      });
      expect(after).toBe(before);
    });
  }

  for (const param of ["secret", "token", "Authorization"]) {
    it(`rejects ?${param}= in the query string even with a valid Bearer header`, async () => {
      const { app } = await buildMockApp();
      for (const route of V1_ROUTES) {
        const res = await app.request(`${route.path}?${param}=${encodeURIComponent(SECRET)}`, routeInit(route, auth));
        expect(res.status).toBe(401);
        expectNoSecrets(await res.text());
      }
    });
  }

  it("rejects query-string secret without a header too", async () => {
    const { app } = await buildMockApp();
    const res = await app.request(`/v1/health?secret=${encodeURIComponent(SECRET)}`);
    expect(res.status).toBe(401);
  });
});

describe("input validation", () => {
  it("POST /v1/users requires username and password (400)", async () => {
    const { app, client } = await buildMockApp();
    const bodies = [{}, { username: USER }, { password: PASSWORD }, { username: "", password: PASSWORD }, { username: USER, password: "" }];
    for (const body of bodies) {
      const res = await app.request("/v1/users", { method: "POST", headers: jsonAuth, body: JSON.stringify(body) });
      expect(res.status).toBe(400);
      const text = await res.text();
      expect(JSON.parse(text).error).toEqual({ code: "bad_request", message: "username and password required" });
      expectNoSecrets(text);
    }
    // SECURITY F1/F2: a JSON array is not an object body → fixed invalid_body.
    const arr = await app.request("/v1/users", { method: "POST", headers: jsonAuth, body: "[]" });
    expect(arr.status).toBe(400);
    expect((await json<{ error: unknown }>(arr)).error).toEqual({ code: "invalid_body", message: "JSON body must be an object" });
    expect(client.users.size).toBe(0);
  });

  it("POST /v1/users with an empty body is 400", async () => {
    const { app } = await buildMockApp();
    const res = await app.request("/v1/users", { method: "POST", headers: jsonAuth });
    expect(res.status).toBe(400);
  });

  it("malformed JSON is 400 invalid_json and nothing is created", async () => {
    const { app, client } = await buildMockApp();
    for (const raw of ['{"username": "KSM-RES-0420", ', "not json", "{'username':'x'}"]) {
      const res = await app.request("/v1/users", { method: "POST", headers: jsonAuth, body: raw });
      expect(res.status).toBe(400);
      expect((await json<{ error: unknown }>(res)).error).toEqual({ code: "invalid_json", message: "Malformed JSON body" });
    }
    const reset = await app.request(`/v1/users/${USER}/reset-password`, { method: "POST", headers: jsonAuth, body: "{" });
    expect(reset.status).toBe(400);
    expect(client.users.size).toBe(0);
  });

  it("SECURITY F2: JSON null / non-object bodies are 400 invalid_body with a fixed message (no TypeError text)", async () => {
    const { app, client } = await buildMockApp();
    for (const raw of ["null", "42", '"KSM-RES-0420"', "true", "[]", '[{"username":"KSM-RES-0420"}]']) {
      for (const path of ["/v1/users", `/v1/users/${USER}/reset-password`]) {
        const res = await app.request(path, { method: "POST", headers: jsonAuth, body: raw });
        expect(res.status).toBe(400);
        const text = await res.text();
        expect(JSON.parse(text)).toEqual({ ok: false, error: { code: "invalid_body", message: "JSON body must be an object" } });
        expect(text).not.toMatch(/Cannot read|TypeError|properties of|at .*\.ts/);
      }
    }
    expect(client.users.size).toBe(0);
  });

  it("SECURITY F3: malformed JSON never echoes the body (leakypassword9)", async () => {
    const { app, client } = await buildMockApp();
    const leakyPassword = "leakypassword9";
    const res = await app.request("/v1/users/KSM-RES-0420/reset-password", {
      method: "POST",
      headers: jsonAuth,
      body: leakyPassword // not valid JSON
    });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: false, error: { code: "invalid_json", message: "Malformed JSON body" } });
    expect(text).not.toContain(leakyPassword);
    expect(text).not.toContain("leaky");
    expect(client.passwords.size).toBe(0);
  });

  it("SECURITY F3: malformed JSON variants with secret-like content never echo any of it", async () => {
    const { app } = await buildMockApp();
    const needles = ["sk_live_ABCDEF123456", "hunter2hunter2", SECRET, "Bearer zzz", "p@ss=word", "KSM-RES-0420"];
    const raws = [
      `{"password": "sk_live_ABCDEF123456"`,
      `hunter2hunter2`,
      `{"password": ${SECRET}}`,
      `Bearer zzz`,
      `{"username":"KSM-RES-0420","password":"p@ss=word",}`,
      `{"password": 'hunter2hunter2'}`,
      `\u0000hunter2hunter2`
    ];
    for (const raw of raws) {
      for (const path of ["/v1/users", `/v1/users/${USER}/reset-password`]) {
        const res = await app.request(path, { method: "POST", headers: jsonAuth, body: raw });
        expect(res.status).toBe(400);
        const text = await res.text();
        expect(JSON.parse(text).error.code).toBe("invalid_json");
        for (const n of needles) expect(text).not.toContain(n);
        expect(text).not.toMatch(/Unexpected|position|JSON at|SyntaxError/);
      }
    }
    expect(loggedText()).not.toContain("hunter2hunter2");
  });

  it("SECURITY F1: non-string username/password types are rejected with 400 and nothing is created", async () => {
    const { app, client } = await buildMockApp();
    const getUser = vi.spyOn(client, "getUser");
    const cases: Array<[unknown, unknown, string]> = [
      [12345, PASSWORD, "invalid_username"],
      [{ nested: true }, PASSWORD, "invalid_username"],
      [["KSM-RES-0420"], PASSWORD, "invalid_username"],
      [true, PASSWORD, "invalid_username"],
      [USER, { nested: true }, "invalid_password"],
      [USER, 12345678, "invalid_password"],
      [USER, ["x".repeat(10)], "invalid_password"],
      [USER, true, "invalid_password"]
    ];
    for (const [username, password, code] of cases) {
      const res = await app.request("/v1/users", {
        method: "POST",
        headers: jsonAuth,
        body: JSON.stringify({ username, password })
      });
      expect(res.status).toBe(400);
      expect((await json<{ error: { code: string } }>(res)).error.code).toBe(code);
    }
    expect(client.users.size).toBe(0);
    expect(getUser).not.toHaveBeenCalled();
  });

  it("SECURITY F1b: the connector enforces the Worker's KSM-RES- format (admin etc. rejected, never reach RouterOS)", async () => {
    const { app, client } = await buildMockApp();
    const touched = [vi.spyOn(client, "getUser"), vi.spyOn(client, "createUser"), vi.spyOn(client, "getProfile")];
    for (const name of ["admin", "default", "portal-api", "ksm-res-0420", "KSM-RES-", "RES-0420", "KSM-RES-04_20"]) {
      const res = await createUser(app, name, PASSWORD);
      expect(res.status).toBe(400);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ ok: false, error: { code: "invalid_username", message: "Invalid username" } });
      if (name.length > 3) expect(text).not.toContain(name);
    }
    expect(client.users.size).toBe(0);
    for (const spy of touched) expect(spy).not.toHaveBeenCalled();
  });
});

describe("body size limit", () => {
  it("413 when Content-Length exceeds MAX_BODY_BYTES, before the body is parsed", async () => {
    const { app, client } = await buildMockApp({ MAX_BODY_BYTES: "256" });
    const body = JSON.stringify({ username: USER, password: "p".repeat(400) });
    const res = await app.request("/v1/users", {
      method: "POST",
      headers: { ...jsonAuth, "content-length": String(body.length) },
      body
    });
    expect(res.status).toBe(413);
    expect((await json<{ error: { code: string } }>(res)).error.code).toBe("payload_too_large");
    expect(client.users.size).toBe(0);
  });

  it("413 when the actual body exceeds the limit even without a Content-Length header", async () => {
    const { app, client } = await buildMockApp({ MAX_BODY_BYTES: "256" });
    const res = await app.request(`/v1/users/${USER}/reset-password`, {
      method: "POST",
      headers: jsonAuth,
      body: JSON.stringify({ password: "p".repeat(400) })
    });
    expect(res.status).toBe(413);
    expect(client.passwords.size).toBe(0);
  });

  it("a body exactly at the limit is accepted", async () => {
    // Limit 128 (was 256) so the filler password stays within PASSWORD_MAX_LENGTH (128).
    const { app } = await buildMockApp({ MAX_BODY_BYTES: "128" });
    const base = JSON.stringify({ username: USER, password: "" });
    const body = JSON.stringify({ username: USER, password: "p".repeat(128 - base.length) });
    expect(body.length).toBe(128);
    const res = await app.request("/v1/users", { method: "POST", headers: jsonAuth, body });
    expect(res.status).toBe(201);
  });
});

describe("RouterOS failure mapping", () => {
  /** Wrap the mock so every RouterOS call throws like NodeRouterOsClient does on socket/write failure. */
  function unavailable(client: MockRouterOsClient): RouterOsClient {
    return new Proxy(client, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== "function") return value;
        return async () => {
          // Message deliberately contains host + credential-looking text; it must never reach the client.
          throw new RouterOsUnavailableError("connect ECONNREFUSED 10.99.99.1:8728 user=portal-api password=hunter2");
        };
      }
    });
  }

  const opRoutes = V1_ROUTES.filter((r) => r.name !== "deep health");

  for (const route of opRoutes) {
    it(`${route.method} ${route.path} (${route.name}) → 503 unavailable with a fixed message`, async () => {
      const { config, client } = await buildMockApp();
      const app = createApp(config as ConnectorConfig, unavailable(client));
      const res = await app.request(route.path, routeInit(route, auth));
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ ok: false, error: { code: "unavailable", message: "RouterOS unavailable" } });
      expectNoSecrets(text, ["10.99.99.1", "hunter2", "portal-api", "ECONNREFUSED", "stack"]);
    });
  }

  it("deep health → 503 with no host/credential detail", async () => {
    const { config, client } = await buildMockApp();
    const app = createApp(config as ConnectorConfig, unavailable(client));
    const res = await app.request("/v1/health", { headers: auth });
    expect(res.status).toBe(503);
    expectNoSecrets(await res.text(), ["10.99.99.1", "hunter2", "portal-api", "ECONNREFUSED"]);
  });

  it("SECURITY F2: an unexpected (non-RouterOS) error is 500 internal_error with only a correlation id", async () => {
    // MockRouterOsClient.failNext throws a plain Error (NodeRouterOsClient would throw
    // RouterOsUnavailableError → 503). Plain errors are now "unexpected": generic 500, no message.
    const { app, client } = await buildMockApp();
    client.failNext = true;
    const res = await app.request("/v1/ensureResidentProfile", { method: "POST", headers: { ...auth, "x-correlation-id": "corr-500" } });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      ok: false,
      error: { code: "internal_error", message: "Internal error", correlationId: "corr-500" }
    });
    expect(text).not.toContain("Simulated");
    expectNoSecrets(text);
    expect(client.failNext).toBe(false); // one-shot
    expect((await app.request("/v1/ensureResidentProfile", { method: "POST", headers: auth })).status).toBe(200);
  });

  it("a failure mid-create leaves no partial user behind", async () => {
    const { app, client } = await buildMockApp();
    await app.request("/v1/ensureResidentProfile", { method: "POST", headers: auth });
    vi.spyOn(client, "createUser").mockRejectedValueOnce(new RouterOsUnavailableError("write failed"));
    const res = await createUser(app);
    expect(res.status).toBe(503);
    expect(client.users.size).toBe(0);
    expect(client.passwords.size).toBe(0);
  });

  it("errors are logged without passwords or the connector secret", async () => {
    const { config, client } = await buildMockApp();
    const app = createApp(config as ConnectorConfig, unavailable(client));
    await createUser(app);
    await app.request(`/v1/users/${USER}/reset-password`, {
      method: "POST",
      headers: jsonAuth,
      body: JSON.stringify({ password: NEW_PASSWORD })
    });
    const logs = loggedText();
    expect(logs).not.toContain(PASSWORD);
    expect(logs).not.toContain(NEW_PASSWORD);
    expect(logs).not.toContain(SECRET);
  });
});

describe("rate limiting (deterministic, in-process)", () => {
  it("returns 429 after RATE_LIMIT_MAX requests in the window", async () => {
    const { app } = await buildMockApp({ RATE_LIMIT_MAX: "3", RATE_LIMIT_WINDOW_MS: "60000" });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      statuses.push((await app.request("/v1/health", { headers: auth })).status);
    }
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
  });

  it("does not rate-limit public /health", async () => {
    const { app } = await buildMockApp({ RATE_LIMIT_MAX: "1" });
    for (let i = 0; i < 5; i++) {
      expect((await app.request("/health")).status).toBe(200);
    }
  });

  it("SECURITY F4: unauthenticated requests do not consume the authenticated budget", async () => {
    const { app } = await buildMockApp({ RATE_LIMIT_MAX: "2", AUTH_FAIL_RATE_LIMIT_MAX: "50" });
    for (let i = 0; i < 10; i++) expect((await app.request("/v1/health")).status).toBe(401);
    expect((await app.request("/v1/health", { headers: auth })).status).toBe(200);
    expect((await app.request("/v1/health", { headers: auth })).status).toBe(200);
    expect((await app.request("/v1/health", { headers: auth })).status).toBe(429);
  });

  it("SECURITY F4: rotating spoofed X-Forwarded-For / X-Real-IP / CF-Connecting-IP never yields a fresh bucket (TRUST_PROXY off)", async () => {
    const { app } = await buildMockApp({ RATE_LIMIT_MAX: "1" });
    expect((await app.request("/v1/health", { headers: { ...auth, "x-forwarded-for": "1.1.1.1" } })).status).toBe(200);
    for (let i = 2; i < 12; i++) {
      const res = await app.request("/v1/health", {
        headers: {
          ...auth,
          "x-forwarded-for": `${i}.${i}.${i}.${i}`,
          "x-real-ip": `10.0.0.${i}`,
          "cf-connecting-ip": `172.16.0.${i}`
        }
      });
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
    }
  });

  it("SECURITY F4: spoofed headers cannot reset the failed-auth lockout either", async () => {
    const { app } = await buildMockApp({ AUTH_FAIL_RATE_LIMIT_MAX: "3" });
    for (let i = 0; i < 3; i++) {
      expect((await app.request("/v1/health", { headers: { Authorization: "Bearer wrong", "x-forwarded-for": `9.9.9.${i}` } })).status).toBe(401);
    }
    const locked = await app.request("/v1/health", { headers: { Authorization: "Bearer wrong", "x-forwarded-for": "8.8.8.8" } });
    expect(locked.status).toBe(429);
    expect(await locked.json()).toEqual({ ok: false, error: { code: "rate_limited", message: "Too many requests" } });
  });

  it("SECURITY F4: after AUTH_FAIL_RATE_LIMIT_MAX failures the key is locked out for the window, even with the right secret", async () => {
    const { app, client } = await buildMockApp({ AUTH_FAIL_RATE_LIMIT_MAX: "2" });
    const health = vi.spyOn(client, "health");
    expect((await app.request("/v1/health", { headers: { Authorization: "Bearer a" } })).status).toBe(401);
    expect((await app.request("/v1/health", { headers: { Authorization: "Bearer b" } })).status).toBe(401);
    // Lockout: no token comparison, no feedback for guessing — intentional (same key).
    expect((await app.request("/v1/health", { headers: auth })).status).toBe(429);
    expect(health).not.toHaveBeenCalled();
  });

  it("SECURITY F4: an unauthenticated flood from one socket does not block a valid client on another socket", async () => {
    const { app } = await buildMockApp({ AUTH_FAIL_RATE_LIMIT_MAX: "3", RATE_LIMIT_MAX: "5" });
    const attacker = { incoming: { socket: { remoteAddress: "203.0.113.9" } } };
    const worker = { incoming: { socket: { remoteAddress: "198.51.100.7" } } };
    for (let i = 0; i < 20; i++) {
      const res = await app.request("/v1/health", { headers: { "x-forwarded-for": "198.51.100.7" } }, attacker);
      expect([401, 429]).toContain(res.status);
    }
    expect((await app.request("/v1/health", { headers: auth }, attacker)).status).toBe(429);
    for (let i = 0; i < 5; i++) {
      expect((await app.request("/v1/health", { headers: auth }, worker)).status).toBe(200);
    }
  });

  it("SECURITY F4: buckets are keyed by the socket address (getConnInfo)", async () => {
    const { app } = await buildMockApp({ RATE_LIMIT_MAX: "1" });
    const a = { incoming: { socket: { remoteAddress: "192.0.2.1" } } };
    const b = { incoming: { socket: { remoteAddress: "192.0.2.2" } } };
    expect((await app.request("/v1/health", { headers: auth }, a)).status).toBe(200);
    expect((await app.request("/v1/health", { headers: auth }, a)).status).toBe(429);
    expect((await app.request("/v1/health", { headers: auth }, b)).status).toBe(200);
  });
});

describe("TRUST_PROXY (opt-in, for cloudflared / local reverse proxy)", () => {
  const loopback = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };

  it("defaults to off and rejects unsupported values at startup", () => {
    const base = { CONNECTOR_SECRET: SECRET, CONNECTOR_MODE: "local", ROUTEROS_DRIVER: "mock" };
    expect(loadConfig(base as NodeJS.ProcessEnv).trustProxy).toBe(false);
    expect(loadConfig({ ...base, TRUST_PROXY: "true" } as NodeJS.ProcessEnv).trustProxy).toBe(true);
    expect(loadConfig({ ...base, TRUST_PROXY: "0" } as NodeJS.ProcessEnv).trustProxy).toBe(false);
    expect(() => loadConfig({ ...base, TRUST_PROXY: "maybe" } as NodeJS.ProcessEnv)).toThrow(/TRUST_PROXY/);
    expect(() => loadConfig({ ...base, AUTH_FAIL_RATE_LIMIT_MAX: "0" } as NodeJS.ProcessEnv)).toThrow(/AUTH_FAIL_RATE_LIMIT_MAX/);
    expect(() => loadConfig({ ...base, AUTH_FAIL_RATE_LIMIT_MAX: "abc" } as NodeJS.ProcessEnv)).toThrow(/AUTH_FAIL_RATE_LIMIT_MAX/);
  });

  it("off: everything from 127.0.0.1 shares one bucket (documented cloudflared trade-off)", async () => {
    const { app } = await buildMockApp({ RATE_LIMIT_MAX: "1" });
    expect((await app.request("/v1/health", { headers: { ...auth, "cf-connecting-ip": "203.0.113.1" } }, loopback)).status).toBe(200);
    expect((await app.request("/v1/health", { headers: { ...auth, "cf-connecting-ip": "203.0.113.2" } }, loopback)).status).toBe(429);
  });

  it("on: keys by CF-Connecting-IP, so an attacker's failures do not lock out the Worker", async () => {
    const { app } = await buildMockApp({ TRUST_PROXY: "true", AUTH_FAIL_RATE_LIMIT_MAX: "2" });
    for (let i = 0; i < 5; i++) {
      await app.request("/v1/health", { headers: { Authorization: "Bearer guess", "cf-connecting-ip": "203.0.113.66" } }, loopback);
    }
    expect((await app.request("/v1/health", { headers: { ...auth, "cf-connecting-ip": "203.0.113.66" } }, loopback)).status).toBe(429);
    expect((await app.request("/v1/health", { headers: { ...auth, "cf-connecting-ip": "2a06:98c0:3600::103" } }, loopback)).status).toBe(200);
  });

  it("on: without CF-Connecting-IP uses the RIGHT-MOST X-Forwarded-For hop (client-prepended hops are ignored)", async () => {
    const { app } = await buildMockApp({ TRUST_PROXY: "true", RATE_LIMIT_MAX: "1" });
    expect((await app.request("/v1/health", { headers: { ...auth, "x-forwarded-for": "1.1.1.1, 198.51.100.20" } }, loopback)).status).toBe(200);
    // Attacker rotates the left-most (spoofable) hop; the proxy-appended right-most hop is the same → same bucket.
    expect((await app.request("/v1/health", { headers: { ...auth, "x-forwarded-for": "2.2.2.2, 198.51.100.20" } }, loopback)).status).toBe(429);
    expect((await app.request("/v1/health", { headers: { ...auth, "x-forwarded-for": "198.51.100.21" } }, loopback)).status).toBe(200);
  });

  it("on: non-IP header values are ignored and fall back to the socket address", async () => {
    const { app } = await buildMockApp({ TRUST_PROXY: "true", RATE_LIMIT_MAX: "1" });
    expect((await app.request("/v1/health", { headers: { ...auth, "cf-connecting-ip": "evil<script>" } }, loopback)).status).toBe(200);
    expect((await app.request("/v1/health", { headers: { ...auth, "cf-connecting-ip": "not an ip" } }, loopback)).status).toBe(429);
  });
});
