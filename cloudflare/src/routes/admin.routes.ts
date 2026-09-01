import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Env } from "../types/bindings";
import type { AuthUser } from "../auth/context";
import { requireAuth, requirePermission, requireRole } from "../middleware/auth.middleware";
import { hasPermission } from "../auth/permissions";
import { AdminRepository } from "../repositories/admin.repository";
import { AdminService } from "../services/admin.service";
import { asObject, intField, pagination, stringField } from "../http/input";
import { error, listOk, ok } from "../http/responses";

type Variables = { authUser: AuthUser };
const routes = new Hono<{ Bindings: Env; Variables: Variables }>();
routes.use("*", requireAuth);

function service(c: { env: Env }) {
  return new AdminService(new AdminRepository(c.env.DB), c.env.DOCUMENTS);
}

async function body(c: { req: { json: () => Promise<unknown> } }) {
  return asObject(await c.req.json());
}

function handle(e: unknown) {
  const message = e instanceof Error ? e.message : "Request failed";
  const status = message.includes("not found") ? 404 : message.includes("exceeded") || message.includes("UNIQUE") ? 409 : 400;
  return { body: error(message), status: status as ContentfulStatusCode };
}

function listRoute(path: string, table: string, permission = "admin:read") {
  routes.get(path, requirePermission(permission), async (c) => {
    const p = pagination(new URL(c.req.url));
    const search = new URL(c.req.url).searchParams.get("search") ?? undefined;
    const result = await service(c).list(table, p.limit, p.offset, search);
    return c.json(listOk((result.results ?? []) as unknown[], p));
  });
}

listRoute("/academic-sessions", "academic_sessions");
listRoute("/institutions", "institutions");
listRoute("/rooms", "rooms");
listRoute("/room-rates", "room_rates");
listRoute("/residents", "residents", "resident:read");
// Staff uses joined users/staff/roles responses below.
listRoute("/roles", "roles");
listRoute("/applications", "applications", "application:read");
listRoute("/bookings", "bookings", "booking:read");
listRoute("/allocations", "allocations", "allocation:read");
listRoute("/payments", "payments", "payment:read");
listRoute("/receipts", "receipts", "receipt:read");

routes.get("/dashboard", requirePermission("admin:read"), async (c) => c.json(ok(await service(c).dashboard())));
routes.get("/dashboard/overview", requirePermission("admin:read"), async (c) => c.json(ok(await service(c).operationalOverview())));
routes.get("/dashboard/occupancy", requirePermission("admin:read"), async (c) => {
  const id = new URL(c.req.url).searchParams.get("academicSessionId");
  return c.json(ok(await service(c).occupancyReport(id ? Number(id) : null)));
});
routes.get("/dashboard/finance", requirePermission("payment:read"), async (c) => c.json(ok(await service(c).financialReport())));
routes.get("/dashboard/applications", requirePermission("application:read"), async (c) => {
  const id = new URL(c.req.url).searchParams.get("academicSessionId");
  return c.json(ok(await service(c).applicationBookingReport(id ? Number(id) : null)));
});
routes.get("/dashboard/maintenance", requirePermission("maintenance:read"), async (c) => c.json(ok(await service(c).maintenanceReport())));
routes.get("/dashboard/announcements", requirePermission("announcement:read"), async (c) => c.json(ok(await service(c).announcementReport())));

function reportFilters(url: URL) {
  return {
    academicSessionId: url.searchParams.get("academicSessionId") ? Number(url.searchParams.get("academicSessionId")) : null,
    dateFrom: url.searchParams.get("dateFrom"),
    dateTo: url.searchParams.get("dateTo"),
    status: url.searchParams.get("residentStatus"),
    bookingStatus: url.searchParams.get("bookingStatus")
  };
}

routes.get("/reports/overview", requirePermission("report:read"), async (c) => {
  const filters = reportFilters(new URL(c.req.url));
  return c.json(ok(await service(c).reportOverview({ academicSessionId: filters.academicSessionId })));
});
routes.get("/reports/occupancy", requirePermission("report:read"), async (c) => {
  const filters = reportFilters(new URL(c.req.url));
  return c.json(ok(await service(c).reportOccupancy({ academicSessionId: filters.academicSessionId })));
});
routes.get("/reports/residents", requirePermission("report:read"), async (c) => {
  const filters = reportFilters(new URL(c.req.url));
  return c.json(ok(await service(c).reportResidents({ status: filters.status, academicSessionId: filters.academicSessionId })));
});
routes.get("/reports/applications-bookings", requirePermission("report:read"), async (c) => {
  const filters = reportFilters(new URL(c.req.url));
  return c.json(ok(await service(c).reportApplicationsBookings({ academicSessionId: filters.academicSessionId, bookingStatus: filters.bookingStatus })));
});
routes.get("/reports/finance", requirePermission("report:finance"), async (c) => {
  const filters = reportFilters(new URL(c.req.url));
  return c.json(ok(await service(c).reportFinance({ academicSessionId: filters.academicSessionId, dateFrom: filters.dateFrom, dateTo: filters.dateTo })));
});
routes.get("/reports/outstanding", requirePermission("report:finance"), async (c) => {
  const filters = reportFilters(new URL(c.req.url));
  return c.json(ok(await service(c).reportOutstanding({ academicSessionId: filters.academicSessionId })));
});
routes.get("/reports/maintenance", requirePermission("report:read"), async (c) => {
  const filters = reportFilters(new URL(c.req.url));
  return c.json(ok(await service(c).reportMaintenance({ dateFrom: filters.dateFrom, dateTo: filters.dateTo })));
});

routes.post("/academic-sessions", requirePermission("admin:write"), async (c) => {
  try {
    const input = await body(c);
    const data = await service(c).createAcademicSession(c.get("authUser"), {
      code: stringField(input, "code")!,
      name: stringField(input, "name")!,
      startsOn: stringField(input, "startsOn", true, 32)!,
      endsOn: stringField(input, "endsOn", true, 32)!,
      status: stringField(input, "status", false) ?? undefined
    });
    return c.json(ok(data), 201);
  } catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});

routes.get("/academic-sessions/:id", requirePermission("admin:read"), async (c) => c.json(ok(await service(c).get("academic_sessions", Number(c.req.param("id"))))));
routes.patch("/academic-sessions/:id/status", requirePermission("admin:write"), async (c) => {
  try {
    const input = await body(c);
    return c.json(ok(await service(c).updateStatus(c.get("authUser"), "academic_sessions", Number(c.req.param("id")), stringField(input, "status")!)));
  } catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});

routes.post("/institutions", requirePermission("admin:write"), async (c) => {
  try {
    const input = await body(c);
    return c.json(ok(await service(c).createInstitution(c.get("authUser"), {
      code: stringField(input, "code")!,
      name: stringField(input, "name")!,
      status: stringField(input, "status", false) ?? undefined
    })), 201);
  } catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
routes.get("/institutions/:id", requirePermission("admin:read"), async (c) => c.json(ok(await service(c).get("institutions", Number(c.req.param("id"))))));
routes.patch("/institutions/:id/status", requirePermission("admin:write"), async (c) => {
  try { const input = await body(c); return c.json(ok(await service(c).updateStatus(c.get("authUser"), "institutions", Number(c.req.param("id")), stringField(input, "status")!))); }
  catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});

routes.post("/rooms", requirePermission("admin:write"), async (c) => {
  try {
    const input = await body(c);
    return c.json(ok(await service(c).createRoom(c.get("authUser"), {
      roomCode: stringField(input, "roomCode")!,
      roomName: stringField(input, "roomName", false),
      floor: stringField(input, "floor", false),
      capacity: intField(input, "capacity")!,
      genderPolicy: stringField(input, "genderPolicy", false) ?? undefined,
      status: stringField(input, "status", false) ?? undefined
    })), 201);
  } catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
routes.get("/rooms/:id", requirePermission("admin:read"), async (c) => c.json(ok(await service(c).room(Number(c.req.param("id"))))));
routes.patch("/rooms/:id/status", requirePermission("admin:write"), async (c) => {
  try { const input = await body(c); return c.json(ok(await service(c).updateStatus(c.get("authUser"), "rooms", Number(c.req.param("id")), stringField(input, "status")!))); }
  catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});

routes.get("/rooms/:roomId/beds", requirePermission("admin:read"), async (c) => {
  const p = pagination(new URL(c.req.url));
  const rows = await new AdminRepository(c.env.DB).all("SELECT * FROM beds WHERE room_id = ? ORDER BY label LIMIT ? OFFSET ?", Number(c.req.param("roomId")), p.limit, p.offset);
  return c.json(listOk((rows.results ?? []) as unknown[], p));
});
routes.post("/beds", requirePermission("admin:write"), async (c) => {
  try {
    const input = await body(c);
    return c.json(ok(await service(c).createBed(c.get("authUser"), {
      roomId: intField(input, "roomId")!,
      bedCode: stringField(input, "bedCode")!,
      label: stringField(input, "label")!,
      status: stringField(input, "status", false) ?? undefined
    })), 201);
  } catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
routes.patch("/beds/:id/status", requirePermission("admin:write"), async (c) => {
  try { const input = await body(c); return c.json(ok(await service(c).updateStatus(c.get("authUser"), "beds", Number(c.req.param("id")), stringField(input, "status")!))); }
  catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});

routes.post("/room-rates", requirePermission("admin:write"), async (c) => {
  try {
    const input = await body(c);
    return c.json(ok(await service(c).createRoomRate(c.get("authUser"), {
      roomId: intField(input, "roomId")!,
      academicSessionId: intField(input, "academicSessionId")!,
      rateCode: stringField(input, "rateCode")!,
      amountMinor: intField(input, "amountMinor")!,
      currency: stringField(input, "currency", false, 3) ?? undefined,
      status: stringField(input, "status", false) ?? undefined
    })), 201);
  } catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
routes.patch("/room-rates/:id/status", requirePermission("admin:write"), async (c) => {
  try { const input = await body(c); return c.json(ok(await service(c).updateStatus(c.get("authUser"), "room_rates", Number(c.req.param("id")), stringField(input, "status")!))); }
  catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});

routes.post("/residents", requirePermission("resident:write"), async (c) => {
  try {
    const input = await body(c);
    return c.json(ok(await service(c).createResident(c.get("authUser"), {
      email: stringField(input, "email", false),
      phone: stringField(input, "phone", false),
      displayName: stringField(input, "displayName")!,
      institutionId: intField(input, "institutionId")!,
      studentId: stringField(input, "studentId")!,
      firstName: stringField(input, "firstName")!,
      lastName: stringField(input, "lastName")!,
      gender: stringField(input, "gender", false),
      status: stringField(input, "status", false) ?? undefined
    })), 201);
  } catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
routes.get("/residents/:id", requirePermission("resident:read"), async (c) => c.json(ok(await service(c).get("residents", Number(c.req.param("id"))))));

routes.get("/staff", requirePermission("staff:read"), async (c) => {
  const p = pagination(new URL(c.req.url));
  const search = new URL(c.req.url).searchParams.get("search") ?? undefined;
  const result = await service(c).listStaff(p.limit, p.offset, search);
  return c.json(listOk((result.results ?? []) as unknown[], p));
});
routes.post("/staff", requireRole("super_admin"), async (c) => {
  try {
    const input = await body(c);
    return c.json(ok(await service(c).createStaff(c.get("authUser"), {
      email: stringField(input, "email")!,
      username: stringField(input, "username")!,
      phone: stringField(input, "phone", false),
      displayName: stringField(input, "displayName")!,
      roleId: intField(input, "roleId")!,
      staffCode: stringField(input, "staffCode")!,
      jobTitle: stringField(input, "jobTitle", false),
      password: stringField(input, "password", false) ?? undefined
    })), 201);
  } catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
routes.get("/staff/:id", requirePermission("staff:read"), async (c) => c.json(ok(await service(c).staffMember(Number(c.req.param("id"))))));
routes.patch("/staff/:id/status", requireRole("super_admin"), async (c) => {
  try { const input = await body(c); return c.json(ok(await service(c).changeStaffStatus(c.get("authUser"), Number(c.req.param("id")), stringField(input, "status")!))); }
  catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
routes.patch("/staff/:id/role", requireRole("super_admin"), async (c) => {
  try { const input = await body(c); return c.json(ok(await service(c).changeStaffRole(c.get("authUser"), Number(c.req.param("id")), intField(input, "roleId")!))); }
  catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
routes.patch("/staff/:id/account-status", requireRole("super_admin"), async (c) => {
  try { const input = await body(c); return c.json(ok(await service(c).changeStaffAccountStatus(c.get("authUser"), Number(c.req.param("id")), stringField(input, "status")!))); }
  catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
routes.post("/staff/:id/reset-password", requireRole("super_admin"), async (c) => {
  try { return c.json(ok(await service(c).resetStaffPassword(c.get("authUser"), Number(c.req.param("id"))))); }
  catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});

routes.post("/applications", requirePermission("application:write"), async (c) => {
  try {
    const input = await body(c);
    return c.json(ok(await service(c).createApplication(c.get("authUser"), {
      residentId: intField(input, "residentId")!,
      academicSessionId: intField(input, "academicSessionId")!,
      notes: stringField(input, "notes", false, 2000)
    })), 201);
  } catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
routes.get("/applications/:id", requirePermission("application:read"), async (c) => c.json(ok(await service(c).get("applications", Number(c.req.param("id"))))));
routes.patch("/applications/:id/status", requirePermission("application:write"), async (c) => {
  try {
    const input = await body(c);
    return c.json(ok(await service(c).updateApplicationStatus(c.get("authUser"), Number(c.req.param("id")), stringField(input, "status")! as never, stringField(input, "notes", false, 2000))));
  } catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});

routes.post("/bookings", requirePermission("booking:write"), async (c) => {
  try {
    const input = await body(c);
    return c.json(ok(await service(c).createBooking(c.get("authUser"), {
      applicationId: intField(input, "applicationId")!,
      roomId: intField(input, "roomId")!,
      expiresAt: stringField(input, "expiresAt", false, 64)
    })), 201);
  } catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
routes.get("/bookings/:id", requirePermission("booking:read"), async (c) => c.json(ok(await service(c).get("bookings", Number(c.req.param("id"))))));
routes.patch("/bookings/:id/status", async (c) => {
  try {
    const input = await body(c);
    const status = stringField(input, "status")!;
    const permission = status === "confirmed" ? "booking:confirm" : "booking:write";
    if (!hasPermission(c.get("authUser").role, permission)) return c.json(error("Forbidden", "forbidden"), 403);
    return c.json(ok(await service(c).updateBookingStatus(c.get("authUser"), Number(c.req.param("id")), status as never)));
  }
  catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
routes.get("/bookings/:id/payment-summary", requirePermission("booking:read"), async (c) => {
  try { return c.json(ok(await service(c).bookingPaymentSummary(Number(c.req.param("id"))))); }
  catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});

routes.get("/availability", requirePermission("allocation:read"), async (c) => {
  const url = new URL(c.req.url);
  const sessionId = Number(url.searchParams.get("academicSessionId"));
  const residentId = url.searchParams.get("residentId") ? Number(url.searchParams.get("residentId")) : null;
  try { return c.json(ok(await service(c).availability(sessionId, residentId))); }
  catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});

routes.post("/allocations", requirePermission("allocation:write"), async (c) => {
  try {
    const input = await body(c);
    return c.json(ok(await service(c).createAllocation(c.get("authUser"), {
      bookingId: intField(input, "bookingId")!,
      residentId: intField(input, "residentId")!,
      academicSessionId: intField(input, "academicSessionId")!,
      bedId: intField(input, "bedId")!,
      startsOn: stringField(input, "startsOn", true, 32)!,
      notes: stringField(input, "notes", false, 2000)
    })), 201);
  } catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
routes.get("/allocations/:id", requirePermission("allocation:read"), async (c) => c.json(ok(await service(c).get("allocations", Number(c.req.param("id"))))));
routes.post("/allocations/:id/transfer", requirePermission("allocation:write"), async (c) => {
  try {
    const input = await body(c);
    return c.json(ok(await service(c).transferAllocation(c.get("authUser"), Number(c.req.param("id")), {
      destinationBedId: intField(input, "destinationBedId")!,
      startsOn: stringField(input, "startsOn", true, 32)!,
      notes: stringField(input, "notes", false, 2000)
    })), 201);
  } catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
routes.patch("/allocations/:id/status", requirePermission("allocation:write"), async (c) => {
  try { const input = await body(c); return c.json(ok(await service(c).updateAllocationStatus(c.get("authUser"), Number(c.req.param("id")), stringField(input, "status")! as never))); }
  catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});

routes.post("/payments", requirePermission("payment:write"), async (c) => {
  try {
    const input = await body(c);
    return c.json(ok(await service(c).createPayment(c.get("authUser"), {
      bookingId: intField(input, "bookingId")!,
      residentId: intField(input, "residentId")!,
      amountMinor: intField(input, "amountMinor")!,
      currency: stringField(input, "currency", false, 3) ?? undefined,
      method: stringField(input, "method")!,
      paidAt: stringField(input, "paidAt", false, 64),
      notes: stringField(input, "notes", false, 2000)
    })), 201);
  } catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
routes.get("/payments/:id", requirePermission("payment:read"), async (c) => c.json(ok(await service(c).get("payments", Number(c.req.param("id"))))));
routes.patch("/payments/:id/status", requirePermission("payment:write"), async (c) => {
  try { const input = await body(c); return c.json(ok(await service(c).updatePaymentStatus(c.get("authUser"), Number(c.req.param("id")), stringField(input, "status")! as never, stringField(input, "notes", false, 2000)))); }
  catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
routes.post("/payments/:id/verify", requirePermission("payment:verify"), async (c) => {
  try { const input = await body(c); return c.json(ok(await service(c).verifyPayment(c.get("authUser"), Number(c.req.param("id")), stringField(input, "notes", false, 2000)))); }
  catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
routes.post("/payments/:id/reject", requirePermission("payment:verify"), async (c) => {
  try { const input = await body(c); return c.json(ok(await service(c).updatePaymentStatus(c.get("authUser"), Number(c.req.param("id")), "rejected", stringField(input, "notes", false, 2000)))); }
  catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
routes.post("/payments/:id/refund", requirePermission("payment:verify"), async (c) => {
  try { const input = await body(c); return c.json(ok(await service(c).refundPayment(c.get("authUser"), Number(c.req.param("id")), stringField(input, "notes", false, 2000)))); }
  catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
routes.post("/payments/:id/slip", requirePermission("payment:write"), async (c) => {
  try {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!file || typeof file !== "object" || !("stream" in file)) throw new Error("file is required");
    return c.json(ok(await service(c).uploadPaymentSlip(c.get("authUser"), Number(c.req.param("id")), file)), 201);
  } catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
routes.post("/payments/:id/receipt", requirePermission("receipt:write"), async (c) => {
  try { return c.json(ok(await service(c).issueReceipt(c.get("authUser"), Number(c.req.param("id")))), 201); }
  catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
routes.get("/receipts/:id", requirePermission("receipt:read"), async (c) => c.json(ok(await service(c).receipt(Number(c.req.param("id"))))));
routes.post("/receipts/:id/void", requirePermission("receipt:write"), async (c) => {
  try { const input = await body(c); return c.json(ok(await service(c).voidReceipt(c.get("authUser"), Number(c.req.param("id")), stringField(input, "reason", false, 1000)))); }
  catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});

routes.get("/documents", requirePermission("document:read"), async (c) => c.json(ok((await service(c).identityDocuments()).results ?? [])));
routes.get("/documents/:id", requirePermission("document:read"), async (c) => {
  try {
    const allowGhana = hasPermission(c.get("authUser").role, "document:ghana_card");
    return c.json(ok(await service(c).identityDocument(c.get("authUser"), Number(c.req.param("id")), allowGhana)));
  } catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
routes.get("/documents/:id/content", requirePermission("document:read"), async (c) => {
  try {
    const allowGhana = hasPermission(c.get("authUser").role, "document:ghana_card");
    const result = await service(c).identityDocumentContent(c.get("authUser"), Number(c.req.param("id")), allowGhana);
    return new Response(result.object.body, { headers: { "Content-Type": String(result.document.content_type ?? "application/octet-stream"), "Cache-Control": "private, max-age=60" } });
  } catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
routes.post("/documents/:id/verify", requirePermission("document:write"), async (c) => {
  try { return c.json(ok(await service(c).updateIdentityDocumentStatus(c.get("authUser"), Number(c.req.param("id")), "verified"))); }
  catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
routes.post("/documents/:id/reject", requirePermission("document:write"), async (c) => {
  try { const input = await body(c); return c.json(ok(await service(c).updateIdentityDocumentStatus(c.get("authUser"), Number(c.req.param("id")), "rejected", stringField(input, "reason", false, 1000)))); }
  catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});

routes.get("/maintenance", requirePermission("maintenance:read"), async (c) => {
  const p = pagination(new URL(c.req.url));
  const result = await service(c).list("maintenance_requests", p.limit, p.offset, new URL(c.req.url).searchParams.get("search") ?? undefined);
  return c.json(listOk((result.results ?? []) as unknown[], p));
});
routes.get("/maintenance/:id", requirePermission("maintenance:read"), async (c) => c.json(ok(await service(c).get("maintenance_requests", Number(c.req.param("id"))))));
routes.post("/maintenance", requirePermission("maintenance:create"), async (c) => {
  try {
    const input = await body(c);
    return c.json(ok(await service(c).createMaintenance(c.get("authUser"), {
      residentId: intField(input, "residentId", false),
      roomId: intField(input, "roomId", false),
      bedId: intField(input, "bedId", false),
      category: stringField(input, "category")!,
      priority: stringField(input, "priority", false) ?? undefined,
      title: stringField(input, "title")!,
      description: stringField(input, "description", false, 2000)
    })), 201);
  } catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
routes.post("/maintenance/:id/assign", requirePermission("maintenance:assign"), async (c) => {
  try { const input = await body(c); return c.json(ok(await service(c).assignMaintenance(c.get("authUser"), Number(c.req.param("id")), intField(input, "staffId")!))); }
  catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
routes.post("/maintenance/:id/start", requirePermission("maintenance:update"), async (c) => {
  try { return c.json(ok(await service(c).updateMaintenanceStatus(c.get("authUser"), Number(c.req.param("id")), "in_progress"))); }
  catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
routes.post("/maintenance/:id/resolve", requirePermission("maintenance:resolve"), async (c) => {
  try { return c.json(ok(await service(c).updateMaintenanceStatus(c.get("authUser"), Number(c.req.param("id")), "resolved"))); }
  catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
routes.post("/maintenance/:id/close", requirePermission("maintenance:close"), async (c) => {
  try { return c.json(ok(await service(c).updateMaintenanceStatus(c.get("authUser"), Number(c.req.param("id")), "closed"))); }
  catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
routes.post("/maintenance/:id/cancel", requirePermission("maintenance:update"), async (c) => {
  try { return c.json(ok(await service(c).updateMaintenanceStatus(c.get("authUser"), Number(c.req.param("id")), "cancelled"))); }
  catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});

routes.get("/announcements", requirePermission("announcement:read"), async (c) => {
  const p = pagination(new URL(c.req.url));
  const result = await service(c).listAnnouncements(p.limit, p.offset, new URL(c.req.url).searchParams.get("search") ?? undefined);
  return c.json(listOk((result.results ?? []) as unknown[], p));
});
routes.post("/announcements", requirePermission("announcement:write"), async (c) => {
  try {
    const input = await body(c);
    return c.json(ok(await service(c).createAnnouncement(c.get("authUser"), {
      title: stringField(input, "title")!,
      body: stringField(input, "body", true, 5000)!,
      audience: stringField(input, "audience", false) ?? undefined,
      severity: stringField(input, "severity", false) ?? undefined,
      channels: Array.isArray(input.channels) ? input.channels.map(String) : undefined,
      startsAt: stringField(input, "startsAt", false, 64),
      expiresAt: stringField(input, "expiresAt", false, 64)
    })), 201);
  } catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
routes.get("/announcements/:id", requirePermission("announcement:read"), async (c) => c.json(ok(await service(c).announcement(Number(c.req.param("id"))))));
routes.patch("/announcements/:id", requirePermission("announcement:write"), async (c) => {
  try { const input = await body(c); return c.json(ok(await service(c).updateAnnouncement(c.get("authUser"), Number(c.req.param("id")), { title: stringField(input, "title", false), body: stringField(input, "body", false, 5000), audience: stringField(input, "audience", false), severity: stringField(input, "severity", false), channels: Array.isArray(input.channels) ? input.channels.map(String) : undefined, startsAt: stringField(input, "startsAt", false, 64), expiresAt: stringField(input, "expiresAt", false, 64) }))); }
  catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
routes.post("/announcements/:id/publish", requirePermission("announcement:publish"), async (c) => {
  try {
    const input = await body(c);
    const ann = await service(c).announcement(Number(c.req.param("id"))) as Record<string, unknown> & { channels?: string[] };
    const hasExternal = (ann.channels ?? []).some((channel) => channel === "sms" || channel === "email");
    if (hasExternal && !hasPermission(c.get("authUser").role, "announcement:external_delivery")) return c.json(error("Forbidden", "forbidden"), 403);
    return c.json(ok(await service(c).publishAnnouncement(c.get("authUser"), Number(c.req.param("id")), { confirmHighAlert: Boolean(input.confirmHighAlert), idempotencyKey: stringField(input, "idempotencyKey", false, 128) ?? undefined })));
  }
  catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
routes.post("/announcements/:id/expire", requirePermission("announcement:publish"), async (c) => {
  try { return c.json(ok(await service(c).updateAnnouncementStatus(c.get("authUser"), Number(c.req.param("id")), "expired"))); }
  catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
routes.post("/announcements/:id/archive", requirePermission("announcement:write"), async (c) => {
  try { return c.json(ok(await service(c).updateAnnouncementStatus(c.get("authUser"), Number(c.req.param("id")), "archived"))); }
  catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});

routes.get("/messages", requirePermission("message:read"), async (c) => {
  const url = new URL(c.req.url);
  const p = pagination(url);
  const result = await service(c).listMessages(p.limit, p.offset, {
    search: url.searchParams.get("search") ?? undefined,
    status: url.searchParams.get("status"),
    targetType: url.searchParams.get("targetType"),
    channel: url.searchParams.get("channel")
  });
  return c.json(listOk((result.results ?? []) as unknown[], p));
});
routes.post("/messages/preview", requirePermission("message:write"), async (c) => {
  try {
    const input = await body(c);
    return c.json(ok(await service(c).previewMessageTarget({
      targetType: stringField(input, "targetType")!,
      targetIds: Array.isArray(input.targetIds) ? input.targetIds.map(Number) : undefined,
      group: stringField(input, "group", false),
      academicSessionId: intField(input, "academicSessionId", false),
      staffRoleCodes: Array.isArray(input.staffRoleCodes) ? input.staffRoleCodes.map(String) : undefined,
      staffIds: Array.isArray(input.staffIds) ? input.staffIds.map(Number) : undefined
    })));
  } catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
routes.post("/messages", requirePermission("message:write"), async (c) => {
  try {
    const input = await body(c);
    return c.json(ok(await service(c).createMessage(c.get("authUser"), {
      subject: stringField(input, "subject", true, 200)!,
      body: stringField(input, "body", true, 5000)!,
      targetType: stringField(input, "targetType")!,
      targetIds: Array.isArray(input.targetIds) ? input.targetIds.map(Number) : undefined,
      group: stringField(input, "group", false),
      academicSessionId: intField(input, "academicSessionId", false),
      staffRoleCodes: Array.isArray(input.staffRoleCodes) ? input.staffRoleCodes.map(String) : undefined,
      staffIds: Array.isArray(input.staffIds) ? input.staffIds.map(Number) : undefined,
      channels: Array.isArray(input.channels) ? input.channels.map(String) : ["portal"]
    })), 201);
  } catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
routes.get("/messages/:id", requirePermission("message:read"), async (c) => c.json(ok(await service(c).message(Number(c.req.param("id")), hasPermission(c.get("authUser").role, "message:read")))));
routes.post("/messages/:id/send", requirePermission("message:send"), async (c) => {
  try {
    const input = await body(c);
    const msg = await service(c).message(Number(c.req.param("id"))) as Record<string, unknown> & { channels?: string[] };
    if ((msg.channels ?? []).some((channel) => channel === "sms" || channel === "email") && !hasPermission(c.get("authUser").role, "message:external_delivery")) return c.json(error("Forbidden", "forbidden"), 403);
    return c.json(ok(await service(c).sendMessage(c.get("authUser"), Number(c.req.param("id")), { idempotencyKey: stringField(input, "idempotencyKey", true, 128)! })));
  } catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});
routes.post("/messages/:id/archive", requirePermission("message:write"), async (c) => {
  try { return c.json(ok(await service(c).archiveMessage(c.get("authUser"), Number(c.req.param("id"))))); }
  catch (e) { const h = handle(e); return c.json(h.body, h.status); }
});

routes.get("/audit-logs", requirePermission("audit:read"), async (c) => {
  const url = new URL(c.req.url);
  const p = pagination(url);
  const result = await service(c).auditLogs(c.get("authUser"), {
    search: url.searchParams.get("search"),
    action: url.searchParams.get("action"),
    entityType: url.searchParams.get("entityType"),
    actorUserId: url.searchParams.get("actorUserId") ? Number(url.searchParams.get("actorUserId")) : null,
    actorStaffId: url.searchParams.get("actorStaffId") ? Number(url.searchParams.get("actorStaffId")) : null,
    dateFrom: url.searchParams.get("dateFrom"),
    dateTo: url.searchParams.get("dateTo")
  }, p.limit, p.offset);
  return c.json({ ...listOk((result.results ?? []) as unknown[], p), pagination: { ...p, total: result.total } });
});
routes.get("/audit-logs/:id", requirePermission("audit:read"), async (c) => c.json(ok(await service(c).auditLog(c.get("authUser"), Number(c.req.param("id"))))));

export const adminRoutes = routes;
