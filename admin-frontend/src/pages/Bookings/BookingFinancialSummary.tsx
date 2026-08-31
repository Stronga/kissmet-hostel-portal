import type { Booking, Room, RoomRate } from "../../types/api";
import { formatCurrencyMinor } from "../../utils/format";

export function BookingFinancialSummary({ booking, room, rate }: { booking: Booking; room?: Room; rate?: RoomRate }) {
  return (
    <section className="rounded border border-border p-3">
      <h3 className="text-sm font-semibold text-text-primary">Financial basis</h3>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div><dt className="text-xs text-text-secondary">Priced room</dt><dd className="font-medium">{room ? `${room.room_code}${room.room_name ? ` - ${room.room_name}` : ""}` : `Room #${booking.priced_room_id ?? "unknown"}`}</dd></div>
        <div><dt className="text-xs text-text-secondary">Rate source</dt><dd className="font-medium">{rate?.rate_code ?? `Rate #${booking.priced_room_rate_id ?? "unknown"}`}</dd></div>
        <div><dt className="text-xs text-text-secondary">Booking total</dt><dd className="font-medium">{formatCurrencyMinor(booking.total_amount_minor, booking.currency)}</dd></div>
        <div><dt className="text-xs text-text-secondary">Currency</dt><dd className="font-medium">{booking.currency}</dd></div>
      </dl>
      <p className="mt-2 text-xs text-text-secondary">Captured booking totals are shown from the booking record, not recalculated from current room rates.</p>
    </section>
  );
}
