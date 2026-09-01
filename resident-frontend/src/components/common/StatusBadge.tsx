import { statusLabel } from "../../utils/format";

interface StatusBadgeProps {
  status?: string | null;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs font-semibold text-text-secondary">
      {statusLabel(status)}
    </span>
  );
}
