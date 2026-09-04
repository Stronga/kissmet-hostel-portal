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
});
