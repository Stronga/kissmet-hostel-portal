/**
 * Static checks for the Pi deploy assets. Never executes install.sh / upgrade.sh, never needs
 * root/systemd: only `bash -n` and the pure helpers in scripts/lib/common.sh (validation +
 * unit rendering to stdout). Skipped where bash is unavailable (e.g. plain Windows shells).
 */
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rel = (p: string) => path.join(root, p);
const read = (p: string) => fs.readFileSync(rel(p), "utf8");

function hasBash(): boolean {
  if (process.platform === "win32") return false;
  try {
    execFileSync("bash", ["-c", "true"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Run a snippet with common.sh sourced; returns { code, stdout, stderr }. */
function common(snippet: string) {
  const r = spawnSync("bash", ["-c", `set -u; source "${rel("scripts/lib/common.sh")}"; ${snippet}`], { encoding: "utf8" });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

const TEMPLATE = rel("deploy/mikrotik-connector.service");
const render = (user = "kissmet-connector", group = user, installRoot = "/opt/kissmet/mikrotik-connector", envFile = "/etc/kissmet/mikrotik-connector.env", node = "/usr/bin/node") =>
  common(`render_unit "${TEMPLATE}" "${user}" "${group}" "${installRoot}" "${envFile}" "${node}"`);

describe.skipIf(!hasBash())("deploy scripts (static)", () => {
  for (const f of ["scripts/install.sh", "scripts/upgrade.sh", "scripts/lib/common.sh"]) {
    it(`${f} passes bash -n`, () => {
      expect(spawnSync("bash", ["-n", rel(f)]).status).toBe(0);
    });
  }

  it("renders the unit for the default dedicated user with no leftover placeholders", () => {
    const r = render();
    expect(r.code).toBe(0);
    expect(r.stdout).not.toMatch(/@[A-Z_]+@/);
    expect(r.stdout).toMatch(/^User=kissmet-connector$/m);
    expect(r.stdout).toMatch(/^Group=kissmet-connector$/m);
    expect(r.stdout).toMatch(/^ExecStart=\/usr\/bin\/node --import tsx \/opt\/kissmet\/mikrotik-connector\/src\/index\.ts$/m);
    expect(r.stdout).toMatch(/^EnvironmentFile=\/etc\/kissmet\/mikrotik-connector\.env$/m);
    expect(r.stdout).toMatch(/^Environment=NODE_ENV=production$/m);
  });

  it("supports the existing kissmet-svc account", () => {
    const r = render("kissmet-svc");
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^User=kissmet-svc$/m);
    expect(r.stdout).toMatch(/^Group=kissmet-svc$/m);
  });

  it("unit is hardened and the code tree is read-only to the service", () => {
    const u = render().stdout;
    for (const d of [
      "NoNewPrivileges=true",
      "ProtectSystem=strict",
      "ProtectHome=true",
      "PrivateTmp=true",
      "PrivateDevices=true",
      "ReadOnlyPaths=/opt/kissmet/mikrotik-connector",
      "RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX",
      "CapabilityBoundingSet=",
      "SystemCallFilter=@system-service",
      "UMask=0077"
    ]) {
      expect(u).toContain(d);
    }
    expect(u).not.toMatch(/^ReadWritePaths=/m);
  });

  for (const [label, args] of [
    ["root", ["root"]],
    ["admin login user kissmet", ["kissmet"]],
    ["pi", ["pi"]],
    ["uppercase / shell metacharacters", ["Bad;rm"]],
    ["node under /home (nvm)", ["kissmet-connector", "kissmet-connector", "/opt/kissmet/mikrotik-connector", "/etc/kissmet/mikrotik-connector.env", "/home/kissmet/.nvm/versions/node/v22/bin/node"]],
    ["relative node path", ["kissmet-connector", "kissmet-connector", "/opt/kissmet/mikrotik-connector", "/etc/kissmet/mikrotik-connector.env", "node"]],
    ["install root with traversal", ["kissmet-connector", "kissmet-connector", "/opt/../etc", "/etc/kissmet/mikrotik-connector.env"]],
    ["env file with sed metacharacter", ["kissmet-connector", "kissmet-connector", "/opt/kissmet/mikrotik-connector", "/etc/kissmet/x|y.env"]]
  ] as Array<[string, string[]]>) {
    it(`refuses to render for ${label}`, () => {
      const r = render(...(args as [string, string?, string?, string?, string?]));
      expect(r.code).not.toBe(0);
      expect(r.stdout).toBe("");
    });
  }

  it("Node version check accepts only 22.x", () => {
    expect(common(`check_node_version v22.11.0`).code).toBe(0);
    expect(common(`check_node_version v22.23.5`).code).toBe(0);
    for (const v of ["v20.18.0", "v21.7.3", "v23.0.0", "v24.1.0", "garbage", ""]) {
      expect(common(`check_node_version "${v}"`).code, v).not.toBe(0);
    }
  });

  it("does not hard-code the service user anywhere in the scripts or unit", () => {
    expect(read("deploy/mikrotik-connector.service")).toMatch(/^User=@SERVICE_USER@$/m);
    for (const f of ["scripts/install.sh", "scripts/upgrade.sh"]) {
      const s = read(f);
      expect(s).not.toMatch(/User=kissmet-connector/);
      expect(s).toContain("render_unit");
      expect(s).toContain('source "${REPO_DIR}/scripts/lib/common.sh"');
      // Code tree must not be chowned to the service account any more.
      expect(s).not.toMatch(/chown -R "\$\{SERVICE_USER\}/);
      // No third-party lifecycle scripts as root.
      expect(s).not.toMatch(/npm ci --omit=dev=false/);
    }
    expect(read("scripts/lib/common.sh")).toContain("--ignore-scripts");
    expect(read("scripts/lib/common.sh")).toContain("chmod 0600");
  });
});

describe("Node.js version pin is consistent", () => {
  it("package.json engines, .nvmrc, .node-version and REQUIRED_NODE_MAJOR all say 22", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.engines?.node).toBe(">=22 <23");
    const lock = JSON.parse(read("package-lock.json"));
    expect(lock.packages[""].engines?.node).toBe(">=22 <23");
    expect(read(".nvmrc").trim()).toBe("22");
    expect(read(".node-version").trim()).toBe("22");
    expect(read("scripts/lib/common.sh")).toMatch(/^REQUIRED_NODE_MAJOR=22$/m);
  });
});

describe("env templates keep TRUST_PROXY scoped to the trusted-proxy deployment", () => {
  const parseEnv = (text: string) =>
    Object.fromEntries(
      text
        .split(/\r?\n/)
        .filter((l) => /^[A-Z0-9_]+=/.test(l))
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
    ) as NodeJS.ProcessEnv;

  it(".env.example (dev) keeps TRUST_PROXY=false, loopback bind, real driver default", () => {
    const env = parseEnv(read(".env.example"));
    expect(env.TRUST_PROXY).toBe("false");
    expect(env.BIND_HOST).toBe("127.0.0.1");
    expect(env.CONNECTOR_MODE).toBe("local");
  });

  it("production template: TRUST_PROXY=true, BIND_HOST=127.0.0.1, api-ssl 8729 with CA, real driver", () => {
    const env = parseEnv(read("deploy/connector.env.production.example"));
    expect(env).toMatchObject({
      CONNECTOR_MODE: "production",
      ROUTEROS_DRIVER: "real",
      BIND_HOST: "127.0.0.1",
      TRUST_PROXY: "true",
      MIKROTIK_API_TLS: "true",
      MIKROTIK_API_PORT: "8729"
    });
    expect(env.MIKROTIK_API_TLS_CA_FILE).toMatch(/^\//);
    expect(env.MIKROTIK_API_TLS_INSECURE_SKIP_VERIFY).toBeUndefined();
  });

  it("production template refuses to start until placeholders are replaced", () => {
    const env = parseEnv(read("deploy/connector.env.production.example"));
    expect(() => loadConfig(env)).toThrow(/placeholder/);
  });

  it("production template loads once secrets are filled in (no other edits needed)", () => {
    const env = parseEnv(read("deploy/connector.env.production.example"));
    const cfg = loadConfig({ ...env, CONNECTOR_SECRET: "Qx7".repeat(15), MIKROTIK_API_PASSWORD: "not-a-real-router-password" });
    expect(cfg.mode).toBe("production");
    expect(cfg.trustProxy).toBe(true);
    expect(cfg.bindHost).toBe("127.0.0.1");
    expect(cfg.mikrotikApiTls).toBe(true);
    expect(cfg.mikrotikApiPort).toBe(8729);
  });

  it("staging template is mock-only, loopback, TRUST_PROXY=false, no real router host", () => {
    const text = read("deploy/connector.env.staging.example");
    const env = parseEnv(text);
    expect(env).toMatchObject({
      CONNECTOR_MODE: "local",
      ROUTEROS_DRIVER: "mock",
      BIND_HOST: "127.0.0.1",
      TRUST_PROXY: "false"
    });
    expect(env.MIKROTIK_HOST).toBeUndefined();
    expect(text).toMatch(/NEVER point at the real MikroTik/i);
    expect(text).toMatch(/TRUST_PROXY=true remains restricted to the production trusted-proxy/);
    const cfg = loadConfig({ ...env, CONNECTOR_SECRET: "Qx7".repeat(15) });
    expect(cfg.trustProxy).toBe(false);
    expect(cfg.bindHost).toBe("127.0.0.1");
    expect(cfg.routerosDriver).toBe("mock");
  });

});
