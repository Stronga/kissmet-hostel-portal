import type { Booking, BookingStatus, BookingPaymentSummary } from "../../types/api";
import { formatStatus } from "../../utils/format";

export function validBookingTransitions(status: BookingStatus): BookingStatus[] {
  const transitions: Record<BookingStatus, BookingStatus[]> = {
    pending: ["confirmed", "cancelled", "expired", "archived"],
    confirmed: ["completed", "cancelled", "archived"],
    cancelled: ["archived"],
    expired: ["archived"],
    completed: ["archived"],
    archived: []
  };
  return transitions[status] ?? [];
}

function label(status: BookingStatus) {
  if (status === "confirmed") return "Confirm";
  if (status === "cancelled") return "Cancel";
  if (status === "completed") return "Complete";
  if (status === "expired") return "Expire";
  if (status === "archived") return "Archive";
  return formatStatus(status);
}

export function BookingActions({ booking, summary, canWrite, canConfirm, pending, onAction }: { booking: Booking; summary?: BookingPaymentSummary | null; canWrite: boolean; canConfirm: boolean; pending: boolean; onAction: (status: BookingStatus) => void }) {
  if (!canWrite && !canConfirm) return <p className="text-sm text-text-secondary">This role can view bookings but cannot change booking status.</p>;
  const actions = validBookingTransitions(booking.status).filter((status) => {
    if (status === "confirmed") return canConfirm && summary?.confirmationRequirementMet === true;
    return canWrite;
  });
  if (!actions.length) return <p className="text-sm text-text-secondary">No valid booking actions are currently available.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((status) => (
        <button key={status} type="button" disabled={pending} onClick={() => onAction(status)} className={status === "confirmed" ? "rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50" : "rounded-md border border-border px-3 py-2 text-sm font-semibold text-text-primary hover:bg-muted disabled:opacity-50"}>
          {label(status)}
        </button>
      ))}
    </div>
  );
}
