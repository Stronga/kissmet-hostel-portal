/**
 * Stage 2L-F / 2L-F-R: internal resident classification and identity helpers.
 *
 * UX primary choice is Institution (listed vs Other). resident_kind remains an
 * internal derived field:
 * - listed institution → student
 * - Other (null institution) → non_student
 *
 * Do not present Student/Non-Student as a separate operational workflow.
 * Ghana Card NUMBER is stored in residents.ghana_card_number (never student_id).
 * Ghana Card DOCUMENT remains documents.document_type = 'ghana_card'.
 */

export const RESIDENT_KINDS = ["student", "non_student"] as const;
export type ResidentKind = (typeof RESIDENT_KINDS)[number];

export function isResidentKind(value: unknown): value is ResidentKind {
  return typeof value === "string" && (RESIDENT_KINDS as readonly string[]).includes(value);
}

/** Derive internal kind from institution selection (listed vs Other). */
export function deriveResidentKind(institutionId: number | null | undefined): ResidentKind {
  return institutionId != null ? "student" : "non_student";
}

/** Institution + student_id must both be present or both absent (DB CHECK + domain). */
export function assertInstitutionStudentPair(
  institutionId: number | null | undefined,
  studentId: string | null | undefined,
): void {
  const hasInstitution = institutionId != null;
  const hasStudentId = typeof studentId === "string" ? studentId.trim().length > 0 : studentId != null;
  if (hasInstitution !== hasStudentId) {
    throw new Error("Institution and student ID must both be provided or both omitted");
  }
}

/**
 * @deprecated Prefer assertResidentIdentityFields — kept for existing call sites
 * that only validate kind + institution/student pair.
 */
export function assertResidentKindFields(
  kind: ResidentKind,
  institutionId: number | null | undefined,
  studentId: string | null | undefined,
): void {
  assertInstitutionStudentPair(institutionId, studentId);
  const hasInstitution = institutionId != null;
  const hasStudentId = typeof studentId === "string" ? studentId.trim().length > 0 : studentId != null;
  if (kind === "student") {
    if (!hasInstitution || !hasStudentId) {
      throw new Error("Student residents require institution and student ID");
    }
    return;
  }
  if (hasInstitution || hasStudentId) {
    throw new Error("Non-student residents must not have institution or student ID");
  }
}

export function normalizeGhanaCardNumber(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim().toUpperCase().replace(/\s+/g, "");
  return trimmed.length > 0 ? trimmed : null;
}

/** Mask sensitive Ghana Card numbers for lists/detail/UI (never log raw values). */
export function maskGhanaCardNumber(value: string | null | undefined): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (raw.length <= 4) return "****";
  return `${"*".repeat(Math.max(4, raw.length - 4))}${raw.slice(-4)}`;
}

/**
 * Full identity rules for Institution/Other:
 * - Listed institution: Student ID required; ghana_card_number must NOT be stored as student_id
 *   and should be null on the resident row (document still required separately).
 * - Other: ghana_card_number required; institution_id and student_id must be null.
 */
export function assertResidentIdentityFields(input: {
  kind?: ResidentKind | null;
  institutionId?: number | null;
  studentId?: string | null;
  ghanaCardNumber?: string | null;
}): ResidentKind {
  const institutionId = input.institutionId ?? null;
  const studentId =
    typeof input.studentId === "string" ? (input.studentId.trim() ? input.studentId.trim() : null) : input.studentId ?? null;
  const ghanaCardNumber = normalizeGhanaCardNumber(input.ghanaCardNumber);
  const kind = input.kind && isResidentKind(input.kind) ? input.kind : deriveResidentKind(institutionId);

  if (input.kind != null && isResidentKind(input.kind) && input.kind !== deriveResidentKind(institutionId)) {
    throw new Error("Resident kind does not match institution selection (listed vs Other)");
  }

  assertInstitutionStudentPair(institutionId, studentId);

  if (kind === "student") {
    if (institutionId == null || !studentId) {
      throw new Error("Listed-institution residents require institution and Student ID / School Number");
    }
    if (ghanaCardNumber) {
      throw new Error("Ghana Card number must not be stored as the listed-institution identifier; use Student ID");
    }
    // Guard against accidentally putting a Ghana Card-shaped value into student_id via misuse:
    // we do not reject formats here; storage rule is enforced by separate columns.
    return kind;
  }

  // Other / non_student
  if (institutionId != null || studentId) {
    throw new Error("Other residents must not have institution or student ID");
  }
  if (!ghanaCardNumber) {
    throw new Error("Other residents require a Ghana Card Number");
  }
  return kind;
}

export type IdentityDocRow = { document_type: string; status: string };

/** Required identity docs for application submit by resident_kind / listed-vs-Other. */
export function assertIdentityDocsForSubmit(kind: ResidentKind, docs: IdentityDocRow[]): void {
  const ok = (type: string) =>
    docs.some((d) => d.document_type === type && (d.status === "uploaded" || d.status === "verified"));
  if (!ok("ghana_card")) throw new Error("Ghana Card is required");
  if (kind === "student" && !ok("student_card")) throw new Error("Student Card is required");
}

/** Present a resident row without leaking raw Ghana Card numbers. */
export function presentResidentRow<T extends Record<string, unknown>>(row: T): T & {
  ghana_card_number_masked: string | null;
  has_ghana_card_number: boolean;
  identifier_type: "student_id" | "ghana_card_number";
} {
  const raw =
    typeof row.ghana_card_number === "string" && row.ghana_card_number.trim()
      ? String(row.ghana_card_number)
      : null;
  const { ghana_card_number: _omit, ...rest } = row as T & { ghana_card_number?: unknown };
  const kind = row.resident_kind === "non_student" || row.institution_id == null ? "non_student" : "student";
  return {
    ...(rest as T),
    ghana_card_number_masked: maskGhanaCardNumber(raw),
    has_ghana_card_number: Boolean(raw),
    identifier_type: kind === "non_student" ? "ghana_card_number" : "student_id",
  };
}
