import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Security regression tests for F1–F4 (input validation, error sanitisation, JSON errors,
 * rate limiting). In-memory RouterOS mock ONLY: the real client and node-routeros are stubbed
 * to throw, so nothing here can open a socket to a router.
 */
vi.mock("../src/routeros/node-client.js", () => {
  class NodeRouterOsClient {
    constructor() {
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
import { loadConfig } from "../src/config.js";
import { createRouterOsClient } from "../src/routeros/client-factory.js";
import { MockRouterOsClient } from "../src/routeros/mock-client.js";
import { log } from "../src/logger.js";
import {
  COMMENT_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  RESIDENT_USERNAME_PATTERN,
  USERNAME_MAX_LENGTH,
  isValidComment,
  isValidHotspotPassword,
  isValidResidentUsername
} from "../src/validation.js";

const SECRET = "security-mock-connector-secret-at-least-32-chars";
const PASSWORD = "Wk7!pQ2#zR9$mN4@xT"; // 18 chars from the Worker's generateHotspotPassword alphabet
const auth = { Authorization: `Bearer ${SECRET}` };
const jsonAuth = { ...auth, "Content-Type": "application/json" };

let logSpies: Array<ReturnType<typeof vi.spyOn>> = [];
beforeEach(() => {
  logSpies = [
    vi.spyOn(log, "info").mockImplementation(() => undefined),
    vi.spyOn(log, "warn").mockImplementation(() => undefined),
    vi.spyOn(log, "error").mockImplementation(() => undefined)
  ];
  for (const spy of logSpies) spy.mockClear(); // spyOn reuses an existing spy; start each test clean
});
const loggedText = () => JSON.stringify(logSpies.flatMap((s) => s.mock.calls));

async function buildMockApp(overrides: Record<string, string> = {}) {
  const config = loadConfig({
    CONNECTOR_SECRET: SECRET,
    CONNECTOR_MODE: "local",
    NODE_ENV: "test",
    ROUTEROS_DRIVER: "mock",
    ...overrides
  } as NodeJS.ProcessEnv);
  const client = (await createRouterOsClient(config)) as MockRouterOsClient;
  return { app: createApp(config, client), client, config };
}

/** Spy every RouterOS client method so tests can prove "no RouterOS call". */
function spyAll(client: MockRouterOsClient) {
  const names = [
    "health",
    "getProfile",
    "createProfile",
    "getUser",
    "createUser",
    "setUserDisabled",
    "setUserPassword",
    "removeUser",
    "listActiveSessions",
    "disconnectSessions"
  ] as const;
  return names.map((n) => vi.spyOn(client, n));
}

const INVALID_USERNAMES: Array<[string, string]> = [
  ["empty", ""],
  ["space", " "],
  ["admin", "admin"],
  ["ADMIN", "ADMIN"],
  ["default", "default"],
  ["portal-api", "portal-api"],
  ["prefix only", "KSM-RES-"],
  ["lowercase", "ksm-res-0420"],
  ["mixed case", "KSM-res-0420"],
  ["equals", "KSM-RES-1=2"],
  ["query prefix", "?name=KSM-RES-1"],
  ["newline", "KSM-RES-1\n"],
  ["carriage return", "KSM-RES-1\r"],
  ["NUL", "KSM-RES-1\u0000"],
  ["tab", "KSM-RES-1\t"],
  ["inner space", "KSM-RES-1 2"],
  ["leading space", " KSM-RES-0420"],
  ["trailing space", "KSM-RES-0420 "],
  ["underscore", "KSM-RES-04_20"],
  ["slash", "KSM-RES-1/2"],
  ["overlong", `KSM-RES-${"9".repeat(USERNAME_MAX_LENGTH)}`],
  ["unicode digit", "KSM-RES-٠٤٢٠"],
  ["unicode letter", "KSM-RES-ÄBC"],
  ["fullwidth", "ＫＳＭ-RES-0420"],
  ["emoji", "KSM-RES-😀"],
  ["other prefix", "KSM-ADM-0001"]
];

const VALID_WORKER_USERNAMES = ["KSM-RES-0025", "KSM-RES-0420", "KSM-RES-1", "KSM-RES-ABC123", `KSM-RES-${"7".repeat(USERNAME_MAX_LENGTH - 8)}`];

/** All routes that take a username as a path parameter. */
const PATH_ROUTES: Array<{ name: string; method: string; suffix: string; body?: unknown }> = [
  { name: "get", method: "GET", suffix: "" },
  { name: "disable", method: "POST", suffix: "/disable" },
  { name: "enable", method: "POST", suffix: "/enable" },
  { name: "reset-password", method: "POST", suffix: "/reset-password", body: { password: PASSWORD } },
  { name: "delete", method: "DELETE", suffix: "" },
  { name: "sessions", method: "GET", suffix: "/sessions" },
  { name: "disconnect", method: "POST", suffix: "/disconnect" }
];

describe("F1: username rules match the Worker", () => {
  it("connector pattern is byte-identical to the Worker's routerUsernameFromResidentCode regex (drift guard)", () => {
    const workerPath = fileURLToPath(new URL("../../cloudflare/src/services/internet-access.service.ts", import.meta.url));
    if (!existsSync(workerPath)) return; // connector checked out alone
    const src = readFileSync(workerPath, "utf8");
    const m = src.match(/routerUsernameFromResidentCode[\s\S]*?if \(!(\/.*?\/)\.test\(normalized\)\)/);
    expect(m?.[1]).toBe(RESIDENT_USERNAME_PATTERN.toString());
  });

  it("accepts every Worker-style username and rejects the invalid table", () => {
    for (const u of VALID_WORKER_USERNAMES) expect(isValidResidentUsername(u)).toBe(true);
    for (const [, u] of INVALID_USERNAMES) expect(isValidResidentUsername(u)).toBe(false);
    for (const v of [undefined, null, 12345, true, {}, [], ["KSM-RES-1"]]) expect(isValidResidentUsername(v)).toBe(false);
  });

  it("password rules: printable ASCII, 8–128 chars", () => {
    expect(isValidHotspotPassword(PASSWORD)).toBe(true);
    expect(isValidHotspotPassword("a".repeat(PASSWORD_MIN_LENGTH))).toBe(true);
    expect(isValidHotspotPassword("a".repeat(PASSWORD_MAX_LENGTH))).toBe(true);
    expect(isValidHotspotPassword("with space ok")).toBe(true);
    expect(isValidHotspotPassword("=leading=eq")).toBe(true); // inside one =password= API word: harmless
    for (const bad of ["a".repeat(PASSWORD_MIN_LENGTH - 1), "a".repeat(PASSWORD_MAX_LENGTH + 1), "abcdefgh\u0000", "abcdefgh\n", "abc\tdefgh", "pässwörd12", 12345678, null]) {
      expect(isValidHotspotPassword(bad)).toBe(false);
    }
  });

  it("comment rules: printable ASCII without '=', ≤128, no leading ?/!", () => {
    for (const ok of ["", "Kissmet KSM-RES-0025", "Kissmet retry KSM-RES-0025", "Room 12B", "x".repeat(COMMENT_MAX_LENGTH)]) {
      expect(isValidComment(ok)).toBe(true);
    }
    for (const bad of ["a=b", "?name=x", "!done", "line\nbreak", "tab\there", "nul\u0000", "x".repeat(COMMENT_MAX_LENGTH + 1), "café", 7, null]) {
      expect(isValidComment(bad)).toBe(false);
    }
  });
});

describe("F1: POST /v1/users rejects bad usernames before RouterOS", () => {
  for (const [label, username] of INVALID_USERNAMES) {
    it(`rejects ${label}`, async () => {
      const { app, client } = await buildMockApp();
      const spies = spyAll(client);
      const res = await app.request("/v1/users", {
        method: "POST",
        headers: jsonAuth,
        body: JSON.stringify({ username, password: PASSWORD })
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      // "" and " " are caught as missing (existing bad_request) or invalid; both are 400 with fixed text.
      expect(["invalid_username", "bad_request"]).toContain(body.error.code);
      if (username.trim().length > 0) expect(body.error.code).toBe("invalid_username");
      for (const s of spies) expect(s).not.toHaveBeenCalled();
      expect(client.users.size).toBe(0);
    });
  }

  it("rejects non-string username types", async () => {
    const { app, client } = await buildMockApp();
    const spies = spyAll(client);
    for (const username of [12345, 0.5, true, {}, { $ne: null }, ["KSM-RES-0420"]]) {
      const res = await app.request("/v1/users", { method: "POST", headers: jsonAuth, body: JSON.stringify({ username, password: PASSWORD }) });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("invalid_username");
    }
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });

  it("rejects bad passwords and comments with fixed codes, never echoing them", async () => {
    const { app, client } = await buildMockApp();
    const spies = spyAll(client);
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ password: "short" }, "invalid_password"],
      [{ password: "x".repeat(PASSWORD_MAX_LENGTH + 1) }, "invalid_password"],
      [{ password: "secretpw\u0000injected" }, "invalid_password"],
      [{ password: "secretpw\n=profile=default" }, "invalid_password"],
      [{ password: PASSWORD, comment: "evil\n=profile=default" }, "invalid_comment"],
      [{ password: PASSWORD, comment: "a=b" }, "invalid_comment"],
      [{ password: PASSWORD, comment: "?name=admin" }, "invalid_comment"],
      [{ password: PASSWORD, comment: "c".repeat(COMMENT_MAX_LENGTH + 1) }, "invalid_comment"],
      [{ password: PASSWORD, comment: 42 }, "invalid_comment"],
      [{ password: PASSWORD, comment: null }, "invalid_comment"]
    ];
    for (const [extra, code] of cases) {
      const res = await app.request("/v1/users", { method: "POST", headers: jsonAuth, body: JSON.stringify({ username: "KSM-RES-0025", ...extra }) });
      expect(res.status).toBe(400);
      const text = await res.text();
      expect(JSON.parse(text).error.code).toBe(code);
      expect(text).not.toContain("secretpw");
      expect(text).not.toContain("profile=default");
      expect(text).not.toContain("evil");
    }
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});

describe("F1: every :username route rejects bad usernames before RouterOS", () => {
  for (const route of PATH_ROUTES) {
    it(`${route.method} /v1/users/:username${route.suffix} (${route.name})`, async () => {
      const { app, client } = await buildMockApp();
      const spies = spyAll(client);
      for (const [, username] of INVALID_USERNAMES) {
        if (username === "") continue; // empty segment is a different route (404), covered below
        const res = await app.request(`/v1/users/${encodeURIComponent(username)}${route.suffix}`, {
          method: route.method,
          headers: route.body ? jsonAuth : auth,
          ...(route.body ? { body: JSON.stringify(route.body) } : {})
        });
        expect(res.status, `${route.name} ${JSON.stringify(username)}`).toBe(400);
        const text = await res.text();
        expect(JSON.parse(text)).toEqual({ ok: false, error: { code: "invalid_username", message: "Invalid username" } });
        expect(text).not.toContain(PASSWORD);
      }
      for (const s of spies) expect(s).not.toHaveBeenCalled();
    });
  }

  it("username is validated before the body is even parsed on reset-password", async () => {
    const { app } = await buildMockApp();
    const res = await app.request("/v1/users/admin/reset-password", { method: "POST", headers: jsonAuth, body: "{not json" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("invalid_username");
  });

  it("reset-password rejects invalid new passwords without touching RouterOS", async () => {
    const { app, client } = await buildMockApp();
    const spies = spyAll(client);
    for (const password of ["short", 12345678, "pw\u0000pw\u0000pw", "x".repeat(PASSWORD_MAX_LENGTH + 1)]) {
      const res = await app.request("/v1/users/KSM-RES-0025/reset-password", { method: "POST", headers: jsonAuth, body: JSON.stringify({ password }) });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("invalid_password");
    }
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });

  it("an empty username segment does not reach a handler", async () => {
    const { app, client } = await buildMockApp();
    const spies = spyAll(client);
    expect((await app.request("/v1/users//disable", { method: "POST", headers: auth })).status).toBe(404);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});

describe("F1: valid Worker-style usernames work end to end", () => {
  for (const username of VALID_WORKER_USERNAMES) {
    it(`full lifecycle for ${username.length > 20 ? "max-length username" : username}`, async () => {
      const { app, client } = await buildMockApp();
      const created = await app.request("/v1/users", {
        method: "POST",
        headers: jsonAuth,
        body: JSON.stringify({ username, password: PASSWORD, comment: `Kissmet ${username}` })
      });
      expect(created.status).toBe(201);
      const path = `/v1/users/${encodeURIComponent(username)}`;
      expect((await app.request(path, { headers: auth })).status).toBe(200);
      expect((await app.request(`${path}/disable`, { method: "POST", headers: auth })).status).toBe(200);
      expect((await app.request(`${path}/enable`, { method: "POST", headers: auth })).status).toBe(200);
      const reset = await app.request(`${path}/reset-password`, { method: "POST", headers: jsonAuth, body: JSON.stringify({ password: "Zz9!Zz9!Zz9!Zz9!Zz" }) });
      expect(reset.status).toBe(200);
      expect(client.passwords.get(username)).toBe("Zz9!Zz9!Zz9!Zz9!Zz");
      expect((await app.request(`${path}/sessions`, { headers: auth })).status).toBe(200);
      expect((await app.request(`${path}/disconnect`, { method: "POST", headers: auth })).status).toBe(200);
      expect((await app.request(path, { method: "DELETE", headers: auth })).status).toBe(200);
      expect(client.users.has(username)).toBe(false);
    });
  }

  it("the Worker's retry comment format is accepted", async () => {
    const { app, client } = await buildMockApp();
    const res = await app.request("/v1/users", {
      method: "POST",
      headers: jsonAuth,
      body: JSON.stringify({ username: "KSM-RES-0025", password: PASSWORD, comment: "Kissmet retry KSM-RES-0025" })
    });
    expect(res.status).toBe(201);
    expect(client.users.get("KSM-RES-0025")?.comment).toBe("Kissmet retry KSM-RES-0025");
  });

  it("ensureResidentProfile takes no input: any body is ignored and the call still works", async () => {
    const { app, client } = await buildMockApp();
    const defaultBefore = structuredClone(client.profiles.get("default"));
    const res = await app.request("/v1/ensureResidentProfile", {
      method: "POST",
      headers: jsonAuth,
      body: JSON.stringify({ name: "default", sharedUsers: 999 })
    });
    expect(res.status).toBe(200);
    expect(client.profiles.get("Kissmet-Residents")?.sharedUsers).toBe(3);
    expect(client.profiles.get("default")).toEqual(defaultBefore);
  });
});

describe("F2: unexpected errors are generic", () => {
  const leaky = "TypeError: boom at /opt/kissmet/src/secret.ts:12 password=hunter2 " + SECRET;

  const ops: Array<{ name: string; method: keyof MockRouterOsClient; req: () => [string, RequestInit] }> = [
    { name: "deep health", method: "health", req: () => ["/v1/health", { headers: auth }] },
    { name: "ensure profile", method: "getProfile", req: () => ["/v1/ensureResidentProfile", { method: "POST", headers: auth }] },
    { name: "get user", method: "getUser", req: () => ["/v1/users/KSM-RES-0025", { headers: auth }] },
    { name: "create user", method: "getProfile", req: () => ["/v1/users", { method: "POST", headers: jsonAuth, body: JSON.stringify({ username: "KSM-RES-0025", password: PASSWORD }) }] },
    { name: "disable", method: "getUser", req: () => ["/v1/users/KSM-RES-0025/disable", { method: "POST", headers: auth }] },
    { name: "enable", method: "getUser", req: () => ["/v1/users/KSM-RES-0025/enable", { method: "POST", headers: auth }] },
    { name: "reset password", method: "getUser", req: () => ["/v1/users/KSM-RES-0025/reset-password", { method: "POST", headers: jsonAuth, body: JSON.stringify({ password: PASSWORD }) }] },
    { name: "delete", method: "removeUser", req: () => ["/v1/users/KSM-RES-0025", { method: "DELETE", headers: auth }] },
    { name: "sessions", method: "listActiveSessions", req: () => ["/v1/users/KSM-RES-0025/sessions", { headers: auth }] },
    { name: "disconnect", method: "disconnectSessions", req: () => ["/v1/users/KSM-RES-0025/disconnect", { method: "POST", headers: auth }] }
  ];

  for (const op of ops) {
    it(`${op.name}: unknown error → 500 internal_error, no message/stack/secret`, async () => {
      const { app, client } = await buildMockApp();
      vi.spyOn(client, op.method as "health").mockRejectedValue(new TypeError(leaky));
      const [path, init] = op.req();
      const res = await app.request(path, { ...init, headers: { ...(init.headers as Record<string, string>), "x-correlation-id": "corr-f2" } });
      const text = await res.text();
      if (op.name === "deep health") {
        // Deep health has its own fixed 503 body (unchanged).
        expect(res.status).toBe(503);
      } else {
        expect(res.status).toBe(500);
        expect(JSON.parse(text)).toEqual({ ok: false, error: { code: "internal_error", message: "Internal error", correlationId: "corr-f2" } });
      }
      for (const needle of ["TypeError", "boom", "/opt/kissmet", "secret.ts", "hunter2", SECRET, PASSWORD, "stack"]) {
        expect(text).not.toContain(needle);
      }
    });
  }

  it("non-Error throwables (strings, objects) are also generic", async () => {
    const { app, client } = await buildMockApp();
    vi.spyOn(client, "getUser").mockRejectedValueOnce("raw string " + SECRET);
    const res = await app.request("/v1/users/KSM-RES-0025", { headers: auth });
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain(SECRET);
  });

  it("internal details are logged server-side via the redacting logger, with the correlation id", async () => {
    const { app, client } = await buildMockApp();
    vi.spyOn(client, "getUser").mockRejectedValueOnce(new Error("db exploded"));
    await app.request("/v1/users/KSM-RES-0025", { headers: { ...auth, "x-correlation-id": "corr-log" } });
    const errorCalls = (logSpies[2]!.mock.calls as unknown[][]).filter((c) => c[0] === "internal_error");
    expect(errorCalls).toHaveLength(1);
    expect(errorCalls[0]![1]).toMatchObject({ correlationId: "corr-log", errorName: "Error", error: "db exploded" });
    expect(loggedText()).not.toContain(SECRET);
  });

  it("an error thrown outside a route try/catch (global onError) is also generic", async () => {
    const { app } = await buildMockApp();
    // Hono's own route on the outer app throwing: register a throwing route via app.get for this test only.
    app.get("/__boom", () => {
      throw new Error("outer boom " + SECRET);
    });
    const res = await app.request("/__boom");
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text).error.code).toBe("internal_error");
    expect(text).not.toContain("outer boom");
    expect(text).not.toContain(SECRET);
  });

  it("known mappings are unchanged: 404 not_found, 409 profile_conflict, 503 unavailable", async () => {
    const { app, client } = await buildMockApp();
    const missing = await app.request("/v1/users/KSM-RES-0000/disable", { method: "POST", headers: auth });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ ok: false, error: { code: "not_found", message: "HotSpot user not found" } });
    client.profiles.set("Kissmet-Residents", { id: "*9", name: "Kissmet-Residents", sharedUsers: 1 });
    expect((await app.request("/v1/ensureResidentProfile", { method: "POST", headers: auth })).status).toBe(409);
  });

  it("the 404 for a missing user does not echo the username from a thrown message", async () => {
    const { app } = await buildMockApp();
    const res = await app.request("/v1/users/KSM-RES-0000/reset-password", { method: "POST", headers: jsonAuth, body: JSON.stringify({ password: PASSWORD }) });
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("KSM-RES-0000");
  });
});

describe("F3: JSON error handling", () => {
  it("empty body on reset-password is the existing 'password required' 400 (not invalid_json)", async () => {
    const { app } = await buildMockApp();
    const res = await app.request("/v1/users/KSM-RES-0025/reset-password", { method: "POST", headers: jsonAuth });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: { code: "bad_request", message: "password required" } });
  });

  it("truncated JSON containing a real-looking password is never echoed and never logged", async () => {
    const { app } = await buildMockApp();
    const raw = `{"username":"KSM-RES-0025","password":"${PASSWORD}"`;
    const res = await app.request("/v1/users", { method: "POST", headers: jsonAuth, body: raw });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: false, error: { code: "invalid_json", message: "Malformed JSON body" } });
    expect(text).not.toContain(PASSWORD);
    expect(loggedText()).not.toContain(PASSWORD);
  });
});

describe("rate-limit config: RATE_LIMIT_MAX and RATE_LIMIT_WINDOW_MS are positive integers", () => {
  const base = {
    CONNECTOR_SECRET: SECRET,
    CONNECTOR_MODE: "local",
    NODE_ENV: "test",
    ROUTEROS_DRIVER: "mock"
  } as NodeJS.ProcessEnv;

  it("defaults when unset: RATE_LIMIT_MAX=120, RATE_LIMIT_WINDOW_MS=60000", () => {
    const cfg = loadConfig(base);
    expect(cfg.rateLimitMax).toBe(120);
    expect(cfg.rateLimitWindowMs).toBe(60_000);
    expect(cfg.authFailRateLimitMax).toBe(20);
  });

  it("accepts valid positive integers, including trimmed whitespace", () => {
    expect(loadConfig({ ...base, RATE_LIMIT_MAX: "1" }).rateLimitMax).toBe(1);
    expect(loadConfig({ ...base, RATE_LIMIT_MAX: "120" }).rateLimitMax).toBe(120);
    expect(loadConfig({ ...base, RATE_LIMIT_MAX: " 60 " }).rateLimitMax).toBe(60);
    expect(loadConfig({ ...base, RATE_LIMIT_WINDOW_MS: "1" }).rateLimitWindowMs).toBe(1);
    expect(loadConfig({ ...base, RATE_LIMIT_WINDOW_MS: "60000" }).rateLimitWindowMs).toBe(60_000);
    expect(loadConfig({ ...base, RATE_LIMIT_WINDOW_MS: " 60 " }).rateLimitWindowMs).toBe(60);
  });

  const invalid = ["0", "-1", "1.5", "abc", "NaN", "Infinity", "", "1e309"] as const;
  for (const name of ["RATE_LIMIT_MAX", "RATE_LIMIT_WINDOW_MS"] as const) {
    for (const value of invalid) {
      it(`rejects ${name}=${JSON.stringify(value)} at startup without echoing secrets`, () => {
        expect(() => loadConfig({ ...base, [name]: value })).toThrow(new RegExp(`${name} must be a positive integer`));
        try {
          loadConfig({ ...base, [name]: value });
          throw new Error("expected loadConfig to throw");
        } catch (err) {
          const message = (err as Error).message;
          expect(message).toBe(`${name} must be a positive integer`);
          expect(message).not.toContain(SECRET);
        }
      });
    }
  }
});
