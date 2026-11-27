import { apiRequest } from "./client";
import type { DataEnvelope } from "../types/api";

export type ActivityView = "action_required" | "all" | "completed";

export interface StaffTaskItem {
  id: number;
  category: string;
  kind: string;
  subjectType: string;
  subjectId: number;
  title: string;
  detail: string | null;
  priority: string;
  status: string;
  href: string;
  unread: boolean;
  unresolved: boolean;
  unavailableReason: string | null;
  updatedAt: string | null;
}

export interface ActivityPage {
  items: StaffTaskItem[];
  pagination: { limit: number; offset: number; total: number };
  unreadCount: number;
}

type ActivityEnvelope = {
  ok: true;
  data: StaffTaskItem[];
  pagination: { limit: number; offset: number; total: number };
  unreadCount: number;
};

export async function listActivity(params: { view: ActivityView; limit: number; offset: number }): Promise<ActivityPage> {
  const query = new URLSearchParams({
    view: params.view,
    limit: String(params.limit),
    offset: String(params.offset)
  });
  const response = await apiRequest<ActivityEnvelope>(`/admin/activity?${query.toString()}`);
  return {
    items: Array.isArray(response.data) ? response.data : [],
    pagination: response.pagination ?? { limit: params.limit, offset: params.offset, total: 0 },
    unreadCount: Number(response.unreadCount ?? 0)
  };
}

export async function markActivityRead(id: number) {
  return (await apiRequest<DataEnvelope<StaffTaskItem>>(`/admin/activity/${id}/read`, { method: "POST" })).data;
}

export async function activityUnreadCount() {
  const data = (await apiRequest<DataEnvelope<{ unreadCount?: number }>>("/admin/activity/unread-count")).data;
  return Number(data?.unreadCount ?? 0);
}

export interface WorkflowStep {
  id: string;
  label: string;
  state: "complete" | "current" | "upcoming" | "blocked";
  detail: string | null;
}

export interface WorkflowGuidance {
  subjectType: string;
  subjectId: number;
  available: boolean;
  status: string | null;
  unavailableReason?: string;
  steps: WorkflowStep[];
  nextAction: { label: string; permission: string; responsibleRole: string; blockedReason: string | null } | null;
  responsibleRole: string | null;
  blockers: string[];
  dependencies?: string[];
}

export async function getWorkflow(subjectType: string, subjectId: number) {
  return (await apiRequest<DataEnvelope<WorkflowGuidance>>(`/admin/workflows/${subjectType}/${subjectId}`)).data;
}
