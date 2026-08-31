import { FormEvent, useState } from "react";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import type { Booking, BookingPaymentSummary, Payment, Resident } from "../../types/api";
import { formatCurrencyMinor } from "../../utils/format";
import { residentName } from "./paymentView";

export function VerifyPaymentDialog({ open, payment, booking, resident, summary, saving, error, onVerify, onClose }: { open: boolean; payment: Payment | null; booking?: Booking; resident?: Resident; summary: BookingPaymentSummary | null; saving: boolean; error: string | null; onVerify: (notes?: string) => void; onClose: () => void }) {
  const [notes, setNotes] = useState("");
  const outstandingAfter = summary && payment ? Math.max(summary.balanceMinor - payment.amount_minor, 0) : null;
  function submit(event: FormEvent) {
    event.preventDefault();
    onVerify(notes.trim() || undefined);
  }
  return (
    <ConfirmDialog open={open} title="Verify this payment?" description="Once verified, this amount will count toward the booking's verified payment total." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-text-secondary">Payment Reference</dt><dd className="font-medium">{payment?.payment_reference ?? "Not available"}</dd></div>
          <div><dt className="text-xs text-text-secondary">Resident</dt><dd className="font-medium">{residentName(resident)}</dd></div>
          <div><dt className="text-xs text-text-secondary">Booking</dt><dd className="font-medium">{booking?.booking_number ?? "Not available"}</dd></div>
          <div><dt className="text-xs text-text-secondary">Payment Amount</dt><dd className="font-medium">{payment ? formatCurrencyMinor(payment.amount_minor, payment.currency) : "Not available"}</dd></div>
          <div><dt className="text-xs text-text-secondary">Current Verified Total</dt><dd className="font-medium">{summary ? formatCurrencyMinor(summary.verifiedPaidMinor) : "Not available"}</dd></div>
          <div><dt className="text-xs text-text-secondary">Booking Total</dt><dd className="font-medium">{summary ? formatCurrencyMinor(summary.bookingTotalMinor) : "Not available"}</dd></div>
          <div><dt className="text-xs text-text-secondary">Outstanding Before Verification</dt><dd className="font-medium">{summary ? formatCurrencyMinor(summary.balanceMinor) : "Not available"}</dd></div>
          <div><dt className="text-xs text-text-secondary">Outstanding After Verification</dt><dd className="font-medium">{outstandingAfter === null ? "Not available" : formatCurrencyMinor(outstandingAfter)}</dd></div>
        </dl>
        <label className="block text-sm font-medium">Notes<textarea aria-label="Verification notes" value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label>
        {error ? <p role="alert" className="text-sm font-medium text-danger">{error}</p> : null}
        <div className="flex justify-end gap-2"><button type="button" disabled={saving} onClick={onClose} className="rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50">Cancel</button><button type="submit" disabled={saving || !payment} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Verify Payment</button></div>
      </form>
    </ConfirmDialog>
  );
}
