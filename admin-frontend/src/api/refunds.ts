import { apiRequest } from "./client";
import type { CreditNote, DataEnvelope, Refund, RefundPayoutMethod, RefundReport, RefundStatus } from "../types/api";

/** Creates a refund REQUEST (partial when amountMinor is set, otherwise the full refundable remainder). */
export async function requestRefund(paymentId: number, input: { amountMinor?: number; reason: string }) {
  return (await apiRequest<DataEnvelope<Refund>>(`/admin/payments/${paymentId}/refund`, { method: "POST", body: JSON.stringify(input) })).data;
}

export async function paymentRefunds(paymentId: number) {
  return (await apiRequest<DataEnvelope<{ refundable: { amountMinor: number; refundedMinor: number; openRefundMinor: number; refundableMinor: number }; refunds: Refund[] }>>(`/admin/payments/${paymentId}/refunds`)).data;
}

export async function listRefunds(status?: RefundStatus | "all") {
  const query = new URLSearchParams({ limit: "100", offset: "0" });
  if (status && status !== "all") query.set("status", status);
  const response = await apiRequest<DataEnvelope<Refund[]> & { pagination?: { total?: number } }>(`/admin/refunds?${query.toString()}`);
  return { refunds: response.data, total: response.pagination?.total };
}

export async function getRefund(id: number) {
  return (await apiRequest<DataEnvelope<Refund>>(`/admin/refunds/${id}`)).data;
}

export async function approveRefund(id: number, note?: string) {
  return (await apiRequest<DataEnvelope<Refund>>(`/admin/refunds/${id}/approve`, { method: "POST", body: JSON.stringify({ note: note || undefined }) })).data;
}

export async function rejectRefund(id: number, note?: string) {
  return (await apiRequest<DataEnvelope<Refund>>(`/admin/refunds/${id}/reject`, { method: "POST", body: JSON.stringify({ note: note || undefined }) })).data;
}

export async function cancelRefund(id: number, note?: string) {
  return (await apiRequest<DataEnvelope<Refund>>(`/admin/refunds/${id}/cancel`, { method: "POST", body: JSON.stringify({ note: note || undefined }) })).data;
}

export async function payoutRefund(id: number, input: { method: RefundPayoutMethod; reference: string }) {
  return (await apiRequest<DataEnvelope<{ refund: Refund; summary: unknown }>>(`/admin/refunds/${id}/payout`, { method: "POST", body: JSON.stringify(input) })).data;
}

export async function listCreditNotes() {
  return (await apiRequest<DataEnvelope<CreditNote[]>>("/admin/credit-notes?limit=100&offset=0")).data;
}

export async function refundReport(params: { dateFrom?: string; dateTo?: string; status?: RefundStatus } = {}) {
  const query = new URLSearchParams();
  if (params.dateFrom) query.set("dateFrom", params.dateFrom);
  if (params.dateTo) query.set("dateTo", params.dateTo);
  if (params.status) query.set("status", params.status);
  const qs = query.toString();
  return (await apiRequest<DataEnvelope<RefundReport>>(`/admin/reports/refunds${qs ? `?${qs}` : ""}`)).data;
}
