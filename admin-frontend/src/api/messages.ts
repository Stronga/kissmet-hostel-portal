import { apiRequest } from "./client";
import type { DataEnvelope, ListEnvelope, Message, MessageChannel, MessagePreview, MessageTargetType, Pagination } from "../types/api";

export interface MessageTargetInput {
  targetType: MessageTargetType;
  targetIds?: number[];
  group?: string | null;
  academicSessionId?: number | null;
  staffIds?: number[];
  staffRoleCodes?: string[];
}

export interface CreateMessageInput extends MessageTargetInput {
  subject: string;
  body: string;
  channels: MessageChannel[];
}

export async function listMessages(params: { limit?: number; offset?: number; search?: string; status?: string; targetType?: string; channel?: string } = {}): Promise<{ messages: Message[]; pagination: Pagination }> {
  const query = new URLSearchParams({ limit: String(params.limit ?? 25), offset: String(params.offset ?? 0) });
  if (params.search) query.set("search", params.search);
  if (params.status) query.set("status", params.status);
  if (params.targetType) query.set("targetType", params.targetType);
  if (params.channel) query.set("channel", params.channel);
  const response = await apiRequest<ListEnvelope<Message>>(`/admin/messages?${query.toString()}`);
  return { messages: response.data, pagination: response.pagination };
}

export async function previewMessageTarget(input: MessageTargetInput) {
  return (await apiRequest<DataEnvelope<MessagePreview>>("/admin/messages/preview", { method: "POST", body: JSON.stringify(input) })).data;
}

export async function createMessage(input: CreateMessageInput) {
  return (await apiRequest<DataEnvelope<Message>>("/admin/messages", { method: "POST", body: JSON.stringify(input) })).data;
}

export async function getMessage(id: number) {
  return (await apiRequest<DataEnvelope<Message>>(`/admin/messages/${id}`)).data;
}

export async function sendMessage(id: number) {
  return (await apiRequest<DataEnvelope<Message>>(`/admin/messages/${id}/send`, { method: "POST", body: JSON.stringify({ idempotencyKey: `admin-ui-message-send-${id}` }) })).data;
}

export async function archiveMessage(id: number) {
  return (await apiRequest<DataEnvelope<Message>>(`/admin/messages/${id}/archive`, { method: "POST", body: JSON.stringify({}) })).data;
}
