import { describe, expect, it, beforeEach } from "vitest";
import type { AuthUser } from "../auth/context";
import { hasPermission } from "../auth/permissions";
import {
  generateHotspotPassword,
  InternetAccessService,
  routerUsernameFromResidentCode
} from "./internet-access.service";
import {
  ConnectorUnavailableError,
  MikroTikConnectorClient
} from "./mikrotik-connector.client";
import { publicErrorMessage } from "../http/safe-error";

type Row = Record<string, unknown>;

class FakeRepo {
  accounts: Row[] = [];
  residents: Row[] = [{ id: 1, resident_code: "KSM-RES-0025", first_name: "Ama", last_name: "Resident" }];
  allocations: Row[] = [{ id: 10, resident_id: 1, status: "active", bed_id: 1 }];
  beds: Row[] = [{ id: 1, bed_code: "ROOM-101-A", room_id: 1 }];
  rooms: Row[] = [{ id: 1, room_code: "ROOM-101" }];
  sessions = [{ id: 1 }];
  bookings = [{ id: 1 }];
  academic_sessions = [{ id: 1 }];
  audits: string[] = [];
  nextId = 1;

  async first<T>(sql: string, ...binds: unknown[]): Promise<T | null> {
    if (sql.includes("FROM allocations") && sql.includes("a.status = 'active'")) {
      const residentId = binds[0];
      const allocation = this.allocations.find((a) => a.resident_id === residentId && a.status === "active");
      return (allocation ? { id: allocation.id } : null) as T;
    }
    if (sql.includes("FROM residents WHERE id")) {
      return (this.residents.find((r) => r.id === binds[0]) ?? null) as T;
    }
    if (sql.includes("FROM resident_internet_accounts WHERE resident_id")) {
      return (this.accounts.find((a) => a.resident_id === binds[0]) ?? null) as T;
    }
    if (sql.includes("FROM resident_internet_accounts ia") && sql.includes("ia.id = ?")) {
      const account = this.accounts.find((a) => a.id === binds[0]);
      if (!account) return null;
      const resident = this.residents.find((r) => r.id === account.resident_id);
      const allocation = this.allocations.find((a) => a.resident_id === account.resident_id && a.status === "active");
      const bed = this.beds.find((b) => b.id === allocation?.bed_id);
      const room = this.rooms.find((r) => r.id === bed?.room_id);
      return {
        ...account,
        resident_code: resident?.resident_code,
        first_name: resident?.first_name,
        last_name: resident?.last_name,
        room_code: room?.room_code ?? null,
        bed_code: bed?.bed_code ?? null
      } as T;
    }
    return null;
  }

  async all<T>(sql: string, ...binds: unknown[]) {
    const limit = Number(binds[binds.length - 2] ?? 50);
    const offset = Number(binds[binds.length - 1] ?? 0);
    const rows = this.accounts.slice(offset, offset + limit).map((account) => {
      const resident = this.residents.find((r) => r.id === account.resident_id);
      return { ...account, resident_code: resident?.resident_code, first_name: resident?.first_name, last_name: resident?.last_name };
    });
    return { results: rows as T[] };
  }

  async run(sql: string, ...binds: unknown[]) {
    if (sql.startsWith("INSERT INTO resident_internet_accounts")) {
      const row = {
        id: this.nextId++,
        resident_id: binds[0],
        router_username: binds[1],
        router_profile: binds[2],
        status: "active",
        sync_status: "pending",
        last_synced_at: null,
        last_sync_error: null,
        created_at: "2026-09-14T00:00:00.000Z",
        updated_at: "2026-09-14T00:00:00.000Z",
        created_by_staff_id: binds[3],
        updated_by_staff_id: binds[4]
      };
      this.accounts.push(row);
      return { meta: { last_row_id: row.id, changes: 1 } };
    }
    if (sql.startsWith("UPDATE resident_internet_accounts")) {
      const id = binds[binds.length - 1] as number;
      const account = this.accounts.find((a) => a.id === id);
      if (!account) return { meta: { changes: 0 } };
      if (sql.includes("SET status = ?")) {
        account.status = binds[0];
        account.sync_status = binds[1];
        account.last_sync_error = binds[2];
        if (binds[3]) account.last_synced_at = binds[3];
        account.updated_by_staff_id = binds[4];
      } else {
        account.sync_status = binds[0];
        account.last_sync_error = binds[1];
        if (binds[2]) account.last_synced_at = binds[2];
        account.updated_by_staff_id = binds[3];
      }
      return { meta: { changes: 1 } };
    }
    return { meta: { changes: 0 } };
  }

  async audit(_u: number | null, _s: number | null, action: string) {
    this.audits.push(action);
  }
}

function staff(): AuthUser {
  return {
    id: 9,
    userType: "staff",
    displayName: "Manager",
    email: "manager@kissmetgroup.org",
    role: "manager",
    staffId: 2,
    residentId: null,
    sessionId: 1
  };
}

class FakeConnector {
  users = new Map<string, { name: string; profile: string; disabled: boolean }>();
  passwords = new Map<string, string>();
  sessions = new Map<string, unknown[]>();
  unavailable = false;
  profileSharedUsers = 3;
  configured = true;

  private guard() {
    if (this.unavailable) throw new ConnectorUnavailableError("Internet connector unavailable");
  }

  async health() {
    this.guard();
    return { ok: true as const, board: "hAP", version: "7.x" };
  }

  async ensureResidentProfile() {
    this.guard();
    if (this.profileSharedUsers !== 3) throw new Error("Internet profile conflict");
    return { profile: { name: "Kissmet-Residents", sharedUsers: 3 }, created: false };
  }

  async getUser(username: string) {
    this.guard();
    const user = this.users.get(username);
    if (!user) throw new Error("HotSpot user not found");
    return { id: "*1", ...user };
  }

  async createUser(input: { username: string; password: string }) {
    this.guard();
    const existing = this.users.get(input.username);
    if (existing) return { user: { id: "*1", ...existing }, created: false };
    const user = { name: input.username, profile: "Kissmet-Residents", disabled: false };
    this.users.set(input.username, user);
    this.passwords.set(input.username, input.password);
    return { user: { id: "*1", ...user }, created: true };
  }

  async disableUser(username: string) {
    this.guard();
    const user = this.users.get(username);
    if (!user) throw new Error("HotSpot user not found");
    user.disabled = true;
    return { id: "*1", ...user };
  }

  async enableUser(username: string) {
    this.guard();
    const user = this.users.get(username);
    if (!user) throw new Error("HotSpot user not found");
    user.disabled = false;
    return { id: "*1", ...user };
  }

  async resetUserPassword(username: string, password: string) {
    this.guard();
    if (!this.users.has(username)) throw new Error("HotSpot user not found");
    this.passwords.set(username, password);
    return { id: "*1", ...this.users.get(username)! };
  }

  async disconnectSessions(username: string) {
    this.guard();
    const current = this.sessions.get(username) ?? [];
    this.sessions.set(username, []);
    return { disconnected: current.length };
  }

  async listActiveSessions(username: string) {
    this.guard();
    return this.sessions.get(username) ?? [];
  }
}

describe("internet username + password helpers", () => {
  it("maps resident_code stably", () => {
    expect(routerUsernameFromResidentCode("ksm-res-0025")).toBe("KSM-RES-0025");
    expect(() => routerUsernameFromResidentCode("BAD")).toThrow(/Invalid resident code/);
  });

  it("generates strong one-time passwords", () => {
    const a = generateHotspotPassword();
    const b = generateHotspotPassword();
    expect(a.length).toBeGreaterThanOrEqual(16);
    expect(a).not.toBe(b);
  });
});

describe("InternetAccessService", () => {
  let repo: FakeRepo;
  let connector: FakeConnector;
  let svc: InternetAccessService;
  const actor = staff();

  beforeEach(() => {
    repo = new FakeRepo();
    connector = new FakeConnector();
    svc = new InternetAccessService(repo as never, connector as never);
  });

  it("requires active allocation for provision", async () => {
    repo.allocations = [];
    await expect(svc.provision(actor, 1)).rejects.toThrow(/active room\/bed allocation/);
  });

  it("provisions idempotently and returns password once", async () => {
    const first = await svc.provision(actor, 1) as unknown as Row;
    expect(first.router_username).toBe("KSM-RES-0025");
    expect(first.sync_status).toBe("synced");
    expect(typeof first.password).toBe("string");
    expect(repo.audits).toContain("internet.provision");

    const second = await svc.provision(actor, 1) as unknown as Row;
    expect(second.password).toBeUndefined();
    expect(repo.accounts).toHaveLength(1);
  });

  it("marks sync_failed when connector unavailable", async () => {
    connector.unavailable = true;
    const row = await svc.provision(actor, 1) as unknown as Row;
    expect(row.sync_status).toBe("failed");
    expect(row.provision_error).toMatch(/connector/i);
    expect(JSON.stringify(row)).not.toMatch(/Bearer|MIKROTIK|password=|192\.168\.88/);
  });

  it("suspend disables and disconnects; idempotent when already suspended", async () => {
    await svc.provision(actor, 1);
    connector.sessions.set("KSM-RES-0025", [{ id: "*1" }, { id: "*2" }]);
    const suspended = await svc.suspend(actor, 1) as unknown as Row;
    expect(suspended.status).toBe("suspended");
    expect(connector.users.get("KSM-RES-0025")?.disabled).toBe(true);
    expect(connector.sessions.get("KSM-RES-0025")).toEqual([]);
    expect(repo.audits).toContain("internet.suspend");

    const again = await svc.suspend(actor, 1) as unknown as Row;
    expect(again.status).toBe("suspended");
  });

  it("enable is idempotent when already active/synced", async () => {
    await svc.provision(actor, 1);
    const enabled = await svc.enable(actor, 1) as unknown as Row;
    expect(enabled.status).toBe("active");
    expect(repo.audits).toContain("internet.enable");
  });

  it("reset-password is explicit and returns password once", async () => {
    await svc.provision(actor, 1);
    const reset = await svc.resetPassword(actor, 1) as unknown as Row;
    expect(typeof reset.password).toBe("string");
    expect(repo.audits).toContain("internet.password_reset");
    expect(JSON.stringify(repo.accounts[0])).not.toContain(String(reset.password));
  });

  it("disconnect treats empty sessions as success", async () => {
    await svc.provision(actor, 1);
    const result = await svc.disconnect(actor, 1);
    expect(result.disconnected).toBe(0);
    expect(repo.audits).toContain("internet.disconnect_sessions");
  });

  it("retry-sync recovers failed state", async () => {
    connector.unavailable = true;
    await svc.provision(actor, 1);
    expect(repo.accounts[0].sync_status).toBe("failed");
    connector.unavailable = false;
    // user was never created; retry recreates
    const retried = await svc.retrySync(actor, 1) as unknown as Row;
    expect(retried.sync_status).toBe("synced");
    expect(repo.audits).toContain("internet.sync_retry");
  });

  it("RBAC grants manager internet permissions and not resident", () => {
    expect(hasPermission("manager", "internet:read")).toBe(true);
    expect(hasPermission("manager", "internet:manage")).toBe(true);
    expect(hasPermission("super_admin", "internet:manage")).toBe(true);
    expect(hasPermission("reception", "internet:manage")).toBe(false);
    expect(hasPermission("resident", "internet:manage")).toBe(false);
  });

  it("redacts unsafe connector errors", () => {
    expect(publicErrorMessage(new Error("Authorization Bearer super-secret failed"))).toBe("Request failed");
    expect(publicErrorMessage(new Error("Internet account not found"))).toBe("Internet account not found");
    expect(publicErrorMessage(new Error("Resident must have an active room/bed allocation"))).toBe(
      "Resident must have an active room/bed allocation"
    );
  });
});

describe("MikroTikConnectorClient config", () => {
  it("fails safely when URL/secret missing", async () => {
    const client = new MikroTikConnectorClient(undefined, undefined);
    expect(client.configured).toBe(false);
    await expect(client.createUser({ username: "x", password: "y" })).rejects.toBeInstanceOf(ConnectorUnavailableError);
  });

  it("sends bearer auth to connector", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true, data: { disconnected: 0 } }), { status: 200 });
    }) as typeof fetch;
    const client = new MikroTikConnectorClient("https://connector.example", "sec", fetchImpl);
    await client.disconnectSessions("KSM-RES-0025");
    expect(calls).toHaveLength(1);
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer sec");
  });
});

describe("InternetAccessService Phase 1 ops", () => {
  let repo: FakeRepo;
  let connector: FakeConnector;
  let svc: InternetAccessService;
  const actor = staff();

  beforeEach(() => {
    repo = new FakeRepo();
    connector = new FakeConnector();
    svc = new InternetAccessService(repo as never, connector as never);
  });

  it("lists with status and sync_status filters", async () => {
    await svc.provision(actor, 1);
    repo.accounts.push({
      id: 2,
      resident_id: 1,
      router_username: "KSM-RES-0099",
      router_profile: "Kissmet-Residents",
      status: "suspended",
      sync_status: "failed",
      last_synced_at: null,
      last_sync_error: "down",
      created_at: "2026-09-14T00:00:00.000Z",
      updated_at: "2026-09-14T00:00:00.000Z",
      created_by_staff_id: 2,
      updated_by_staff_id: 2
    });

    const originalAll = repo.all.bind(repo);
    repo.all = (async (sql: string, ...binds: unknown[]) => {
      if (sql.includes("ia.status = ?") && sql.includes("ia.sync_status = ?")) {
        const status = binds[0];
        const sync = binds[1];
        const rows = repo.accounts.filter((a) => a.status === status && a.sync_status === sync);
        return { results: rows };
      }
      if (sql.includes("ia.status = ?")) {
        return { results: repo.accounts.filter((a) => a.status === binds[0]) };
      }
      if (sql.includes("ia.sync_status = ?")) {
        return { results: repo.accounts.filter((a) => a.sync_status === binds[0]) };
      }
      return originalAll(sql, ...binds);
    }) as typeof repo.all;

    const filtered = await svc.list(25, 0, { status: "suspended", syncStatus: "failed" }) as unknown as { results: Row[] };
    expect(filtered.results).toHaveLength(1);
    expect(filtered.results[0].status).toBe("suspended");
  });

  it("returns summary counts from D1", async () => {
    await svc.provision(actor, 1);
    const originalFirst = repo.first.bind(repo);
    repo.first = (async <T>(sql: string, ...binds: unknown[]) => {
      if (sql.includes("COUNT(*) FROM resident_internet_accounts")) {
        return {
          total: repo.accounts.length,
          active: repo.accounts.filter((a) => a.status === "active").length,
          suspended: repo.accounts.filter((a) => a.status === "suspended").length,
          sync_failed: repo.accounts.filter((a) => a.sync_status === "failed").length,
          pending: repo.accounts.filter((a) => a.sync_status === "pending").length
        } as T;
      }
      return originalFirst<T>(sql, ...binds);
    }) as typeof repo.first;
    const summary = await svc.summary();
    expect(summary.total).toBe(1);
    expect(summary.active).toBe(1);
    expect(summary.sync_failed).toBe(0);
  });

  it("searches eligible residents with active allocation", async () => {
    const originalAll = repo.all.bind(repo);
    repo.all = (async (sql: string, ...binds: unknown[]) => {
      if (sql.includes("already_provisioned") || sql.includes("JOIN allocations a")) {
        const residents = repo.residents.filter((r) =>
          repo.allocations.some((a) => a.resident_id === r.id && a.status === "active")
        );
        return {
          results: residents.map((r) => {
            const allocation = repo.allocations.find((a) => a.resident_id === r.id && a.status === "active");
            const bed = repo.beds.find((b) => b.id === allocation?.bed_id);
            const room = repo.rooms.find((roomRow) => roomRow.id === bed?.room_id);
            const account = repo.accounts.find((a) => a.resident_id === r.id);
            return {
              id: r.id,
              resident_code: r.resident_code,
              first_name: r.first_name,
              last_name: r.last_name,
              room_code: room?.room_code ?? null,
              bed_code: bed?.bed_code ?? null,
              internet_account_id: account?.id ?? null,
              internet_status: account?.status ?? null,
              internet_sync_status: account?.sync_status ?? null,
              already_provisioned: account ? 1 : 0
            };
          })
        };
      }
      return originalAll(sql, ...binds);
    }) as typeof repo.all;

    const result = await svc.searchEligibleResidents(25, 0, "Ama") as unknown as { results: Row[] };
    expect(result.results).toHaveLength(1);
    expect(result.results[0].resident_code).toBe("KSM-RES-0025");
    expect(result.results[0].already_provisioned).toBe(0);
  });

  it("reports connector health without blocking", async () => {
    const healthy = await svc.connectorHealth();
    expect(healthy.ok).toBe(true);
    expect(healthy.configured).toBe(true);

    connector.unavailable = true;
    const down = await svc.connectorHealth();
    expect(down.ok).toBe(false);
    expect(down.configured).toBe(true);

    connector.configured = false;
    connector.unavailable = false;
    const unconfigured = await svc.connectorHealth();
    expect(unconfigured.ok).toBe(false);
    expect(unconfigured.configured).toBe(false);
  });

  it("ensure-profile audits staff action", async () => {
    const result = await svc.ensureProfile(actor);
    expect(result.profile.sharedUsers).toBe(3);
    expect(repo.audits).toContain("internet.ensure_profile");
  });

  it("ensure-profile fails safely when connector down", async () => {
    connector.unavailable = true;
    await expect(svc.ensureProfile(actor)).rejects.toThrow(/connector/i);
    expect(repo.audits).toContain("internet.ensure_profile");
  });
});
