import { StatusBadge } from "../../components/common/StatusBadge";
import type { AcademicSession, Allocation, Bed, Booking, Institution, Resident, Room, RoomRate } from "../../types/api";
import { formatCurrencyMinor, formatDateTime, formatStatus } from "../../utils/format";
import { AllocationActions } from "./AllocationActions";
import { AllocationHistory } from "./AllocationHistory";
import { activeRateFor, placementLabel, residentName, sessionName } from "./allocationView";

export function AllocationDetail({ allocation, allocations, resident, institution, booking, sessions, rooms, bedsByRoom, rates, canWrite, pending, onStatus, onTransfer }: { allocation: Allocation; allocations: Allocation[]; resident?: Resident; institution?: Institution; booking?: Booking; sessions: AcademicSession[]; rooms: Room[]; bedsByRoom: Map<number, Bed[]>; rates: RoomRate[]; canWrite: boolean; pending: boolean; onStatus: (status: "ended" | "cancelled" | "archived") => void; onTransfer: () => void }) {
  const placement = placementLabel(allocation.bed_id, rooms, bedsByRoom);
  const pricedRoom = booking ? rooms.find((room) => room.id === booking.priced_room_id) : undefined;
  const pricedRate = booking?.priced_room_rate_id ? rates.find((rate) => rate.id === booking.priced_room_rate_id) : booking?.priced_room_id ? activeRateFor(booking.priced_room_id, booking.academic_session_id, rates) : undefined;
  return (
    <div className="space-y-3">
      <Section title="Allocation" rows={[["Status", <StatusBadge status={allocation.status} />], ["Assigned date", formatDateTime(allocation.starts_on ?? allocation.created_at)], ["Ended/released", formatDateTime(allocation.ends_on ?? allocation.released_at)], ["Assigning staff", allocation.assigned_by_staff_id ? `Staff #${allocation.assigned_by_staff_id}` : "Not available"]]} />
      <Section title="Resident" rows={[["Resident code", resident?.resident_code ?? "Not available"], ["Full name", residentName(resident)], ["Student ID", resident?.student_id ?? "Not available"], ["Institution", institution?.name ?? "Not available"]]} />
      <Section title="Booking" rows={[["Booking number", booking?.booking_number ?? `Booking #${allocation.booking_id}`], ["Booking status", booking ? formatStatus(booking.status) : "Not available"], ["Captured booking total", booking ? formatCurrencyMinor(booking.total_amount_minor, booking.currency) : "Not available"], ["Priced room", pricedRoom ? `${pricedRoom.room_code} ${pricedRoom.room_name ?? ""}` : `Room #${booking?.priced_room_id ?? "unknown"}`], ["Priced rate", pricedRate ? `${pricedRate.rate_code} ${formatCurrencyMinor(pricedRate.amount_minor, pricedRate.currency)}` : `Rate #${booking?.priced_room_rate_id ?? "unknown"}`]]} />
      <Section title="Placement" rows={[["Room", placement.room ? `${placement.room.room_code} ${placement.room.room_name ?? ""}` : "Not available"], ["Bed", placement.bed ? `${placement.bed.bed_code} (${placement.bed.label})` : `Bed #${allocation.bed_id}`], ["Room gender policy", placement.room ? formatStatus(placement.room.gender_policy) : "Not available"], ["Bed status", placement.bed ? formatStatus(placement.bed.status) : "Not available"]]} />
      <AllocationHistory residentId={allocation.resident_id} allocations={allocations} rooms={rooms} bedsByRoom={bedsByRoom} />
      <section className="rounded border border-border p-3"><h3 className="mb-3 text-sm font-semibold">Actions</h3><AllocationActions allocation={allocation} canWrite={canWrite} pending={pending} onStatus={onStatus} onTransfer={onTransfer} /></section>
    </div>
  );
}

function Section({ title, rows }: { title: string; rows: Array<[string, React.ReactNode]> }) {
  return <section className="rounded border border-border p-3"><h3 className="text-sm font-semibold">{title}</h3><dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">{rows.map(([label, value]) => <div key={label}><dt className="text-xs text-text-secondary">{label}</dt><dd className="font-medium">{value}</dd></div>)}</dl></section>;
}
