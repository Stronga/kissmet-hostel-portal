import type { MaintenanceCategory, MaintenancePriority, MaintenanceStatus, ResidentMaintenanceRequest } from "../types/resident";
import { statusLabel } from "./format";

export const maintenanceCategories: MaintenanceCategory[] = ["plumbing", "electrical", "furniture", "cleaning", "security", "other"];
export const maintenancePriorities: MaintenancePriority[] = ["low", "normal", "high", "urgent"];

const activeStatuses = new Set<MaintenanceStatus>(["open", "assigned", "in_progress"]);

export function maintenanceStatusLabel(status: MaintenanceStatus | string) {
  return statusLabel(status);
}

export function maintenanceCategoryLabel(category: MaintenanceCategory | string) {
  return statusLabel(category);
}

export function maintenancePriorityLabel(priority: MaintenancePriority | string) {
  if (priority === "normal") return "Normal";
  return statusLabel(priority);
}

export function isActiveMaintenance(status: MaintenanceStatus | string) {
  return activeStatuses.has(status as MaintenanceStatus);
}

export function splitMaintenanceRequests(requests: ResidentMaintenanceRequest[]) {
  return {
    active: requests.filter((request) => isActiveMaintenance(request.status)),
    history: requests.filter((request) => !isActiveMaintenance(request.status))
  };
}

export function maintenanceLocation(request: ResidentMaintenanceRequest) {
  const room = request.room_name ? `${request.room_code ?? ""} - ${request.room_name}`.trim().replace(/^-\s*/, "") : request.room_code;
  const bed = request.bed_label ? `${request.bed_label} (${request.bed_code ?? "bed code unavailable"})` : request.bed_code;
  if (room && bed) return `${room} / ${bed}`;
  return room ?? bed ?? "General hostel issue";
}
