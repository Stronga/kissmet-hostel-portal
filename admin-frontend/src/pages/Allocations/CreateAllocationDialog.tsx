import { FormEvent, useMemo, useState } from "react";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import type { AcademicSession, Allocation, AvailabilityBed, Booking, Resident, Room, RoomRate } from "../../types/api";
import { formatCurrencyMinor } from "../../utils/format";
import { activeRateFor, bookingEligible, rateCompatible, residentName } from "./allocationView";
import { AllocationPlacementSummary } from "./AllocationPlacementSummary";

export function CreateAllocationDialog({ open, bookings, allocations, residentsById, sessions, rooms, rates, availability, loadingAvailability, error, saving, onBookingChange, onCreate, onClose }: { open: boolean; bookings: Booking[]; allocations: Allocation[]; residentsById: Map<number, Resident>; sessions: AcademicSession[]; rooms: Room[]; rates: RoomRate[]; availability: AvailabilityBed[]; loadingAvailability: boolean; error: string | null; saving: boolean; onBookingChange: (booking: Booking | null) => void; onCreate: (input: { bookingId: number; residentId: number; academicSessionId: number; bedId: number; startsOn: string; notes?: string }) => void; onClose: () => void }) {
  const eligibleBookings = useMemo(() => bookings.filter((booking) => bookingEligible(booking, allocations)), [allocations, bookings]);
  const [bookingId, setBookingId] = useState("");
  const [bedId, setBedId] = useState("");
  const [startsOn, setStartsOn] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const selectedBooking = eligibleBookings.find((booking) => booking.id === Number(bookingId));
  const selectedResident = selectedBooking ? residentsById.get(selectedBooking.resident_id) : undefined;
  const selectedSession = selectedBooking ? sessions.find((session) => session.id === selectedBooking.academic_session_id) : undefined;
  const compatibleBeds = selectedBooking ? availability.filter((bed) => rateCompatible(selectedBooking, bed)) : [];
  const selectedBed = compatibleBeds.find((bed) => bed.bed_id === Number(bedId));
  const pricedRoom = selectedBooking ? rooms.find((room) => room.id === selectedBooking.priced_room_id) : undefined;
  const pricedRate = selectedBooking?.priced_room_rate_id ? rates.find((rate) => rate.id === selectedBooking.priced_room_rate_id) : selectedBooking?.priced_room_id ? activeRateFor(selectedBooking.priced_room_id, selectedBooking.academic_session_id, rates) : undefined;

  function changeBooking(value: string) {
    setBookingId(value);
    setBedId("");
    onBookingChange(eligibleBookings.find((booking) => booking.id === Number(value)) ?? null);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!selectedBooking || !selectedBed || !startsOn) return;
    onCreate({ bookingId: selectedBooking.id, residentId: selectedBooking.resident_id, academicSessionId: selectedBooking.academic_session_id, bedId: selectedBed.bed_id, startsOn, notes: notes.trim() || undefined });
  }

  return (
    <ConfirmDialog open={open} title="Allocate Bed" description="Assign this resident to the selected bed? This creates the active bed allocation. It does not change the booking's captured price." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm font-medium">Eligible confirmed booking<select aria-label="Eligible booking" value={bookingId} onChange={(event) => changeBooking(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2"><option value="">Select booking</option>{eligibleBookings.map((booking) => <option key={booking.id} value={booking.id}>{booking.booking_number} - {residentName(residentsById.get(booking.resident_id))}</option>)}</select></label>
        {!eligibleBookings.length ? <p role="alert" className="text-sm text-text-secondary">No eligible confirmed bookings are available on the loaded page.</p> : null}
        {selectedBooking ? <section className="rounded border border-border p-3 text-sm"><p><span className="text-text-secondary">Priced room:</span> {pricedRoom ? `${pricedRoom.room_code} ${pricedRoom.room_name ?? ""}` : `Room #${selectedBooking.priced_room_id ?? "unknown"}`}</p><p><span className="text-text-secondary">Captured rate:</span> {pricedRate ? `${pricedRate.rate_code} ${formatCurrencyMinor(pricedRate.amount_minor, pricedRate.currency)}` : `Rate #${selectedBooking.priced_room_rate_id ?? "unknown"}`}</p></section> : null}
        {selectedBooking ? <label className="block text-sm font-medium">Specific destination bed<select aria-label="Destination bed" value={bedId} onChange={(event) => setBedId(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2"><option value="">{loadingAvailability ? "Loading compatible beds..." : "Select bed"}</option>{compatibleBeds.map((bed) => <option key={bed.bed_id} value={bed.bed_id}>{bed.room_code} / {bed.bed_code} - {formatCurrencyMinor(bed.amount_minor, bed.currency)}</option>)}</select></label> : null}
        {selectedBooking && !loadingAvailability && !compatibleBeds.length ? <p role="alert" className="text-sm text-text-secondary">No compatible available beds found for this booking. Differently priced destination rooms are not offered.</p> : null}
        <label className="block text-sm font-medium">Start date<input aria-label="Start date" type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label>
        <label className="block text-sm font-medium">Notes<textarea aria-label="Notes" value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label>
        <AllocationPlacementSummary resident={selectedResident} booking={selectedBooking} session={selectedSession} bed={selectedBed} />
        {error ? <p role="alert" className="text-sm font-medium text-danger">{error}</p> : null}
        <div className="flex justify-end gap-2"><button type="button" disabled={saving} onClick={onClose} className="rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50">Cancel</button><button type="submit" disabled={saving || !selectedBooking || !selectedBed} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Create Allocation</button></div>
      </form>
    </ConfirmDialog>
  );
}
