import { Hono } from "hono";
import type { Env } from "./types/bindings";
import { healthRoutes } from "./routes/health.routes";
import { authRoutes } from "./routes/auth.routes";
import { adminRoutes } from "./routes/admin.routes";
import { publicRoutes } from "./routes/public.routes";
import { residentRoutes } from "./routes/resident.routes";
import { corsMiddleware } from "./middleware/cors.middleware";

const app = new Hono<{ Bindings: Env }>();

app.use("*", corsMiddleware);

app.get("/", (c) => {
  return c.json({
    ok: true,
    service: c.env.APP_NAME,
    environment: c.env.APP_ENV,
    endpoints: ["/health", "/health/db"]
  });
});

app.route("/", healthRoutes);
app.route("/public", publicRoutes);
app.route("/auth", authRoutes);
app.route("/admin", adminRoutes);
app.route("/resident", residentRoutes);

export default app;
