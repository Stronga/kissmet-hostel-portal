import type { Env } from "../types/bindings";
import { DatabaseRepository } from "../repositories/database.repository";

export class HealthService {
  constructor(private readonly env: Env) {}

  getHealth() {
    return {
      ok: true,
      service: this.env.APP_NAME,
      environment: this.env.APP_ENV,
      version: this.env.APP_VERSION
    };
  }

  async getDatabaseHealth() {
    const database = new DatabaseRepository(this.env.DB);
    const connectivity = await database.checkConnectivity();

    return {
      ok: connectivity.ok,
      database: "D1",
      connectivity
    };
  }
}
