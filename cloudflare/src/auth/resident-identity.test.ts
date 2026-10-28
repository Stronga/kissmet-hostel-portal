import { describe, expect, it } from "vitest";
import {
  OTHER_INSTITUTION_CODE,
  isOtherInstitutionSelection,
  normalizeStudentId,
  parseResidentAuthIdentity
} from "./resident-identity";
import { normalizeGhanaCardNumber } from "../types/resident-kind";

describe("resident identity parsing (2L-I)", () => {
  it("parses listed institution + student ID", () => {
    const parsed = parseResidentAuthIdentity({ institutionCode: "ug", studentId: " ST-1 " });
    expect(parsed).toEqual({
      ok: true,
      identity: { method: "listed_institution", institutionCode: "ug", studentId: "ST-1" }
    });
  });

  it("parses Other + Ghana Card with shared normalization", () => {
    const card = "gha-123456789-0";
    expect(normalizeGhanaCardNumber(card)).toBe("GHA-123456789-0");
    const parsed = parseResidentAuthIdentity({
      institutionCode: OTHER_INSTITUTION_CODE,
      ghanaCardNumber: card
    });
    expect(parsed).toEqual({
      ok: true,
      identity: { method: "other", ghanaCardNumber: "GHA-123456789-0" }
    });
  });

  it("treats null/empty institution as Other", () => {
    expect(isOtherInstitutionSelection(null)).toBe(true);
    expect(isOtherInstitutionSelection("")).toBe(true);
    expect(isOtherInstitutionSelection(OTHER_INSTITUTION_CODE)).toBe(true);
  });

  it("rejects listed + Ghana Card login method", () => {
    expect(parseResidentAuthIdentity({
      institutionCode: "ug",
      ghanaCardNumber: "GHA-1",
      identifierType: "ghana_card"
    }).ok).toBe(false);
  });

  it("rejects Other + Student ID login method", () => {
    expect(parseResidentAuthIdentity({
      institutionCode: OTHER_INSTITUTION_CODE,
      studentId: "ST-1"
    }).ok).toBe(false);
  });

  it("ignores untrusted resident_kind from the client", () => {
    const parsed = parseResidentAuthIdentity({
      institutionCode: "ug",
      studentId: "ST-1",
      residentKind: "non_student"
    });
    expect(parsed.ok && parsed.identity.method).toBe("listed_institution");
  });

  it("normalizes student IDs with trim only", () => {
    expect(normalizeStudentId("  ABC  ")).toBe("ABC");
    expect(normalizeStudentId("   ")).toBeNull();
  });
});
