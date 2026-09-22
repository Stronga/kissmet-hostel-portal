import { describe, expect, it } from "vitest";
import { maskPhone, normalizeGhanaPhoneForSms } from "./phone";

describe("normalizeGhanaPhoneForSms", () => {
  it("accepts local 0XXXXXXXXX form", () => {
    expect(normalizeGhanaPhoneForSms("0241234567")).toEqual({
      ok: true,
      e164Digits: "233241234567",
      masked: "233****567"
    });
  });

  it("accepts 233XXXXXXXXX form", () => {
    expect(normalizeGhanaPhoneForSms("233241234567")).toMatchObject({
      ok: true,
      e164Digits: "233241234567"
    });
  });

  it("accepts +233XXXXXXXXX form", () => {
    expect(normalizeGhanaPhoneForSms("+233241234567")).toMatchObject({
      ok: true,
      e164Digits: "233241234567"
    });
  });

  it("tolerates spaces and dashes", () => {
    expect(normalizeGhanaPhoneForSms("+233 24-123-4567")).toMatchObject({
      ok: true,
      e164Digits: "233241234567"
    });
  });

  it("rejects malformed numbers", () => {
    expect(normalizeGhanaPhoneForSms("12345").ok).toBe(false);
    expect(normalizeGhanaPhoneForSms("024123456").ok).toBe(false);
    expect(normalizeGhanaPhoneForSms("+1-555-0100").ok).toBe(false);
    expect(normalizeGhanaPhoneForSms("").ok).toBe(false);
    expect(normalizeGhanaPhoneForSms(null).ok).toBe(false);
  });

  it("masks phones for safe logs", () => {
    expect(maskPhone("233241234567")).toBe("233****567");
  });
});
