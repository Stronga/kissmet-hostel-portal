import { StatCard } from "../common/StatCard";
import type { FinancialReport } from "../../types/api";
import { formatCurrencyMinor } from "../../utils/format";

export function FinancePanel({ report }: { report: FinancialReport }) {
  return (
    <section>
      <h2 className="mb-3 text-base font-semibold text-text-primary">Finance</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Expected Booking Revenue" value={formatCurrencyMinor(report.expected_booking_revenue)} />
        <StatCard label="Verified Payments" value={formatCurrencyMinor(report.verified_payments)} tone="success" />
        <StatCard label="Outstanding Balance" value={formatCurrencyMinor(report.outstanding_booking_balances)} tone="warning" />
        <StatCard label="Pending/Submitted" value={formatCurrencyMinor(report.pending_submitted_payment_totals)} />
        <StatCard label="Refunds" value={formatCurrencyMinor(report.refunded_totals)} />
        <StatCard label="Fully Paid" value={report.fully_paid_bookings ?? 0} />
        <StatCard label="Partially Paid" value={report.partially_paid_bookings ?? 0} />
        <StatCard label="Payment Attention" value={report.bookings_requiring_payment_attention ?? 0} tone={(report.bookings_requiring_payment_attention ?? 0) > 0 ? "danger" : "default"} />
      </div>
    </section>
  );
}
