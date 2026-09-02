import { Hono } from "hono";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Env } from "../types/bindings";
import type { AuthUser } from "../auth/context";
import { requireAuth } from "../middleware/auth.middleware";
import { asObject, intField, stringField } from "../http/input";
import { error, ok } from "../http/responses";
import { MockSmsProvider } from "../services/sms.service";
import { ResidentService } from "../services/resident.service";

type Variables = { authUser: AuthUser };
export const residentRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

function service(c: { env: Env }) {
  return new ResidentService(c.env, new MockSmsProvider(), c.env.DOCUMENTS);
}

async function body(c: { req: { json: () => Promise<unknown> } }) {
  return asObject(await c.req.json());
}

function handle(e: unknown) {
  const message = e instanceof Error ? e.message : "Request failed";
  const status = message.includes("not found") ? 404 : message.includes("UNIQUE") || message.includes("already") ? 409 : message.includes("Unauthorized") ? 401 : 400;
  return { body: error(message), status: status as ContentfulStatusCode };
}

residentRoutes.post("/register/request-otp", async (c) => {
  try {
    const input = await body(c);
    return c.json(await service(c).requestRegistrationOtp({
      firstName: stringField(input, "firstName")!,
      middleName: stringField(input, "middleName", false),
      lastName: stringField(input, "lastName")!,
      phone: stringField(input, "phone")!,
      email: stringField(input, "email", false),
      institutionCode: stringField(input, "institutionCode")!,
      studentId: stringField(input, "studentId")!
    }));
  } catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});

residentRoutes.post("/register/verify-otp", async (c) => {
  try {
    const input = await body(c);
    return c.json(ok(await service(c).verifyRegistrationOtp(stringField(input, "institutionCode")!, stringField(input, "studentId")!, stringField(input, "otp")!, c.req.header("User-Agent"))));
  } catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});

residentRoutes.use("/me/*", requireAuth);
residentRoutes.get("/me", requireAuth, async (c) => c.json(ok(await service(c).me(c.get("authUser")))));
residentRoutes.patch("/me", requireAuth, async (c) => {
  try {
    const input = await body(c);
    return c.json(ok(await service(c).updateMe(c.get("authUser"), {
      firstName: stringField(input, "firstName", false),
      middleName: stringField(input, "middleName", false),
      lastName: stringField(input, "lastName", false),
      email: stringField(input, "email", false)
    })));
  } catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});

residentRoutes.get("/me/documents", async (c) => c.json(ok((await service(c).documentsFor(c.get("authUser"))).results ?? [])));
residentRoutes.post("/me/documents/student-card", async (c) => upload(c, "student_card"));
residentRoutes.post("/me/documents/ghana-card", async (c) => upload(c, "ghana_card"));
residentRoutes.get("/me/documents/:id", async (c) => {
  try { return c.json(ok(await service(c).ownDocument(c.get("authUser"), Number(c.req.param("id"))))); }
  catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});

residentRoutes.get("/me/academic-session", async (c) => c.json(ok(await service(c).activeAcademicSession())));
residentRoutes.get("/me/applications", async (c) => c.json(ok((await service(c).applications(c.get("authUser"))).results ?? [])));
residentRoutes.post("/me/applications", async (c) => {
  try { const input = await body(c); return c.json(ok(await service(c).createApplication(c.get("authUser"), intField(input, "academicSessionId")!)), 201); }
  catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
residentRoutes.get("/me/applications/:id", async (c) => {
  try { return c.json(ok(await service(c).ownApplication(c.get("authUser"), Number(c.req.param("id"))))); }
  catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
residentRoutes.patch("/me/applications/:id", async (c) => {
  try {
    const input = await body(c);
    return c.json(ok(await service(c).updateApplication(c.get("authUser"), Number(c.req.param("id")), { notes: stringField(input, "notes", false, 2000) })));
  } catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
residentRoutes.post("/me/applications/:id/submit", async (c) => {
  try { return c.json(ok(await service(c).submitApplication(c.get("authUser"), Number(c.req.param("id"))))); }
  catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
residentRoutes.get("/me/bookings", async (c) => c.json(ok((await service(c).bookings(c.get("authUser"))).results ?? [])));
residentRoutes.get("/me/allocation", async (c) => c.json(ok(await service(c).allocation(c.get("authUser")))));
residentRoutes.get("/me/maintenance", async (c) => c.json(ok((await service(c).maintenance(c.get("authUser"))).results ?? [])));
residentRoutes.post("/me/maintenance", async (c) => {
  try {
    const input = await body(c);
    return c.json(ok(await service(c).createMaintenance(c.get("authUser"), {
      category: stringField(input, "category")!,
      priority: stringField(input, "priority", false) ?? undefined,
      title: stringField(input, "title")!,
      description: stringField(input, "description", false, 2000)
    })), 201);
  } catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
residentRoutes.get("/me/maintenance/:id", async (c) => {
  try { return c.json(ok(await service(c).ownMaintenance(c.get("authUser"), Number(c.req.param("id"))))); }
  catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
residentRoutes.get("/me/announcements", async (c) => c.json(ok((await service(c).announcements(c.get("authUser"))).results ?? [])));
residentRoutes.get("/me/announcements/:id", async (c) => {
  try { return c.json(ok(await service(c).announcement(c.get("authUser"), Number(c.req.param("id"))))); }
  catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});

async function upload(c: Context<{ Bindings: Env; Variables: Variables }>, type: "student_card" | "ghana_card") {
  try {
    const file = (await c.req.formData()).get("file");
    if (!file || typeof file !== "object" || !("stream" in file)) throw new Error("file is required");
    return c.json(ok(await service(c).uploadIdentityDocument(c.get("authUser"), type, file)), 201);
  } catch (e) { const h = handle(e); return c.json(h.body, h.status); }
}
