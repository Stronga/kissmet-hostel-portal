import { DEFAULT_PROFILE_NAME, type ConnectorConfig } from "../config.js";
import { MockRouterOsClient } from "./mock-client.js";
import type { RouterOsClient } from "./types.js";

/**
 * In-memory RouterOS for local development and tests.
 * Seeds the RouterOS built-in `default` HotSpot profile so ensureResidentProfile /
 * user flows behave like a fresh router. Never opens a network connection.
 */
export function createDevMockRouterOsClient(): MockRouterOsClient {
  const client = new MockRouterOsClient();
  client.profiles.set(DEFAULT_PROFILE_NAME, { id: "*0", name: DEFAULT_PROFILE_NAME, sharedUsers: 1 });
  return client;
}

/**
 * Build the RouterOS client for the configured driver.
 *
 * - `mock`: returns an in-memory MockRouterOsClient. The real node-client module
 *   (and therefore node-routeros) is never imported or constructed.
 * - `real`: lazily imports NodeRouterOsClient. Construction does not connect;
 *   the first RouterOS call does.
 */
export async function createRouterOsClient(config: ConnectorConfig): Promise<RouterOsClient> {
  if (config.routerosDriver === "mock") {
    // Defence in depth: loadConfig already refuses this combination.
    if (config.mode === "production") {
      throw new Error("ROUTEROS_DRIVER=mock is not allowed when CONNECTOR_MODE=production");
    }
    return createDevMockRouterOsClient();
  }
  if (config.routerosDriver !== "real") {
    throw new Error("Unsupported ROUTEROS_DRIVER");
  }
  const { NodeRouterOsClient } = await import("./node-client.js");
  return new NodeRouterOsClient(config);
}
