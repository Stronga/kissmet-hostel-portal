import { apiRequest } from "./client";
import type { AcademicSession, MaintenanceCategory, MaintenancePriority, ResidentAllocation, ResidentApplication, ResidentBooking, ResidentDocument, ResidentMaintenanceRequest, ResidentPayment, ResidentPaymentSummary, ResidentProfile, ResidentReceipt } from "../types/resident";

export function fetchResidentProfile() {
  return apiRequest<{ ok: true; data: ResidentProfile }>("/resident/me");
}

export function updateResidentProfile(input: { firstName?: string; middleName?: string | null; lastName?: string; email?: string | null }) {
  return apiRequest<{ ok: true; data: ResidentProfile }>("/resident/me", {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function fetchResidentDocuments() {
  return apiRequest<{ ok: true; data: ResidentDocument[] }>("/resident/me/documents");
}

export function uploadResidentIdentityDocument(type: "student_card" | "ghana_card", file: File) {
  const formData = new FormData();
  formData.append("file", file);
  const path = type === "student_card" ? "/resident/me/documents/student-card" : "/resident/me/documents/ghana-card";
  return apiRequest<{ ok: true; data: ResidentDocument }>(path, { method: "POST", body: formData });
}

export function fetchResidentApplications() {
  return apiRequest<{ ok: true; data: ResidentApplication[] }>("/resident/me/applications");
}

export function fetchActiveAcademicSession() {
  return apiRequest<{ ok: true; data: AcademicSession | null }>("/resident/me/academic-session");
}

export function createResidentApplication(academicSessionId: number) {
  return apiRequest<{ ok: true; data: ResidentApplication }>("/resident/me/applications", {
    method: "POST",
    body: JSON.stringify({ academicSessionId })
  });
}

export function fetchResidentApplication(id: number) {
  return apiRequest<{ ok: true; data: ResidentApplication }>(`/resident/me/applications/${id}`);
}

export function updateResidentApplication(id: number, notes?: string | null) {
  return apiRequest<{ ok: true; data: ResidentApplication }>(`/resident/me/applications/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ notes })
  });
}

export function submitResidentApplication(id: number) {
  return apiRequest<{ ok: true; data: ResidentApplication }>(`/resident/me/applications/${id}/submit`, { method: "POST" });
}

export function fetchResidentBookings() {
  return apiRequest<{ ok: true; data: ResidentBooking[] }>("/resident/me/bookings");
}

export function fetchResidentPayments() {
  return apiRequest<{ ok: true; data: ResidentPayment[] }>("/resident/me/payments");
}

export function fetchResidentPaymentSummary() {
  return apiRequest<{ ok: true; data: ResidentPaymentSummary | null }>("/resident/me/payments/summary");
}

export function createResidentPayment(input: { bookingId: number; amountMinor: number; currency: string; method: string; paidAt?: string | null; notes?: string | null }) {
  return apiRequest<{ ok: true; data: ResidentPayment }>("/resident/me/payments", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function submitResidentPayment(id: number) {
  return apiRequest<{ ok: true; data: ResidentPayment }>(`/resident/me/payments/${id}/submit`, { method: "POST" });
}

export function uploadResidentPaymentSlip(id: number, file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return apiRequest<{ ok: true; data: ResidentDocument }>(`/resident/me/payments/${id}/slip`, { method: "POST", body: formData });
}

export function fetchResidentReceipts() {
  return apiRequest<{ ok: true; data: ResidentReceipt[] }>("/resident/me/receipts");
}

export function fetchResidentAllocation() {
  return apiRequest<{ ok: true; data: ResidentAllocation | null }>("/resident/me/allocation");
}

export function fetchResidentAllocations() {
  return apiRequest<{ ok: true; data: ResidentAllocation[] }>("/resident/me/allocations");
}

export function fetchResidentMaintenance() {
  return apiRequest<{ ok: true; data: ResidentMaintenanceRequest[] }>("/resident/me/maintenance");
}

export function createResidentMaintenance(input: { category: MaintenanceCategory; priority: MaintenancePriority; title: string; description?: string | null }) {
  return apiRequest<{ ok: true; data: ResidentMaintenanceRequest }>("/resident/me/maintenance", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function fetchResidentMaintenanceRequest(id: number) {
  return apiRequest<{ ok: true; data: ResidentMaintenanceRequest }>(`/resident/me/maintenance/${id}`);
}
