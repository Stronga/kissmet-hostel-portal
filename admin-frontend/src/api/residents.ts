import { apiRequest } from "./client";
import type { CreateResidentInput, DataEnvelope, Institution, ListEnvelope, Pagination, Resident } from "../types/api";

export interface ResidentListParams {
  search?: string;
  limit?: number;
  offset?: number;
}

function query(params: ResidentListParams) {
  const search = new URLSearchParams();
  if (params.search) search.set("search", params.search);
  search.set("limit", String(params.limit ?? 25));
  search.set("offset", String(params.offset ?? 0));
  return search.toString();
}

export async function listResidents(params: ResidentListParams = {}): Promise<{ residents: Resident[]; pagination: Pagination }> {
  const result = await apiRequest<ListEnvelope<Resident>>(`/admin/residents?${query(params)}`);
  return { residents: result.data, pagination: result.pagination };
}

export async function getResident(id: number): Promise<Resident> {
  return (await apiRequest<DataEnvelope<Resident>>(`/admin/residents/${id}`)).data;
}

export async function createResident(input: CreateResidentInput): Promise<Resident> {
  return (await apiRequest<DataEnvelope<Resident>>("/admin/residents", {
    method: "POST",
    body: JSON.stringify(input)
  })).data;
}

export async function listInstitutions(): Promise<Institution[]> {
  return (await apiRequest<ListEnvelope<Institution>>("/admin/institutions?limit=100&offset=0")).data;
}
