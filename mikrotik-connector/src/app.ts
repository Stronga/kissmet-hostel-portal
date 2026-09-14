import { Hono } from "hono";
import type { ConnectorConfig } from "./config.js";
import { requireConnectorAuth } from "./middleware/auth.js";
import { log } from "./logger.js";
import type { RouterOsClient } from "./routeros/types.js";
import { ProfileConflictError, RouterOsUnavailableError } from "./routeros/types.js";
import { HotspotService } from "./services/hotspot.service.js";

export function createApp(config: ConnectorConfig, client: RouterOsClient) {
  const app = new Hono();
  const hotspot = new HotspotService(client);

  app.get("/health", async (c) => {
    try {
      const health = await hotspot.health();
      return c.json({ ok: true, data: health });
    } catch (e) {
      log.error("health_failed", { error: e instanceof Error ? e.message : "unknown" });
      return c.json({ ok: false, error: { code: "unavailable", message: "RouterOS unavailable" } }, 503);
    }
  });

  const api = new Hono();
  api.use("*", requireConnectorAuth(config.connectorSecret));

  function handle(e: unknown) {
    if (e instanceof ProfileConflictError) {
      return { status: 409 as const, body: { ok: false, error: { code: "profile_conflict", message: e.message } } };
    }
    if (e instanceof RouterOsUnavailableError) {
      return { status: 503 as const, body: { ok: false, error: { code: "unavailable", message: "RouterOS unavailable" } } };
    }
    const message = e instanceof Error ? e.message : "Request failed";
    const status = /not found/i.test(message) ? 404 as const : 400 as const;
    return { status, body: { ok: false, error: { code: status === 404 ? "not_found" : "bad_request", message } } };
  }

  api.post("/ensureResidentProfile", async (c) => {
    try {
      const result = await hotspot.ensureResidentProfile();
      return c.json({ ok: true, data: result });
    } catch (e) {
      const h = handle(e);
      return c.json(h.body, h.status);
    }
  });

  api.get("/users/:username", async (c) => {
    try {
      const user = await hotspot.getUser(c.req.param("username"));
      if (!user) return c.json({ ok: false, error: { code: "not_found", message: "HotSpot user not found" } }, 404);
      return c.json({ ok: true, data: user });
    } catch (e) {
      const h = handle(e);
      return c.json(h.body, h.status);
    }
  });

  api.post("/users", async (c) => {
    try {
      const body = await c.req.json<{ username?: string; password?: string; comment?: string }>();
      if (!body.username || !body.password) {
        return c.json({ ok: false, error: { code: "bad_request", message: "username and password required" } }, 400);
      }
      const result = await hotspot.createUser({
        username: body.username,
        password: body.password,
        comment: body.comment
      });
      return c.json({ ok: true, data: result }, result.created ? 201 : 200);
    } catch (e) {
      const h = handle(e);
      return c.json(h.body, h.status);
    }
  });

  api.post("/users/:username/disable", async (c) => {
    try {
      return c.json({ ok: true, data: await hotspot.disableUser(c.req.param("username")) });
    } catch (e) {
      const h = handle(e);
      return c.json(h.body, h.status);
    }
  });

  api.post("/users/:username/enable", async (c) => {
    try {
      return c.json({ ok: true, data: await hotspot.enableUser(c.req.param("username")) });
    } catch (e) {
      const h = handle(e);
      return c.json(h.body, h.status);
    }
  });

  api.post("/users/:username/reset-password", async (c) => {
    try {
      const body = await c.req.json<{ password?: string }>();
      if (!body.password) {
        return c.json({ ok: false, error: { code: "bad_request", message: "password required" } }, 400);
      }
      return c.json({ ok: true, data: await hotspot.resetUserPassword(c.req.param("username"), body.password) });
    } catch (e) {
      const h = handle(e);
      return c.json(h.body, h.status);
    }
  });

  api.delete("/users/:username", async (c) => {
    try {
      await hotspot.removeUser(c.req.param("username"));
      return c.json({ ok: true, data: { removed: true } });
    } catch (e) {
      const h = handle(e);
      return c.json(h.body, h.status);
    }
  });

  api.get("/users/:username/sessions", async (c) => {
    try {
      return c.json({ ok: true, data: await hotspot.listActiveSessions(c.req.param("username")) });
    } catch (e) {
      const h = handle(e);
      return c.json(h.body, h.status);
    }
  });

  api.post("/users/:username/disconnect", async (c) => {
    try {
      return c.json({ ok: true, data: await hotspot.disconnectSessions(c.req.param("username")) });
    } catch (e) {
      const h = handle(e);
      return c.json(h.body, h.status);
    }
  });

  app.route("/v1", api);
  return app;
}
