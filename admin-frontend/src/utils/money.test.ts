import { describe, expect, it } from "vitest";
import { parseMoneyToMinorUnits } from "./money";

describe("money input utilities", () => {
  it("converts Ghana cedi input to integer minor units without floating point math", () => {
    expect(parseMoneyToMinorUnits("2500.00")).toBe(250000);
    expect(parseMoneyToMinorUnits("2,500.50")).toBe(250050);
    expect(parseMoneyToMinorUnits("99")).toBe(9900);
  });

  it("rejects invalid money values", () => {
    expect(() => parseMoneyToMinorUnits("12.345")).toThrow("valid amount");
    expect(() => parseMoneyToMinorUnits("abc")).toThrow("valid amount");
  });
});
