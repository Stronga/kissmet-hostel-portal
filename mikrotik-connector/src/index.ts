import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { log } from "./logger.js";
import { NodeRouterOsClient } from "./routeros/node-client.js";

const config = loadConfig();
const client = new NodeRouterOsClient(config);
const app = createApp(config, client);

serve({ fetch: app.fetch, port: config.port }, (info) => {
  log.info("connector_listening", {
    port: info.port,
    mikrotikHost: config.mikrotikHost,
    mikrotikApiPort: config.mikrotikApiPort,
    note: "Requires always-on WireGuard peer .5 to reach RouterOS; Cloudflare Workers cannot host WireGuard"
  });
});
