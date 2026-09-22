import { describe, expect, it, beforeEach } from "vitest";
import { Hono } from "hono";
import type { Env } from "./types/bindings";
import { allowedOrigins, corsMiddleware } from "./middleware/cors.middleware";
import { securityHeadersMiddleware } from "./middleware/security-headers.middleware";
import { productionAuthConfigGuard } from "./middleware/production-config.middleware";
import {
  isInsecureProductionOrigin,
  sanitizeCorsOriginsForEnv,
  validateProductionConfig,
  productionAuthBlocked,
  clientIpFromRequest,
  isProductionConfigSafe
} from "./config/production-secrets";
import { checkRateLimit, rateLimitKey, resetRateLimitsForTests, RATE_LIMIT_TOPOLOGY } from "./auth/rate-limit";
import { publicErrorMessage, routeError } from "./http/safe-error";
import { safeLogFields, redactLogValue } from "./http/safe-log";
import { contentDispositionAttachment } from "./http/uploads";

describe("Phase 2 CORS production lockdown", () => {
  function appWith(env: Partial<Env>) {
    const app = new Hono<{ Bindings: Env }>();
    app.use("*", corsMiddleware);
    app.get("/ping", (c) => c.json({ ok: true }));
    return { app, env: env as Env };
  }

  it("allows production portal and admin origins", async () => {
    const { app, env } = appWith({ APP_ENV: "production" });
    for (const origin of ["https://admin.kissmetgroup.org", "https://portal.kissmetgroup.org"]) {
      const res = await app.fetch(new Request("http://api/ping", { headers: { Origin: origin } }), env);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    }
  });

  it("rejects arbitrary and evil origins in production", async () => {
    const { app, env } = appWith({ APP_ENV: "production" });
    for (const origin of ["https://evil.example", "https://kissmetgroup.org.evil.com", "null"]) {
      const res = await app.fetch(new Request("http://api/ping", { headers: { Origin: origin } }), env);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    }
  });

  it("does not silently keep localhost / http origins in production even if misconfigured", () => {
    const origins = allowedOrigins({
      APP_ENV: "production",
      ADMIN_ALLOWED_ORIGINS:
        "http://localhost:5173,https://admin.kissmetgroup.org,*,http://evil.example,https://portal.kissmetgroup.org"
    } as Env);
    expect(origins).toEqual(["https://admin.kissmetgroup.org", "https://portal.kissmetgroup.org"]);
    expect(origins.some((o) => o.includes("localhost"))).toBe(false);
    expect(origins).not.toContain("*");
  });

  it("staging defaults exclude production and local origins", () => {
    const origins = allowedOrigins({ APP_ENV: "staging" } as Env);
    expect(origins).toEqual([
      "https://staging-admin.kissmetgroup.org",
      "https://staging-portal.kissmetgroup.org"
    ]);
    expect(origins.some((o) => o.includes("localhost"))).toBe(false);
  });

  it("sanitizeCorsOriginsForEnv drops insecure entries", () => {
    expect(isInsecureProductionOrigin("http://localhost:5173")).toBe(true);
    expect(isInsecureProductionOrigin("*")).toBe(true);
    expect(isInsecureProductionOrigin("https://admin.kissmetgroup.org")).toBe(false);
    expect(
      sanitizeCorsOriginsForEnv("production", ["http://127.0.0.1:5173", "https://admin.kissmetgroup.org"], [
        "https://admin.kissmetgroup.org",
        "https://portal.kissmetgroup.org"
      ])
    ).toEqual(["https://admin.kissmetgroup.org"]);
  });

  it("never reflects Origin when not allowlisted (no wildcard+credentials pattern)", async () => {
    const { app, env } = appWith({
      APP_ENV: "production",
      ADMIN_ALLOWED_ORIGINS: "https://admin.kissmetgroup.org"
    });
    const res = await app.fetch(
      new Request("http://api/ping", { headers: { Origin: "https://portal.kissmetgroup.org" } }),
      env
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });
});

describe("Phase 2 production secrets fail-closed", () => {
  it("flags missing Arkesel / mock SMS in production", () => {
    const issues = validateProductionConfig({
      APP_ENV: "production",
      SMS_PROVIDER: "mock",
      PUBLIC_BASE_URL: "https://api.kissmetgroup.org"
    } as Env);
    expect(issues.some((i) => i.code === "sms_provider")).toBe(true);
    expect(issues.some((i) => i.code === "arkesel_api_key")).toBe(true);
    expect(productionAuthBlocked({ APP_ENV: "production", SMS_PROVIDER: "mock" } as Env)).not.toBeNull();
  });

  it("passes when production SMS secrets present and CORS locked", () => {
    const env = {
      APP_ENV: "production",
      SMS_PROVIDER: "arkesel",
      ARKESEL_API_KEY: "test-key-not-real",
      ARKESEL_SENDER_ID: "APPROVED",
      PUBLIC_BASE_URL: "https://api.kissmetgroup.org",
      ADMIN_ALLOWED_ORIGINS: "https://admin.kissmetgroup.org,https://portal.kissmetgroup.org"
    } as Env;
    expect(validateProductionConfig(env).filter((i) => i.severity === "critical")).toEqual([]);
    expect(isProductionConfigSafe(env)).toBe(true);
    expect(productionAuthBlocked(env)).toBeNull();
  });

  it("blocks auth routes with 503 when production critically misconfigured", async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.use("*", productionAuthConfigGuard);
    app.post("/auth/staff/login", (c) => c.json({ ok: true }));
    const res = await app.request(
      "/auth/staff/login",
      { method: "POST" },
      { APP_ENV: "production", SMS_PROVIDER: "mock" } as Env
    );
    expect(res.status).toBe(503);
    const body = await res.json() as { error: { message: string; correlationId?: string } };
    expect(body.error.message).toBe("Service temporarily unavailable");
    expect(body.error.correlationId).toMatch(/[0-9a-f-]{36}/i);
    expect(JSON.stringify(body).toLowerCase()).not.toContain("arkesel");
    expect(JSON.stringify(body).toLowerCase()).not.toContain("api_key");
  });

  it("does not block local env missing Arkesel", async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.use("*", productionAuthConfigGuard);
    app.post("/x", (c) => c.json({ ok: true }));
    const res = await app.request("/x", { method: "POST" }, { APP_ENV: "local" } as Env);
    expect(res.status).toBe(200);
  });
});

describe("Phase 2 security headers / cache / document disposition", () => {
  it("sets API headers including object-src none and CORP", async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.use("*", securityHeadersMiddleware);
    app.get("/admin/x", (c) => c.json({ ok: true }));
    const res = await app.request("/admin/x");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toContain("object-src 'none'");
    expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Pragma")).toBe("no-cache");
    expect(res.headers.get("Cross-Origin-Resource-Policy")).toBe("same-site");
    expect(res.headers.get("Strict-Transport-Security")).toBeNull(); // not premature
  });

  it("documents private download header contract", () => {
    expect(contentDispositionAttachment("ghana-card.pdf")).toBe('attachment; filename="ghana-card.pdf"');
  });
});

describe("Phase 2 safe production errors / logging", () => {
  it("redacts Arkesel, MikroTik, R2, binding, and secret-like errors", () => {
    expect(publicErrorMessage(new Error("Arkesel 401 invalid api_key"))).toBe("Request failed");
    expect(publicErrorMessage(new Error("MikroTik RouterOS 8728 refused"))).toBe("Request failed");
    expect(publicErrorMessage(new Error("R2 getObject failed on binding DOCUMENTS"))).toBe("Request failed");
    expect(publicErrorMessage(new Error("cloudflare worker binding missing"))).toBe("Request failed");
    expect(publicErrorMessage(new Error("secret CONNECTOR leaked"))).toBe("Request failed");
  });

  it("safeLogFields redacts tokens and OTP", () => {
    const safe = safeLogFields({
      authorization: "Bearer abc",
      otp: "123456",
      userId: 7,
      nested: { password: "x", ok: true }
    });
    expect(safe.authorization).toBe("[redacted]");
    expect(safe.otp).toBe("[redacted]");
    expect(safe.userId).toBe(7);
    expect((safe.nested as Record<string, unknown>).password).toBe("[redacted]");
    expect(redactLogValue("note", "Bearer supersecret")).toBe("[redacted]");
  });

  it("routeError can attach correlation id without leaking internals", () => {
    const result = routeError(new Error("D1_ERROR SQLITE"), { correlationId: "cid-1" });
    expect(result.body.error.message).toBe("Request failed");
    expect((result.body.error as { correlationId?: string }).correlationId).toBe("cid-1");
  });
});

describe("Phase 2 rate-limit topology (isolate-local, not distributed)", () => {
  beforeEach(() => resetRateLimitsForTests());

  it("declares isolate-local topology explicitly", () => {
    expect(RATE_LIMIT_TOPOLOGY).toBe("isolate-local-map");
  });

  it("enforces fixed-window limits and composite keys", () => {
    const key = rateLimitKey({ surface: "staff-login", identity: "abc", ip: "1.2.3.4" });
    expect(key).toContain("staff-login");
    expect(key).toContain("1.2.3.4");
    for (let i = 0; i < 3; i += 1) expect(checkRateLimit(key, 3, 60_000)).toBe(true);
    expect(checkRateLimit(key, 3, 60_000)).toBe(false);
    // Different IP does not share the same bucket.
    expect(checkRateLimit(rateLimitKey({ surface: "staff-login", identity: "abc", ip: "9.9.9.9" }), 3, 60_000)).toBe(true);
  });

  it("reads CF-Connecting-IP for client identity", () => {
    const req = new Request("http://api/x", { headers: { "CF-Connecting-IP": "203.0.113.10" } });
    expect(clientIpFromRequest(req)).toBe("203.0.113.10");
  });
});
