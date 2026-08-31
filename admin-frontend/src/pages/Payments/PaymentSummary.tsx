import type { BookingPaymentSummary } from "../../types/api";
import { formatCurrencyMinor } from "../../utils/format";

export function PaymentSummary({ summary, error }: { summary: BookingPaymentSummary | null; error: string | null }) {
  if (error) return <p role="alert" className="rounded border border-danger/30 bg-red-50 p-3 text-sm font-medium text-danger">{error}</p>;
  if (!summary) return <p className="text-sm text-text-secondary">Payment summary unavailable.</p>;
  return (
    <section className="rounded border border-border p-3">
      <h3 className="text-sm font-semibold">Booking Payment Summary</h3>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div><dt className="text-xs text-text-secondary">Booking total</dt><dd className="font-medium">{formatCurrencyMinor(summary.bookingTotalMinor)}</dd></div>
        <div><dt className="text-xs text-text-secondary">Verified amount</dt><dd className="font-medium">{formatCurrencyMinor(summary.verifiedPaidMinor)}</dd></div>
        <div><dt className="text-xs text-text-secondary">Outstanding</dt><dd className="font-medium">{formatCurrencyMinor(summary.balanceMinor)}</dd></div>
        <div><dt className="text-xs text-text-secondary">Required for confirmation</dt><dd className="font-medium">{formatCurrencyMinor(summary.requiredConfirmationAmountMinor)}</dd></div>
        <div><dt className="text-xs text-text-secondary">Requirement met</dt><dd className="font-medium">{summary.confirmationRequirementMet ? "Yes" : "No"}</dd></div>
        <div><dt className="text-xs text-text-secondary">Payment attention</dt><dd className="font-medium">{summary.paymentAttentionRequired ? "Required" : "No"}</dd></div>
      </dl>
    </section>
  );
}
