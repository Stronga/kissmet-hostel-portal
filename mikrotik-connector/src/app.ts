import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type { ConnectorConfig } from "./config.js";
import { requireConnectorAuth } from "./middleware/auth.js";
import { limitJsonBody, readJsonBody } from "./middleware/body-limit.js";
import { createRateLimiter } from "./middleware/rate-limit.js";
import { log } from "./logger.js";
import type { RouterOsClient } from "./routeros/types.js";
import { ProfileConflictError, RouterOsUnavailableError } from "./routeros/types.js";
import { HotspotService } from "./services/hotspot.service.js";

type Variables = {
  rawBodyText?: string;
  correlationId?: string;
};

export function createApp(config: ConnectorConfig, client: RouterOsClient) {
  const app = new Hono<{ Variables: Variables }>();
  const hotspot = new HotspotService(client);
  const startedAt = Date.now();

  app.use("*", async (c, next) => {
    const correlationId = c.req.header("x-correlation-id")?.trim() || randomUUID();
    c.set("correlationId", correlationId);
    c.header("x-correlation-id", correlationId);
    await next();
  });

  /**
   * Process health only — no RouterOS call, no secrets.
   * Suitable for systemd / reverse-proxy liveness probes.
   */
  app.get("/health", (c) => {
    return c.json({
      ok: true,
      data: {
        status: "up",
        service: "kissmet-mikrotik-connector",
        uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
        mode: config.mode
      }
    });
  });

  const api = new Hono<{ Variables: Variables }>();
  api.use("*", createRateLimiter(config.rateLimitWindowMs, config.rateLimitMax));
  api.use("*", requireConnectorAuth(config.connectorSecret));
  api.use("*", limitJsonBody(config.maxBodyBytes));

  function handle(e: unknown, correlationId?: string) {
    if (e instanceof ProfileConflictError) {
      return { status: 409 as const, body: { ok: false, error: { code: "profile_conflict", message: e.message } } };
    }
    if (e instanceof RouterOsUnavailableError) {
      log.error("routeros_unavailable", { correlationId, error: e.message });
      return { status: 503 as const, body: { ok: false, error: { code: "unavailable", message: "RouterOS unavailable" } } };
    }
    const message = e instanceof Error ? e.message : "Request failed";
    const status = /not found/i.test(message) ? 404 as const : 400 as const;
    return { status, body: { ok: false, error: { code: status === 404 ? "not_found" : "bad_request", message } } };
  }

  /**
   * Authenticated deep health: WireGuard → RouterOS path without leaking secrets.
   */
  api.get("/health", async (c) => {
    const correlationId = c.get("correlationId");
    try {
      const health = await hotspot.health();
      log.info("deep_health_ok", {
        correlationId,
        board: health.board,
        version: health.version,
        mikrotikHost: config.mikrotikHost,
        mikrotikApiPort: config.mikrotikApiPort
      });
      return c.json({
        ok: true,
        data: {
          process: "up",
          routeros: "reachable",
          board: health.board,
          version: health.version,
          mikrotikHost: config.mikrotikHost,
          mikrotikApiPort: config.mikrotikApiPort
          // deliberately omit credentials, secrets, WireGuard private keys
        }
      });
    } catch (e) {
      log.error("deep_health_failed", {
        correlationId,
        error: e instanceof Error ? e.message : "unknown",
        mikrotikHost: config.mikrotikHost,
        mikrotikApiPort: config.mikrotikApiPort
      });
      return c.json(
        {
          ok: false,
          error: {
            code: "unavailable",
            message: "RouterOS path unavailable",
            process: "up",
            routeros: "unreachable"
          }
        },
        503
      );
    }
  });

  api.post("/ensureResidentProfile", async (c) => {
    const correlationId = c.get("correlationId");
    try {
      const result = await hotspot.ensureResidentProfile();
      log.info("op_ensure_profile", { correlationId, created: result.created, success: true });
      return c.json({ ok: true, data: result });
    } catch (e) {
      const h = handle(e, correlationId);
      log.warn("op_ensure_profile", { correlationId, success: false, code: h.body.error.code });
      return c.json(h.body, h.status);
    }
  });

  api.get("/users/:username", async (c) => {
    const correlationId = c.get("correlationId");
    try {
      const user = await hotspot.getUser(c.req.param("username"));
      if (!user) return c.json({ ok: false, error: { code: "not_found", message: "HotSpot user not found" } }, 404);
      return c.json({ ok: true, data: user });
    } catch (e) {
      const h = handle(e, correlationId);
      return c.json(h.body, h.status);
    }
  });

  api.post("/users", async (c) => {
    const correlationId = c.get("correlationId");
    try {
      const body = await readJsonBody<{ username?: string; password?: string; comment?: string }>(c);
      if (!body.username || !body.password) {
        return c.json({ ok: false, error: { code: "bad_request", message: "username and password required" } }, 400);
      }
      const result = await hotspot.createUser({
        username: body.username,
        password: body.password,
        comment: body.comment
      });
      log.info("op_create_user", { correlationId, username: body.username, created: result.created, success: true });
      return c.json({ ok: true, data: result }, result.created ? 201 : 200);
    } catch (e) {
      const h = handle(e, correlationId);
      log.warn("op_create_user", { correlationId, success: false, code: h.body.error.code });
      return c.json(h.body, h.status);
    }
  });

  api.post("/users/:username/disable", async (c) => {
    const correlationId = c.get("correlationId");
    try {
      const data = await hotspot.disableUser(c.req.param("username"));
      log.info("op_disable_user", { correlationId, username: c.req.param("username"), success: true });
      return c.json({ ok: true, data });
    } catch (e) {
      const h = handle(e, correlationId);
      return c.json(h.body, h.status);
    }
  });

  api.post("/users/:username/enable", async (c) => {
    const correlationId = c.get("correlationId");
    try {
      const data = await hotspot.enableUser(c.req.param("username"));
      log.info("op_enable_user", { correlationId, username: c.req.param("username"), success: true });
      return c.json({ ok: true, data });
    } catch (e) {
      const h = handle(e, correlationId);
      return c.json(h.body, h.status);
    }
  });

  api.post("/users/:username/reset-password", async (c) => {
    const correlationId = c.get("correlationId");
    try {
      const body = await readJsonBody<{ password?: string }>(c);
      if (!body.password) {
        return c.json({ ok: false, error: { code: "bad_request", message: "password required" } }, 400);
      }
      const data = await hotspot.resetUserPassword(c.req.param("username"), body.password);
      // Never log password.
      log.info("op_reset_password", { correlationId, username: c.req.param("username"), success: true });
      return c.json({ ok: true, data });
    } catch (e) {
      const h = handle(e, correlationId);
      return c.json(h.body, h.status);
    }
  });

  api.delete("/users/:username", async (c) => {
    const correlationId = c.get("correlationId");
    try {
      await hotspot.removeUser(c.req.param("username"));
      log.info("op_remove_user", { correlationId, username: c.req.param("username"), success: true });
      return c.json({ ok: true, data: { removed: true } });
    } catch (e) {
      const h = handle(e, correlationId);
      return c.json(h.body, h.status);
    }
  });

  api.get("/users/:username/sessions", async (c) => {
    const correlationId = c.get("correlationId");
    try {
      return c.json({ ok: true, data: await hotspot.listActiveSessions(c.req.param("username")) });
    } catch (e) {
      const h = handle(e, correlationId);
      return c.json(h.body, h.status);
    }
  });

  api.post("/users/:username/disconnect", async (c) => {
    const correlationId = c.get("correlationId");
    try {
      const data = await hotspot.disconnectSessions(c.req.param("username"));
      log.info("op_disconnect", { correlationId, username: c.req.param("username"), success: true, disconnected: data.disconnected });
      return c.json({ ok: true, data });
    } catch (e) {
      const h = handle(e, correlationId);
      return c.json(h.body, h.status);
    }
  });

  api.notFound((c) =>
    c.json({ ok: false, error: { code: "not_found", message: "Unknown connector route" } }, 404)
  );

  app.route("/v1", api);

  app.notFound((c) =>
    c.json({ ok: false, error: { code: "not_found", message: "Unknown route" } }, 404)
  );

  return app;
}
