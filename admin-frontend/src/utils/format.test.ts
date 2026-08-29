import { describe, expect, it } from "vitest";
import { formatCurrencyMinor, formatStatus } from "./format";

describe("format utilities", () => {
  it("formats integer minor units as Ghana cedi", () => {
    expect(formatCurrencyMinor(350000)).toBe("GHS 3,500.00");
  });

  it("formats backend status names for display", () => {
    expect(formatStatus("under_review")).toBe("Under Review");
    expect(formatStatus("in_progress")).toBe("In Progress");
  });
});
