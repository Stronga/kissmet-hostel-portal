import type { Env } from "../types/bindings";

export interface DatabaseConnectivity {
  ok: boolean;
  result?: number;
  error?: string;
}

export class DatabaseRepository {
  constructor(private readonly db: Env["DB"]) {}

  async checkConnectivity(): Promise<DatabaseConnectivity> {
    try {
      const row = await this.db.prepare("SELECT 1 AS result").first<{ result: number }>();

      return {
        ok: row?.result === 1,
        result: row?.result
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown D1 connectivity error"
      };
    }
  }
}
