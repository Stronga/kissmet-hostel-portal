import type { Bed, MaintenanceRequest, Resident, Room, Staff } from "../../types/api";

export const categories = ["plumbing", "electrical", "furniture", "cleaning", "security", "other"] as const;
export const priorities = ["low", "normal", "high", "urgent"] as const;

export function residentName(resident?: Resident) {
  return resident ? `${resident.first_name} ${resident.last_name}` : "Not available";
}

export function roomLabel(room?: Room) {
  return room ? `${room.room_code}${room.room_name ? ` ${room.room_name}` : ""}` : "Not available";
}

export function bedLabel(bed?: Bed) {
  return bed ? `${bed.bed_code} ${bed.label}` : "Not available";
}

export function staffLabel(staff?: Staff | null) {
  if (!staff) return "Not assigned";
  return `${staff.staff_code}${staff.job_title ? ` (${staff.job_title})` : ""}`;
}

export function canAssign(request: MaintenanceRequest) {
  return request.status === "open" || request.status === "assigned";
}

export function canStart(request: MaintenanceRequest) {
  return request.status === "assigned";
}

export function canResolve(request: MaintenanceRequest) {
  return request.status === "in_progress";
}

export function canClose(request: MaintenanceRequest) {
  return request.status === "resolved";
}

export function canCancel(request: MaintenanceRequest) {
  return request.status === "open" || request.status === "assigned" || request.status === "in_progress";
}
