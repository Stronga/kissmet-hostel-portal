import type { Context, Next } from "hono";
import { timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function requireConnectorAuth(secret: string) {
  return async (c: Context, next: Next) => {
    const header = c.req.header("Authorization");
    if (!header?.startsWith("Bearer ")) {
      return c.json({ ok: false, error: { code: "unauthorized", message: "Unauthorized" } }, 401);
    }
    const token = header.slice("Bearer ".length).trim();
    if (!token || !safeEqual(token, secret)) {
      return c.json({ ok: false, error: { code: "unauthorized", message: "Unauthorized" } }, 401);
    }
    return next();
  };
}
