import { StatusBadge } from "../../components/common/StatusBadge";
import type { Allocation, Bed, Room } from "../../types/api";
import { formatDateTime } from "../../utils/format";
import { placementLabel } from "./allocationView";

export function AllocationHistory({ residentId, allocations, rooms, bedsByRoom }: { residentId: number; allocations: Allocation[]; rooms: Room[]; bedsByRoom: Map<number, Bed[]> }) {
  const rows = allocations.filter((allocation) => allocation.resident_id === residentId);
  return (
    <section className="rounded border border-border p-3">
      <h3 className="text-sm font-semibold">History</h3>
      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead><tr><th className="px-3 py-2 text-left">Placement</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Assigned</th><th className="px-3 py-2 text-left">Ended</th></tr></thead>
          <tbody className="divide-y divide-border">{rows.map((allocation) => <tr key={allocation.id}><td className="px-3 py-2">{placementLabel(allocation.bed_id, rooms, bedsByRoom).label}</td><td className="px-3 py-2"><StatusBadge status={allocation.status} /></td><td className="px-3 py-2">{formatDateTime(allocation.starts_on ?? allocation.created_at)}</td><td className="px-3 py-2">{formatDateTime(allocation.ends_on ?? allocation.released_at)}</td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}
