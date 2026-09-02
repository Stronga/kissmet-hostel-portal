import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/common/Button";
import { Card } from "../../components/common/Card";
import { EmptyState } from "../../components/common/EmptyState";
import { ErrorState } from "../../components/common/ErrorState";
import { LoadingState } from "../../components/common/LoadingState";
import { StatusBadge } from "../../components/common/StatusBadge";
import { PageHeader } from "../../components/layout/PageHeader";
import { fetchResidentAllocation, fetchResidentAllocations, fetchResidentBookings } from "../../api/resident";
import { usePageTitle } from "../../hooks/usePageTitle";
import type { ResidentAllocation, ResidentBooking } from "../../types/resident";
import { bookingAmount, currentBooking, latestBooking, pricedRoomLabel } from "../../utils/booking";
import { formatDateTime, statusLabel } from "../../utils/format";

interface RoomData {
  allocation: ResidentAllocation | null;
  allocations: ResidentAllocation[];
  bookings: ResidentBooking[];
}

function Detail({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">{label}</p>
      <p className="mt-1 text-sm font-semibold text-text-primary">{value || "Not available"}</p>
    </div>
  );
}

function allocationRoom(allocation: ResidentAllocation) {
  return allocation.room_name ? `${allocation.room_code} - ${allocation.room_name}` : allocation.room_code;
}

function allocationBed(allocation: ResidentAllocation) {
  return allocation.label ? `${allocation.label} (${allocation.bed_code})` : allocation.bed_code;
}

function allocationSession(allocation: ResidentAllocation) {
  return allocation.academic_session_name ?? allocation.academic_session_code ?? null;
}

function noAllocationMessage(booking: ResidentBooking | null, latest: ResidentBooking | null) {
  const source = booking ?? latest;
  if (!source) return "Your room has not been assigned yet. A booking is required before room allocation.";
  if (source.status === "pending") return "Your booking is still being processed. Room assignment happens after booking confirmation.";
  if (source.status === "confirmed") return "Your booking is confirmed. Your room and bed have not been assigned yet.";
  if (source.status === "cancelled" || source.status === "expired") return "You do not currently have an active room assignment.";
  return "You do not currently have an active room assignment.";
}

function HistoryCard({ allocation }: { allocation: ResidentAllocation }) {
  return (
    <div className="rounded-token border border-border bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-text-primary">{allocationRoom(allocation)}</p>
          <p className="mt-1 text-sm text-text-secondary">{allocationBed(allocation)}</p>
        </div>
        <StatusBadge status={statusLabel(allocation.status)} />
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Detail label="Academic session" value={allocationSession(allocation)} />
        <Detail label="Started" value={formatDateTime(allocation.starts_on ?? allocation.assigned_at)} />
        <Detail label="Ended" value={formatDateTime(allocation.ends_on ?? allocation.released_at)} />
      </div>
    </div>
  );
}

export function RoomPage() {
  const [data, setData] = useState<RoomData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  usePageTitle("My Room");

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      const [allocation, allocations, bookings] = await Promise.all([
        fetchResidentAllocation(),
        fetchResidentAllocations(),
        fetchResidentBookings()
      ]);
      setData({ allocation: allocation.data, allocations: allocations.data, bookings: bookings.data });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load room assignment.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const booking = useMemo(() => currentBooking(data?.bookings ?? []), [data?.bookings]);
  const latest = useMemo(() => latestBooking(data?.bookings ?? []), [data?.bookings]);
  const previousAllocations = useMemo(() => (data?.allocations ?? []).filter((item) => item.status !== "active"), [data?.allocations]);

  if (isLoading) return <LoadingState label="Loading room assignment" />;
  if (error || !data) {
    return (
      <div className="space-y-4">
        <ErrorState title="Room assignment unavailable" message={error ?? "Unable to load room assignment."} />
        <Button onClick={() => void load()}>Retry</Button>
      </div>
    );
  }

  return (
    <>
      <PageHeader title="My Room" description="Your current room and bed appear only after an active allocation exists." />

      {data.allocation ? (
        <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <Card>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-text-secondary">Your room assignment</p>
                <h2 className="mt-1 text-3xl font-semibold text-text-primary">{allocationRoom(data.allocation)}</h2>
                <p className="mt-2 text-base font-semibold text-primary">{allocationBed(data.allocation)}</p>
              </div>
              <StatusBadge status={statusLabel(data.allocation.status)} />
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <Detail label="Room" value={allocationRoom(data.allocation)} />
              <Detail label="Bed" value={allocationBed(data.allocation)} />
              <Detail label="Academic session" value={allocationSession(data.allocation)} />
              <Detail label="Booking" value={data.allocation.booking_number} />
              <Detail label="Allocation start" value={formatDateTime(data.allocation.starts_on ?? data.allocation.assigned_at)} />
              <Detail label="Room type" value={data.allocation.room_gender_policy ? `${statusLabel(data.allocation.room_gender_policy)} occupancy` : null} />
            </div>
            <div className="mt-5 rounded-token border border-border bg-muted/50 p-4 text-sm text-text-secondary">
              <p><span className="font-semibold text-text-primary">Assignment source:</span> this room and bed come from your active allocation record.</p>
              <p className="mt-2"><span className="font-semibold text-text-primary">Room and bed:</span> your allocation is to a specific bed inside the room. Room capacity is not used here as a room assignment.</p>
            </div>
            <Link to="/maintenance" className="mt-5 inline-flex min-h-11 items-center rounded-token bg-primary px-4 py-2 text-sm font-semibold text-white">Report an issue</Link>
          </Card>

          <div className="space-y-4">
            {booking?.payment_attention_required ? (
              <Card>
                <div role="alert" className="rounded-token border border-danger/30 bg-danger/5 p-4 text-sm text-text-primary">
                  <p className="font-semibold text-danger">Payment attention required</p>
                  <p className="mt-1">{booking.payment_attention_reason || "Your booking requires payment review."}</p>
                </div>
                <Link to="/payments" className="mt-4 inline-flex min-h-11 items-center rounded-token bg-primary px-4 py-2 text-sm font-semibold text-white">View Payments</Link>
              </Card>
            ) : null}
            <Card>
              <h2 className="text-lg font-semibold text-text-primary">Booking relationship</h2>
              {booking ? (
                <div className="mt-4 space-y-3">
                  <Detail label="Booking number" value={booking.booking_number} />
                  <Detail label="Booking status" value={statusLabel(booking.status)} />
                  <Detail label="Captured booking amount" value={bookingAmount(booking)} />
                  <Detail label="Room used for booking price" value={pricedRoomLabel(booking)} />
                  <Link to="/booking" className="inline-flex min-h-11 items-center rounded-token border border-border bg-surface px-4 py-2 text-sm font-semibold text-text-primary">View Booking</Link>
                </div>
              ) : (
                <EmptyState title="Booking not available" message="The allocation is active, but current booking summary data was not returned." />
              )}
            </Card>
          </div>
        </div>
      ) : (
        <Card>
          <EmptyState title="No active room assignment" message={noAllocationMessage(booking, latest)} />
          {booking ? (
            <div className="mt-5 rounded-token border border-border bg-muted/50 p-4 text-sm text-text-secondary">
              <p><span className="font-semibold text-text-primary">Booking:</span> {booking.booking_number} ({statusLabel(booking.status)})</p>
              {pricedRoomLabel(booking) ? <p className="mt-2">The priced room on your booking is not shown as your assigned room. Your room appears here only after staff create an active bed allocation.</p> : null}
              <Link to="/booking" className="mt-4 inline-flex min-h-11 items-center rounded-token border border-border bg-surface px-4 py-2 text-sm font-semibold text-text-primary">View Booking</Link>
            </div>
          ) : null}
        </Card>
      )}

      <Card className="mt-5">
        <h2 className="text-lg font-semibold text-text-primary">Previous room assignments</h2>
        {previousAllocations.length ? (
          <div className="mt-4 space-y-3">
            {previousAllocations.map((allocation) => <HistoryCard key={allocation.id} allocation={allocation} />)}
          </div>
        ) : (
          <EmptyState title="No previous assignments" message="Ended or transferred room assignments will appear here when available." />
        )}
      </Card>
    </>
  );
}
