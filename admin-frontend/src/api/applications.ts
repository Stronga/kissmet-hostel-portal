import { apiDownload, apiRequest } from "./client";
import { getResident } from "./residents";
import type { AcademicSession, Application, ApplicationStatus, DataEnvelope, IdentityDocumentList, ListEnvelope, Resident } from "../types/api";

export async function listApplications(params: { limit: number; offset: number; search?: string; status?: string; queue?: string; academicSessionId?: string; leasePeriodId?: string }) {
  const query = new URLSearchParams({
    limit: String(params.limit),
    offset: String(params.offset)
  });
  if (params.search) query.set("search", params.search);
  if (params.status && params.status !== "all") query.set("status", params.status);
  if (params.queue) query.set("queue", params.queue);
  if (params.academicSessionId && params.academicSessionId !== "all") query.set("academicSessionId", params.academicSessionId);
  if (params.leasePeriodId) query.set("leasePeriodId", params.leasePeriodId);
  const response = await apiRequest<ListEnvelope<Application> & { counts?: Record<string, number> }>(`/admin/applications?${query.toString()}`);
  return { applications: response.data, pagination: response.pagination, counts: response.counts };
}

export async function getApplication(id: number) {
  const response = await apiRequest<DataEnvelope<Application>>(`/admin/applications/${id}`);
  return response.data;
}

export async function updateApplicationStatus(id: number, status: ApplicationStatus, notes?: string) {
  const response = await apiRequest<DataEnvelope<Application>>(`/admin/applications/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status, notes: notes || undefined })
  });
  return response.data;
}

export async function listAcademicSessions() {
  const response = await apiRequest<ListEnvelope<AcademicSession>>("/admin/academic-sessions?limit=100&offset=0");
  return response.data;
}

export async function listIdentityDocuments() {
  const response = await apiRequest<DataEnvelope<IdentityDocumentList>>("/admin/documents");
  return response.data;
}

export async function downloadIdentityDocument(id: number) {
  return apiDownload(`/admin/documents/${id}/content`);
}

export { getResident };
export type { Resident };
