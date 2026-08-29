import { formatStatus } from "../../utils/format";
import { statusTone } from "../../utils/status";

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded px-2 py-1 text-xs font-medium ring-1 ring-inset ${statusTone[status] ?? "bg-slate-50 text-slate-700 border-slate-200"}`}>
      {formatStatus(status)}
    </span>
  );
}
