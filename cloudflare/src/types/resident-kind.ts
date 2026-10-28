/**
 * Stage 2L-F: student vs non_student resident classification and application
 * document/period validation helpers. Auth/OTP login redesign is out of scope.
 */

export const RESIDENT_KINDS = ["student", "non_student"] as const;
export type ResidentKind = (typeof RESIDENT_KINDS)[number];

export function isResidentKind(value: unknown): value is ResidentKind {
  return typeof value === "string" && (RESIDENT_KINDS as readonly string[]).includes(value);
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

export type IdentityDocRow = { document_type: string; status: string };

/** Required identity docs for application submit by resident_kind. */
export function assertIdentityDocsForSubmit(kind: ResidentKind, docs: IdentityDocRow[]): void {
  const ok = (type: string) =>
    docs.some((d) => d.document_type === type && (d.status === "uploaded" || d.status === "verified"));
  if (!ok("ghana_card")) throw new Error("Ghana Card is required");
  if (kind === "student" && !ok("student_card")) throw new Error("Student Card is required");
}
