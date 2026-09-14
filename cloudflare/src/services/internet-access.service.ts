import type { AuthUser } from "../auth/context";
import type { AdminRepository } from "../repositories/admin.repository";
import {
  ConnectorUnavailableError,
  MikroTikConnectorClient
} from "./mikrotik-connector.client";

export const INTERNET_PROFILE = "Kissmet-Residents";

export type InternetStatus = "active" | "suspended" | "disabled";
export type SyncStatus = "pending" | "synced" | "failed";

export interface InternetAccountRow {
  id: number;
  resident_id: number;
  router_username: string;
  router_profile: string;
  status: InternetStatus;
  sync_status: SyncStatus;
  last_synced_at: string | null;
  last_sync_error: string | null;
  created_at: string;
  updated_at: string;
  created_by_staff_id: number | null;
  updated_by_staff_id: number | null;
  resident_code?: string;
  first_name?: string;
  last_name?: string;
  room_code?: string | null;
  bed_code?: string | null;
}

function nowIso() {
  return new Date().toISOString();
}

/** Stable RouterOS username from Kissmet resident_code (e.g. KSM-RES-0025). */
export function routerUsernameFromResidentCode(residentCode: string): string {
  const normalized = residentCode.trim().toUpperCase();
  if (!/^KSM-RES-[A-Z0-9]+$/.test(normalized)) {
    throw new Error("Invalid resident code for internet username mapping");
  }
  return normalized;
}

export function generateHotspotPassword(bytes = 18): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let out = "";
  for (const b of buf) out += alphabet[b % alphabet.length];
  return out;
}

export class InternetAccessService {
  constructor(
    private readonly repo: AdminRepository,
    private readonly connector: MikroTikConnectorClient
  ) {}

  /** Same active-allocation authority as resident My Room. */
  async hasActiveAllocation(residentId: number): Promise<boolean> {
    const row = await this.repo.first<{ id: number }>(
      `SELECT a.id
       FROM allocations a
       JOIN beds b ON b.id = a.bed_id
       JOIN rooms room ON room.id = b.room_id
       JOIN academic_sessions s ON s.id = a.academic_session_id
       JOIN bookings bk ON bk.id = a.booking_id
       WHERE a.resident_id = ? AND a.status = 'active'
       ORDER BY a.id DESC
       LIMIT 1`,
      residentId
    );
    return Boolean(row);
  }

  private listSelect(where = "1=1") {
    return `
      SELECT ia.*,
             r.resident_code, r.first_name, r.last_name,
             room.room_code, bed.bed_code
      FROM resident_internet_accounts ia
      JOIN residents r ON r.id = ia.resident_id
      LEFT JOIN allocations a ON a.resident_id = r.id AND a.status = 'active'
      LEFT JOIN beds bed ON bed.id = a.bed_id
      LEFT JOIN rooms room ON room.id = bed.room_id
      WHERE ${where}
      ORDER BY ia.id DESC
    `;
  }

  async list(limit: number, offset: number, search?: string) {
    if (search) {
      const like = `%${search}%`;
      return this.repo.all(
        `${this.listSelect("r.resident_code LIKE ? OR r.first_name LIKE ? OR r.last_name LIKE ? OR ia.router_username LIKE ?")} LIMIT ? OFFSET ?`,
        like, like, like, like, limit, offset
      );
    }
    return this.repo.all(`${this.listSelect()} LIMIT ? OFFSET ?`, limit, offset);
  }

  async get(id: number) {
    return this.repo.first<InternetAccountRow>(`${this.listSelect("ia.id = ?")} LIMIT 1`, id);
  }

  private async getByResident(residentId: number) {
    return this.repo.first<InternetAccountRow>(
      "SELECT * FROM resident_internet_accounts WHERE resident_id = ?",
      residentId
    );
  }

  private async markSync(
    id: number,
    staffId: number | null,
    syncStatus: SyncStatus,
    error: string | null,
    status?: InternetStatus
  ) {
    const syncedAt = syncStatus === "synced" ? nowIso() : null;
    if (status) {
      await this.repo.run(
        `UPDATE resident_internet_accounts
         SET status = ?, sync_status = ?, last_sync_error = ?, last_synced_at = COALESCE(?, last_synced_at),
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_by_staff_id = ?
         WHERE id = ?`,
        status, syncStatus, error, syncedAt, staffId, id
      );
    } else {
      await this.repo.run(
        `UPDATE resident_internet_accounts
         SET sync_status = ?, last_sync_error = ?, last_synced_at = COALESCE(?, last_synced_at),
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_by_staff_id = ?
         WHERE id = ?`,
        syncStatus, error, syncedAt, staffId, id
      );
    }
  }

  private async safeConnector<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
    try {
      return { ok: true, value: await fn() };
    } catch (e) {
      if (e instanceof ConnectorUnavailableError) {
        return { ok: false, error: e.message };
      }
      const message = e instanceof Error ? e.message : "Internet connector request failed";
      // Never leak secrets / URLs into persisted sync errors
      const safe = /secret|password|authorization|192\.168\.|http/i.test(message)
        ? "Internet connector request failed"
        : message.slice(0, 240);
      return { ok: false, error: safe };
    }
  }

  async provision(actor: AuthUser, residentId: number) {
    if (!actor.staffId) throw new Error("Staff session required");

    const resident = await this.repo.first<{ id: number; resident_code: string }>(
      "SELECT id, resident_code FROM residents WHERE id = ?",
      residentId
    );
    if (!resident) throw new Error("Resident not found");

    if (!(await this.hasActiveAllocation(residentId))) {
      throw new Error("Resident must have an active room/bed allocation");
    }

    const existing = await this.getByResident(residentId);
    if (existing && existing.sync_status === "synced" && existing.status === "active") {
      await this.repo.audit(actor.id, actor.staffId, "internet.provision", "resident_internet_account", existing.id, {
        outcome: "idempotent",
        residentId
      });
      return this.get(existing.id);
    }

    const username = routerUsernameFromResidentCode(resident.resident_code);
    let accountId = existing?.id;

    if (!existing) {
      const insert = await this.repo.run(
        `INSERT INTO resident_internet_accounts
          (resident_id, router_username, router_profile, status, sync_status, created_by_staff_id, updated_by_staff_id)
         VALUES (?, ?, ?, 'active', 'pending', ?, ?)`,
        residentId, username, INTERNET_PROFILE, actor.staffId, actor.staffId
      );
      accountId = Number(insert.meta.last_row_id);
    } else {
      await this.markSync(existing.id, actor.staffId, "pending", null, "active");
      accountId = existing.id;
    }

    const password = generateHotspotPassword();
    const result = await this.safeConnector(() =>
      this.connector.createUser({
        username,
        password,
        comment: `Kissmet ${resident.resident_code}`
      })
    );

    if (!result.ok) {
      await this.markSync(accountId!, actor.staffId, "failed", result.error, "active");
      await this.repo.audit(actor.id, actor.staffId, "internet.provision", "resident_internet_account", accountId!, {
        outcome: "failed",
        residentId
      });
      const account = await this.get(accountId!);
      return { ...account, password: undefined, provision_error: result.error };
    }

    await this.markSync(accountId!, actor.staffId, "synced", null, "active");
    await this.repo.audit(actor.id, actor.staffId, "internet.provision", "resident_internet_account", accountId!, {
      outcome: "synced",
      residentId,
      created: result.value.created
    });

    const account = await this.get(accountId!);
    // Password shown once to admin; never persisted in D1
    return { ...account, password };
  }

  async enable(actor: AuthUser, id: number) {
    if (!actor.staffId) throw new Error("Staff session required");
    const account = await this.get(id);
    if (!account) throw new Error("Internet account not found");

    if (account.status === "active" && account.sync_status === "synced") {
      await this.repo.audit(actor.id, actor.staffId, "internet.enable", "resident_internet_account", id, { outcome: "idempotent" });
      return account;
    }

    await this.markSync(id, actor.staffId, "pending", null, "active");
    const result = await this.safeConnector(() => this.connector.enableUser(account.router_username));
    if (!result.ok) {
      await this.markSync(id, actor.staffId, "failed", result.error, "active");
      await this.repo.audit(actor.id, actor.staffId, "internet.enable", "resident_internet_account", id, { outcome: "failed" });
      return this.get(id);
    }

    await this.markSync(id, actor.staffId, "synced", null, "active");
    await this.repo.audit(actor.id, actor.staffId, "internet.enable", "resident_internet_account", id, { outcome: "synced" });
    return this.get(id);
  }

  async suspend(actor: AuthUser, id: number) {
    if (!actor.staffId) throw new Error("Staff session required");
    const account = await this.get(id);
    if (!account) throw new Error("Internet account not found");

    if (account.status === "suspended" && account.sync_status === "synced") {
      // Still attempt disconnect as no-op for safety
      await this.safeConnector(() => this.connector.disconnectSessions(account.router_username));
      await this.repo.audit(actor.id, actor.staffId, "internet.suspend", "resident_internet_account", id, { outcome: "idempotent" });
      return account;
    }

    await this.markSync(id, actor.staffId, "pending", null, "suspended");
    const disable = await this.safeConnector(() => this.connector.disableUser(account.router_username));
    const disconnect = await this.safeConnector(() => this.connector.disconnectSessions(account.router_username));

    if (!disable.ok) {
      await this.markSync(id, actor.staffId, "failed", disable.error, "suspended");
      await this.repo.audit(actor.id, actor.staffId, "internet.suspend", "resident_internet_account", id, { outcome: "failed" });
      return this.get(id);
    }

    await this.markSync(id, actor.staffId, "synced", disconnect.ok ? null : disconnect.error, "suspended");
    await this.repo.audit(actor.id, actor.staffId, "internet.suspend", "resident_internet_account", id, {
      outcome: "synced",
      disconnected: disconnect.ok ? disconnect.value.disconnected : 0
    });
    return this.get(id);
  }

  async resetPassword(actor: AuthUser, id: number) {
    if (!actor.staffId) throw new Error("Staff session required");
    const account = await this.get(id);
    if (!account) throw new Error("Internet account not found");

    const password = generateHotspotPassword();
    await this.markSync(id, actor.staffId, "pending", null);
    const result = await this.safeConnector(() =>
      this.connector.resetUserPassword(account.router_username, password)
    );

    if (!result.ok) {
      await this.markSync(id, actor.staffId, "failed", result.error);
      await this.repo.audit(actor.id, actor.staffId, "internet.password_reset", "resident_internet_account", id, {
        outcome: "failed"
      });
      throw new Error("Internet password reset failed");
    }

    await this.markSync(id, actor.staffId, "synced", null);
    await this.repo.audit(actor.id, actor.staffId, "internet.password_reset", "resident_internet_account", id, {
      outcome: "synced"
    });
    const updated = await this.get(id);
    return { ...updated, password };
  }

  async disconnect(actor: AuthUser, id: number) {
    if (!actor.staffId) throw new Error("Staff session required");
    const account = await this.get(id);
    if (!account) throw new Error("Internet account not found");

    const result = await this.safeConnector(() => this.connector.disconnectSessions(account.router_username));
    if (!result.ok) {
      await this.repo.audit(actor.id, actor.staffId, "internet.disconnect_sessions", "resident_internet_account", id, {
        outcome: "failed"
      });
      throw new Error("Internet disconnect failed");
    }

    await this.repo.audit(actor.id, actor.staffId, "internet.disconnect_sessions", "resident_internet_account", id, {
      outcome: "synced",
      disconnected: result.value.disconnected
    });
    return { account: await this.get(id), disconnected: result.value.disconnected };
  }

  async retrySync(actor: AuthUser, id: number) {
    if (!actor.staffId) throw new Error("Staff session required");
    const account = await this.get(id);
    if (!account) throw new Error("Internet account not found");

    await this.markSync(id, actor.staffId, "pending", null);

    if (account.status === "suspended" || account.status === "disabled") {
      const result = await this.safeConnector(async () => {
        await this.connector.disableUser(account.router_username);
        return this.connector.disconnectSessions(account.router_username);
      });
      if (!result.ok) {
        await this.markSync(id, actor.staffId, "failed", result.error);
        await this.repo.audit(actor.id, actor.staffId, "internet.sync_retry", "resident_internet_account", id, {
          outcome: "failed"
        });
        return this.get(id);
      }
      await this.markSync(id, actor.staffId, "synced", null);
      await this.repo.audit(actor.id, actor.staffId, "internet.sync_retry", "resident_internet_account", id, {
        outcome: "synced"
      });
      return this.get(id);
    }

    // active: ensure profile + enable; recreate with one-time password if missing on router
    let recreatedPassword: string | undefined;
    const result = await this.safeConnector(async () => {
      await this.connector.ensureResidentProfile();
      try {
        await this.connector.getUser(account.router_username);
        await this.connector.enableUser(account.router_username);
        return { recreated: false as const };
      } catch (e) {
        if (e instanceof ConnectorUnavailableError) throw e;
        const message = e instanceof Error ? e.message : "";
        if (!/not found/i.test(message)) throw e;
        const password = generateHotspotPassword();
        await this.connector.createUser({
          username: account.router_username,
          password,
          comment: `Kissmet retry ${account.router_username}`
        });
        recreatedPassword = password;
        return { recreated: true as const };
      }
    });

    if (!result.ok) {
      await this.markSync(id, actor.staffId, "failed", result.error);
      await this.repo.audit(actor.id, actor.staffId, "internet.sync_retry", "resident_internet_account", id, {
        outcome: "failed"
      });
      return this.get(id);
    }

    await this.markSync(id, actor.staffId, "synced", null, "active");
    await this.repo.audit(actor.id, actor.staffId, "internet.sync_retry", "resident_internet_account", id, {
      outcome: "synced",
      recreated: result.value.recreated
    });

    const updated = await this.get(id);
    if (result.value.recreated && recreatedPassword) {
      return { ...updated, password: recreatedPassword };
    }
    return updated;
  }

  async listSessions(id: number) {
    const account = await this.get(id);
    if (!account) throw new Error("Internet account not found");
    const result = await this.safeConnector(() => this.connector.listActiveSessions(account.router_username));
    if (!result.ok) throw new Error("Internet session list failed");
    return result.value;
  }
}
