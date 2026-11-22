import type { ConnectorPresence, ConnectorStatus, ConnectorStatusEntry } from "../../types/api";

export const ONLINE_AGE_SECONDS = 120;

export function connectorPresence(ageSeconds: number | null | undefined, staleAfterSeconds: number): ConnectorPresence {
  if (ageSeconds == null || !Number.isFinite(ageSeconds)) return "offline";
  if (ageSeconds < ONLINE_AGE_SECONDS) return "online";
  if (ageSeconds <= staleAfterSeconds) return "stale";
  return "offline";
}

export function primaryConnector(status: ConnectorStatus | null): ConnectorStatusEntry | null {
  return status?.connectors[0] ?? null;
}

export function formatAge(ageSeconds: number): string {
  if (ageSeconds < 60) return `${ageSeconds}s ago`;
  const minutes = Math.floor(ageSeconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function presenceLabel(presence: ConnectorPresence): string {
  if (presence === "online") return "Online";
  if (presence === "stale") return "Stale";
  return "Offline";
}
