import type { LeaseKind, RateCardOccupancyCapacity } from "../../types/api";

export const LEASE_KIND_OPTIONS: { value: LeaseKind; label: string }[] = [
  { value: "academic_calendar", label: "Academic Calendar" },
  { value: "calendar_year", label: "Calendar Year" },
  { value: "short_term", label: "Short-Term" }
];

export const OCCUPANCY_OPTIONS: { value: RateCardOccupancyCapacity; label: string }[] = [
  { value: 1, label: "1 Person" },
  { value: 2, label: "2 Persons" },
  { value: 4, label: "4 Persons" }
];

export function leaseKindLabel(kind: string | null | undefined) {
  const match = LEASE_KIND_OPTIONS.find((option) => option.value === kind);
  return match?.label ?? kind ?? "Unknown";
}

export function occupancyLabel(occupancy: number | null | undefined) {
  const match = OCCUPANCY_OPTIONS.find((option) => option.value === occupancy);
  return match?.label ?? (occupancy == null ? "Unknown" : `${occupancy} Persons`);
}

export function leasePeriodStatusActions(status: string): { label: string; status: string }[] {
  if (status === "draft") return [{ label: "Activate", status: "active" }, { label: "Archive", status: "archived" }];
  if (status === "active") return [{ label: "Close", status: "closed" }, { label: "Archive", status: "archived" }];
  if (status === "closed") return [{ label: "Activate", status: "active" }, { label: "Archive", status: "archived" }];
  if (status === "archived") return [{ label: "Set Draft", status: "draft" }, { label: "Activate", status: "active" }];
  return [{ label: "Activate", status: "active" }];
}

export function rateCardStatusActions(status: string): { label: string; status: string }[] {
  if (status === "draft") return [{ label: "Activate", status: "active" }, { label: "Archive", status: "archived" }];
  if (status === "active") return [{ label: "Set Inactive", status: "inactive" }, { label: "Archive", status: "archived" }];
  if (status === "inactive") return [{ label: "Activate", status: "active" }, { label: "Archive", status: "archived" }];
  if (status === "archived") return [{ label: "Set Draft", status: "draft" }, { label: "Activate", status: "active" }];
  return [{ label: "Activate", status: "active" }];
}
