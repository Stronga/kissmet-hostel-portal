import { apiRequest } from "./client";
import type { AcademicSession, DataEnvelope, Institution } from "../types/api";

export async function createInstitution(input: { code: string; name: string; status?: string }) {
  return (await apiRequest<DataEnvelope<Institution>>("/admin/institutions", {
    method: "POST",
    body: JSON.stringify(input)
  })).data;
}

export async function updateInstitutionStatus(id: number, status: string) {
  return (await apiRequest<DataEnvelope<Institution>>(`/admin/institutions/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status })
  })).data;
}

export async function createAcademicSession(input: {
  code: string;
  name: string;
  startsOn: string;
  endsOn: string;
  status?: string;
}) {
  return (await apiRequest<DataEnvelope<AcademicSession>>("/admin/academic-sessions", {
    method: "POST",
    body: JSON.stringify(input)
  })).data;
}

export async function updateAcademicSessionStatus(id: number, status: string) {
  return (await apiRequest<DataEnvelope<AcademicSession>>(`/admin/academic-sessions/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status })
  })).data;
}
