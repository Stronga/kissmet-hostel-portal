import { ApiError } from "../api/client";

export function safeAuthError(error: unknown) {
  if (!(error instanceof ApiError)) return "We could not reach the Kissmet server. Please try again.";
  if (error.status === 429) return "Too many attempts. Please try again later.";
  if (/attempt limit/i.test(error.message)) return "Too many attempts. Please try again later.";
  if (/expired/i.test(error.message)) return "This verification code has expired. Request a new code.";
  if (/otp|code/i.test(error.message)) return "The verification code is incorrect.";
  if (error.status === 401) return "We could not verify those resident details.";
  return error.message || "Request failed. Please try again.";
}
