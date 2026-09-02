import type { AnnouncementSeverity, ResidentAnnouncement, ResidentMessage } from "../types/resident";

export function announcementSeverityLabel(severity?: AnnouncementSeverity | null) {
  if (severity === "high_alert" || severity === "critical") return "Urgent";
  if (severity === "warning") return "Important";
  return "Information";
}

export function announcementSeverityTone(severity?: AnnouncementSeverity | null) {
  if (severity === "high_alert" || severity === "critical") return "border-danger bg-red-50 text-danger";
  if (severity === "warning") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-border bg-muted text-text-secondary";
}

export function messagePreview(message: Pick<ResidentMessage, "body">, length = 120) {
  const text = message.body.replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length).trim()}...` : text;
}

export function latestAnnouncement(announcements: ResidentAnnouncement[]) {
  return announcements[0] ?? null;
}

export function latestMessage(messages: ResidentMessage[]) {
  return messages[0] ?? null;
}

export function unreadMessageCount(messages: ResidentMessage[]) {
  return messages.filter((message) => message.status === "unread").length;
}
