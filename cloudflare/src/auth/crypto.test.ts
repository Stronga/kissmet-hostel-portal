import { describe, expect, it } from "vitest";
import {
  PBKDF2_ITERATIONS,
  PBKDF2_MAX_ITERATIONS,
  hashPassword,
  verifyPassword
} from "./crypto";

describe("password hashing (Workers-compatible PBKDF2)", () => {
  it("hashPassword creates pbkdf2-sha256$100000$... format", async () => {
    const stored = await hashPassword("CorrectHorseBattery");
    const [algo, iterations, salt, digest] = stored.split("$");
    expect(algo).toBe("pbkdf2-sha256");
    expect(iterations).toBe(String(PBKDF2_ITERATIONS));
    expect(PBKDF2_ITERATIONS).toBe(100_000);
    expect(PBKDF2_ITERATIONS).toBeLessThanOrEqual(PBKDF2_MAX_ITERATIONS);
    expect(salt.length).toBeGreaterThanOrEqual(16);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("verifies a correct password against a newly generated 100000 hash", async () => {
    const stored = await hashPassword("CorrectHorseBattery");
    expect(await verifyPassword("CorrectHorseBattery", stored)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const stored = await hashPassword("CorrectHorseBattery");
    expect(await verifyPassword("wrong-password", stored)).toBe(false);
  });

  it("uses a random salt so the same password hashes differently twice", async () => {
    const a = await hashPassword("CorrectHorseBattery");
    const b = await hashPassword("CorrectHorseBattery");
    expect(a).not.toBe(b);
    expect(a.split("$")[2]).not.toBe(b.split("$")[2]);
  });

  it("parses stored iteration count and verifies a 100000 hash with matching salt", async () => {
    const salt = "fixed-salt-for-parse-test-01";
    const stored = await hashPassword("parse-me", salt);
    expect(stored.startsWith("pbkdf2-sha256$100000$")).toBe(true);
    expect(await verifyPassword("parse-me", stored)).toBe(true);
  });

  it("rejects hashes that request iterations above the Worker-supported maximum without treating them as valid", async () => {
    // Do not call WebCrypto with 210000 — verifyPassword must fail closed.
    const unsupported =
      "pbkdf2-sha256$210000$some-salt-value-0001$0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    expect(await verifyPassword("any-password", unsupported)).toBe(false);
  });

  it("rejects null/malformed hashes", async () => {
    expect(await verifyPassword("x", null)).toBe(false);
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
    expect(await verifyPassword("x", "sha256$100000$salt$deadbeef")).toBe(false);
  });
});
