import { ApiError } from "../api/client";

export function safeAuthError(error: unknown) {
  if (!(error instanceof ApiError)) return "We could not reach the Kissmet server. Please try again.";
  if (error.status === 429) return "Too many attempts. Please try again later.";
  if (/attempt limit/i.test(error.message)) return "Too many attempts. Please try again later.";
  // Delivery failures mention "verification code" but must not look like a wrong/expired OTP.
  if (
    error.status === 503 ||
    /couldn'?t send your verification code|could not send your verification code|try again shortly/i.test(error.message)
  ) {
    return "We couldn't send your verification code right now. Please try again shortly.";
  }
  if (/valid Ghana phone/i.test(error.message)) return "Enter a valid Ghana phone number.";
  if (/expired/i.test(error.message)) return "This verification code has expired. Request a new code.";
  if (/otp|code/i.test(error.message)) return "The verification code is incorrect.";
  if (error.status === 401) return "We could not verify those resident details.";
  return error.message || "Request failed. Please try again.";
}
