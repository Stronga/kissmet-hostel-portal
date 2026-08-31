import { DataTable } from "../../components/common/DataTable";
import { StatusBadge } from "../../components/common/StatusBadge";
import type { AcademicSession, Application, Booking, Institution, Resident, Room } from "../../types/api";
import { formatCurrencyMinor, formatDateTime } from "../../utils/format";

function residentName(resident?: Resident) {
  return resident ? [resident.first_name, resident.middle_name, resident.last_name].filter(Boolean).join(" ") : "Resident loading";
}

export function BookingTable({ bookings, residentsById, applicationsById, institutions, sessions, rooms, onView }: { bookings: Booking[]; residentsById: Map<number, Resident>; applicationsById: Map<number, Application>; institutions: Institution[]; sessions: AcademicSession[]; rooms: Room[]; onView: (booking: Booking) => void }) {
  return (
    <DataTable<Booking>
      rows={bookings}
      emptyMessage="No bookings match the current criteria."
      columns={[
        { key: "number", header: "Booking Number", render: (booking) => booking.booking_number },
        { key: "resident", header: "Resident", render: (booking) => residentName(residentsById.get(booking.resident_id)) },
        { key: "application", header: "Application", render: (booking) => applicationsById.get(booking.application_id)?.application_number ?? `Application #${booking.application_id}` },
        { key: "session", header: "Academic Session", render: (booking) => sessions.find((session) => session.id === booking.academic_session_id)?.name ?? `Session #${booking.academic_session_id}` },
        { key: "room", header: "Priced Room", render: (booking) => rooms.find((room) => room.id === booking.priced_room_id)?.room_code ?? `Room #${booking.priced_room_id ?? "unknown"}` },
        { key: "amount", header: "Amount", render: (booking) => formatCurrencyMinor(booking.total_amount_minor, booking.currency) },
        { key: "payment", header: "Payment Status / Progress", render: (booking) => booking.payment_attention_required ? "Attention required" : "View summary" },
        { key: "status", header: "Status", render: (booking) => <StatusBadge status={booking.status} /> },
        { key: "created", header: "Created", render: (booking) => formatDateTime(booking.created_at) },
        { key: "actions", header: "Actions", render: (booking) => <button type="button" onClick={() => onView(booking)} className="text-sm font-semibold text-primary hover:underline">View</button> }
      ]}
    />
  );
}
