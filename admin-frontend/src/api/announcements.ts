import { apiRequest } from "./client";
import type { Announcement, AnnouncementAudience, AnnouncementChannel, AnnouncementReport, AnnouncementSeverity, DataEnvelope, ListEnvelope, Pagination } from "../types/api";

export interface AnnouncementInput {
  title: string;
  body: string;
  audience: AnnouncementAudience;
  severity: AnnouncementSeverity;
  channels: AnnouncementChannel[];
  startsAt?: string | null;
  expiresAt?: string | null;
}

export async function listAnnouncements(params: { limit?: number; offset?: number; search?: string } = {}): Promise<{ announcements: Announcement[]; pagination: Pagination }> {
  const query = new URLSearchParams({ limit: String(params.limit ?? 25), offset: String(params.offset ?? 0) });
  if (params.search) query.set("search", params.search);
  const response = await apiRequest<ListEnvelope<Announcement>>(`/admin/announcements?${query.toString()}`);
  return { announcements: response.data, pagination: response.pagination };
}

export async function getAnnouncement(id: number) {
  return (await apiRequest<DataEnvelope<Announcement>>(`/admin/announcements/${id}`)).data;
}

export async function createAnnouncement(input: AnnouncementInput) {
  return (await apiRequest<DataEnvelope<Announcement>>("/admin/announcements", { method: "POST", body: JSON.stringify(input) })).data;
}

export async function updateAnnouncement(id: number, input: Partial<AnnouncementInput>) {
  return (await apiRequest<DataEnvelope<Announcement>>(`/admin/announcements/${id}`, { method: "PATCH", body: JSON.stringify(input) })).data;
}

export async function publishAnnouncement(id: number, confirmHighAlert = false) {
  return (await apiRequest<DataEnvelope<Announcement>>(`/admin/announcements/${id}/publish`, {
    method: "POST",
    body: JSON.stringify({ confirmHighAlert, idempotencyKey: `admin-ui-publish-${id}` })
  })).data;
}

export async function archiveAnnouncement(id: number) {
  return (await apiRequest<DataEnvelope<Announcement>>(`/admin/announcements/${id}/archive`, { method: "POST", body: JSON.stringify({}) })).data;
}

export async function expireAnnouncement(id: number) {
  return (await apiRequest<DataEnvelope<Announcement>>(`/admin/announcements/${id}/expire`, { method: "POST", body: JSON.stringify({}) })).data;
}

export async function getAnnouncementReport() {
  return (await apiRequest<DataEnvelope<AnnouncementReport>>("/admin/dashboard/announcements")).data;
}
