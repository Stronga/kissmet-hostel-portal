import { FormEvent, useMemo, useState } from "react";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import type { AcademicSession, Allocation, AvailabilityBed, Bed, Booking, Room } from "../../types/api";
import { formatCurrencyMinor } from "../../utils/format";
import { placementLabel, rateCompatible, sessionName } from "./allocationView";

export function TransferAllocationDialog({ open, allocation, booking, rooms, bedsByRoom, sessions, availability, loadingAvailability, error, saving, onTransfer, onClose }: { open: boolean; allocation: Allocation | null; booking?: Booking; rooms: Room[]; bedsByRoom: Map<number, Bed[]>; sessions: AcademicSession[]; availability: AvailabilityBed[]; loadingAvailability: boolean; error: string | null; saving: boolean; onTransfer: (input: { destinationBedId: number; startsOn: string; notes?: string }) => void; onClose: () => void }) {
  const [bedId, setBedId] = useState("");
  const [startsOn, setStartsOn] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const current = allocation ? placementLabel(allocation.bed_id, rooms, bedsByRoom) : undefined;
  const compatibleBeds = useMemo(() => booking ? availability.filter((bed) => bed.bed_id !== allocation?.bed_id && rateCompatible(booking, bed)) : [], [allocation?.bed_id, availability, booking]);
  const rejectedSameSessionBeds = booking ? availability.filter((bed) => !rateCompatible(booking, bed)).length : 0;
  const selectedBed = compatibleBeds.find((bed) => bed.bed_id === Number(bedId));

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!selectedBed || !startsOn) return;
    onTransfer({ destinationBedId: selectedBed.bed_id, startsOn, notes: notes.trim() || undefined });
  }

  return (
    <ConfirmDialog open={open} title="Transfer Allocation" description="Choose a specific destination bed. The previous allocation remains historical and the booking price is not changed." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <section className="rounded border border-border p-3 text-sm">
          <dl className="grid gap-2 sm:grid-cols-2">
            <div><dt className="text-xs text-text-secondary">Current Room / Bed</dt><dd className="font-medium">{current?.label ?? "Not available"}</dd></div>
            <div><dt className="text-xs text-text-secondary">Academic session</dt><dd className="font-medium">{allocation ? sessionName(allocation.academic_session_id, sessions) : "Not available"}</dd></div>
            <div><dt className="text-xs text-text-secondary">Booking Financial Basis</dt><dd className="font-medium">{booking ? formatCurrencyMinor(booking.total_amount_minor, booking.currency) : "Not available"}</dd></div>
            <div><dt className="text-xs text-text-secondary">Destination Rate Compatibility</dt><dd className="font-medium">{rejectedSameSessionBeds ? `${rejectedSameSessionBeds} differently priced bed option(s) hidden` : "Compatible options only"}</dd></div>
          </dl>
        </section>
        <label className="block text-sm font-medium">Destination Room / Bed<select aria-label="Transfer destination bed" value={bedId} onChange={(event) => setBedId(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2"><option value="">{loadingAvailability ? "Loading destination beds..." : "Select bed"}</option>{compatibleBeds.map((bed) => <option key={bed.bed_id} value={bed.bed_id}>{bed.room_code} / {bed.bed_code} - {formatCurrencyMinor(bed.amount_minor, bed.currency)}</option>)}</select></label>
        {!loadingAvailability && !compatibleBeds.length ? <p role="alert" className="text-sm text-text-secondary">No compatible destination beds are available. Cross-room transfers are only offered when the destination active rate and currency match the booking financial basis.</p> : null}
        <label className="block text-sm font-medium">Transfer date<input aria-label="Transfer date" type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label>
        <label className="block text-sm font-medium">Notes<textarea aria-label="Transfer notes" value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label>
        {error ? <p role="alert" className="text-sm font-medium text-danger">{error}</p> : null}
        <div className="flex justify-end gap-2"><button type="button" disabled={saving} onClick={onClose} className="rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50">Cancel</button><button type="submit" disabled={saving || !selectedBed} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Transfer Allocation</button></div>
      </form>
    </ConfirmDialog>
  );
}
