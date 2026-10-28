/**
 * Stage 2L-I — Universal resident identification for OTP auth.
 * Method A: listed institution + Student ID
 * Method B: Other + Ghana Card Number
 *
 * Do not trust frontend resident_kind. Derive from institution selection.
 */

import { normalizeGhanaCardNumber } from "../types/resident-kind";

/** Frontend/backend sentinel for Institution = Other (not a DB institution row). */
export const OTHER_INSTITUTION_CODE = "__other__";

export type ResidentAuthMethod = "listed_institution" | "other";

export type ResidentAuthIdentity =
  | { method: "listed_institution"; institutionCode: string; studentId: string }
  | { method: "other"; ghanaCardNumber: string };

export type ParseIdentityResult =
  | { ok: true; identity: ResidentAuthIdentity }
  | { ok: false; reason: "missing" | "inconsistent" };

/** Normalize Student ID / School Number using the existing safe trim rules. */
export function normalizeStudentId(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isOtherInstitutionSelection(institutionCode: string | null | undefined): boolean {
  if (institutionCode == null) return true;
  const code = String(institutionCode).trim();
  if (!code) return true;
  return code.toLowerCase() === OTHER_INSTITUTION_CODE.toLowerCase();
}

/**
 * Parse auth identification from a request body.
 * Rejects inconsistent combinations (listed + Ghana Card method, Other + Student ID method).
 */
export function parseResidentAuthIdentity(input: {
  institutionCode?: string | null;
  studentId?: string | null;
  ghanaCardNumber?: string | null;
  /** Ignored if present — never trusted from the client. */
  residentKind?: unknown;
  identifierType?: unknown;
}): ParseIdentityResult {
  const rawInstitution = typeof input.institutionCode === "string" ? input.institutionCode.trim() : input.institutionCode ?? null;
  const studentId = normalizeStudentId(input.studentId);
  const ghanaCardNumber = normalizeGhanaCardNumber(input.ghanaCardNumber);
  const other = isOtherInstitutionSelection(rawInstitution);

  // Explicit identifierType from old/new clients — validate consistency but do not require it.
  const declaredType =
    input.identifierType === "student_id" || input.identifierType === "ghana_card"
      ? input.identifierType
      : null;

  if (other) {
    if (studentId) return { ok: false, reason: "inconsistent" };
    if (declaredType === "student_id") return { ok: false, reason: "inconsistent" };
    if (!ghanaCardNumber) return { ok: false, reason: "missing" };
    return { ok: true, identity: { method: "other", ghanaCardNumber } };
  }

  if (!rawInstitution || typeof rawInstitution !== "string") {
    return { ok: false, reason: "missing" };
  }
  if (ghanaCardNumber && !studentId) {
    // Listed institution must not use Ghana Card as the login identifier.
    return { ok: false, reason: "inconsistent" };
  }
  if (declaredType === "ghana_card") return { ok: false, reason: "inconsistent" };
  if (!studentId) return { ok: false, reason: "missing" };
  // If both were sent for listed, ignore ghana card for login (student ID is the identifier).
  return {
    ok: true,
    identity: { method: "listed_institution", institutionCode: rawInstitution, studentId }
  };
}

export function authMethodAuditCategory(method: ResidentAuthMethod): "listed_institution" | "other" {
  return method;
}
