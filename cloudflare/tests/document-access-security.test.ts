/**
 * Document access hardening: Ghana Card list filtering, opaque R2 keys,
 * magic-byte validation, proxied downloads, replace-rejected-only, audits without PII.
 * LOCAL/TEST ONLY: sql.js in-memory D1. No remote D1 or R2.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { Database } from "sql.js";
import { createSqlJsD1, get, openMigratedDatabase, run } from "./apply-migrations";
import { samplePdfFile, samplePngFile } from "./upload-samples";
import type { Env } from "../src/types/bindings";
import type { AuthUser } from "../src/auth/context";
import type { RoleCode } from "../src/auth/permissions";
import { adminRoutes } from "../src/routes/admin.routes";
import { residentRoutes } from "../src/routes/resident.routes";
import { AdminRepository } from "../src/repositories/admin.repository";
import { AdminService } from "../src/services/admin.service";
import { ResidentService } from "../src/services/resident.service";
import { documentDownloadHeaders, matchesUploadMagic, opaqueObjectKey, safeDownloadContentType } from "../src/http/uploads";
import { sha256Hex } from "../src/auth/crypto";

class MemoryR2 {
  store = new Map<string, { data: Uint8Array; contentType?: string }>();

  async put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string, options?: { httpMetadata?: { contentType?: string } }) {
    let data: Uint8Array;
    if (typeof value === "string") data = new TextEncoder().encode(value);
    else if (value instanceof ArrayBuffer) data = new Uint8Array(value);
    else if (ArrayBuffer.isView(value)) data = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    else {
      const reader = value.getReader();
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        chunks.push(chunk as Uint8Array);
      }
      const len = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      data = new Uint8Array(len);
      let offset = 0;
      for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.length;
      }
    }
    this.store.set(key, { data, contentType: options?.httpMetadata?.contentType });
    return {} as R2Object;
  }

  async get(key: string) {
    const stored = this.store.get(key);
    if (!stored) return null;
    return {
      body: new Blob([stored.data]).stream(),
      arrayBuffer: async () => stored.data.slice().buffer,
      httpMetadata: { contentType: stored.contentType }
    } as unknown as R2ObjectBody;
  }
}

let db: Database;
let d1: D1Database;
let r2: MemoryR2;
const sms = { send: async () => ({ providerMessageId: "test" }) };

function env(): Env {
  return {
    DB: d1,
    DOCUMENTS: r2 as unknown as R2Bucket,
    APP_NAME: "test",
    APP_ENV: "local",
    APP_VERSION: "0",
    PUBLIC_BASE_URL: "http://localhost"
  } as Env;
}

const TOKENS = { manager: "manager-token", reception: "reception-token", resident: "resident-token", other: "other-resident-token" };

function staff(role: RoleCode, id = 1): AuthUser {
  return { id, userType: "staff", displayName: role === "reception" ? "Reception Staff" : "Manager Staff", email: null, role, staffId: id, residentId: null, sessionId: 1 };
}

function residentActor(userId = 10, residentId = 1): AuthUser {
  return { id: userId, userType: "resident", displayName: "Ama Mensah", email: null, role: "resident", staffId: null, residentId, sessionId: 2 };
}

function adminApp() {
  const app = new Hono<{ Bindings: Env; Variables: { authUser: AuthUser } }>();
  app.route("/", adminRoutes);
  return app;
}

function residentApp() {
  const app = new Hono<{ Bindings: Env; Variables: { authUser: AuthUser } }>();
  app.route("/", residentRoutes);
  return app;
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

async function insertSession(userId: number, token: string) {
  const hash = await sha256Hex(token);
  const expires = new Date(Date.now() + 86_400_000).toISOString();
  run(db, "INSERT INTO sessions (user_id, session_token_hash, status, expires_at) VALUES (?, ?, 'active', ?)", [userId, hash, expires]);
}

function adminSvc() {
  return new AdminService(new AdminRepository(d1), r2 as unknown as R2Bucket);
}

function residentSvc() {
  return new ResidentService(env(), sms as never, r2 as unknown as R2Bucket, new AdminRepository(d1));
}

beforeEach(async () => {
  db = await openMigratedDatabase();
  d1 = createSqlJsD1(db);
  r2 = new MemoryR2();
  run(db, "INSERT INTO roles (id, code, name, is_system) VALUES (1, 'manager', 'Manager', 1), (2, 'reception', 'Reception', 1)");
  run(db, "INSERT INTO users (id, email, phone, display_name, user_type, status) VALUES (1, 'manager@test.example', '+233000000001', 'Manager Staff', 'staff', 'active')");
  run(db, "INSERT INTO users (id, email, phone, display_name, user_type, status) VALUES (2, 'reception@test.example', '+233000000002', 'Reception Staff', 'staff', 'active')");
  run(db, "INSERT INTO staff (id, user_id, role_id, staff_code, status) VALUES (1, 1, 1, 'KSM-STF-0001', 'active')");
  run(db, "INSERT INTO staff (id, user_id, role_id, staff_code, status) VALUES (2, 2, 2, 'KSM-STF-0002', 'active')");
  run(db, "INSERT INTO institutions (id, code, name, status) VALUES (1, 'UG', 'University of Ghana', 'active')");
  run(db, "INSERT INTO users (id, email, phone, display_name, user_type, status) VALUES (10, 'ama@test.example', '+233000000010', 'Ama Mensah', 'resident', 'active')");
  run(db, "INSERT INTO residents (id, user_id, institution_id, student_id, first_name, last_name, gender, status, resident_code) VALUES (1, 10, 1, 'UG-1', 'Ama', 'Mensah', 'female', 'applicant', 'KSM-RES-0001')");
  await insertSession(1, TOKENS.manager);
  await insertSession(2, TOKENS.reception);
  await insertSession(10, TOKENS.resident);
});

afterEach(() => db.close());

describe("upload helpers", () => {
  it("issues opaque object keys without resident, type, or filename material", () => {
    const key = opaqueObjectKey();
    expect(key).toMatch(/^objects\/[0-9a-f-]{36}$/i);
    expect(key).not.toMatch(/identity|ghana|student|payment|slip|\.pdf|\.png/i);
  });

  it("accepts matching magic bytes and rejects mismatched content", () => {
    expect(matchesUploadMagic(new TextEncoder().encode("%PDF-1.4"), "application/pdf")).toBe(true);
    expect(matchesUploadMagic(new TextEncoder().encode("not a pdf"), "application/pdf")).toBe(false);
    expect(safeDownloadContentType("image/png")).toBe("image/png");
    expect(safeDownloadContentType("text/html")).toBe("application/octet-stream");
    const headers = new Headers(documentDownloadHeaders('quote"name.pdf', "text/html"));
    expect(headers.get("Content-Type")).toBe("application/octet-stream");
    expect(headers.get("Content-Disposition")).toBe('attachment; filename="quote_name.pdf"');
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Cache-Control")).toBe("private, no-store");
  });
});

describe("admin identity document list and content", () => {
  beforeEach(async () => {
    await residentSvc().uploadIdentityDocument(residentActor(), "student_card", samplePdfFile("student-card.pdf"));
    await residentSvc().uploadIdentityDocument(residentActor(), "ghana_card", samplePngFile("ama-ghana-card.png"));
  });

  it("hides Ghana Card rows from reception, includes a resident id flag, and audits the list without filenames", async () => {
    const res = await adminApp().fetch(new Request("http://api/documents", { headers: authHeaders(TOKENS.reception) }), env());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { documents: Array<Record<string, unknown>>; restrictedResidentIds: number[] } };
    expect(body.data.documents).toHaveLength(1);
    expect(body.data.documents[0].document_type).toBe("student_card");
    expect(body.data.restrictedResidentIds).toEqual([1]);
    expect(JSON.stringify(body)).not.toMatch(/r2_key|objects\/|ama-ghana-card|Ghana Card number|\+233/i);

    const manager = await adminApp().fetch(new Request("http://api/documents", { headers: authHeaders(TOKENS.manager) }), env());
    const managerBody = (await manager.json()) as { data: { documents: Array<Record<string, unknown>>; restrictedResidentIds: number[] } };
    expect(managerBody.data.documents.map((d) => d.document_type).sort()).toEqual(["ghana_card", "student_card"]);
    expect(managerBody.data.restrictedResidentIds).toEqual([]);

    const audits = allActions();
    expect(audits.filter((a) => a.action === "admin.identity_document.listed")).toHaveLength(2);
    for (const row of audits.filter((a) => a.action === "admin.identity_document.listed")) {
      expect(row.metadata_json).not.toMatch(/ama-ghana-card|filename|Mensah|\+233/i);
    }
  });

  it("forbids reception from Ghana Card metadata and content, and allows managers with download safety headers", async () => {
    const ghana = get<{ id: number }>(db, "SELECT id FROM documents WHERE document_type = 'ghana_card'")!;
    const forbidden = await adminApp().fetch(new Request(`http://api/documents/${ghana.id}`, { headers: authHeaders(TOKENS.reception) }), env());
    expect(forbidden.status).toBe(403);
    const forbiddenContent = await adminApp().fetch(new Request(`http://api/documents/${ghana.id}/content`, { headers: authHeaders(TOKENS.reception) }), env());
    expect(forbiddenContent.status).toBe(403);

    const content = await adminApp().fetch(new Request(`http://api/documents/${ghana.id}/content`, { headers: authHeaders(TOKENS.manager) }), env());
    expect(content.status).toBe(200);
    expect(content.headers.get("Content-Type")).toBe("image/png");
    expect(content.headers.get("Content-Disposition")).toMatch(/^attachment;/);
    expect(content.headers.get("Cache-Control")).toBe("private, no-store");
    expect(content.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const body = await content.arrayBuffer();
    expect(new Uint8Array(body)[0]).toBe(0x89);

    const meta = await adminApp().fetch(new Request(`http://api/documents/${ghana.id}`, { headers: authHeaders(TOKENS.manager) }), env());
    const metaBody = (await meta.json()) as { data: Record<string, unknown> };
    expect(metaBody.data.last_accessed_by).toBe("Manager Staff");
    expect(metaBody.data.last_accessed_at).toEqual(expect.any(String));

    const audits = allActions().filter((a) => a.action === "admin.identity_document.content_accessed");
    expect(audits).toHaveLength(1);
    expect(audits[0].metadata_json).not.toMatch(/ama-ghana-card|Mensah|\+233/i);
  });

  it("stores opaque R2 keys and never returns them over the API", async () => {
    const row = get<{ r2_key: string }>(db, "SELECT r2_key FROM documents WHERE document_type = 'student_card'")!;
    expect(row.r2_key).toMatch(/^objects\/[0-9a-f-]{36}$/i);
    expect(row.r2_key).not.toMatch(/identity\/|student_card|student-card/i);
    const listed = await adminApp().fetch(new Request("http://api/documents", { headers: authHeaders(TOKENS.manager) }), env());
    expect(await listed.text()).not.toContain(row.r2_key);
  });
});

describe("resident replace-rejected-only and own content", () => {
  it("rejects a second upload while a document is uploaded or verified, and allows replace after rejection", async () => {
    const svc = residentSvc();
    const first = await svc.uploadIdentityDocument(residentActor(), "student_card", samplePdfFile("one.pdf")) as { id: number };
    await expect(svc.uploadIdentityDocument(residentActor(), "student_card", samplePdfFile("two.pdf"))).rejects.toThrow(/already on file/i);

    await adminSvc().updateIdentityDocumentStatus(staff("manager"), first.id, "verified");
    await expect(svc.uploadIdentityDocument(residentActor(), "student_card", samplePdfFile("three.pdf"))).rejects.toThrow(/verified/i);

    await adminSvc().updateIdentityDocumentStatus(staff("manager"), first.id, "rejected", "Unclear image");
    const replaced = await svc.uploadIdentityDocument(residentActor(), "student_card", samplePdfFile("four.pdf")) as { id: number; status: string };
    expect(replaced.id).not.toBe(first.id);
    expect(replaced.status).toBe("uploaded");
    const archived = get<{ status: string }>(db, "SELECT status FROM documents WHERE id = ?", [first.id])!;
    expect(archived.status).toBe("archived");
  });

  it("lets a resident download only their own document and rejects a cross-resident request", async () => {
    await residentSvc().uploadIdentityDocument(residentActor(), "student_card", samplePdfFile("own.pdf"));
    const id = get<{ id: number }>(db, "SELECT id FROM documents")!.id;

    const okRes = await residentApp().fetch(new Request(`http://api/me/documents/${id}/content`, { headers: authHeaders(TOKENS.resident) }), env());
    expect(okRes.status).toBe(200);
    expect(okRes.headers.get("Content-Disposition")).toMatch(/^attachment;/);
    expect(okRes.headers.get("Cache-Control")).toBe("private, no-store");

    run(db, "INSERT INTO users (id, email, phone, display_name, user_type, status) VALUES (11, 'kojo@test.example', '+233000000011', 'Kojo Boateng', 'resident', 'active')");
    run(db, "INSERT INTO residents (id, user_id, institution_id, student_id, first_name, last_name, gender, status, resident_code) VALUES (2, 11, 1, 'UG-2', 'Kojo', 'Boateng', 'male', 'applicant', 'KSM-RES-0002')");
    await insertSession(11, TOKENS.other);
    const other = await residentApp().fetch(new Request(`http://api/me/documents/${id}/content`, { headers: authHeaders(TOKENS.other) }), env());
    expect(other.status).toBe(404);
  });

  it("rejects a PDF extension whose contents are not a PDF", async () => {
    const spoofed = new File(["not a pdf"], "student.pdf", { type: "application/pdf" });
    await expect(residentSvc().uploadIdentityDocument(residentActor(), "student_card", spoofed)).rejects.toThrow(/Unsupported document type/i);
    expect(get(db, "SELECT id FROM documents")).toBeNull();
  });
});

describe("payment slip and receipt PDF content", () => {
  beforeEach(async () => {
    run(db, "INSERT INTO payments (id, resident_id, payment_reference, status, amount_minor, currency, method) VALUES (1, 1, 'KSM-PAY-0001', 'pending', 10000, 'GHS', 'bank_transfer')");
    run(db, "INSERT INTO receipts (id, payment_id, receipt_number, status, issued_by_staff_id) VALUES (1, 1, 'KSM-RCP-0001', 'issued', 1)");
    run(db, "INSERT INTO roles (id, code, name, is_system) VALUES (3, 'maintenance', 'Maintenance', 1)");
    run(db, "INSERT INTO users (id, email, phone, display_name, user_type, status) VALUES (3, 'maint@test.example', '+233000000003', 'Maintenance Staff', 'staff', 'active')");
    run(db, "INSERT INTO staff (id, user_id, role_id, staff_code, status) VALUES (3, 3, 3, 'KSM-STF-0003', 'active')");
    await insertSession(3, "maintenance-token");
  });

  it("streams a payment slip to payment:read roles and audits without the filename or reference in metadata", async () => {
    const key = opaqueObjectKey();
    const pdf = new TextEncoder().encode("%PDF-1.4\n%%EOF\n");
    await r2.put(key, pdf, { httpMetadata: { contentType: "application/pdf" } });
    run(db, "INSERT INTO documents (owner_user_id, resident_id, payment_id, document_type, status, r2_bucket, r2_key, original_filename, content_type, size_bytes, uploaded_by_user_id) VALUES (10, 1, 1, 'payment_slip', 'uploaded', 'DOCUMENTS', ?, 'bank-slip.pdf', 'application/pdf', ?, 1)", [key, pdf.byteLength]);
    expect(key).toMatch(/^objects\//);
    expect(key).not.toContain("KSM-PAY-0001");

    const res = await adminApp().fetch(new Request("http://api/payments/1/slip/content", { headers: authHeaders(TOKENS.reception) }), env());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toMatch(/attachment;/);

    const maintenance = await adminApp().fetch(new Request("http://api/payments/1/slip/content", { headers: authHeaders("maintenance-token") }), env());
    expect(maintenance.status).toBe(403);

    const audits = allActions().filter((a) => a.action === "admin.payment.slip_accessed");
    expect(audits).toHaveLength(1);
    expect(audits[0].metadata_json).not.toMatch(/bank-slip|KSM-PAY-0001/i);
  });

  it("returns a clear error when a receipt PDF has not been stored, and streams one when it has", async () => {
    const missing = await adminApp().fetch(new Request("http://api/receipts/1/pdf", { headers: authHeaders(TOKENS.manager) }), env());
    expect(missing.status).toBe(404);
    expect(await missing.text()).toMatch(/Receipt PDF not found/i);

    const key = "objects/11111111-1111-4111-8111-111111111111";
    const pdf = new TextEncoder().encode("%PDF-1.4\n%%EOF\n");
    await r2.put(key, pdf, { httpMetadata: { contentType: "application/pdf" } });
    run(db, "INSERT INTO documents (owner_user_id, resident_id, payment_id, receipt_id, document_type, status, r2_bucket, r2_key, original_filename, content_type, size_bytes, uploaded_by_user_id) VALUES (10, 1, 1, 1, 'receipt_pdf', 'uploaded', 'DOCUMENTS', ?, 'receipt.pdf', 'application/pdf', ?, 1)", [key, pdf.byteLength]);

    const found = await adminApp().fetch(new Request("http://api/receipts/1/pdf", { headers: authHeaders(TOKENS.manager) }), env());
    expect(found.status).toBe(200);
    expect(found.headers.get("Content-Type")).toBe("application/pdf");
  });
});

function allActions() {
  const stmt = db.prepare("SELECT action, metadata_json, entity_id FROM audit_logs ORDER BY id");
  const rows: Array<{ action: string; metadata_json: string | null; entity_id: number | null }> = [];
  while (stmt.step()) rows.push(stmt.getAsObject() as (typeof rows)[0]);
  stmt.free();
  return rows;
}
