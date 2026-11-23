import type { Database } from "sql.js";
import { all, get, run } from "./apply-migrations";

/** Minimal D1Database adapter over an in-memory sql.js database (local tests only). */
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
        return { success: true, meta: { changes, last_row_id: lastRowId, duration: 0, size_after: 0, rows_read: 0, rows_written: changes } };
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
