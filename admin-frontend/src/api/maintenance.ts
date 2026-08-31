import { apiRequest } from "./client";
import type { DataEnvelope, ListEnvelope, MaintenanceCategory, MaintenancePriority, MaintenanceReport, MaintenanceRequest, Pagination, Staff } from "../types/api";

export async function listMaintenance(params: { limit?: number; offset?: number; search?: string } = {}): Promise<{ requests: MaintenanceRequest[]; pagination: Pagination }> {
  const query = new URLSearchParams({ limit: String(params.limit ?? 25), offset: String(params.offset ?? 0) });
  if (params.search) query.set("search", params.search);
  const response = await apiRequest<ListEnvelope<MaintenanceRequest>>(`/admin/maintenance?${query.toString()}`);
  return { requests: response.data, pagination: response.pagination };
}

export async function getMaintenance(id: number) {
  return (await apiRequest<DataEnvelope<MaintenanceRequest>>(`/admin/maintenance/${id}`)).data;
}

export async function createMaintenance(input: { residentId?: number; roomId?: number; bedId?: number; category: MaintenanceCategory; priority?: MaintenancePriority; title: string; description?: string }) {
  return (await apiRequest<DataEnvelope<MaintenanceRequest>>("/admin/maintenance", { method: "POST", body: JSON.stringify(input) })).data;
}

export async function assignMaintenance(id: number, staffId: number) {
  return (await apiRequest<DataEnvelope<MaintenanceRequest>>(`/admin/maintenance/${id}/assign`, { method: "POST", body: JSON.stringify({ staffId }) })).data;
}

export async function startMaintenance(id: number) {
  return (await apiRequest<DataEnvelope<MaintenanceRequest>>(`/admin/maintenance/${id}/start`, { method: "POST", body: JSON.stringify({}) })).data;
}

export async function resolveMaintenance(id: number) {
  return (await apiRequest<DataEnvelope<MaintenanceRequest>>(`/admin/maintenance/${id}/resolve`, { method: "POST", body: JSON.stringify({}) })).data;
}

export async function closeMaintenance(id: number) {
  return (await apiRequest<DataEnvelope<MaintenanceRequest>>(`/admin/maintenance/${id}/close`, { method: "POST", body: JSON.stringify({}) })).data;
}

export async function cancelMaintenance(id: number) {
  return (await apiRequest<DataEnvelope<MaintenanceRequest>>(`/admin/maintenance/${id}/cancel`, { method: "POST", body: JSON.stringify({}) })).data;
}

export async function getMaintenanceReport() {
  return (await apiRequest<DataEnvelope<MaintenanceReport>>("/admin/dashboard/maintenance")).data;
}

export async function listStaff() {
  return (await apiRequest<ListEnvelope<Staff>>("/admin/staff?limit=100&offset=0")).data;
}
