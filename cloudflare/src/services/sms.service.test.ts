import { afterEach, describe, expect, it } from "vitest";
import {
  clearDevOtpsForTests,
  getLastDevOtpForTests,
  isDevOtpCaptureEnabled,
  MockSmsProvider
} from "./sms.service";

afterEach(() => clearDevOtpsForTests());

describe("MockSmsProvider / local OTP capture", () => {
  it("is disabled in production", async () => {
    expect(isDevOtpCaptureEnabled({ APP_ENV: "production" })).toBe(false);
    const sms = new MockSmsProvider({ APP_ENV: "production" });
    await sms.sendOtp("+2331", "123456");
    expect(sms.lastMessage?.otp).toBe("123456");
    expect(getLastDevOtpForTests()).toBeNull();
  });

  it("captures OTP across provider instances in local env", async () => {
    const a = new MockSmsProvider({ APP_ENV: "local" });
    await a.sendOtp("+2331", "654321");
    const b = new MockSmsProvider({ APP_ENV: "local" });
    expect(b.lastMessage).toBeNull();
    expect(getLastDevOtpForTests()).toMatchObject({ destination: "+2331", otp: "654321" });
  });

  it("respects DEV_OTP_LOG=false even in local", async () => {
    const sms = new MockSmsProvider({ APP_ENV: "local", DEV_OTP_LOG: "false" });
    await sms.sendOtp("+2331", "111111");
    expect(getLastDevOtpForTests()).toBeNull();
  });
});
