import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { log } from "./logger.js";
import { createRouterOsClient } from "./routeros/client-factory.js";

const config = loadConfig();
if (config.routerosDriver === "mock") {
  log.warn("routeros_mock_driver_active", {
    mode: config.mode,
    note: "ROUTEROS_DRIVER=mock: in-memory RouterOS only. No MikroTik connection is made. Development/test use only; refused in production."
  });
}
if (config.routerosDriver === "real" && !config.mikrotikApiTls) {
  log.warn("routeros_plaintext_api", {
    mode: config.mode,
    port: config.mikrotikApiPort,
    note: "Explicitly non-production env: RouterOS API credentials travel unencrypted on the LAN. Production refuses this; set MIKROTIK_API_TLS=true (api-ssl 8729) with MIKROTIK_API_TLS_CA_FILE."
  });
}
const client = await createRouterOsClient(config);
const app = createApp(config, client);

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.bindHost }, (info) => {
  log.info("connector_listening", {
    host: config.bindHost,
    port: info.port,
    mode: config.mode,
    routerosDriver: config.routerosDriver,
    trustProxy: config.trustProxy ?? false,
    mikrotikHost: config.routerosDriver === "mock" ? "mock (in-memory)" : config.mikrotikHost,
    mikrotikApiPort: config.routerosDriver === "mock" ? null : config.mikrotikApiPort,
    mikrotikApiTls: config.routerosDriver === "mock" ? null : config.mikrotikApiTls ?? false,
    note: "Production: Pi LAN → RouterOS; Cloudflare Workers cannot reach RouterOS directly. WG .5 is DEV/remote-test only"
  });
});

async function shutdown(signal: string) {
  log.info("connector_stopping", { signal });
  try {
    await client.close?.();
  } catch {
    // ignore
  }
  try {
    server.close?.();
  } catch {
    // ignore
  }
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

process.on("uncaughtException", (err) => {
  log.error("uncaught_exception", { error: err instanceof Error ? err.message : "unknown" });
});

process.on("unhandledRejection", (err) => {
  log.error("unhandled_rejection", { error: err instanceof Error ? err.message : "unknown" });
});
