import type { ReceiptDetailData } from "../../types/api";
import { formatCurrencyMinor, formatDateTime, formatStatus } from "../../utils/format";
import { methodLabel } from "../Payments/paymentView";

export function PrintableReceipt({ receipt, currency }: { receipt: ReceiptDetailData; currency: string }) {
  return (
    <section className="printable-receipt rounded border border-border p-4">
      <style>{`@media print { body * { visibility: hidden; } .printable-receipt, .printable-receipt * { visibility: visible; } .printable-receipt { position: absolute; inset: 0; border: 0; } .no-print { display: none !important; } }`}</style>
      <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Kissmet Hostel</p>
          <h3 className="mt-1 text-xl font-semibold text-text-primary">Receipt {receipt.receipt_number}</h3>
        </div>
        {receipt.status === "voided" ? <div className="rounded border-2 border-danger px-3 py-1 text-lg font-bold text-danger">VOID</div> : null}
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <Item label="Resident name" value={receipt.resident_name} />
        <Item label="Resident code" value={receipt.resident_code} />
        <Item label="Student ID" value={receipt.student_id ?? "Not available"} />
        <Item label="Booking number" value={receipt.booking_number ?? "Not available"} />
        <Item label="Payment reference" value={receipt.payment_reference} />
        <Item label="Payment method" value={methodLabel(receipt.method)} />
        <Item label="Amount paid" value={formatCurrencyMinor(receipt.amount_minor, currency)} />
        <Item label="Date paid" value={formatDateTime(receipt.paid_at)} />
        <Item label="Date verified/issued" value={formatDateTime(receipt.issued_at ?? receipt.verified_at)} />
        <Item label="Receipt status" value={formatStatus(receipt.status)} />
      </dl>
      {receipt.status === "voided" ? <p className="mt-4 rounded border border-danger/30 bg-red-50 p-3 text-sm font-medium text-danger">Void reason: {receipt.void_reason || "Not provided"}</p> : null}
    </section>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-text-secondary">{label}</dt><dd className="font-medium">{value}</dd></div>;
}
