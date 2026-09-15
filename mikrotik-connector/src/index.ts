import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { log } from "./logger.js";
import { NodeRouterOsClient } from "./routeros/node-client.js";

const config = loadConfig();
const client = new NodeRouterOsClient(config);
const app = createApp(config, client);

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.bindHost }, (info) => {
  log.info("connector_listening", {
    host: config.bindHost,
    port: info.port,
    mode: config.mode,
    mikrotikHost: config.mikrotikHost,
    mikrotikApiPort: config.mikrotikApiPort,
    note: "Requires always-on WireGuard peer .5 to reach RouterOS; Cloudflare Workers cannot host WireGuard"
  });
});

async function shutdown(signal: string) {
  log.info("connector_stopping", { signal });
  try {
    await client.close();
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
