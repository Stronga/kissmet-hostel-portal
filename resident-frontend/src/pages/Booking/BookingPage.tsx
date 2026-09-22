import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "../../components/common/Card";
import { Detail } from "../../components/common/Detail";
import { EmptyState } from "../../components/common/EmptyState";
import { ErrorState } from "../../components/common/ErrorState";
import { InfoHelp } from "../../components/common/InfoHelp";
import { LoadingState } from "../../components/common/LoadingState";
import { StatusBadge } from "../../components/common/StatusBadge";
import { PageHeader } from "../../components/layout/PageHeader";
import { fetchResidentAllocation, fetchResidentApplications, fetchResidentBookings, fetchResidentPaymentSummary } from "../../api/resident";
import { usePageTitle } from "../../hooks/usePageTitle";
import type { ResidentAllocation, ResidentApplication, ResidentBooking, ResidentPaymentSummary } from "../../types/resident";
import { bookingAmount, bookingNextStep, bookingStatusDescription, bookingStatusLabel, currentBooking, historicalBookings, latestApplicationForBooking, noBookingMessage, pricedRoomLabel } from "../../utils/booking";
import { formatDateTime, formatMoneyMinor } from "../../utils/format";

interface BookingData {
  bookings: ResidentBooking[];
  applications: ResidentApplication[];
  allocation: ResidentAllocation | null;
  paymentSummary: ResidentPaymentSummary | null;
}

function BookingSummary({ booking, allocation }: { booking: ResidentBooking; allocation: ResidentAllocation | null }) {
  const pricedRoom = pricedRoomLabel(booking);
  const attention = Boolean(booking.payment_attention_required);
  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-secondary">Current booking</p>
          <h2 className="mt-1 break-words text-2xl font-bold text-text-primary">{booking.booking_number}</h2>
          <p className="mt-1 text-[13px] text-text-secondary">{bookingStatusDescription(booking, allocation)}</p>
        </div>
        <span className="inline-flex items-center gap-1">
          <StatusBadge status={bookingStatusLabel(booking.status)} />
          <InfoHelp label="About booking status">
            {booking.status === "confirmed"
              ? "Booking confirmed means staff confirmed your booking. It does not itself create a room or bed assignment."
              : "Booking status follows the hostel booking workflow. Payment threshold met does not automatically confirm the booking."}
          </InfoHelp>
        </span>
      </div>
      {attention ? (
        <div className="mt-5 rounded-2xl border border-danger/30 bg-danger/5 p-4 text-sm text-text-primary" role="alert">
          <p className="font-semibold text-danger">Payment attention required</p>
          <p className="mt-1">{booking.payment_attention_reason || "This booking needs payment review. Contact hostel management if you need more information."}</p>
        </div>
      ) : null}
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Detail
          label="Captured booking amount"
          value={bookingAmount(booking)}
          help={
            <InfoHelp label="About captured booking amount">
              This amount is the booking's captured total and currency. It is not recalculated from current room rates.
            </InfoHelp>
          }
        />
        <Detail label="Academic session" value={booking.academic_session_name ?? booking.academic_session_code} />
        <Detail label="Related application" value={booking.application_number} />
        <Detail
          label="Room used for booking price"
          value={pricedRoom ?? "Not exposed"}
          help={
            <InfoHelp label="About priced room">
              The room used for booking price is not your assigned room. Actual room and bed assignment comes only from an active allocation.
            </InfoHelp>
          }
        />
        <Detail label="Booked" value={formatDateTime(booking.booked_at ?? booking.created_at)} />
        <Detail label="Expires" value={formatDateTime(booking.expires_at)} />
        <Detail label="Cancelled" value={formatDateTime(booking.cancelled_at)} />
        <Detail label="Completed" value={formatDateTime(booking.completed_at)} />
      </div>
    </Card>
  );
}

export function BookingPage() {
  const [data, setData] = useState<BookingData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  usePageTitle("Booking");

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      const [bookings, applications, allocation, paymentSummary] = await Promise.all([
        fetchResidentBookings(),
        fetchResidentApplications(),
        fetchResidentAllocation(),
        fetchResidentPaymentSummary()
      ]);
      setData({ bookings: bookings.data, applications: applications.data, allocation: allocation.data, paymentSummary: paymentSummary.data });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load booking.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const booking = useMemo(() => currentBooking(data?.bookings ?? []), [data?.bookings]);
  const history = useMemo(() => historicalBookings(data?.bookings ?? []), [data?.bookings]);
  const application = useMemo(() => latestApplicationForBooking(data?.applications ?? []), [data?.applications]);
  const next = bookingNextStep(booking, application, data?.allocation ?? null);

  if (isLoading) return <LoadingState label="Loading booking" />;
  if (error || !data) {
    return <ErrorState title="Booking unavailable" message={error ?? "Unable to load booking."} onRetry={() => void load()} />;
  }

  return (
    <>
      <PageHeader title="Booking" description="Review your booking, amount, and next step." />
      <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        {booking ? (
          <BookingSummary booking={booking} allocation={data.allocation} />
        ) : (
          <Card>
            <EmptyState title="No booking yet" message={noBookingMessage(application)} actionHref="/application" actionLabel="View application" />
          </Card>
        )}
        <div className="space-y-5">
          <Card>
            <p className="text-sm font-semibold text-text-secondary">Next step</p>
            <h2 className="mt-2 text-xl font-bold text-text-primary">{next.label}</h2>
            <p className="mt-2 text-sm text-text-secondary">{next.detail}</p>
            <Link to={next.href} className="mt-4 inline-flex min-h-11 items-center rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white">
              Continue
            </Link>
          </Card>
          <Card>
            <h2 className="inline-flex items-center gap-1 text-lg font-bold text-text-primary">
              Payment stage
              <InfoHelp label="About payment progress">
                Meeting the payment threshold does not confirm the booking automatically. Payment submission and verification are handled in the payment stage.
              </InfoHelp>
            </h2>
            {booking ? (
              <div className="mt-3 space-y-3 text-sm text-text-secondary">
                <Detail label="Captured amount due" value={bookingAmount(booking)} />
                <Detail label="Verified payments" value={data.paymentSummary ? formatMoneyMinor(data.paymentSummary.verifiedTotalMinor, data.paymentSummary.currency) : "Unavailable"} />
                <Detail label="Outstanding" value={data.paymentSummary ? formatMoneyMinor(data.paymentSummary.outstandingMinor, data.paymentSummary.currency) : "Unavailable"} />
                <p>Meeting the payment threshold does not confirm the booking automatically.</p>
                <Link to="/payments" className="inline-flex min-h-11 items-center rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-text-primary">
                  Go to payments
                </Link>
              </div>
            ) : (
              <EmptyState title="No payment requirement yet" message="Payment details will appear after a booking exists." />
            )}
          </Card>
          <Card>
            <h2 className="inline-flex items-center gap-1 text-lg font-bold text-text-primary">
              Room assignment
              <InfoHelp label="About booking vs room assignment">
                A confirmed booking does not itself create a room assignment. Assigned room and bed come only from an active allocation.
              </InfoHelp>
            </h2>
            {data.allocation ? (
              <div className="mt-3 space-y-3">
                <Detail label="Assigned room" value={data.allocation.room_name ? `${data.allocation.room_code} - ${data.allocation.room_name}` : data.allocation.room_code} />
                <Detail label="Assigned bed" value={data.allocation.label ?? data.allocation.bed_code} />
                <Link to="/room" className="inline-flex min-h-11 items-center rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-text-primary">
                  View My Room
                </Link>
              </div>
            ) : (
              <EmptyState title="No room or bed assigned" message="A confirmed booking does not itself create a room assignment." />
            )}
          </Card>
        </div>
      </div>
      <Card className="mt-5">
        <h2 className="text-lg font-bold text-text-primary">Booking history</h2>
        {history.length ? (
          <div className="mt-4 space-y-3">
            {history.map((item) => (
              <div key={item.id} className="rounded-xl border border-border bg-white p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text-primary">{item.booking_number}</p>
                    <p className="mt-1 text-[13px] text-text-secondary">{bookingAmount(item)} captured for {item.academic_session_name ?? item.academic_session_code ?? "session unavailable"}</p>
                  </div>
                  <StatusBadge status={bookingStatusLabel(item.status)} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4">
            <EmptyState title="No booking history" message="Historical cancelled, expired, completed, or archived bookings will appear here when available." />
          </div>
        )}
      </Card>
    </>
  );
}
