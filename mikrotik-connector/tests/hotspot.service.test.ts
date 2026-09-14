import { describe, expect, it, beforeEach } from "vitest";
import { HotspotService } from "../src/services/hotspot.service.js";
import { MockRouterOsClient } from "../src/routeros/mock-client.js";
import { ProfileConflictError } from "../src/routeros/types.js";
import { DEFAULT_PROFILE_NAME, RESIDENT_PROFILE_NAME, RESIDENT_SHARED_USERS } from "../src/config.js";

describe("HotspotService", () => {
  let client: MockRouterOsClient;
  let service: HotspotService;

  beforeEach(() => {
    client = new MockRouterOsClient();
    client.profiles.set(DEFAULT_PROFILE_NAME, { id: "*0", name: DEFAULT_PROFILE_NAME, sharedUsers: 250 });
    service = new HotspotService(client);
  });

  it("creates Kissmet-Residents with shared-users=3 when missing", async () => {
    const first = await service.ensureResidentProfile();
    expect(first.created).toBe(true);
    expect(first.profile.sharedUsers).toBe(RESIDENT_SHARED_USERS);
    expect(first.profile.name).toBe(RESIDENT_PROFILE_NAME);
  });

  it("returns already-correct profile without mutation", async () => {
    client.profiles.set(RESIDENT_PROFILE_NAME, { id: "*1", name: RESIDENT_PROFILE_NAME, sharedUsers: 3 });
    const second = await service.ensureResidentProfile();
    expect(second.created).toBe(false);
    expect(client.profiles.get(DEFAULT_PROFILE_NAME)?.sharedUsers).toBe(250);
  });

  it("fails safely when Kissmet-Residents exists with conflicting shared-users", async () => {
    client.profiles.set(RESIDENT_PROFILE_NAME, { id: "*9", name: RESIDENT_PROFILE_NAME, sharedUsers: 10 });
    await expect(service.ensureResidentProfile()).rejects.toBeInstanceOf(ProfileConflictError);
    expect(client.profiles.get(DEFAULT_PROFILE_NAME)?.sharedUsers).toBe(250);
  });

  it("never modifies default profile during ensure", async () => {
    await service.ensureResidentProfile();
    expect(client.profiles.get(DEFAULT_PROFILE_NAME)).toEqual({
      id: "*0",
      name: DEFAULT_PROFILE_NAME,
      sharedUsers: 250
    });
  });

  it("creates users idempotently against Kissmet-Residents", async () => {
    const created = await service.createUser({ username: "KSM-RES-0025", password: "secret-a" });
    expect(created.created).toBe(true);
    expect(created.user.profile).toBe(RESIDENT_PROFILE_NAME);

    const again = await service.createUser({ username: "KSM-RES-0025", password: "secret-b" });
    expect(again.created).toBe(false);
    expect(client.passwords.get("KSM-RES-0025")).toBe("secret-a");
  });

  it("disable/enable are idempotent", async () => {
    await service.createUser({ username: "KSM-RES-0001", password: "x" });
    const d1 = await service.disableUser("KSM-RES-0001");
    const d2 = await service.disableUser("KSM-RES-0001");
    expect(d1.disabled).toBe(true);
    expect(d2.disabled).toBe(true);

    const e1 = await service.enableUser("KSM-RES-0001");
    const e2 = await service.enableUser("KSM-RES-0001");
    expect(e1.disabled).toBe(false);
    expect(e2.disabled).toBe(false);
  });

  it("lists and disconnects sessions; empty set is success", async () => {
    await service.createUser({ username: "KSM-RES-0002", password: "x" });
    client.sessions.set("KSM-RES-0002", [
      { id: "*1", user: "KSM-RES-0002", address: "10.0.0.2" },
      { id: "*2", user: "KSM-RES-0002", address: "10.0.0.3" }
    ]);
    expect(await service.listActiveSessions("KSM-RES-0002")).toHaveLength(2);
    expect(await service.disconnectSessions("KSM-RES-0002")).toEqual({ disconnected: 2 });
    expect(await service.disconnectSessions("KSM-RES-0002")).toEqual({ disconnected: 0 });
  });

  it("reset password is explicit", async () => {
    await service.createUser({ username: "KSM-RES-0003", password: "old" });
    await service.resetUserPassword("KSM-RES-0003", "new-pass");
    expect(client.passwords.get("KSM-RES-0003")).toBe("new-pass");
  });

  it("health proxies RouterOS identity", async () => {
    const health = await service.health();
    expect(health).toBeTruthy();
  });
});
