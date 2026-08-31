import { Hono } from "hono";
import type { Env } from "../types/bindings";
import { AdminRepository } from "../repositories/admin.repository";
import { AdminService } from "../services/admin.service";
import { ok } from "../http/responses";

export const publicRoutes = new Hono<{ Bindings: Env }>();

publicRoutes.get("/institutions", async (c) => {
  const rows = await new AdminRepository(c.env.DB).all("SELECT code, name FROM institutions WHERE status = 'active' ORDER BY name");
  return c.json(ok(rows.results ?? []));
});

publicRoutes.get("/announcements", async (c) => {
  const rows = await new AdminService(new AdminRepository(c.env.DB)).publicAnnouncements();
  return c.json(ok(rows.results ?? []));
});
