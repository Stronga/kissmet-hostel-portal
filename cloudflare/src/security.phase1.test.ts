import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { hasPermission, rolePermissions, type RoleCode } from "./auth/permissions";
import { randomOtp } from "./auth/crypto";
import { makeRequireAuth, requirePermission, requireResident, requireStaff } from "./middleware/auth.middleware";
import { securityHeadersMiddleware } from "./middleware/security-headers.middleware";
import { contentDispositionAttachment, validateUploadFile } from "./http/uploads";
import { publicErrorMessage } from "./http/safe-error";
import { pagination } from "./http/input";
import type { AuthRepository, SessionRecord } from "./repositories/auth.repository";
import type { Env } from "./types/bindings";
import type { AuthUser } from "./auth/context";

const env = { DB: {} } as Env;

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    session_id: 1,
    user_id: 1,
    display_name: "User",
    email: "u@test",
    user_type: "staff",
    user_status: "active",
    session_status: "active",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    staff_id: 1,
    staff_status: "active",
    resident_id: null,
    role_code: "manager",
    ...overrides
  };
}

class Repo {
  constructor(public session: SessionRecord | null) {}
  async findSessionByTokenHash() { return this.session; }
  async revokeSession() {}
}

describe("Phase 1 authorization matrix", () => {
  const roles = Object.keys(rolePermissions) as RoleCode[];

  it("documents role permission coverage for sensitive capabilities", () => {
    const sensitive = [
      "payment:verify",
      "receipt:write",
      "booking:confirm",
      "staff:read",
      "audit:read",
      "settings:read",
      "document:ghana_card",
      "internet:manage",
      "announcement:publish"
    ];
    for (const permission of sensitive) {
      const holders = roles.filter((role) => hasPermission(role, permission));
      expect(holders.length).toBeGreaterThan(0);
      expect(hasPermission("resident", permission)).toBe(false);
      expect(hasPermission("maintenance", permission)).toBe(false);
    }
    expect(hasPermission("reception", "payment:verify")).toBe(false);
    expect(hasPermission("accounts", "payment:verify")).toBe(true);
    expect(hasPermission("manager", "internet:manage")).toBe(true);
    expect(hasPermission("reception", "internet:manage")).toBe(false);
    expect(hasPermission("super_admin", "staff:read")).toBe(true);
    expect(hasPermission("manager", "*") || hasPermission("manager", "admin:write")).toBe(true);
  });

  it("keeps resident role limited to resident:self", () => {
    expect(rolePermissions.resident).toEqual(["resident:self"]);
  });
});

describe("Phase 1 session boundary", () => {
  type AppEnv = { Bindings: Env; Variables: { authUser: AuthUser } };

  it("blocks resident tokens from staff-only routes", async () => {
    const app = new Hono<AppEnv>();
    const sess = session({
      user_type: "resident",
      role_code: null,
      staff_id: null,
      staff_status: null,
      resident_id: 7
    });
    app.get(
      "/admin-like",
      makeRequireAuth(() => new Repo(sess) as unknown as AuthRepository),
      requireStaff(),
      (c) => c.json({ user: c.get("authUser") })
    );
    expect((await app.request("/admin-like", { headers: { Authorization: "Bearer abc" } }, env)).status).toBe(403);
  });

  it("blocks staff tokens from resident-only routes", async () => {
    const app = new Hono<AppEnv>();
    app.get(
      "/resident-like",
      makeRequireAuth(() => new Repo(session()) as unknown as AuthRepository),
      requireResident(),
      (c) => c.json({ user: c.get("authUser") })
    );
    expect((await app.request("/resident-like", { headers: { Authorization: "Bearer abc" } }, env)).status).toBe(403);
  });

  it("allows resident tokens on resident-only routes", async () => {
    const app = new Hono<AppEnv>();
    const sess = session({
      user_type: "resident",
      role_code: null,
      staff_id: null,
      staff_status: null,
      resident_id: 7
    });
    app.get(
      "/resident-like",
      makeRequireAuth(() => new Repo(sess) as unknown as AuthRepository),
      requireResident(),
      (c) => c.json({ user: c.get("authUser") })
    );
    const res = await app.request("/resident-like", { headers: { Authorization: "Bearer abc" } }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { user: AuthUser };
    expect(body.user.residentId).toBe(7);
    expect(body.user.staffId).toBeNull();
  });

  it("rejects forged/malformed missing bearer", async () => {
    const app = new Hono<AppEnv>();
    app.get("/x", makeRequireAuth(() => new Repo(session()) as unknown as AuthRepository), (c) => c.json({ ok: true }));
    expect((await app.request("/x", {}, env)).status).toBe(401);
  });

  it("enforces permission middleware for Super Admin-only style checks", async () => {
    const app = new Hono<AppEnv>();
    app.get(
      "/audit",
      makeRequireAuth(() => new Repo(session({ role_code: "reception" })) as unknown as AuthRepository),
      requireStaff(),
      requirePermission("audit:read"),
      (c) => c.json({ ok: true })
    );
    expect((await app.request("/audit", { headers: { Authorization: "Bearer t" } }, env)).status).toBe(403);
  });
});

describe("Phase 1 upload validation", () => {
  function fakeFile(name: string, type: string, size = 100): File {
    const blob = new Blob([new Uint8Array(size)], { type });
    return new File([blob], name, { type });
  }

  it("accepts allowlisted pdf/jpeg/png/webp", () => {
    expect(validateUploadFile(fakeFile("slip.PDF", "application/pdf")).extension).toBe(".pdf");
    expect(validateUploadFile(fakeFile("a.jpeg", "image/jpeg")).contentType).toBe("image/jpeg");
    expect(validateUploadFile(fakeFile("a.png", "image/png")).safeFilename).toMatch(/\.png$/);
    expect(validateUploadFile(fakeFile("a.webp", "image/webp")).size).toBe(100);
  });

  it("rejects dangerous extensions and MIME/extension mismatch", () => {
    expect(() => validateUploadFile(fakeFile("evil.html", "text/html"))).toThrow(/Unsupported/i);
    expect(() => validateUploadFile(fakeFile("evil.svg", "image/svg+xml"))).toThrow(/Unsupported/i);
    expect(() => validateUploadFile(fakeFile("evil.html", "application/pdf"))).toThrow(/Unsupported/i);
    expect(() => validateUploadFile(fakeFile("noext", "image/png"))).toThrow(/Unsupported/i);
    expect(validateUploadFile(fakeFile("../../etc/passwd.jpg", "image/jpeg")).safeFilename).not.toMatch(/\.\./);
  });

  it("rejects oversized uploads", () => {
    expect(() => validateUploadFile(fakeFile("big.pdf", "application/pdf", 6 * 1024 * 1024))).toThrow(/too large/i);
  });

  it("builds safe Content-Disposition attachment headers", () => {
    expect(contentDispositionAttachment('quote"name.pdf')).toBe('attachment; filename="quote_name.pdf"');
  });
});

describe("Phase 1 security headers / redaction / OTP entropy", () => {
  it("sets API security headers including nosniff and frame denial", async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.use("*", securityHeadersMiddleware);
    app.get("/auth/me", (c) => c.json({ ok: true }));
    const res = await app.request("/auth/me");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("redacts SQL/stack/password-like errors", () => {
    expect(publicErrorMessage(new Error("UNIQUE constraint failed: users.email"))).toBe("Conflict with an existing record");
    expect(publicErrorMessage(new Error("password_hash leaked at /workspace/x.ts:12"))).toBe("Request failed");
    expect(publicErrorMessage(new Error("Payment not found"))).toBe("Payment not found");
  });

  it("generates 6-digit OTPs without modulo bias helper crash", () => {
    for (let i = 0; i < 20; i += 1) {
      expect(randomOtp()).toMatch(/^\d{6}$/);
    }
  });

  it("sanitizes non-finite pagination inputs", () => {
    const url = new URL("https://example.test/x?limit=NaN&offset=-3");
    expect(pagination(url)).toEqual({ limit: 25, offset: 0 });
  });
});
