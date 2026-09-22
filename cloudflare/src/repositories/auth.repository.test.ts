import { describe, expect, it } from "vitest";
import { AuthRepository } from "./auth.repository";

type Stmt = {
  sql: string;
  binds: unknown[];
  bind: (...args: unknown[]) => Stmt;
  first: <T>() => Promise<T>;
};

function createCaptureDb() {
  const calls: { sql: string; binds: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      const stmt: Stmt = {
        sql,
        binds: [],
        bind(...args: unknown[]) {
          this.binds = args;
          calls.push({ sql: this.sql, binds: args });
          return this;
        },
        async first<T>() {
          return { count: 0 } as T;
        }
      };
      return stmt;
    }
  };
  return { db: db as unknown as D1Database, calls };
}

describe("AuthRepository.countRecentStaffLoginFailures", () => {
  it("counts via json_extract on identifierHash, not LIKE/GLOB", async () => {
    const { db, calls } = createCaptureDb();
    const repo = new AuthRepository(db);
    const hash = "a".repeat(64);
    const since = "2026-09-22T00:00:00.000Z";

    await repo.countRecentStaffLoginFailures(hash, since);

    expect(calls).toHaveLength(1);
    const { sql, binds } = calls[0]!;
    expect(sql).toMatch(/json_extract\s*\(\s*metadata_json\s*,\s*'\$\.identifierHash'\s*\)\s*=\s*\?/i);
    expect(sql).not.toMatch(/\bLIKE\b/i);
    expect(sql).not.toMatch(/\bGLOB\b/i);
    expect(sql).toMatch(/action\s*=\s*'auth\.staff\.login_failed'/);
    expect(binds).toEqual([since, hash]);
  });

  it("binds the raw identifierHash (no LIKE wildcards or JSON fragments)", async () => {
    const { db, calls } = createCaptureDb();
    const repo = new AuthRepository(db);
    const hash = "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881";
    await repo.countRecentStaffLoginFailures(hash, "2026-01-01T00:00:00.000Z");
    const bound = String(calls[0]!.binds[1]);
    expect(bound).toBe(hash);
    expect(bound.startsWith("%")).toBe(false);
    expect(bound.includes("identifierHash")).toBe(false);
  });
});
