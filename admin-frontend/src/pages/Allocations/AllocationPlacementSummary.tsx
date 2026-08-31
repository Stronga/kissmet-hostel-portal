import type { AcademicSession, AvailabilityBed, Booking, Resident } from "../../types/api";
import { formatCurrencyMinor } from "../../utils/format";
import { residentName } from "./allocationView";

export function AllocationPlacementSummary({ resident, booking, session, bed }: { resident?: Resident; booking?: Booking; session?: AcademicSession; bed?: AvailabilityBed }) {
  return (
    <section className="rounded border border-border bg-muted/40 p-3 text-sm">
      <h3 className="text-sm font-semibold">Placement Summary</h3>
      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
        <div><dt className="text-xs text-text-secondary">Resident</dt><dd className="font-medium">{residentName(resident)}</dd></div>
        <div><dt className="text-xs text-text-secondary">Booking</dt><dd className="font-medium">{booking?.booking_number ?? "Select booking"}</dd></div>
        <div><dt className="text-xs text-text-secondary">Academic session</dt><dd className="font-medium">{session?.name ?? "Not selected"}</dd></div>
        <div><dt className="text-xs text-text-secondary">Destination</dt><dd className="font-medium">{bed ? `${bed.room_code} / ${bed.bed_code}` : "Select bed"}</dd></div>
        <div><dt className="text-xs text-text-secondary">Booking amount</dt><dd className="font-medium">{booking ? formatCurrencyMinor(booking.total_amount_minor, booking.currency) : "Not selected"}</dd></div>
      </dl>
    </section>
  );
}
