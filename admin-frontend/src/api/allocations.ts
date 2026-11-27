import { apiRequest } from "./client";
import type { Allocation, AvailabilityBed, Bed, Booking, BookingAgreementResponse, DataEnvelope, ListEnvelope, Pagination } from "../types/api";

export async function listAllocations(params: { limit?: number; offset?: number; search?: string; status?: string; academicSessionId?: string; leasePeriodId?: string } = {}): Promise<{ allocations: Allocation[]; pagination: Pagination; counts?: Record<string, number> }> {
  const query = new URLSearchParams({ limit: String(params.limit ?? 25), offset: String(params.offset ?? 0) });
  if (params.search) query.set("search", params.search);
  if (params.status && params.status !== "all" && params.status !== "none") query.set("status", params.status);
  if (params.academicSessionId && params.academicSessionId !== "all" && params.academicSessionId !== "none") query.set("academicSessionId", params.academicSessionId);
  if (params.leasePeriodId) query.set("leasePeriodId", params.leasePeriodId);
  const response = await apiRequest<ListEnvelope<Allocation> & { counts?: Record<string, number> }>(`/admin/allocations?${query.toString()}`);
  return { allocations: response.data, pagination: response.pagination, counts: response.counts };
}

export async function getAllocation(id: number) {
  return (await apiRequest<DataEnvelope<Allocation>>(`/admin/allocations/${id}`)).data;
}

export async function createAllocation(input: { bookingId: number; bedId: number; startsOn: string; endsOn?: string; notes?: string; residentId?: number; academicSessionId?: number | null }) {
  return (await apiRequest<DataEnvelope<Allocation>>("/admin/allocations", { method: "POST", body: JSON.stringify(input) })).data;
}

export async function transferAllocation(id: number, input: { destinationBedId: number; startsOn: string; endsOn?: string; notes?: string }) {
  return (await apiRequest<DataEnvelope<Allocation>>(`/admin/allocations/${id}/transfer`, { method: "POST", body: JSON.stringify(input) })).data;
}

export async function updateAllocationStatus(id: number, status: "ended" | "cancelled" | "archived") {
  return (await apiRequest<DataEnvelope<Allocation>>(`/admin/allocations/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) })).data;
}

/** Legacy session-based availability (Path A). */
export async function listAvailability(academicSessionId: number, residentId?: number) {
  const query = new URLSearchParams({ academicSessionId: String(academicSessionId) });
  if (residentId) query.set("residentId", String(residentId));
  return (await apiRequest<DataEnvelope<AvailabilityBed[]>>(`/admin/availability?${query.toString()}`)).data;
}

/** Agreement-aware availability by booking + proposed dates. */
export async function listAgreementAvailability(bookingId: number, startsOn: string, endsOn?: string) {
  const query = new URLSearchParams({ bookingId: String(bookingId), startsOn });
  if (endsOn) query.set("endsOn", endsOn);
  return (await apiRequest<DataEnvelope<AvailabilityBed[]>>(`/admin/availability?${query.toString()}`)).data;
}

export async function listRoomBeds(roomId: number) {
  return (await apiRequest<ListEnvelope<Bed>>(`/admin/rooms/${roomId}/beds?limit=100&offset=0`)).data;
}

export async function getBooking(id: number) {
  return (await apiRequest<DataEnvelope<Booking>>(`/admin/bookings/${id}`)).data;
}

export async function crossRoomTransferAllocation(id: number, input: {
  destinationBedId: number;
  startsOn: string;
  endsOn?: string | null;
  notes?: string | null;
  reason: string;
  agreedAmountMinor?: number;
  maintenanceFeeMinor?: number | null;
}) {
  const response = await apiRequest<DataEnvelope<{ allocation: Allocation; agreement: BookingAgreementResponse }>>(`/admin/allocations/${id}/cross-room-transfer`, {
    method: "POST",
    body: JSON.stringify(input)
  });
  return response.data;
}
