import type { Env } from "../types/bindings";
import { maskPhone, normalizeGhanaPhoneForSms } from "./phone";
import type { OtpDeliveryRequest, OtpDeliveryResult, SmsProvider } from "./sms.service";

/** Official Arkesel SMS V2 send endpoint (api_spec.v2.4.0). */
export const ARKESEL_SMS_SEND_URL = "https://sms.arkesel.com/api/v2/sms/send";

/** Bounded Worker → Arkesel HTTP timeout (ms). */
export const ARKESEL_REQUEST_TIMEOUT_MS = 10_000;

export type ArkeselSmsConfig = {
  apiKey: string;
  senderId: string;
  endpoint?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

type ArkeselSendResponse = {
  status?: string;
  message?: string;
  data?: Array<{ recipient?: string; id?: string } | { "invalid numbers"?: string[] }>;
};

export function buildOtpSmsMessage(code: string, expiresInMinutes: number): string {
  return `Your Kissmet verification code is ${code}. It expires in ${expiresInMinutes} minutes. Do not share this code.`;
}

function safeProviderMessageId(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  // Keep short UUID-like references; never log full payloads.
  return raw.trim().slice(0, 64);
}

function categorizeHttpStatus(status: number): OtpDeliveryResult["errorCategory"] {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status >= 400 && status < 500) return "provider_4xx";
  if (status >= 500) return "provider_5xx";
  return "unknown";
}

/**
 * Arkesel SMS transport only. Kissmet remains OTP authority (generate/hash/verify).
 * Does not call Arkesel's OTP generate/verify product APIs.
 */
export class ArkeselSmsProvider implements SmsProvider {
  readonly name = "arkesel";

  constructor(private readonly config: ArkeselSmsConfig) {}

  static fromEnv(env: Env, fetchImpl: typeof fetch = fetch): ArkeselSmsProvider {
    return new ArkeselSmsProvider({
      apiKey: (env.ARKESEL_API_KEY ?? "").trim(),
      senderId: (env.ARKESEL_SENDER_ID ?? "").trim(),
      endpoint: (env.ARKESEL_SMS_ENDPOINT ?? "").trim() || ARKESEL_SMS_SEND_URL,
      timeoutMs: ARKESEL_REQUEST_TIMEOUT_MS,
      fetchImpl
    });
  }

  async sendOtp(request: OtpDeliveryRequest): Promise<OtpDeliveryResult> {
    const correlationId = crypto.randomUUID();
    const apiKey = this.config.apiKey;
    const senderId = this.config.senderId;

    if (!apiKey) {
      this.logSafe({ correlationId, success: false, errorCategory: "config", detail: "missing_api_key" });
      return { ok: false, provider: this.name, errorCategory: "config", correlationId };
    }
    if (!senderId) {
      this.logSafe({ correlationId, success: false, errorCategory: "config", detail: "missing_sender_id" });
      return { ok: false, provider: this.name, errorCategory: "config", correlationId };
    }

    const phone = normalizeGhanaPhoneForSms(request.phone);
    if (!phone.ok) {
      this.logSafe({ correlationId, success: false, errorCategory: "invalid_phone", detail: phone.reason });
      return { ok: false, provider: this.name, errorCategory: "invalid_phone", correlationId };
    }

    const endpoint = this.config.endpoint ?? ARKESEL_SMS_SEND_URL;
    const timeoutMs = this.config.timeoutMs ?? ARKESEL_REQUEST_TIMEOUT_MS;
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": apiKey
        },
        body: JSON.stringify({
          sender: senderId,
          message: buildOtpSmsMessage(request.code, request.expiresInMinutes),
          recipients: [phone.e164Digits]
        }),
        signal: controller.signal
      });
    } catch (e) {
      const aborted = e instanceof Error && (e.name === "AbortError" || /aborted/i.test(e.message));
      const errorCategory = aborted ? "timeout" : "network";
      this.logSafe({
        correlationId,
        success: false,
        errorCategory,
        maskedPhone: phone.masked
      });
      return { ok: false, provider: this.name, errorCategory, correlationId };
    } finally {
      clearTimeout(timer);
    }

    let payload: ArkeselSendResponse | null = null;
    try {
      payload = (await response.json()) as ArkeselSendResponse;
    } catch {
      payload = null;
    }

    if (!response.ok || (payload?.status && payload.status !== "success")) {
      const errorCategory = categorizeHttpStatus(response.status);
      this.logSafe({
        correlationId,
        success: false,
        errorCategory,
        maskedPhone: phone.masked,
        httpStatus: response.status
      });
      return { ok: false, provider: this.name, errorCategory, correlationId };
    }

    const first = Array.isArray(payload?.data) ? payload.data[0] : undefined;
    const providerMessageId =
      first && typeof first === "object" && "id" in first
        ? safeProviderMessageId((first as { id?: string }).id)
        : undefined;

    this.logSafe({
      correlationId,
      success: true,
      maskedPhone: phone.masked,
      providerMessageId
    });

    return {
      ok: true,
      provider: this.name,
      providerMessageId,
      correlationId
    };
  }

  private logSafe(fields: {
    correlationId: string;
    success: boolean;
    errorCategory?: string;
    detail?: string;
    maskedPhone?: string;
    providerMessageId?: string;
    httpStatus?: number;
  }): void {
    // Never log OTP, API key, Authorization, or raw provider bodies.
    console.info(
      JSON.stringify({
        event: "otp_sms_delivery",
        provider: this.name,
        ...fields
      })
    );
  }
}

/** Used when production/staging selects Arkesel but required config is missing. */
export class MisconfiguredSmsProvider implements SmsProvider {
  readonly name = "misconfigured";

  constructor(private readonly reason: "missing_api_key" | "missing_sender_id" | "invalid_provider") {}

  async sendOtp(_request: OtpDeliveryRequest): Promise<OtpDeliveryResult> {
    const correlationId = crypto.randomUUID();
    console.info(
      JSON.stringify({
        event: "otp_sms_delivery",
        provider: this.name,
        success: false,
        errorCategory: "config",
        detail: this.reason,
        correlationId
      })
    );
    return { ok: false, provider: this.name, errorCategory: "config", correlationId };
  }
}

export function resolveArkeselConfigState(env: Pick<Env, "ARKESEL_API_KEY" | "ARKESEL_SENDER_ID">): {
  ok: boolean;
  reason?: "missing_api_key" | "missing_sender_id";
} {
  if (!(env.ARKESEL_API_KEY ?? "").trim()) return { ok: false, reason: "missing_api_key" };
  if (!(env.ARKESEL_SENDER_ID ?? "").trim()) return { ok: false, reason: "missing_sender_id" };
  return { ok: true };
}

/** Test helper: assert sensitive material never appears in a log/error string. */
export function assertNoSecretsInText(text: string, secrets: string[]): void {
  for (const secret of secrets) {
    if (secret && text.includes(secret)) {
      throw new Error("Sensitive value leaked into text");
    }
  }
}

export { maskPhone };
