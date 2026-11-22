import { describe, expect, it } from "vitest";
import { hasRestrictedRoomGender, isRoomGenderEligible } from "./genderEligibility";

describe("isRoomGenderEligible", () => {
  it("mixed rooms accept everyone", () => {
    for (const g of ["female", "male", "other", "not_specified", null, undefined]) expect(isRoomGenderEligible("any", g)).toBe(true);
  });
  it("single-gender rooms accept only the matching recorded gender", () => {
    expect(isRoomGenderEligible("female", "female")).toBe(true);
    expect(isRoomGenderEligible("male", "male")).toBe(true);
    expect(isRoomGenderEligible("female", "male")).toBe(false);
    for (const g of ["other", "not_specified", null, undefined, ""]) {
      expect(isRoomGenderEligible("female", g)).toBe(false);
      expect(isRoomGenderEligible("male", g)).toBe(false);
    }
  });
  it("flags residents restricted to mixed rooms", () => {
    expect(hasRestrictedRoomGender("female")).toBe(true);
    expect(hasRestrictedRoomGender("other")).toBe(false);
    expect(hasRestrictedRoomGender(null)).toBe(false);
  });
});
