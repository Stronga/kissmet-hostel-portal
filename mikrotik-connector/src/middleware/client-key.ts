import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";

/** Only accept header values that look like an IPv4/IPv6 literal; anything else is ignored. */
const IP_LITERAL = /^[0-9A-Fa-f:.]{2,45}$/;

function socketAddress(c: Context): string | undefined {
  try {
    const address = getConnInfo(c).remote.address;
    return typeof address === "string" && address ? address : undefined;
  } catch {
    // No Node socket bindings (e.g. Hono app.request() in tests).
    return undefined;
  }
}

function headerIp(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v && IP_LITERAL.test(v) ? v : undefined;
}

/**
 * Rate-limit key for a request (F4).
 *
 * - trustProxy=false (default): the TCP socket peer address only. Client-supplied
 *   X-Forwarded-For / X-Real-IP / CF-Connecting-IP are IGNORED, so they cannot be used to
 *   obtain a fresh bucket. Behind cloudflared every request comes from 127.0.0.1, so all
 *   callers share one bucket.
 * - trustProxy=true: for deployments behind cloudflared / a local reverse proxy that sets
 *   these headers. Uses CF-Connecting-IP if present, else the RIGHT-MOST X-Forwarded-For hop
 *   (the one appended by the nearest proxy), else the socket address. Only safe when the
 *   connector is reachable solely through that proxy (BIND_HOST=127.0.0.1).
 */
export function clientKey(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const cf = headerIp(c.req.header("cf-connecting-ip"));
    if (cf) return `cf:${cf}`;
    const xff = c.req.header("x-forwarded-for");
    if (xff) {
      const hops = xff.split(",").map((h) => h.trim()).filter(Boolean);
      const last = headerIp(hops[hops.length - 1]);
      if (last) return `xff:${last}`;
    }
  }
  return `sock:${socketAddress(c) ?? "unknown"}`;
}
