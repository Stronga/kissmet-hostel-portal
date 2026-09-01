import { apiRequest } from "./client";
import type { DataEnvelope, OccupancyReport, ReportsApplicationsBookings, ReportsFinance, ReportsMaintenance, ReportsOverview, ReportsResidents } from "../types/api";

export interface ReportFilters {
  academicSessionId?: number | null;
  dateFrom?: string;
  dateTo?: string;
  residentStatus?: string;
  bookingStatus?: string;
}

function query(filters: ReportFilters = {}) {
  const params = new URLSearchParams();
  if (filters.academicSessionId) params.set("academicSessionId", String(filters.academicSessionId));
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  if (filters.residentStatus && filters.residentStatus !== "all") params.set("residentStatus", filters.residentStatus);
  if (filters.bookingStatus && filters.bookingStatus !== "all") params.set("bookingStatus", filters.bookingStatus);
  const text = params.toString();
  return text ? `?${text}` : "";
}

export async function getReportsOverview(filters?: ReportFilters) {
  return (await apiRequest<DataEnvelope<ReportsOverview>>(`/admin/reports/overview${query(filters)}`)).data;
}

export async function getReportsOccupancy(filters?: ReportFilters) {
  return (await apiRequest<DataEnvelope<OccupancyReport>>(`/admin/reports/occupancy${query(filters)}`)).data;
}

export async function getReportsResidents(filters?: ReportFilters) {
  return (await apiRequest<DataEnvelope<ReportsResidents>>(`/admin/reports/residents${query(filters)}`)).data;
}

export async function getReportsApplicationsBookings(filters?: ReportFilters) {
  return (await apiRequest<DataEnvelope<ReportsApplicationsBookings>>(`/admin/reports/applications-bookings${query(filters)}`)).data;
}

export async function getReportsFinance(filters?: ReportFilters) {
  return (await apiRequest<DataEnvelope<ReportsFinance>>(`/admin/reports/finance${query(filters)}`)).data;
}

export async function getReportsMaintenance(filters?: ReportFilters) {
  return (await apiRequest<DataEnvelope<ReportsMaintenance>>(`/admin/reports/maintenance${query(filters)}`)).data;
}
