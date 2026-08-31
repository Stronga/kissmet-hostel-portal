import { apiRequest } from "./client";
import type { Booking, BookingPaymentSummary, DataEnvelope, ListEnvelope, Pagination, Payment, PaymentMethod, PaymentStatus } from "../types/api";

export async function listPayments(params: { limit?: number; offset?: number; search?: string } = {}): Promise<{ payments: Payment[]; pagination: Pagination }> {
  const query = new URLSearchParams({ limit: String(params.limit ?? 25), offset: String(params.offset ?? 0) });
  if (params.search) query.set("search", params.search);
  const response = await apiRequest<ListEnvelope<Payment>>(`/admin/payments?${query.toString()}`);
  return { payments: response.data, pagination: response.pagination };
}

export async function getPayment(id: number) {
  return (await apiRequest<DataEnvelope<Payment>>(`/admin/payments/${id}`)).data;
}

export async function createPayment(input: { bookingId: number; residentId: number; amountMinor: number; currency?: string; method: PaymentMethod; paidAt?: string; notes?: string }) {
  return (await apiRequest<DataEnvelope<Payment>>("/admin/payments", { method: "POST", body: JSON.stringify(input) })).data;
}

export async function updatePaymentStatus(id: number, status: PaymentStatus, notes?: string) {
  return (await apiRequest<DataEnvelope<Payment>>(`/admin/payments/${id}/status`, { method: "PATCH", body: JSON.stringify({ status, notes: notes || undefined }) })).data;
}

export async function verifyPayment(id: number, notes?: string) {
  return (await apiRequest<DataEnvelope<{ payment: Payment; summary: BookingPaymentSummary }>>(`/admin/payments/${id}/verify`, { method: "POST", body: JSON.stringify({ notes: notes || undefined }) })).data;
}

export async function rejectPayment(id: number, notes?: string) {
  return (await apiRequest<DataEnvelope<Payment>>(`/admin/payments/${id}/reject`, { method: "POST", body: JSON.stringify({ notes: notes || undefined }) })).data;
}

export async function refundPayment(id: number, notes?: string) {
  return (await apiRequest<DataEnvelope<{ payment: Payment; summary: BookingPaymentSummary }>>(`/admin/payments/${id}/refund`, { method: "POST", body: JSON.stringify({ notes: notes || undefined }) })).data;
}

export async function uploadPaymentSlip(id: number, file: File) {
  const form = new FormData();
  form.set("file", file);
  return (await apiRequest<DataEnvelope<unknown>>(`/admin/payments/${id}/slip`, { method: "POST", body: form })).data;
}

export async function getBooking(id: number) {
  return (await apiRequest<DataEnvelope<Booking>>(`/admin/bookings/${id}`)).data;
}

export async function bookingPaymentSummary(id: number) {
  return (await apiRequest<DataEnvelope<BookingPaymentSummary>>(`/admin/bookings/${id}/payment-summary`)).data;
}
