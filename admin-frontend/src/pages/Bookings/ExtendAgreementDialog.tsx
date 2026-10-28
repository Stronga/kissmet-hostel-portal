import { FormEvent, useEffect, useState } from "react";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import type { Booking } from "../../types/api";
import { formatCurrencyMinor } from "../../utils/format";
import { parseMoneyToMinorUnits } from "../../utils/money";

export function ExtendAgreementDialog({
  open,
  booking,
  saving,
  error,
  onClose,
  onExtend
}: {
  open: boolean;
  booking: Booking;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onExtend: (input: {
    endsOn: string;
    totalAmountMinor?: number;
    maintenanceFeeMinor?: number | null;
    reason: string;
    extendAllocation: boolean;
  }) => void;
}) {
  const [endsOn, setEndsOn] = useState("");
  const [amountMajor, setAmountMajor] = useState(String(Number(booking.total_amount_minor) / 100));
  const [maintenanceMajor, setMaintenanceMajor] = useState(
    booking.maintenance_fee_minor == null ? "" : String(Number(booking.maintenance_fee_minor) / 100)
  );
  const [changeAmount, setChangeAmount] = useState(false);
  const [extendAllocation, setExtendAllocation] = useState(true);
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setEndsOn("");
    setAmountMajor(String(Number(booking.total_amount_minor) / 100));
    setMaintenanceMajor(booking.maintenance_fee_minor == null ? "" : String(Number(booking.maintenance_fee_minor) / 100));
    setChangeAmount(false);
    setExtendAllocation(true);
    setReason("");
    setFormError(null);
  }, [open, booking]);

  function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!endsOn) {
      setFormError("New end date is required.");
      return;
    }
    if (booking.ends_on && endsOn <= booking.ends_on.slice(0, 10)) {
      setFormError("New end date must be after the current end date.");
      return;
    }
    if (!reason.trim()) {
      setFormError("A management reason is required.");
      return;
    }
    let totalAmountMinor: number | undefined;
    let maintenanceFeeMinor: number | null | undefined;
    if (changeAmount) {
      try {
        totalAmountMinor = parseMoneyToMinorUnits(amountMajor);
      } catch {
        setFormError("Enter a valid accommodation amount.");
        return;
      }
      if (maintenanceMajor.trim() === "") {
        maintenanceFeeMinor = booking.maintenance_fee_minor ?? null;
      } else {
        try {
          maintenanceFeeMinor = parseMoneyToMinorUnits(maintenanceMajor);
        } catch {
          setFormError("Enter a valid maintenance fee.");
          return;
        }
      }
    }
    onExtend({
      endsOn,
      totalAmountMinor,
      maintenanceFeeMinor,
      reason: reason.trim(),
      extendAllocation
    });
  }

  return (
    <ConfirmDialog open={open} title="Extend Agreement" description="Extends this agreement's end date. Extending is not free by default — confirm any accommodation amount change explicitly. Active bed allocation is extended only when the bed remains available." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <section className="rounded border border-border p-3 text-sm">
          <dl className="grid gap-2 sm:grid-cols-2">
            <div><dt className="text-xs text-text-secondary">Current end</dt><dd className="font-medium">{booking.ends_on || "Not set"}</dd></div>
            <div><dt className="text-xs text-text-secondary">Current accommodation</dt><dd className="font-medium">{formatCurrencyMinor(booking.total_amount_minor, booking.currency)}</dd></div>
            <div><dt className="text-xs text-text-secondary">Maintenance</dt><dd className="font-medium">{booking.maintenance_fee_minor == null ? "Not set" : formatCurrencyMinor(booking.maintenance_fee_minor, booking.currency)}</dd></div>
            <div><dt className="text-xs text-text-secondary">Booking</dt><dd className="font-medium">{booking.booking_number}</dd></div>
          </dl>
        </section>
        <label className="block text-sm font-medium">New end date
          <input aria-label="Extension new end date" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" />
        </label>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={changeAmount} onChange={(e) => setChangeAmount(e.target.checked)} />
          Change agreed accommodation / maintenance amounts
        </label>
        {changeAmount ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium">New accommodation (GHS)
              <input aria-label="Extension accommodation amount" value={amountMajor} onChange={(e) => setAmountMajor(e.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" />
            </label>
            <label className="block text-sm font-medium">Maintenance (GHS)
              <input aria-label="Extension maintenance fee" value={maintenanceMajor} onChange={(e) => setMaintenanceMajor(e.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" />
            </label>
          </div>
        ) : (
          <p className="text-xs text-text-secondary">Amounts stay unchanged unless you enable the option above. No automatic day-based pro-rating.</p>
        )}
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={extendAllocation} onChange={(e) => setExtendAllocation(e.target.checked)} />
          Also extend active bed allocation when available
        </label>
        <label className="block text-sm font-medium">Management reason
          <textarea aria-label="Extension reason" value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" rows={2} />
        </label>
        {formError || error ? <p role="alert" className="text-sm font-medium text-danger">{formError || error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" disabled={saving} onClick={onClose} className="rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Save Extension</button>
        </div>
      </form>
    </ConfirmDialog>
  );
}
