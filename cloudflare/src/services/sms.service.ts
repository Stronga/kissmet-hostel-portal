export interface SmsProvider {
  sendOtp(destination: string, otp: string): Promise<void>;
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
 */
export class MockSmsProvider implements SmsProvider {
  public lastMessage: { destination: string; otp: string } | null = null;

  constructor(private readonly env?: DevOtpCaptureEnv) {}

  async sendOtp(destination: string, otp: string): Promise<void> {
    this.lastMessage = { destination, otp };
    captureDevOtp(destination, otp, this.env);
  }
}
