import { Hono } from "hono";
import type { Env } from "../types/bindings";
import { HealthService } from "../services/health.service";

export const healthRoutes = new Hono<{ Bindings: Env }>();

healthRoutes.get("/health", (c) => {
  const health = new HealthService(c.env);

  return c.json(health.getHealth());
});

healthRoutes.get("/health/db", async (c) => {
  const health = new HealthService(c.env);
  const status = await health.getDatabaseHealth();

  return c.json(status, status.ok ? 200 : 503);
});
