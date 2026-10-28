import { FormEvent, useMemo, useState } from "react";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";

const CAPACITY_OPTIONS = [
  { value: 1, label: "1 Person" },
  { value: 2, label: "2 Persons" },
  { value: 4, label: "4 Persons" }
] as const;

export function CapacityChangeDialog({
  open,
  currentCapacity,
  occupied,
  usableBeds,
  nonArchivedBeds,
  saving,
  error,
  onClose,
  onSubmit
}: {
  open: boolean;
  currentCapacity: number;
  occupied: number;
  usableBeds: number;
  nonArchivedBeds: number;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: { capacity: number; reason: string }) => void;
}) {
  const defaultNext = currentCapacity === 4 ? 2 : currentCapacity === 2 ? 1 : 2;
  const [capacity, setCapacity] = useState<number>(defaultNext);
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const consequence = useMemo(() => {
    if (capacity === currentCapacity) {
      return "Select a different capacity band to continue.";
    }
    if (capacity < currentCapacity) {
      const retireEstimate = Math.max(nonArchivedBeds - capacity, 0);
      if (occupied > capacity) {
        return `Capacity cannot be reduced to ${capacity} because this room currently has ${occupied} active residents.`;
      }
      return `Changing capacity from ${currentCapacity} to ${capacity} will retire ${retireEstimate} unused bed space${retireEstimate === 1 ? "" : "s"} from current inventory (archived). Historical allocations will be preserved. Occupied beds will not be retired.`;
    }
    const setupNeeded = Math.max(capacity - nonArchivedBeds, 0);
    return `Changing capacity from ${currentCapacity} to ${capacity} increases the configured occupancy band. ${setupNeeded > 0 ? `Setup needed afterward: ${setupNeeded} bed${setupNeeded === 1 ? "" : "s"} (create or reactivate).` : "Existing bed inventory already covers the new capacity."} Historical booking prices are not changed.`;
  }, [capacity, currentCapacity, nonArchivedBeds, occupied]);

  function submit(event: FormEvent) {
    event.preventDefault();
    setLocalError(null);
    if (![1, 2, 4].includes(capacity)) {
      setLocalError("Select 1, 2, or 4 persons.");
      return;
    }
    if (capacity === currentCapacity) {
      setLocalError("Choose a different capacity than the current configuration.");
      return;
    }
    if (!reason.trim()) {
      setLocalError("A management reason is required.");
      return;
    }
    onSubmit({ capacity, reason: reason.trim() });
  }

  return (
    <ConfirmDialog open={open} title="Change Capacity" description="Configured capacity sets the occupancy pricing band (1, 2, or 4 persons). Beds remain the allocation inventory." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <dl className="grid gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-text-secondary">Current capacity</dt><dd className="font-medium">{currentCapacity} person{currentCapacity === 1 ? "" : "s"}</dd></div>
          <div><dt className="text-xs text-text-secondary">Occupied</dt><dd className="font-medium">{occupied}</dd></div>
          <div><dt className="text-xs text-text-secondary">Usable beds</dt><dd className="font-medium">{usableBeds}</dd></div>
          <div><dt className="text-xs text-text-secondary">Inventory slots</dt><dd className="font-medium">{nonArchivedBeds}</dd></div>
        </dl>
        <label className="block text-sm font-medium">New capacity
          <select aria-label="New capacity" value={capacity} onChange={(event) => setCapacity(Number(event.target.value))} className="mt-1 w-full rounded-md border border-border px-3 py-2">
            {CAPACITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value} disabled={option.value === currentCapacity}>{option.label}{option.value === currentCapacity ? " (current)" : ""}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">Reason
          <textarea aria-label="Capacity change reason" value={reason} onChange={(event) => setReason(event.target.value)} rows={3} className="mt-1 w-full rounded-md border border-border px-3 py-2" placeholder="Why is this capacity being changed?" />
        </label>
        <p className="text-sm text-text-secondary">{consequence}</p>
        {localError || error ? <p role="alert" className="text-sm font-medium text-danger">{localError || error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-md border border-border px-3 py-2 text-sm font-semibold">Cancel</button>
          <button type="submit" disabled={saving || occupied > capacity} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving..." : "Confirm capacity change"}</button>
        </div>
      </form>
    </ConfirmDialog>
  );
}
