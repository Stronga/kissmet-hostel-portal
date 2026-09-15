import { apiRequest } from "./client";
import type {
  ConnectorHealth,
  DataEnvelope,
  EligibleResident,
  InternetAccount,
  InternetSession,
  InternetSummary,
  ListEnvelope,
  Pagination
} from "../types/api";

export async function listInternetAccounts(params: {
  limit?: number;
  offset?: number;
  search?: string;
  status?: string;
  syncStatus?: string;
} = {}): Promise<{ accounts: InternetAccount[]; pagination: Pagination }> {
  const query = new URLSearchParams({
    limit: String(params.limit ?? 25),
    offset: String(params.offset ?? 0)
  });
  if (params.search) query.set("search", params.search);
  if (params.status && params.status !== "all") query.set("status", params.status);
  if (params.syncStatus && params.syncStatus !== "all") query.set("sync_status", params.syncStatus);
  const response = await apiRequest<ListEnvelope<InternetAccount>>(`/admin/internet-access?${query.toString()}`);
  return { accounts: response.data, pagination: response.pagination };
}

export async function getInternetSummary() {
  return (await apiRequest<DataEnvelope<InternetSummary>>("/admin/internet-access/summary")).data;
}

export async function getConnectorHealth() {
  return (await apiRequest<DataEnvelope<ConnectorHealth>>("/admin/internet-access/connector-health")).data;
}

export async function searchEligibleResidents(params: { limit?: number; offset?: number; search?: string } = {}) {
  const query = new URLSearchParams({
    limit: String(params.limit ?? 25),
    offset: String(params.offset ?? 0)
  });
  if (params.search) query.set("search", params.search);
  const response = await apiRequest<ListEnvelope<EligibleResident>>(`/admin/internet-access/eligible-residents?${query.toString()}`);
  return { residents: response.data, pagination: response.pagination };
}

export async function getInternetAccount(id: number) {
  return (await apiRequest<DataEnvelope<InternetAccount>>(`/admin/internet-access/${id}`)).data;
}

export async function listInternetSessions(id: number) {
  return (await apiRequest<DataEnvelope<InternetSession[]>>(`/admin/internet-access/${id}/sessions`)).data;
}

export async function provisionInternet(residentId: number) {
  return (await apiRequest<DataEnvelope<InternetAccount & { password?: string; provision_error?: string }>>(
    `/admin/internet-access/residents/${residentId}/provision`,
    { method: "POST" }
  )).data;
}

export async function enableInternet(id: number) {
  return (await apiRequest<DataEnvelope<InternetAccount>>(`/admin/internet-access/${id}/enable`, { method: "POST" })).data;
}

export async function suspendInternet(id: number) {
  return (await apiRequest<DataEnvelope<InternetAccount>>(`/admin/internet-access/${id}/suspend`, { method: "POST" })).data;
}

export async function resetInternetPassword(id: number) {
  return (await apiRequest<DataEnvelope<InternetAccount & { password?: string }>>(
    `/admin/internet-access/${id}/reset-password`,
    { method: "POST" }
  )).data;
}

export async function disconnectInternetSessions(id: number) {
  return (await apiRequest<DataEnvelope<{ account: InternetAccount; disconnected: number }>>(
    `/admin/internet-access/${id}/disconnect`,
    { method: "POST" }
  )).data;
}

export async function retryInternetSync(id: number) {
  return (await apiRequest<DataEnvelope<InternetAccount & { password?: string }>>(
    `/admin/internet-access/${id}/retry-sync`,
    { method: "POST" }
  )).data;
}

export async function ensureInternetProfile() {
  return (await apiRequest<DataEnvelope<{ profile: { name: string; sharedUsers: number }; created: boolean }>>(
    "/admin/internet-access/ensure-profile",
    { method: "POST" }
  )).data;
}
