import type { Booking, BookingPaymentSummary as Summary } from "../../types/api";
import { formatCurrencyMinor } from "../../utils/format";

export function BookingPaymentSummary({ booking, summary, error }: { booking: Booking; summary: Summary | null; error: string | null }) {
  if (error) return <section className="rounded border border-danger/30 bg-red-50 p-3 text-sm text-danger">Payment summary unavailable: {error}</section>;
  if (!summary) return <section className="rounded border border-border p-3 text-sm text-text-secondary">Payment summary is loading.</section>;
  return (
    <section className="rounded border border-border p-3">
      <h3 className="text-sm font-semibold text-text-primary">Payment summary</h3>
      {summary.paymentAttentionRequired || booking.payment_attention_required ? (
        <p className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-sm font-medium text-amber-800">Payment attention required{booking.payment_attention_reason ? `: ${booking.payment_attention_reason}` : ""}</p>
      ) : null}
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div><dt className="text-xs text-text-secondary">Booking total</dt><dd className="font-medium">{formatCurrencyMinor(summary.bookingTotalMinor, booking.currency)}</dd></div>
        <div><dt className="text-xs text-text-secondary">Verified</dt><dd className="font-medium">{formatCurrencyMinor(summary.verifiedPaidMinor, booking.currency)}</dd></div>
        <div><dt className="text-xs text-text-secondary">Outstanding</dt><dd className="font-medium">{formatCurrencyMinor(summary.balanceMinor, booking.currency)}</dd></div>
        <div><dt className="text-xs text-text-secondary">Pending/submitted</dt><dd className="font-medium">Not exposed by current API</dd></div>
        <div><dt className="text-xs text-text-secondary">Confirmation threshold</dt><dd className="font-medium">{formatCurrencyMinor(summary.requiredConfirmationAmountMinor, booking.currency)}</dd></div>
        <div><dt className="text-xs text-text-secondary">Eligible to confirm</dt><dd className="font-medium">{summary.confirmationRequirementMet ? "Yes" : "No"}</dd></div>
      </dl>
    </section>
  );
}
