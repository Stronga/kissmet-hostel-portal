import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { hashPassword } from "./crypto";
import { AuthService } from "../services/auth.service";
import { resetRateLimitsForTests } from "./rate-limit";
import { MockSmsProvider } from "../services/sms.service";
import { makeRequireAuth, requireRole } from "../middleware/auth.middleware";
import type { AuthRepository, SessionRecord } from "../repositories/auth.repository";
import type { Env } from "../types/bindings";

const env = { DB: {} } as Env;

class FakeRepo {
  staff: Awaited<ReturnType<AuthRepository["findStaffByIdentifier"]>> = null;
  resident: Awaited<ReturnType<AuthRepository["findResidentByStudentId"]>> = null;
  otp: Awaited<ReturnType<AuthRepository["findPendingOtp"]>> = null;
  recentOtpCount = 0;
  session: SessionRecord | null = null;
  revoked = false;
  audit: string[] = [];
  sessions = 0;
  otpAttempts = 0;
  otpUsed = false;
  otpExpired = false;

  async findStaffByIdentifier() { return this.staff; }
  async findResidentByStudentId() { return this.resident; }
  async createSession() { this.sessions += 1; return this.sessions; }
  async findSessionByTokenHash() { return this.session; }
  async revokeSession() { this.revoked = true; }
  async createOtp() { return undefined; }
  async countRecentOtps() { return { count: this.recentOtpCount }; }
  async findPendingOtp() { return this.otp; }
  async incrementOtpAttempt() { this.otpAttempts += 1; }
  async markOtpUsed() { this.otpUsed = true; }
  async markOtpExpired() { this.otpExpired = true; }
  async writeAudit(_actorUserId: number | null, _actorStaffId: number | null, action: string) { this.audit.push(action); }
}

function authService(repo: FakeRepo, sms = new MockSmsProvider()) {
  return new AuthService(env, sms, repo as unknown as AuthRepository);
}

function activeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    session_id: 1,
    user_id: 1,
    display_name: "Admin",
    email: "admin@kissmetgroup.org",
    user_type: "staff",
    user_status: "active",
    session_status: "active",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    staff_id: 1,
    resident_id: null,
    role_code: "manager",
    ...overrides
  };
}

describe("staff authentication", () => {
  beforeEach(() => resetRateLimitsForTests());

  it("allows valid staff login", async () => {
    const repo = new FakeRepo();
    repo.staff = {
      user_id: 1, email: "admin@kissmetgroup.org", username: "admin", display_name: "Admin",
      user_status: "active", password_hash: await hashPassword("Password123!"), staff_id: 1,
      staff_status: "active", role_code: "super_admin"
    };

    const result = await authService(repo).loginStaff("admin", "Password123!");

    expect(result.status).toBe(200);
    expect(repo.sessions).toBe(1);
    expect(result.ok && result.body.token).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects invalid password", async () => {
    const repo = new FakeRepo();
    repo.staff = {
      user_id: 1, email: "admin@kissmetgroup.org", username: "admin", display_name: "Admin",
      user_status: "active", password_hash: await hashPassword("Password123!"), staff_id: 1,
      staff_status: "active", role_code: "super_admin"
    };

    const result = await authService(repo).loginStaff("admin", "wrong");
    expect(result.status).toBe(401);
  });

  it("rejects inactive staff", async () => {
    const repo = new FakeRepo();
    repo.staff = {
      user_id: 1, email: "admin@kissmetgroup.org", username: "admin", display_name: "Admin",
      user_status: "active", password_hash: await hashPassword("Password123!"), staff_id: 1,
      staff_status: "inactive", role_code: "manager"
    };

    const result = await authService(repo).loginStaff("admin", "Password123!");
    expect(result.status).toBe(401);
  });

  it("rate limits staff login attempts", async () => {
    const repo = new FakeRepo();
    for (let i = 0; i < 5; i += 1) {
      expect((await authService(repo).loginStaff("missing", "wrong")).status).toBe(401);
    }
    expect((await authService(repo).loginStaff("missing", "wrong")).status).toBe(429);
  });
});

describe("resident OTP authentication", () => {
  it("creates resident OTP requests through the SMS provider", async () => {
    const repo = new FakeRepo();
    const sms = new MockSmsProvider();
    repo.resident = { resident_id: 1, resident_code: "KSM-RES-1", institution_code: "ug", student_id: "S1001", user_id: 1, display_name: "Resident", user_status: "active", resident_status: "applicant", phone: "+233000" };

    const result = await authService(repo, sms).requestResidentOtp("ug", "S1001");
    expect(result.ok).toBe(true);
    expect(sms.lastMessage?.destination).toBe("+233000");
  });

  it("verifies correct OTP and creates a session", async () => {
    const repo = new FakeRepo();
    repo.otp = { id: 1, code_hash: await hashPassword("123456"), attempt_count: 0, max_attempts: 5, expires_at: new Date(Date.now() + 60_000).toISOString(), status: "pending", resident_id: 1, user_id: 1 };

    const result = await authService(repo).verifyResidentOtp("ug", "S1001", "123456");
    expect(result.status).toBe(200);
    expect(repo.otpUsed).toBe(true);
    expect(repo.sessions).toBe(1);
  });

  it("rejects incorrect OTP", async () => {
    const repo = new FakeRepo();
    repo.otp = { id: 1, code_hash: await hashPassword("123456"), attempt_count: 0, max_attempts: 5, expires_at: new Date(Date.now() + 60_000).toISOString(), status: "pending", resident_id: 1, user_id: 1 };
    const result = await authService(repo).verifyResidentOtp("ug", "S1001", "000000");
    expect(result.status).toBe(401);
    expect(repo.otpAttempts).toBe(1);
  });

  it("rejects expired OTP", async () => {
    const repo = new FakeRepo();
    repo.otp = { id: 1, code_hash: await hashPassword("123456"), attempt_count: 0, max_attempts: 5, expires_at: new Date(Date.now() - 60_000).toISOString(), status: "pending", resident_id: 1, user_id: 1 };
    const result = await authService(repo).verifyResidentOtp("ug", "S1001", "123456");
    expect(result.status).toBe(401);
    expect(repo.otpExpired).toBe(true);
  });

  it("enforces OTP attempt limit", async () => {
    const repo = new FakeRepo();
    repo.otp = { id: 1, code_hash: await hashPassword("123456"), attempt_count: 5, max_attempts: 5, expires_at: new Date(Date.now() + 60_000).toISOString(), status: "pending", resident_id: 1, user_id: 1 };
    const result = await authService(repo).verifyResidentOtp("ug", "S1001", "123456");
    expect(result.status).toBe(429);
  });

  it("prevents OTP reuse", async () => {
    const repo = new FakeRepo();
    const service = authService(repo);
    repo.otp = { id: 1, code_hash: await hashPassword("123456"), attempt_count: 0, max_attempts: 5, expires_at: new Date(Date.now() + 60_000).toISOString(), status: "pending", resident_id: 1, user_id: 1 };
    expect((await service.verifyResidentOtp("ug", "S1001", "123456")).status).toBe(200);
    repo.otp = null;
    expect((await service.verifyResidentOtp("ug", "S1001", "123456")).status).toBe(401);
  });

  it("rate limits OTP requests without exposing account existence", async () => {
    const repo = new FakeRepo();
    repo.recentOtpCount = 3;
    repo.resident = { resident_id: 1, resident_code: "KSM-RES-1", institution_code: "ug", student_id: "S1001", user_id: 1, display_name: "Resident", user_status: "active", resident_status: "applicant", phone: "+233000" };
    const result = await authService(repo).requestResidentOtp("ug", "S1001");
    expect(result.ok).toBe(true);
    expect(repo.audit).toContain("auth.resident.otp_rate_limited");
  });
});

describe("authorization middleware", () => {
  async function requestWithSession(session: SessionRecord | null, path = "/protected") {
    const repo = new FakeRepo();
    repo.session = session;
    const app = new Hono<{ Bindings: Env; Variables: { authUser: import("./context").AuthUser } }>();
    app.get("/protected", makeRequireAuth(() => repo as unknown as AuthRepository), (c) => c.json({ user: c.get("authUser") }));
    app.get("/manager", makeRequireAuth(() => repo as unknown as AuthRepository), requireRole("manager"), (c) => c.json({ ok: true }));
    return app.request(path, { headers: { Authorization: "Bearer token" } }, env);
  }

  it("accepts a valid session", async () => {
    expect((await requestWithSession(activeSession())).status).toBe(200);
  });

  it("rejects an expired session", async () => {
    const repoSession = activeSession({ expires_at: new Date(Date.now() - 60_000).toISOString() });
    expect((await requestWithSession(repoSession)).status).toBe(401);
  });

  it("rejects a revoked session", async () => {
    expect((await requestWithSession(activeSession({ session_status: "revoked" }))).status).toBe(401);
  });

  it("rejects unauthorized route access", async () => {
    const app = new Hono<{ Bindings: Env; Variables: { authUser: import("./context").AuthUser } }>();
    app.get("/protected", makeRequireAuth(() => new FakeRepo() as unknown as AuthRepository), (c) => c.json({ ok: true }));
    expect((await app.request("/protected", {}, env)).status).toBe(401);
  });

  it("enforces role-restricted routes", async () => {
    expect((await requestWithSession(activeSession({ role_code: "accounts" }), "/manager")).status).toBe(403);
    expect((await requestWithSession(activeSession({ role_code: "manager" }), "/manager")).status).toBe(200);
  });
});
