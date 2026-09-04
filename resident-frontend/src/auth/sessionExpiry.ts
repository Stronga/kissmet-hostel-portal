export const SESSION_EXPIRED_KEY = "kissmet_resident_session_expired";

export function markSessionExpired() {
  sessionStorage.setItem(SESSION_EXPIRED_KEY, "1");
}

/** Returns true once, then clears the flag so the banner shows only once. */
export function consumeSessionExpiredFlag() {
  if (sessionStorage.getItem(SESSION_EXPIRED_KEY) !== "1") return false;
  sessionStorage.removeItem(SESSION_EXPIRED_KEY);
  return true;
}
