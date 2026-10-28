import { BookingActions } from "./BookingActions";
import { BookingFinancialSummary } from "./BookingFinancialSummary";
import { BookingPaymentSummary } from "./BookingPaymentSummary";
import type { AcademicSession, Application, Booking, BookingAgreementFinancial, BookingPaymentSummary as Summary, BookingStatus, Institution, LeasePeriod, Resident, Room, RoomRate } from "../../types/api";
import { formatDateTime, formatStatus } from "../../utils/format";

function residentName(resident?: Resident) {
  return resident ? [resident.first_name, resident.middle_name, resident.last_name].filter(Boolean).join(" ") : "Resident unavailable";
}

function Section({ title, rows, children }: { title: string; rows?: [string, string | number | null | undefined][]; children?: React.ReactNode }) {
  return <section className="rounded border border-border p-3"><h3 className="text-sm font-semibold">{title}</h3>{rows ? <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">{rows.map(([label, value]) => <div key={label}><dt className="text-xs text-text-secondary">{label}</dt><dd className="font-medium">{value || "Not available"}</dd></div>)}</dl> : null}{children ? <div className="mt-3">{children}</div> : null}</section>;
}

export function BookingDetail({
  booking,
  application,
  resident,
  institution,
  session,
  room,
  rate,
  leasePeriods,
  financial,
  summary,
  summaryError,
  canWrite,
  canConfirm,
  canManagePaymentPolicy,
  pending,
  onAction,
  onEditPaymentPolicy
}: {
  booking: Booking;
  application?: Application;
  resident?: Resident;
  institution?: Institution;
  session?: AcademicSession;
  room?: Room;
  rate?: RoomRate;
  leasePeriods?: LeasePeriod[];
  financial?: BookingAgreementFinancial | null;
  summary: Summary | null;
  summaryError: string | null;
  canWrite: boolean;
  canConfirm: boolean;
  canManagePaymentPolicy?: boolean;
  pending: boolean;
  onAction: (status: BookingStatus) => void;
  onEditPaymentPolicy?: () => void;
}) {
  const leasePeriod = booking.lease_period_id
    ? leasePeriods?.find((period) => period.id === booking.lease_period_id)
    : undefined;
  const sessionLabel = booking.academic_session_id == null
    ? (booking.lease_kind && booking.lease_kind !== "academic_calendar" ? "Not applicable" : "Not linked")
    : (session?.name ?? `Session #${booking.academic_session_id}`);

  return (
    <div className="space-y-3">
      <Section title="Booking" rows={[
        ["Booking number", booking.booking_number],
        ["Status", formatStatus(booking.status)],
        ["Created", formatDateTime(booking.created_at)],
        ["Academic session", sessionLabel]
      ]} />
      <Section title="Resident" rows={[
        ["Resident code", resident?.resident_code],
        ["Name", residentName(resident)],
        ["Student ID", resident?.student_id],
        ["Institution", institution?.name]
      ]} />
      <Section title="Application / request" rows={[
        ["Application number", application?.application_number],
        ["Application status", application?.status ? formatStatus(application.status) : undefined],
        ["Requested Term", application?.lease_kind ?? "Not recorded"]
      ]} />
      <BookingFinancialSummary
        booking={booking}
        room={room}
        rate={rate}
        financial={financial}
        leasePeriodName={leasePeriod?.name}
        requestedLeaseKind={application?.lease_kind}
        canManagePaymentPolicy={canManagePaymentPolicy}
        onEditPaymentPolicy={onEditPaymentPolicy}
      />
      <BookingPaymentSummary booking={booking} summary={summary} error={summaryError} />
      <Section title="Allocation" rows={[
        ["Readiness", booking.status === "confirmed" ? "Ready for allocation" : "Not ready for allocation"],
        ["Boundary", "Bookings never create allocations in this phase"]
      ]} />
      <Section title="Actions"><BookingActions booking={booking} summary={summary} canWrite={canWrite} canConfirm={canConfirm} pending={pending} onAction={onAction} /></Section>
    </div>
  );
}
