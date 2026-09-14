import {
  DEFAULT_PROFILE_NAME,
  RESIDENT_PROFILE_NAME,
  RESIDENT_SHARED_USERS
} from "../config.js";
import { log } from "../logger.js";
import type { RouterOsClient } from "../routeros/types.js";
import { ProfileConflictError } from "../routeros/types.js";

export class HotspotService {
  constructor(private readonly client: RouterOsClient) {}

  async health() {
    return this.client.health();
  }

  /**
   * Idempotently ensure Kissmet-Residents exists with shared-users=3.
   * NEVER modifies the RouterOS `default` profile.
   */
  async ensureResidentProfile() {
    const existing = await this.client.getProfile(RESIDENT_PROFILE_NAME);
    if (existing) {
      if (existing.sharedUsers !== RESIDENT_SHARED_USERS) {
        throw new ProfileConflictError(
          `Profile ${RESIDENT_PROFILE_NAME} exists with shared-users=${existing.sharedUsers}; expected ${RESIDENT_SHARED_USERS}`
        );
      }
      log.info("profile_ensure_ok", { profile: RESIDENT_PROFILE_NAME, sharedUsers: existing.sharedUsers, created: false });
      return { profile: existing, created: false };
    }

    // Guard: never touch default
    const defaultProfile = await this.client.getProfile(DEFAULT_PROFILE_NAME);
    if (!defaultProfile) {
      log.warn("default_profile_missing", { note: "leaving untouched; creating Kissmet profile only" });
    }

    const created = await this.client.createProfile(RESIDENT_PROFILE_NAME, RESIDENT_SHARED_USERS);
    log.info("profile_ensure_ok", { profile: RESIDENT_PROFILE_NAME, sharedUsers: created.sharedUsers, created: true });
    return { profile: created, created: true };
  }

  async getUser(username: string) {
    return this.client.getUser(username);
  }

  async createUser(input: { username: string; password: string; comment?: string }) {
    await this.ensureResidentProfile();
    const existing = await this.client.getUser(input.username);
    if (existing) {
      log.info("user_create_idempotent", { username: input.username });
      return { user: existing, created: false };
    }
    const user = await this.client.createUser({
      username: input.username,
      password: input.password,
      profile: RESIDENT_PROFILE_NAME,
      comment: input.comment ?? "Kissmet resident internet"
    });
    log.info("user_created", { username: input.username, profile: RESIDENT_PROFILE_NAME });
    return { user, created: true };
  }

  async disableUser(username: string) {
    const existing = await this.client.getUser(username);
    if (!existing) throw new Error(`HotSpot user not found: ${username}`);
    if (existing.disabled) {
      log.info("user_disable_idempotent", { username });
      return existing;
    }
    const updated = await this.client.setUserDisabled(username, true);
    log.info("user_disabled", { username });
    return updated;
  }

  async enableUser(username: string) {
    const existing = await this.client.getUser(username);
    if (!existing) throw new Error(`HotSpot user not found: ${username}`);
    if (!existing.disabled) {
      log.info("user_enable_idempotent", { username });
      return existing;
    }
    const updated = await this.client.setUserDisabled(username, false);
    log.info("user_enabled", { username });
    return updated;
  }

  async resetUserPassword(username: string, password: string) {
    const existing = await this.client.getUser(username);
    if (!existing) throw new Error(`HotSpot user not found: ${username}`);
    const updated = await this.client.setUserPassword(username, password);
    log.info("user_password_reset", { username });
    return updated;
  }

  async removeUser(username: string) {
    await this.client.removeUser(username);
    log.info("user_removed", { username });
  }

  async listActiveSessions(username: string) {
    return this.client.listActiveSessions(username);
  }

  async disconnectSessions(username: string) {
    const count = await this.client.disconnectSessions(username);
    log.info("sessions_disconnected", { username, count });
    return { disconnected: count };
  }
}
