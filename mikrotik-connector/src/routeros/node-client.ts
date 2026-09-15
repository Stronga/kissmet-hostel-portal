import { RouterOSAPI } from "node-routeros";
import type { ConnectorConfig } from "../config.js";
import { log } from "../logger.js";
import type {
  CreateUserInput,
  HotspotProfile,
  HotspotSession,
  HotspotUser,
  RouterOsClient
} from "./types.js";
import { RouterOsUnavailableError } from "./types.js";

type RosRow = Record<string, string>;

function asBool(value: string | undefined): boolean {
  return value === "true" || value === "yes";
}

function mapProfile(row: RosRow): HotspotProfile {
  return {
    id: row[".id"] ?? row.id,
    name: row.name,
    sharedUsers: Number(row["shared-users"] ?? "1")
  };
}

function mapUser(row: RosRow): HotspotUser {
  return {
    id: row[".id"] ?? row.id,
    name: row.name,
    profile: row.profile ?? "default",
    disabled: asBool(row.disabled),
    comment: row.comment
  };
}

function mapSession(row: RosRow): HotspotSession {
  return {
    id: row[".id"] ?? row.id,
    user: row.user,
    address: row.address,
    macAddress: row["mac-address"],
    uptime: row.uptime
  };
}

export class NodeRouterOsClient implements RouterOsClient {
  private conn: RouterOSAPI | null = null;

  constructor(private readonly config: ConnectorConfig) {}

  private async resetConnection(): Promise<void> {
    if (this.conn) {
      try {
        this.conn.close();
      } catch {
        // ignore
      }
      this.conn = null;
    }
  }

  private async api(): Promise<RouterOSAPI> {
    if (this.conn?.connected) return this.conn;
    await this.resetConnection();
    const timeout = this.config.routerosTimeoutMs ?? 10_000;
    const conn = new RouterOSAPI({
      host: this.config.mikrotikHost,
      user: this.config.mikrotikApiUser,
      password: this.config.mikrotikApiPassword,
      port: this.config.mikrotikApiPort,
      timeout
    });
    try {
      await conn.connect();
    } catch (e) {
      log.error("routeros_connect_failed", { host: this.config.mikrotikHost, port: this.config.mikrotikApiPort });
      throw new RouterOsUnavailableError("RouterOS unavailable");
    }
    this.conn = conn;
    return conn;
  }

  private async write(path: string, params: string[] = []): Promise<RosRow[]> {
    const api = await this.api();
    try {
      const result = await api.write(path, params);
      return (result ?? []) as RosRow[];
    } catch (e) {
      const message = e instanceof Error ? e.message : "RouterOS write failed";
      const errno = typeof e === "object" && e && "errno" in e ? String((e as { errno?: unknown }).errno) : "";
      // Defensive: empty filtered print on RouterOS 7
      if (errno === "UNKNOWNREPLY" && /!empty/i.test(message)) {
        return [];
      }
      // Drop stale socket so the next call reconnects after LAN/Internet/MikroTik recovery.
      log.error("routeros_write_failed", { path, error: message });
      await this.resetConnection();
      throw new RouterOsUnavailableError("RouterOS operation failed");
    }
  }

  async health() {
    const rows = await this.write("/system/resource/print");
    const row = rows[0] ?? {};
    return { ok: true as const, board: row["board-name"], version: row.version };
  }

  async getProfile(name: string): Promise<HotspotProfile | null> {
    const rows = await this.write("/ip/hotspot/user/profile/print", [`?name=${name}`]);
    return rows[0] ? mapProfile(rows[0]) : null;
  }

  async createProfile(name: string, sharedUsers: number): Promise<HotspotProfile> {
    await this.write("/ip/hotspot/user/profile/add", [
      `=name=${name}`,
      `=shared-users=${sharedUsers}`
    ]);
    const created = await this.getProfile(name);
    if (!created) throw new RouterOsUnavailableError("Profile create did not persist");
    return created;
  }

  async getUser(username: string): Promise<HotspotUser | null> {
    const rows = await this.write("/ip/hotspot/user/print", [`?name=${username}`]);
    return rows[0] ? mapUser(rows[0]) : null;
  }

  async createUser(input: CreateUserInput): Promise<HotspotUser> {
    const params = [
      `=name=${input.username}`,
      `=password=${input.password}`,
      `=profile=${input.profile}`
    ];
    if (input.comment) params.push(`=comment=${input.comment}`);
    await this.write("/ip/hotspot/user/add", params);
    const created = await this.getUser(input.username);
    if (!created) throw new RouterOsUnavailableError("User create did not persist");
    return created;
  }

  async setUserDisabled(username: string, disabled: boolean): Promise<HotspotUser> {
    const user = await this.getUser(username);
    if (!user) throw new Error(`HotSpot user not found: ${username}`);
    await this.write("/ip/hotspot/user/set", [
      `=.id=${user.id}`,
      `=disabled=${disabled ? "yes" : "no"}`
    ]);
    const updated = await this.getUser(username);
    if (!updated) throw new RouterOsUnavailableError("User update did not persist");
    return updated;
  }

  async setUserPassword(username: string, password: string): Promise<HotspotUser> {
    const user = await this.getUser(username);
    if (!user) throw new Error(`HotSpot user not found: ${username}`);
    await this.write("/ip/hotspot/user/set", [
      `=.id=${user.id}`,
      `=password=${password}`
    ]);
    const updated = await this.getUser(username);
    if (!updated) throw new RouterOsUnavailableError("User password update did not persist");
    return updated;
  }

  async removeUser(username: string): Promise<void> {
    const user = await this.getUser(username);
    if (!user) return;
    await this.write("/ip/hotspot/user/remove", [`=.id=${user.id}`]);
  }

  async listActiveSessions(username: string): Promise<HotspotSession[]> {
    const rows = await this.write("/ip/hotspot/active/print", [`?user=${username}`]);
    return rows.map(mapSession);
  }

  async disconnectSessions(username: string): Promise<number> {
    const sessions = await this.listActiveSessions(username);
    for (const session of sessions) {
      await this.write("/ip/hotspot/active/remove", [`=.id=${session.id}`]);
    }
    return sessions.length;
  }

  async close(): Promise<void> {
    if (this.conn) {
      try {
        this.conn.close();
      } catch {
        // ignore close errors
      }
      this.conn = null;
    }
  }
}
