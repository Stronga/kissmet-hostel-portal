/**
 * Gender-restricted room eligibility (single source of truth).
 *
 * Schema (migrations/0001_canonical_schema.sql):
 *   residents.gender      TEXT NULL CHECK (gender IN ('female', 'male', 'other', 'not_specified'))
 *   rooms.gender_policy   TEXT NOT NULL DEFAULT 'any' CHECK (gender_policy IN ('female', 'male', 'any'))
 *
 * Rule:
 *   - Mixed rooms (gender_policy = 'any') accept every resident, whatever the recorded gender.
 *   - Single-gender rooms ('female' / 'male') accept ONLY residents whose recorded gender equals
 *     the policy. A missing (NULL/empty), 'not_specified' or 'other' gender is NOT eligible for a
 *     single-gender room — the hostel cannot verify eligibility, so it fails closed.
 *
 * Every allocation and booking workflow (legacy + rate-card booking, booking confirmation,
 * renewal, extension, allocation, same-room/legacy transfer, Path B cross-room transfer and
 * availability listings) must use these helpers so the rule is applied consistently.
 *
 * Errors carry a stable machine code and never include the resident's name, identifiers or
 * recorded gender value (no PII in API errors or audit metadata).
 */

export const SINGLE_GENDER_POLICIES = ["female", "male"] as const;
export type SingleGenderPolicy = (typeof SINGLE_GENDER_POLICIES)[number];

export const GENDER_ERROR_CODES = {
  /** Resident gender is missing, 'not_specified' or 'other' and the room is single-gender. */
  notEligible: "GENDER_NOT_ELIGIBLE_FOR_RESTRICTED_ROOM",
  /** Resident gender is recorded (female/male) but differs from the room's single-gender policy. */
  mismatch: "GENDER_POLICY_MISMATCH"
} as const;

export type GenderErrorCode = (typeof GENDER_ERROR_CODES)[keyof typeof GENDER_ERROR_CODES];

export class GenderEligibilityError extends Error {
  readonly code: GenderErrorCode;
  constructor(code: GenderErrorCode, message: string) {
    super(message);
    this.name = "GenderEligibilityError";
    this.code = code;
  }
}

export function isSingleGenderPolicy(policy: unknown): policy is SingleGenderPolicy {
  return policy === "female" || policy === "male";
}

/** Normalised gender usable for a single-gender room, or null when not eligible for any. */
export function restrictedRoomGender(gender: unknown): SingleGenderPolicy | null {
  return gender === "female" || gender === "male" ? gender : null;
}

export type GenderEligibility =
  | { eligible: true }
  | { eligible: false; code: GenderErrorCode };

export function evaluateGenderEligibility(roomPolicy: unknown, residentGender: unknown): GenderEligibility {
  // Unknown / legacy policy values are treated as restricted unless explicitly 'any'.
  if (roomPolicy === "any") return { eligible: true };
  const gender = restrictedRoomGender(residentGender);
  if (gender == null) return { eligible: false, code: GENDER_ERROR_CODES.notEligible };
  if (!isSingleGenderPolicy(roomPolicy) || roomPolicy !== gender) return { eligible: false, code: GENDER_ERROR_CODES.mismatch };
  return { eligible: true };
}

const MESSAGES: Record<GenderErrorCode, string> = {
  [GENDER_ERROR_CODES.notEligible]:
    "Gender not recorded as female or male; resident cannot be placed in a single-gender room. Correct the resident record or choose a mixed room",
  [GENDER_ERROR_CODES.mismatch]: "Gender-policy mismatch: the room's gender policy does not allow this resident"
};

export function assertGenderEligible(roomPolicy: unknown, residentGender: unknown): void {
  const result = evaluateGenderEligibility(roomPolicy, residentGender);
  if (!result.eligible) throw new GenderEligibilityError(result.code, MESSAGES[result.code]);
}

/**
 * SQL predicate for availability listings. Bind ONE parameter: `restrictedRoomGender(gender)`.
 * With a NULL bind only mixed rooms match, so ineligible beds are never offered.
 * `roomAlias` must be a trusted literal alias.
 */
export function genderEligibleRoomSql(roomAlias = "r"): string {
  if (!/^[a-z_]+$/.test(roomAlias)) throw new Error("Invalid SQL alias");
  return `(${roomAlias}.gender_policy = 'any' OR ${roomAlias}.gender_policy = ?)`;
}

/** Values allowed in residents.gender (migrations/0001 CHECK constraint). */
export const RESIDENT_GENDERS = ["female", "male", "other", "not_specified"] as const;
export type ResidentGender = (typeof RESIDENT_GENDERS)[number];

export function isResidentGender(value: unknown): value is ResidentGender {
  return typeof value === "string" && (RESIDENT_GENDERS as readonly string[]).includes(value);
}

/**
 * Why a recorded gender is being corrected. A fixed code list (no free text) keeps the audit trail
 * free of incidental personal data while still recording the justification.
 */
export const GENDER_CORRECTION_REASONS = ["data_entry_error", "resident_request", "identity_document_verified", "other"] as const;
export type GenderCorrectionReason = (typeof GENDER_CORRECTION_REASONS)[number];

export function isGenderCorrectionReason(value: unknown): value is GenderCorrectionReason {
  return typeof value === "string" && (GENDER_CORRECTION_REASONS as readonly string[]).includes(value);
}
