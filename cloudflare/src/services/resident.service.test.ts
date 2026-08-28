import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { ResidentService } from "./resident.service";
import { hashPassword } from "../auth/crypto";
import type { AuthUser } from "../auth/context";
import { requirePermission } from "../middleware/auth.middleware";

const resident: AuthUser = { id: 1, userType: "resident", displayName: "Ama", email: "ama@test", role: "resident", staffId: null, residentId: 1, sessionId: 1 };
const otherResident: AuthUser = { ...resident, id: 2, residentId: 2 };
const reception: AuthUser = { ...resident, userType: "staff", role: "reception", staffId: 1, residentId: null };
const manager: AuthUser = { ...reception, role: "manager" };

class Sms {
  last: { destination: string; otp: string } | null = null;
  async sendOtp(destination: string, otp: string) { this.last = { destination, otp }; }
}

class Repo {
  rows: Record<string, Record<string, unknown>[]> = {
    institutions: [{ id: 1, code: "ug", name: "University of Ghana", status: "active" }, { id: 2, code: "old", name: "Old", status: "inactive" }],
    users: [{ id: 1, phone: "+2331", email: "ama@test", display_name: "Ama" }, { id: 2, phone: "+2332", email: "kojo@test", display_name: "Kojo" }],
    residents: [{ id: 1, user_id: 1, institution_id: 1, resident_code: "KSM-RES-0001", student_id: "S1", first_name: "Ama", middle_name: null, last_name: "A", status: "applicant", phone_verified_at: "now" }, { id: 2, user_id: 2, institution_id: 1, resident_code: "KSM-RES-0002", student_id: "S2", first_name: "Kojo", last_name: "K", status: "applicant", phone_verified_at: "now" }],
    otp_codes: [],
    sessions: [],
    documents: [],
    applications: [],
    bookings: [{ id: 1, resident_id: 1, booking_number: "KSM-BKG-0001", status: "pending", total_amount_minor: 250000, currency: "GHS" }],
    allocations: [{ id: 1, resident_id: 1, status: "active", bed_id: 1, academic_session_id: 1 }],
    beds: [{ id: 1, room_id: 1, bed_code: "R1-A", label: "A" }],
    rooms: [{ id: 1, room_code: "R1", room_name: "Room 1" }],
    maintenance_requests: [{ id: 1, request_number: "KSM-MNT-0001", resident_id: 1, status: "open", title: "Leak", category: "plumbing", priority: "urgent" }, { id: 2, request_number: "KSM-MNT-0002", resident_id: 2, status: "open", title: "Other", category: "cleaning", priority: "normal" }],
    announcements: [{ id: 1, title: "Residents", audience: "residents", status: "published", expires_at: null }, { id: 2, title: "All", audience: "all", status: "published", expires_at: null }, { id: 3, title: "Staff", audience: "staff", status: "published", expires_at: null }, { id: 4, title: "Draft", audience: "all", status: "draft", expires_at: null }, { id: 5, title: "Expired", audience: "all", status: "published", expires_at: "2000-01-01T00:00:00.000Z" }]
  };
  audits: string[] = [];
  residentSeq = 3;
  appSeq = 1;
  mntSeq = 3;

  async all<T>(sql: string, ...binds: unknown[]) {
    if (sql.includes("FROM institutions")) return { results: this.rows.institutions.filter((i) => i.status === "active").map(({ code, name }) => ({ code, name })) as T[] };
    if (sql.includes("FROM documents")) return { results: this.rows.documents.filter((d) => d.resident_id === binds[0]) as T[] };
    if (sql.includes("FROM applications")) return { results: this.rows.applications.filter((a) => a.resident_id === binds[0]) as T[] };
    if (sql.includes("FROM bookings")) return { results: this.rows.bookings.filter((b) => b.resident_id === binds[0]) as T[] };
    if (sql.includes("FROM maintenance_requests")) return { results: this.rows.maintenance_requests.filter((m) => m.resident_id === binds[0]) as T[] };
    if (sql.includes("FROM announcements")) return { results: this.rows.announcements.filter((a) => ["all", "residents"].includes(String(a.audience)) && a.status === "published" && (!a.expires_at || String(a.expires_at) > new Date().toISOString())) as T[] };
    return { results: [] as T[] };
  }
  async first<T>(sql: string, ...binds: unknown[]): Promise<T | null> {
    if (sql.includes("FROM institutions")) return (this.rows.institutions.find((i) => String(i.code).toLowerCase() === String(binds[0]).toLowerCase() && i.status === "active") ?? null) as T;
    if (sql.includes("FROM residents WHERE institution_id")) return (this.rows.residents.find((r) => r.institution_id === binds[0] && r.student_id === binds[1]) ?? null) as T;
    if (sql.includes("FROM otp_codes WHERE purpose")) return (this.rows.otp_codes.at(-1) ?? null) as T;
    if (sql.includes("FROM residents r JOIN users")) return this.profile(binds[0] as number) as T;
    if (sql.includes("COUNT(*) AS count FROM documents")) return { count: this.rows.documents.filter((d) => d.resident_id === binds[0] && ["student_card", "ghana_card"].includes(String(d.document_type))).length } as T;
    if (sql.includes("FROM applications WHERE id")) return (this.rows.applications.find((a) => a.id === binds[0] && a.resident_id === binds[1]) ?? null) as T;
    if (sql.includes("FROM documents WHERE id")) return (this.rows.documents.find((d) => d.id === binds[0] && d.resident_id === binds[1]) ?? null) as T;
    if (sql.includes("FROM allocations")) {
      const allocation = this.rows.allocations.find((a) => a.resident_id === binds[0] && a.status === "active");
      const bed = this.rows.beds.find((b) => b.id === allocation?.bed_id);
      const room = this.rows.rooms.find((r) => r.id === bed?.room_id);
      return allocation ? { ...allocation, bed_code: bed?.bed_code, label: bed?.label, room_code: room?.room_code, room_name: room?.room_name } as T : null;
    }
    if (sql.includes("FROM maintenance_requests")) return (this.rows.maintenance_requests.find((m) => m.id === binds[0] && m.resident_id === binds[1]) ?? null) as T;
    if (sql.includes("FROM announcements")) return (this.rows.announcements.find((a) => a.id === binds[0] && ["all", "residents"].includes(String(a.audience)) && a.status === "published" && (!a.expires_at || String(a.expires_at) > new Date().toISOString())) ?? null) as T;
    return null;
  }
  async get(table: string, id: number) { return (this.rows[table] ?? []).find((r) => r.id === id) ?? null; }
  async allocateResidentCode() { return `KSM-RES-${String(this.residentSeq++).padStart(4, "0")}`; }
  async allocateApplicationNumber() { return `KSM-APP-${String(this.appSeq++).padStart(4, "0")}`; }
  async allocateMaintenanceRequestNumber() { return `KSM-MNT-${String(this.mntSeq++).padStart(4, "0")}`; }
  async run(sql: string, ...binds: unknown[]) {
    if (sql.startsWith("INSERT INTO otp_codes")) {
      const id = this.rows.otp_codes.length + 1;
      this.rows.otp_codes.push({ id, destination: binds[0], code_hash: binds[1], rate_limit_key: binds[2], expires_at: binds[3], registration_payload_json: binds[4], status: "pending", attempt_count: 0, max_attempts: 5 });
      return { meta: { last_row_id: id, changes: 1 } };
    }
    if (sql.startsWith("INSERT INTO users")) {
      const id = this.rows.users.length + 1;
      this.rows.users.push({ id, email: binds[0], phone: binds[1], display_name: binds[2] });
      return { meta: { last_row_id: id, changes: 1 } };
    }
    if (sql.startsWith("INSERT INTO residents")) {
      if (this.rows.residents.some((r) => r.institution_id === binds[1] && r.student_id === binds[3])) throw new Error("UNIQUE constraint failed");
      const id = this.rows.residents.length + 1;
      this.rows.residents.push({ id, user_id: binds[0], institution_id: binds[1], resident_code: binds[2], student_id: binds[3], first_name: binds[4], middle_name: binds[5], last_name: binds[6], status: "applicant", phone_verified_at: "now" });
      return { meta: { last_row_id: id, changes: 1 } };
    }
    if (sql.startsWith("INSERT INTO sessions")) this.rows.sessions.push({ id: 1, user_id: binds[0], token_hash: binds[1] });
    if (sql.startsWith("INSERT INTO documents")) {
      const id = this.rows.documents.length + 1;
      this.rows.documents.push({ id, owner_user_id: binds[0], resident_id: binds[1], document_type: binds[2], status: "uploaded", r2_key: binds[3], original_filename: binds[4], content_type: binds[5], size_bytes: binds[6] });
      return { meta: { last_row_id: id, changes: 1 } };
    }
    if (sql.startsWith("INSERT INTO applications")) {
      if (this.rows.applications.some((a) => a.resident_id === binds[0] && a.academic_session_id === binds[1] && ["draft", "submitted", "under_review", "approved"].includes(String(a.status)))) throw new Error("UNIQUE constraint failed");
      const id = this.rows.applications.length + 1;
      this.rows.applications.push({ id, resident_id: binds[0], academic_session_id: binds[1], application_number: binds[2], status: "draft" });
      return { meta: { last_row_id: id, changes: 1 } };
    }
    if (sql.startsWith("INSERT INTO maintenance_requests")) {
      const id = this.rows.maintenance_requests.length + 1;
      this.rows.maintenance_requests.push({ id, request_number: binds[0], resident_id: binds[1], bed_id: binds[3], category: binds[4], priority: binds[5], status: "open", title: binds[6], description: binds[7] });
      return { meta: { last_row_id: id, changes: 1 } };
    }
    if (sql.startsWith("UPDATE applications")) {
      const id = sql.includes("decision_notes") ? binds[1] : binds[0];
      const row = this.rows.applications.find((a) => a.id === id);
      if (row && sql.includes("status = 'submitted'")) row.status = "submitted";
      if (row && sql.includes("decision_notes")) row.decision_notes = binds[0];
    }
    if (sql.startsWith("UPDATE otp_codes")) {
      const row = this.rows.otp_codes.find((o) => o.id === binds.at(-1));
      if (row) row.status = "used";
    }
    return { meta: { last_row_id: 1, changes: 1 } };
  }
  async audit(_actorUserId: number | null, _actorStaffId: number | null, action: string) { this.audits.push(action); }
  profile(id: number) {
    const r = this.rows.residents.find((row) => row.id === id);
    const u = this.rows.users.find((row) => row.id === r?.user_id);
    const i = this.rows.institutions.find((row) => row.id === r?.institution_id);
    return r ? { ...r, phone: u?.phone, email: u?.email, institution_code: i?.code, institution_name: i?.name } : null;
  }
}

function make(repo = new Repo()) {
  const sms = new Sms();
  const puts: string[] = [];
  const r2 = { put: async (key: string) => { puts.push(key); } };
  return { svc: new ResidentService({} as never, sms, r2 as never, repo as never), repo, sms, puts };
}

describe("resident onboarding", () => {
  it("lists only active public institutions", async () => {
    const { svc } = make();
    await expect(svc.activeInstitutions()).resolves.toMatchObject({ results: [{ code: "ug" }] });
  });

  it("requests registration OTP and rejects invalid OTP", async () => {
    const { svc, sms } = make();
    await svc.requestRegistrationOtp({ firstName: "New", lastName: "Student", phone: "+2339", institutionCode: "ug", studentId: "S9" });
    expect(sms.last?.destination).toBe("+2339");
    await expect(svc.verifyRegistrationOtp("ug", "S9", "000000")).rejects.toThrow("Invalid or expired OTP");
  });

  it("verifies phone, creates applicant resident, generates resident code, and issues session", async () => {
    const { svc, sms, repo } = make();
    await svc.requestRegistrationOtp({ firstName: "New", middleName: "M", lastName: "Student", phone: "+2339", email: "new@test", institutionCode: "ug", studentId: "S9" });
    const result = await svc.verifyRegistrationOtp("ug", "S9", sms.last!.otp) as Record<string, unknown>;
    expect(result.token).toBeTruthy();
    expect(repo.rows.residents.at(-1)?.resident_code).toBe("KSM-RES-0003");
    expect(repo.rows.sessions).toHaveLength(1);
  });

  it("detects duplicate institution/student registration", async () => {
    const { svc, sms } = make();
    await svc.requestRegistrationOtp({ firstName: "Dup", lastName: "Student", phone: "+2339", institutionCode: "ug", studentId: "S1" });
    expect(sms.last).toBeNull();
  });

  it("retrieves own profile and prevents cross-resident document/application access", async () => {
    const { svc, repo } = make();
    repo.rows.documents.push({ id: 1, resident_id: 1, document_type: "student_card", status: "uploaded" });
    repo.rows.applications.push({ id: 1, resident_id: 1, application_number: "KSM-APP-0001", status: "draft" });
    await expect(svc.me(resident)).resolves.toMatchObject({ resident_code: "KSM-RES-0001" });
    await expect(svc.ownDocument(otherResident, 1)).rejects.toThrow("Document not found");
    await expect(svc.ownApplication(otherResident, 1)).rejects.toThrow("Application not found");
  });

  it("uploads private Student Card and Ghana Card documents", async () => {
    const { svc, puts } = make();
    await svc.uploadIdentityDocument(resident, "student_card", new File(["x"], "student.pdf", { type: "application/pdf" }));
    await svc.uploadIdentityDocument(resident, "ghana_card", new File(["x"], "ghana.png", { type: "image/png" }));
    expect(puts.every((key) => key.startsWith("identity/1/"))).toBe(true);
    await expect(svc.uploadIdentityDocument(resident, "student_card", new File(["x"], "bad.txt", { type: "text/plain" }))).rejects.toThrow("Unsupported document type");
  });

  it("creates, updates, and submits own draft application after required uploads", async () => {
    const { svc, repo } = make();
    repo.rows.documents.push({ id: 1, resident_id: 1, document_type: "student_card", status: "uploaded" }, { id: 2, resident_id: 1, document_type: "ghana_card", status: "uploaded" });
    const app = await svc.createApplication(resident, 1) as Record<string, unknown>;
    expect(app.application_number).toBe("KSM-APP-0001");
    await expect(svc.updateApplication(resident, Number(app.id), { notes: "Quiet room preferred" })).resolves.toMatchObject({ decision_notes: "Quiet room preferred" });
    await expect(svc.createApplication(resident, 1)).rejects.toThrow("UNIQUE");
    await expect(svc.submitApplication(resident, Number(app.id))).resolves.toMatchObject({ status: "submitted" });
  });

  it("rejects incomplete application submission and exposes own booking/allocation only", async () => {
    const { svc } = make();
    const app = await svc.createApplication(resident, 1) as Record<string, unknown>;
    await expect(svc.submitApplication(resident, Number(app.id))).rejects.toThrow("Incomplete application");
    await expect(svc.bookings(resident)).resolves.toMatchObject({ results: [{ booking_number: "KSM-BKG-0001" }] });
    await expect(svc.bookings(otherResident)).resolves.toMatchObject({ results: [] });
    await expect(svc.allocation(resident)).resolves.toMatchObject({ room_code: "R1" });
  });

  it("keeps Ghana Card staff access restricted by permission", async () => {
    const app = new Hono<{ Variables: { authUser: AuthUser } }>();
    app.use("*", async (c, next) => { c.set("authUser", reception); return next(); });
    app.get("/ghana", requirePermission("document:ghana_card"), (c) => c.json({ ok: true }));
    expect((await app.request("/ghana")).status).toBe(403);

    const allowed = new Hono<{ Variables: { authUser: AuthUser } }>();
    allowed.use("*", async (c, next) => { c.set("authUser", manager); return next(); });
    allowed.get("/ghana", requirePermission("document:ghana_card"), (c) => c.json({ ok: true }));
    expect((await allowed.request("/ghana")).status).toBe(200);
  });

  it("lets residents create and view only their own maintenance requests", async () => {
    const { svc, repo } = make();
    const created = await svc.createMaintenance(resident, { category: "plumbing", priority: "urgent", title: "Leak", description: "Pipe leak" }) as Record<string, unknown>;
    expect(created.request_number).toBe("KSM-MNT-0003");
    await expect(svc.maintenance(resident)).resolves.toMatchObject({ results: expect.arrayContaining([expect.objectContaining({ resident_id: 1 })]) });
    await expect(svc.ownMaintenance(otherResident, Number(created.id))).rejects.toThrow("Maintenance request not found");
    expect(repo.audits).toContain("resident.maintenance.created");
  });

  it("shows resident and all announcements but excludes staff draft and expired announcements", async () => {
    const { svc } = make();
    const rows = (await svc.announcements(resident)).results as Record<string, unknown>[];
    expect(rows.map((row) => row.title)).toEqual(["Residents", "All"]);
    await expect(svc.announcement(resident, 3)).rejects.toThrow("Announcement not found");
    await expect(svc.announcement(resident, 4)).rejects.toThrow("Announcement not found");
    await expect(svc.announcement(resident, 5)).rejects.toThrow("Announcement not found");
  });
});
