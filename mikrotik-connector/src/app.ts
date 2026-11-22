import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type { ConnectorConfig } from "./config.js";
import type { Context } from "hono";
import { InvalidJsonError, limitJsonBody, readJsonBody } from "./middleware/body-limit.js";
import { createAuthRateGuard } from "./middleware/rate-limit.js";
import { log } from "./logger.js";
import type { RouterOsClient } from "./routeros/types.js";
import { ProfileConflictError, RouterOsUnavailableError, UserNotFoundError } from "./routeros/types.js";
import { HotspotService } from "./services/hotspot.service.js";
import { isPlainObject, isValidComment, isValidHotspotPassword, isValidResidentUsername } from "./validation.js";

type Variables = {
  rawBodyText?: string;
  correlationId?: string;
};

type ErrorBody = { ok: false; error: { code: string; message: string; correlationId?: string } };

/** Fixed, input-free 400 bodies (F1/F3). Never include the offending value. */
const BAD = {
  invalidJson: { ok: false, error: { code: "invalid_json", message: "Malformed JSON body" } },
  invalidBody: { ok: false, error: { code: "invalid_body", message: "JSON body must be an object" } },
  invalidUsername: { ok: false, error: { code: "invalid_username", message: "Invalid username" } },
  invalidPassword: { ok: false, error: { code: "invalid_password", message: "Invalid password" } },
  invalidComment: { ok: false, error: { code: "invalid_comment", message: "Invalid comment" } }
} as const satisfies Record<string, ErrorBody>;

/** Thrown inside handlers to return a fixed 400 body. */
class RequestValidationError extends Error {
  constructor(readonly body: ErrorBody) {
    super(body.error.code);
    this.name = "RequestValidationError";
  }
}

/** Validated :username path parameter, or throws invalid_username (before any RouterOS call). */
function usernameParam(c: Context): string {
  const value = c.req.param("username");
  if (!isValidResidentUsername(value)) throw new RequestValidationError(BAD.invalidUsername);
  return value;
}

/** Parsed JSON body that must be a plain object. */
async function objectBody(c: Context): Promise<Record<string, unknown>> {
  const body = await readJsonBody(c);
  if (!isPlainObject(body)) throw new RequestValidationError(BAD.invalidBody);
  return body;
}

export function createApp(config: ConnectorConfig, client: RouterOsClient) {
  const app = new Hono<{ Variables: Variables }>();
  const hotspot = new HotspotService(client);
  const startedAt = Date.now();
  // In mock mode, never advertise the configured router address: nothing is contacted.
  const routerTarget =
    config.routerosDriver === "mock"
      ? { routerosDriver: "mock" as const, mikrotikHost: "mock (in-memory)" }
      : { mikrotikHost: config.mikrotikHost, mikrotikApiPort: config.mikrotikApiPort };

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
  api.use(
    "*",
    createAuthRateGuard({
      secret: config.connectorSecret,
      windowMs: config.rateLimitWindowMs,
      max: config.rateLimitMax,
      authFailMax: config.authFailRateLimitMax ?? 20,
      trustProxy: config.trustProxy ?? false
    })
  );
  api.use("*", limitJsonBody(config.maxBodyBytes));

  /**
   * Map any thrown value to a fixed response body (F2). Known errors keep their status;
   * anything else is 500 internal_error with only the correlation id. Error details are
   * logged server-side through the redacting logger, never returned.
   */
  function handle(e: unknown, correlationId?: string): { status: 400 | 404 | 409 | 500 | 503; body: ErrorBody } {
    if (e instanceof RequestValidationError) {
      return { status: 400, body: e.body };
    }
    if (e instanceof InvalidJsonError) {
      return { status: 400, body: BAD.invalidJson };
    }
    if (e instanceof ProfileConflictError) {
      return { status: 409, body: { ok: false, error: { code: "profile_conflict", message: e.message } } };
    }
    if (e instanceof UserNotFoundError) {
      return { status: 404, body: { ok: false, error: { code: "not_found", message: "HotSpot user not found" } } };
    }
    if (e instanceof RouterOsUnavailableError) {
      log.error("routeros_unavailable", { correlationId, error: e.message });
      return { status: 503, body: { ok: false, error: { code: "unavailable", message: "RouterOS unavailable" } } };
    }
    log.error("internal_error", {
      correlationId,
      errorName: e instanceof Error ? e.name : typeof e,
      error: e instanceof Error ? e.message : "non-error thrown"
    });
    return {
      status: 500,
      body: { ok: false, error: { code: "internal_error", message: "Internal error", correlationId } }
    };
  }

  /** Last-resort handler for anything thrown outside a route try/catch (middleware etc.). */
  const onError = (err: Error, c: Context) => {
    const h = handle(err, c.get("correlationId") as string | undefined);
    return c.json(h.body, h.status);
  };
  app.onError(onError);
  api.onError(onError);

  /**
   * Authenticated deep health: private path → RouterOS (Pi LAN in production; WG .5 in remote lab) without leaking secrets.
   */
  api.get("/health", async (c) => {
    const correlationId = c.get("correlationId");
    try {
      const health = await hotspot.health();
      log.info("deep_health_ok", {
        correlationId,
        board: health.board,
        version: health.version,
        ...routerTarget
      });
      return c.json({
        ok: true,
        data: {
          process: "up",
          routeros: "reachable",
          board: health.board,
          version: health.version,
          ...routerTarget
          // deliberately omit credentials, secrets, private keys
        }
      });
    } catch (e) {
      log.error("deep_health_failed", {
        correlationId,
        error: e instanceof Error ? e.message : "unknown",
        ...routerTarget
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
      const user = await hotspot.getUser(usernameParam(c));
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
      const body = await objectBody(c);
      if (!body.username || !body.password) {
        return c.json({ ok: false, error: { code: "bad_request", message: "username and password required" } }, 400);
      }
      if (!isValidResidentUsername(body.username)) throw new RequestValidationError(BAD.invalidUsername);
      if (!isValidHotspotPassword(body.password)) throw new RequestValidationError(BAD.invalidPassword);
      let comment: string | undefined;
      if (body.comment !== undefined) {
        if (!isValidComment(body.comment)) throw new RequestValidationError(BAD.invalidComment);
        comment = body.comment;
      }
      const result = await hotspot.createUser({
        username: body.username,
        password: body.password,
        comment
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
      const data = await hotspot.disableUser(usernameParam(c));
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
      const data = await hotspot.enableUser(usernameParam(c));
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
      const username = usernameParam(c);
      const body = await objectBody(c);
      if (!body.password) {
        return c.json({ ok: false, error: { code: "bad_request", message: "password required" } }, 400);
      }
      if (!isValidHotspotPassword(body.password)) throw new RequestValidationError(BAD.invalidPassword);
      const data = await hotspot.resetUserPassword(username, body.password);
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
      await hotspot.removeUser(usernameParam(c));
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
      return c.json({ ok: true, data: await hotspot.listActiveSessions(usernameParam(c)) });
    } catch (e) {
      const h = handle(e, correlationId);
      return c.json(h.body, h.status);
    }
  });

  api.post("/users/:username/disconnect", async (c) => {
    const correlationId = c.get("correlationId");
    try {
      const data = await hotspot.disconnectSessions(usernameParam(c));
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
