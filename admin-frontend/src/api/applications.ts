import { apiRequest } from "./client";
import { getResident } from "./residents";
import type { AcademicSession, Application, ApplicationStatus, DataEnvelope, IdentityDocument, ListEnvelope, Resident } from "../types/api";

export async function listApplications(params: { limit: number; offset: number; search?: string }) {
  const query = new URLSearchParams({
    limit: String(params.limit),
    offset: String(params.offset)
  });
  if (params.search) query.set("search", params.search);
  const response = await apiRequest<ListEnvelope<Application>>(`/admin/applications?${query.toString()}`);
  return { applications: response.data, pagination: response.pagination };
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
  const response = await apiRequest<DataEnvelope<IdentityDocument[]>>("/admin/documents");
  return response.data;
}

export { getResident };
export type { Resident };
