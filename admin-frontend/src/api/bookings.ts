import { apiRequest } from "./client";
import type { AvailabilityBed, Booking, BookingPaymentSummary, BookingStatus, DataEnvelope, ListEnvelope, Room, RoomRate } from "../types/api";

export async function listBookings(params: { limit: number; offset: number; search?: string }) {
  const query = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset) });
  if (params.search) query.set("search", params.search);
  const response = await apiRequest<ListEnvelope<Booking>>(`/admin/bookings?${query.toString()}`);
  return { bookings: response.data, pagination: response.pagination };
}

export async function getBooking(id: number) {
  const response = await apiRequest<DataEnvelope<Booking>>(`/admin/bookings/${id}`);
  return response.data;
}

export async function createBooking(input: { applicationId: number; roomId: number }) {
  const response = await apiRequest<DataEnvelope<Booking>>("/admin/bookings", {
    method: "POST",
    body: JSON.stringify(input)
  });
  return response.data;
}

export async function updateBookingStatus(id: number, status: BookingStatus) {
  const response = await apiRequest<DataEnvelope<Booking>>(`/admin/bookings/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status })
  });
  return response.data;
}

export async function bookingPaymentSummary(id: number) {
  const response = await apiRequest<DataEnvelope<BookingPaymentSummary>>(`/admin/bookings/${id}/payment-summary`);
  return response.data;
}

export async function listAvailability(academicSessionId: number, residentId?: number) {
  const query = new URLSearchParams({ academicSessionId: String(academicSessionId) });
  if (residentId) query.set("residentId", String(residentId));
  const response = await apiRequest<DataEnvelope<AvailabilityBed[]>>(`/admin/availability?${query.toString()}`);
  return response.data;
}

export async function listRooms() {
  const response = await apiRequest<ListEnvelope<Room>>("/admin/rooms?limit=100&offset=0");
  return response.data;
}

export async function listRoomRates() {
  const response = await apiRequest<ListEnvelope<RoomRate>>("/admin/room-rates?limit=100&offset=0");
  return response.data;
}
