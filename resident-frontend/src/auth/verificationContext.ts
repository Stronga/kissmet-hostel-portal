import type { LoginOtpInput, RegistrationOtpInput } from "../api/residentAuth";
import { OTHER_INSTITUTION_CODE } from "../api/residentAuth";

export type VerificationFlow = "login" | "registration";

export interface VerificationContext {
  flow: VerificationFlow;
  institutionCode: string;
  institutionName: string;
  /** Listed-institution Student ID only — never store Ghana Card here. */
  studentId?: string;
  /** Opaque OTP challenge from the server (preferred verify key). */
  challengeId?: string;
  /** True when Institution = Other. */
  isOther: boolean;
  registration?: RegistrationOtpInput;
}

const KEY = "kissmet_resident_verification_context";

/**
 * In-memory only (never sessionStorage): Ghana Card for Other login resend / registration resend.
 */
let sensitiveIdentity: { ghanaCardNumber?: string; registration?: RegistrationOtpInput } | null = null;

export function saveVerificationContext(context: VerificationContext, ghanaCardNumber?: string) {
  if (context.isOther && ghanaCardNumber) {
    sensitiveIdentity = {
      ghanaCardNumber,
      registration: context.registration
    };
  } else if (context.flow === "registration" && context.registration) {
    sensitiveIdentity = { registration: { ...context.registration } };
  } else {
    sensitiveIdentity = null;
  }

  const stored: VerificationContext = {
    flow: context.flow,
    institutionCode: context.institutionCode,
    institutionName: context.institutionName,
    studentId: context.isOther ? undefined : context.studentId,
    challengeId: context.challengeId,
    isOther: context.isOther,
    // Persist registration without Ghana Card number.
    registration: context.registration
      ? {
          ...context.registration,
          ghanaCardNumber: undefined
        }
      : undefined
  };
  sessionStorage.setItem(KEY, JSON.stringify(stored));
}

export function loadVerificationContext(): VerificationContext | null {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<VerificationContext>;
    if (
      (parsed.flow === "login" || parsed.flow === "registration") &&
      parsed.institutionCode &&
      parsed.institutionName
    ) {
      const isOther = Boolean(parsed.isOther) || parsed.institutionCode === OTHER_INSTITUTION_CODE;
      const ctx: VerificationContext = {
        flow: parsed.flow,
        institutionCode: parsed.institutionCode,
        institutionName: parsed.institutionName,
        studentId: parsed.studentId,
        challengeId: parsed.challengeId,
        isOther,
        registration: parsed.registration as RegistrationOtpInput | undefined
      };
      if (ctx.flow === "registration" && sensitiveIdentity?.registration) {
        ctx.registration = sensitiveIdentity.registration;
      }
      if (ctx.flow === "login") {
        if (ctx.isOther && !ctx.challengeId) return null;
        if (!ctx.isOther && !ctx.studentId) return null;
      }
      return ctx;
    }
  } catch {
    clearVerificationContext();
  }
  return null;
}

export function peekOtherGhanaCardNumber(): string | undefined {
  return sensitiveIdentity?.ghanaCardNumber;
}

export function clearVerificationContext() {
  sessionStorage.removeItem(KEY);
  sensitiveIdentity = null;
}

export function loginContext(
  input: LoginOtpInput & { challengeId?: string },
  institutionName: string
): VerificationContext {
  const isOther = input.institutionCode === OTHER_INSTITUTION_CODE;
  return {
    flow: "login",
    institutionCode: input.institutionCode,
    studentId: isOther ? undefined : input.studentId,
    challengeId: input.challengeId,
    institutionName,
    isOther
  };
}

export function registrationContext(
  input: RegistrationOtpInput,
  institutionName: string
): VerificationContext {
  const isOther = input.institutionCode === OTHER_INSTITUTION_CODE;
  return {
    flow: "registration",
    institutionCode: input.institutionCode,
    studentId: isOther ? undefined : input.studentId,
    institutionName,
    isOther,
    registration: input
  };
}
