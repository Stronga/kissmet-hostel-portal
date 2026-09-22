import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { safeAuthError } from "./errors";

describe("safeAuthError", () => {
  it("maps delivery failure without calling it an incorrect OTP", () => {
    const message = "We couldn't send your verification code right now. Please try again shortly.";
    expect(safeAuthError(new ApiError(message, 503))).toBe(message);
  });

  it("preserves expired OTP mapping for Invalid or expired OTP", () => {
    expect(safeAuthError(new ApiError("Invalid or expired OTP", 401))).toBe(
      "This verification code has expired. Request a new code."
    );
  });
});
