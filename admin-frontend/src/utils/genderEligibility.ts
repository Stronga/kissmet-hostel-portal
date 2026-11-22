/**
 * Mirrors the backend rule in cloudflare/src/services/gender-eligibility.ts (the backend stays
 * authoritative). Mixed rooms ('any') accept everyone; single-gender rooms ('female'/'male')
 * accept only residents whose recorded gender matches. Missing, 'not_specified' and 'other'
 * are not eligible for single-gender rooms.
 */
export const GENDER_ERROR_MESSAGES: Record<string, string> = {
  GENDER_NOT_ELIGIBLE_FOR_RESTRICTED_ROOM:
    "This resident's gender is not recorded as female or male, so they can only be placed in a mixed room. Choose a mixed room or correct the resident record.",
  GENDER_POLICY_MISMATCH: "This room's gender policy does not allow this resident. Choose a room that matches, or a mixed room."
};

export function isRoomGenderEligible(roomPolicy: string | null | undefined, residentGender: string | null | undefined) {
  if (roomPolicy === "any") return true;
  if (residentGender !== "female" && residentGender !== "male") return false;
  return roomPolicy === residentGender;
}

export function hasRestrictedRoomGender(residentGender: string | null | undefined) {
  return residentGender === "female" || residentGender === "male";
}

export const MIXED_ROOMS_ONLY_NOTICE = "Gender not recorded as female or male: only mixed rooms are offered.";
