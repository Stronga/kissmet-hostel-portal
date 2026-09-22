import { afterEach, describe, expect, it } from "vitest";
import {
  clearDevOtpsForTests,
  createSmsProvider,
  getLastDevOtpForTests,
  isDevOtpCaptureEnabled,
  MockSmsProvider,
  resolveSmsProviderName
} from "./sms.service";
import type { Env } from "../types/bindings";

afterEach(() => clearDevOtpsForTests());

describe("MockSmsProvider / local OTP capture", () => {
  it("is disabled in production", async () => {
    expect(isDevOtpCaptureEnabled({ APP_ENV: "production" })).toBe(false);
    const sms = new MockSmsProvider({ APP_ENV: "production" });
    await sms.sendOtp({ phone: "+2331", code: "123456", expiresInMinutes: 10 });
    expect(sms.lastMessage?.code).toBe("123456");
    expect(getLastDevOtpForTests()).toBeNull();
  });

  it("captures OTP across provider instances in local env", async () => {
    const a = new MockSmsProvider({ APP_ENV: "local" });
    await a.sendOtp({ phone: "+2331", code: "654321", expiresInMinutes: 10 });
    const b = new MockSmsProvider({ APP_ENV: "local" });
    expect(b.lastMessage).toBeNull();
    expect(getLastDevOtpForTests()).toMatchObject({ destination: "+2331", otp: "654321" });
  });

  it("respects DEV_OTP_LOG=false even in local", async () => {
    const sms = new MockSmsProvider({ APP_ENV: "local", DEV_OTP_LOG: "false" });
    await sms.sendOtp({ phone: "+2331", code: "111111", expiresInMinutes: 10 });
    expect(getLastDevOtpForTests()).toBeNull();
  });
});

describe("SMS provider selection", () => {
  it("selects mock locally and in tests by default", () => {
    expect(resolveSmsProviderName({ APP_ENV: "local" })).toBe("mock");
    expect(resolveSmsProviderName({ APP_ENV: "staging" })).toBe("mock");
    expect(createSmsProvider({ APP_ENV: "local" } as Env).name).toBe("mock");
  });

  it("selects Arkesel only when SMS_PROVIDER=arkesel", () => {
    expect(resolveSmsProviderName({ APP_ENV: "staging", SMS_PROVIDER: "arkesel" })).toBe("arkesel");
    expect(resolveSmsProviderName({ APP_ENV: "production", SMS_PROVIDER: "arkesel" })).toBe("arkesel");
  });

  it("production without explicit Arkesel fails closed (misconfigured)", async () => {
    const provider = createSmsProvider({ APP_ENV: "production", SMS_PROVIDER: "mock" } as Env);
    expect(provider.name).toBe("misconfigured");
    const result = await provider.sendOtp({ phone: "233241234567", code: "123456", expiresInMinutes: 10 });
    expect(result.ok).toBe(false);
    expect(result.errorCategory).toBe("config");
  });

  it("production Arkesel without sender/api key fails closed", async () => {
    const missingKey = createSmsProvider({
      APP_ENV: "production",
      SMS_PROVIDER: "arkesel",
      ARKESEL_SENDER_ID: "APPROVED"
    } as Env);
    expect(missingKey.name).toBe("misconfigured");
    const missingSender = createSmsProvider({
      APP_ENV: "production",
      SMS_PROVIDER: "arkesel",
      ARKESEL_API_KEY: "test-key-not-real"
    } as Env);
    expect(missingSender.name).toBe("misconfigured");
  });

  it("never makes live network calls for mock / CI selection", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      throw new Error("network should not be used");
    }) as unknown as typeof fetch;
    const provider = createSmsProvider({ APP_ENV: "local" } as Env, fetchImpl);
    await provider.sendOtp({ phone: "233241234567", code: "999999", expiresInMinutes: 10 });
    expect(called).toBe(false);
    expect(provider.name).toBe("mock");
  });
});
