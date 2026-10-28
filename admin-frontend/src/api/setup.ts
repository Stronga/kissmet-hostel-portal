import { apiRequest } from "./client";
import type {
  AcademicSession,
  DataEnvelope,
  Institution,
  LeasePeriod,
  ListEnvelope,
  RateCard
} from "../types/api";

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

export async function listLeasePeriods() {
  return (await apiRequest<ListEnvelope<LeasePeriod>>("/admin/lease-periods?limit=100&offset=0")).data;
}

export async function createLeasePeriod(input: {
  kind: string;
  code: string;
  name: string;
  startsOn: string;
  endsOn: string;
  status?: string;
  academicSessionId?: number | null;
  notes?: string | null;
}) {
  return (await apiRequest<DataEnvelope<LeasePeriod>>("/admin/lease-periods", {
    method: "POST",
    body: JSON.stringify(input)
  })).data;
}

export async function updateLeasePeriod(
  id: number,
  input: {
    name?: string;
    startsOn?: string;
    endsOn?: string;
    academicSessionId?: number | null;
    notes?: string | null;
  }
) {
  return (await apiRequest<DataEnvelope<LeasePeriod>>(`/admin/lease-periods/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  })).data;
}

export async function updateLeasePeriodStatus(id: number, status: string) {
  return (await apiRequest<DataEnvelope<LeasePeriod>>(`/admin/lease-periods/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status })
  })).data;
}

export async function listRateCards() {
  return (await apiRequest<ListEnvelope<RateCard>>("/admin/rate-cards?limit=100&offset=0")).data;
}

export async function createRateCard(input: {
  leasePeriodId: number;
  occupancyCapacity: number;
  rateCode: string;
  amountMinor: number;
  currency?: string;
  packageMonths?: number | null;
  status?: string;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  notes?: string | null;
}) {
  return (await apiRequest<DataEnvelope<RateCard>>("/admin/rate-cards", {
    method: "POST",
    body: JSON.stringify(input)
  })).data;
}

export async function updateRateCard(
  id: number,
  input: {
    amountMinor?: number;
    packageMonths?: number | null;
    effectiveFrom?: string | null;
    effectiveTo?: string | null;
    notes?: string | null;
  }
) {
  return (await apiRequest<DataEnvelope<RateCard>>(`/admin/rate-cards/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  })).data;
}

export async function updateRateCardStatus(id: number, status: string) {
  return (await apiRequest<DataEnvelope<RateCard>>(`/admin/rate-cards/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status })
  })).data;
}
