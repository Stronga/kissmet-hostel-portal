import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/common/Button";
import { Card } from "../../components/common/Card";
import { EmptyState } from "../../components/common/EmptyState";
import { ErrorState } from "../../components/common/ErrorState";
import { LoadingState } from "../../components/common/LoadingState";
import { StatusBadge } from "../../components/common/StatusBadge";
import { PageHeader } from "../../components/layout/PageHeader";
import { fetchResidentAllocation, fetchResidentApplications, fetchResidentBookings } from "../../api/resident";
import { usePageTitle } from "../../hooks/usePageTitle";
import type { ResidentAllocation, ResidentApplication, ResidentBooking } from "../../types/resident";
import { bookingAmount, bookingNextStep, bookingStatusDescription, bookingStatusLabel, currentBooking, historicalBookings, latestApplicationForBooking, noBookingMessage, pricedRoomLabel } from "../../utils/booking";
import { formatDateTime } from "../../utils/format";

interface BookingData {
  bookings: ResidentBooking[];
  applications: ResidentApplication[];
  allocation: ResidentAllocation | null;
}

function Detail({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">{label}</p>
      <p className="mt-1 text-sm font-semibold text-text-primary">{value || "Unavailable"}</p>
    </div>
  );
}

function BookingSummary({ booking, allocation }: { booking: ResidentBooking; allocation: ResidentAllocation | null }) {
  const pricedRoom = pricedRoomLabel(booking);
  const attention = Boolean(booking.payment_attention_required);
  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-text-secondary">Current booking</p>
          <h2 className="mt-1 text-2xl font-semibold text-text-primary">{booking.booking_number}</h2>
          <p className="mt-1 text-sm text-text-secondary">{bookingStatusDescription(booking, allocation)}</p>
        </div>
        <StatusBadge status={bookingStatusLabel(booking.status)} />
      </div>
      {attention ? (
        <div className="mt-5 rounded-token border border-danger/30 bg-danger/5 p-4 text-sm text-text-primary" role="alert">
          <p className="font-semibold text-danger">Payment attention required</p>
          <p className="mt-1">{booking.payment_attention_reason || "This booking needs payment review. Contact hostel management if you need more information."}</p>
        </div>
      ) : null}
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Detail label="Captured booking amount" value={bookingAmount(booking)} />
        <Detail label="Academic session" value={booking.academic_session_name ?? booking.academic_session_code} />
        <Detail label="Related application" value={booking.application_number} />
        <Detail label="Room used for booking price" value={pricedRoom ?? "Not exposed"} />
        <Detail label="Booked" value={formatDateTime(booking.booked_at ?? booking.created_at)} />
        <Detail label="Expires" value={formatDateTime(booking.expires_at)} />
        <Detail label="Cancelled" value={formatDateTime(booking.cancelled_at)} />
        <Detail label="Completed" value={formatDateTime(booking.completed_at)} />
      </div>
      <div className="mt-5 rounded-token border border-border bg-muted/50 p-4 text-sm text-text-secondary">
        <p><span className="font-semibold text-text-primary">Pricing basis:</span> this amount is the booking's captured `total_amount_minor` and `currency`. It is not recalculated from current room rates.</p>
        <p className="mt-2"><span className="font-semibold text-text-primary">Room assignment:</span> the priced room is not your assigned room. Actual room and bed assignment comes only from an active allocation.</p>
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
      const [bookings, applications, allocation] = await Promise.all([
        fetchResidentBookings(),
        fetchResidentApplications(),
        fetchResidentAllocation()
      ]);
      setData({ bookings: bookings.data, applications: applications.data, allocation: allocation.data });
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
    return (
      <div className="space-y-4">
        <ErrorState title="Booking unavailable" message={error ?? "Unable to load booking."} />
        <Button onClick={() => void load()}>Retry</Button>
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Booking" description="Review your booking lifecycle, captured amount, and next step." />
      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        {booking ? (
          <BookingSummary booking={booking} allocation={data.allocation} />
        ) : (
          <Card>
            <EmptyState title="No booking yet" message={noBookingMessage(application)} />
          </Card>
        )}
        <div className="space-y-4">
          <Card>
            <p className="text-sm font-semibold text-text-secondary">Next step</p>
            <h2 className="mt-2 text-xl font-semibold text-text-primary">{next.label}</h2>
            <p className="mt-2 text-sm text-text-secondary">{next.detail}</p>
            <Link to={next.href} className="mt-4 inline-flex min-h-11 items-center rounded-token bg-primary px-4 py-2 text-sm font-semibold text-white">
              Continue
            </Link>
          </Card>
          <Card>
            <h2 className="text-lg font-semibold text-text-primary">Payment stage</h2>
            {booking ? (
              <div className="mt-3 space-y-3 text-sm text-text-secondary">
                <Detail label="Captured amount due" value={bookingAmount(booking)} />
                <p>Payment submission and verification are handled in the payment stage. Resident-safe verified payment totals are not exposed by the current backend.</p>
                <Link to="/payments" className="inline-flex min-h-11 items-center rounded-token border border-border bg-surface px-4 py-2 text-sm font-semibold text-text-primary">Go to payments</Link>
              </div>
            ) : (
              <EmptyState title="No payment requirement yet" message="Payment details will appear after a booking exists." />
            )}
          </Card>
          <Card>
            <h2 className="text-lg font-semibold text-text-primary">Room assignment</h2>
            {data.allocation ? (
              <div className="mt-3 space-y-3">
                <Detail label="Assigned room" value={data.allocation.room_name ? `${data.allocation.room_code} - ${data.allocation.room_name}` : data.allocation.room_code} />
                <Detail label="Assigned bed" value={data.allocation.label ?? data.allocation.bed_code} />
                <Link to="/room" className="inline-flex min-h-11 items-center rounded-token border border-border bg-surface px-4 py-2 text-sm font-semibold text-text-primary">View My Room</Link>
              </div>
            ) : (
              <EmptyState title="No room or bed assigned" message="A confirmed booking does not itself create a room assignment." />
            )}
          </Card>
        </div>
      </div>
      <Card className="mt-5">
        <h2 className="text-lg font-semibold text-text-primary">Booking history</h2>
        {history.length ? (
          <div className="mt-4 space-y-3">
            {history.map((item) => (
              <div key={item.id} className="rounded-token border border-border bg-white p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-text-primary">{item.booking_number}</p>
                    <p className="mt-1 text-sm text-text-secondary">{bookingAmount(item)} captured for {item.academic_session_name ?? item.academic_session_code ?? "session unavailable"}</p>
                  </div>
                  <StatusBadge status={bookingStatusLabel(item.status)} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No booking history" message="Historical cancelled, expired, completed, or archived bookings will appear here when available." />
        )}
      </Card>
    </>
  );
}
