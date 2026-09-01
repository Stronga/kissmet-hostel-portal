import { apiRequest } from "./client";
import type { CreateStaffInput, CreateStaffResult, DataEnvelope, ListEnvelope, ResetStaffPasswordResult, RoleCode, Staff } from "../types/api";

export async function listStaff(params: { limit?: number; offset?: number; search?: string } = {}) {
  const query = new URLSearchParams({ limit: String(params.limit ?? 25), offset: String(params.offset ?? 0) });
  if (params.search) query.set("search", params.search);
  const response = await apiRequest<ListEnvelope<Staff>>(`/admin/staff?${query}`);
  return { staff: response.data, pagination: response.pagination };
}

export async function getStaff(id: number) {
  return (await apiRequest<DataEnvelope<Staff>>(`/admin/staff/${id}`)).data;
}

export async function createStaff(input: CreateStaffInput) {
  return (await apiRequest<DataEnvelope<CreateStaffResult>>("/admin/staff", { method: "POST", body: JSON.stringify(input) })).data;
}

export async function changeStaffRole(id: number, roleId: number) {
  return (await apiRequest<DataEnvelope<Staff>>(`/admin/staff/${id}/role`, { method: "PATCH", body: JSON.stringify({ roleId }) })).data;
}

export async function changeStaffStatus(id: number, status: "active" | "inactive" | "archived") {
  return (await apiRequest<DataEnvelope<Staff>>(`/admin/staff/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) })).data;
}

export async function changeStaffAccountStatus(id: number, status: "active" | "inactive" | "suspended" | "archived") {
  return (await apiRequest<DataEnvelope<Staff>>(`/admin/staff/${id}/account-status`, { method: "PATCH", body: JSON.stringify({ status }) })).data;
}

export async function resetStaffPassword(id: number) {
  return (await apiRequest<DataEnvelope<ResetStaffPasswordResult>>(`/admin/staff/${id}/reset-password`, { method: "POST" })).data;
}

export async function listRoles() {
  const response = await apiRequest<ListEnvelope<{ id: number; code: RoleCode; name: string }>>("/admin/roles?limit=100&offset=0");
  return response.data.filter((role) => role.code !== "resident");
}
