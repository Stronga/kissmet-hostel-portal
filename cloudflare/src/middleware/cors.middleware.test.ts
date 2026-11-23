import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { Env } from "../types/bindings";
import { allowedOrigins, corsMiddleware } from "./cors.middleware";

function appWith(env: Partial<Env>) {
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", corsMiddleware);
  app.get("/ping", (c) => c.json({ ok: true }));
  return { app, env: env as Env };
}

describe("CORS origins", () => {
  it("defaults include local admin and resident Vite ports", () => {
    const origins = allowedOrigins({ APP_ENV: "local" } as Env);
    expect(origins).toEqual(expect.arrayContaining([
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:5174",
      "http://127.0.0.1:5174"
    ]));
  });

  it("defaults include production admin and resident portals", () => {
    const origins = allowedOrigins({ APP_ENV: "production" } as Env);
    expect(origins).toEqual([
      "https://admin.kissmetgroup.org",
      "https://portal.kissmetgroup.org"
    ]);
  });

  it("honors configured ADMIN_ALLOWED_ORIGINS without wildcards", async () => {
    const { app, env } = appWith({
      APP_ENV: "production",
      ADMIN_ALLOWED_ORIGINS: "https://admin.kissmetgroup.org,https://portal.kissmetgroup.org"
    });
    const allowed = await app.fetch(new Request("http://localhost/ping", { headers: { Origin: "https://portal.kissmetgroup.org" } }), env);
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe("https://portal.kissmetgroup.org");

    const denied = await app.fetch(new Request("http://localhost/ping", { headers: { Origin: "https://evil.example" } }), env);
    expect(denied.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("strips localhost from production misconfiguration", () => {
    const origins = allowedOrigins({
      APP_ENV: "production",
      ADMIN_ALLOWED_ORIGINS: "http://localhost:5173,https://admin.kissmetgroup.org"
    } as Env);
    expect(origins).toEqual(["https://admin.kissmetgroup.org"]);
  });
});

describe("CORS credentials", () => {
  it("sets Allow-Credentials for an allowlisted origin, never a wildcard", async () => {
    const { app, env } = appWith({
      APP_ENV: "staging",
      ADMIN_ALLOWED_ORIGINS: "https://staging-admin.kissmetgroup.org,https://staging-portal.kissmetgroup.org"
    });
    const res = await app.fetch(new Request("http://localhost/ping", {
      headers: { Origin: "https://staging-admin.kissmetgroup.org" }
    }), env);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://staging-admin.kissmetgroup.org");
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(res.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
  });

  it("sets Allow-Credentials on OPTIONS preflight for an allowlisted origin", async () => {
    const { app, env } = appWith({
      APP_ENV: "staging",
      ADMIN_ALLOWED_ORIGINS: "https://staging-admin.kissmetgroup.org,https://staging-portal.kissmetgroup.org"
    });
    const res = await app.fetch(new Request("http://localhost/ping", {
      method: "OPTIONS",
      headers: {
        Origin: "https://staging-portal.kissmetgroup.org",
        "Access-Control-Request-Method": "POST"
      }
    }), env);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://staging-portal.kissmetgroup.org");
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });

  it("omits Allow-Credentials and ACAO when the origin is not allowlisted", async () => {
    const { app, env } = appWith({
      APP_ENV: "staging",
      ADMIN_ALLOWED_ORIGINS: "https://staging-admin.kissmetgroup.org"
    });
    const res = await app.fetch(new Request("http://localhost/ping", {
      headers: { Origin: "https://evil.example" }
    }), env);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });
});
