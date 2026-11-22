#!/usr/bin/env node
/**
 * Kissmet production bootstrap — idempotent SQL generator for first-time reference data.
 *
 * Creates (never updates, never deletes):
 *   roles (system role codes the Worker's permission map expects),
 *   the FIRST super admin (only if no super_admin staff row exists yet),
 *   institutions, academic sessions, lease periods, rooms, beds, rate cards, optional room rates,
 *   optional organisation settings (system_settings row 1, only NULL fields are filled).
 *
 * Safety model
 * - Default is DRY RUN: validate the owner-supplied JSON config and print SQL. Nothing is executed.
 * - `--env` is mandatory (local | staging | production). There is no default environment.
 * - `--apply` additionally requires `--confirm <d1 database_name for that env>` read from
 *   wrangler.toml, and then runs `wrangler d1 execute DB --env <env> --file <sql>` (plus --remote
 *   for staging/production). The tool never runs migrations and never reads seeds/.
 * - Every statement is INSERT ... ON CONFLICT DO NOTHING (or INSERT ... SELECT ... WHERE NOT EXISTS),
 *   so a second run is a no-op and existing production edits are never overwritten.
 * - A schema guard at the top references tables/columns from migrations 0013–0021; on an older
 *   schema the batch fails before any insert.
 * - The config file never contains a password. With `--issue-admin-temp-password` a random
 *   temporary password is generated, PBKDF2-hashed exactly like the Worker (pbkdf2-sha256, 100000
 *   iterations), only the hash goes into the SQL, and the password is printed once to stderr.
 *   Without the flag the admin is created with password_hash NULL (cannot log in) and a
 *   super_admin must later use "reset password", or re-run with the flag on a fresh DB.
 *   The super admin row is always created with must_change_password = 1 (migration 0021): the
 *   temporary password only allows the forced change-password screen until it is replaced.
 * - Dev-seed fingerprints (example.com / .test emails, +233000000xxx phones, dev salts, template
 *   placeholders) are refused.
 */
import { randomBytes, webcrypto } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SYSTEM_ROLES = [
  { code: "super_admin", name: "Super Admin", description: "Full administrative access." },
  { code: "manager", name: "Manager", description: "Hostel manager with operational oversight." },
  { code: "reception", name: "Reception", description: "Front desk and resident intake." },
  { code: "accounts", name: "Accounts", description: "Payment verification and receipts." },
  { code: "maintenance", name: "Maintenance", description: "Maintenance request handling." }
];
export const ENVIRONMENTS = ["local", "staging", "production"];
export const RATE_CARD_OCCUPANCY_CAPACITIES = [1, 2, 4];
const LEASE_KINDS = ["academic_calendar", "calendar_year", "short_term"];
const PERIOD_STATUSES = ["draft", "active", "closed"];
const RATE_STATUSES = ["draft", "active", "inactive"];
const GENDER_POLICIES = ["female", "male", "any"];
const ROOM_STATUSES = ["available", "maintenance", "inactive"];
export const PBKDF2_ITERATIONS = 100_000;

const RE = {
  code: /^[a-z0-9][a-z0-9-]{0,39}$/,
  sessionCode: /^[0-9A-Za-z][0-9A-Za-z_-]{0,39}$/,
  upperCode: /^[A-Z0-9][A-Z0-9-]{0,39}$/,
  bedLabel: /^[A-Z0-9]{1,4}$/,
  date: /^\d{4}-\d{2}-\d{2}$/,
  username: /^[a-z0-9][a-z0-9._-]{2,31}$/,
  email: /^[^\s@'"]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/,
  phone: /^\+233[2-9]\d{8}$/,
  currency: /^[A-Z]{3}$/,
  text: /^[^\u0000-\u001f'"\\;]{1,160}$/
};

export class BootstrapConfigError extends Error {
  constructor(errors) {
    super(`Invalid bootstrap config:\n - ${errors.join("\n - ")}`);
    this.name = "BootstrapConfigError";
    this.errors = errors;
  }
}

const PLACEHOLDER = /<\s*replace|replace[-_ ]?me|changeme|todo|xxx|placeholder/i;
const DEV_FINGERPRINTS = [/@example\.(com|org|net)$/i, /\.test$/i, /^\+233000000\d{3}$/, /dev-staff-salt/i, /^KSM-RES-9\d{3}$/];

function isValidDate(s) {
  if (typeof s !== "string" || !RE.date.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Validate the owner-supplied config. Returns a normalised plan or throws BootstrapConfigError. */
export function validateConfig(raw) {
  const errors = [];
  const err = (m) => errors.push(m);
  const str = (v, re, where) => {
    if (typeof v === "string" && PLACEHOLDER.test(v)) {
      err(`${where} still contains a template placeholder`);
      return false;
    }
    if (typeof v === "string" && DEV_FINGERPRINTS.some((f) => f.test(v))) {
      err(`${where} looks like development seed data; refuse`);
      return false;
    }
    if (typeof v !== "string" || !re.test(v)) {
      err(`${where} is missing or has an invalid format`);
      return false;
    }
    return true;
  };
  const oneOf = (v, list, where) => {
    if (!list.includes(v)) err(`${where} must be one of: ${list.join(", ")}`);
  };
  const int = (v, where, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
    if (!Number.isInteger(v) || v < min || v > max) err(`${where} must be an integer between ${min} and ${max}`);
  };
  const uniq = (items, key, where) => {
    const seen = new Set();
    for (const it of items) {
      const k = typeof key === "function" ? key(it) : it?.[key];
      if (seen.has(k)) err(`${where}: duplicate ${typeof key === "string" ? key : "key"} ${JSON.stringify(k)}`);
      seen.add(k);
    }
  };

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BootstrapConfigError(["config must be a JSON object"]);
  const allowedTop = new Set(["$schema", "version", "organization", "superAdmin", "institutions", "academicSessions", "leasePeriods", "rooms", "rateCards", "roomRates", "notes"]);
  for (const k of Object.keys(raw)) if (!allowedTop.has(k)) err(`unknown top-level key ${JSON.stringify(k)}`);
  if (raw.version !== 1) err("version must be 1");
  if (JSON.stringify(raw).match(/"password(_hash)?"\s*:/i)) err("config must not contain a password or password_hash field");

  // organization (optional)
  const org = raw.organization ?? null;
  if (org !== null) {
    if (org.name !== undefined) str(org.name, RE.text, "organization.name");
    if (org.supportEmail !== undefined) str(org.supportEmail, RE.email, "organization.supportEmail");
    if (org.supportPhone !== undefined) str(org.supportPhone, RE.phone, "organization.supportPhone");
    if (org.addressText !== undefined) str(org.addressText, RE.text, "organization.addressText");
  }

  // super admin (required)
  const sa = raw.superAdmin;
  if (!sa || typeof sa !== "object") err("superAdmin is required");
  else {
    str(sa.displayName, RE.text, "superAdmin.displayName");
    str(sa.username, RE.username, "superAdmin.username");
    str(sa.email, RE.email, "superAdmin.email");
    str(sa.phone, RE.phone, "superAdmin.phone (E.164 Ghana, +233XXXXXXXXX)");
    str(sa.staffCode, RE.upperCode, "superAdmin.staffCode");
    if (sa.jobTitle !== undefined) str(sa.jobTitle, RE.text, "superAdmin.jobTitle");
  }

  const arr = (k, required) => {
    const v = raw[k];
    if (v === undefined && !required) return [];
    if (!Array.isArray(v) || (required && v.length === 0)) {
      err(`${k} must be a non-empty array`);
      return [];
    }
    return v;
  };
  const institutions = arr("institutions", true);
  institutions.forEach((x, i) => {
    str(x?.code, RE.code, `institutions[${i}].code`);
    str(x?.name, RE.text, `institutions[${i}].name`);
  });
  uniq(institutions, "code", "institutions");

  const sessions = arr("academicSessions", false);
  sessions.forEach((x, i) => {
    str(x?.code, RE.sessionCode, `academicSessions[${i}].code`);
    str(x?.name, RE.text, `academicSessions[${i}].name`);
    if (!isValidDate(x?.startsOn) || !isValidDate(x?.endsOn)) err(`academicSessions[${i}] startsOn/endsOn must be YYYY-MM-DD dates`);
    else if (x.startsOn > x.endsOn) err(`academicSessions[${i}] startsOn must be <= endsOn`);
    oneOf(x?.status, PERIOD_STATUSES, `academicSessions[${i}].status`);
  });
  uniq(sessions, "code", "academicSessions");
  if (sessions.filter((s) => s?.status === "active").length > 1) err("at most one academic session may be active");
  const sessionCodes = new Set(sessions.map((s) => s?.code));

  const periods = arr("leasePeriods", true);
  periods.forEach((x, i) => {
    str(x?.code, RE.sessionCode, `leasePeriods[${i}].code`);
    str(x?.name, RE.text, `leasePeriods[${i}].name`);
    oneOf(x?.kind, LEASE_KINDS, `leasePeriods[${i}].kind`);
    if (!isValidDate(x?.startsOn) || !isValidDate(x?.endsOn)) err(`leasePeriods[${i}] startsOn/endsOn must be YYYY-MM-DD dates`);
    else if (x.startsOn > x.endsOn) err(`leasePeriods[${i}] startsOn must be <= endsOn`);
    oneOf(x?.status, PERIOD_STATUSES, `leasePeriods[${i}].status`);
    if (x?.academicSessionCode !== undefined && x?.academicSessionCode !== null) {
      if (x.kind !== "academic_calendar") err(`leasePeriods[${i}].academicSessionCode is only allowed for kind academic_calendar`);
      if (!sessionCodes.has(x.academicSessionCode)) err(`leasePeriods[${i}].academicSessionCode does not match an academicSessions code`);
    }
  });
  uniq(periods, "code", "leasePeriods");
  uniq(periods.filter((p) => p?.academicSessionCode), "academicSessionCode", "leasePeriods (one per academic session)");
  const periodCodes = new Set(periods.map((p) => p?.code));

  const rooms = arr("rooms", true);
  const bedCodes = [];
  rooms.forEach((x, i) => {
    str(x?.roomCode, RE.upperCode, `rooms[${i}].roomCode`);
    if (x?.roomName !== undefined) str(x.roomName, RE.text, `rooms[${i}].roomName`);
    if (x?.floor !== undefined) str(String(x.floor), /^[0-9A-Za-z -]{1,16}$/, `rooms[${i}].floor`);
    int(x?.capacity, `rooms[${i}].capacity`, { min: 1, max: 12 });
    oneOf(x?.genderPolicy, GENDER_POLICIES, `rooms[${i}].genderPolicy`);
    oneOf(x?.status ?? "available", ROOM_STATUSES, `rooms[${i}].status`);
    const labels = x?.bedLabels ?? (Number.isInteger(x?.capacity) ? defaultBedLabels(x.capacity) : []);
    if (!Array.isArray(labels)) err(`rooms[${i}].bedLabels must be an array`);
    else {
      if (Number.isInteger(x?.capacity) && labels.length > x.capacity) err(`rooms[${i}] has more beds than capacity`);
      labels.forEach((l, j) => str(l, RE.bedLabel, `rooms[${i}].bedLabels[${j}]`));
      if (new Set(labels).size !== labels.length) err(`rooms[${i}].bedLabels has duplicates`);
      labels.forEach((l) => bedCodes.push(`${x?.roomCode}-${l}`));
    }
  });
  uniq(rooms, "roomCode", "rooms");
  if (new Set(bedCodes).size !== bedCodes.length) err("generated bed codes (ROOMCODE-LABEL) collide");
  const roomCodes = new Set(rooms.map((r) => r?.roomCode));

  const rateCards = arr("rateCards", true);
  rateCards.forEach((x, i) => {
    str(x?.rateCode, RE.upperCode, `rateCards[${i}].rateCode`);
    if (!periodCodes.has(x?.leasePeriodCode)) err(`rateCards[${i}].leasePeriodCode does not match a leasePeriods code`);
    oneOf(x?.occupancyCapacity, RATE_CARD_OCCUPANCY_CAPACITIES, `rateCards[${i}].occupancyCapacity`);
    int(x?.amountMinor, `rateCards[${i}].amountMinor (pesewas)`, { min: 1, max: 100_000_000 });
    if (x?.currency !== undefined) str(x.currency, RE.currency, `rateCards[${i}].currency`);
    if (x?.packageMonths !== undefined && x?.packageMonths !== null) int(x.packageMonths, `rateCards[${i}].packageMonths`, { min: 1, max: 60 });
    oneOf(x?.status, RATE_STATUSES, `rateCards[${i}].status`);
  });
  uniq(rateCards, "rateCode", "rateCards");
  uniq(rateCards.filter((r) => r?.status === "active"), (r) => `${r.leasePeriodCode}/${r.occupancyCapacity}`, "rateCards (one active per lease period + occupancy)");

  const roomRates = arr("roomRates", false);
  roomRates.forEach((x, i) => {
    str(x?.rateCode, RE.upperCode, `roomRates[${i}].rateCode`);
    if (!roomCodes.has(x?.roomCode)) err(`roomRates[${i}].roomCode does not match a rooms roomCode`);
    if (!sessionCodes.has(x?.academicSessionCode)) err(`roomRates[${i}].academicSessionCode does not match an academicSessions code`);
    int(x?.amountMinor, `roomRates[${i}].amountMinor (pesewas)`, { min: 1, max: 100_000_000 });
    if (x?.currency !== undefined) str(x.currency, RE.currency, `roomRates[${i}].currency`);
    oneOf(x?.status, RATE_STATUSES, `roomRates[${i}].status`);
  });
  uniq(roomRates, "rateCode", "roomRates");
  uniq(roomRates.filter((r) => r?.status === "active"), (r) => `${r.roomCode}/${r.academicSessionCode}`, "roomRates (one active per room + session)");

  if (errors.length) throw new BootstrapConfigError(errors);

  // Coverage warnings (not errors): rooms whose capacity has no active rate card in an active period.
  const warnings = [];
  const activePeriods = new Set(periods.filter((p) => p.status === "active").map((p) => p.code));
  for (const r of rooms) {
    if (r.capacity && RATE_CARD_OCCUPANCY_CAPACITIES.includes(r.capacity)) {
      const covered = rateCards.some((c) => c.status === "active" && activePeriods.has(c.leasePeriodCode) && c.occupancyCapacity === r.capacity);
      if (!covered) warnings.push(`room ${r.roomCode} (capacity ${r.capacity}) has no active rate card in an active lease period`);
    } else {
      warnings.push(`room ${r.roomCode} capacity ${r.capacity} is not a rate-card occupancy (1, 2, 4); it can only be priced via roomRates`);
    }
  }
  return { config: raw, warnings };
}

export function defaultBedLabels(capacity) {
  return Array.from({ length: capacity }, (_, i) => String.fromCharCode(65 + i));
}

/** SQL string literal; inputs are already format-validated, this is defence in depth. */
export function q(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("non-finite number");
    return String(v);
  }
  return `'${String(v).replace(/'/g, "''")}'`;
}

export async function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const enc = new TextEncoder();
  const key = await webcrypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await webcrypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: PBKDF2_ITERATIONS }, key, 256);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${salt}$${Buffer.from(bits).toString("hex")}`;
}

export function generateTemporaryPassword() {
  return randomBytes(18).toString("base64url");
}

/** Build the idempotent SQL batch. `adminPasswordHash` may be null (admin cannot log in until reset). */
export function generateSql(plan, { env, adminPasswordHash = null, generatedAt = new Date().toISOString() }) {
  if (!ENVIRONMENTS.includes(env)) throw new Error("env must be local, staging or production");
  const c = plan.config;
  const out = [];
  const L = (s = "") => out.push(s);
  L(`-- Kissmet bootstrap (${env}) generated ${generatedAt}`);
  L("-- Idempotent: INSERT ... ON CONFLICT DO NOTHING / WHERE NOT EXISTS. Never updates or deletes.");
  L("-- Does NOT include development seed data. Review before applying. Treat this file as sensitive");
  L("-- if it contains an admin password hash; delete it after use.");
  L("PRAGMA foreign_keys = ON;");
  L();
  L("-- Schema guard: fails the whole batch unless migrations 0001-0021 are applied.");
  L("SELECT id, kind, academic_session_id FROM lease_periods LIMIT 0;");
  L("SELECT id, occupancy_capacity, package_months FROM rate_cards LIMIT 0;");
  L("SELECT id, username FROM users LIMIT 0;");
  L("SELECT * FROM connector_heartbeats LIMIT 0;");
  L("SELECT must_change_password, password_changed_at FROM users LIMIT 0;");
  L("SELECT id FROM system_settings LIMIT 0;");
  L();
  L("-- Roles (codes must match cloudflare/src/auth/permissions.ts)");
  for (const r of SYSTEM_ROLES) {
    L(`INSERT INTO roles (code, name, description, is_system) VALUES (${q(r.code)}, ${q(r.name)}, ${q(r.description)}, 1) ON CONFLICT DO NOTHING;`);
  }
  L();
  const sa = c.superAdmin;
  L("-- First super admin: only when NO super_admin staff exists yet. Never overwrites an existing user.");
  const noSuperAdmin = "NOT EXISTS (SELECT 1 FROM staff s JOIN roles r ON r.id = s.role_id WHERE r.code = 'super_admin')";
  L(
    `INSERT INTO users (email, username, phone, display_name, user_type, status, password_hash, must_change_password) SELECT ${q(sa.email.toLowerCase())}, ${q(sa.username)}, ${q(sa.phone)}, ${q(sa.displayName)}, 'staff', 'active', ${q(adminPasswordHash)}, 1 WHERE ${noSuperAdmin} ON CONFLICT DO NOTHING;`
  );
  L(
    `INSERT INTO staff (user_id, role_id, staff_code, job_title, status) SELECT u.id, r.id, ${q(sa.staffCode)}, ${q(sa.jobTitle ?? "System Administrator")}, 'active' FROM users u JOIN roles r ON r.code = 'super_admin' WHERE u.username = ${q(sa.username)} AND u.user_type = 'staff' AND ${noSuperAdmin} ON CONFLICT DO NOTHING;`
  );
  L();
  if (c.organization) {
    const o = c.organization;
    L("-- Organisation settings: fill only fields that are still NULL/default (row 1 is created by migration 0011).");
    if (o.name) L(`UPDATE system_settings SET organization_name = ${q(o.name)}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 1 AND organization_name = 'Kissmet Hostel';`);
    if (o.supportEmail) L(`UPDATE system_settings SET support_email = ${q(o.supportEmail)}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 1 AND support_email IS NULL;`);
    if (o.supportPhone) L(`UPDATE system_settings SET support_phone = ${q(o.supportPhone)}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 1 AND support_phone IS NULL;`);
    if (o.addressText) L(`UPDATE system_settings SET address_text = ${q(o.addressText)}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 1 AND address_text IS NULL;`);
    L();
  }
  L("-- Institutions");
  for (const i of c.institutions) L(`INSERT INTO institutions (code, name, status) VALUES (${q(i.code)}, ${q(i.name)}, 'active') ON CONFLICT DO NOTHING;`);
  L();
  if (c.academicSessions?.length) {
    L("-- Academic sessions (an existing active session blocks a second active one: that row is skipped)");
    for (const s of c.academicSessions) {
      L(`INSERT INTO academic_sessions (code, name, starts_on, ends_on, status) VALUES (${q(s.code)}, ${q(s.name)}, ${q(s.startsOn)}, ${q(s.endsOn)}, ${q(s.status)}) ON CONFLICT DO NOTHING;`);
    }
    L();
  }
  L("-- Lease periods");
  for (const p of c.leasePeriods) {
    const sess = p.academicSessionCode ? `(SELECT id FROM academic_sessions WHERE code = ${q(p.academicSessionCode)})` : "NULL";
    L(`INSERT INTO lease_periods (kind, code, name, starts_on, ends_on, status, academic_session_id) VALUES (${q(p.kind)}, ${q(p.code)}, ${q(p.name)}, ${q(p.startsOn)}, ${q(p.endsOn)}, ${q(p.status)}, ${sess}) ON CONFLICT DO NOTHING;`);
  }
  L();
  L("-- Rooms and beds");
  for (const r of c.rooms) {
    L(`INSERT INTO rooms (room_code, room_name, floor, capacity, gender_policy, status) VALUES (${q(r.roomCode)}, ${q(r.roomName ?? r.roomCode)}, ${q(r.floor === undefined ? null : String(r.floor))}, ${r.capacity}, ${q(r.genderPolicy)}, ${q(r.status ?? "available")}) ON CONFLICT DO NOTHING;`);
    for (const label of r.bedLabels ?? defaultBedLabels(r.capacity)) {
      L(`INSERT INTO beds (room_id, bed_code, label, status) SELECT id, ${q(`${r.roomCode}-${label}`)}, ${q(label)}, 'available' FROM rooms WHERE room_code = ${q(r.roomCode)} ON CONFLICT DO NOTHING;`);
    }
  }
  L();
  L("-- Rate cards (lease period x occupancy)");
  for (const rc of c.rateCards) {
    L(
      `INSERT INTO rate_cards (lease_period_id, occupancy_capacity, rate_code, amount_minor, currency, package_months, status) SELECT id, ${rc.occupancyCapacity}, ${q(rc.rateCode)}, ${rc.amountMinor}, ${q(rc.currency ?? "GHS")}, ${q(rc.packageMonths ?? null)}, ${q(rc.status)} FROM lease_periods WHERE code = ${q(rc.leasePeriodCode)} ON CONFLICT DO NOTHING;`
    );
  }
  L();
  if (c.roomRates?.length) {
    L("-- Room rates (per room x academic session; used by session-based booking pricing)");
    for (const rr of c.roomRates) {
      L(
        `INSERT INTO room_rates (room_id, academic_session_id, rate_code, amount_minor, currency, status, effective_from, effective_to) SELECT room.id, s.id, ${q(rr.rateCode)}, ${rr.amountMinor}, ${q(rr.currency ?? "GHS")}, ${q(rr.status)}, s.starts_on, s.ends_on FROM rooms room, academic_sessions s WHERE room.room_code = ${q(rr.roomCode)} AND s.code = ${q(rr.academicSessionCode)} ON CONFLICT DO NOTHING;`
      );
    }
    L();
  }
  L("-- Verification (read-only)");
  // Single row of scalar subqueries: D1 limits compound SELECT terms, so no UNION ALL chain.
  L("SELECT (SELECT COUNT(*) FROM roles) AS roles, (SELECT COUNT(*) FROM staff s JOIN roles r ON r.id = s.role_id WHERE r.code = 'super_admin' AND s.status = 'active') AS super_admins, (SELECT COUNT(*) FROM institutions) AS institutions, (SELECT COUNT(*) FROM academic_sessions) AS academic_sessions, (SELECT COUNT(*) FROM lease_periods) AS lease_periods, (SELECT COUNT(*) FROM rooms) AS rooms, (SELECT COUNT(*) FROM beds) AS beds, (SELECT COUNT(*) FROM rate_cards) AS rate_cards, (SELECT COUNT(*) FROM room_rates) AS room_rates;");
  return `${out.join("\n")}\n`;
}

/** Read `database_name` of the DB binding for an env from wrangler.toml (minimal parser, no deps). */
export function d1DatabaseNameFor(env, wranglerToml) {
  const header = env === "local" ? "[[env.local.d1_databases]]" : `[[env.${env}.d1_databases]]`;
  const idx = wranglerToml.indexOf(header);
  if (idx < 0) return null;
  const block = wranglerToml.slice(idx + header.length).split(/\n\[/)[0];
  const m = /database_name\s*=\s*"([^"]+)"/.exec(block);
  return m ? m[1] : null;
}

export function parseArgs(argv) {
  const a = { apply: false, issueAdminTempPassword: false };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) throw new Error(`${k} needs a value`);
      i += 1;
      return v;
    };
    if (k === "--config") a.config = next();
    else if (k === "--env") a.env = next();
    else if (k === "--out") a.out = next();
    else if (k === "--confirm") a.confirm = next();
    else if (k === "--apply") a.apply = true;
    else if (k === "--issue-admin-temp-password") a.issueAdminTempPassword = true;
    else if (k === "--help" || k === "-h") a.help = true;
    else throw new Error(`unknown argument ${k}`);
  }
  return a;
}

const USAGE = `Usage:
  node scripts/bootstrap-production.mjs --env <local|staging|production> --config <file.json> [--out bootstrap.sql]
        [--issue-admin-temp-password] [--apply --confirm <d1 database_name>]

Default is a dry run: validate and print/write SQL only. --apply executes the SQL through
wrangler d1 execute (remote for staging/production) and requires --confirm with the exact
database_name from wrangler.toml for that env.`;

/** CLI entry. `deps` is injectable for tests (no real wrangler, no real fs writes). */
export async function main(argv, deps = {}) {
  const io = {
    readFile: (p) => fs.readFileSync(p, "utf8"),
    writeFile: (p, s) => fs.writeFileSync(p, s, { mode: 0o600 }),
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    spawn: (cmd, args) => spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" }),
    root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
    ...deps
  };
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    io.stderr(`${e.message}\n${USAGE}\n`);
    return 2;
  }
  if (args.help) {
    io.stdout(`${USAGE}\n`);
    return 0;
  }
  if (!args.env || !ENVIRONMENTS.includes(args.env)) {
    io.stderr(`--env is required and must be one of: ${ENVIRONMENTS.join(", ")}\n${USAGE}\n`);
    return 2;
  }
  if (!args.config) {
    io.stderr(`--config is required\n${USAGE}\n`);
    return 2;
  }
  if (/seeds[\\/]/.test(args.config) || /development\.sql$/.test(args.config)) {
    io.stderr("Refusing: the development seed is never used by the bootstrap\n");
    return 2;
  }
  let plan;
  try {
    plan = validateConfig(JSON.parse(io.readFile(args.config)));
  } catch (e) {
    io.stderr(`${e instanceof SyntaxError ? `Config is not valid JSON: ${e.message}` : e.message}\n`);
    return 1;
  }
  for (const w of plan.warnings) io.stderr(`warning: ${w}\n`);

  let hash = null;
  let tempPassword = null;
  if (args.issueAdminTempPassword) {
    tempPassword = generateTemporaryPassword();
    hash = await hashPassword(tempPassword);
  }
  const sql = generateSql(plan, { env: args.env, adminPasswordHash: hash });

  if (args.apply) {
    const wrangler = io.readFile(path.join(io.root, "wrangler.toml"));
    const dbName = d1DatabaseNameFor(args.env, wrangler);
    if (!dbName) {
      io.stderr(`No D1 database configured for env ${args.env} in wrangler.toml\n`);
      return 2;
    }
    if (/replace-with/.test(wrangler.slice(wrangler.indexOf(`[[env.${args.env}.d1_databases]]`)).split(/\n\[/)[0])) {
      io.stderr(`D1 database_id for env ${args.env} is still a placeholder\n`);
      return 2;
    }
    if (args.confirm !== dbName) {
      io.stderr(`Refusing to apply: pass --confirm ${dbName} to confirm the target database\n`);
      return 2;
    }
    if (!args.out) {
      io.stderr("--apply requires --out <file.sql> so the exact SQL applied is kept for review\n");
      return 2;
    }
  }

  if (args.out) {
    io.writeFile(args.out, sql);
    io.stderr(`SQL written to ${args.out} (mode 0600)${args.apply ? "" : " — dry run, nothing executed"}\n`);
  } else {
    io.stdout(sql);
    io.stderr("dry run — nothing executed\n");
  }
  if (tempPassword) {
    io.stderr(
      "\nTemporary super admin password (shown once; only takes effect if the admin user is created by this SQL):\n" +
        `  ${tempPassword}\nStore it in a password manager now. It is not written to any file.\nThe admin must change it at first login (all other staff routes are blocked until then).\n`
    );
  }

  if (args.apply) {
    const wranglerArgs = ["wrangler", "d1", "execute", "DB", "--env", args.env, "--file", args.out];
    wranglerArgs.push(args.env === "local" ? "--local" : "--remote");
    io.stderr(`Applying: npx ${wranglerArgs.join(" ")}\n`);
    const r = io.spawn("npx", wranglerArgs);
    return r.status ?? 1;
  }
  return 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
