import type { Context, Next } from "hono";

export function limitJsonBody(maxBytes: number) {
  return async (c: Context, next: Next) => {
    const method = c.req.method.toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "DELETE") {
      return next();
    }
    const contentLength = c.req.header("content-length");
    if (contentLength && Number(contentLength) > maxBytes) {
      return c.json(
        { ok: false, error: { code: "payload_too_large", message: "Request body too large" } },
        413
      );
    }
    // Soft check for chunked bodies: read once into memory with a cap.
    const contentType = c.req.header("content-type") ?? "";
    if (!contentType.includes("application/json") && method !== "POST" && method !== "PUT" && method !== "PATCH") {
      return next();
    }
    try {
      const buf = await c.req.arrayBuffer();
      if (buf.byteLength > maxBytes) {
        return c.json(
          { ok: false, error: { code: "payload_too_large", message: "Request body too large" } },
          413
        );
      }
      // Stash for downstream JSON parse via raw text recreation.
      const text = new TextDecoder().decode(buf);
      c.set("rawBodyText", text);
    } catch {
      return c.json({ ok: false, error: { code: "bad_request", message: "Invalid body" } }, 400);
    }
    return next();
  };
}

export async function readJsonBody<T>(c: Context): Promise<T> {
  const cached = c.get("rawBodyText") as string | undefined;
  if (cached !== undefined) {
    if (!cached.trim()) return {} as T;
    return JSON.parse(cached) as T;
  }
  return c.req.json<T>();
}
