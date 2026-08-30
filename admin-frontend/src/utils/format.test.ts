import { describe, expect, it } from "vitest";
import { formatCurrencyMinor, formatDateTime, formatStatus } from "./format";

describe("format utilities", () => {
  it("formats integer minor units as Ghana cedi", () => {
    expect(formatCurrencyMinor(350000)).toBe("GHS 3,500.00");
  });

  it("formats backend status names for display", () => {
    expect(formatStatus("under_review")).toBe("Under Review");
    expect(formatStatus("in_progress")).toBe("In Progress");
  });

  it("formats ISO timestamps for admin display", () => {
    expect(formatDateTime("2026-08-28T03:37:35.599Z")).toBe("28 Aug 2026, 3:37 AM");
  });

  it("handles missing or invalid timestamps", () => {
    expect(formatDateTime(null)).toBe("Not available");
    expect(formatDateTime("not-a-date")).toBe("Not available");
  });
});
