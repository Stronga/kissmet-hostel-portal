import { afterEach, describe, expect, it } from "vitest";
import app from "../src/index";
import type { Env } from "../src/types/bindings";
import {
  clearDevOtpsForTests,
  createSmsProvider,
  getLastDevOtpForTests,
  MockSmsProvider
} from "../src/services/sms.service";
import {
  isStagingOtpTestLookupReady,
  isStagingOtpTestPathEnabled,
  persistStagingOtp,
  stagingOtpInboxTableExists
} from "../src/services/staging-otp-test";
import { validateProductionConfig } from "../src/config/production-secrets";
import { openMigratedDatabase } from "./apply-migrations";
import { createSqlJsD1 } from "./sqljs-d1";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

afterEach(() => clearDevOtpsForTests());

const here = path.dirname(fileURLToPath(import.meta.url));
const wranglerToml = fs.readFileSync(path.resolve(here, "../wrangler.toml"), "utf8");

function stagingEnv(db: D1Database, overrides: Partial<Env> = {}): Env {
  return {
    APP_NAME: "kissmet-test",
    APP_ENV: "staging",
    APP_VERSION: "0.1.0",
    PUBLIC_BASE_URL: "https://staging-api.kissmetgroup.org",
    ADMIN_ALLOWED_ORIGINS: "https://staging-admin.kissmetgroup.org,https://staging-portal.kissmetgroup.org",
    SMS_PROVIDER: "mock",
    STAGING_OTP_TEST_KEY: "staging-otp-test-secret",
    DB: db,
    DOCUMENTS: {} as R2Bucket,
    ...overrides
  } as Env;
}

describe("staging OTP test path enablement", () => {
  it("is enabled only when APP_ENV is staging", () => {
    expect(isStagingOtpTestPathEnabled({ APP_ENV: "staging" })).toBe(true);
    expect(isStagingOtpTestPathEnabled({ APP_ENV: "production" })).toBe(false);
    expect(isStagingOtpTestPathEnabled({ APP_ENV: "local" })).toBe(false);
    expect(isStagingOtpTestPathEnabled(undefined)).toBe(false);
  });

  it("lookup stays disabled in staging until the secret is set", () => {
    expect(isStagingOtpTestLookupReady({ APP_ENV: "staging" })).toBe(false);
    expect(isStagingOtpTestLookupReady({ APP_ENV: "staging", STAGING_OTP_TEST_KEY: "  " })).toBe(false);
    expect(isStagingOtpTestLookupReady({ APP_ENV: "staging", STAGING_OTP_TEST_KEY: "set" })).toBe(true);
    expect(isStagingOtpTestLookupReady({ APP_ENV: "production", STAGING_OTP_TEST_KEY: "set" })).toBe(false);
  });

  it("cannot be turned on in production by DEV_OTP_LOG or STAGING_OTP_TEST_KEY", () => {
    expect(isStagingOtpTestPathEnabled({ APP_ENV: "production" })).toBe(false);
    expect(
      isStagingOtpTestLookupReady({
        APP_ENV: "production",
        STAGING_OTP_TEST_KEY: "even-if-the-secret-is-present"
      })
    ).toBe(false);
  });
});

describe("staging OTP inbox capture", () => {
  it("writes an inbox row in staging and not in production, even when a DB is present", async () => {
    const stagingDbRaw = await openMigratedDatabase();
    const productionDbRaw = await openMigratedDatabase();
    const stagingDb = createSqlJsD1(stagingDbRaw);
    const productionDb = createSqlJsD1(productionDbRaw);

    const stagingSms = new MockSmsProvider({ APP_ENV: "staging", DB: stagingDb });
    await stagingSms.sendOtp({ phone: "233555010001", code: "654321", expiresInMinutes: 10 });
    expect(await stagingOtpInboxTableExists(stagingDb)).toBe(true);

    const productionSms = new MockSmsProvider({ APP_ENV: "production", DB: productionDb });
    await productionSms.sendOtp({ phone: "233555010001", code: "654321", expiresInMinutes: 10 });
    expect(await stagingOtpInboxTableExists(productionDb)).toBe(false);
    expect(getLastDevOtpForTests()).toBeNull();

    const localDb = createSqlJsD1(await openMigratedDatabase());
    const localSms = new MockSmsProvider({ APP_ENV: "local", DB: localDb });
    await localSms.sendOtp({ phone: "233555010001", code: "111111", expiresInMinutes: 10 });
    expect(await stagingOtpInboxTableExists(localDb)).toBe(false);
  });

  it("createSmsProvider in production never uses the mock inbox even if SMS_PROVIDER=mock", async () => {
    const db = createSqlJsD1(await openMigratedDatabase());
    const provider = createSmsProvider({ APP_ENV: "production", SMS_PROVIDER: "mock", DB: db } as Env);
    expect(provider.name).toBe("misconfigured");
    await provider.sendOtp({ phone: "233555010001", code: "123456", expiresInMinutes: 10 });
    expect(await stagingOtpInboxTableExists(db)).toBe(false);
  });

  it("persistStagingOtp is a no-op when APP_ENV is not staging", async () => {
    const db = createSqlJsD1(await openMigratedDatabase());
    await persistStagingOtp({ APP_ENV: "production", DB: db } as Env, {
      phone: "233555010001",
      code: "000000",
      expiresInMinutes: 10
    });
    expect(await stagingOtpInboxTableExists(db)).toBe(false);
  });
});

describe("POST /staging/otp-test/lookup", () => {
  it("returns 404 in production even when the secret is set, DEV_OTP_LOG is true, and an inbox row exists", async () => {
    const raw = await openMigratedDatabase();
    const db = createSqlJsD1(raw);
    await persistStagingOtp({ APP_ENV: "staging", DB: db } as Env, {
      phone: "233555010001",
      code: "777777",
      expiresInMinutes: 10
    });
    const env = stagingEnv(db, {
      APP_ENV: "production",
      SMS_PROVIDER: "arkesel",
      ARKESEL_API_KEY: "test-key-not-real",
      ARKESEL_SENDER_ID: "APPROVED",
      PUBLIC_BASE_URL: "https://api.kissmetgroup.org",
      DEV_OTP_LOG: "true",
      STAGING_OTP_TEST_KEY: "staging-otp-test-secret"
    });
    const res = await app.request(
      "/staging/otp-test/lookup",
      {
        method: "POST",
        headers: { "content-type": "application/json", "X-Staging-Otp-Key": "staging-otp-test-secret" },
        body: JSON.stringify({ phone: "+233555010001" })
      },
      env
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("777777");
  });

  it("returns 404 in local (the path is staging-only; local uses DEV_OTP_LOG)", async () => {
    const db = createSqlJsD1(await openMigratedDatabase());
    const res = await app.request(
      "/staging/otp-test/lookup",
      {
        method: "POST",
        headers: { "content-type": "application/json", "X-Staging-Otp-Key": "staging-otp-test-secret" },
        body: JSON.stringify({ phone: "+233555010001" })
      },
      stagingEnv(db, { APP_ENV: "local" })
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 in staging when the secret is unset", async () => {
    const db = createSqlJsD1(await openMigratedDatabase());
    const res = await app.request(
      "/staging/otp-test/lookup",
      {
        method: "POST",
        headers: { "content-type": "application/json", "X-Staging-Otp-Key": "staging-otp-test-secret" },
        body: JSON.stringify({ phone: "+233555010001" })
      },
      stagingEnv(db, { STAGING_OTP_TEST_KEY: "" })
    );
    expect(res.status).toBe(404);
  });

  it("returns 401 in staging when the key is wrong", async () => {
    const db = createSqlJsD1(await openMigratedDatabase());
    const res = await app.request(
      "/staging/otp-test/lookup",
      {
        method: "POST",
        headers: { "content-type": "application/json", "X-Staging-Otp-Key": "wrong-key" },
        body: JSON.stringify({ phone: "+233555010001" })
      },
      stagingEnv(db)
    );
    expect(res.status).toBe(401);
  });

  it("returns the captured OTP in staging with the correct key", async () => {
    const db = createSqlJsD1(await openMigratedDatabase());
    const sms = new MockSmsProvider({ APP_ENV: "staging", DB: db });
    await sms.sendOtp({ phone: "233555010001", code: "246810", expiresInMinutes: 10 });

    const res = await app.request(
      "/staging/otp-test/lookup",
      {
        method: "POST",
        headers: { "content-type": "application/json", "X-Staging-Otp-Key": "staging-otp-test-secret" },
        body: JSON.stringify({ phone: "+233555010001" })
      },
      stagingEnv(db)
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; otp: string; destinationMasked: string };
    expect(body.ok).toBe(true);
    expect(body.otp).toBe("246810");
    expect(body.destinationMasked).toBe("233****001");
    expect(JSON.stringify(body)).not.toContain("555010001");
  });
});

describe("production config and wrangler staging guards", () => {
  it("flags STAGING_OTP_TEST_KEY as a critical production issue", () => {
    const issues = validateProductionConfig({
      APP_ENV: "production",
      SMS_PROVIDER: "arkesel",
      ARKESEL_API_KEY: "test-key-not-real",
      ARKESEL_SENDER_ID: "APPROVED",
      PUBLIC_BASE_URL: "https://api.kissmetgroup.org",
      STAGING_OTP_TEST_KEY: "should-never-be-here"
    } as Env);
    expect(issues.some((i) => i.code === "staging_otp_test_key" && i.severity === "critical")).toBe(true);
  });

  it("does not flag the staging secret when APP_ENV is staging", () => {
    const issues = validateProductionConfig({
      APP_ENV: "staging",
      SMS_PROVIDER: "mock",
      STAGING_OTP_TEST_KEY: "ok-in-staging",
      PUBLIC_BASE_URL: "https://staging-api.kissmetgroup.org"
    } as Env);
    expect(issues).toEqual([]);
  });

  it("keeps staging on mock SMS, placeholder D1, private R2, no connector URL, no DEV_OTP_LOG", () => {
    const stagingVars = wranglerToml.split("[env.staging.vars]")[1].split("[[env.staging")[0];
    const stagingD1 = wranglerToml.split("[[env.staging.d1_databases]]")[1].split("[[")[0];
    const stagingR2 = wranglerToml.split("[[env.staging.r2_buckets]]")[1].split("# --- production")[0];
    expect(stagingVars).toMatch(/APP_ENV\s*=\s*"staging"/);
    expect(stagingVars).toMatch(/SMS_PROVIDER\s*=\s*"mock"/);
    expect(stagingVars).not.toMatch(/DEV_OTP_LOG\s*=\s*"true"/);
    expect(stagingVars).not.toMatch(/^[A-Z0-9_]*MIKROTIK_CONNECTOR_URL\s*=/m);
    expect(stagingVars).not.toMatch(/^STAGING_OTP_TEST_KEY\s*=/m);
    expect(stagingVars).not.toMatch(/^DEV_OTP_LOG\s*=/m);
    expect(stagingD1).toContain("kissmet-hostel-staging");
    expect(stagingD1).toContain("replace-with-staging-d1-database-id");
    expect(stagingR2).toContain("kissmet-hostel-staging-documents");
    expect(wranglerToml).toMatch(/Private bucket/);
  });
});
