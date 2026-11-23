import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { get, openMigratedDatabase } from "./apply-migrations";
// @ts-expect-error -- plain ESM script without type declarations
import * as boot from "../scripts/bootstrap-production.mjs";
import { verifyPassword } from "../src/auth/crypto";

/**
 * Production bootstrap tooling — local sql.js only (migrations 0001–0020 applied). Nothing here
 * talks to Cloudflare; --apply paths use an injected spawn stub.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

/** Synthetic, obviously-fake-but-valid config. NOT hostel inventory or pricing. */
function sampleConfig(): Record<string, any> {
  return {
    version: 1,
    organization: { name: "Bootstrap Test Org", supportEmail: "help@bootstrap-fixture.invalid.org", supportPhone: "+233201234567" },
    superAdmin: { displayName: "Fixture Admin", username: "fixture.admin", email: "admin@bootstrap-fixture.org", phone: "+233201112223", staffCode: "FIX-STF-001", jobTitle: "Fixture" },
    institutions: [{ code: "fixture-u", name: "Fixture University" }],
    academicSessions: [{ code: "FX-2030", name: "Fixture Session", startsOn: "2030-09-01", endsOn: "2031-08-31", status: "active" }],
    leasePeriods: [
      { code: "FX-AY-2030", name: "Fixture AY", kind: "academic_calendar", academicSessionCode: "FX-2030", startsOn: "2030-09-01", endsOn: "2031-08-31", status: "active" },
      { code: "FX-CY-2031", name: "Fixture CY", kind: "calendar_year", startsOn: "2031-01-01", endsOn: "2031-12-31", status: "draft" }
    ],
    rooms: [
      { roomCode: "FX-1", capacity: 2, genderPolicy: "female" },
      { roomCode: "FX-2", capacity: 4, genderPolicy: "any", bedLabels: ["A", "B", "C"] },
      { roomCode: "FX-3", capacity: 1, genderPolicy: "male", floor: 2 }
    ],
    rateCards: [
      { rateCode: "FX-AY-OCC1", leasePeriodCode: "FX-AY-2030", occupancyCapacity: 1, amountMinor: 111, status: "active" },
      { rateCode: "FX-AY-OCC2", leasePeriodCode: "FX-AY-2030", occupancyCapacity: 2, amountMinor: 222, status: "active" },
      { rateCode: "FX-AY-OCC4", leasePeriodCode: "FX-AY-2030", occupancyCapacity: 4, amountMinor: 444, status: "active", packageMonths: 12 }
    ],
    roomRates: [{ rateCode: "FX-1-FX2030", roomCode: "FX-1", academicSessionCode: "FX-2030", amountMinor: 333, status: "active" }]
  };
}

const COUNT_TABLES = ["roles", "users", "staff", "institutions", "academic_sessions", "lease_periods", "rooms", "beds", "rate_cards", "room_rates"];
function counts(db: Awaited<ReturnType<typeof openMigratedDatabase>>) {
  return Object.fromEntries(COUNT_TABLES.map((t) => [t, Number(get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM ${t}`)!.n)]));
}

describe("bootstrap config validation", () => {
  it("accepts a complete config and warns about unpriced capacities", () => {
    const { warnings } = boot.validateConfig(sampleConfig());
    expect(warnings).toEqual([]);
    const c = sampleConfig();
    c.rooms.push({ roomCode: "FX-9", capacity: 3, genderPolicy: "any" });
    expect(boot.validateConfig(c).warnings.join("\n")).toMatch(/FX-9 capacity 3 is not a rate-card occupancy/);
  });

  it("rejects the shipped template (placeholders) without echoing anything secret", () => {
    const tpl = JSON.parse(fs.readFileSync(path.join(root, "bootstrap/production.config.template.json"), "utf8"));
    expect(() => boot.validateConfig(tpl)).toThrow(/placeholder/);
  });

  it("rejects development seed fingerprints", () => {
    for (const mutate of [
      (c: any) => (c.superAdmin.email = "ama.resident@example.com"),
      (c: any) => (c.superAdmin.phone = "+233000000001"),
      (c: any) => (c.organization.supportEmail = "x@kissmet.test")
    ]) {
      const c = sampleConfig();
      mutate(c);
      expect(() => boot.validateConfig(c)).toThrow(/development seed/);
    }
  });

  it("rejects passwords in the config, bad references, duplicates and invalid values", () => {
    const cases: Array<[(c: any) => void, RegExp]> = [
      [(c) => (c.superAdmin.password = "hunter2hunter2"), /must not contain a password/],
      [(c) => (c.rateCards[0].leasePeriodCode = "NOPE"), /leasePeriodCode does not match/],
      [(c) => (c.rateCards[0].occupancyCapacity = 3), /occupancyCapacity must be one of/],
      [(c) => (c.rateCards[0].amountMinor = 12.5), /amountMinor/],
      [(c) => c.rateCards.push({ ...c.rateCards[0], rateCode: "FX-DUP" }), /one active per lease period/],
      [(c) => c.academicSessions.push({ ...c.academicSessions[0], code: "FX-2031" }), /at most one academic session may be active/],
      [(c) => (c.leasePeriods[1].academicSessionCode = "FX-2030"), /only allowed for kind academic_calendar/],
      [(c) => (c.rooms[1].bedLabels = ["A", "B", "C", "D", "E"]), /more beds than capacity/],
      [(c) => (c.rooms[0].genderPolicy = "mixed"), /genderPolicy must be one of/],
      [(c) => (c.leasePeriods[0].startsOn = "2031-02-30"), /YYYY-MM-DD/],
      [(c) => (c.institutions[0].name = "x'); DROP TABLE users; --"), /invalid format/],
      [(c) => (c.unknown = 1), /unknown top-level key/],
      [(c) => (c.version = 2), /version must be 1/],
      [(c) => delete c.superAdmin, /superAdmin is required/]
    ];
    for (const [mutate, re] of cases) {
      const c = sampleConfig();
      mutate(c);
      expect(() => boot.validateConfig(c), String(re)).toThrow(re);
    }
  });
});

describe("bootstrap SQL against a locally migrated D1 schema (0001-0021)", () => {
  it("creates the reference data, and a second run creates nothing new (idempotent)", async () => {
    const db = await openMigratedDatabase();
    const plan = boot.validateConfig(sampleConfig());
    const sql = boot.generateSql(plan, { env: "local", adminPasswordHash: null, generatedAt: "fixed" });
    db.exec(sql);
    const first = counts(db);
    expect(first).toEqual({ roles: 5, users: 1, staff: 1, institutions: 1, academic_sessions: 1, lease_periods: 2, rooms: 3, beds: 2 + 3 + 1, rate_cards: 3, room_rates: 1 });
    db.exec(sql);
    db.exec(boot.generateSql(plan, { env: "local", adminPasswordHash: await boot.hashPassword("another-temp"), generatedAt: "again" }));
    expect(counts(db)).toEqual(first);
    // Second run must not overwrite the admin password hash (still NULL from the first run).
    expect(get<{ h: string | null }>(db, "SELECT password_hash AS h FROM users WHERE username = 'fixture.admin'")!.h).toBeNull();
    expect(get(db, "SELECT gender_policy AS g FROM rooms WHERE room_code = 'FX-3'")).toEqual({ g: "male" });
    expect(get(db, "SELECT COUNT(*) AS n FROM beds WHERE bed_code LIKE 'FX-2-%'")).toEqual({ n: 3 });
    expect(get(db, "SELECT lp.code AS code FROM lease_periods lp JOIN academic_sessions s ON s.id = lp.academic_session_id")).toEqual({ code: "FX-AY-2030" });
    expect(get(db, "SELECT support_email AS e FROM system_settings WHERE id = 1")).toEqual({ e: "help@bootstrap-fixture.invalid.org" });
    db.close();
  });

  it("never edits existing production rows (DO NOTHING on natural keys)", async () => {
    const db = await openMigratedDatabase();
    const plan = boot.validateConfig(sampleConfig());
    const sql = boot.generateSql(plan, { env: "production" });
    db.exec(sql);
    db.exec("UPDATE rate_cards SET amount_minor = 999 WHERE rate_code = 'FX-AY-OCC2'; UPDATE rooms SET gender_policy = 'any' WHERE room_code = 'FX-1'; UPDATE system_settings SET support_email = 'ops@changed.org' WHERE id = 1;");
    db.exec(sql);
    expect(get(db, "SELECT amount_minor AS a FROM rate_cards WHERE rate_code = 'FX-AY-OCC2'")).toEqual({ a: 999 });
    expect(get(db, "SELECT gender_policy AS g FROM rooms WHERE room_code = 'FX-1'")).toEqual({ g: "any" });
    expect(get(db, "SELECT support_email AS e FROM system_settings WHERE id = 1")).toEqual({ e: "ops@changed.org" });
    db.close();
  });

  it("creates the first super admin only when no super admin exists", async () => {
    const db = await openMigratedDatabase();
    const plan = boot.validateConfig(sampleConfig());
    db.exec(boot.generateSql(plan, { env: "production" }));
    const c2 = sampleConfig();
    Object.assign(c2.superAdmin, { username: "second.admin", email: "second@bootstrap-fixture.org", phone: "+233209998887", staffCode: "FIX-STF-002" });
    db.exec(boot.generateSql(boot.validateConfig(c2), { env: "production" }));
    expect(get(db, "SELECT COUNT(*) AS n FROM users WHERE user_type = 'staff'")).toEqual({ n: 1 });
    expect(get(db, "SELECT COUNT(*) AS n FROM staff")).toEqual({ n: 1 });
    db.close();
  });

  it("issues a Worker-compatible PBKDF2 hash; the temporary password is never in the SQL", async () => {
    const db = await openMigratedDatabase();
    const temp = boot.generateTemporaryPassword();
    const hash = await boot.hashPassword(temp);
    const sql = boot.generateSql(boot.validateConfig(sampleConfig()), { env: "production", adminPasswordHash: hash });
    expect(sql).not.toContain(temp);
    db.exec(sql);
    const stored = get<{ h: string }>(db, "SELECT password_hash AS h FROM users WHERE username = 'fixture.admin'")!.h;
    expect(stored).toMatch(/^pbkdf2-sha256\$100000\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    expect(await verifyPassword(temp, stored)).toBe(true);
    expect(await verifyPassword("wrong", stored)).toBe(false);
    // Mandatory rotation: the bootstrap super admin must change the temporary password at first login.
    expect(get(db, "SELECT must_change_password AS m FROM users WHERE username = 'fixture.admin'")).toEqual({ m: 1 });
    db.close();
  });

  it("fails the whole batch on a schema without migration 0021 (password rotation columns)", async () => {
    const db = await openMigratedDatabase("0020_connector_heartbeats.sql");
    const sql = boot.generateSql(boot.validateConfig(sampleConfig()), { env: "production" });
    expect(() => db.exec(sql)).toThrow(/must_change_password/);
    expect(get(db, "SELECT COUNT(*) AS n FROM roles")).toEqual({ n: 0 });
    db.close();
  });

  it("fails the whole batch on a schema older than 0020 (schema guard)", async () => {
    const db = await openMigratedDatabase("0019_agreement_aware_allocations.sql");
    const sql = boot.generateSql(boot.validateConfig(sampleConfig()), { env: "production" });
    expect(() => db.exec(sql)).toThrow(/connector_heartbeats/);
    expect(get(db, "SELECT COUNT(*) AS n FROM roles")).toEqual({ n: 0 });
    db.close();
  });

  it("output contains no development seed data", () => {
    const sql = boot.generateSql(boot.validateConfig(sampleConfig()), { env: "production" });
    const seed = fs.readFileSync(path.join(root, "seeds/development.sql"), "utf8");
    for (const marker of ["example.com", "dev-staff-salt", "+233000000", "KSM-RES-900", "ROOM-101", "University of Ghana", "admin@kissmetgroup.org"]) {
      expect(seed).toContain(marker);
      expect(sql).not.toContain(marker);
    }
  });
});

describe("bootstrap CLI guards (no wrangler, no network)", () => {
  function harness(files: Record<string, string>) {
    const out: string[] = [];
    const err: string[] = [];
    const written: Record<string, string> = {};
    const spawned: string[][] = [];
    const deps = {
      readFile: (p: string) => {
        const k = Object.keys(files).find((f) => p.endsWith(f));
        if (!k) throw new Error(`ENOENT ${p}`);
        return files[k];
      },
      writeFile: (p: string, s: string) => (written[p] = s),
      stdout: (s: string) => out.push(s),
      stderr: (s: string) => err.push(s),
      spawn: (cmd: string, args: string[]) => {
        spawned.push([cmd, ...args]);
        return { status: 0 };
      },
      root: "/repo/cloudflare"
    };
    return { deps, out, err, written, spawned };
  }
  const wrangler = fs.readFileSync(path.join(root, "wrangler.toml"), "utf8");
  const files = { "cfg.json": JSON.stringify(sampleConfig()), "wrangler.toml": wrangler };

  it("requires --env (no default environment) and --config", async () => {
    let h = harness(files);
    expect(await boot.main(["--config", "cfg.json"], h.deps)).toBe(2);
    expect(h.err.join("")).toMatch(/--env is required/);
    h = harness(files);
    expect(await boot.main(["--env", "prod", "--config", "cfg.json"], h.deps)).toBe(2);
    h = harness(files);
    expect(await boot.main(["--env", "production"], h.deps)).toBe(2);
    expect(h.spawned).toEqual([]);
  });

  it("dry run by default: prints SQL, executes nothing", async () => {
    const h = harness(files);
    expect(await boot.main(["--env", "production", "--config", "cfg.json"], h.deps)).toBe(0);
    expect(h.out.join("")).toContain("INSERT INTO roles");
    expect(h.err.join("")).toMatch(/dry run/);
    expect(h.spawned).toEqual([]);
  });

  it("refuses the development seed as input", async () => {
    const h = harness(files);
    expect(await boot.main(["--env", "production", "--config", "seeds/development.sql"], h.deps)).toBe(2);
    expect(h.spawned).toEqual([]);
  });

  it("--apply requires --confirm with the exact production database_name and --out", async () => {
    let h = harness(files);
    expect(await boot.main(["--env", "production", "--config", "cfg.json", "--apply", "--out", "b.sql"], h.deps)).toBe(2);
    expect(h.err.join("")).toMatch(/--confirm kissmet-production/);
    h = harness(files);
    expect(await boot.main(["--env", "production", "--config", "cfg.json", "--apply", "--confirm", "kissmet-hostel-local", "--out", "b.sql"], h.deps)).toBe(2);
    h = harness(files);
    expect(await boot.main(["--env", "production", "--config", "cfg.json", "--apply", "--confirm", "kissmet-production"], h.deps)).toBe(2);
    expect(h.spawned).toEqual([]);
  });

  it("--apply refuses staging while its D1 id is a placeholder", async () => {
    const h = harness(files);
    expect(await boot.main(["--env", "staging", "--config", "cfg.json", "--apply", "--confirm", "kissmet-hostel-staging", "--out", "s.sql"], h.deps)).toBe(2);
    expect(h.err.join("")).toMatch(/placeholder/);
    expect(h.spawned).toEqual([]);
  });

  it("with every guard satisfied, --apply hands the reviewed file to wrangler (stubbed here)", async () => {
    const h = harness(files);
    expect(await boot.main(["--env", "production", "--config", "cfg.json", "--apply", "--confirm", "kissmet-production", "--out", "b.sql", "--issue-admin-temp-password"], h.deps)).toBe(0);
    expect(h.spawned).toEqual([["npx", "wrangler", "d1", "execute", "DB", "--env", "production", "--file", "b.sql", "--remote"]]);
    const pw = /\n {2}(\S+)\nStore it/.exec(h.err.join(""))?.[1];
    expect(pw).toBeTruthy();
    expect(h.written["b.sql"]).not.toContain(pw);
    expect(h.written["b.sql"]).toMatch(/pbkdf2-sha256\$100000\$/);
  });

  it("invalid configs exit 1 and execute nothing", async () => {
    const h = harness({ ...files, "cfg.json": "{not json" });
    expect(await boot.main(["--env", "production", "--config", "cfg.json"], h.deps)).toBe(1);
    expect(h.spawned).toEqual([]);
  });
});

describe("synthetic staging seed", () => {
  function syntheticConfig(): Record<string, any> {
    const raw = JSON.parse(fs.readFileSync(path.join(root, "bootstrap/staging.synthetic.config.json"), "utf8"));
    return raw;
  }

  it("refuses the committed synthetic config without --synthetic", () => {
    expect(() => boot.validateConfig(syntheticConfig())).toThrow(/--synthetic/);
  });

  it("accepts the committed synthetic config with allowSynthetic and emits a staging OTP inbox", () => {
    const plan = boot.validateConfig(syntheticConfig(), { allowSynthetic: true });
    const sql = boot.generateSql(plan, { env: "staging" });
    expect(sql).toContain("SYNTHETIC staging/local data only");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS staging_otp_inbox");
    expect(sql).toContain("staging.admin@staging.kissmet.test");
    expect(sql).toContain("STG-F1");
    expect(sql).not.toContain("+233000000");
    expect(sql).not.toContain("example.com");
    expect(sql).not.toContain("dev-staff-salt");
    expect(() => boot.generateSql(plan, { env: "production" })).toThrow(/cannot be generated for production/);
  });

  it("still refuses example.com, +233000000xxx and dev-staff-salt in synthetic mode", () => {
    for (const mutate of [
      (c: any) => (c.superAdmin.email = "ama.resident@example.com"),
      (c: any) => (c.superAdmin.phone = "+233000000001"),
      (c: any) => (c.superAdmin.displayName = "dev-staff-salt")
    ]) {
      const c = syntheticConfig();
      mutate(c);
      expect(() => boot.validateConfig(c, { allowSynthetic: true })).toThrow(/development seed/);
    }
  });

  it("CLI refuses --synthetic with --env production and never spawns wrangler", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const spawned: string[][] = [];
    const deps = {
      readFile: (p: string) => {
        if (p.endsWith("staging.synthetic.config.json") || p.endsWith("cfg.json")) return JSON.stringify(syntheticConfig());
        if (p.endsWith("wrangler.toml")) return fs.readFileSync(path.join(root, "wrangler.toml"), "utf8");
        throw new Error(`ENOENT ${p}`);
      },
      writeFile: () => undefined,
      stdout: (s: string) => out.push(s),
      stderr: (s: string) => err.push(s),
      spawn: (cmd: string, args: string[]) => {
        spawned.push([cmd, ...args]);
        return { status: 0 };
      },
      root: "/repo/cloudflare"
    };
    expect(await boot.main(["--env", "production", "--config", "cfg.json", "--synthetic"], deps)).toBe(2);
    expect(err.join("")).toMatch(/cannot be used with --env production/);
    expect(spawned).toEqual([]);
  });

  it("CLI dry-run for staging synthetic writes inbox SQL and executes nothing", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const spawned: string[][] = [];
    const written: Record<string, string> = {};
    const deps = {
      readFile: (p: string) => {
        if (p.endsWith("cfg.json")) return JSON.stringify(syntheticConfig());
        if (p.endsWith("wrangler.toml")) return fs.readFileSync(path.join(root, "wrangler.toml"), "utf8");
        throw new Error(`ENOENT ${p}`);
      },
      writeFile: (p: string, s: string) => {
        written[p] = s;
      },
      stdout: (s: string) => out.push(s),
      stderr: (s: string) => err.push(s),
      spawn: (cmd: string, args: string[]) => {
        spawned.push([cmd, ...args]);
        return { status: 0 };
      },
      root: "/repo/cloudflare"
    };
    expect(await boot.main(["--env", "staging", "--config", "cfg.json", "--synthetic", "--out", "s.sql"], deps)).toBe(0);
    expect(written["s.sql"]).toContain("CREATE TABLE IF NOT EXISTS staging_otp_inbox");
    expect(err.join("")).toMatch(/dry run/);
    expect(spawned).toEqual([]);
  });
});
