import { apiRequest } from "./client";
import type { ApplicationBookingReport, DashboardOverview, FinancialReport, MaintenanceReport, OccupancyReport } from "../types/api";

type ApiEnvelope<T> = { ok: true; data: T };

export async function getDashboardOverview() {
  return (await apiRequest<ApiEnvelope<DashboardOverview>>("/admin/dashboard/overview")).data;
}

export async function getOccupancyReport() {
  return (await apiRequest<ApiEnvelope<OccupancyReport>>("/admin/dashboard/occupancy")).data;
}

export async function getFinancialReport() {
  return (await apiRequest<ApiEnvelope<FinancialReport>>("/admin/dashboard/finance")).data;
}

export async function getApplicationBookingReport() {
  return (await apiRequest<ApiEnvelope<ApplicationBookingReport>>("/admin/dashboard/applications")).data;
}

export async function getMaintenanceReport() {
  return (await apiRequest<ApiEnvelope<MaintenanceReport>>("/admin/dashboard/maintenance")).data;
}
