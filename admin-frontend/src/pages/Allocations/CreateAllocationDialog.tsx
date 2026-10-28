import { FormEvent, useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import type { AcademicSession, Allocation, AvailabilityBed, Booking, Resident, Room, RoomRate } from "../../types/api";
import { formatCurrencyMinor } from "../../utils/format";
import { activeRateFor, agreementPeriodLabel, bookingEligible, leaseTermLabel, rateCompatible, residentName } from "./allocationView";
import { AllocationPlacementSummary } from "./AllocationPlacementSummary";

export function CreateAllocationDialog({ open, bookings, allocations, residentsById, sessions, rooms, rates, availability, loadingAvailability, error, saving, onBookingChange, onDatesChange, onCreate, onClose }: {
  open: boolean;
  bookings: Booking[];
  allocations: Allocation[];
  residentsById: Map<number, Resident>;
  sessions: AcademicSession[];
  rooms: Room[];
  rates: RoomRate[];
  availability: AvailabilityBed[];
  loadingAvailability: boolean;
  error: string | null;
  saving: boolean;
  onBookingChange: (booking: Booking | null) => void;
  onDatesChange: (booking: Booking | null, startsOn: string, endsOn: string) => void;
  onCreate: (input: { bookingId: number; bedId: number; startsOn: string; endsOn?: string; notes?: string; residentId?: number; academicSessionId?: number | null }) => void;
  onClose: () => void;
}) {
  const eligibleBookings = useMemo(() => bookings.filter((booking) => bookingEligible(booking, allocations)), [allocations, bookings]);
  const [bookingId, setBookingId] = useState("");
  const [bedId, setBedId] = useState("");
  const [startsOn, setStartsOn] = useState(new Date().toISOString().slice(0, 10));
  const [endsOn, setEndsOn] = useState("");
  const [notes, setNotes] = useState("");
  const selectedBooking = eligibleBookings.find((booking) => booking.id === Number(bookingId));
  const selectedResident = selectedBooking ? residentsById.get(selectedBooking.resident_id) : undefined;
  const selectedSession = selectedBooking?.academic_session_id != null ? sessions.find((session) => session.id === selectedBooking.academic_session_id) : undefined;
  const compatibleBeds = selectedBooking ? availability.filter((bed) => rateCompatible(selectedBooking, bed)) : [];
  const selectedBed = compatibleBeds.find((bed) => bed.bed_id === Number(bedId));
  const pricedRoom = selectedBooking ? rooms.find((room) => room.id === selectedBooking.priced_room_id) : undefined;
  const pricedRate = selectedBooking?.priced_room_rate_id ? rates.find((rate) => rate.id === selectedBooking.priced_room_rate_id) : (selectedBooking?.priced_room_id != null && selectedBooking.academic_session_id != null) ? activeRateFor(selectedBooking.priced_room_id, selectedBooking.academic_session_id, rates) : undefined;
  const approvedTerm = leaseTermLabel(selectedBooking?.lease_kind) ?? (selectedBooking?.academic_session_id != null ? "Academic Calendar" : selectedBooking ? "Agreement" : null);

  useEffect(() => {
    if (!open) {
      setBookingId("");
      setBedId("");
      setStartsOn(new Date().toISOString().slice(0, 10));
      setEndsOn("");
      setNotes("");
    }
  }, [open]);

  function changeBooking(value: string) {
    setBookingId(value);
    setBedId("");
    const booking = eligibleBookings.find((item) => item.id === Number(value)) ?? null;
    const nextStarts = booking?.starts_on ? String(booking.starts_on).slice(0, 10) : new Date().toISOString().slice(0, 10);
    const nextEnds = booking?.ends_on ? String(booking.ends_on).slice(0, 10) : "";
    setStartsOn(nextStarts);
    setEndsOn(nextEnds);
    onBookingChange(booking);
    onDatesChange(booking, nextStarts, nextEnds);
  }

  function changeStarts(value: string) {
    setStartsOn(value);
    setBedId("");
    onDatesChange(selectedBooking ?? null, value, endsOn);
  }

  function changeEnds(value: string) {
    setEndsOn(value);
    setBedId("");
    onDatesChange(selectedBooking ?? null, startsOn, value);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!selectedBooking || !selectedBed || !startsOn) return;
    onCreate({
      bookingId: selectedBooking.id,
      residentId: selectedBooking.resident_id,
      academicSessionId: selectedBooking.academic_session_id ?? undefined,
      bedId: selectedBed.bed_id,
      startsOn,
      endsOn: endsOn || undefined,
      notes: notes.trim() || undefined,
    });
  }

  return (
    <ConfirmDialog open={open} title="Allocate Bed" description="Assign this resident to the selected bed? This creates the active bed allocation. It does not change the booking's captured price." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm font-medium">Eligible confirmed booking
          <select aria-label="Eligible booking" value={bookingId} onChange={(event) => changeBooking(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2">
            <option value="">Select booking</option>
            {eligibleBookings.map((booking) => (
              <option key={booking.id} value={booking.id}>
                {booking.booking_number} - {residentName(residentsById.get(booking.resident_id))}
                {leaseTermLabel(booking.lease_kind) ? ` (${leaseTermLabel(booking.lease_kind)})` : ""}
              </option>
            ))}
          </select>
        </label>
        {!eligibleBookings.length ? <p role="alert" className="text-sm text-text-secondary">No eligible confirmed bookings are available on the loaded page.</p> : null}
        {selectedBooking ? (
          <section className="rounded border border-border p-3 text-sm space-y-1">
            <p><span className="text-text-secondary">Approved term:</span> {approvedTerm}</p>
            <p><span className="text-text-secondary">Agreement period:</span> {agreementPeriodLabel(selectedBooking)}</p>
            <p><span className="text-text-secondary">Approved room:</span> {pricedRoom ? `${pricedRoom.room_code} ${pricedRoom.room_name ?? ""}` : `Room #${selectedBooking.priced_room_id ?? "unknown"}`}</p>
            {selectedBooking.academic_session_id != null ? <p><span className="text-text-secondary">Academic session:</span> {selectedSession?.name ?? `Session #${selectedBooking.academic_session_id}`}</p> : <p><span className="text-text-secondary">Academic session:</span> Not applicable</p>}
            {pricedRate ? <p><span className="text-text-secondary">Captured rate:</span> {pricedRate.rate_code} {formatCurrencyMinor(pricedRate.amount_minor, pricedRate.currency)}</p> : null}
          </section>
        ) : null}
        {selectedBooking ? (
          <label className="block text-sm font-medium">Specific destination bed
            <select aria-label="Destination bed" value={bedId} onChange={(event) => setBedId(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2">
              <option value="">{loadingAvailability ? "Loading available beds..." : "Select bed"}</option>
              {compatibleBeds.map((bed) => (
                <option key={bed.bed_id} value={bed.bed_id}>{bed.room_code} / {bed.bed_code}</option>
              ))}
            </select>
          </label>
        ) : null}
        {selectedBooking && !loadingAvailability && !compatibleBeds.length ? <p role="alert" className="text-sm text-text-secondary">No beds are available in the approved room for these allocation dates.</p> : null}
        <label className="block text-sm font-medium">Allocation start date<input aria-label="Start date" type="date" value={startsOn} onChange={(event) => changeStarts(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label>
        <label className="block text-sm font-medium">Allocation end date<input aria-label="End date" type="date" value={endsOn} onChange={(event) => changeEnds(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label>
        <label className="block text-sm font-medium">Notes<textarea aria-label="Notes" value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label>
        <AllocationPlacementSummary resident={selectedResident} booking={selectedBooking} session={selectedSession} bed={selectedBed} approvedTerm={approvedTerm} />
        {error ? <p role="alert" className="text-sm font-medium text-danger">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" disabled={saving} onClick={onClose} className="rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={saving || !selectedBooking || !selectedBed} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Create Allocation</button>
        </div>
      </form>
    </ConfirmDialog>
  );
}
