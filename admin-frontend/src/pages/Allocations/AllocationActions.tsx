import type { Allocation } from "../../types/api";

export function AllocationActions({ allocation, canWrite, pending, onStatus, onTransfer }: { allocation: Allocation; canWrite: boolean; pending: boolean; onStatus: (status: "ended" | "cancelled" | "archived") => void; onTransfer: () => void }) {
  if (!canWrite) return <p className="text-sm text-text-secondary">No write permission.</p>;
  if (allocation.status === "active") {
    return (
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={onTransfer} className="rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50">Transfer</button>
        <button type="button" disabled={pending} onClick={() => onStatus("ended")} className="rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50">End Allocation</button>
        <button type="button" disabled={pending} onClick={() => onStatus("cancelled")} className="rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50">Cancel Allocation</button>
      </div>
    );
  }
  if (["ended", "cancelled", "transferred"].includes(allocation.status)) {
    return <button type="button" disabled={pending} onClick={() => onStatus("archived")} className="rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50">Archive</button>;
  }
  return <p className="text-sm text-text-secondary">No valid actions for this allocation status.</p>;
}
