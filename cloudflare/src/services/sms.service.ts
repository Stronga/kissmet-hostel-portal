import type { Env } from "../types/bindings";
import {
  ArkeselSmsProvider,
  MisconfiguredSmsProvider,
  resolveArkeselConfigState
} from "./arkesel-sms.provider";

/**
 * Provider-independent OTP delivery interface.
 * Authentication/domain code must not depend on Arkesel (or future WhatsApp) response shapes.
 *
 * Future extension (not implemented here):
 *   Kissmet OTP Engine
 *   ├── Arkesel SMS       [phase 1]
 *   └── WhatsApp Cloud    [later]
 */
export type OtpDeliveryRequest = {
  phone: string;
  code: string;
  expiresInMinutes: number;
};

export type OtpDeliveryErrorCategory =
  | "config"
  | "auth"
  | "timeout"
  | "network"
  | "provider_4xx"
  | "provider_5xx"
  | "rate_limit"
  | "invalid_phone"
  | "unknown";

export type OtpDeliveryResult = {
  ok: boolean;
  provider: string;
  providerMessageId?: string;
  errorCategory?: OtpDeliveryErrorCategory;
  correlationId?: string;
};

export interface SmsProvider {
  readonly name: string;
  sendOtp(request: OtpDeliveryRequest): Promise<OtpDeliveryResult>;
}

export type DevOtpCaptureEnv = {
  APP_ENV?: string;
  DEV_OTP_LOG?: string;
};

type DevOtpRecord = {
  destination: string;
  otp: string;
  at: number;
};

/** Module-level capture so local E2E can read OTPs across per-request provider instances. */
let lastDevOtp: DevOtpRecord | null = null;
const devOtpsByDestination = new Map<string, DevOtpRecord>();

export function isDevOtpCaptureEnabled(env?: DevOtpCaptureEnv): boolean {
  if (!env) return false;
  if (env.APP_ENV === "production") return false;
  if (env.DEV_OTP_LOG === "false") return false;
  return env.APP_ENV === "local" || env.DEV_OTP_LOG === "true";
}

export function captureDevOtp(destination: string, otp: string, env?: DevOtpCaptureEnv): void {
  if (!isDevOtpCaptureEnabled(env)) return;
  const record = { destination, otp, at: Date.now() };
  lastDevOtp = record;
  devOtpsByDestination.set(destination, record);
  console.info(`[kissmet-dev-otp] OTP for ${destination}: ${otp}`);
}

/** Test/local helper only. Never expose via a production HTTP route. */
export function getLastDevOtpForTests(): DevOtpRecord | null {
  return lastDevOtp;
}

/** Test/local helper only. Never expose via a production HTTP route. */
export function getDevOtpForDestinationForTests(destination: string): DevOtpRecord | null {
  return devOtpsByDestination.get(destination) ?? null;
}

export function clearDevOtpsForTests(): void {
  lastDevOtp = null;
  devOtpsByDestination.clear();
}

/**
 * Development/mock SMS provider.
 * Stores the last OTP in-memory for unit tests and, when APP_ENV=local (or DEV_OTP_LOG=true),
 * also logs it to the Worker console for local E2E. Disabled for production.
 * Never makes network calls — safe for CI.
 */
export class MockSmsProvider implements SmsProvider {
  readonly name = "mock";
  public lastMessage: { phone: string; code: string; expiresInMinutes: number } | null = null;
  /** @deprecated Prefer lastMessage.phone — kept for older test call sites during transition. */
  get lastDestination(): string | null {
    return this.lastMessage?.phone ?? null;
  }

  constructor(private readonly env?: DevOtpCaptureEnv) {}

  async sendOtp(request: OtpDeliveryRequest): Promise<OtpDeliveryResult> {
    this.lastMessage = {
      phone: request.phone,
      code: request.code,
      expiresInMinutes: request.expiresInMinutes
    };
    captureDevOtp(request.phone, request.code, this.env);
    return { ok: true, provider: this.name, providerMessageId: `mock-${Date.now()}` };
  }
}

export type SmsProviderName = "mock" | "arkesel";

/**
 * Resolve which delivery provider to use.
 * - local / unset: mock (CI-safe, no paid SMS)
 * - production: requires SMS_PROVIDER=arkesel and complete Arkesel config; otherwise fail-closed
 * - staging: mock unless SMS_PROVIDER=arkesel is set explicitly
 */
export function resolveSmsProviderName(env: Pick<Env, "APP_ENV" | "SMS_PROVIDER">): SmsProviderName {
  const configured = (env.SMS_PROVIDER ?? "").trim().toLowerCase();
  if (env.APP_ENV === "production") {
    return configured === "arkesel" ? "arkesel" : "mock";
  }
  if (configured === "arkesel") return "arkesel";
  return "mock";
}

/**
 * Factory used by auth/resident routes. Authentication code only depends on SmsProvider.
 */
export function createSmsProvider(env: Env, fetchImpl: typeof fetch = fetch): SmsProvider {
  const name = resolveSmsProviderName(env);

  if (env.APP_ENV === "production" && name !== "arkesel") {
    return new MisconfiguredSmsProvider("invalid_provider");
  }

  if (name === "arkesel") {
    const state = resolveArkeselConfigState(env);
    if (!state.ok) {
      return new MisconfiguredSmsProvider(state.reason ?? "missing_api_key");
    }
    return ArkeselSmsProvider.fromEnv(env, fetchImpl);
  }

  return new MockSmsProvider(env);
}

/** Resident-facing generic delivery failure (no Arkesel internals). */
export const OTP_DELIVERY_FAILURE_MESSAGE =
  "We couldn't send your verification code right now. Please try again shortly.";

export function isOtpDeliveryFailure(result: OtpDeliveryResult): boolean {
  return !result.ok;
}
