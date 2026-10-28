import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(here, "../migrations");

let sqlPromise: Promise<SqlJsStatic> | null = null;

function getSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({
      locateFile: (file) => path.resolve(here, "../node_modules/sql.js/dist", file),
    });
  }
  return sqlPromise;
}

export function listMigrationFiles(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
}

export function readMigrationSql(fileName: string): string {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, fileName), "utf8");
}

/** Apply every numbered migration to a fresh in-memory SQLite DB (local/test only). */
export async function openMigratedDatabase(throughFile?: string): Promise<Database> {
  const SQL = await getSql();
  const db = new SQL.Database();
  db.run("PRAGMA foreign_keys = ON;");

  for (const file of listMigrationFiles()) {
    if (throughFile && file > throughFile) break;
    const sql = readMigrationSql(file);
    try {
      db.run(sql);
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }

  return db;
}

export function run(db: Database, sql: string, params: Array<string | number | null> = []): void {
  db.run(sql, params);
}

export function get<T extends Record<string, unknown>>(
  db: Database,
  sql: string,
  params: Array<string | number | null> = [],
): T | null {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (!stmt.step()) {
    stmt.free();
    return null;
  }
  const row = stmt.getAsObject() as T;
  stmt.free();
  return row;
}

export function all<T extends Record<string, unknown>>(
  db: Database,
  sql: string,
  params: Array<string | number | null> = [],
): T[] {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows: T[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject() as T);
  stmt.free();
  return rows;
}

export function expectReject(db: Database, sql: string, params: Array<string | number | null> = []): string {
  try {
    db.run(sql, params);
    throw new Error("EXPECTED_CONSTRAINT_FAILURE");
  } catch (error) {
    const message = (error as Error).message;
    if (message === "EXPECTED_CONSTRAINT_FAILURE") throw error;
    return message;
  }
}

/** Minimal D1Database adapter over sql.js for real-schema integration tests (local/test only). */
export function createSqlJsD1(db: Database): D1Database {
  const wrap = (sql: string) => {
    let binds: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        binds = args;
        return stmt;
      },
      async first<T>() {
        const row = get<Record<string, unknown>>(db, sql, binds as Array<string | number | null>);
        return (row as T) ?? null;
      },
      async all<T>() {
        const rows = all<Record<string, unknown>>(db, sql, binds as Array<string | number | null>);
        return { results: rows as T[], success: true };
      },
      async run() {
        run(db, sql, binds as Array<string | number | null>);
        const changes = Number(db.getRowsModified());
        let lastRowId: number | null = null;
        if (/^\s*INSERT\b/i.test(sql)) {
          const row = get<{ id: number }>(db, `SELECT last_insert_rowid() AS id`);
          lastRowId = row ? Number(row.id) : null;
        }
        return {
          success: true,
          meta: {
            changes,
            last_row_id: lastRowId,
            duration: 0,
            size_after: 0,
            rows_read: 0,
            rows_written: changes,
          },
        };
      },
    };
    return stmt;
  };
  return {
    prepare(sql: string) {
      return wrap(sql) as unknown as D1PreparedStatement;
    },
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
  } as unknown as D1Database;
}
