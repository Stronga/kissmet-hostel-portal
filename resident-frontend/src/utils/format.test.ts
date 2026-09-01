import { describe, expect, it } from "vitest";
import { formatDateTime, formatMoneyMinor, statusLabel } from "./format";

describe("resident format utilities", () => {
  it("formats GHS minor units without floating point inputs", () => {
    expect(formatMoneyMinor(12345)).toContain("GHS");
    expect(formatMoneyMinor(12345)).toContain("123.45");
  });

  it("formats readable date/time values", () => {
    expect(formatDateTime("2026-08-28T03:37:35.599Z")).toMatch(/Aug 2026/);
    expect(formatDateTime("2026-08-28T03:37:35.599Z")).not.toContain("T03:37:35.599Z");
  });

  it("returns unavailable for missing or invalid dates", () => {
    expect(formatDateTime(null)).toBe("Unavailable");
    expect(formatDateTime("not-a-date")).toBe("Unavailable");
  });

  it("creates readable status labels without changing backend values", () => {
    expect(statusLabel("past_resident")).toBe("Past Resident");
  });
});
