import { describe, expect, it } from "vitest";
import app from "../src/index";
import type { Env } from "../src/types/bindings";

/**
 * Regression tests for Hono wildcard-middleware bypasses (GHSA-h7mg-cq63-vhpq: RegExpRouter
 * skipped wildcard middleware for some route sets and for paths with an encoded line terminator;
 * GHSA-4m76-xfj5-7975: mounted sub-app prefix). The Worker protects /admin/* with
 * `routes.use("*", requireAuth)` on a mounted sub-app and /resident/me/* with
 * `residentRoutes.use("/me/*", ...)`, so every route the router dispatches there must answer 401
 * without a session — never run a handler, never touch D1/R2.
 *
 * The routes are enumerated from the real app (`app.routes`), so a new route is covered
 * automatically.
 */

/** D1/R2 stand-ins that fail loudly: an unauthenticated request must never reach storage. */
const explode = new Proxy(
  {},
  {
    get(_t, prop) {
      if (prop === "then") return undefined;
      throw new Error(`storage touched without auth: ${String(prop)}`);
    }
  }
);

function env(overrides: Partial<Env> = {}): Env {
  return {
    APP_NAME: "kissmet-test",
    APP_ENV: "local",
    DB: explode,
    DOCUMENTS: explode,
    CONNECTOR_HEARTBEAT_SECRET: "heartbeat-test-secret-0123456789abcdef",
    CONNECTOR_HEARTBEAT_ALLOWED_IDS: "0b7e1c52-5f0e-4f9a-9d3b-2a6f1c0e8d41",
    ...overrides
  } as unknown as Env;
}

type Route = { method: string; path: string };

const PROTECTED_PREFIXES = ["/admin", "/resident/me", "/auth/me", "/auth/logout"];
const isProtected = (p: string) => PROTECTED_PREFIXES.some((x) => p === x || p.startsWith(`${x}/`));

function concrete(path: string): string {
  // ":id", ":roomId", ":id{[0-9]+}" → "1"
  return path.replace(/:[A-Za-z_]+(\{[^}]*\})?/g, "1");
}

const routes: Route[] = (app.routes as Array<{ method: string; path: string }>)
  .filter((r) => r.method !== "ALL")
  .map((r) => ({ method: r.method, path: r.path }));
const protectedRoutes = routes.filter((r) => isProtected(r.path));

function variants(path: string): string[] {
  const segs = path.split("/").filter(Boolean);
  const head = `/${segs[0]}`;
  const rest = path.slice(head.length);
  const out = [
    path,
    `${path}/`,
    `${path}%0A`,
    `${path}%0D`,
    `${path}%0D%0A`,
    `${path}%E2%80%A8`,
    `${path}%E2%80%A9`,
    `${path}?x=%0A`,
    `${head}${rest.replace(/\//g, "//")}`,
    `${head}/./${rest.slice(1)}`,
    `${head}/x/..${rest}`,
    `${head}${rest.replace(/[a-z]/, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)}`
  ];
  if (rest.length > 1) out.push(`${head}/${encodeURIComponent(rest.slice(1))}`);
  return out;
}

async function call(method: string, path: string, headers: Record<string, string> = {}) {
  return app.request(`http://worker.test${path}`, { method, headers }, env());
}

describe("Worker wildcard auth middleware — route inventory", () => {
  it("enumerates the protected admin, resident and auth routes", () => {
    expect(protectedRoutes.filter((r) => r.path.startsWith("/admin/")).length).toBeGreaterThan(80);
    expect(protectedRoutes.filter((r) => r.path.startsWith("/resident/me")).length).toBeGreaterThan(25);
    expect(routes.some((r) => r.path === "/connector/heartbeat" && r.method === "POST")).toBe(true);
  });
});

describe("Worker wildcard auth middleware — no bypass", () => {
  it("every protected route returns 401 without a session", async () => {
    for (const r of protectedRoutes) {
      const res = await call(r.method, concrete(r.path));
      expect(res.status, `${r.method} ${r.path}`).toBe(401);
    }
  });

  it("encoded line terminators, trailing/doubled slashes, dot segments and %-encoding still return 401", async () => {
    for (const r of protectedRoutes) {
      for (const v of variants(concrete(r.path))) {
        const res = await call(r.method, v);
        // 401 from the auth middleware. A variant the router no longer maps to the sub-app may
        // fall through to 404, but it must never be 2xx/403/5xx (a handler or storage ran).
        expect([401, 404], `${r.method} ${v}`).toContain(res.status);
        if (v.startsWith("/admin/") || v.startsWith("/resident/me/")) {
          expect(res.status, `${r.method} ${v} must be answered by auth`).toBe(401);
        }
      }
    }
  });

  it("HEAD and OPTIONS on protected paths never return protected data", async () => {
    for (const r of protectedRoutes.filter((x) => x.method === "GET")) {
      const head = await call("HEAD", concrete(r.path));
      expect(head.status, `HEAD ${r.path}`).toBe(401);
      const opts = await call("OPTIONS", concrete(r.path), {
        Origin: "https://evil.example",
        "Access-Control-Request-Method": "GET"
      });
      expect(opts.status, `OPTIONS ${r.path}`).not.toBe(200);
      expect(opts.headers.get("Access-Control-Allow-Origin")).toBeNull();
    }
  });

  it("unknown paths under /admin and /resident/me are 401, including encoded line terminators", async () => {
    for (const p of ["/admin/", "/admin/nope", "/admin/%0A", "/admin/residents%0A/x", "/resident/me/", "/resident/me/nope%0D", "/resident/me/%E2%80%A8"]) {
      expect((await call("GET", p)).status, p).toBe(401);
    }
  });

  it("malformed or wrong bearer headers are 401 on mangled paths", async () => {
    for (const h of ["Bearer ", "Bearer%20x", "bearer x", "Basic eA==", "Bearer x\u2028"]) {
      for (const p of ["/admin/residents%0A", "/resident/me/payments%E2%80%A9"]) {
        let status: number;
        try {
          status = (await call("GET", p, { Authorization: h })).status;
        } catch {
          status = 400; // invalid header value rejected by the Headers constructor
        }
        // A non-empty token reaches the session lookup, which would need D1; the throwing
        // D1 stand-in turns that into 500. Either way: never 2xx.
        expect(status, `${JSON.stringify(h)} ${p}`).not.toBeLessThan(300);
        if (!h.startsWith("Bearer ") || h === "Bearer ") expect([400, 401]).toContain(status);
      }
    }
  });

  it("unsigned heartbeats are rejected on every path variant", async () => {
    for (const v of variants("/connector/heartbeat")) {
      const res = await call("POST", v);
      expect([401, 404], v).toContain(res.status);
    }
  });

  it("case-changed prefixes never reach a protected handler", async () => {
    for (const p of ["/ADMIN/residents", "/Admin/residents", "/RESIDENT/me", "/resident/ME/payments", "//admin/residents"]) {
      const res = await call("GET", p);
      expect([401, 404], p).toContain(res.status);
    }
  });
});
