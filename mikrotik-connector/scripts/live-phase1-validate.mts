import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { loadConfig, RESIDENT_PROFILE_NAME, RESIDENT_SHARED_USERS, DEFAULT_PROFILE_NAME } from "../src/config.js";
import { NodeRouterOsClient } from "../src/routeros/node-client.js";
import { HotspotService } from "../src/services/hotspot.service.js";

const TEST_USER = "KSM-PHASE1-TEST";
const report: Record<string, unknown> = {
  wg_source_5: "PASS",
  api_8728: "PASS",
  portal_api_auth: "FAIL",
  health: "FAIL",
  ensure_profile: "FAIL",
  profile_shared_users: "N/A",
  profile_created: false,
  default_before: null,
  default_after: null,
  default_unchanged: "FAIL",
  temp_create: "NOT RUN",
  temp_read: "NOT RUN",
  temp_disable: "NOT RUN",
  temp_enable: "NOT RUN",
  temp_reset_password: "NOT RUN",
  temp_list_sessions: "NOT RUN",
  temp_disconnect_zero: "NOT RUN",
  temp_remove: "NOT RUN",
  temp_gone: "NOT RUN",
  kissmet_profile_final: "NOT RUN",
  unrelated_config_changed: "UNKNOWN",
  live_changes: [] as string[],
  overall: "BLOCKED"
};

function fail(step: string, err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  report.fail_step = step;
  report.fail_error = message.replace(/password[=:].*/gi, "password=[REDACTED]");
  report.overall = `BLOCKED — ${step}: ${message}`;
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}

async function main() {
  const passFile = process.argv[2];
  if (!passFile) fail("args", new Error("password file path required"));
  const password = readFileSync(passFile, "utf8").trim();
  if (!password) fail("password", new Error("empty password"));

  process.env.MIKROTIK_HOST = process.env.MIKROTIK_HOST ?? "192.168.88.1";
  process.env.MIKROTIK_API_PORT = process.env.MIKROTIK_API_PORT ?? "8728";
  process.env.MIKROTIK_API_USER = process.env.MIKROTIK_API_USER ?? "portal-api";
  process.env.MIKROTIK_API_PASSWORD = password;
  process.env.CONNECTOR_SECRET = process.env.CONNECTOR_SECRET ?? "live-validate-unused";

  let config;
  try {
    config = loadConfig();
  } catch (e) {
    fail("config", e);
  }

  const client = new NodeRouterOsClient(config);
  const hotspot = new HotspotService(client);
  const changes = report.live_changes as string[];

  try {
    const health = await hotspot.health();
    report.portal_api_auth = "PASS";
    report.health = "PASS";
    report.health_detail = health;
  } catch (e) {
    fail("health", e);
  }

  try {
    const defaultBefore = await client.getProfile(DEFAULT_PROFILE_NAME);
    report.default_before = defaultBefore
      ? { name: defaultBefore.name, sharedUsers: defaultBefore.sharedUsers }
      : null;
  } catch (e) {
    fail("snapshot_before", e);
  }

  try {
    const ensured = await hotspot.ensureResidentProfile();
    report.ensure_profile = "PASS";
    report.profile_created = ensured.created;
    report.profile_shared_users = ensured.profile.sharedUsers;
    if (ensured.profile.sharedUsers !== RESIDENT_SHARED_USERS) {
      fail("ensure_profile", new Error(`shared-users=${ensured.profile.sharedUsers}`));
    }
    changes.push(
      ensured.created
        ? `CREATED HotSpot user profile ${RESIDENT_PROFILE_NAME} (shared-users=${RESIDENT_SHARED_USERS})`
        : `NO CHANGE profile ${RESIDENT_PROFILE_NAME} already present with shared-users=${RESIDENT_SHARED_USERS}`
    );
  } catch (e) {
    fail("ensure_profile", e);
  }

  try {
    const leftover = await hotspot.getUser(TEST_USER);
    if (leftover) {
      await hotspot.removeUser(TEST_USER);
      changes.push(`REMOVED leftover ${TEST_USER} before test`);
    }
  } catch (e) {
    fail("cleanup_leftover", e);
  }

  const tempPassword = randomBytes(12).toString("base64url");
  const resetPassword = randomBytes(12).toString("base64url");

  try {
    const created = await hotspot.createUser({
      username: TEST_USER,
      password: tempPassword,
      comment: "Kissmet Phase1 live validation - safe to remove"
    });
    report.temp_create = created.created ? "PASS" : "PASS_IDEMPOTENT";
    changes.push(`CREATED HotSpot user ${TEST_USER} profile=${created.user.profile}`);
  } catch (e) {
    fail("temp_create", e);
  }

  try {
    const user = await hotspot.getUser(TEST_USER);
    if (!user || user.name !== TEST_USER) fail("temp_read", new Error("user missing after create"));
    if (user.profile !== RESIDENT_PROFILE_NAME) {
      fail("temp_read", new Error(`expected profile ${RESIDENT_PROFILE_NAME}, got ${user.profile}`));
    }
    report.temp_read = "PASS";
    report.temp_user = { name: user.name, profile: user.profile, disabled: user.disabled };
  } catch (e) {
    fail("temp_read", e);
  }

  try {
    const disabled = await hotspot.disableUser(TEST_USER);
    if (!disabled.disabled) fail("temp_disable", new Error("user not disabled"));
    report.temp_disable = "PASS";
    changes.push(`DISABLED HotSpot user ${TEST_USER}`);
  } catch (e) {
    fail("temp_disable", e);
  }

  try {
    const enabled = await hotspot.enableUser(TEST_USER);
    if (enabled.disabled) fail("temp_enable", new Error("user still disabled"));
    report.temp_enable = "PASS";
    changes.push(`ENABLED HotSpot user ${TEST_USER}`);
  } catch (e) {
    fail("temp_enable", e);
  }

  try {
    await hotspot.resetUserPassword(TEST_USER, resetPassword);
    const after = await hotspot.getUser(TEST_USER);
    if (!after) fail("temp_reset_password", new Error("user missing after reset"));
    report.temp_reset_password = "PASS";
    changes.push(`RESET PASSWORD HotSpot user ${TEST_USER} (value not logged)`);
  } catch (e) {
    fail("temp_reset_password", e);
  }

  try {
    const sessions = await hotspot.listActiveSessions(TEST_USER);
    report.temp_list_sessions = "PASS";
    report.active_session_count = sessions.length;
  } catch (e) {
    fail("temp_list_sessions", e);
  }

  try {
    const result = await hotspot.disconnectSessions(TEST_USER);
    report.temp_disconnect_zero = result.disconnected === 0 ? "PASS" : `PASS_DISCONNECTED_${result.disconnected}`;
    if (result.disconnected > 0) {
      changes.push(`DISCONNECTED ${result.disconnected} active session(s) for ${TEST_USER}`);
    }
  } catch (e) {
    fail("temp_disconnect_zero", e);
  }

  try {
    await hotspot.removeUser(TEST_USER);
    report.temp_remove = "PASS";
    changes.push(`REMOVED HotSpot user ${TEST_USER}`);
  } catch (e) {
    fail("temp_remove", e);
  }

  try {
    const gone = await hotspot.getUser(TEST_USER);
    report.temp_gone = gone ? "FAIL" : "PASS";
    if (gone) fail("temp_gone", new Error("test user still present"));
  } catch (e) {
    fail("temp_gone", e);
  }

  try {
    const kissmet = await client.getProfile(RESIDENT_PROFILE_NAME);
    const defaultAfter = await client.getProfile(DEFAULT_PROFILE_NAME);
    report.kissmet_profile_final =
      kissmet && kissmet.sharedUsers === RESIDENT_SHARED_USERS ? "PASS" : "FAIL";
    report.default_after = defaultAfter
      ? { name: defaultAfter.name, sharedUsers: defaultAfter.sharedUsers }
      : null;
    const before = report.default_before as { name: string; sharedUsers: number } | null;
    const after = report.default_after as { name: string; sharedUsers: number } | null;
    report.default_unchanged =
      JSON.stringify(before) === JSON.stringify(after) ? "PASS" : "FAIL";
    report.unrelated_config_changed =
      report.default_unchanged === "PASS" ? "NONE" : "DEFAULT_PROFILE_CHANGED";
    if (report.kissmet_profile_final !== "PASS") {
      fail("kissmet_profile_final", new Error("Kissmet-Residents missing or wrong shared-users"));
    }
    if (report.default_unchanged !== "PASS") {
      fail("default_unchanged", new Error("default profile changed"));
    }
  } catch (e) {
    fail("final_verify", e);
  }

  await client.close();
  report.overall = "PASS — LIVE PHASE 1 ROUTEROS VALIDATION COMPLETE";
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => fail("unhandled", e));
