import { Hono } from "hono";
import type { Env } from "../types/bindings";
import { parseJsonObject, requiredString } from "../auth/validation";
import {
  isStagingOtpTestLookupReady,
  isStagingOtpTestPathEnabled,
  lookupStagingOtp,
  stagingOtpTestKeyMatches
} from "../services/staging-otp-test";

/**
 * Staging-only routes. Every handler returns 404 unless APP_ENV === "staging".
 * The OTP test path also requires the STAGING_OTP_TEST_KEY Worker secret.
 * Cloudflare Access in front of staging hostnames is the first gate (see docs/STAGING_PLAN.md).
 */
export const stagingRoutes = new Hono<{ Bindings: Env }>();

stagingRoutes.use("*", async (c, next) => {
  if (!isStagingOtpTestPathEnabled(c.env)) {
    return c.json({ error: "Not found" }, 404);
  }
  await next();
});

stagingRoutes.post("/otp-test/lookup", async (c) => {
  // Defense in depth: the wildcard above already 404s non-staging, but keep the
  // environment check adjacent to secret verification so a future route change
  // cannot skip it.
  if (!isStagingOtpTestPathEnabled(c.env) || !isStagingOtpTestLookupReady(c.env)) {
    return c.json({ error: "Not found" }, 404);
  }

  const provided = (c.req.header("X-Staging-Otp-Key") ?? "").trim();
  const expected = (c.env.STAGING_OTP_TEST_KEY ?? "").trim();
  if (!provided || !(await stagingOtpTestKeyMatches(provided, expected))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const input = parseJsonObject(await c.req.json().catch(() => null));
  if (!input) return c.json({ error: "Invalid request body" }, 400);
  const phone = requiredString(input, "phone", 32);
  if (!phone) return c.json({ error: "Invalid request body" }, 400);

  const result = await lookupStagingOtp(c.env, phone);
  if (!result.ok && result.reason === "malformed") {
    return c.json({ error: "Invalid request body" }, 400);
  }
  if (!result.ok) {
    return c.json({ error: "Not found" }, 404);
  }
  return c.json({
    ok: true,
    otp: result.otp,
    expiresAt: result.expiresAt,
    destinationMasked: result.destinationMasked
  });
});
