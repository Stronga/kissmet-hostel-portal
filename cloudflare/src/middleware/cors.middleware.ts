import type { Context, Next } from "hono";
import type { Env } from "../types/bindings";

const defaultOrigins = {
  local: ["http://localhost:5173", "http://127.0.0.1:5173"],
  staging: ["https://staging-admin.kissmetgroup.org"],
  production: ["https://admin.kissmetgroup.org"]
} satisfies Record<Env["APP_ENV"], string[]>;

function allowedOrigins(env: Env) {
  const configured = env.ADMIN_ALLOWED_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean);
  return configured?.length ? configured : defaultOrigins[env.APP_ENV] ?? defaultOrigins.production;
}

function applyCors(c: Context<{ Bindings: Env }>) {
  const origin = c.req.header("Origin");
  if (!origin || !allowedOrigins(c.env).includes(origin)) return;

  c.header("Access-Control-Allow-Origin", origin);
  c.header("Vary", "Origin");
  c.header("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  c.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
  c.header("Access-Control-Max-Age", "86400");
}

export async function corsMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  applyCors(c);
  if (c.req.method === "OPTIONS") return c.body(null, 204);
  await next();
  applyCors(c);
}
