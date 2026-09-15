import { Hono } from "hono";
import type { Env } from "../types/bindings";
import type { AuthUser } from "../auth/context";
import { requirePermission } from "../middleware/auth.middleware";
import { AdminRepository } from "../repositories/admin.repository";
import { InternetAccessService } from "../services/internet-access.service";
import { MikroTikConnectorClient } from "../services/mikrotik-connector.client";
import { pagination } from "../http/input";
import { listOk, ok } from "../http/responses";
import { routeError } from "../http/safe-error";

type Variables = { authUser: AuthUser };
const routes = new Hono<{ Bindings: Env; Variables: Variables }>();

function service(c: { env: Env }) {
  return new InternetAccessService(
    new AdminRepository(c.env.DB),
    MikroTikConnectorClient.fromEnv(c.env)
  );
}

function handle(e: unknown) {
  return routeError(e);
}

routes.get("/internet-access/summary", requirePermission("internet:read"), async (c) => {
  return c.json(ok(await service(c).summary()));
});

routes.get("/internet-access/connector-health", requirePermission("internet:read"), async (c) => {
  return c.json(ok(await service(c).connectorHealth()));
});

routes.get("/internet-access/eligible-residents", requirePermission("internet:read"), async (c) => {
  const url = new URL(c.req.url);
  const p = pagination(url);
  const search = url.searchParams.get("search") ?? undefined;
  const result = await service(c).searchEligibleResidents(p.limit, p.offset, search) as { results?: unknown[] };
  return c.json(listOk((result.results ?? []) as unknown[], p));
});

routes.post("/internet-access/ensure-profile", requirePermission("internet:manage"), async (c) => {
  try {
    return c.json(ok(await service(c).ensureProfile(c.get("authUser"))));
  } catch (e) {
    const h = handle(e);
    return c.json(h.body, h.status);
  }
});

routes.get("/internet-access", requirePermission("internet:read"), async (c) => {
  const url = new URL(c.req.url);
  const p = pagination(url);
  const search = url.searchParams.get("search") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;
  const syncStatus = url.searchParams.get("sync_status") ?? undefined;
  const result = await service(c).list(p.limit, p.offset, { search, status, syncStatus }) as { results?: unknown[] };
  return c.json(listOk((result.results ?? []) as unknown[], p));
});

routes.get("/internet-access/:id", requirePermission("internet:read"), async (c) => {
  const row = await service(c).get(Number(c.req.param("id")));
  if (!row) {
    const h = handle(new Error("Internet account not found"));
    return c.json(h.body, h.status);
  }
  return c.json(ok(row));
});

routes.get("/internet-access/:id/sessions", requirePermission("internet:read"), async (c) => {
  try {
    return c.json(ok(await service(c).listSessions(Number(c.req.param("id")))));
  } catch (e) {
    const h = handle(e);
    return c.json(h.body, h.status);
  }
});

routes.post("/internet-access/residents/:residentId/provision", requirePermission("internet:manage"), async (c) => {
  try {
    return c.json(ok(await service(c).provision(c.get("authUser"), Number(c.req.param("residentId")))), 201);
  } catch (e) {
    const h = handle(e);
    return c.json(h.body, h.status);
  }
});

routes.post("/internet-access/:id/enable", requirePermission("internet:manage"), async (c) => {
  try {
    return c.json(ok(await service(c).enable(c.get("authUser"), Number(c.req.param("id")))));
  } catch (e) {
    const h = handle(e);
    return c.json(h.body, h.status);
  }
});

routes.post("/internet-access/:id/suspend", requirePermission("internet:manage"), async (c) => {
  try {
    return c.json(ok(await service(c).suspend(c.get("authUser"), Number(c.req.param("id")))));
  } catch (e) {
    const h = handle(e);
    return c.json(h.body, h.status);
  }
});

routes.post("/internet-access/:id/reset-password", requirePermission("internet:manage"), async (c) => {
  try {
    return c.json(ok(await service(c).resetPassword(c.get("authUser"), Number(c.req.param("id")))));
  } catch (e) {
    const h = handle(e);
    return c.json(h.body, h.status);
  }
});

routes.post("/internet-access/:id/disconnect", requirePermission("internet:manage"), async (c) => {
  try {
    return c.json(ok(await service(c).disconnect(c.get("authUser"), Number(c.req.param("id")))));
  } catch (e) {
    const h = handle(e);
    return c.json(h.body, h.status);
  }
});

routes.post("/internet-access/:id/retry-sync", requirePermission("internet:manage"), async (c) => {
  try {
    return c.json(ok(await service(c).retrySync(c.get("authUser"), Number(c.req.param("id")))));
  } catch (e) {
    const h = handle(e);
    return c.json(h.body, h.status);
  }
});

export const internetAccessRoutes = routes;
