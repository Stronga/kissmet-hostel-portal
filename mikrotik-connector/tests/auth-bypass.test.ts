import { connect } from "node:net";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression tests for wildcard-middleware bypasses in Hono / @hono/node-server
 * (GHSA-h7mg-cq63-vhpq RegExpRouter skips wildcard middleware, GHSA-jpvv-r467-5p4w backslash
 * path separator, GHSA-4m76-xfj5-7975 mount prefix). The connector's Bearer auth is registered
 * as `api.use("*")` under `/v1`, so every request that the router dispatches into `/v1` must be
 * rejected with 401 before any route handler or RouterOS call runs.
 *
 * In-memory RouterOS mock ONLY; the real client is stubbed to throw. The HTTP server test
 * binds an ephemeral port on 127.0.0.1 and talks only to itself.
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

import { serve } from "@hono/node-server";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createRouterOsClient } from "../src/routeros/client-factory.js";
import type { MockRouterOsClient } from "../src/routeros/mock-client.js";
import { log } from "../src/logger.js";

const SECRET = "auth-bypass-connector-secret-at-least-32-chars";
const USER = "KSM-RES-BYPASS1";

beforeEach(() => {
  vi.spyOn(log, "info").mockImplementation(() => undefined);
  vi.spyOn(log, "warn").mockImplementation(() => undefined);
  vi.spyOn(log, "error").mockImplementation(() => undefined);
});

async function build() {
  const config = loadConfig({
    CONNECTOR_SECRET: SECRET,
    CONNECTOR_MODE: "local",
    NODE_ENV: "test",
    ROUTEROS_DRIVER: "mock",
    // Keep the limiter out of the way: these tests send many unauthenticated requests.
    AUTH_FAIL_RATE_LIMIT_MAX: "100000"
  } as NodeJS.ProcessEnv);
  const client = (await createRouterOsClient(config)) as MockRouterOsClient;
  const methods = [
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
  const spies = methods
    .filter((m) => typeof (client as unknown as Record<string, unknown>)[m] === "function")
    .map((m) => vi.spyOn(client as never, m as never));
  return { app: createApp(config, client), spies };
}

/** Every protected connector route, in its canonical form. */
const PROTECTED: Array<[method: string, path: string]> = [
  ["GET", "/v1/health"],
  ["POST", "/v1/ensureResidentProfile"],
  ["GET", `/v1/users/${USER}`],
  ["POST", "/v1/users"],
  ["POST", `/v1/users/${USER}/disable`],
  ["POST", `/v1/users/${USER}/enable`],
  ["POST", `/v1/users/${USER}/reset-password`],
  ["DELETE", `/v1/users/${USER}`],
  ["GET", `/v1/users/${USER}/sessions`],
  ["POST", `/v1/users/${USER}/disconnect`]
];

/**
 * Path variants that a router could dispatch into /v1. Each must still be answered by the
 * auth middleware (401) — never by a handler and never by the bare not-found handler.
 */
function variantsUnderV1(path: string): string[] {
  const rest = path.slice("/v1".length); // starts with "/"
  return [
    path,
    `${path}/`,
    `${path}%0A`,
    `${path}%0D`,
    `${path}%0D%0A`,
    `${path}%E2%80%A8`,
    `${path}%E2%80%A9`,
    `/v1/${encodeURIComponent(rest.slice(1))}`, // %2F-encoded segments
    `/v1${rest.replace(/\//g, "//")}`, // doubled separators inside the prefix
    `/v1/./${rest.slice(1)}`,
    `/v1/x/..${rest}`,
    `/v1/%2e%2e/v1${rest}`,
    `/v1${rest}?x=%0A`,
    `/v1${rest.replace(/[A-Za-z]/, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)}`
  ];
}

/** Variants that leave the /v1 prefix entirely (case, leading //). They may 404, never 2xx. */
function variantsOutsideV1(path: string): string[] {
  return [path.replace("/v1", "/V1"), `/${path}`, path.toUpperCase(), path.replace("/v1", "/%76%31")];
}

const ALL_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

describe("connector wildcard auth middleware — no bypass", () => {
  it("every protected route returns 401 without auth, for every method", async () => {
    const { app, spies } = await build();
    for (const [, path] of PROTECTED) {
      for (const method of ALL_METHODS) {
        const res = await app.request(path, { method });
        expect(res.status, `${method} ${path}`).toBe(401);
      }
    }
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });

  it("encoded, doubled, trailing and dot-segment variants under /v1 still return 401", async () => {
    const { app, spies } = await build();
    for (const [method, path] of PROTECTED) {
      for (const variant of variantsUnderV1(path)) {
        const res = await app.request(variant, { method });
        expect(res.status, `${method} ${variant}`).toBe(401);
        const body = (await res.json()) as { ok: boolean };
        expect(body.ok).toBe(false);
      }
    }
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });

  it("wrong or malformed credentials are rejected on encoded-line-terminator paths", async () => {
    const { app, spies } = await build();
    const headers = [
      { Authorization: "Bearer wrong" },
      { Authorization: `Bearer ${SECRET}%0A` },
      { Authorization: `bearer${SECRET}` },
      { Authorization: `Basic ${SECRET}` }
    ];
    for (const h of headers) {
      for (const p of ["/v1/health%0A", `/v1/users/${USER}%E2%80%A8`, "/v1/unknown%0D"]) {
        const res = await app.request(p, { headers: h });
        expect(res.status, `${JSON.stringify(Object.keys(h))} ${p}`).toBe(401);
      }
    }
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });

  it("unknown /v1 paths are 401 (auth runs before not-found), including encoded line terminators", async () => {
    const { app } = await build();
    for (const p of ["/v1/", "/v1/nope", "/v1/%0A", "/v1/users", "/v1/users/%0A/disable", "/v1/admin%0A/x"]) {
      expect((await app.request(p)).status, p).toBe(401);
    }
  });

  it("variants that leave /v1 never reach a handler (404 Unknown route, no RouterOS call)", async () => {
    const { app, spies } = await build();
    for (const [method, path] of PROTECTED) {
      for (const variant of variantsOutsideV1(path)) {
        const res = await app.request(variant, { method });
        expect([401, 404], `${method} ${variant}`).toContain(res.status);
        const body = (await res.json()) as { ok: boolean };
        expect(body.ok).toBe(false);
      }
    }
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });

  it("sanity: the same variants with a valid token reach auth-protected behaviour", async () => {
    const { app } = await build();
    const res = await app.request("/v1/health", { headers: { Authorization: `Bearer ${SECRET}` } });
    expect(res.status).toBe(200);
    const trailing = await app.request("/v1/health%0A", { headers: { Authorization: `Bearer ${SECRET}` } });
    expect(trailing.status).toBe(404); // authenticated, then not-found: never a 2xx on a mangled path
  });
});

/** Raw HTTP/1.1 so the request-target is sent byte-for-byte (fetch would normalise it). */
function rawRequest(port: number, target: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const sock = connect({ host: "127.0.0.1", port }, () => {
      const h = Object.entries({ Host: "127.0.0.1", Connection: "close", ...headers })
        .map(([k, v]) => `${k}: ${v}`)
        .join("\r\n");
      sock.write(`GET ${target} HTTP/1.1\r\n${h}\r\n\r\n`);
    });
    let data = "";
    sock.setEncoding("latin1");
    sock.on("data", (d) => (data += d));
    sock.on("end", () => {
      const m = /^HTTP\/1\.1 (\d{3})/.exec(data);
      m ? resolve(Number(m[1])) : reject(new Error("no status line"));
    });
    sock.on("error", reject);
    sock.setTimeout(5000, () => sock.destroy(new Error("timeout")));
  });
}

describe("connector over @hono/node-server — raw request-target variants", () => {
  let server: ReturnType<typeof serve>;
  let port = 0;

  beforeAll(async () => {
    const { app } = await build();
    await new Promise<void>((resolve) => {
      server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info: AddressInfo) => {
        port = info.port;
        resolve();
      });
    });
  });
  afterAll(() => {
    server?.close();
  });

  it("rejects a raw backslash in the path (400) instead of rewriting it to /", async () => {
    for (const t of ["/v1\\health", "/public\\..\\v1/health", "/x/..\\v1/users"]) {
      const status = await rawRequest(port, t, { Authorization: `Bearer ${SECRET}` });
      expect(status, t).toBe(400);
    }
  });

  it("returns 401 for unauthenticated raw variants under /v1", async () => {
    for (const t of [
      "/v1/health",
      "/v1//health",
      "/v1/health/",
      "/v1/health%0A",
      "/v1/health%E2%80%A8",
      "/v1/%68ealth",
      "/v1/x/../health",
      "/v1/users%2FKSM-RES-BYPASS1",
      "/v1/health?%5C",
      "http://127.0.0.1/v1/health"
    ]) {
      expect(await rawRequest(port, t), t).toBe(401);
    }
  });

  it("never serves a protected route for raw variants outside /v1", async () => {
    for (const t of ["//v1/health", "/V1/health", "/%2e%2e/v1/health", "/v1%2Fhealth"]) {
      const status = await rawRequest(port, t);
      expect([400, 401, 404], t).toContain(status);
    }
  });
});
