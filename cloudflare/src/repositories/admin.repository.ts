import type { Env } from "../types/bindings";

export class AdminRepository {
  constructor(private readonly db: Env["DB"]) {}

  list(table: string, limit: number, offset: number, search?: string) {
    const allowed: Record<string, string[]> = {
      academic_sessions: ["name", "code"],
      institutions: ["name", "code"],
      residents: ["first_name", "last_name", "student_id", "resident_code"],
      staff: ["staff_code", "job_title"],
      roles: ["name", "code"],
      rooms: ["room_code", "room_name"],
      room_rates: ["rate_code"],
      applications: ["application_number", "status"],
      bookings: ["booking_number", "status"],
      allocations: ["status"],
      payments: ["payment_reference", "status"],
      receipts: ["receipt_number", "status"],
      maintenance_requests: ["request_number", "title", "status"],
      announcements: ["title", "audience", "status"],
      audit_logs: ["action", "entity_type"]
    };
    const cols = allowed[table];
    if (!cols) throw new Error("Invalid table");
    const where = search ? `WHERE ${cols.map((c) => `${c} LIKE ?`).join(" OR ")}` : "";
    const binds = search ? cols.map(() => `%${search}%`) : [];
    return this.db.prepare(`SELECT * FROM ${table} ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).bind(...binds, limit, offset).all();
  }

  get(table: string, id: number) {
    return this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
  }

  run(sql: string, ...binds: unknown[]) {
    return this.db.prepare(sql).bind(...binds).run();
  }

  first<T>(sql: string, ...binds: unknown[]) {
    return this.db.prepare(sql).bind(...binds).first<T>();
  }

  all<T>(sql: string, ...binds: unknown[]) {
    return this.db.prepare(sql).bind(...binds).all<T>();
  }

  async audit(actorUserId: number | null, actorStaffId: number | null, action: string, entityType: string, entityId: number | null, metadata?: Record<string, unknown>) {
    await this.run(
      "INSERT INTO audit_logs (actor_user_id, actor_staff_id, action, entity_type, entity_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?)",
      actorUserId,
      actorStaffId,
      action,
      entityType,
      entityId,
      metadata ? JSON.stringify(metadata) : null
    );
  }

  async allocateResidentCode() {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const sequence = await this.first<{ prefix: string; next_value: number; padding: number }>(
        "SELECT prefix, next_value, padding FROM resident_code_sequence WHERE id = 1"
      );
      if (!sequence) throw new Error("Resident code sequence is not initialized");

      const code = `${sequence.prefix}-${String(sequence.next_value).padStart(sequence.padding, "0")}`;
      const result = await this.run(
        "UPDATE resident_code_sequence SET next_value = next_value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 1 AND next_value = ?",
        sequence.next_value
      );
      if ((result.meta.changes ?? 0) === 1) return code;
    }

    throw new Error("Unable to allocate resident code");
  }

  async allocateBookingNumber() {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const sequence = await this.first<{ prefix: string; next_value: number; padding: number }>(
        "SELECT prefix, next_value, padding FROM booking_number_sequence WHERE id = 1"
      );
      if (!sequence) throw new Error("Booking number sequence is not initialized");

      const code = `${sequence.prefix}-${String(sequence.next_value).padStart(sequence.padding, "0")}`;
      const result = await this.run(
        "UPDATE booking_number_sequence SET next_value = next_value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 1 AND next_value = ?",
        sequence.next_value
      );
      if ((result.meta.changes ?? 0) === 1) return code;
    }

    throw new Error("Unable to allocate booking number");
  }

  private async allocateSequence(table: string) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const sequence = await this.first<{ prefix: string; next_value: number; padding: number }>(
        `SELECT prefix, next_value, padding FROM ${table} WHERE id = 1`
      );
      if (!sequence) throw new Error(`${table} is not initialized`);
      const code = `${sequence.prefix}-${String(sequence.next_value).padStart(sequence.padding, "0")}`;
      const result = await this.run(
        `UPDATE ${table} SET next_value = next_value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 1 AND next_value = ?`,
        sequence.next_value
      );
      if ((result.meta.changes ?? 0) === 1) return code;
    }
    throw new Error(`Unable to allocate ${table}`);
  }

  allocatePaymentReference() {
    return this.allocateSequence("payment_reference_sequence");
  }

  allocateReceiptNumber() {
    return this.allocateSequence("receipt_number_sequence");
  }

  allocateApplicationNumber() {
    return this.allocateSequence("application_number_sequence");
  }

  allocateMaintenanceRequestNumber() {
    return this.allocateSequence("maintenance_request_sequence");
  }
}
