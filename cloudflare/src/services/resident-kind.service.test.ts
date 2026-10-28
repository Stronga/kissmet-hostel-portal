import { describe, expect, it } from "vitest";
import { AdminService } from "./admin.service";
import { ResidentService } from "./resident.service";
import type { AuthUser } from "../auth/context";
import {
  assertIdentityDocsForSubmit,
  assertResidentKindFields,
  isResidentKind,
} from "../types/resident-kind";

const manager: AuthUser = {
  id: 1,
  userType: "staff",
  displayName: "Manager",
  email: "m@test",
  role: "manager",
  staffId: 1,
  residentId: null,
  sessionId: 1,
};

const studentActor: AuthUser = {
  id: 10,
  userType: "resident",
  displayName: "Student",
  email: "s@test",
  role: "resident",
  staffId: null,
  residentId: 1,
  sessionId: 2,
};

const nonStudentActor: AuthUser = { ...studentActor, id: 11, residentId: 2, displayName: "NonStudent" };

class AdminRepo {
  rows: Record<string, Record<string, unknown>[]> = {
    users: [],
    residents: [],
    institutions: [{ id: 1, code: "ug", name: "UG", status: "active" }],
    academic_sessions: [{ id: 1, code: "2026", status: "active" }],
    lease_periods: [
      { id: 1, kind: "academic_calendar", code: "AC", name: "AC", status: "active", academic_session_id: 1, starts_on: "2026-09-01", ends_on: "2027-06-30" },
      { id: 2, kind: "calendar_year", code: "CY", name: "CY", status: "active", academic_session_id: null, starts_on: "2026-01-01", ends_on: "2026-12-31" },
      { id: 3, kind: "short_term", code: "ST", name: "ST", status: "active", academic_session_id: null, starts_on: "2026-01-01", ends_on: "2026-03-31" },
    ],
    applications: [],
    bookings: [],
  };
  audits: Array<{ action: string; meta?: unknown }> = [];
  nextCode = 1;
  nextApp = 1;

  async get(table: string, id: number) {
    return (this.rows[table] ?? []).find((r) => r.id === id) ?? null;
  }
  async first<T>(_sql: string, ..._binds: unknown[]): Promise<T | null> {
    return null;
  }
  async allocateResidentCode() {
    return `KSM-RES-${String(this.nextCode++).padStart(4, "0")}`;
  }
  async allocateApplicationNumber() {
    return `KSM-APP-${String(this.nextApp++).padStart(4, "0")}`;
  }
  async run(sql: string, ...binds: unknown[]) {
    if (sql.startsWith("INSERT INTO users")) {
      const id = this.rows.users.length + 1;
      this.rows.users.push({ id, email: binds[0], phone: binds[1], display_name: binds[2] });
      return { meta: { last_row_id: id } };
    }
    if (sql.startsWith("INSERT INTO residents")) {
      if (binds[3] != null && this.rows.residents.some((r) => r.institution_id === binds[1] && r.student_id === binds[3])) {
        throw new Error("UNIQUE constraint failed");
      }
      const id = this.rows.residents.length + 1;
      this.rows.residents.push({
        id,
        user_id: binds[0],
        institution_id: binds[1],
        resident_code: binds[2],
        student_id: binds[3],
        first_name: binds[4],
        last_name: binds[5],
        gender: binds[6],
        status: binds[7],
        resident_kind: binds[8],
      });
      return { meta: { last_row_id: id } };
    }
    if (sql.includes("INSERT INTO applications")) {
      if (
        binds[2] != null &&
        this.rows.applications.some(
          (a) =>
            a.resident_id === binds[0] &&
            a.lease_period_id === binds[2] &&
            ["draft", "submitted", "under_review", "approved"].includes(String(a.status)),
        )
      ) {
        throw new Error("UNIQUE constraint failed");
      }
      if (
        binds[2] == null &&
        binds[1] != null &&
        this.rows.applications.some(
          (a) =>
            a.resident_id === binds[0] &&
            a.academic_session_id === binds[1] &&
            a.lease_period_id == null &&
            ["draft", "submitted", "under_review", "approved"].includes(String(a.status)),
        )
      ) {
        throw new Error("UNIQUE constraint failed");
      }
      const id = this.rows.applications.length + 1;
      this.rows.applications.push({
        id,
        resident_id: binds[0],
        academic_session_id: binds[1],
        lease_period_id: binds[2],
        lease_kind: binds[3],
        application_number: binds[4],
        status: "draft",
        decision_notes: binds[5] ?? null,
      });
      return { meta: { last_row_id: id } };
    }
    return { meta: { last_row_id: 0 } };
  }
  async audit(_u: number, _s: number | null, action: string, _e?: string, _id?: number, meta?: unknown) {
    this.audits.push({ action, meta });
  }
}

class ResidentRepo {
  rows: Record<string, Record<string, unknown>[]> = {
    residents: [
      {
        id: 1,
        user_id: 10,
        institution_id: 1,
        resident_code: "KSM-RES-0001",
        student_id: "S1",
        first_name: "Ama",
        last_name: "A",
        status: "applicant",
        phone_verified_at: "now",
        resident_kind: "student",
      },
      {
        id: 2,
        user_id: 11,
        institution_id: null,
        resident_code: "KSM-RES-0002",
        student_id: null,
        first_name: "Kojo",
        last_name: "K",
        status: "applicant",
        phone_verified_at: "now",
        resident_kind: "non_student",
      },
    ],
    users: [
      { id: 10, phone: "233241111111", email: "ama@test" },
      { id: 11, phone: "233242222222", email: "kojo@test" },
    ],
    institutions: [{ id: 1, code: "ug", name: "UG", status: "active" }],
    academic_sessions: [{ id: 1, code: "2026", name: "2026", status: "active" }],
    lease_periods: [
      { id: 1, kind: "academic_calendar", code: "AC", name: "AC", status: "active", academic_session_id: 1 },
      { id: 2, kind: "calendar_year", code: "CY", name: "CY", status: "active", academic_session_id: null },
      { id: 3, kind: "short_term", code: "ST", name: "ST", status: "active", academic_session_id: null },
    ],
    documents: [] as Record<string, unknown>[],
    applications: [] as Record<string, unknown>[],
  };
  audits: string[] = [];
  appSeq = 1;

  async allocateApplicationNumber() {
    return `KSM-APP-${String(this.appSeq++).padStart(4, "0")}`;
  }
  async all<T>(sql: string, ...binds: unknown[]) {
    if (sql.includes("FROM documents")) {
      return {
        results: this.rows.documents
          .filter((d) => d.resident_id === binds[0] && ["student_card", "ghana_card"].includes(String(d.document_type)))
          .map((d) => ({ document_type: d.document_type, status: d.status })) as T[],
      };
    }
    if (sql.includes("FROM lease_periods")) return { results: this.rows.lease_periods.filter((p) => p.status === "active") as T[] };
    if (sql.includes("FROM applications")) return { results: this.rows.applications.filter((a) => a.resident_id === binds[0]) as T[] };
    return { results: [] as T[] };
  }
  async first<T>(sql: string, ...binds: unknown[]): Promise<T | null> {
    if (sql.includes("FROM residents r JOIN users")) {
      const r = this.rows.residents.find((row) => row.id === binds[0]);
      const u = this.rows.users.find((row) => row.id === r?.user_id);
      const i = this.rows.institutions.find((row) => row.id === r?.institution_id);
      return (r ? { ...r, phone: u?.phone, email: u?.email, institution_code: i?.code, institution_name: i?.name } : null) as T;
    }
    if (sql.includes("FROM lease_periods WHERE id")) return (this.rows.lease_periods.find((p) => p.id === binds[0]) ?? null) as T;
    if (sql.includes("FROM academic_sessions WHERE id")) return (this.rows.academic_sessions.find((s) => s.id === binds[0] && s.status === "active") ?? null) as T;
    if (sql.includes("lease_period_id = ?") && sql.includes("NOT IN")) {
      return (this.rows.applications.find(
        (a) => a.resident_id === binds[0] && a.lease_period_id === binds[1] && !["cancelled", "archived", "rejected"].includes(String(a.status)),
      ) ?? null) as T;
    }
    if (sql.includes("academic_session_id") && sql.includes("NOT IN")) {
      return (this.rows.applications.find(
        (a) =>
          a.resident_id === binds[0] &&
          a.academic_session_id === binds[1] &&
          a.lease_period_id == null &&
          !["cancelled", "archived", "rejected"].includes(String(a.status)),
      ) ?? null) as T;
    }
    if (sql.includes("FROM applications WHERE id")) {
      return (this.rows.applications.find((a) => a.id === binds[0] && a.resident_id === binds[1]) ?? null) as T;
    }
    return null;
  }
  async get(table: string, id: number) {
    return (this.rows[table] ?? []).find((r) => r.id === id) ?? null;
  }
  async run(sql: string, ...binds: unknown[]) {
    if (sql.startsWith("INSERT INTO applications")) {
      if (
        binds[2] != null &&
        this.rows.applications.some(
          (a) => a.resident_id === binds[0] && a.lease_period_id === binds[2] && ["draft", "submitted", "under_review", "approved"].includes(String(a.status)),
        )
      ) {
        throw new Error("UNIQUE constraint failed");
      }
      const id = this.rows.applications.length + 1;
      this.rows.applications.push({
        id,
        resident_id: binds[0],
        academic_session_id: binds[1],
        lease_period_id: binds[2],
        lease_kind: binds[3],
        application_number: binds[4],
        status: "draft",
      });
      return { meta: { last_row_id: id } };
    }
    if (sql.startsWith("UPDATE applications") && sql.includes("submitted")) {
      const row = this.rows.applications.find((a) => a.id === binds[0]);
      if (row) {
        row.status = "submitted";
        row.submitted_at = "now";
      }
    }
    return { meta: { last_row_id: 0 } };
  }
  async audit(_a: number | null, _s: number | null, action: string) {
    this.audits.push(action);
  }
}

describe("Stage 2L-F resident kind domain helpers", () => {
  it("validates kind and institution/student pairs", () => {
    expect(isResidentKind("student")).toBe(true);
    expect(isResidentKind("non_student")).toBe(true);
    expect(isResidentKind("visitor")).toBe(false);
    expect(() => assertResidentKindFields("student", 1, "S1")).not.toThrow();
    expect(() => assertResidentKindFields("student", null, null)).toThrow(/require institution/);
    expect(() => assertResidentKindFields("student", 1, null)).toThrow(/both/);
    expect(() => assertResidentKindFields("non_student", null, null)).not.toThrow();
    expect(() => assertResidentKindFields("non_student", null, "S1")).toThrow(/both|must not/);
    expect(() => assertResidentKindFields("non_student", 1, "S1")).toThrow(/must not/);
  });

  it("requires Ghana Card for all and Student Card only for students", () => {
    expect(() => assertIdentityDocsForSubmit("student", [{ document_type: "ghana_card", status: "uploaded" }])).toThrow(/Student Card/);
    expect(() =>
      assertIdentityDocsForSubmit("student", [
        { document_type: "ghana_card", status: "uploaded" },
        { document_type: "student_card", status: "uploaded" },
      ]),
    ).not.toThrow();
    expect(() => assertIdentityDocsForSubmit("non_student", [{ document_type: "ghana_card", status: "verified" }])).not.toThrow();
    expect(() => assertIdentityDocsForSubmit("non_student", [])).toThrow(/Ghana Card/);
  });
});

describe("Stage 2L-F Admin createResident kind rules", () => {
  it("creates student and non_student with resident_code and rejects invalid shapes", async () => {
    const repo = new AdminRepo();
    const svc = new AdminService(repo as never);
    const student = (await svc.createResident(manager, {
      displayName: "Student",
      residentKind: "student",
      institutionId: 1,
      studentId: "S1",
      firstName: "A",
      lastName: "B",
    })) as Record<string, unknown>;
    expect(student.resident_kind).toBe("student");
    expect(String(student.resident_code)).toMatch(/^KSM-RES-\d{4}$/);

    const nonStudent = (await svc.createResident(manager, {
      displayName: "Guest",
      residentKind: "non_student",
      institutionId: null,
      studentId: null,
      firstName: "C",
      lastName: "D",
    })) as Record<string, unknown>;
    expect(nonStudent.resident_kind).toBe("non_student");
    expect(nonStudent.institution_id).toBeNull();
    expect(nonStudent.student_id).toBeNull();
    expect(String(nonStudent.resident_code)).toMatch(/^KSM-RES-\d{4}$/);

    await expect(
      svc.createResident(manager, {
        displayName: "Bad",
        residentKind: "student",
        institutionId: null,
        studentId: null,
        firstName: "X",
        lastName: "Y",
      }),
    ).rejects.toThrow(/institution/);
    await expect(
      svc.createResident(manager, {
        displayName: "Bad2",
        residentKind: "non_student",
        institutionId: 1,
        studentId: "S9",
        firstName: "X",
        lastName: "Y",
      }),
    ).rejects.toThrow(/Non-student/);
    await expect(
      svc.createResident(manager, {
        displayName: "Bad3",
        residentKind: "alien",
        firstName: "X",
        lastName: "Y",
      }),
    ).rejects.toThrow(/Invalid resident kind/);
    expect(repo.audits.some((a) => a.action === "admin.resident.create")).toBe(true);
  });

  it("creates Academic Calendar, Calendar Year, and Short-Term applications", async () => {
    const repo = new AdminRepo();
    repo.rows.residents.push({ id: 1, resident_kind: "student", institution_id: 1, student_id: "S1" });
    const svc = new AdminService(repo as never);

    const ac = (await svc.createApplication(manager, { residentId: 1, leasePeriodId: 1 })) as Record<string, unknown>;
    expect(ac).toMatchObject({ lease_kind: "academic_calendar", lease_period_id: 1, academic_session_id: 1 });

    const cy = (await svc.createApplication(manager, { residentId: 1, leasePeriodId: 2 })) as Record<string, unknown>;
    expect(cy).toMatchObject({ lease_kind: "calendar_year", lease_period_id: 2, academic_session_id: null });

    const st = (await svc.createApplication(manager, { residentId: 1, leasePeriodId: 3 })) as Record<string, unknown>;
    expect(st).toMatchObject({ lease_kind: "short_term", lease_period_id: 3, academic_session_id: null });

    await expect(svc.createApplication(manager, { residentId: 1, leasePeriodId: 2 })).rejects.toThrow(/already exists/);
    await expect(svc.createApplication(manager, { residentId: 1, leasePeriodId: 2, academicSessionId: 1 })).rejects.toThrow(/must not include/);
    expect(repo.audits.some((a) => a.action === "admin.application.create")).toBe(true);
  });
});

describe("Stage 2L-F resident application submit docs by kind", () => {
  it("requires Student Card for students and not for non-students", async () => {
    const repo = new ResidentRepo();
    const svc = new ResidentService({} as never, { name: "mock", sendOtp: async () => ({ ok: true as const, provider: "mock" }) } as never, undefined, repo as never);

    const studentApp = (await svc.createApplication(studentActor, { leasePeriodId: 2 })) as Record<string, unknown>;
    await expect(svc.submitApplication(studentActor, Number(studentApp.id))).rejects.toThrow("Incomplete application");
    repo.rows.documents.push({ id: 1, resident_id: 1, document_type: "ghana_card", status: "uploaded" });
    await expect(svc.submitApplication(studentActor, Number(studentApp.id))).rejects.toThrow("Incomplete application");
    repo.rows.documents.push({ id: 2, resident_id: 1, document_type: "student_card", status: "uploaded" });
    await expect(svc.submitApplication(studentActor, Number(studentApp.id))).resolves.toMatchObject({ status: "submitted" });

    const nonApp = (await svc.createApplication(nonStudentActor, { leasePeriodId: 3 })) as Record<string, unknown>;
    repo.rows.documents.push({ id: 3, resident_id: 2, document_type: "ghana_card", status: "uploaded" });
    await expect(svc.submitApplication(nonStudentActor, Number(nonApp.id))).resolves.toMatchObject({ status: "submitted" });
    expect(repo.rows.documents.filter((d) => d.resident_id === 2 && d.document_type === "student_card")).toHaveLength(0);
  });

  it("allows applications across different lease periods and preserves history", async () => {
    const repo = new ResidentRepo();
    const svc = new ResidentService({} as never, { name: "mock", sendOtp: async () => ({ ok: true as const, provider: "mock" }) } as never, undefined, repo as never);
    const first = (await svc.createApplication(studentActor, { leasePeriodId: 2 })) as Record<string, unknown>;
    const second = (await svc.createApplication(studentActor, { leasePeriodId: 3 })) as Record<string, unknown>;
    expect(first.lease_period_id).toBe(2);
    expect(second.lease_period_id).toBe(3);
    await expect(svc.createApplication(studentActor, { leasePeriodId: 2 })).rejects.toThrow(/already exists/);
    const legacy = (await svc.createApplication(studentActor, { academicSessionId: 1 })) as Record<string, unknown>;
    expect(legacy).toMatchObject({ academic_session_id: 1, lease_kind: "academic_calendar" });
    expect(repo.rows.applications).toHaveLength(3);
  });
});
