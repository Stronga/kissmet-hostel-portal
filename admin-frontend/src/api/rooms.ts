import { apiRequest } from "./client";
import type { AcademicSession, Allocation, Bed, DataEnvelope, ListEnvelope, OccupancyReport, Room, RoomRate } from "../types/api";

export async function listRooms() {
  const response = await apiRequest<ListEnvelope<Room>>("/admin/rooms?limit=100&offset=0");
  return response.data;
}

export async function getRoom(id: number) {
  const response = await apiRequest<DataEnvelope<Room>>(`/admin/rooms/${id}`);
  return response.data;
}

export async function createRoom(input: { roomCode: string; roomName?: string | null; floor?: string | null; capacity: number; genderPolicy?: string; status?: string }) {
  const response = await apiRequest<DataEnvelope<Room>>("/admin/rooms", { method: "POST", body: JSON.stringify(input) });
  return response.data;
}

export async function updateRoomStatus(id: number, status: string) {
  const response = await apiRequest<DataEnvelope<Room>>(`/admin/rooms/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
  return response.data;
}

export async function listRoomBeds(roomId: number) {
  const response = await apiRequest<ListEnvelope<Bed>>(`/admin/rooms/${roomId}/beds?limit=100&offset=0`);
  return response.data;
}

export async function createBed(input: { roomId: number; bedCode: string; label: string; status?: string }) {
  const response = await apiRequest<DataEnvelope<Bed>>("/admin/beds", { method: "POST", body: JSON.stringify(input) });
  return response.data;
}

export async function updateBedStatus(id: number, status: string) {
  const response = await apiRequest<DataEnvelope<Bed>>(`/admin/beds/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
  return response.data;
}

export async function listRoomRates() {
  const response = await apiRequest<ListEnvelope<RoomRate>>("/admin/room-rates?limit=100&offset=0");
  return response.data;
}

export async function createRoomRate(input: { roomId: number; academicSessionId: number; rateCode: string; amountMinor: number; currency?: string; status?: string }) {
  const response = await apiRequest<DataEnvelope<RoomRate>>("/admin/room-rates", { method: "POST", body: JSON.stringify(input) });
  return response.data;
}

export async function updateRoomRateStatus(id: number, status: string) {
  const response = await apiRequest<DataEnvelope<RoomRate>>(`/admin/room-rates/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
  return response.data;
}

export async function listAcademicSessions() {
  const response = await apiRequest<ListEnvelope<AcademicSession>>("/admin/academic-sessions?limit=100&offset=0");
  return response.data;
}

export async function occupancyReport() {
  const response = await apiRequest<DataEnvelope<OccupancyReport>>("/admin/dashboard/occupancy");
  return response.data;
}

export async function listAllocations() {
  const response = await apiRequest<ListEnvelope<Allocation>>("/admin/allocations?limit=100&offset=0");
  return response.data;
}
