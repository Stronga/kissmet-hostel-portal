import { statusLabel } from "../../utils/format";

interface StatusBadgeProps {
  status?: string | null;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const label = statusLabel(status);
  return (
    <span className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs font-semibold text-text-secondary" aria-label={`Status: ${label}`}>
      {label}
    </span>
  );
}
