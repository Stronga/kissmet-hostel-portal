import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Env } from "../types/bindings";
import { parseJsonObject, requiredString } from "../auth/validation";
import { requireAuth } from "../middleware/auth.middleware";
import { productionAuthConfigGuard } from "../middleware/production-config.middleware";
import { AuthService } from "../services/auth.service";
import { createSmsProvider } from "../services/sms.service";
import { clientIpFromRequest } from "../config/production-secrets";
import { OTHER_INSTITUTION_CODE } from "../auth/resident-identity";

type Variables = { authUser: import("../auth/context").AuthUser };

export const authRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

function service(c: { env: Env }) {
  return new AuthService(c.env, createSmsProvider(c.env));
}

function clientCtx(c: { req: { raw: Request; header: (name: string) => string | undefined } }) {
  return {
    ip: clientIpFromRequest(c.req.raw),
    userAgent: c.req.header("User-Agent")
  };
}

function optionalString(input: Record<string, unknown>, key: string, maxLength: number): string | null {
  const value = input[key];
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

authRoutes.use("/staff/login", productionAuthConfigGuard);
authRoutes.use("/resident/request-otp", productionAuthConfigGuard);
authRoutes.use("/resident/verify-otp", productionAuthConfigGuard);

authRoutes.post("/staff/login", async (c) => {
  const input = parseJsonObject(await c.req.json().catch(() => null));
  if (!input) return c.json({ error: "Invalid request body" }, 400);

  const identifier = requiredString(input, "identifier", 254);
  const password = requiredString(input, "password", 256);
  if (!identifier || !password) return c.json({ error: "Invalid credentials" }, 401);

  const result = await service(c).loginStaff(identifier, password, clientCtx(c));
  return c.json(result.body, result.status as ContentfulStatusCode);
});

authRoutes.post("/resident/request-otp", async (c) => {
  const input = parseJsonObject(await c.req.json().catch(() => null));
  if (!input) return c.json({ error: "Invalid request body" }, 400);

  const institutionCode = optionalString(input, "institutionCode", 64);
  const studentId = optionalString(input, "studentId", 64);
  const ghanaCardNumber = optionalString(input, "ghanaCardNumber", 64);
  // Tolerate empty body with generic success (enumeration-safe).
  if (!institutionCode && !studentId && !ghanaCardNumber) {
    return c.json({ ok: true, message: "If the resident can receive OTP messages, an OTP has been sent." });
  }

  const result = await service(c).requestResidentOtp({
    institutionCode: institutionCode === OTHER_INSTITUTION_CODE ? OTHER_INSTITUTION_CODE : institutionCode,
    studentId,
    ghanaCardNumber,
    identifierType: input.identifierType,
    residentKind: input.residentKind
  }, clientCtx(c));

  if (!result.ok) {
    return c.json(result.body, result.status as ContentfulStatusCode);
  }
  return c.json(result);
});

authRoutes.post("/resident/verify-otp", async (c) => {
  const input = parseJsonObject(await c.req.json().catch(() => null));
  if (!input) return c.json({ error: "Invalid request body" }, 400);

  const otp = requiredString(input, "otp", 12);
  const challengeId = optionalString(input, "challengeId", 128);
  const institutionCode = optionalString(input, "institutionCode", 64);
  const studentId = optionalString(input, "studentId", 64);
  const ghanaCardNumber = optionalString(input, "ghanaCardNumber", 64);

  if (!otp) return c.json({ error: "Invalid or expired OTP" }, 401);
  if (!challengeId && !institutionCode && !ghanaCardNumber) {
    return c.json({ error: "Invalid or expired OTP" }, 401);
  }

  const result = await service(c).verifyResidentOtp({
    otp,
    challengeId,
    institutionCode: institutionCode === OTHER_INSTITUTION_CODE ? OTHER_INSTITUTION_CODE : institutionCode,
    studentId,
    ghanaCardNumber,
    identifierType: input.identifierType,
    residentKind: input.residentKind
  }, clientCtx(c));
  return c.json(result.body, result.status as ContentfulStatusCode);
});

authRoutes.post("/logout", requireAuth, async (c) => {
  const token = c.req.header("Authorization")?.slice("Bearer ".length).trim();
  if (token) await service(c).logout(token);
  return c.json({ ok: true });
});

authRoutes.get("/me", requireAuth, (c) => {
  return c.json({ user: c.get("authUser") });
});
