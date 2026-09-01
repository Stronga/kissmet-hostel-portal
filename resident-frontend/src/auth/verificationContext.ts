import type { LoginOtpInput, RegistrationOtpInput } from "../api/residentAuth";

export type VerificationFlow = "login" | "registration";

export interface VerificationContext {
  flow: VerificationFlow;
  institutionCode: string;
  institutionName: string;
  studentId: string;
  registration?: RegistrationOtpInput;
}

const KEY = "kissmet_resident_verification_context";

export function saveVerificationContext(context: VerificationContext) {
  sessionStorage.setItem(KEY, JSON.stringify(context));
}

export function loadVerificationContext(): VerificationContext | null {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<VerificationContext>;
    if ((parsed.flow === "login" || parsed.flow === "registration") && parsed.institutionCode && parsed.studentId && parsed.institutionName) {
      return parsed as VerificationContext;
    }
  } catch {
    clearVerificationContext();
  }
  return null;
}

export function clearVerificationContext() {
  sessionStorage.removeItem(KEY);
}

export function loginContext(input: LoginOtpInput, institutionName: string): VerificationContext {
  return { flow: "login", institutionCode: input.institutionCode, studentId: input.studentId, institutionName };
}

export function registrationContext(input: RegistrationOtpInput, institutionName: string): VerificationContext {
  return {
    flow: "registration",
    institutionCode: input.institutionCode,
    studentId: input.studentId,
    institutionName,
    registration: input
  };
}
