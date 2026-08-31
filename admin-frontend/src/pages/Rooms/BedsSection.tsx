import { StatusBadge } from "../../components/common/StatusBadge";
import type { Allocation, Bed, Resident } from "../../types/api";
import { formatStatus } from "../../utils/format";

export function BedsSection({ beds, allocations, residentsById, canWrite, onCreate, onStatus }: { beds: Bed[]; allocations: Allocation[]; residentsById: Map<number, Resident>; canWrite: boolean; onCreate: () => void; onStatus: (bed: Bed, status: string) => void }) {
  return (
    <section className="rounded border border-border p-3">
      <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">Beds</h3>{canWrite ? <button type="button" onClick={onCreate} className="rounded-md border border-border px-3 py-2 text-sm font-semibold">Add Bed</button> : null}</div>
      <p className="mt-1 text-xs text-text-secondary">Occupancy is based on active allocations, not confirmed bookings.</p>
      {!beds.length ? <p className="mt-3 text-sm text-text-secondary">No beds have been created for this room.</p> : (
        <div className="mt-3 overflow-x-auto"><table className="min-w-full divide-y divide-border text-sm"><thead><tr><th className="px-3 py-2 text-left">Bed</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Occupancy</th><th className="px-3 py-2 text-left">Resident</th><th className="px-3 py-2 text-left">Actions</th></tr></thead><tbody className="divide-y divide-border">{beds.map((bed) => {
          const allocation = allocations.find((item) => item.bed_id === bed.id && item.status === "active");
          const resident = allocation ? residentsById.get(allocation.resident_id) : undefined;
          return <tr key={bed.id}><td className="px-3 py-2">{bed.bed_code} ({bed.label})</td><td className="px-3 py-2"><StatusBadge status={bed.status} /></td><td className="px-3 py-2">{allocation ? "Occupied" : "Available"}</td><td className="px-3 py-2">{resident ? `${resident.first_name} ${resident.last_name}` : "None"}</td><td className="px-3 py-2">{canWrite && !allocation ? <button type="button" onClick={() => onStatus(bed, bed.status === "available" ? "maintenance" : "available")} className="text-sm font-semibold text-primary hover:underline">{bed.status === "available" ? "Take Out of Service" : "Return to Service"}</button> : allocation ? <span className="text-xs text-text-secondary">Occupied bed protected</span> : "No action"}</td></tr>;
        })}</tbody></table></div>
      )}
    </section>
  );
}
