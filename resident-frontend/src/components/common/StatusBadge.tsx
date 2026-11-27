import { statusLabel } from "../../utils/format";

interface StatusBadgeProps {
  status?: string | null;
  /** Optional override for displayed label (tones still derived from status when possible). */
  label?: string;
}

function toneFor(status?: string | null) {
  const value = String(status ?? "")
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (
    [
      "approved",
      "complete",
      "completed",
      "confirmed",
      "verified",
      "active",
      "resident",
      "issued",
      "resolved",
      "closed",
      "synced"
    ].includes(value)
  ) {
    return "bg-[var(--km-color-success-bg)] text-success";
  }
  if (
    [
      "pending",
      "submitted",
      "under_review",
      "current",
      "unread",
      "open",
      "assigned",
      "in_progress",
      "awaiting_verification",
      "uploaded",
      "draft",
      "not_uploaded"
    ].includes(value)
  ) {
    return "bg-[var(--km-color-info-bg)] text-info";
  }
  if (
    [
      "attention",
      "rejected",
      "payment_attention",
      "needs_attention",
      "cancelled",
      "expired",
      "failed",
      "suspended",
      "disabled",
      "voided"
    ].includes(value)
  ) {
    return "bg-red-50 text-danger";
  }
  if (["booking", "confirmed_booking", "refunded", "transferred", "archived"].includes(value)) {
    return "bg-[var(--km-color-info-bg)] text-info";
  }
  return "bg-muted text-text-secondary";
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const display = label ?? statusLabel(status);
  return (
    <span
      className={`inline-flex w-fit items-center rounded-full px-3 py-1.5 text-[11px] font-semibold ${toneFor(status ?? label)}`}
      aria-label={`Status: ${display}`}
    >
      {display}
    </span>
  );
}
