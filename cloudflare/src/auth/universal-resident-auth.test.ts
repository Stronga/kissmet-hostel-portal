import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword, sha256Hex } from "./crypto";
import { AuthService } from "../services/auth.service";
import { resetRateLimitsForTests } from "./rate-limit";
import { MockSmsProvider } from "../services/sms.service";
import type { AuthRepository, PendingOtpRecord, ResidentLoginRecord, SessionRecord } from "../repositories/auth.repository";
import type { Env } from "../types/bindings";
import { OTHER_INSTITUTION_CODE } from "./resident-identity";
import { normalizeGhanaCardNumber } from "../types/resident-kind";

const env = { DB: {} } as Env;

function listedResident(overrides: Partial<ResidentLoginRecord> = {}): ResidentLoginRecord {
  return {
    resident_id: 1,
    resident_code: "KSM-RES-1",
    institution_id: 1,
    institution_code: "ug",
    student_id: "S1001",
    ghana_card_number: null,
    user_id: 10,
    display_name: "Ama",
    user_status: "active",
    resident_status: "applicant",
    phone: "233241234567",
    resident_kind: "student",
    ...overrides
  };
}

function otherResident(overrides: Partial<ResidentLoginRecord> = {}): ResidentLoginRecord {
  return {
    resident_id: 2,
    resident_code: "KSM-RES-2",
    institution_id: null,
    institution_code: null,
    student_id: null,
    ghana_card_number: "GHA-123456789-0",
    user_id: 20,
    display_name: "Kojo",
    user_status: "active",
    resident_status: "applicant",
    phone: "233201112233",
    resident_kind: "non_student",
    ...overrides
  };
}

class FakeRepo {
  listed: ResidentLoginRecord[] = [];
  others: ResidentLoginRecord[] = [];
  otp: PendingOtpRecord | null = null;
  recentOtpCount = 0;
  lastCreateOtp: Record<string, unknown> | null = null;
  audit: Array<{ action: string; metadata?: Record<string, unknown> }> = [];
  sessions = 0;
  otpAttempts = 0;
  otpUsed = false;
  otpExpired = false;
  session: SessionRecord | null = null;

  async findStaffByIdentifier() { return null; }
  async findResidentByStudentId() { return this.listed; }
  async findResidentByGhanaCardNumber(card: string) {
    return this.others.filter((r) => r.ghana_card_number === card);
  }
  async createSession() { this.sessions += 1; return this.sessions; }
  async findSessionByTokenHash() { return this.session; }
  async revokeSession() { return undefined; }
  async createOtp(data: Record<string, unknown>) {
    this.lastCreateOtp = data;
    this.otp = {
      id: 99,
      code_hash: String(data.codeHash),
      attempt_count: 0,
      max_attempts: 5,
      expires_at: String(data.expiresAt),
      status: "pending",
      resident_id: Number(data.residentId),
      user_id: Number(data.userId),
      destination: String(data.destination),
      rate_limit_key: String(data.rateLimitKey)
    };
  }
  async countRecentOtps() { return { count: this.recentOtpCount }; }
  async countRecentOtpsForResident() { return { count: this.recentOtpCount }; }
  async findPendingOtp() { return this.otp; }
  async findPendingOtpByChallengeTokenHash(hash: string) {
    if (!this.lastCreateOtp) return this.otp;
    if (this.lastCreateOtp.challengeTokenHash === hash) return this.otp;
    return null;
  }
  async findPendingOtpByResidentId(id: number) {
    return this.otp && this.otp.resident_id === id ? this.otp : null;
  }
  async incrementOtpAttempt() { this.otpAttempts += 1; if (this.otp) this.otp.attempt_count += 1; }
  async markOtpUsed() { this.otpUsed = true; this.otp = null; }
  async markOtpExpired() { this.otpExpired = true; this.otp = null; }
  async writeAudit(_a: number | null, _b: number | null, action: string, _c?: string, _d?: number | null, metadata?: Record<string, unknown>) {
    this.audit.push({ action, metadata });
  }
  async countRecentStaffLoginFailures() { return { count: 0 }; }
}

function svc(repo: FakeRepo, sms = new MockSmsProvider()) {
  return new AuthService(env, sms, repo as unknown as AuthRepository);
}

describe("Stage 2L-I universal resident authentication", () => {
  beforeEach(() => resetRateLimitsForTests());

  it("listed institution + Student ID resolves an OTP challenge", async () => {
    const repo = new FakeRepo();
    const sms = new MockSmsProvider();
    repo.listed = [listedResident()];
    const result = await svc(repo, sms).requestResidentOtp({ institutionCode: "ug", studentId: "S1001" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.challengeId).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(result)).not.toMatch(/233241234567|S1001|GHA-/i);
    }
    expect(sms.lastMessage?.phone).toBe("233241234567");
    expect(repo.lastCreateOtp?.rateLimitKey).toBe("otp:resident_login:resident:1");
  });

  it("invalid Student ID fails generically without disclosing existence", async () => {
    const repo = new FakeRepo();
    const result = await svc(repo).requestResidentOtp({ institutionCode: "ug", studentId: "NOPE" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.challengeId).toBeTruthy();
    expect(repo.lastCreateOtp).toBeNull();
  });

  it("does not require Academic Session or Ghana Card for listed login", async () => {
    const repo = new FakeRepo();
    repo.listed = [listedResident()];
    const result = await svc(repo, new MockSmsProvider()).requestResidentOtp({ institutionCode: "ug", studentId: "S1001" });
    expect(result.ok).toBe(true);
    expect(repo.audit.some((a) => a.metadata?.authMethod === "listed_institution")).toBe(true);
  });

  it("Other + valid Ghana Card resolves a challenge using shared normalization", async () => {
    const repo = new FakeRepo();
    const sms = new MockSmsProvider();
    repo.others = [otherResident()];
    const result = await svc(repo, sms).requestResidentOtp({
      institutionCode: OTHER_INSTITUTION_CODE,
      ghanaCardNumber: "gha-123456789-0"
    });
    expect(result.ok).toBe(true);
    expect(sms.lastMessage?.phone).toBe("233201112233");
    expect(JSON.stringify(result)).not.toMatch(/GHA-123456789-0|233201112233/i);
    expect(repo.audit.some((a) => a.metadata?.authMethod === "other")).toBe(true);
  });

  it("invalid Ghana Card fails generically", async () => {
    const repo = new FakeRepo();
    const result = await svc(repo).requestResidentOtp({
      institutionCode: OTHER_INSTITUTION_CODE,
      ghanaCardNumber: "GHA-000"
    });
    expect(result.ok).toBe(true);
    expect(repo.lastCreateOtp).toBeNull();
  });

  it("rejects listed + Ghana Card method and Other + Student ID method", async () => {
    const repo = new FakeRepo();
    const listedBad = await svc(repo).requestResidentOtp({
      institutionCode: "ug",
      ghanaCardNumber: "GHA-1",
      identifierType: "ghana_card"
    });
    expect(listedBad.ok).toBe(true);
    expect(repo.lastCreateOtp).toBeNull();

    const otherBad = await svc(repo).requestResidentOtp({
      institutionCode: OTHER_INSTITUTION_CODE,
      studentId: "ST-1"
    });
    expect(otherBad.ok).toBe(true);
    expect(repo.lastCreateOtp).toBeNull();
  });

  it("does not let the caller substitute an arbitrary phone", async () => {
    const repo = new FakeRepo();
    const sms = new MockSmsProvider();
    repo.listed = [listedResident({ phone: "233241234567" })];
    await svc(repo, sms).requestResidentOtp({ institutionCode: "ug", studentId: "S1001" });
    expect(sms.lastMessage?.phone).toBe("233241234567");
    expect(repo.lastCreateOtp?.destination).toBe("233241234567");
  });

  it("verifies OTP via challengeId for Other without needing Ghana Card on verify", async () => {
    const repo = new FakeRepo();
    const sms = new MockSmsProvider();
    repo.others = [otherResident()];
    const requested = await svc(repo, sms).requestResidentOtp({
      institutionCode: OTHER_INSTITUTION_CODE,
      ghanaCardNumber: "GHA-123456789-0"
    });
    expect(requested.ok).toBe(true);
    if (!requested.ok) return;
    // Replace stored hash with known OTP hash for verify.
    const code = sms.lastMessage!.code;
    repo.otp = {
      ...repo.otp!,
      code_hash: await hashPassword(code)
    };
    repo.lastCreateOtp = {
      ...repo.lastCreateOtp!,
      challengeTokenHash: await sha256Hex(requested.challengeId!)
    };
    const verified = await svc(repo).verifyResidentOtp({
      challengeId: requested.challengeId,
      otp: code
    });
    expect(verified.status).toBe(200);
    expect(repo.sessions).toBe(1);
    expect(repo.otpUsed).toBe(true);
  });

  it("rejects incorrect, expired, and reused OTPs", async () => {
    const repo = new FakeRepo();
    repo.otp = {
      id: 1,
      code_hash: await hashPassword("123456"),
      attempt_count: 0,
      max_attempts: 5,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      status: "pending",
      resident_id: 1,
      user_id: 1,
      destination: "233",
      rate_limit_key: "x"
    };
    expect((await svc(repo).verifyResidentOtp({ institutionCode: "ug", studentId: "S1001", otp: "000000" })).status).toBe(401);

    repo.otp = {
      ...repo.otp!,
      expires_at: new Date(Date.now() - 1000).toISOString(),
      code_hash: await hashPassword("123456"),
      attempt_count: 0
    };
    repo.listed = [listedResident()];
    expect((await svc(repo).verifyResidentOtp({ institutionCode: "ug", studentId: "S1001", otp: "123456" })).status).toBe(401);
    expect(repo.otpExpired).toBe(true);

    repo.otpExpired = false;
    repo.otp = {
      id: 2,
      code_hash: await hashPassword("123456"),
      attempt_count: 0,
      max_attempts: 5,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      status: "pending",
      resident_id: 1,
      user_id: 1,
      destination: "233",
      rate_limit_key: "x"
    };
    expect((await svc(repo).verifyResidentOtp({ institutionCode: "ug", studentId: "S1001", otp: "123456" })).status).toBe(200);
    expect((await svc(repo).verifyResidentOtp({ institutionCode: "ug", studentId: "S1001", otp: "123456" })).status).toBe(401);
  });

  it("fails closed on ambiguous Ghana Card matches", async () => {
    const repo = new FakeRepo();
    const card = normalizeGhanaCardNumber("GHA-123456789-0")!;
    repo.others = [otherResident({ resident_id: 2 }), otherResident({ resident_id: 3, user_id: 21 })];
    const result = await svc(repo).requestResidentOtp({
      institutionCode: OTHER_INSTITUTION_CODE,
      ghanaCardNumber: card
    });
    expect(result.ok).toBe(true);
    expect(repo.lastCreateOtp).toBeNull();
    expect(repo.audit.some((a) => a.action === "auth.resident.otp_request_ambiguous")).toBe(true);
  });

  it("keeps raw Ghana Card and OTP out of audit metadata and API success bodies", async () => {
    const repo = new FakeRepo();
    const sms = new MockSmsProvider();
    repo.others = [otherResident()];
    const result = await svc(repo, sms).requestResidentOtp({
      institutionCode: OTHER_INSTITUTION_CODE,
      ghanaCardNumber: "GHA-123456789-0"
    });
    expect(JSON.stringify(result)).not.toMatch(/GHA-123456789-0/);
    expect(JSON.stringify(repo.audit)).not.toMatch(/GHA-123456789-0/);
    expect(JSON.stringify(result)).not.toMatch(sms.lastMessage!.code);
  });

  it("legacy listed student login path remains green", async () => {
    const repo = new FakeRepo();
    const sms = new MockSmsProvider();
    repo.listed = [listedResident()];
    const requested = await svc(repo, sms).requestResidentOtp("ug", "S1001");
    expect(requested.ok).toBe(true);
    repo.otp = {
      id: 1,
      code_hash: await hashPassword(sms.lastMessage!.code),
      attempt_count: 0,
      max_attempts: 5,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      status: "pending",
      resident_id: 1,
      user_id: 10,
      destination: "233241234567",
      rate_limit_key: "otp:resident_login:resident:1"
    };
    const verified = await svc(repo).verifyResidentOtp("ug", "S1001", sms.lastMessage!.code);
    expect(verified.status).toBe(200);
  });
});
