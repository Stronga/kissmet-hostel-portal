import { formatStatus } from "../../utils/format";
import { statusTone } from "../../utils/status";

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`km-badge ${statusTone[status] ?? "km-badge--neutral"}`}>
      {formatStatus(status)}
    </span>
  );
}
