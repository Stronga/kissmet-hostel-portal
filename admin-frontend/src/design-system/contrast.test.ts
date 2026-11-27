import { describe, expect, it } from "vitest";
import { contrastRatio } from "./contrast";
import { approvedContrastPairs, disallowedLightTextPairs } from "./tokens";

describe("Kissmet colour contrast", () => {
  it.each(approvedContrastPairs)("$id meets $minRatio:1 ($usage)", (pair) => {
    expect(contrastRatio(pair.foreground, pair.background)).toBeGreaterThanOrEqual(pair.minRatio);
  });

  it.each(disallowedLightTextPairs)("$id stays below the AA UI threshold", (pair) => {
    expect(contrastRatio(pair.foreground, pair.background)).toBeLessThan(pair.minRatio);
  });

  it("keeps gold on primary green below body-text contrast", () => {
    expect(contrastRatio("#B9A17A", "#064B36")).toBeLessThan(4.5);
    expect(contrastRatio("#B9A17A", "#064B36")).toBeGreaterThanOrEqual(3);
  });
});
