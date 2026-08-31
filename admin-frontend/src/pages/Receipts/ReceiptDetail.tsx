import { Printer } from "lucide-react";
import { StatusBadge } from "../../components/common/StatusBadge";
import type { Booking, Payment, ReceiptDetailData } from "../../types/api";
import { formatCurrencyMinor, formatDateTime, formatStatus } from "../../utils/format";
import { methodLabel } from "../Payments/paymentView";
import { PrintableReceipt } from "./PrintableReceipt";

export function ReceiptDetail({ receipt, payment, booking, canWrite, saving, onVoid }: { receipt: ReceiptDetailData; payment?: Payment; booking?: Booking; canWrite: boolean; saving: boolean; onVoid: () => void }) {
  const currency = payment?.currency ?? "GHS";
  return (
    <div className="space-y-3">
      <section className="rounded border border-border p-3">
        <h3 className="text-sm font-semibold">Financial Chain</h3>
        <p className="mt-2 text-sm text-text-secondary">Receipt to Verified Payment to Booking to Resident</p>
      </section>
      <Section title="Receipt" rows={[["Receipt number", receipt.receipt_number], ["Status", <StatusBadge status={receipt.status} />], ["Amount", formatCurrencyMinor(receipt.amount_minor, currency)], ["Issued date", formatDateTime(receipt.issued_at)], ["Voided date", formatDateTime(receipt.voided_at)], ["Void reason", receipt.void_reason || "Not available"], ["Issued by", receipt.issuing_staff_name || "Not available"]]} />
      <Section title="Payment" rows={[["Payment reference", receipt.payment_reference], ["Payment amount", formatCurrencyMinor(receipt.amount_minor, currency)], ["Payment method", methodLabel(receipt.method)], ["Payment status", payment ? formatStatus(payment.status) : "Not available"], ["Paid date", formatDateTime(receipt.paid_at)], ["Verified date", formatDateTime(receipt.verified_at)]]} />
      <Section title="Resident" rows={[["Resident code", receipt.resident_code], ["Full name", receipt.resident_name], ["Student ID", receipt.student_id || "Not available"], ["Institution", receipt.institution_name || "Not available"]]} />
      <Section title="Booking" rows={[["Booking number", receipt.booking_number || "Not available"], ["Booking status", booking ? formatStatus(booking.status) : "Not available"], ["Captured booking total", typeof receipt.total_amount_minor === "number" ? formatCurrencyMinor(receipt.total_amount_minor, booking?.currency ?? currency) : "Not available"]]} />
      <PrintableReceipt receipt={receipt} currency={currency} />
      <section className="no-print rounded border border-border p-3">
        <h3 className="mb-3 text-sm font-semibold">Actions</h3>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-semibold"><Printer className="h-4 w-4" /> Print Receipt</button>
          {canWrite && receipt.status === "issued" ? <button type="button" disabled={saving} onClick={onVoid} className="rounded-md border border-danger px-3 py-2 text-sm font-semibold text-danger disabled:opacity-50">Void</button> : null}
        </div>
        {!canWrite ? <p className="mt-2 text-sm text-text-secondary">No receipt management permission.</p> : null}
      </section>
    </div>
  );
}

function Section({ title, rows }: { title: string; rows: Array<[string, React.ReactNode]> }) {
  return <section className="rounded border border-border p-3"><h3 className="text-sm font-semibold">{title}</h3><dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">{rows.map(([label, value]) => <div key={label}><dt className="text-xs text-text-secondary">{label}</dt><dd className="font-medium">{value}</dd></div>)}</dl></section>;
}
