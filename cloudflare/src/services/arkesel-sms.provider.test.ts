import { describe, expect, it, vi } from "vitest";
import {
  ARKESEL_SMS_SEND_URL,
  ArkeselSmsProvider,
  assertNoSecretsInText,
  buildOtpSmsMessage
} from "./arkesel-sms.provider";

const API_KEY = "test-arkesel-api-key-not-real";
const SENDER = "TESTSID";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

describe("ArkeselSmsProvider", () => {
  it("sends a successful mocked Arkesel request with configured sender", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(ARKESEL_SMS_SEND_URL);
      expect(init?.method).toBe("POST");
      const headers = init?.headers as Record<string, string>;
      expect(headers["api-key"]).toBe(API_KEY);
      expect(headers["Content-Type"]).toBe("application/json");
      const body = JSON.parse(String(init?.body));
      expect(body.sender).toBe(SENDER);
      expect(body.recipients).toEqual(["233241234567"]);
      expect(body.message).toContain("123456");
      expect(body.message).toContain("10 minutes");
      expect(body.message).not.toMatch(/student|ghana.?card|password/i);
      return jsonResponse(200, {
        status: "success",
        data: [{ recipient: "233241234567", id: "9b752841-7ee7-4d40-b4fe-768bfb1da4f0" }]
      });
    });

    const provider = new ArkeselSmsProvider({
      apiKey: API_KEY,
      senderId: SENDER,
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    const result = await provider.sendOtp({
      phone: "0241234567",
      code: "123456",
      expiresInMinutes: 10
    });

    expect(result.ok).toBe(true);
    expect(result.provider).toBe("arkesel");
    expect(result.providerMessageId).toBe("9b752841-7ee7-4d40-b4fe-768bfb1da4f0");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails safely when config is missing", async () => {
    const fetchImpl = vi.fn();
    const noKey = new ArkeselSmsProvider({
      apiKey: "",
      senderId: SENDER,
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    const noSender = new ArkeselSmsProvider({
      apiKey: API_KEY,
      senderId: "",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    expect((await noKey.sendOtp({ phone: "233241234567", code: "1", expiresInMinutes: 5 })).errorCategory).toBe("config");
    expect((await noSender.sendOtp({ phone: "233241234567", code: "1", expiresInMinutes: 5 })).errorCategory).toBe("config");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps provider 4xx / 5xx / timeout-network failures safely", async () => {
    const cases: Array<{ status?: number; abort?: boolean; network?: boolean; expected: string }> = [
      { status: 401, expected: "auth" },
      { status: 422, expected: "provider_4xx" },
      { status: 429, expected: "rate_limit" },
      { status: 500, expected: "provider_5xx" },
      { abort: true, expected: "timeout" },
      { network: true, expected: "network" }
    ];

    for (const c of cases) {
      const fetchImpl = vi.fn(async () => {
        if (c.abort) {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          throw err;
        }
        if (c.network) throw new Error("connect failed");
        return jsonResponse(c.status!, { status: "error", message: "Insufficient balance or invalid coverage!" });
      });
      const provider = new ArkeselSmsProvider({
        apiKey: API_KEY,
        senderId: SENDER,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        timeoutMs: 50
      });
      const result = await provider.sendOtp({ phone: "233241234567", code: "424242", expiresInMinutes: 10 });
      expect(result.ok).toBe(false);
      expect(result.errorCategory).toBe(c.expected);
      const serialized = JSON.stringify(result);
      assertNoSecretsInText(serialized, [API_KEY, "424242", "Insufficient balance"]);
    }
  });

  it("keeps API key and OTP out of errors/results", async () => {
    const provider = new ArkeselSmsProvider({
      apiKey: API_KEY,
      senderId: SENDER,
      fetchImpl: (async () => jsonResponse(500, { status: "error", message: `leak ${API_KEY}` })) as unknown as typeof fetch
    });
    const result = await provider.sendOtp({ phone: "233241234567", code: "654321", expiresInMinutes: 10 });
    expect(JSON.stringify(result)).not.toContain(API_KEY);
    expect(JSON.stringify(result)).not.toContain("654321");
  });

  it("uses configurable sender and never invents KISSMET", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.sender).toBe("APPROVED1");
      expect(body.sender).not.toBe("KISSMET");
      return jsonResponse(200, { status: "success", data: [{ id: "msg-1" }] });
    });
    const provider = new ArkeselSmsProvider({
      apiKey: API_KEY,
      senderId: "APPROVED1",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    await provider.sendOtp({ phone: "+233241234567", code: "111111", expiresInMinutes: 5 });
    expect(fetchImpl).toHaveBeenCalled();
  });

  it("builds GSM-friendly OTP content with configured expiry", () => {
    expect(buildOtpSmsMessage("999888", 5)).toBe(
      "Your Kissmet verification code is 999888. It expires in 5 minutes. Do not share this code."
    );
  });
});
