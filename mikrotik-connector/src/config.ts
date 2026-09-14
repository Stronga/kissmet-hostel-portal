export interface ConnectorConfig {
  port: number;
  connectorSecret: string;
  mikrotikHost: string;
  mikrotikApiPort: number;
  mikrotikApiUser: string;
  mikrotikApiPassword: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ConnectorConfig {
  const connectorSecret = env.CONNECTOR_SECRET?.trim() || env.MIKROTIK_CONNECTOR_SECRET?.trim();
  if (!connectorSecret) {
    throw new Error("CONNECTOR_SECRET is required");
  }

  return {
    port: Number(env.PORT ?? "8788"),
    connectorSecret,
    mikrotikHost: env.MIKROTIK_HOST?.trim() || "192.168.88.1",
    mikrotikApiPort: Number(env.MIKROTIK_API_PORT ?? "8728"),
    mikrotikApiUser: env.MIKROTIK_API_USER?.trim() || "portal-api",
    mikrotikApiPassword: env.MIKROTIK_API_PASSWORD ?? ""
  };
}

export const RESIDENT_PROFILE_NAME = "Kissmet-Residents";
export const RESIDENT_SHARED_USERS = 3;
export const DEFAULT_PROFILE_NAME = "default";
