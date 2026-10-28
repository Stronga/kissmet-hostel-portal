import { FormEvent, useMemo, useState } from "react";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import type { AcademicSession, Allocation, AvailabilityBed, Bed, Booking, Room } from "../../types/api";
import { formatCurrencyMinor } from "../../utils/format";
import { parseMoneyToMinorUnits } from "../../utils/money";
import { leaseTermLabel, placementLabel, rateCompatible, sessionName } from "./allocationView";

export function TransferAllocationDialog({
  open,
  allocation,
  booking,
  rooms,
  bedsByRoom,
  sessions,
  availability,
  loadingAvailability,
  canManageCrossRoom,
  error,
  saving,
  onTransfer,
  onCrossRoomTransfer,
  onClose
}: {
  open: boolean;
  allocation: Allocation | null;
  booking?: Booking;
  rooms: Room[];
  bedsByRoom: Map<number, Bed[]>;
  sessions: AcademicSession[];
  availability: AvailabilityBed[];
  loadingAvailability: boolean;
  canManageCrossRoom?: boolean;
  error: string | null;
  saving: boolean;
  onTransfer: (input: { destinationBedId: number; startsOn: string; notes?: string }) => void;
  onCrossRoomTransfer?: (input: {
    destinationBedId: number;
    startsOn: string;
    notes?: string;
    reason: string;
    agreedAmountMinor?: number;
  }) => void;
  onClose: () => void;
}) {
  const [bedId, setBedId] = useState("");
  const [startsOn, setStartsOn] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [changeAmount, setChangeAmount] = useState(false);
  const [amountMajor, setAmountMajor] = useState(booking ? String(Number(booking.total_amount_minor) / 100) : "");
  const [formError, setFormError] = useState<string | null>(null);
  const current = allocation ? placementLabel(allocation.bed_id, rooms, bedsByRoom) : undefined;
  const approvedRoomId = booking?.priced_room_id ?? null;

  const sameRoomBeds = useMemo(
    () => (booking ? availability.filter((bed) => bed.bed_id !== allocation?.bed_id && rateCompatible(booking, bed)) : []),
    [allocation?.bed_id, availability, booking]
  );

  const crossRoomBeds = useMemo(() => {
    if (!canManageCrossRoom || !booking || approvedRoomId == null) return [] as Array<{ bed_id: number; room_id: number; room_code: string; bed_code: string }>;
    const out: Array<{ bed_id: number; room_id: number; room_code: string; bed_code: string }> = [];
    for (const room of rooms) {
      if (room.id === approvedRoomId || room.status !== "available") continue;
      for (const bed of bedsByRoom.get(room.id) ?? []) {
        if (bed.status !== "available" || bed.id === allocation?.bed_id) continue;
        out.push({ bed_id: bed.id, room_id: room.id, room_code: room.room_code, bed_code: bed.bed_code });
      }
    }
    return out;
  }, [allocation?.bed_id, approvedRoomId, bedsByRoom, booking, canManageCrossRoom, rooms]);

  const selectedSame = sameRoomBeds.find((bed) => bed.bed_id === Number(bedId));
  const selectedCross = crossRoomBeds.find((bed) => bed.bed_id === Number(bedId));
  const isCross = Boolean(selectedCross);
  const approvedTerm = leaseTermLabel(booking?.lease_kind) ?? (allocation?.academic_session_id != null ? "Academic Calendar" : "Agreement");

  function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!startsOn) return;
    if (isCross) {
      if (!selectedCross || !onCrossRoomTransfer) return;
      if (!reason.trim()) {
        setFormError("A management reason is required for cross-room transfer.");
        return;
      }
      let agreedAmountMinor: number | undefined;
      if (changeAmount) {
        try {
          agreedAmountMinor = parseMoneyToMinorUnits(amountMajor);
        } catch {
          setFormError("Enter a valid agreed amount.");
          return;
        }
      }
      onCrossRoomTransfer({
        destinationBedId: selectedCross.bed_id,
        startsOn,
        notes: notes.trim() || undefined,
        reason: reason.trim(),
        agreedAmountMinor
      });
      return;
    }
    if (!selectedSame) return;
    onTransfer({ destinationBedId: selectedSame.bed_id, startsOn, notes: notes.trim() || undefined });
  }

  return (
    <ConfirmDialog open={open} title="Transfer Allocation" description="Same-room bed transfers keep the agreement room unchanged. Cross-room transfers (managers) update the agreement room truth so booking and allocation stay consistent." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <section className="rounded border border-border p-3 text-sm">
          <dl className="grid gap-2 sm:grid-cols-2">
            <div><dt className="text-xs text-text-secondary">Current Room / Bed</dt><dd className="font-medium">{current?.label ?? "Not available"}</dd></div>
            <div><dt className="text-xs text-text-secondary">Approved term</dt><dd className="font-medium">{approvedTerm}</dd></div>
            <div><dt className="text-xs text-text-secondary">Academic session</dt><dd className="font-medium">{allocation?.academic_session_id == null ? "Not applicable" : sessionName(allocation.academic_session_id, sessions)}</dd></div>
            <div><dt className="text-xs text-text-secondary">Booking Financial Basis</dt><dd className="font-medium">{booking ? formatCurrencyMinor(booking.total_amount_minor, booking.currency) : "Not available"}</dd></div>
          </dl>
        </section>
        <label className="block text-sm font-medium">Destination Room / Bed
          <select aria-label="Transfer destination bed" value={bedId} onChange={(event) => setBedId(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2">
            <option value="">{loadingAvailability ? "Loading destination beds..." : "Select bed"}</option>
            <optgroup label="Same approved room">
              {sameRoomBeds.map((bed) => <option key={bed.bed_id} value={bed.bed_id}>{bed.room_code} / {bed.bed_code}</option>)}
            </optgroup>
            {canManageCrossRoom && crossRoomBeds.length ? (
              <optgroup label="Other rooms (updates agreement room)">
                {crossRoomBeds.map((bed) => <option key={bed.bed_id} value={bed.bed_id}>{bed.room_code} / {bed.bed_code}</option>)}
              </optgroup>
            ) : null}
          </select>
        </label>
        {!loadingAvailability && !sameRoomBeds.length && !(canManageCrossRoom && crossRoomBeds.length) ? (
          <p role="alert" className="text-sm text-text-secondary">No available beds for this transfer date. Cross-room transfers require Super Admin / Manager.</p>
        ) : null}
        <label className="block text-sm font-medium">Transfer date<input aria-label="Transfer date" type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label>
        {isCross ? (
          <>
            <label className="block text-sm font-medium">Management reason
              <textarea aria-label="Cross-room transfer reason" value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" rows={2} />
            </label>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={changeAmount} onChange={(e) => setChangeAmount(e.target.checked)} />
              Change agreed accommodation amount
            </label>
            {changeAmount ? (
              <label className="block text-sm font-medium">New agreed amount (GHS)
                <input aria-label="Cross-room agreed amount" value={amountMajor} onChange={(e) => setAmountMajor(e.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" />
              </label>
            ) : (
              <p className="text-xs text-text-secondary">Price stays unchanged unless you explicitly change it. Verified payments remain on this agreement.</p>
            )}
          </>
        ) : null}
        <label className="block text-sm font-medium">Notes<textarea aria-label="Transfer notes" value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label>
        {formError || error ? <p role="alert" className="text-sm font-medium text-danger">{formError || error}</p> : null}
        <div className="flex justify-end gap-2"><button type="button" disabled={saving} onClick={onClose} className="rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50">Cancel</button><button type="submit" disabled={saving || (!selectedSame && !selectedCross)} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{isCross ? "Transfer + Update Agreement Room" : "Transfer Allocation"}</button></div>
      </form>
    </ConfirmDialog>
  );
}
