import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { AdminService } from "./admin.service";
import { requirePermission } from "../middleware/auth.middleware";
import type { AuthUser } from "../auth/context";

const manager: AuthUser = { id: 1, userType: "staff", displayName: "Manager", email: "m@test", role: "manager", staffId: 1, residentId: null, sessionId: 1 };
const superAdmin: AuthUser = { ...manager, role: "super_admin", id: 2, staffId: 2 };
const reception: AuthUser = { ...manager, role: "reception", id: 3, staffId: 3 };
const accounts: AuthUser = { ...manager, role: "accounts", id: 4, staffId: 4 };
const maintenance: AuthUser = { ...manager, role: "maintenance", id: 5, staffId: 5 };

type BedRow = { id: number; room_id: number; bed_code: string; label: string; status: string; archived_at?: string | null };
type AllocRow = { id: number; bed_id: number; status: string; booking_id?: number };
type RoomRow = { id: number; room_code: string; capacity: number; status?: string };
type BookingRow = { id: number; status: string; total_amount_minor: number };
type RateCardRow = { id: number; lease_period_id: number; occupancy_capacity: number; amount_minor: number; status: string };

class CapacityFakeRepo {
  rooms: RoomRow[] = [{ id: 1, room_code: "R1", capacity: 4, status: "available" }];
  beds: BedRow[] = [];
  allocations: AllocRow[] = [];
  bookings: BookingRow[] = [{ id: 1, status: "pending", total_amount_minor: 900000 }];
  rate_cards: RateCardRow[] = [{ id: 1, lease_period_id: 1, occupancy_capacity: 4, amount_minor: 900000, status: "active" }];
  audits: Array<{ action: string; metadata?: Record<string, unknown> }> = [];
  nextBedId = 1;
  nextAllocId = 1;

  async list() { return { results: [] }; }
  async get(table: string, id: number) {
    if (table === "rooms") return this.rooms.find((r) => r.id === id) ?? null;
    if (table === "beds") return this.beds.find((b) => b.id === id) ?? null;
    if (table === "bookings") return this.bookings.find((b) => b.id === id) ?? null;
    if (table === "rate_cards") return this.rate_cards.find((r) => r.id === id) ?? null;
    return null;
  }

  async first<T>(sql: string, ...binds: unknown[]): Promise<T | null> {
    if (sql.includes("SELECT id, room_code, capacity, status FROM rooms")) {
      return (this.rooms.find((r) => r.id === binds[0]) ?? null) as T | null;
    }
    if (sql.includes("SELECT id, room_id, status FROM beds WHERE id")) {
      return (this.beds.find((b) => b.id === binds[0]) ?? null) as T | null;
    }
    if (sql.includes("COUNT(*) AS count") && sql.includes("allocations a") && sql.includes("JOIN beds b")) {
      return { count: this.allocations.filter((a) => {
        const bed = this.beds.find((b) => b.id === a.bed_id);
        return bed?.room_id === binds[0] && a.status === "active";
      }).length } as T;
    }
    if (sql.includes("usable_bed_count") || (sql.includes("non_archived_bed_count") && sql.includes("FROM rooms r"))) {
      const room = this.rooms.find((r) => r.id === binds[0]);
      if (!room) return null;
      const roomBeds = this.beds.filter((b) => b.room_id === room.id);
      const usable = roomBeds.filter((b) => b.status === "available").length;
      const nonArchived = roomBeds.filter((b) => b.status !== "archived").length;
      const retired = roomBeds.filter((b) => b.status === "archived").length;
      const occupied = this.allocations.filter((a) => {
        const bed = this.beds.find((b) => b.id === a.bed_id);
        return bed?.room_id === room.id && a.status === "active";
      }).length;
      return {
        capacity: room.capacity,
        usable_bed_count: usable,
        non_archived_bed_count: nonArchived,
        retired_bed_count: retired,
        active_occupancy: occupied
      } as T;
    }
    if (sql.includes("capacity") && sql.includes("active_beds")) {
      const room = this.rooms.find((r) => r.id === binds[0]);
      if (!room) return null;
      return {
        capacity: room.capacity,
        active_beds: this.beds.filter((b) => b.room_id === room.id && b.status !== "archived").length
      } as T;
    }
    if (sql.includes("FROM allocations WHERE bed_id")) {
      return (this.allocations.find((a) => a.bed_id === binds[0] && a.status === "active") ?? null) as T | null;
    }
    if (sql.includes("FROM allocations a") && sql.includes("JOIN beds b") && sql.includes("LIMIT 1")) {
      return (this.allocations.find((allocation) => {
        const bed = this.beds.find((item) => item.id === allocation.bed_id);
        return bed?.room_id === binds[0] && allocation.status === "active";
      }) ?? null) as T | null;
    }
    if (sql.includes("FROM rooms r WHERE r.id") || sql.includes("FROM rooms r WHERE")) {
      const room = this.rooms.find((r) => r.id === binds[0]);
      if (!room) return null;
      const usable = this.beds.filter((b) => b.room_id === room.id && b.status === "available").length;
      const occupied = this.allocations.filter((a) => {
        const bed = this.beds.find((b) => b.id === a.bed_id);
        return bed?.room_id === room.id && a.status === "active";
      }).length;
      return { ...room, bed_count: usable, active_occupancy: occupied, availability: usable - occupied } as T;
    }
    return null;
  }

  async all<T>(sql: string, ...binds: unknown[]) {
    if (sql.includes("SELECT id, status, label, bed_code FROM beds WHERE room_id")) {
      const rows = this.beds
        .filter((b) => b.room_id === binds[0])
        .sort((a, b) => a.label.localeCompare(b.label) || a.id - b.id);
      return { results: rows as T[] };
    }
    if (sql.includes("SELECT a.bed_id") && sql.includes("allocations a")) {
      const rows = this.allocations
        .filter((a) => {
          const bed = this.beds.find((b) => b.id === a.bed_id);
          return bed?.room_id === binds[0] && a.status === "active";
        })
        .map((a) => ({ bed_id: a.bed_id }));
      return { results: rows as T[] };
    }
    return { results: [] as T[] };
  }

  async run(sql: string, ...binds: unknown[]) {
    if (sql.startsWith("INSERT INTO beds")) {
      const id = this.nextBedId++;
      this.beds.push({ id, room_id: Number(binds[0]), bed_code: String(binds[1]), label: String(binds[2]), status: String(binds[3] ?? "available") });
      return { meta: { last_row_id: id } };
    }
    if (sql.startsWith("UPDATE rooms SET capacity")) {
      const room = this.rooms.find((r) => r.id === binds[1]);
      if (room) room.capacity = Number(binds[0]);
      return { meta: { last_row_id: 0 } };
    }
    if (sql.startsWith("UPDATE beds SET status = 'archived'") || (sql.startsWith("UPDATE beds SET status") && sql.includes("'archived'") && binds.length === 1)) {
      const bed = this.beds.find((b) => b.id === binds[0]);
      if (bed) { bed.status = "archived"; bed.archived_at = bed.archived_at ?? "now"; }
      return { meta: { last_row_id: 0 } };
    }
    if (sql.startsWith("UPDATE beds SET status")) {
      const bed = this.beds.find((b) => b.id === binds[1]);
      if (bed) {
        bed.status = String(binds[0]);
        if (sql.includes("archived_at = NULL")) bed.archived_at = null;
        if (String(binds[0]) === "archived") bed.archived_at = bed.archived_at ?? "now";
      }
      return { meta: { last_row_id: 0 } };
    }
    if (sql.startsWith("INSERT INTO audit_logs")) {
      this.audits.push({ action: String(binds[2]), metadata: binds[5] ? JSON.parse(String(binds[5])) : undefined });
      return { meta: { last_row_id: 0 } };
    }
    return { meta: { last_row_id: 0 } };
  }

  async audit(_u: number, _s: number | null, action: string, _et: string, _eid: number | null, metadata?: Record<string, unknown>) {
    this.audits.push({ action, metadata });
  }

  seedBeds(labels: string[], status = "available") {
    for (const label of labels) {
      const id = this.nextBedId++;
      this.beds.push({ id, room_id: 1, bed_code: `R1-${label}`, label, status });
    }
  }

  occupy(bedIds: number[]) {
    for (const bedId of bedIds) {
      this.allocations.push({ id: this.nextAllocId++, bed_id: bedId, status: "active", booking_id: 1 });
    }
  }
}

function svc(repo = new CapacityFakeRepo()) {
  return { service: new AdminService(repo as never), repo };
}

describe("Stage 2L-E room capacity", () => {
  describe("capacity validation", () => {
    it.each([1, 2, 4])("accepts capacity %s", async (capacity) => {
      const { service, repo } = svc();
      repo.rooms[0].capacity = capacity === 1 ? 2 : 1;
      repo.seedBeds(capacity === 1 ? ["A", "B"] : ["A"]);
      const result = await service.changeRoomCapacity(manager, 1, { capacity, reason: "Reconfigure for season" });
      expect(result.configured_capacity).toBe(capacity);
      expect(repo.rooms[0].capacity).toBe(capacity);
    });

    it.each([0, 3, 5, -1])("rejects capacity %s", async (capacity) => {
      const { service, repo } = svc();
      const before = JSON.stringify(repo.rooms);
      await expect(service.changeRoomCapacity(manager, 1, { capacity, reason: "bad" })).rejects.toThrow("Invalid room capacity: only 1, 2, or 4 are supported");
      expect(JSON.stringify(repo.rooms)).toBe(before);
      expect(repo.audits.some((a) => a.action === "admin.room.capacity_change")).toBe(false);
    });

    it("rejects non-integer capacity", async () => {
      const { service } = svc();
      await expect(service.changeRoomCapacity(manager, 1, { capacity: 2.5 as never, reason: "bad" })).rejects.toThrow("Invalid room capacity");
    });

    it("requires a non-empty reason", async () => {
      const { service, repo } = svc();
      await expect(service.changeRoomCapacity(manager, 1, { capacity: 2, reason: "   " })).rejects.toThrow("A management reason is required");
      expect(repo.audits.some((a) => a.action === "admin.room.capacity_change")).toBe(false);
    });
  });

  describe("capacity reduction", () => {
    it("rejects 4→2 when 3 active allocations exist", async () => {
      const { service, repo } = svc();
      repo.seedBeds(["A", "B", "C", "D"]);
      repo.occupy([1, 2, 3]);
      const bedsBefore = JSON.stringify(repo.beds);
      const allocBefore = JSON.stringify(repo.allocations);
      await expect(service.changeRoomCapacity(manager, 1, { capacity: 2, reason: "too many residents" }))
        .rejects.toThrow("Capacity cannot be reduced to 2 because this room currently has 3 active residents");
      expect(JSON.stringify(repo.beds)).toBe(bedsBefore);
      expect(JSON.stringify(repo.allocations)).toBe(allocBefore);
      expect(repo.rooms[0].capacity).toBe(4);
      expect(repo.audits.some((a) => a.action === "admin.room.capacity_change")).toBe(false);
    });

    it("rejects 4→1 when 2 active allocations exist", async () => {
      const { service, repo } = svc();
      repo.seedBeds(["A", "B", "C", "D"]);
      repo.occupy([1, 2]);
      await expect(service.changeRoomCapacity(manager, 1, { capacity: 1, reason: "downsize" }))
        .rejects.toThrow("Capacity cannot be reduced to 1 because this room currently has 2 active residents");
      expect(repo.rooms[0].capacity).toBe(4);
    });

    it("succeeds 4→2 with 2 active allocations and retires only unallocated excess", async () => {
      const { service, repo } = svc();
      repo.seedBeds(["A", "B", "C", "D"]);
      repo.occupy([1, 2]); // A,B occupied
      const result = await service.changeRoomCapacity(manager, 1, { capacity: 2, reason: "Convert to double occupancy" });
      expect(result.configured_capacity).toBe(2);
      expect(repo.rooms[0].capacity).toBe(2);
      const occupiedBeds = repo.beds.filter((b) => b.id === 1 || b.id === 2);
      expect(occupiedBeds.every((b) => b.status !== "archived")).toBe(true);
      const archived = repo.beds.filter((b) => b.status === "archived");
      expect(archived).toHaveLength(2);
      expect(archived.every((b) => b.id === 3 || b.id === 4)).toBe(true);
      expect(repo.beds).toHaveLength(4); // historical rows remain
      expect(repo.allocations).toHaveLength(2);
      expect(repo.allocations.every((a) => a.status === "active")).toBe(true);
      expect(result.beds_retired).toEqual([3, 4]);
    });

    it("never retires an allocated bed when excess unallocated beds exist", async () => {
      const { service, repo } = svc();
      repo.seedBeds(["A", "B", "C", "D"]);
      repo.occupy([3, 4]); // occupy later labels; earlier unallocated should retire first
      await service.changeRoomCapacity(manager, 1, { capacity: 2, reason: "Prefer retiring free beds" });
      expect(repo.beds.find((b) => b.id === 3)?.status).not.toBe("archived");
      expect(repo.beds.find((b) => b.id === 4)?.status).not.toBe("archived");
      expect(repo.beds.filter((b) => b.status === "archived").map((b) => b.id)).toEqual([1, 2]);
    });

    it("may retire unallocated maintenance beds as excess (maintenance occupies a capacity slot while non-archived)", async () => {
      const { service, repo } = svc();
      repo.seedBeds(["A", "B"]);
      repo.beds.push({ id: repo.nextBedId++, room_id: 1, bed_code: "R1-C", label: "C", status: "maintenance" });
      repo.beds.push({ id: repo.nextBedId++, room_id: 1, bed_code: "R1-D", label: "D", status: "available" });
      repo.occupy([1]); // one active
      await service.changeRoomCapacity(manager, 1, { capacity: 2, reason: "Shrink with maintenance present" });
      expect(repo.rooms[0].capacity).toBe(2);
      expect(repo.beds.find((b) => b.id === 1)?.status).not.toBe("archived");
      // excess 2 retired: prefer available (B, then D) before maintenance (C)
      expect(repo.beds.find((b) => b.id === 2)?.status).toBe("archived");
      expect(repo.beds.find((b) => b.id === 4)?.status).toBe("archived");
      expect(repo.beds.find((b) => b.id === 3)?.status).toBe("maintenance");
    });
  });

  describe("capacity increase", () => {
    it("succeeds 1→2 and 2→4 without fabricating allocations or auto-creating beds", async () => {
      const { service, repo } = svc();
      repo.rooms[0].capacity = 1;
      repo.seedBeds(["A"]);
      const oneToTwo = await service.changeRoomCapacity(manager, 1, { capacity: 2, reason: "Expand to double" });
      expect(oneToTwo.configured_capacity).toBe(2);
      expect(oneToTwo.setup_needed).toBe(1);
      expect(repo.beds).toHaveLength(1);
      expect(repo.allocations).toHaveLength(0);

      const twoToFour = await service.changeRoomCapacity(manager, 1, { capacity: 4, reason: "Expand to quad" });
      expect(twoToFour.configured_capacity).toBe(4);
      expect(twoToFour.setup_needed).toBe(3);
      expect(repo.beds).toHaveLength(1);
      expect(repo.allocations).toHaveLength(0);
    });

    it("allows createBed up to new capacity and rejects beyond", async () => {
      const { service, repo } = svc();
      repo.rooms[0].capacity = 1;
      repo.seedBeds(["A"]);
      await service.changeRoomCapacity(manager, 1, { capacity: 2, reason: "Expand" });
      await service.createBed(manager, { roomId: 1, bedCode: "R1-B", label: "B" });
      await expect(service.createBed(manager, { roomId: 1, bedCode: "R1-C", label: "C" })).rejects.toThrow("Room capacity exceeded");
    });

    it("allows safe reactivation of archived beds after increase, blocked while at capacity", async () => {
      const { service, repo } = svc();
      repo.seedBeds(["A", "B", "C", "D"]);
      await service.changeRoomCapacity(manager, 1, { capacity: 2, reason: "Downsize first" });
      const archived = repo.beds.filter((b) => b.status === "archived");
      expect(archived.length).toBe(2);

      await expect(service.updateStatus(manager, "beds", archived[0].id, "available")).rejects.toThrow("Room capacity exceeded");

      await service.changeRoomCapacity(manager, 1, { capacity: 4, reason: "Restore quad" });
      await service.updateStatus(manager, "beds", archived[0].id, "available");
      expect(repo.beds.find((b) => b.id === archived[0].id)?.status).toBe("available");
      expect(repo.allocations).toHaveLength(0);
    });
  });

  describe("rate/agreement safety", () => {
    it("does not mutate rate_cards or historical booking totals", async () => {
      const { service, repo } = svc();
      repo.seedBeds(["A", "B", "C", "D"]);
      const ratesBefore = JSON.stringify(repo.rate_cards);
      const bookingsBefore = JSON.stringify(repo.bookings);
      await service.changeRoomCapacity(manager, 1, { capacity: 2, reason: "No reprice" });
      expect(JSON.stringify(repo.rate_cards)).toBe(ratesBefore);
      expect(JSON.stringify(repo.bookings)).toBe(bookingsBefore);
      expect(repo.bookings[0].total_amount_minor).toBe(900000);
    });
  });

  describe("audit", () => {
    it("audits successful change with old/new capacity and reason", async () => {
      const { service, repo } = svc();
      repo.seedBeds(["A", "B", "C", "D"]);
      await service.changeRoomCapacity(manager, 1, { capacity: 2, reason: "Seasonal reconfiguration" });
      const event = repo.audits.find((a) => a.action === "admin.room.capacity_change");
      expect(event).toBeTruthy();
      expect(event?.metadata?.old_capacity).toBe(4);
      expect(event?.metadata?.new_capacity).toBe(2);
      expect(event?.metadata?.reason).toBe("Seasonal reconfiguration");
      expect(Array.isArray(event?.metadata?.beds_retired)).toBe(true);
    });

    it("does not write success audit on failed change", async () => {
      const { service, repo } = svc();
      repo.seedBeds(["A", "B", "C"]);
      repo.occupy([1, 2, 3]);
      await expect(service.changeRoomCapacity(manager, 1, { capacity: 2, reason: "fail" })).rejects.toThrow();
      expect(repo.audits.some((a) => a.action === "admin.room.capacity_change")).toBe(false);
    });
  });

  describe("RBAC", () => {
    it("allows Super Admin and Manager via admin:write; rejects Reception/Accounts/Maintenance", async () => {
      async function statusFor(user: AuthUser) {
        const gated = new Hono<{ Variables: { authUser: AuthUser } }>();
        gated.use("*", async (c, next) => {
          c.set("authUser", user);
          await next();
        });
        gated.patch("/rooms/:id/capacity", requirePermission("admin:write"), (c) => c.json({ ok: true }));
        return (await gated.request("/rooms/1/capacity", { method: "PATCH" })).status;
      }
      expect(await statusFor(superAdmin)).toBe(200);
      expect(await statusFor(manager)).toBe(200);
      expect(await statusFor(reception)).toBe(403);
      expect(await statusFor(accounts)).toBe(403);
      expect(await statusFor(maintenance)).toBe(403);
    });
  });

  describe("createRoom capacity band", () => {
    it("rejects unsupported createRoom capacities", async () => {
      const { service } = svc();
      await expect(service.createRoom(manager, { roomCode: "RX", capacity: 3 })).rejects.toThrow("Invalid room capacity");
    });
  });
});
