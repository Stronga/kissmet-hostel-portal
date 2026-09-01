import { apiRequest } from "./client";

export interface OtpRequestResponse {
  ok: true;
  message: string;
}

export interface LoginOtpInput {
  institutionCode: string;
  studentId: string;
}

export interface RegistrationOtpInput extends LoginOtpInput {
  firstName: string;
  middleName?: string | null;
  lastName: string;
  phone: string;
  email?: string | null;
}

export function requestResidentLoginOtp(input: LoginOtpInput) {
  return apiRequest<OtpRequestResponse>("/auth/resident/request-otp", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function verifyResidentLoginOtp(input: LoginOtpInput & { otp: string }) {
  return apiRequest<{ token: string; expiresAt: string }>("/auth/resident/verify-otp", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function requestRegistrationOtp(input: RegistrationOtpInput) {
  return apiRequest<OtpRequestResponse>("/resident/register/request-otp", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function verifyRegistrationOtp(input: LoginOtpInput & { otp: string }) {
  return apiRequest<{ ok: true; data: { token: string; resident: unknown } }>("/resident/register/verify-otp", {
    method: "POST",
    body: JSON.stringify(input)
  });
}
