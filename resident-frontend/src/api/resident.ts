import { apiRequest } from "./client";
import type { ResidentAllocation, ResidentApplication, ResidentBooking, ResidentDocument, ResidentProfile } from "../types/resident";

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

export function fetchResidentBookings() {
  return apiRequest<{ ok: true; data: ResidentBooking[] }>("/resident/me/bookings");
}

export function fetchResidentAllocation() {
  return apiRequest<{ ok: true; data: ResidentAllocation | null }>("/resident/me/allocation");
}
