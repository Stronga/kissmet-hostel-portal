import { BedsSection } from "./BedsSection";
import { RoomRatesSection } from "./RoomRatesSection";
import type { AcademicSession, Allocation, Bed, OccupancyRoom, Resident, Room, RoomRate } from "../../types/api";
import { formatCurrencyMinor, formatStatus } from "../../utils/format";

export function RoomDetail({
  room,
  occupancy,
  beds,
  allocations,
  residentsById,
  rates,
  sessions,
  canWrite,
  onAddBed,
  onBedStatus,
  onAddRate,
  onRateStatus,
  onRoomStatus,
  onChangeCapacity
}: {
  room: Room;
  occupancy?: OccupancyRoom;
  beds: Bed[];
  allocations: Allocation[];
  residentsById: Map<number, Resident>;
  rates: RoomRate[];
  sessions: AcademicSession[];
  canWrite: boolean;
  onAddBed: () => void;
  onBedStatus: (bed: Bed, status: string) => void;
  onAddRate: () => void;
  onRateStatus: (rate: RoomRate, status: string) => void;
  onRoomStatus: (status: string) => void;
  onChangeCapacity: () => void;
}) {
  const usableBeds = occupancy?.active_bed_count ?? beds.filter((bed) => bed.status === "available").length;
  const nonArchivedBeds = beds.filter((bed) => bed.status !== "archived").length;
  const occupied = occupancy?.occupied_bed_count ?? allocations.filter((allocation) => allocation.status === "active").length;
  const available = Math.max(Number(usableBeds) - Number(occupied), 0);
  const setupNeeded = Math.max(Number(room.capacity) - nonArchivedBeds, 0);
  const activeRate = rates.find((rate) => rate.status === "active");
  const capacityLabel = room.capacity === 1 ? "1 Person" : room.capacity === 2 ? "2 Persons" : room.capacity === 4 ? "4 Persons" : String(room.capacity);

  return (
    <div className="space-y-3">
      <section className="rounded border border-border p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Overview</h3>
            <p className="mt-1 text-sm text-text-secondary">Configured capacity is the occupancy band (1 / 2 / 4). Usable beds are available inventory; occupancy comes from active allocations.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canWrite ? <button type="button" onClick={onChangeCapacity} className="rounded-md border border-border px-3 py-2 text-sm font-semibold">Change Capacity</button> : null}
            {canWrite ? <button type="button" onClick={() => onRoomStatus(room.status === "available" ? "maintenance" : "available")} className="rounded-md border border-border px-3 py-2 text-sm font-semibold">{room.status === "available" ? "Take Out of Service" : "Return to Service"}</button> : null}
          </div>
        </div>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-text-secondary">Room</dt><dd className="font-medium">{room.room_code}</dd></div>
          <div><dt className="text-xs text-text-secondary">Display name</dt><dd className="font-medium">{room.room_name || "Not available"}</dd></div>
          <div><dt className="text-xs text-text-secondary">Floor</dt><dd className="font-medium">{room.floor || "Not available"}</dd></div>
          <div><dt className="text-xs text-text-secondary">Configured capacity</dt><dd className="font-medium">{capacityLabel}</dd></div>
          <div><dt className="text-xs text-text-secondary">Usable beds</dt><dd className="font-medium">{usableBeds}</dd></div>
          <div><dt className="text-xs text-text-secondary">Occupied</dt><dd className="font-medium">{occupied}</dd></div>
          <div><dt className="text-xs text-text-secondary">Available</dt><dd className="font-medium">{available}</dd></div>
          <div><dt className="text-xs text-text-secondary">Setup needed</dt><dd className="font-medium">{setupNeeded > 0 ? `${setupNeeded} bed${setupNeeded === 1 ? "" : "s"}` : "None"}</dd></div>
          <div><dt className="text-xs text-text-secondary">Gender policy</dt><dd className="font-medium">{formatStatus(room.gender_policy)}</dd></div>
          <div><dt className="text-xs text-text-secondary">Status</dt><dd className="font-medium">{formatStatus(room.status)}</dd></div>
          <div><dt className="text-xs text-text-secondary">Current rate</dt><dd className="font-medium">{activeRate ? formatCurrencyMinor(activeRate.amount_minor, activeRate.currency) : "No active rate"}</dd></div>
        </dl>
        {setupNeeded > 0 ? <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">Setup needed: create or reactivate {setupNeeded} bed{setupNeeded === 1 ? "" : "s"} so inventory matches the configured capacity.</p> : null}
      </section>
      <BedsSection beds={beds} allocations={allocations} residentsById={residentsById} canWrite={canWrite} onCreate={onAddBed} onStatus={onBedStatus} />
      <RoomRatesSection rates={rates} sessions={sessions} canWrite={canWrite} onCreate={onAddRate} onStatus={onRateStatus} />
    </div>
  );
}
