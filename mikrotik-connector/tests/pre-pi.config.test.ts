/**
 * Pre-Pi commissioning hardening (2026-11-22):
 * - numeric/port env validation (PORT, MIKROTIK_API_PORT, MAX_BODY_BYTES, ROUTEROS_TIMEOUT_MS)
 * - TRUST_PROXY / BIND_HOST loopback guards
 * - RouterOS api-ssl (8729) TLS configuration and certificate verification
 *
 * No MikroTik, no Pi. node-routeros is mocked; the TLS verification tests use a throwaway
 * loopback TLS server with certificates generated in a temp dir (skipped if openssl is missing).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import type { AddressInfo } from "node:net";

const rosCapture = vi.hoisted(() => ({ options: [] as Array<Record<string, unknown>>, connects: 0 }));

vi.mock("node-routeros", () => {
  class RouterOSAPI {
    connected = false;
    constructor(opts: Record<string, unknown>) {
      rosCapture.options.push(opts);
    }
    async connect() {
      rosCapture.connects += 1;
      this.connected = true;
      return this;
    }
    async write() {
      return [{ "board-name": "mock-board", version: "7.x" }];
    }
    close() {
      this.connected = false;
    }
  }
  return { RouterOSAPI };
});

import { isLoopbackHost, loadConfig, normaliseFingerprint256 } from "../src/config.js";
import { buildRouterOsTlsOptions, verifyRouterOsPeer } from "../src/routeros/tls.js";
import { NodeRouterOsClient } from "../src/routeros/node-client.js";
import { log } from "../src/logger.js";

const SECRET = "local-dev-connector-secret-at-least-32-chars";
const PROD_SECRET = "Zq8".repeat(15);
const base = { CONNECTOR_SECRET: SECRET } as NodeJS.ProcessEnv;
const prod = {
  CONNECTOR_SECRET: PROD_SECRET,
  CONNECTOR_MODE: "production",
  MIKROTIK_API_PASSWORD: "router-pass-not-real"
} as NodeJS.ProcessEnv;
const FP_HEX = "ab".repeat(32);
const FP = normaliseFingerprint256(FP_HEX);

let tmp: string;
let pemFile: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kissmet-tls-test-"));
  pemFile = path.join(tmp, "placeholder-ca.pem");
  fs.writeFileSync(pemFile, "-----BEGIN CERTIFICATE-----\nTUlJQg==\n-----END CERTIFICATE-----\n");
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  rosCapture.options.length = 0;
  rosCapture.connects = 0;
  vi.spyOn(log, "info").mockImplementation(() => undefined);
  vi.spyOn(log, "warn").mockImplementation(() => undefined);
  vi.spyOn(log, "error").mockImplementation(() => undefined);
});

describe("numeric env validation (PORT, MIKROTIK_API_PORT, MAX_BODY_BYTES, ROUTEROS_TIMEOUT_MS)", () => {
  it("preserves defaults when unset", () => {
    const cfg = loadConfig(base);
    expect(cfg.port).toBe(8788);
    expect(cfg.mikrotikApiPort).toBe(8728);
    expect(cfg.maxBodyBytes).toBe(16 * 1024);
    expect(cfg.routerosTimeoutMs).toBe(10_000);
  });

  it("accepts valid values", () => {
    const cfg = loadConfig({ ...base, PORT: "9000", MIKROTIK_API_PORT: "18728", MAX_BODY_BYTES: "2048", ROUTEROS_TIMEOUT_MS: "5000" });
    expect([cfg.port, cfg.mikrotikApiPort, cfg.maxBodyBytes, cfg.routerosTimeoutMs]).toEqual([9000, 18728, 2048, 5000]);
    expect(loadConfig({ ...base, PORT: "65535" }).port).toBe(65535);
    expect(loadConfig({ ...base, PORT: "1" }).port).toBe(1);
  });

  for (const name of ["PORT", "MIKROTIK_API_PORT", "MAX_BODY_BYTES", "ROUTEROS_TIMEOUT_MS"]) {
    for (const value of ["0", "-1", "1.5", "abc", "NaN", "Infinity", "", "1e309"]) {
      it(`rejects ${name}=${JSON.stringify(value)} without echoing the value`, () => {
        let message = "";
        try {
          loadConfig({ ...base, [name]: value });
        } catch (e) {
          message = (e as Error).message;
        }
        expect(message).toMatch(new RegExp(`^${name} must be`));
        if (value.length > 1) expect(message).not.toContain(value);
      });
    }
  }

  for (const name of ["PORT", "MIKROTIK_API_PORT"]) {
    it(`rejects ${name} above 65535`, () => {
      expect(() => loadConfig({ ...base, [name]: "65536" })).toThrow(new RegExp(`${name} must be a TCP port`));
    });
  }
});

describe("BIND_HOST / TRUST_PROXY loopback guards", () => {
  it("isLoopbackHost recognises loopback forms only", () => {
    for (const h of ["127.0.0.1", "127.1.2.3", "::1", "[::1]", "localhost", " LOCALHOST "]) expect(isLoopbackHost(h)).toBe(true);
    for (const h of ["0.0.0.0", "::", "192.168.88.2", "10.0.0.1", "example.com", "127.0.0.1.evil"]) expect(isLoopbackHost(h)).toBe(false);
  });

  it("defaults BIND_HOST to 127.0.0.1 and TRUST_PROXY to false", () => {
    const cfg = loadConfig(base);
    expect(cfg.bindHost).toBe("127.0.0.1");
    expect(cfg.trustProxy).toBe(false);
  });

  it("allows TRUST_PROXY=true with a loopback bind", () => {
    expect(loadConfig({ ...base, TRUST_PROXY: "true" }).trustProxy).toBe(true);
    expect(loadConfig({ ...base, TRUST_PROXY: "true", BIND_HOST: "::1" }).trustProxy).toBe(true);
  });

  for (const host of ["0.0.0.0", "192.168.88.10", "::"]) {
    it(`refuses TRUST_PROXY=true with BIND_HOST=${host}`, () => {
      expect(() => loadConfig({ ...base, TRUST_PROXY: "true", BIND_HOST: host })).toThrow(/TRUST_PROXY=true requires a loopback BIND_HOST/);
    });
  }

  it("still allows a non-loopback bind in local mode with TRUST_PROXY=false (lab only)", () => {
    expect(loadConfig({ ...base, BIND_HOST: "0.0.0.0" }).bindHost).toBe("0.0.0.0");
  });

  it("refuses a non-loopback BIND_HOST in production", () => {
    expect(() => loadConfig({ ...prod, BIND_HOST: "0.0.0.0" })).toThrow(/BIND_HOST must be a loopback address/);
    expect(loadConfig(prod).bindHost).toBe("127.0.0.1");
  });
});

describe("RouterOS api-ssl (MIKROTIK_API_TLS) configuration", () => {
  it("is off by default (backward compatible) with port 8728", () => {
    const cfg = loadConfig(base);
    expect(cfg.mikrotikApiTls).toBe(false);
    expect(cfg.mikrotikApiPort).toBe(8728);
    expect(buildRouterOsTlsOptions(cfg)).toBeUndefined();
  });

  it("defaults the port to 8729 when TLS is on", () => {
    const cfg = loadConfig({ ...base, MIKROTIK_API_TLS: "true", MIKROTIK_API_TLS_CA_FILE: pemFile });
    expect(cfg.mikrotikApiTls).toBe(true);
    expect(cfg.mikrotikApiPort).toBe(8729);
    expect(cfg.mikrotikApiTlsCaFile).toBe(pemFile);
  });

  it("allows a non-default api-ssl port but refuses 8728 with TLS", () => {
    expect(loadConfig({ ...base, MIKROTIK_API_TLS: "true", MIKROTIK_API_TLS_CA_FILE: pemFile, MIKROTIK_API_PORT: "18729" }).mikrotikApiPort).toBe(18729);
    expect(() => loadConfig({ ...base, MIKROTIK_API_TLS: "true", MIKROTIK_API_TLS_CA_FILE: pemFile, MIKROTIK_API_PORT: "8728" })).toThrow(/8728 is the plaintext/);
  });

  it("requires a CA file (self-signed certs are rejected without it)", () => {
    expect(() => loadConfig({ ...base, MIKROTIK_API_TLS: "true" })).toThrow(/requires MIKROTIK_API_TLS_CA_FILE/);
    expect(() => loadConfig({ ...prod, MIKROTIK_API_TLS: "true" })).toThrow(/requires MIKROTIK_API_TLS_CA_FILE/);
  });

  it("refuses insecure skip-verify in production (CONNECTOR_MODE or NODE_ENV)", () => {
    const tlsInsecure = { MIKROTIK_API_TLS: "true", MIKROTIK_API_TLS_INSECURE_SKIP_VERIFY: "true" };
    expect(() => loadConfig({ ...prod, ...tlsInsecure })).toThrow(/not allowed in production/);
    expect(() => loadConfig({ ...prod, ...tlsInsecure, MIKROTIK_API_TLS_CA_FILE: "/etc/kissmet/ca.pem" })).toThrow(/not allowed in production/);
    expect(() => loadConfig({ ...base, NODE_ENV: "production", CONNECTOR_MODE: "local", ...tlsInsecure })).toThrow(/not allowed in production/);
  });

  it("allows insecure skip-verify only in local mode (lab), and the builder disables verification", () => {
    const cfg = loadConfig({ ...base, MIKROTIK_API_TLS: "true", MIKROTIK_API_TLS_INSECURE_SKIP_VERIFY: "true" });
    expect(buildRouterOsTlsOptions(cfg)).toEqual({ rejectUnauthorized: false, minVersion: "TLSv1.2" });
    expect(() => buildRouterOsTlsOptions({ ...cfg, mode: "production" })).toThrow(/not allowed in production/);
  });

  it("refuses MIKROTIK_API_TLS_* settings when TLS is off", () => {
    for (const [k, v] of [
      ["MIKROTIK_API_TLS_CA_FILE", pemFile],
      ["MIKROTIK_API_TLS_FINGERPRINT256", FP_HEX],
      ["MIKROTIK_API_TLS_SERVERNAME", "router.lan"],
      ["MIKROTIK_API_TLS_INSECURE_SKIP_VERIFY", "true"]
    ]) {
      expect(() => loadConfig({ ...base, [k]: v })).toThrow(/require MIKROTIK_API_TLS=true/);
    }
  });

  it("rejects an unsupported MIKROTIK_API_TLS value", () => {
    expect(() => loadConfig({ ...base, MIKROTIK_API_TLS: "maybe" })).toThrow(/MIKROTIK_API_TLS must be true or false/);
  });

  it("requires an absolute CA path in production", () => {
    expect(() => loadConfig({ ...prod, MIKROTIK_API_TLS: "true", MIKROTIK_API_TLS_CA_FILE: "ca.pem" })).toThrow(/absolute path/);
    expect(loadConfig({ ...prod, MIKROTIK_API_TLS: "true", MIKROTIK_API_TLS_CA_FILE: "/etc/kissmet/routeros-ca.pem" }).mikrotikApiPort).toBe(8729);
  });

  it("normalises and validates the SHA-256 pin", () => {
    expect(FP).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    const cfg = loadConfig({ ...base, MIKROTIK_API_TLS: "true", MIKROTIK_API_TLS_CA_FILE: pemFile, MIKROTIK_API_TLS_FINGERPRINT256: FP.toLowerCase() });
    expect(cfg.mikrotikApiTlsFingerprint256).toBe(FP);
    expect(() => loadConfig({ ...base, MIKROTIK_API_TLS: "true", MIKROTIK_API_TLS_CA_FILE: pemFile, MIKROTIK_API_TLS_FINGERPRINT256: "abcd" })).toThrow(/64 hex digits/);
  });
});

describe("buildRouterOsTlsOptions", () => {
  const tlsCfg = (extra: NodeJS.ProcessEnv = {}) =>
    loadConfig({ ...base, MIKROTIK_API_TLS: "true", MIKROTIK_API_TLS_CA_FILE: pemFile, ...extra });

  it("verifies the chain against the configured CA only, TLS 1.2+", () => {
    const opts = buildRouterOsTlsOptions(tlsCfg())!;
    expect(opts.rejectUnauthorized).toBe(true);
    expect(opts.minVersion).toBe("TLSv1.2");
    expect(String(opts.ca)).toContain("BEGIN CERTIFICATE");
    expect(typeof opts.checkServerIdentity).toBe("function");
    // IP literal → no SNI
    expect(opts.servername).toBeUndefined();
  });

  it("sends SNI when verifying against a DNS servername", () => {
    expect(buildRouterOsTlsOptions(tlsCfg({ MIKROTIK_API_TLS_SERVERNAME: "router.kissmet.lan" }))!.servername).toBe("router.kissmet.lan");
  });

  it("fails at construction time on unreadable or non-PEM CA files, without echoing paths or contents", () => {
    const missing = path.join(tmp, "missing-ca.pem");
    expect(() => buildRouterOsTlsOptions(tlsCfg({ MIKROTIK_API_TLS_CA_FILE: missing }))).toThrow(/^MIKROTIK_API_TLS_CA_FILE could not be read$/);
    const bad = path.join(tmp, "bad-ca.pem");
    fs.writeFileSync(bad, "not a certificate");
    expect(() => buildRouterOsTlsOptions(tlsCfg({ MIKROTIK_API_TLS_CA_FILE: bad }))).toThrow(/^MIKROTIK_API_TLS_CA_FILE must contain a PEM certificate$/);
  });

  it("pin is authoritative when set", () => {
    const cert = { fingerprint256: FP, subject: { CN: "other" }, subjectaltname: "DNS:other" } as unknown as tls.PeerCertificate;
    expect(verifyRouterOsPeer("192.168.88.1", cert, FP)).toBeUndefined();
    const wrong = { ...cert, fingerprint256: normaliseFingerprint256("cd".repeat(32)) } as tls.PeerCertificate;
    expect(verifyRouterOsPeer("192.168.88.1", wrong, FP)?.message).toMatch(/fingerprint does not match/);
  });

  it("checks the IP/hostname SAN when no pin is set", () => {
    const ok = { subject: { CN: "router" }, subjectaltname: "IP Address:192.168.88.1" } as unknown as tls.PeerCertificate;
    const bad = { subject: { CN: "router" }, subjectaltname: "IP Address:192.168.88.2" } as unknown as tls.PeerCertificate;
    expect(verifyRouterOsPeer("192.168.88.1", ok)).toBeUndefined();
    expect(verifyRouterOsPeer("192.168.88.1", bad)).toBeInstanceOf(Error);
  });
});

describe("NodeRouterOsClient passes TLS options to node-routeros (mocked, no network)", () => {
  it("plain mode: no tls option, port 8728", async () => {
    const client = new NodeRouterOsClient(loadConfig(base));
    await client.health();
    expect(rosCapture.options).toHaveLength(1);
    expect(rosCapture.options[0].port).toBe(8728);
    expect(rosCapture.options[0]).not.toHaveProperty("tls");
  });

  it("TLS mode: tls options with CA + verification, port 8729", async () => {
    const client = new NodeRouterOsClient(
      loadConfig({ ...base, MIKROTIK_API_TLS: "true", MIKROTIK_API_TLS_CA_FILE: pemFile, MIKROTIK_API_TLS_FINGERPRINT256: FP_HEX })
    );
    const health = await client.health();
    expect(health.ok).toBe(true);
    const opts = rosCapture.options[0];
    expect(opts.port).toBe(8729);
    const t = opts.tls as tls.ConnectionOptions;
    expect(t.rejectUnauthorized).toBe(true);
    expect(String(t.ca)).toContain("BEGIN CERTIFICATE");
  });

  it("construction fails (startup) when the CA file is missing, before any connect", () => {
    const cfg = loadConfig({ ...base, MIKROTIK_API_TLS: "true", MIKROTIK_API_TLS_CA_FILE: path.join(tmp, "nope.pem") });
    expect(() => new NodeRouterOsClient(cfg)).toThrow(/could not be read/);
    expect(rosCapture.connects).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Real TLS handshake against a throwaway loopback server (proves verification actually rejects).
// ---------------------------------------------------------------------------------------------
function hasOpenssl(): boolean {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!hasOpenssl())("api-ssl verification against a loopback TLS server", () => {
  let dir: string;
  let server: tls.Server;
  let port: number;
  let caPem: string;
  let otherCaPem: string;
  let leafFp: string;

  function gen(cmd: string[]) {
    execFileSync("openssl", cmd, { cwd: dir, stdio: "ignore" });
  }

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kissmet-tls-hs-"));
    for (const name of ["ca", "other"]) {
      gen(["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", `${name}.key`, "-out", `${name}.pem`, "-days", "2", "-subj", `/CN=${name}-test-ca`]);
    }
    gen(["req", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", "leaf.key", "-out", "leaf.csr", "-subj", "/CN=router-test"]);
    fs.writeFileSync(path.join(dir, "ext.cnf"), "subjectAltName=IP:127.0.0.1\n");
    gen(["x509", "-req", "-in", "leaf.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-out", "leaf.pem", "-days", "2", "-extfile", "ext.cnf"]);
    caPem = path.join(dir, "ca.pem");
    otherCaPem = path.join(dir, "other.pem");
    leafFp = new (await import("node:crypto")).X509Certificate(fs.readFileSync(path.join(dir, "leaf.pem"))).fingerprint256;
    server = tls.createServer(
      { key: fs.readFileSync(path.join(dir, "leaf.key")), cert: fs.readFileSync(path.join(dir, "leaf.pem")) },
      (s) => s.end()
    );
    server.on("tlsClientError", () => undefined);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function handshake(env: NodeJS.ProcessEnv): Promise<"ok" | string> {
    const cfg = loadConfig({ ...base, MIKROTIK_HOST: "127.0.0.1", MIKROTIK_API_TLS: "true", MIKROTIK_API_PORT: String(port), ...env });
    const opts = buildRouterOsTlsOptions(cfg)!;
    return new Promise((resolve) => {
      const sock = tls.connect(port, "127.0.0.1", opts, () => {
        sock.destroy();
        resolve("ok");
      });
      sock.on("error", (e) => resolve(e.message));
    });
  }

  it("accepts the router cert signed by the configured CA (IP SAN)", async () => {
    expect(await handshake({ MIKROTIK_API_TLS_CA_FILE: caPem })).toBe("ok");
  });

  it("rejects when the CA does not match (e.g. MITM / wrong router)", async () => {
    expect(await handshake({ MIKROTIK_API_TLS_CA_FILE: otherCaPem })).not.toBe("ok");
  });

  it("rejects a hostname/IP mismatch without a pin", async () => {
    expect(await handshake({ MIKROTIK_API_TLS_CA_FILE: caPem, MIKROTIK_API_TLS_SERVERNAME: "router.other.lan" })).toMatch(/altnames|Hostname|IP/i);
  });

  it("accepts a matching pin and rejects a wrong pin", async () => {
    expect(await handshake({ MIKROTIK_API_TLS_CA_FILE: caPem, MIKROTIK_API_TLS_FINGERPRINT256: leafFp })).toBe("ok");
    expect(await handshake({ MIKROTIK_API_TLS_CA_FILE: caPem, MIKROTIK_API_TLS_FINGERPRINT256: "00".repeat(32) })).toMatch(/fingerprint does not match/);
  });
});
