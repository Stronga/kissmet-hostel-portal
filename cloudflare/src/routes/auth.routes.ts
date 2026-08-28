import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Env } from "../types/bindings";
import { parseJsonObject, requiredString } from "../auth/validation";
import { requireAuth } from "../middleware/auth.middleware";
import { AuthService } from "../services/auth.service";
import { MockSmsProvider } from "../services/sms.service";

type Variables = { authUser: import("../auth/context").AuthUser };

export const authRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

function service(c: { env: Env }) {
  return new AuthService(c.env, new MockSmsProvider());
}

authRoutes.post("/staff/login", async (c) => {
  const input = parseJsonObject(await c.req.json().catch(() => null));
  if (!input) return c.json({ error: "Invalid request body" }, 400);

  const identifier = requiredString(input, "identifier", 254);
  const password = requiredString(input, "password", 256);
  if (!identifier || !password) return c.json({ error: "Invalid credentials" }, 401);

  const result = await service(c).loginStaff(identifier, password, c.req.header("User-Agent"));
  return c.json(result.body, result.status as ContentfulStatusCode);
});

authRoutes.post("/resident/request-otp", async (c) => {
  const input = parseJsonObject(await c.req.json().catch(() => null));
  if (!input) return c.json({ error: "Invalid request body" }, 400);

  const institutionCode = requiredString(input, "institutionCode", 64);
  const studentId = requiredString(input, "studentId", 64);
  if (!institutionCode || !studentId) return c.json({ ok: true, message: "If the resident can receive OTP messages, an OTP has been sent." });

  return c.json(await service(c).requestResidentOtp(institutionCode, studentId));
});

authRoutes.post("/resident/verify-otp", async (c) => {
  const input = parseJsonObject(await c.req.json().catch(() => null));
  if (!input) return c.json({ error: "Invalid request body" }, 400);

  const institutionCode = requiredString(input, "institutionCode", 64);
  const studentId = requiredString(input, "studentId", 64);
  const otp = requiredString(input, "otp", 12);
  if (!institutionCode || !studentId || !otp) return c.json({ error: "Invalid or expired OTP" }, 401);

  const result = await service(c).verifyResidentOtp(institutionCode, studentId, otp, c.req.header("User-Agent"));
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
