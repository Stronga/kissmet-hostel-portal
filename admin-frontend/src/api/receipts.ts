import { apiRequest } from "./client";
import type { DataEnvelope, ListEnvelope, Receipt, ReceiptDetailData } from "../types/api";

export async function listReceipts(params: { limit?: number; offset?: number; search?: string } = {}) {
  const searchParams = new URLSearchParams();
  searchParams.set("limit", String(params.limit ?? 25));
  searchParams.set("offset", String(params.offset ?? 0));
  if (params.search) searchParams.set("search", params.search);
  const response = await apiRequest<ListEnvelope<Receipt>>(`/admin/receipts?${searchParams.toString()}`);
  return { receipts: response.data, pagination: response.pagination };
}

export async function getReceipt(id: number) {
  const response = await apiRequest<DataEnvelope<ReceiptDetailData>>(`/admin/receipts/${id}`);
  return response.data;
}

export async function issueReceipt(paymentId: number) {
  const response = await apiRequest<DataEnvelope<ReceiptDetailData>>(`/admin/payments/${paymentId}/receipt`, { method: "POST", body: JSON.stringify({}) });
  return response.data;
}

export async function voidReceipt(id: number, reason?: string) {
  const response = await apiRequest<DataEnvelope<ReceiptDetailData>>(`/admin/receipts/${id}/void`, { method: "POST", body: JSON.stringify({ reason }) });
  return response.data;
}
