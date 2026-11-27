import { apiRequest } from "./client";
import type { DataEnvelope } from "../types/api";

export interface CommandScope {
  mode: "all" | "academic_session" | "lease_period";
  label: string;
  academicSessionId: number | null;
  leasePeriodId: number | null;
}

export interface CommandCentre {
  scope: CommandScope;
  actionable: {
    applicationsAwaitingReview?: number;
    draftApplications?: number;
    applicationsRequiringAttention?: number;
    agreementsAwaitingPreparation?: number;
    paymentsAwaitingVerification?: number;
    refundsAwaitingApproval?: number;
    bookingsAwaitingAllocation?: number;
    urgentMaintenance?: number;
    internetProvisioningFailures?: number;
    operationalIssues?: number;
  };
  summary: {
    totalResidents?: number;
    activeResidents?: number;
    applicants?: number;
    occupiedBeds?: number;
    availableBeds?: number;
    occupancyPercentage?: number;
  };
  finance: {
    expectedBookingRevenue: number;
    verifiedPayments: number;
    outstandingBookingBalances: number;
    paymentsAwaitingVerificationCount: number;
    paymentsAwaitingVerificationTotal: number;
  } | null;
  periods: {
    academicSessions: Array<{ id: number; name: string }>;
    leasePeriods: Array<{ id: number; name: string; kind: string }>;
  };
}

export interface OccupancyBed {
  id: number;
  bedCode: string;
  label: string;
  status: string;
  occupant: { allocationId: number; residentCode: string; name: string } | null;
}

export interface OccupancyRoomRow {
  id: number;
  roomCode: string;
  roomName: string | null;
  capacity: number;
  genderPolicy: string;
  status: string;
  occupiedBeds: number;
  beds: OccupancyBed[];
}

export async function getCommandCentre(params: { academicSessionId?: string; leasePeriodId?: string } = {}) {
  const query = new URLSearchParams();
  if (params.academicSessionId) query.set("academicSessionId", params.academicSessionId);
  if (params.leasePeriodId) query.set("leasePeriodId", params.leasePeriodId);
  const text = query.toString();
  return (await apiRequest<DataEnvelope<CommandCentre>>(`/admin/dashboard/command-centre${text ? `?${text}` : ""}`)).data;
}

export async function getOccupancyRooms(params: { academicSessionId?: string; leasePeriodId?: string } = {}) {
  const query = new URLSearchParams();
  if (params.academicSessionId) query.set("academicSessionId", params.academicSessionId);
  if (params.leasePeriodId) query.set("leasePeriodId", params.leasePeriodId);
  const text = query.toString();
  return (await apiRequest<DataEnvelope<{ rooms: OccupancyRoomRow[] }>>(`/admin/dashboard/occupancy/rooms${text ? `?${text}` : ""}`)).data;
}
