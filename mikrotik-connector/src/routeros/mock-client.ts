import type {
  CreateUserInput,
  HotspotProfile,
  HotspotSession,
  HotspotUser,
  RouterOsClient
} from "./types.js";

export class MockRouterOsClient implements RouterOsClient {
  profiles = new Map<string, HotspotProfile>();
  users = new Map<string, HotspotUser>();
  sessions = new Map<string, HotspotSession[]>();
  passwords = new Map<string, string>();
  failNext = false;

  private maybeFail() {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("Simulated RouterOS failure");
    }
  }

  async health() {
    this.maybeFail();
    return { ok: true as const, board: "mock", version: "7.24.2" };
  }

  async getProfile(name: string) {
    this.maybeFail();
    return this.profiles.get(name) ?? null;
  }

  async createProfile(name: string, sharedUsers: number) {
    this.maybeFail();
    const profile = { id: `*${this.profiles.size + 1}`, name, sharedUsers };
    this.profiles.set(name, profile);
    return profile;
  }

  async getUser(username: string) {
    this.maybeFail();
    return this.users.get(username) ?? null;
  }

  async createUser(input: CreateUserInput) {
    this.maybeFail();
    const user: HotspotUser = {
      id: `*${this.users.size + 1}`,
      name: input.username,
      profile: input.profile,
      disabled: false,
      comment: input.comment
    };
    this.users.set(input.username, user);
    this.passwords.set(input.username, input.password);
    return user;
  }

  async setUserDisabled(username: string, disabled: boolean) {
    this.maybeFail();
    const user = this.users.get(username);
    if (!user) throw new Error(`HotSpot user not found: ${username}`);
    const updated = { ...user, disabled };
    this.users.set(username, updated);
    return updated;
  }

  async setUserPassword(username: string, password: string) {
    this.maybeFail();
    const user = this.users.get(username);
    if (!user) throw new Error(`HotSpot user not found: ${username}`);
    this.passwords.set(username, password);
    return user;
  }

  async removeUser(username: string) {
    this.maybeFail();
    this.users.delete(username);
    this.passwords.delete(username);
    this.sessions.delete(username);
  }

  async listActiveSessions(username: string) {
    this.maybeFail();
    return this.sessions.get(username) ?? [];
  }

  async disconnectSessions(username: string) {
    this.maybeFail();
    const current = this.sessions.get(username) ?? [];
    this.sessions.set(username, []);
    return current.length;
  }
}
