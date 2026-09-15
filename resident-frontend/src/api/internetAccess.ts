import { apiRequest } from "./client";

export type ResidentInternetStatus = "active" | "suspended" | "disabled";
export type ResidentInternetSyncStatus = "pending" | "synced" | "failed";

export interface ResidentInternetAccess {
  hasAccess: boolean;
  status: ResidentInternetStatus | null;
  internetId: string | null;
  deviceLimit: number;
  syncStatus: ResidentInternetSyncStatus | null;
}

export interface ResidentInternetSessions {
  activeCount: number | null;
  deviceLimit: number;
}

export function fetchResidentInternetAccess() {
  return apiRequest<{ ok: true; data: ResidentInternetAccess }>("/resident/me/internet-access");
}

export function fetchResidentInternetSessions() {
  return apiRequest<{ ok: true; data: ResidentInternetSessions }>("/resident/me/internet-access/sessions");
}
