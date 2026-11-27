const success = "km-badge--success";
const warning = "km-badge--warning";
const danger = "km-badge--danger";
const info = "km-badge--info";
const neutral = "km-badge--neutral";

export const statusTone: Record<string, string> = {
  active: success,
  approved: success,
  confirmed: success,
  verified: success,
  resolved: success,
  published: success,
  sent: success,
  synced: success,
  submitted: info,
  under_review: warning,
  pending: warning,
  normal: neutral,
  important: warning,
  high_alert: danger,
  draft: neutral,
  queued: info,
  partially_failed: warning,
  failed: danger,
  expired: neutral,
  in_progress: info,
  rejected: danger,
  cancelled: danger,
  archived: neutral,
  suspended: warning,
  disabled: neutral
};
