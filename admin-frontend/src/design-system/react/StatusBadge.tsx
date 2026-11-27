import type { ReactNode } from "react";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

const toneClass: Record<StatusTone, string> = {
  success: "km-badge--success",
  warning: "km-badge--warning",
  danger: "km-badge--danger",
  info: "km-badge--info",
  neutral: "km-badge--neutral"
};

export function StatusBadge({ tone = "neutral", children }: { tone?: StatusTone; children: ReactNode }) {
  return <span className={`km-badge ${toneClass[tone]}`}>{children}</span>;
}
