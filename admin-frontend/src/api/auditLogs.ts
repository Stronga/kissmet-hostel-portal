import { apiRequest } from "./client";
import type { AuditLog, DataEnvelope, ListEnvelope, Pagination } from "../types/api";

export interface AuditLogFilters {
  limit?: number;
  offset?: number;
  search?: string;
  actorUserId?: string;
  actorStaffId?: string;
  action?: string;
  entityType?: string;
  dateFrom?: string;
  dateTo?: string;
}

export async function listAuditLogs(params: AuditLogFilters = {}): Promise<{ logs: AuditLog[]; pagination: Pagination }> {
  const query = new URLSearchParams({ limit: String(params.limit ?? 25), offset: String(params.offset ?? 0) });
  if (params.search) query.set("search", params.search);
  if (params.actorUserId) query.set("actorUserId", params.actorUserId);
  if (params.actorStaffId) query.set("actorStaffId", params.actorStaffId);
  if (params.action) query.set("action", params.action);
  if (params.entityType) query.set("entityType", params.entityType);
  if (params.dateFrom) query.set("dateFrom", params.dateFrom);
  if (params.dateTo) query.set("dateTo", params.dateTo);
  const response = await apiRequest<ListEnvelope<AuditLog>>(`/admin/audit-logs?${query}`);
  return { logs: response.data, pagination: response.pagination };
}

export async function getAuditLog(id: number) {
  return (await apiRequest<DataEnvelope<AuditLog>>(`/admin/audit-logs/${id}`)).data;
}
